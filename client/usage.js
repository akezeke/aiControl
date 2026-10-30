import './usage.css';
import { usageWindowView, usageUpdatedText } from './usage-presentation.js';
import { renderPower } from './theme-console.js';
import { providerIcon } from './provider-icons.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag); element.className = className;
  if (text != null) element.textContent = text;
  return element;
};

export function renderUsage(container, accounts, { now = Date.now(), disconnected = false } = {}) {
  const rows = node('div', 'usage-accounts');
  // With several Claude accounts every row gets a label column, empty for the default one, so meters stay aligned.
  const labelled = accounts?.some(account => account.label);
  if (!accounts) {
    rows.append(node('span', 'usage-note', 'Usage unavailable · restart server'));
  }
  for (const account of accounts || []) {
    const stale = disconnected || account.status === 'stale';
    const row = node('article', `usage-account${stale ? ' usage-stale' : ''}`);
    row.dataset.usageProvider = account.provider;
    row.setAttribute('aria-label', account.name);
    const detail = disconnected ? 'Disconnected · last known usage' : account.detail;
    const updated = usageUpdatedText(account, now, stale);
    const mark = node('span', `usage-logo ${account.provider}`); mark.append(providerIcon(account.provider));
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', `${account.name} · ${updated}${detail ? ` · ${detail}` : ''}`);
    mark.title = `${account.name} · ${updated}${account.updatedAt ? `\n${new Date(account.updatedAt).toLocaleString()}` : ''}${detail ? `\n${detail}` : ''}`;
    row.append(mark);
    if (labelled) { const tag = node('span', 'usage-tag', account.label || ''); tag.title = account.name; row.append(tag); }
    const windows = node('div', 'usage-windows');
    for (const window of account.windows || []) {
      const view = usageWindowView(window, now);
      const cell = node('div', `usage-window ${view.tone}${view.expired ? ' usage-expired' : ''}${window.scope || view.shortLabel.length > 3 ? ' usage-wide' : ''}${view.pace >= 100 && window.usedPercent < 100 ? ' usage-pace' : ''}`);
      const label = `${window.label}${window.scope ? ` · ${window.scope}` : ''}`;
      const shortLabel = node('span', 'usage-label', `${view.shortLabel}${window.scope ? `·${window.scope}` : ''}`);
      shortLabel.title = label;
      const meter = node('progress', 'usage-meter'); meter.max = 100; meter.value = view.barPercent;
      meter.setAttribute('aria-label', `${account.name}, ${label}: ${view.percentText} used${stale || view.expired ? ', last known' : ''}`);
      const reset = node('span', 'usage-reset', view.resetShortText);
      reset.setAttribute('aria-label', view.resetText);
      reset.title = `${view.resetText}${window.resetsAt ? `\n${new Date(window.resetsAt).toLocaleString()}` : ''}`;
      const percent = node('strong', 'usage-percent', view.percentText); percent.title = view.paceText;
      // The dungeon HUD uses liquid globes on desktop and phones. Keep the native
      // progress element as its accessible equivalent and the full usage elsewhere.
      const orb = node('span', 'usage-orb'); orb.setAttribute('aria-hidden', 'true');
      const remaining = Math.max(0, 100 - view.barPercent);
      orb.style.setProperty('--remaining', String(remaining / 100));
      orb.title = `${account.name}, ${label}: ${view.percentText} used · ${Math.round(remaining)}% left${stale || view.expired ? ' (last known)' : ''}`;
      orb.append(node('i', 'orb-liquid'), node('strong', 'orb-value', `${Math.round(remaining)}%`), node('span', 'orb-caption', 'left'));
      cell.append(shortLabel, meter, percent, orb, reset); windows.append(cell);
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
