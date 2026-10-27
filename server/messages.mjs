import { open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const messageLimit = 6;
const agentMessageLimit = 16;
const textLimit = 12_000;
export function textContent(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(p => p.type === 'text' || p.type === 'input_text' || p.type === 'output_text').map(p => p.text || '').join('\n') : '';
}
function message(id, role, text, timestamp) {
  if (!text.trim()) return null;
  return { id, role, text: text.slice(0, textLimit), truncated: text.length > textLimit, timestamp: timestamp || null };
}
export function codexMessage(entry) {
  const item = entry.item ?? entry;
  const time = entry.completedAtMs ?? entry.startedAtMs;
  if (item.type === 'agentMessage') return message(item.id, 'assistant', item.text || '', time);
  if (item.type === 'userMessage') return message(item.id, 'user', textContent(item.content), time);
  return null;
}
// One line per tool call, so a subagent's history shows what it is doing. Prefer the call's own
// description ("Type-check after the route change") and short paths; the raw value goes in `detail`.
const shortPath = path => path.split('/').filter(Boolean).slice(-2).join('/');
function toolMessage(row, block) {
  const input = block.input ?? {}, string = value => typeof value === 'string' && value.trim() ? value : undefined;
  const path = string(input.file_path) || string(input.path);
  const raw = string(input.command) || path || string(input.pattern) || string(input.url) || string(input.query) || string(input.prompt) || '';
  const label = string(input.description) || (path ? shortPath(path) : raw);
  const text = `${block.name}${label ? ` · ${label.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
  return { ...message(`${row.uuid}:${block.id}`, 'assistant', text, Date.parse(row.timestamp) || null), tool: true, ...(raw && raw !== label ? { detail: raw.slice(0, 2000) } : {}) };
}
// A workflow worker's task opens with a fixed harness preface and indents the real text.
export function taskText(text) {
  if (!text.startsWith('[Workflow harness')) return text;
  const body = text.slice(text.indexOf('\n') + 1);
  return body.split('\n').map(line => line.replace(/^ {2}/, '')).join('\n').trim();
}
// Subagent transcripts (agent = true) are sidechains, and their tool calls are included.
export function claudeMessages(lines, sessionId, visibleIds = new Set(), { agent = false, all = false } = {}) {
  const messages = new Map();
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if ((row.sessionId && row.sessionId !== sessionId) || (row.isSidechain && !agent) || (row.isMeta && !visibleIds.has(row.uuid)) || !['user', 'assistant'].includes(row.type)) continue;
      const content = textContent(row.message?.content);
      const value = message(agent ? row.uuid : row.message?.id || row.uuid, row.type, agent && row.type === 'user' ? taskText(content) : content, Date.parse(row.timestamp) || null);
      if (value) messages.set(value.id, value);
      if (agent && row.type === 'assistant' && Array.isArray(row.message?.content)) for (const block of row.message.content) if (block.type === 'tool_use') { const tool = toolMessage(row, block); messages.set(tool.id, tool); }
    } catch { /* partially flushed and truncated first lines are skipped */ }
  }
  const list = [...messages.values()];
  return all ? list : list.slice(-(agent ? agentMessageLimit : messageLimit));
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
  constructor(projectsDir) { this.projectsDir = resolve(projectsDir); }
  includeMessage(sessionId, id) {
    if (!this.visibleIds.has(sessionId)) this.visibleIds.set(sessionId, new Set());
    this.visibleIds.get(sessionId).add(id);
    this.cache.clear();
  }
  async read(file, sessionId, agentId) {
    if (!file || !/^[a-f0-9-]{16,64}$/i.test(sessionId) || (agentId !== undefined && !/^[a-z0-9]{1,64}$/i.test(agentId))) return { messages: [], messagesState: 'unavailable' };
    const agent = agentId !== undefined, limit = agent ? agentMessageLimit : messageLimit;
    try {
      const path = await realpath(file);
      if (!path.startsWith(this.projectsDir + sep) || !(agent ? path.includes(`/${sessionId}/subagents/`) && path.endsWith(`/agent-${agentId}.jsonl`) : path.endsWith(`/${sessionId}.jsonl`))) return { messages: [], messagesState: 'unavailable' };
      const handle = await open(path, 'r');
      try {
        const stat = await handle.stat();
        const key = `${path}:${stat.size}:${stat.mtimeMs}`;
        const cached = this.cache.get(path);
        if (cached?.key === key) return cached.result;
        // Bound reads even for multi-gigabyte sessions; seek backwards until enough visible text is found.
        let size = Math.min(stat.size, 256 * 1024), messages = [], lines = [];
        do {
          const buffer = Buffer.alloc(size);
          await handle.read(buffer, 0, size, stat.size - size);
          lines = buffer.toString('utf8').split('\n');
          messages = claudeMessages(lines, sessionId, this.visibleIds.get(sessionId), { agent });
          if (messages.length >= limit || size >= stat.size || size >= 4 * 1024 * 1024) break;
          size = Math.min(size * 2, stat.size, 4 * 1024 * 1024);
        } while (true);
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
        const result = { messages, messagesState: messages.length ? 'ready' : 'empty', ...titles };
        this.cache.set(path, { key, result, titles, size: stat.size });
        if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
        return result;
      } finally { await handle.close(); }
    } catch { return { messages: [], messagesState: 'unavailable' }; }
  }
}
