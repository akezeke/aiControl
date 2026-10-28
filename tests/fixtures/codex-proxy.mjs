import { duplexPair } from 'node:stream';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { connectCodexSocket } from '../../server/codex.mjs';

// Real HTTP upgrade + masked WebSocket frames, on in-memory streams instead of a host socket.
export function mockCodexServer({ status = 'active', question = true, items, rateLimits = { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1900500000 } } } } = {}) {
  const fixture = { messages: [], handshakes: 0, queue: [], turns: [], steers: [], rateLimits, currentTurnId: status === 'active' ? 'original' : null };
  const pairs = [], servers = [];
  const thread = { id: 'live-thread', cwd: '/work/project', name: 'Protocol fixture', status: { type: status, activeFlags: [] }, updatedAt: Date.now() / 1000, model: 'test-model' };
  fixture.thread = thread;
  fixture.finishTurn = () => { const id = fixture.currentTurnId; fixture.currentTurnId = null; thread.status = { type: 'idle', activeFlags: [] }; fixture.send({ method: 'turn/completed', params: { threadId: thread.id, turn: { id, status: 'completed' } } }); fixture.send({ method: 'thread/status/changed', params: { threadId: thread.id, status: thread.status } }); };
  fixture.connect = path => {
    const [clientSocket, serverSocket] = duplexPair(); pairs.push(clientSocket, serverSocket);
    for (const socket of [clientSocket, serverSocket]) { socket.setTimeout = socket.setNoDelay = socket.setKeepAlive = () => socket; }
    const http = createServer(), wss = new WebSocketServer({ noServer: true }); servers.push(http, wss);
    http.on('upgrade', (req, socket, head) => {
      if (req.headers.upgrade !== 'websocket') throw new Error('Expected a WebSocket upgrade');
      fixture.handshakes++;
      wss.handleUpgrade(req, socket, head, ws => {
        // duplexPair does not propagate destroy to its peer like a host socket.
        fixture.disconnect = () => { ws.terminate(); clientSocket.destroy(); };
        const send = value => ws.send(JSON.stringify(value)); fixture.send = send;
        ws.on('message', bytes => {
          const message = JSON.parse(bytes); fixture.messages.push(message);
          if (fixture.ignoreMethod && fixture.ignoreMethod === message.method) return;
          if (message.method === 'initialize') send({ id: message.id, result: {} });
          if (message.method === 'account/rateLimits/read') send({ id: message.id, ...(fixture.usageError ? { error: fixture.usageError } : { result: fixture.rateLimits }) });
          if (message.method === 'thread/loaded/list') send({ id: message.id, result: { data: [thread.id], nextCursor: null } });
          if (message.method === 'thread/resume' || message.method === 'thread/read') {
            if (message.params.threadId !== thread.id) throw new Error('Resumed an unloaded thread');
            // A new thread writes its rollout on the first turn; until then only resume fails.
            if (message.method === 'thread/resume' && fixture.noRollout) { send({ id: message.id, error: { code: -32600, message: `no rollout found for thread id ${thread.id}` } }); return; }
            send({ id: message.id, result: { thread } });
            if (message.method === 'thread/resume' && question) send({ id: 97, method: 'item/tool/requestUserInput', params: { threadId: thread.id, questions: [{ id: 'choice', question: 'Continue?', isOther: false, options: [{ label: 'Yes' }] }] } });
          }
          if (message.method === 'thread/queue/list') send({ id: message.id, result: { data: fixture.queue, nextCursor: null } });
          if (message.method === 'thread/turns/list') send({ id: message.id, result: { data: fixture.currentTurnId ? [{ id: fixture.currentTurnId, status: 'inProgress', items: [] }] : [], nextCursor: null } });
          if (message.method === 'turn/steer') {
            fixture.beforeSteer?.();
            if (!fixture.currentTurnId) { send({ id: message.id, error: { code: -32600, message: 'no active turn to steer' } }); return; }
            if (fixture.currentTurnId !== message.params.expectedTurnId) { send({ id: message.id, error: { code: -32600, message: `expected active turn id ${message.params.expectedTurnId} but found ${fixture.currentTurnId}` } }); return; }
            fixture.steers.push(message.params);
            send({ id: message.id, result: { turnId: fixture.currentTurnId } });
          }
          if (message.method === 'thread/queue/add') {
            let entry = fixture.queue.find(entry => entry.clientUserMessageId === message.params.clientUserMessageId);
            if (!entry) { entry = { id: `queued-${fixture.messages.length}`, input: message.params.input, clientUserMessageId: message.params.clientUserMessageId }; fixture.queue.push(entry); }
            send({ id: message.id, result: { queuedSubmission: entry } });
            send({ method: 'thread/queue/changed', params: { threadId: thread.id } });
          }
          if (message.method === 'thread/queue/delete') {
            const index = fixture.queue.findIndex(entry => entry.id === message.params.queuedSubmissionId);
            if (index >= 0) fixture.queue.splice(index, 1);
            send({ id: message.id, result: { deleted: index >= 0 } });
          }
          if (message.method === 'turn/start' || message.method === 'thread/queue/start') {
            fixture.beforeStart?.();
            if (thread.status.type !== 'idle') { send({ id: message.id, error: { code: -32600, message: 'A turn is already active' } }); return; }
            let input = message.params.input;
            if (message.method === 'thread/queue/start') {
              const index = fixture.queue.findIndex(entry => entry.id === message.params.queuedSubmissionId);
              if (index < 0) { send({ id: message.id, error: { code: -32600, message: 'Queued submission not found' } }); return; }
              input = fixture.queue.splice(index, 1)[0].input;
            }
            const turn = { id: `turn-${fixture.turns.length + 1}`, status: 'inProgress', input };
            fixture.turns.push(turn); fixture.currentTurnId = turn.id; fixture.noRollout = false; thread.status = { type: 'active', activeFlags: [] };
            send({ id: message.id, result: { turn } });
            send({ method: 'thread/status/changed', params: { threadId: thread.id, status: thread.status } });
          }
          if (message.method === 'thread/items/list') {
            const history = items ?? [
            { item: { type: 'agentMessage', id: 'reply', text: 'The latest reply.' } },
            { item: { type: 'reasoning', id: 'private', content: ['Do not show this'] } },
            { item: { type: 'userMessage', id: 'prompt', content: [{ type: 'text', text: 'The earlier user message.' }] } },
            ];
            const offset = Number(message.params.cursor || 0), end = offset + message.params.limit;
            send({ id: message.id, result: { data: history.slice(offset, end), nextCursor: end < history.length ? String(end) : null } });
          }
          if (message.id === 97 && message.result) {
            if (message.result.answers.choice.answers[0] !== 'Yes') throw new Error('Bad answer');
            send({ method: 'serverRequest/resolved', params: { threadId: thread.id, requestId: 97 } });
          }
        });
      });
    });
    http.emit('connection', serverSocket);
    return connectCodexSocket(path, { createConnection: () => clientSocket });
  };
  fixture.close = () => { for (const socket of pairs) socket.destroy(); for (const server of servers) server.close(); };
  return fixture;
}
