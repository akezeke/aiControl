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
  let resetIn = '—';
  let resetShortText = '—';
  if (expired) { resetText = 'Reset due · awaiting refresh'; resetIn = 'due'; }
  else if (Number.isFinite(window.resetsAt)) {
    resetIn = minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`
      : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
    resetText = `Resets in ${resetIn}`;
  }
  if (expired) resetShortText = 'due';
  else if (Number.isFinite(window.resetsAt) && minutes < 1440) {
    resetShortText = new Date(window.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } else if (Number.isFinite(window.resetsAt)) {
    const hours = Math.floor(minutes % 1440 / 60);
    resetShortText = `${Math.floor(minutes / 1440)}d${hours ? ` ${hours}h` : ''}`;
  }
  const shortLabel = window.label === 'Weekly' ? 'w' : window.label.replace(/-(hour|day|minute)$/, (_, unit) => ({ hour: 'h', day: 'd', minute: 'm' })[unit]);
  return { shortLabel, pace, paceText: pace == null ? '' : `On pace for ${pace}% by reset`, percentText: `${Number(used.toFixed(1))}%`, barPercent: Math.min(100, Math.max(0, used)), tone: used >= 100 ? 'usage-full' : used >= 80 ? 'usage-high' : '', expired, resetText, resetIn, resetShortText };
}

export function usageUpdatedText(account, now = Date.now(), stale = false) {
  if (account.updatedAt == null) return account.status === 'loading' ? 'Loading…' : 'Unavailable';
  const minutes = Math.max(0, Math.floor((now - account.updatedAt) / 60_000));
  const age = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return `${stale ? 'Last updated' : 'Updated'} ${age}${stale ? ' · stale' : ''}`;
}

export function costPeriodView(period) {
  const usd = period.usd;
  const cost = Number.isFinite(usd) && usd >= 0 ? `≈$${usd.toFixed(usd > 0 && usd < .01 ? 4 : 2)}` : '—';
  const count = value => (Number.isFinite(value) ? value : 0).toLocaleString();
  return { cost, detail: `${period.label}: OpenCode estimated cost · ${count(period.input)} input · ${count(period.output)} output · ${count(period.cacheRead)} cache read · ${count(period.cacheWrite)} cache write tokens` };
}

// OpenCode has no limit windows, only what's been spent, and against a budget if one is set. The budget is a gauge, not a limit:
// reaching it stops nothing, so themes show it as a reserve and never as a hard stop. Null when there's nothing to show.
export function spendView(account, now = Date.now()) {
  if (account?.provider !== 'opencode' || !account.periods?.length) return null;
  const cycle = account.budget, unit = cycle?.mode === 'monthly' ? 'month' : 'week', limit = cycle?.usd > 0 ? cycle.usd : null;
  const spent = cycle?.spent ?? account.week?.usd ?? 0, today = account.periods.find(period => period.id === 'today')?.usd ?? null;
  const resetsAt = cycle?.resetsAt ?? account.week?.resetsAt, reset = usageWindowView({ label: 'Budget', usedPercent: 0, resetsAt }, now);
  const usedPercent = limit ? spent / limit * 100 : null, money = usd => costPeriodView({ usd }).cost;
  return {
    unit, label: unit === 'month' ? 'Month' : 'Week', spent, limit, today, usedPercent, resetIn: reset.resetIn, resetShort: reset.resetShortText,
    left: limit ? Math.max(0, limit - spent) : null, over: limit != null && spent > limit, near: limit != null && spent <= limit && usedPercent >= 80,
    partial: account.status === 'partial' || !!account.week?.incomplete, money,
    text: limit ? `${money(spent)} of $${limit.toLocaleString()} this ${unit}` : `${money(spent)} this ${unit}`,
    detail: [`OpenCode spend`, today != null ? `Today ${money(today)}` : '', `This ${unit} ${money(spent)}${limit ? ` of $${limit.toLocaleString()}` : ''}`, reset.resetText !== 'Reset time unavailable' ? reset.resetText.replace('Resets', 'Budget resets') : '', 'Recorded estimates; a budget tracks spending, it does not stop it.'].filter(Boolean).join('\n'),
  };
}
