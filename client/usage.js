import './usage.css';
import { usageWindowView, usageUpdatedText } from './usage-presentation.js';
import { renderPower } from './theme-console.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag); element.className = className;
  if (text != null) element.textContent = text;
  return element;
};

export function renderUsage(container, accounts, { now = Date.now(), disconnected = false } = {}) {
  const rows = node('div', 'usage-accounts');
  if (!accounts) {
    rows.append(node('span', 'usage-note', 'Usage unavailable · restart server'));
  }
  for (const account of accounts || []) {
    const stale = disconnected || account.status === 'stale';
    const row = node('article', `usage-account${stale ? ' usage-stale' : ''}`);
    row.setAttribute('aria-label', account.name);
    const detail = disconnected ? 'Disconnected · last known usage' : account.detail;
    const updated = usageUpdatedText(account, now, stale);
    const mark = node('span', `usage-logo ${account.provider}`, account.provider === 'codex' ? '⌘' : '✳');
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', `${account.name} · ${updated}${detail ? ` · ${detail}` : ''}`);
    mark.title = `${account.name} · ${updated}${account.updatedAt ? `\n${new Date(account.updatedAt).toLocaleString()}` : ''}${detail ? `\n${detail}` : ''}`;
    row.append(mark);
    const windows = node('div', 'usage-windows');
    for (const window of account.windows || []) {
      const view = usageWindowView(window, now);
      const cell = node('div', `usage-window ${view.tone}${view.expired ? ' usage-expired' : ''}${window.scope || view.shortLabel.length > 3 ? ' usage-wide' : ''}`);
      const label = `${window.label}${window.scope ? ` · ${window.scope}` : ''}`;
      const shortLabel = node('span', 'usage-label', `${view.shortLabel}${window.scope ? `·${window.scope}` : ''}`);
      shortLabel.title = label;
      const meter = node('progress', 'usage-meter'); meter.max = 100; meter.value = view.barPercent;
      meter.setAttribute('aria-label', `${account.name}, ${label}: ${view.percentText} used${stale || view.expired ? ', last known' : ''}`);
      const reset = node('span', 'usage-reset', view.resetShortText);
      reset.setAttribute('aria-label', view.resetText);
      reset.title = `${view.resetText}${window.resetsAt ? `\n${new Date(window.resetsAt).toLocaleString()}` : ''}`;
      cell.append(shortLabel, meter, node('strong', 'usage-percent', view.percentText), reset); windows.append(cell);
    }
    if (!windows.children.length) {
      const status = node('span', 'usage-note', account.status === 'loading' ? 'Loading…' : 'Unavailable');
      status.title = detail || updated;
      status.setAttribute('aria-label', detail || updated);
      windows.append(status);
    }
    row.append(windows);
    if (stale && account.windows?.length) row.append(node('span', 'usage-state', 'stale'));
    rows.append(row);
  }
  container.replaceChildren(rows);
  renderPower(accounts || []);
}
