import test from 'node:test';
import assert from 'node:assert/strict';
import { usageSummary, renderUsageSummary } from '../client/usage-summary.js';

const now = 1_800_000_000_000;
const account = { provider: 'claude', name: 'Claude · Work', label: 'Work', status: 'ready', updatedAt: now, windows: [{ label: '5-hour', usedPercent: 37, resetsAt: now + 60_000 }, { label: 'Weekly', usedPercent: 82, resetsAt: now + 86_400_000 }] };

test('usage summary keeps account labels and both limits, including a real zero', () => {
  const [view] = usageSummary([{ ...account, windows: [...account.windows, { label: 'Weekly', scope: 'Sonnet', usedPercent: 0 }] }], { now });
  assert.equal(view.label, 'Claude · Work');
  assert.deepEqual(view.metrics.map(({ label, value }) => [label, value]), [['5h', '37%'], ['w', '82%'], ['w·Sonnet', '0%']]);
  assert.equal(view.metrics[1].tone, 'usage-high');
  assert.deepEqual(view.states, []);
});

test('missing limits and missing spend never become zero usage', () => {
  assert.match(usageSummary(undefined, { now })[0].states.join(' '), /unavailable/i);
  assert.match(usageSummary([], { now })[0].states.join(' '), /unavailable/i);
  for (const entry of [
    { ...account, windows: [] },
    { ...account, windows: [{ label: '5-hour', usedPercent: null }] },
    { provider: 'opencode', name: 'OpenCode', status: 'ready', periods: [{ id: 'today', label: 'Today', usd: null }] },
  ]) {
    const [view] = usageSummary([entry], { now });
    assert.deepEqual(view.metrics, []);
    assert.match(view.states.join(' '), /unavailable/i);
  }
});

test('summary exposes loading, partial, stale, expiry and failure states while retaining known values', () => {
  for (const [status, expected] of [['loading', 'Loading…'], ['partial', 'Partial'], ['updating', 'Updating…'], ['stale', 'Stale'], ['unavailable', 'Unavailable'], ['error', 'Error']]) {
    const [view] = usageSummary([{ ...account, status, detail: 'Provider could not refresh.' }], { now });
    assert.ok(view.states.includes(expected), status);
    assert.equal(view.metrics[0].value, '37%');
    assert.match(view.detail, /Provider could not refresh/);
  }
  const [disconnected] = usageSummary([{ ...account, status: 'partial' }], { now, disconnected: true });
  assert.deepEqual(disconnected.states, ['Disconnected', 'Partial']);
  const [expired] = usageSummary([{ ...account, windows: [{ ...account.windows[0], resetsAt: now - 1 }] }], { now });
  assert.ok(expired.states.includes('Reset due'));
});

test('spend summary distinguishes a monthly budget, incomplete costs and a known daily total', () => {
  const base = { provider: 'opencode', name: 'OpenCode', status: 'ready', periods: [{ id: 'today', label: 'Today', usd: 2.5 }] };
  const [budget] = usageSummary([{ ...base, budget: { mode: 'monthly', usd: 100, spent: 82 }, week: { incomplete: true } }], { now });
  assert.deepEqual(budget.metrics.map(({ label, value }) => [label, value]), [['mo', '≈$82.00 / $100']]);
  assert.equal(budget.metrics[0].tone, 'usage-high');
  assert.ok(budget.states.includes('Partial'));
  const [daily] = usageSummary([base], { now });
  assert.deepEqual(daily.metrics.map(({ label, value }) => [label, value]), [['Today', '≈$2.50']]);
});

// Minimal DOM boundary: replacements clear focus like the browser; keeping an
// old subtree lets us catch a polling render that would remove active controls.
function dom(t) {
  const previous = globalThis.document;
  const document = { activeElement: null, budgetDialog: null, querySelector: () => document.budgetDialog };
  document.createElement = tag => ({
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, listeners: {}, open: false, isConnected: true,
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } },
    replaceChildren(...children) { if (this.children.some(child => child.contains(document.activeElement))) document.activeElement = null; this.children = []; this.append(...children); },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    focus() { document.activeElement = this; },
    get textContent() { return this.text || this.children.map(child => child.textContent).join(''); },
    set textContent(text) { this.text = text; this.children = []; },
  });
  globalThis.document = document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  return document;
}

test('polling preserves the disclosure and focused budget, then refreshes after focus leaves', async t => {
  const document = dom(t), values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const container = document.createElement('section');
  const renderDetails = accounts => { const body = document.createElement('div'), button = document.createElement('button'); button.textContent = accounts[0].windows[0].usedPercent; body.append(button); return body; };
  renderUsageSummary(container, [account], { now, storage }, renderDetails);
  const disclosure = container.children[0], [summary, content] = disclosure.children;
  assert.equal(disclosure.open, false);
  disclosure.open = true; disclosure.listeners.toggle();
  const button = content.children[0].children[0]; button.focus();
  renderUsageSummary(container, [{ ...account, windows: [{ ...account.windows[0], usedPercent: 50 }] }], { now, storage }, renderDetails);
  assert.equal(container.children[0], disclosure);
  assert.equal(disclosure.open, true);
  assert.equal(document.activeElement, button);
  assert.match(String(summary.textContent), /50%/);
  summary.focus(); content.listeners.focusout();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(content.children[0].children[0].textContent, 50);
  assert.equal(document.activeElement, summary);
  const second = document.createElement('section'); renderUsageSummary(second, [account], { now, storage }, renderDetails);
  assert.equal(second.children[0].open, true, 'expanded preference survives remount');
});

test('blocked storage does not prevent expanding usage or rendering updates', t => {
  const document = dom(t), container = document.createElement('section');
  const storage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.doesNotThrow(() => {
    renderUsageSummary(container, [account], { now, storage }, () => document.createElement('div'));
    container.children[0].open = true; container.children[0].listeners.toggle();
    renderUsageSummary(container, [account], { now, storage }, () => document.createElement('div'));
  });
  assert.equal(container.children[0].open, true);
});

test('polling keeps a budget dialog’s return target and an active control uses the latest account', t => {
  const document = dom(t), container = document.createElement('section'), edited = [];
  const renderDetails = (accounts, { editBudget }) => {
    const button = document.createElement('button'); button.onclick = () => editBudget(accounts[0]); return button;
  };
  const options = { now, editBudget: account => edited.push(account), storage: {} };
  renderUsageSummary(container, [account], options, renderDetails);
  const content = container.children[0].children[1], button = content.children[0]; button.focus();
  const current = { ...account, windows: [{ ...account.windows[0], usedPercent: 75 }] };
  renderUsageSummary(container, [current], options, renderDetails);
  button.onclick(); assert.equal(edited[0], current, 'budget editing uses current data even when its button is retained');
  document.budgetDialog = document.createElement('dialog'); document.budgetDialog.focus();
  renderUsageSummary(container, [current], options, renderDetails);
  assert.equal(content.children[0], button, 'the dialog can restore focus to its original trigger');
  assert.equal(document.activeElement, document.budgetDialog);
});
