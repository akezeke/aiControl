import './spend.css';
import { costPeriodView } from './usage-presentation.js';
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
  const limit = account.budget?.weeklyUSD, spent = week.usd, over = limit && spent > limit, remaining = limit ? Math.max(0, limit - spent) : null;
  const budget = node('button', `spend-budget${over ? ' over' : limit && spent >= limit * .8 ? ' near' : ''}`); budget.type = 'button'; budget.disabled = !editBudget;
  budget.title = `Edit weekly budget · resets ${new Date(week.resetsAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}\nRecorded OpenCode costs only; tracking does not stop provider spending.${week.incomplete || account.status === 'partial' ? '\nSome costs are unavailable; remaining is an estimate.' : ''}`;
  const ring = spendArt();
  const balance = node('span', 'spend-balance'); balance.append(node('span', 'spend-caption', over ? 'Over budget' : limit ? 'Remaining' : 'Weekly spend'), node('strong', '', money(over ? spent - limit : remaining ?? spent)), node('span', 'spend-limit', limit ? `$${limit.toLocaleString()} / week · edit` : 'Set budget ↗'));
  budget.setAttribute('aria-label', limit ? `Weekly budget $${limit}; ${money(spent)} spent; ${over ? money(spent - limit) + ' over' : money(remaining) + ' remaining'}. Edit budget.` : 'Set weekly budget');
  budget.onclick = () => editBudget?.(account); budget.append(ring, balance); panel.append(budget);
  if (limit) {
    const reserve = node('div', `spend-reserve${over ? ' over' : spent >= limit * .8 ? ' near' : ''}`), fill = node('i', 'spend-reserve-fill');
    fill.style.width = `${Math.max(0, (limit - spent) / limit * 100)}%`; reserve.append(fill);
    reserve.setAttribute('role', 'meter'); reserve.setAttribute('aria-label', 'Weekly budget remaining'); reserve.setAttribute('aria-valuemin', '0'); reserve.setAttribute('aria-valuemax', String(limit)); reserve.setAttribute('aria-valuenow', String(Math.max(0, limit - spent))); reserve.setAttribute('aria-valuetext', `${money(Math.max(0, limit - spent))} remaining of $${limit}`);
    reserve.title = `${money(spent)} spent of $${limit} this week`; panel.append(reserve);
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

export function budgetDialog(account, save) {
  const dialog = node('dialog', 'new-session-dialog budget-dialog'), form = node('form', 'new-session-form');
  dialog.setAttribute('aria-label', 'OpenCode weekly budget');
  const title = node('h2', '', 'Weekly budget'), label = node('label', '', 'USD / week'), input = node('input');
  input.type = 'number'; input.min = '1'; input.max = '1000000'; input.step = '.01'; input.inputMode = 'decimal'; input.required = true; input.value = account.budget?.weeklyUSD ?? '';
  label.append(input);
  const error = node('div', 'form-error'); error.setAttribute('role', 'alert');
  const buttons = node('div', 'budget-actions'), cancel = node('button', 'quiet-button', 'Cancel'), clear = node('button', 'quiet-button', 'Remove'), submit = node('button', 'primary', 'Save');
  cancel.type = clear.type = 'button'; submit.type = 'submit'; clear.hidden = !account.budget?.weeklyUSD;
  cancel.onclick = () => dialog.close();
  const apply = async value => {
    input.disabled = submit.disabled = clear.disabled = true; error.textContent = '';
    try { await save(value); dialog.close(); }
    catch (e) { error.textContent = e.message; }
    finally { input.disabled = submit.disabled = clear.disabled = false; }
  };
  form.onsubmit = event => { event.preventDefault(); if (!submit.disabled && form.reportValidity()) apply(input.valueAsNumber); };
  clear.onclick = () => apply(null);
  buttons.append(clear, cancel, submit); form.append(title, label, error, buttons); dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); input.focus(); input.select();
}
