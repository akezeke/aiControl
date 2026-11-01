import { basename } from 'node:path';
import { recentMessages, planSteps } from './messages.mjs';

const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
export const tokenUsage = tokens => ({ input: number(tokens?.input), output: number(tokens?.output), reasoning: number(tokens?.reasoning), cacheRead: number(tokens?.cache?.read), cacheWrite: number(tokens?.cache?.write) });
export const emptyUsage = () => ({ usd: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
const add = (target, source) => { for (const key of Object.keys(target)) target[key] += number(source[key]); };

// The assistant message already totals its step-finish parts. Counting both doubles spend.
export function usageRecords(rows) {
  return [...new Map(rows.filter(row => row.info?.role === 'assistant').map(({ info }) => [info.id, {
    id: info.id, at: info.time?.created, usd: Number.isFinite(info.cost) && info.cost >= 0 ? info.cost : null,
    ...tokenUsage(info.tokens),
  }])).values()];
}

export function usagePeriods(records, now = Date.now()) {
  const date = new Date(now), today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const month = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  return [{ id: 'today', label: 'Today', from: today }, { id: 'month', label: 'Month', from: month }].map(period => {
    const usage = emptyUsage(); let missing = false;
    for (const record of records) if (record.at >= period.from && record.at <= now) { add(usage, record); missing ||= record.usd === null; }
    return { ...period, ...usage, incomplete: missing };
  });
}

export function openCodeMessages(rows, limit = 20) {
  const messages = [];
  for (const { info, parts = [] } of rows) {
    if (!info || !['user', 'assistant'].includes(info.role)) continue;
    for (const part of parts) {
      const base = { id: part.id, role: info.role, timestamp: info.time?.created || null, truncated: false };
      if (part.type === 'text' && !part.ignored && !part.synthetic && part.text?.trim()) {
        messages.push({ ...base, text: part.text.slice(0, 12_000), truncated: part.text.length > 12_000 });
      } else if (part.type === 'tool') {
        const input = part.state?.input || {}, detail = input.command || input.filePath || input.path || input.pattern || input.url || input.prompt || '';
        const label = input.description || part.state?.title || (typeof detail === 'string' ? detail : '');
        messages.push({ ...base, tool: true, text: [part.tool, String(label).replace(/\s+/g, ' ').slice(0, 200)].filter(Boolean).join(' · '),
          ...(typeof detail === 'string' && detail ? { detail: detail.slice(0, 2000) } : {}), ...(part.state?.status === 'error' ? { failed: true } : {}) });
      } else if (part.type === 'file') {
        messages.push({ ...base, text: `[${part.mime?.startsWith('image/') ? 'image' : 'file'}] ${part.filename || ''}`.trim() });
      } else if (part.type === 'compaction') messages.push({ ...base, role: 'notice', text: 'Context compacted' });
    }
    if (info.error) messages.push({ id: `${info.id}:error`, role: 'notice', text: String(info.error.data?.message || info.error.name || 'OpenCode request failed').slice(0, 300), error: true, timestamp: info.time?.created, truncated: false });
  }
  return recentMessages(messages, limit);
}

export function openCodeSession(info, rows = [], previous = {}) {
  const assistant = rows.findLast(row => row.info?.role === 'assistant')?.info;
  const user = rows.findLast(row => row.info?.role === 'user')?.info;
  const provider = info.model?.providerID || assistant?.providerID || user?.model?.providerID;
  const model = info.model?.id || assistant?.modelID || user?.model?.modelID;
  const messages = openCodeMessages(rows), usage = assistant?.tokens && tokenUsage(assistant.tokens);
  const todo = rows.flatMap(row => row.parts || []).findLast(part => part.type === 'tool' && part.tool === 'todowrite' && part.state?.status === 'completed');
  return { ...previous, id: `opencode:${info.id}`, nativeId: info.id, provider: 'opencode', title: info.title || 'OpenCode session',
    cwd: info.directory, project: basename(info.directory || '') || 'OpenCode', parentId: info.parentID ? `opencode:${info.parentID}` : null,
    model: [provider, model].filter(Boolean).join('/'), version: info.version, updatedAt: info.time?.updated || 0,
    status: previous.status || 'idle', messages, messagesState: messages.length ? 'ready' : 'empty',
    ...(usage ? { context: { used: usage.input + usage.output + usage.cacheRead + usage.cacheWrite } } : {}),
    ...(info.tokens ? { tokens: tokenUsage(info.tokens) } : {}),
    ...(Number.isFinite(info.cost) ? { cost: { usd: info.cost, estimated: true, added: info.summary?.additions || 0, removed: info.summary?.deletions || 0 } } : {}),
    ...(todo ? { plan: planSteps(todo.state.input?.todos) } : {}),
    control: true, messaging: { send: true, interrupt: true },
  };
}
