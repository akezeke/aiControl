import './spend.css';
import { costPeriodView, spendView } from './usage-presentation.js';
import { spendArt } from './spend-art.js';
const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text != null) el.textContent = text; return el; };
const money = value => costPeriodView({ usd: value }).cost;
const compact = value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export function renderSpend(account, { editBudget, now = Date.now() } = {}) {
  const panel = node('div', 'spend-panel'), totals = node('div', 'spend-totals');
  const heading = node('div', 'spend-heading'); heading.append(node('span', 'spend-provider', 'OpenCode'), node('span', 'spend-theme-name')); panel.append(heading);
  for (const period of account.periods) {
    const value = node('div', 'spend-total'); value.title = costPeriodView(period).detail;
    value.append(node('span', 'spend-caption', period.label), node('strong', '', money(period.usd))); totals.append(value);
  }
  const week = account.week;
  if (!week) { panel.append(totals); return panel; }
  const chart = node('div', 'spend-chart'), bars = node('div', 'spend-bars');
  chart.append(node('span', 'spend-caption', 'This week'));
  const peak = Math.max(...week.days.map(day => day.usd), .00001);
  for (const day of week.days) {
    const column = node('span', `spend-day${day.at > now ? ' spend-future' : ''}${day.usd ? '' : ' spend-empty'}`), bar = node('i', 'spend-bar');
    const date = new Date(day.at), label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    column.title = `${label}: ${day.at > now ? 'Upcoming' : money(day.usd)}${day.incomplete ? ' · incomplete' : ''}`;
    column.setAttribute('aria-label', column.title); bar.style.setProperty('--height', `${day.usd ? Math.max(6, day.usd / peak * 100) : 0}%`);
    column.append(bar, node('span', '', date.toLocaleDateString(undefined, { weekday: 'narrow' }))); bars.append(column);
  }
  chart.append(bars); panel.append(totals, chart);
  const cycle = account.budget, unit = cycle?.mode === 'monthly' ? 'month' : 'week', limit = cycle?.usd, spent = cycle?.spent ?? week.usd, over = limit && spent > limit, remaining = limit ? Math.max(0, limit - spent) : null;
  const resets = new Date(cycle?.resetsAt ?? week.resetsAt), resetDate = resets.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const budget = node('button', `spend-budget${over ? ' over' : limit && spent >= limit * .8 ? ' near' : ''}`); budget.type = 'button'; budget.disabled = !editBudget;
  budget.title = `Edit ${unit}ly budget · resets ${resets.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}\nRecorded OpenCode costs only; tracking does not stop provider spending.${week.incomplete || account.status === 'partial' ? '\nSome costs are unavailable; remaining is an estimate.' : ''}`;
  const ring = spendArt();
  const balance = node('span', 'spend-balance'); balance.append(node('span', 'spend-caption', over ? 'Over budget' : limit ? 'Remaining' : `${unit === 'month' ? 'Monthly' : 'Weekly'} spend`), node('strong', '', money(over ? spent - limit : remaining ?? spent)), node('span', 'spend-limit', limit ? `$${limit.toLocaleString()} / ${unit} · resets ${resetDate}` : 'Set budget ↗'));
  budget.setAttribute('aria-label', limit ? `${unit === 'month' ? 'Monthly' : 'Weekly'} budget $${limit}; ${money(spent)} spent; ${over ? money(spent - limit) + ' over' : money(remaining) + ' remaining'}; resets ${resetDate}. Edit budget.` : `Set ${unit}ly budget`);
  budget.onclick = () => editBudget?.(account); budget.append(ring, balance); panel.append(budget);
  if (limit) {
    const reserve = node('div', `spend-reserve${over ? ' over' : spent >= limit * .8 ? ' near' : ''}`), fill = node('i', 'spend-reserve-fill');
    fill.style.width = `${Math.max(0, (limit - spent) / limit * 100)}%`; reserve.append(fill);
    reserve.setAttribute('role', 'meter'); reserve.setAttribute('aria-label', `${unit === 'month' ? 'Monthly' : 'Weekly'} budget remaining`); reserve.setAttribute('aria-valuemin', '0'); reserve.setAttribute('aria-valuemax', String(limit)); reserve.setAttribute('aria-valuenow', String(Math.max(0, limit - spent))); reserve.setAttribute('aria-valuetext', `${money(Math.max(0, limit - spent))} remaining of $${limit}`);
    reserve.title = `${money(spent)} spent of $${limit} this ${unit}`; panel.append(reserve);
  }
  const mix = node('div', 'spend-mix'), rail = node('span', 'spend-token-rail');
  const segments = [['Input', week.input, 'input'], ['Output', week.output, 'output'], ['Cache', week.cacheRead + week.cacheWrite, 'cache']];
  const total = segments.reduce((sum, [, value]) => sum + value, 0);
  for (const [label, value, kind] of segments) {
    const segment = node('i', `spend-token ${kind}`); segment.style.width = `${total ? value / total * 100 : 0}%`; rail.append(segment);
    segment.title = `${label}: ${value.toLocaleString()} tokens`;
  }
  const legend = node('span', 'spend-token-label', `${compact(total)} tokens`);
  mix.title = segments.map(([label, value]) => `${label}: ${value.toLocaleString()}`).join(' · ') + ' tokens this week';
  mix.setAttribute('aria-label', mix.title); mix.append(rail, legend);
  if (total) mix.append(node('span', 'spend-cache', `${Math.round((week.cacheRead + week.cacheWrite) / total * 100)}% cache`));
  panel.append(mix); return panel;
}

// The same spend as one gauge in a row of limits, for a bar with no room for the panel: the budget used, what's spent, and when it resets.
export function renderSpendRow(account, { editBudget, now = Date.now() } = {}) {
  const view = spendView(account, now), tone = view.over ? ' usage-full' : view.near ? ' usage-high' : '';
  const row = node('button', `usage-window spend-row${view.limit ? '' : ' spend-bare'}${tone}`); row.type = 'button'; row.disabled = !editBudget;
  row.title = `${view.detail}${editBudget ? '\nClick to edit the budget' : ''}`;
  row.setAttribute('aria-label', `OpenCode ${view.text}${view.over ? ', over budget' : ''}${view.partial ? ', some costs unavailable' : ''}${editBudget ? '. Edit budget.' : ''}`);
  const label = node('span', 'usage-label', view.unit === 'month' ? 'mo' : 'wk');
  const meter = node('progress', 'usage-meter'); meter.max = 100; meter.value = Math.min(100, view.usedPercent ?? 0); meter.hidden = view.limit == null;
  meter.setAttribute('aria-hidden', 'true');
  row.append(label, meter, node('strong', 'usage-percent', view.money(view.spent)));
  if (view.limit) row.append(node('span', 'usage-reset', view.resetShort));
  row.onclick = () => editBudget?.(account);
  return row;
}

export function budgetDialog(account, save) {
  const dialog = node('dialog', 'new-session-dialog budget-dialog'), form = node('form', 'new-session-form');
  dialog.setAttribute('aria-label', 'OpenCode budget');
  const saved = account.budget || {};
  const title = node('h2', '', 'Budget'), modeLabel = node('label', '', 'Mode'), mode = node('select');
  for (const [value, text] of [['weekly', 'Weekly · resets Monday'], ['monthly', 'Monthly']]) { const option = node('option', '', text); option.value = value; mode.append(option); }
  mode.value = saved.mode === 'monthly' ? 'monthly' : 'weekly'; modeLabel.append(mode);
  const label = node('label', ''), caption = document.createTextNode(''), input = node('input');
  input.type = 'number'; input.min = '1'; input.max = '1000000'; input.step = '.01'; input.inputMode = 'decimal'; input.required = true; input.value = saved.usd ?? '';
  label.append(caption, input);
  const dayLabel = node('label', '', 'Resets on day'), day = node('input');
  day.type = 'number'; day.min = '1'; day.max = '31'; day.step = '1'; day.inputMode = 'numeric'; day.value = saved.day ?? 7; dayLabel.append(day);
  const sync = () => { const monthly = mode.value === 'monthly'; caption.data = monthly ? 'USD / month' : 'USD / week'; dayLabel.hidden = !monthly; day.required = monthly; };
  mode.onchange = sync; sync();
  const error = node('div', 'form-error'); error.setAttribute('role', 'alert');
  const buttons = node('div', 'budget-actions'), cancel = node('button', 'quiet-button', 'Cancel'), clear = node('button', 'quiet-button', 'Remove'), submit = node('button', 'primary', 'Save');
  cancel.type = clear.type = 'button'; submit.type = 'submit'; clear.hidden = !saved.usd;
  cancel.onclick = () => dialog.close();
  const fields = [mode, input, day];
  const apply = async usd => {
    for (const el of [...fields, submit, clear]) el.disabled = true; error.textContent = '';
    try { await save({ mode: mode.value, usd, day: Number(day.value) || saved.day || 7 }); dialog.close(); }
    catch (e) { error.textContent = e.message; }
    finally { for (const el of [...fields, submit, clear]) el.disabled = false; }
  };
  form.onsubmit = event => { event.preventDefault(); if (!submit.disabled && form.reportValidity()) apply(input.valueAsNumber); };
  clear.onclick = () => apply(null);
  buttons.append(clear, cancel, submit); form.append(title, modeLabel, label, dayLabel, error, buttons); dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); input.focus(); input.select();
}
