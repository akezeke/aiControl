import { usageWindowView, usageUpdatedText, costPeriodView } from './usage-presentation.js';

const money = usd => costPeriodView({ usd }).cost;
const knownCost = value => Number.isFinite(value) && value >= 0;
const accountKey = account => `${account.provider}:${account.label || account.name || ''}`;

export function usageSummary(accounts, { now = Date.now(), disconnected = false } = {}) {
  if (!accounts?.length) return [{ label: 'Usage', metrics: [], states: [disconnected ? 'Disconnected' : 'Unavailable'], detail: 'Usage unavailable' }];
  return accounts.map(account => {
    const provider = { codex: 'Codex', claude: 'Claude', opencode: 'OpenCode' }[account.provider] || account.provider;
    const label = account.label ? `${provider} · ${account.label}` : account.name || provider;
    const metrics = [], states = [];
    if (disconnected) states.push('Disconnected');
    const state = { loading: 'Loading…', partial: 'Partial', updating: 'Updating…', stale: 'Stale', unavailable: 'Unavailable', error: 'Error' }[account.status];
    if (state && !(disconnected && state === 'Stale')) states.push(state);
    if (account.provider === 'opencode') {
      const cycle = account.budget, monthly = cycle?.mode === 'monthly';
      const amount = knownCost(cycle?.spent) ? cycle.spent : !monthly && knownCost(account.week?.usd) ? account.week.usd : null;
      const period = account.periods?.find(period => period.id === 'today' && knownCost(period.usd)) || account.periods?.find(period => knownCost(period.usd));
      if (amount != null) {
        const limit = knownCost(cycle?.usd) && cycle.usd > 0 ? cycle.usd : null;
        metrics.push({ label: monthly ? 'mo' : 'wk', value: `${money(amount)}${limit ? ` / $${limit.toLocaleString()}` : ''}`, tone: limit && amount > limit ? 'usage-full' : limit && amount >= limit * .8 ? 'usage-high' : '' });
      } else if (period) metrics.push({ label: period.label, value: money(period.usd), tone: '' });
      if (account.week?.incomplete && !states.includes('Partial')) states.push('Partial');
    } else {
      for (const window of account.windows || []) {
        if (!Number.isFinite(window.usedPercent)) continue;
        const view = usageWindowView(window, now);
        metrics.push({ label: `${view.shortLabel}${window.scope ? `·${window.scope}` : ''}`, value: view.percentText, tone: view.tone });
        if (view.expired && !states.includes('Reset due')) states.push('Reset due');
      }
      for (const period of account.periods || []) {
        if (knownCost(period.usd)) metrics.push({ label: period.label, value: money(period.usd), tone: '' });
      }
    }
    if (!metrics.length && !states.length) states.push('Unavailable');
    const detail = [label, usageUpdatedText(account, now, disconnected || account.status === 'stale'), account.detail, disconnected ? 'Disconnected · last known usage' : ''].filter(Boolean).join('\n');
    return { label, metrics, states, detail };
  });
}

const mounted = new WeakMap(), preference = 'ai-control-usage-expanded';
const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text != null) element.textContent = text; return element; };
function storage(options) { try { return options.storage ?? globalThis.localStorage; } catch { return null; } }

// Keep the native disclosure and its summary mounted. Full panels update only
// when they contain no focused control, so polling cannot interrupt a budget edit.
export function renderUsageSummary(container, accounts, options, renderDetails) {
  let state = mounted.get(container);
  if (!state) {
    const disclosure = node('details', 'usage-disclosure'), summary = node('summary', 'usage-summary'), content = node('div', 'usage-expanded');
    try { disclosure.open = storage(options)?.getItem(preference) === 'true'; } catch {}
    disclosure.append(summary, content); container.replaceChildren(disclosure);
    state = { disclosure, summary, content }; mounted.set(container, state);
    disclosure.addEventListener('toggle', () => { try { storage(state.options)?.setItem(preference, String(disclosure.open)); } catch {} });
    content.addEventListener('focusout', () => setTimeout(() => { if (content.isConnected && state.dirty) state.refreshDetails(); }, 0));
    state.refreshDetails = () => {
      if (content.contains(document.activeElement) || document.querySelector('.budget-dialog[open]')) return;
      const editBudget = state.options.editBudget && (account => {
        const latest = state.accounts?.find(current => accountKey(current) === accountKey(account));
        if (latest) state.options.editBudget(latest);
      });
      content.replaceChildren(state.renderDetails(state.accounts, { ...state.options, editBudget }));
      state.dirty = false;
    };
  }
  state.accounts = accounts; state.options = options; state.renderDetails = renderDetails; state.dirty = true;
  const summaries = usageSummary(accounts, options);
  const items = summaries.map(view => {
    const item = node('span', 'usage-summary-account'); item.title = view.detail;
    item.append(node('span', 'usage-summary-name', view.label));
    for (const metric of view.metrics) {
      const value = node('span', `usage-summary-metric ${metric.tone}`);
      value.append(node('span', 'usage-summary-period', metric.label), node('strong', '', metric.value)); item.append(value);
    }
    for (const status of view.states) item.append(node('span', 'usage-summary-state', status));
    return item;
  });
  state.summary.replaceChildren(...items);
  state.summary.setAttribute('aria-label', `Usage and spending: ${summaries.map(view => [view.label, ...view.metrics.map(metric => `${metric.label} ${metric.value}`), ...view.states].join(', ')).join('; ')}`);
  state.refreshDetails();
}
