import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { weeklyUsage, budgetCycle, budgetUsage } from '../server/opencode-data.mjs';
import { SpendBudget } from '../server/spend-budget.mjs';

test('weekly usage starts Monday, crosses month boundaries, and excludes future costs', () => {
  const date = (month, day, hour = 12) => new Date(2026, month - 1, day, hour).getTime();
  const week = weeklyUsage([{ at: date(10, 25), usd: 99 }, { at: date(10, 26), usd: 10, input: 100 }, { at: date(10, 31), usd: 5, cacheRead: 200 }, { at: date(11, 1), usd: 2, output: 20 }, { at: date(11, 1, 23), usd: 99 }, { at: date(11, 2), usd: 99 }], date(11, 1));
  assert.equal(week.from, date(10, 26, 0)); assert.equal(week.resetsAt, date(11, 2, 0));
  assert.equal(week.usd, 17); assert.equal(week.days.length, 7); assert.equal(week.days[0].input, 100); assert.equal(week.days[6].output, 20);
  assert.deepEqual(week.days.map(day => day.usd), [10, 0, 0, 0, 0, 5, 2]);
  const monday = weeklyUsage([{ at: date(11, 1), usd: 10 }], date(11, 2)); assert.equal(monday.usd, 0);
});

test('weekly unknown costs remain incomplete and zero-cost tokens still count', () => {
  const now = Date.now(), week = weeklyUsage([{ at: now, usd: null, input: 200 }, { at: now, usd: 0, output: 100 }], now);
  assert.equal(week.usd, 0); assert.equal(week.incomplete, true); assert.equal(week.input, 200); assert.equal(week.output, 100);
});

test('budgets persist, validate input, and can be removed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'spend-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'budget.json'), budget = await new SpendBudget(file).load(); assert.equal(budget.value.usd, null);
  await budget.save({ mode: 'monthly', usd: 200, day: 7 }); assert.deepEqual((await new SpendBudget(file).load()).value, { mode: 'monthly', usd: 200, day: 7 });
  for (const usd of [0, -1, '50', undefined, NaN, Infinity, 1.001, 1000001]) assert.throws(() => budget.save({ mode: 'weekly', usd, day: 7 }), /weekly budget/);
  for (const day of [0, 32, 1.5, '7', undefined]) assert.throws(() => budget.save({ mode: 'monthly', usd: 50, day }), /reset day/);
  for (const mode of ['daily', undefined]) assert.throws(() => budget.save({ mode, usd: 50, day: 7 }), /weekly or monthly/);
  assert.equal(budget.value.usd, 200); await budget.save({ mode: 'monthly', usd: null, day: 7 }); assert.equal((await new SpendBudget(file).load()).value.usd, null);
});

test('weekly-only budget files still load', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'spend-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'budget.json'); await writeFile(file, '{"weeklyUSD":50}');
  assert.deepEqual((await new SpendBudget(file).load()).value, { mode: 'weekly', usd: 50, day: 7 });
});

test('monthly cycles reset on the chosen day and clamp to short months', () => {
  const date = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime(), budget = day => ({ mode: 'monthly', day });
  assert.deepEqual(budgetCycle(budget(7), date(2026, 11, 2)), { from: date(2026, 10, 7, 0), resetsAt: date(2026, 11, 7, 0) });
  assert.deepEqual(budgetCycle(budget(7), date(2026, 11, 7, 0)), { from: date(2026, 11, 7, 0), resetsAt: date(2026, 12, 7, 0) });
  assert.deepEqual(budgetCycle(budget(7), date(2026, 12, 31)), { from: date(2026, 12, 7, 0), resetsAt: date(2027, 1, 7, 0) });
  assert.deepEqual(budgetCycle(budget(7), date(2026, 1, 3)), { from: date(2025, 12, 7, 0), resetsAt: date(2026, 1, 7, 0) });
  assert.deepEqual(budgetCycle(budget(31), date(2026, 3, 15)), { from: date(2026, 2, 28, 0), resetsAt: date(2026, 3, 31, 0) });
  assert.deepEqual(budgetCycle({ mode: 'weekly' }, date(2026, 11, 1)), { from: date(2026, 10, 26, 0), resetsAt: date(2026, 11, 2, 0) });
  const cycle = budgetCycle(budget(7), date(2026, 11, 2)), now = date(2026, 11, 2);
  assert.deepEqual(budgetUsage([{ at: date(2026, 10, 6), usd: 99 }, { at: date(2026, 10, 7, 0), usd: 4 }, { at: date(2026, 11, 1), usd: 6 }, { at: date(2026, 11, 3), usd: 99 }, { at: date(2026, 11, 1), usd: null }], cycle, now), { usd: 10, incomplete: true });
});
