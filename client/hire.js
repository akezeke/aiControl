// Who a project can hire: Claude once per account (the one it last used first, `last`), then Codex. One account
// keeps plain "Claude", started where the server picks. Pure; the office's menu and the list's buttons share it.
export function hireChoices(snapshot, cwd) {
  const accounts = snapshot?.claudeAccounts || [''], codex = { provider: 'codex', label: 'Codex', name: 'Codex' };
  if (accounts.length < 2) return [{ provider: 'claude', label: 'Claude', name: 'Claude Code' }, codex];
  const latest = (snapshot.sessions || []).filter(s => s.provider === 'claude' && s.cwd === cwd && !s.parentId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const last = accounts.includes(latest?.account) ? latest.account : null, order = last === null ? accounts : [last, ...accounts.filter(account => account !== last)];
  return [...order.map(account => ({ provider: 'claude', account, label: account ? `Claude · ${account}` : 'Claude', name: account ? `Claude Code · ${account}` : 'Claude Code', last: account === last })), codex];
}
