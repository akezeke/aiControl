import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { weeklyUsage } from '../server/opencode-data.mjs';
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

test('weekly budgets persist, validate input, and can be removed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'spend-budget-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'budget.json'), budget = await new SpendBudget(file).load(); assert.equal(budget.weeklyUSD, null);
  await budget.save(50); assert.equal((await new SpendBudget(file).load()).weeklyUSD, 50);
  for (const value of [0, -1, '50', undefined, NaN, Infinity, 1.001, 1000001]) assert.throws(() => budget.save(value), /weekly budget/);
  assert.equal(budget.weeklyUSD, 50); await budget.save(null); assert.equal((await new SpendBudget(file).load()).weeklyUSD, null);
});
