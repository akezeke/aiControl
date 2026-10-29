import { open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const messageLimit = 20;
const agentMessageLimit = 30;
const textLimit = 12_000;
const historyCap = 150;
export function textContent(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(p => p.type === 'text' || p.type === 'input_text' || p.type === 'output_text').map(p => p.text || '').join('\n') : '';
}
function message(id, role, text, timestamp) {
  if (!text.trim()) return null;
  return { id, role, text: text.slice(0, textLimit), truncated: text.length > textLimit, timestamp: timestamp || null };
}
// The last `limit` messages that aren't tool lines, with the tool lines and notices between them.
export function recentMessages(list, limit = messageLimit) {
  let start = list.length;
  for (let count = 0; start > 0 && count < limit;) if (!list[--start].tool) count++;
  return list.slice(Math.max(start, list.length - Math.max(historyCap, limit * 5)));
}
// One line per tool call: name · short label, the raw value in `detail`.
function toolLine(id, name, value, timestamp, failed) {
  const raw = typeof value === 'string' ? value.trim() : '', label = raw.replace(/\s+/g, ' ').slice(0, 200);
  return { id, role: 'assistant', text: label ? `${name} · ${label}` : name, truncated: false, timestamp: timestamp || null, tool: true, ...(failed ? { failed: true } : {}), ...(raw && raw !== label ? { detail: raw.slice(0, 2000) } : {}) };
}
const notice = (id, text, timestamp, error) => { const value = message(id, 'notice', text.split('\n')[0].slice(0, 300), timestamp); return value && error ? { ...value, error: true } : value; };
// Codex runs commands as `/usr/bin/zsh -lc '…'`; show only the command.
const unwrapShell = command => typeof command === 'string' ? command.replace(/^(?:\S*\/)?(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/, (_, quote, inner) => quote === "'" ? inner.replaceAll("'\\''", "'") : inner) : command;
// Reasoning, hook prompts and sleeps stay out: they are noise next to the conversation.
export function codexMessage(entry) {
  const item = entry.item ?? entry;
  const time = entry.completedAtMs ?? entry.startedAtMs;
  const failed = ['failed', 'declined'].includes(item.status) || (item.exitCode != null && item.exitCode !== 0) || item.success === false || !!item.error;
  switch (item.type) {
    case 'agentMessage': case 'plan': return message(item.id, 'assistant', item.text || '', time);
    case 'userMessage': return message(item.id, 'user', textContent(item.content), time);
    case 'exitedReviewMode': return message(item.id, 'assistant', item.review || 'Review finished', time);
    case 'enteredReviewMode': return notice(item.id, 'Review started', time);
    case 'contextCompaction': return notice(item.id, 'Context compacted', time);
    case 'commandExecution': return toolLine(item.id, item.exitCode ? `Shell (exit ${item.exitCode})` : 'Shell', unwrapShell(item.command), time, failed);
    case 'fileChange': return toolLine(item.id, 'Edit', (item.changes ?? []).map(change => shortPath(change.path || '')).join(', '), time, failed);
    case 'mcpToolCall': return toolLine(item.id, [item.server, item.tool].filter(Boolean).join('/') || 'MCP tool', '', time, failed);
    case 'dynamicToolCall': return toolLine(item.id, item.tool || 'Tool', '', time, failed);
    case 'collabAgentToolCall': return toolLine(item.id, 'Agent', item.prompt, time, failed);
    case 'webSearch': return toolLine(item.id, 'Search', item.query, time, failed);
    case 'imageView': return toolLine(item.id, 'View image', shortPath(item.path || ''), time, failed);
    case 'imageGeneration': return toolLine(item.id, 'Generate image', item.revisedPrompt, time, failed);
    default: return null;
  }
}
// Plan steps from Codex (inProgress) and Claude's TodoWrite (in_progress), as pending | active | done.
export const planSteps = steps => Array.isArray(steps) ? steps.slice(0, 50).map(s => ({ step: String(s.step ?? s.content ?? '').slice(0, 300), status: s.status === 'completed' ? 'done' : /^in_?progress$/i.test(s.status) ? 'active' : 'pending' })) : null;
// Prefer the call's own description ("Type-check after the route change") and short paths.
const shortPath = path => path.split('/').filter(Boolean).slice(-2).join('/');
function toolMessage(row, block) {
  const input = block.input ?? {}, string = value => typeof value === 'string' && value.trim() ? value : undefined;
  const path = string(input.file_path) || string(input.path);
  const raw = string(input.command) || path || string(input.pattern) || string(input.url) || string(input.query) || string(input.prompt) || '';
  const label = string(input.description) || (path ? shortPath(path) : raw);
  return { ...toolLine(`${row.uuid}:${block.id}`, block.name, label, Date.parse(row.timestamp)), ...(raw && raw !== label ? { detail: raw.slice(0, 2000) } : {}) };
}
// A workflow worker's task opens with a fixed harness preface and indents the real text.
export function taskText(text) {
  if (!text.startsWith('[Workflow harness')) return text;
  const body = text.slice(text.indexOf('\n') + 1);
  return body.split('\n').map(line => line.replace(/^ {2}/, '')).join('\n').trim();
}
const tag = (text, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1].trim() || '';
// Claude also stores harness entries as user rows: agent notifications, slash commands, compaction
// summaries. Only typed prompts are the user's; the rest become one-line notices, or are dropped.
function claudeUserRow(row, text) {
  if (row.isCompactSummary) return ['notice', 'Context compacted'];
  const kind = row.origin?.kind;
  if (kind === 'task-notification') return ['notice', tag(text, 'summary') || `Task ${tag(text, 'status') || 'update'}`];
  if (kind && kind !== 'human') return ['notice', text.replace(/<[^>]+>/g, '').trim().split('\n')[0].slice(0, 200)];
  const command = tag(text, 'command-name');
  if (command) return ['user', `${command} ${tag(text, 'command-args')}`.trim()];
  if (text.startsWith('<local-command-')) return ['user', ''];
  if (text.startsWith('[Request interrupted')) return ['notice', 'Interrupted'];
  return ['user', text.replace(/<\/?pasted_content[^>]*>/g, '').trim()];
}
// Harness lines worth a notice; turn timings, hook summaries and local command output are not.
const systemNotices = new Set(['informational', 'away_summary', 'scheduled_task_fire', 'agents_killed', 'model_refusal_fallback']);
// Tool calls become one-line entries; the client folds runs of them in a main session.
export function claudeMessages(lines, sessionId, visibleIds = new Set(), { agent = false, all = false } = {}) {
  const messages = new Map(), tools = new Map();
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if ((row.sessionId && row.sessionId !== sessionId) || (row.isSidechain && !agent) || (row.isMeta && !visibleIds.has(row.uuid))) continue;
      const time = Date.parse(row.timestamp) || null;
      if (row.type === 'system') {
        const value = systemNotices.has(row.subtype) && typeof row.content === 'string' && notice(row.uuid, row.content, time, ['error', 'warning'].includes(row.level));
        if (value) messages.set(value.id, value);
        continue;
      }
      if (!['user', 'assistant'].includes(row.type)) continue;
      const blocks = Array.isArray(row.message?.content) ? row.message.content : [];
      // A failed tool call turns its line red.
      for (const block of blocks) if (block.type === 'tool_result' && block.is_error && tools.has(block.tool_use_id)) tools.get(block.tool_use_id).failed = true;
      const content = textContent(row.message?.content), images = blocks.filter(block => block.type === 'image').length;
      if (row.isApiErrorMessage) { const value = notice(row.uuid, content || 'API error', time, true); if (value) messages.set(value.id, value); continue; }
      const [role, text] = row.type === 'user' ? claudeUserRow(row, content) : ['assistant', content];
      const shown = (images && role === 'user' ? `[image${images > 1 ? ` ×${images}` : ''}] ` : '') + (agent && role === 'user' ? taskText(text) : text);
      const value = message(agent ? row.uuid : row.message?.id || row.uuid, role, shown, time);
      if (value) messages.set(value.id, value);
      if (row.type === 'assistant') for (const block of blocks) if (block.type === 'tool_use') { const tool = toolMessage(row, block); messages.set(tool.id, tool); tools.set(block.id, tool); }
    } catch { /* partially flushed and truncated first lines are skipped */ }
  }
  const list = [...messages.values()];
  return all ? list : agent ? list.slice(-agentMessageLimit) : recentMessages(list);
}

// Session facts from the transcript tail; the newest record of each kind wins. Claude's queue is
// replayed from its queue-operation records (harness notifications are not the user's messages).
export function claudeMeta(lines, sessionId) {
  const meta = {}; let queue = [];
  for (const line of lines) {
    if (!/"(assistant|system|cost-state|queue-operation|user)"/.test(line)) continue;
    try {
      const row = JSON.parse(line);
      if ((row.sessionId && row.sessionId !== sessionId) || row.isSidechain) continue;
      if (typeof row.gitBranch === 'string' && row.gitBranch) meta.branch = row.gitBranch;
      if (typeof row.permissionMode === 'string') meta.permissionMode = row.permissionMode;
      if (row.type === 'assistant' && row.message?.model && row.message.model !== '<synthetic>') {
        meta.model = row.message.model;
        if (typeof row.effort === 'string') meta.effort = row.effort;
        const u = row.message.usage;
        if (u) meta.context = { used: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0) };
        for (const block of row.message.content ?? []) if (block.type === 'tool_use' && block.name === 'TodoWrite') meta.plan = planSteps(block.input?.todos);
      }
      if (row.type === 'system' && row.subtype === 'turn_duration' && Number.isFinite(row.durationMs)) meta.lastTurnMs = row.durationMs;
      if (row.type === 'cost-state' && Number.isFinite(row.totalCostUSD)) meta.cost = { usd: row.totalCostUSD, added: row.totalLinesAdded || 0, removed: row.totalLinesRemoved || 0 };
      if (row.type === 'queue-operation') {
        if (row.operation === 'enqueue' && typeof row.content === 'string') queue.push({ id: row.timestamp + queue.length, text: row.content });
        else if (row.operation === 'dequeue') queue.shift();
        else if (row.operation === 'popAll') queue = [];
        else if (row.operation === 'remove') { const index = queue.findIndex(entry => entry.text === row.content); if (index >= 0) queue.splice(index, 1); }
      }
    } catch { /* partial line */ }
  }
  meta.queuedMessages = queue.filter(entry => !entry.text.startsWith('<')).slice(-20).map(entry => ({ id: entry.id, text: entry.text.slice(0, 2000) }));
  return meta;
}

// 'tool' while a tool call or its result is the latest step, 'reply' after text.
export function agentActivity(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (!['user', 'assistant'].includes(row.type) || !Array.isArray(row.message?.content)) continue;
      return row.type === 'user' || row.message.content.some(block => block.type === 'tool_use') ? 'tool' : 'reply';
    } catch { /* partial line */ }
  }
  return 'tool';
}

// A main session's latest step: 'tool' while a tool call runs, 'model' while the model works out what comes next
// (after a prompt, a tool result or its own thinking), 'reply' once it has written text.
export function claudeStep(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]), content = row.message?.content;
      if (!['user', 'assistant'].includes(row.type) || row.isSidechain || row.isMeta || !content) continue;
      if (row.type === 'user') return 'model';
      const kinds = [content].flat().map(block => block.type);
      return kinds.includes('tool_use') ? 'tool' : kinds.every(kind => kind === 'thinking') ? 'model' : 'reply';
    } catch { /* partial line */ }
  }
  return null;
}
// 'thinking' once a working session's model has been quiet for a while; short gaps between tool calls don't count.
export const claudeActivity = (status, step, modifiedAt, now = Date.now()) => status === 'working' && step === 'model' && now - modifiedAt > 8000 ? 'thinking' : '';
// The current turn's latest tool line ("Bash · Type-check after the route change"): hooks only see a call once it has finished,
// and only its tool's name.
export function turnTool(messages = []) {
  for (let i = messages.length - 1; i >= 0 && messages[i].role !== 'user'; i--) if (messages[i].tool) return messages[i].text;
  return '';
}

export function claudeTitles(lines, sessionId, previous = {}) {
  const titles = { ...previous };
  for (const line of lines) {
    // Avoid parsing large tool results when looking only for title records.
    if (!line.includes('"ai-title"') && !line.includes('"custom-title"')) continue;
    try {
      const row = JSON.parse(line);
      if (row.sessionId !== sessionId || row.isSidechain) continue;
      const field = row.type === 'custom-title' ? 'customTitle' : row.type === 'ai-title' ? 'aiTitle' : null;
      if (field && typeof row[field] === 'string') titles[field] = row[field].replace(/\s+/g, ' ').trim().slice(0, 240);
    } catch { /* partial records are retried on the next read */ }
  }
  return titles;
}

export function claudeSessionTitle(record, history) {
  return history.customTitle || (record.nameSource === 'user' ? record.name : '') || history.aiTitle || record.name || 'Claude Code session';
}

export class TranscriptReader {
  cache = new Map();
  visibleIds = new Map();
  // One projects folder per Claude account; transcripts are only read from inside them.
  constructor(projectsDirs) { this.projectsDirs = [projectsDirs].flat().map(dir => resolve(dir)); }
  includeMessage(sessionId, id) {
    if (!this.visibleIds.has(sessionId)) this.visibleIds.set(sessionId, new Set());
    this.visibleIds.get(sessionId).add(id);
    this.cache.clear();
  }
  // The real path of a session's (or one of its agents') transcript, or null unless it is inside a projects folder.
  async locate(file, sessionId, agentId) {
    if (!file || !/^[a-f0-9-]{16,64}$/i.test(sessionId) || (agentId !== undefined && !/^[a-z0-9]{1,64}$/i.test(agentId))) return null;
    const path = await realpath(file);
    const own = agentId !== undefined ? path.includes(`/${sessionId}/subagents/`) && path.endsWith(`/agent-${agentId}.jsonl`) : path.endsWith(`/${sessionId}.jsonl`);
    return own && this.projectsDirs.some(dir => path.startsWith(dir + sep)) ? path : null;
  }
  // `older` asks for a longer history than the snapshot carries; those reads skip the cache.
  async read(file, sessionId, agentId, older) {
    const agent = agentId !== undefined, limit = older || (agent ? agentMessageLimit : messageLimit), maxBytes = (older ? 32 : 4) * 1024 * 1024;
    try {
      const path = await this.locate(file, sessionId, agentId);
      if (!path) return { messages: [], messagesState: 'unavailable' };
      const handle = await open(path, 'r');
      try {
        const stat = await handle.stat();
        const key = `${path}:${stat.size}:${stat.mtimeMs}`;
        const cached = this.cache.get(path);
        if (cached?.key === key && !older) return cached.result;
        // Bound reads even for multi-gigabyte sessions; seek backwards until enough visible text is found.
        let size = Math.min(stat.size, 256 * 1024), messages = [], lines = [];
        do {
          const buffer = Buffer.alloc(size);
          await handle.read(buffer, 0, size, stat.size - size);
          lines = buffer.toString('utf8').split('\n');
          messages = claudeMessages(lines, sessionId, this.visibleIds.get(sessionId), { agent, all: !!older });
          if (older) messages = agent ? messages.slice(-limit) : recentMessages(messages, limit);
          if (messages.filter(item => !item.tool).length >= limit || size >= stat.size || size >= maxBytes) break;
          size = Math.min(size * 2, stat.size, maxBytes);
        } while (true);
        if (older) return { messages, more: size < stat.size || messages.filter(item => !item.tool).length >= limit };
        let titles = cached && cached.size <= stat.size ? cached.titles : {};
        if (agent) {
          // Pin the task (the first user message) even after it scrolls out of the recent window.
          if (size < stat.size) {
            const head = Buffer.alloc(Math.min(256 * 1024, stat.size - size));
            await handle.read(head, 0, head.length, 0);
            const task = claudeMessages(head.toString('utf8').split('\n'), sessionId, new Set(), { agent: true }).find(item => item.role === 'user');
            if (task && !messages.some(item => item.id === task.id)) messages = [task, ...messages.slice(1 - limit)];
          } else if (messages[0]?.role !== 'user') {
            const task = claudeMessages(lines, sessionId, new Set(), { agent: true, all: true }).find(item => item.role === 'user');
            if (task && !messages.some(item => item.id === task.id)) messages = [task, ...messages.slice(1 - limit)];
          }
          const result = { messages, messagesState: messages.length ? 'ready' : 'empty', activity: agentActivity(lines), modifiedAt: stat.mtimeMs };
          this.cache.set(path, { key, result });
          if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
          return result;
        }
        if (size < stat.size) {
          const head = Buffer.alloc(Math.min(128 * 1024, stat.size - size));
          await handle.read(head, 0, head.length, 0);
          titles = { ...claudeTitles(head.toString('utf8').split('\n'), sessionId), ...titles };
        }
        titles = claudeTitles(lines, sessionId, titles);
        const result = { messages, messagesState: messages.length ? 'ready' : 'empty', ...titles, ...claudeMeta(lines, sessionId), step: claudeStep(lines), modifiedAt: stat.mtimeMs };
        this.cache.set(path, { key, result, titles, size: stat.size });
        if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
        return result;
      } finally { await handle.close(); }
    } catch { return { messages: [], messagesState: 'unavailable' }; }
  }
}
