const unitMinutes = { minute: 1, hour: 60, day: 1440 };
const windowMinutes = label => label === 'Weekly' ? 10080 : Number(/^(\d+)-(minute|hour|day)$/.exec(label)?.[1]) * unitMinutes[/-(\w+)$/.exec(label)?.[1]] || 0;
export function usageWindowView(window, now = Date.now()) {
  const used = window.usedPercent;
  const expired = Number.isFinite(window.resetsAt) && window.resetsAt <= now;
  // Linear projection to the reset, once a tenth of the window has passed.
  const span = windowMinutes(window.label) * 60_000, elapsed = span && Number.isFinite(window.resetsAt) ? span - (window.resetsAt - now) : 0;
  const pace = !expired && elapsed > span / 10 && elapsed <= span ? Math.round(used * span / elapsed) : null;
  const minutes = Math.max(1, Math.ceil((window.resetsAt - now) / 60_000));
  let resetText = 'Reset time unavailable';
  let resetShortText = '—';
  if (expired) resetText = 'Reset due · awaiting refresh';
  else if (Number.isFinite(window.resetsAt)) {
    const duration = minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`
      : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
    resetText = `Resets in ${duration}`;
  }
  if (expired) resetShortText = 'due';
  else if (window.label === '5-hour' && Number.isFinite(window.resetsAt)) {
    resetShortText = new Date(window.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } else if (Number.isFinite(window.resetsAt)) {
    const days = (window.resetsAt - now) / 86_400_000;
    resetShortText = days < .01 ? '<0.01d' : `${Number(days.toFixed(days < 1 ? 2 : 1))}d`;
  }
  const shortLabel = window.label === 'Weekly' ? 'w' : window.label.replace(/-(hour|day|minute)$/, (_, unit) => ({ hour: 'h', day: 'd', minute: 'm' })[unit]);
  return { shortLabel, pace, paceText: pace == null ? '' : `On pace for ${pace}% by reset`, percentText: `${Number(used.toFixed(1))}%`, barPercent: Math.min(100, Math.max(0, used)), tone: used >= 100 ? 'usage-full' : used >= 80 ? 'usage-high' : '', expired, resetText, resetShortText };
}

export function usageUpdatedText(account, now = Date.now(), stale = false) {
  if (account.updatedAt == null) return account.status === 'loading' ? 'Loading…' : 'Unavailable';
  const minutes = Math.max(0, Math.floor((now - account.updatedAt) / 60_000));
  const age = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return `${stale ? 'Last updated' : 'Updated'} ${age}${stale ? ' · stale' : ''}`;
}
