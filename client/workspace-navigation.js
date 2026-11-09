import { compareSessions } from './session-order.js';

// Compute from the current snapshot, so a request resolved elsewhere never remains in the queue.
export function reviewQueue(sessions, currentId, now = Date.now()) {
  const waiting = sessions.filter(s => s.status === 'permission' || s.status === 'question').sort(compareSessions);
  const index = waiting.findIndex(s => s.id === currentId), current = waiting[index];
  const next = waiting.find((s, i) => i > index && s.id !== currentId) || waiting.find(s => s.id !== currentId) || null;
  const since = current?.requests?.[0]?.createdAt || current?.statusSince;
  return { total: waiting.length, position: index + 1, next, waitMs: since ? Math.max(0, now - since) : null };
}

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matchCommands(commands, query) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return commands.slice();
  return commands.map((command, index) => {
    const label = normalize(command.label), text = `${label} ${normalize(command.detail)} ${normalize(command.keywords)}`;
    return { command, index, match: words.every(word => text.includes(word)), rank: words.reduce((rank, word) => rank + (label === word ? 4 : label.startsWith(word) ? 2 : label.includes(word) ? 1 : 0), 0) };
  }).filter(item => item.match).sort((a, b) => b.rank - a.rank || a.index - b.index).map(item => item.command);
}
