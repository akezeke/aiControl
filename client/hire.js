// Who a project can hire: Claude, then Codex. Several Claude accounts are one choice holding them as `accounts`, the
// one it last used first (`last`). One account keeps plain "Claude", started where the server picks. Pure; every
// new-agent control shares it.
export function hireChoices(snapshot, cwd) {
  const accounts = snapshot?.claudeAccounts || [''], claude = { provider: 'claude', label: 'Claude', name: 'Claude Code' }, others = [{ provider: 'codex', label: 'Codex', name: 'Codex' },
    ...snapshot?.features?.opencode ? [{ provider: 'opencode', label: 'OpenCode', name: 'OpenCode' }] : []];
  if (accounts.length < 2) return [claude, ...others];
  const latest = (snapshot.sessions || []).filter(s => s.provider === 'claude' && s.cwd === cwd && !s.parentId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const last = accounts.includes(latest?.account) ? latest.account : null, order = last === null ? accounts : [last, ...accounts.filter(account => account !== last)];
  return [{ ...claude, accounts: order.map(account => ({ provider: 'claude', account, label: account || 'Default', name: account ? `Claude Code · ${account}` : 'Claude Code', last: account === last })) }, ...others];
}
