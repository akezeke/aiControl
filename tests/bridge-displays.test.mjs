import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentFacts, agentLayout, fitText, shotUnder, stationName, limitGroups, visibleLimits, spendRows, wrapLines } from '../client/bridge/displays.js';
import { SIGNALS } from '../client/bridge/palettes.js';

const measure = text => [...text].length * 10;
test('short text is untouched', () => assert.equal(fitText('short', 100, measure), 'short'));
test('long text is cut with an ellipsis and fits', () => {
  const out = fitText('x'.repeat(200), 100, measure);
  assert.ok(out.endsWith('…') && measure(out) <= 100);
});
test('emoji are not split', () => {
  const out = fitText('🚀'.repeat(50), 100, measure);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out));
});
test('nothing fits', () => assert.equal(fitText('hello', 0, measure), ''));
test('a session always has a name', () => {
  assert.ok(stationName({ id: 'abc', title: '', project: 'site' }));
  assert.ok(stationName({ id: 'abc' }));
});
test('missing and multi-line text', () => {
  assert.equal(fitText(null, 100, measure), '');
  assert.equal(fitText('a\n  b', 100, measure), 'a b');
});
test('limits that fit stay in order, and otherwise the fullest are kept', () => {
  const rows = [10, 90, 50, 70, 20, 30].map(used => ({ used }));
  assert.deepEqual(visibleLimits(rows.slice(0, 3), 5), rows.slice(0, 3));
  assert.deepEqual(visibleLimits(rows, 5).map(row => row.used), [90, 70, 50, 30, 20]);
});
const messages = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map(text => ({ role: 'assistant', text }));
const session = { id: 'a', status: 'working', provider: 'claude', project: 'site', title: 'x', detail: 'Editing', cost: { usd: 2 }, model: 'claude-opus-5-5', effort: 'high', context: { used: 72000 }, messages, plan: [{ step: 'Sand', status: 'done' }, { step: 'Paint', status: 'active' }, { step: 'Dry', status: 'pending' }] };
const size = text => [...text].length * 50, layout = (s = session, ...rest) => agentLayout(agentFacts(s, ...rest), 1024, 1054, size);
test('long titles fit in two lines', () => {
  const lines = wrapLines('word '.repeat(60), 960, 2, size);
  assert.equal(lines.length, 2); assert.ok(lines.every(line => size(line) <= 960)); assert.ok(lines[1].endsWith('…'));
});
test('one long word fits', () => assert.ok(wrapLines('x'.repeat(200), 960, 2, size).every(line => size(line) <= 960)));
test('emoji aren\'t split and nothing odd comes of odd text', () => {
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(wrapLines('🚀'.repeat(80), 960, 2, size).join('')));
  assert.deepEqual(wrapLines('a\n  b', 960, 2, size), ['a b']);
  assert.deepEqual(wrapLines('', 960, 2, size), ['']);
});
test('each signal gets its band colour', () => {
  for (const [status, colour] of [['working', SIGNALS.working], ['idle', SIGNALS.idle], ['question', SIGNALS.need]])
    assert.equal(layout({ ...session, status }).band.colour, colour);
  assert.equal(layout({ ...session, status: 'question' }, false, true).band.colour, SIGNALS.idle);
});
test('the feed is the latest messages, newest last', () => {
  const { feed } = layout();
  assert.equal(feed.at(-1).text, 'eight'); assert.ok(feed.length >= 3); assert.ok(feed.every(line => line.kind === 'assistant'));
});
test('it says what it\'s doing with no messages yet', () => assert.deepEqual(layout({ ...session, messages: [] }).feed.map(line => line.text), ['Editing']));
test('a tool\'s line is marked, and a huge one stays one line', () => {
  const { feed } = layout({ ...session, messages: [{ tool: 'Bash', text: 'y'.repeat(5000) }] });
  assert.equal(feed[0].kind, 'tool'); assert.ok(size(feed[0].text) <= 960);
});
test('it asks when waiting', () => assert.equal(layout({ ...session, status: 'question', requests: [{ title: 'Keep it?' }] }).request, 'Keep it?'));
test('nothing to ask when working', () => assert.equal(layout().request, null));
test('progress names the current step', () => {
  assert.deepEqual(layout().progress, { done: 1, total: 3, statuses: ['done', 'active', 'pending'], current: 'Paint' });
  assert.equal(layout({ ...session, plan: [{ step: 'Sand', status: 'done' }] }).progress.current, 'All steps done');
});
test('without a plan, the feed has more room', () => {
  assert.equal(layout({ ...session, plan: undefined }).progress, null);
  assert.ok(layout({ ...session, plan: undefined }).feed.length > layout().feed.length);
});
test('the strip holds context, cost, model and helpers, and the dot is unread', () => {
  const out = layout(session, true, false, 2);
  assert.deepEqual(out.strip, ['72K', '$2.00', 'opus-5-5 · high', '2 HELPERS']); assert.equal(out.dot, true);
  assert.deepEqual(layout().strip, ['72K', '$2.00', 'opus-5-5 · high']);
});
test('a session with nothing to say still lays out', () => {
  const out = layout({ id: 'b', status: 'idle' });
  assert.deepEqual(out.feed, []); assert.equal(out.progress, null); assert.deepEqual(out.title, ['Session']);
});
const shot = { key: 1, width: 1600, height: 900, count: 3 }, shown = (s = session, picture = shot, measure = size) => agentLayout(agentFacts(s, false, false, 0, picture), 1024, 1054, measure);
test('a display without a screenshot keeps its text as it was', () => {
  const out = agentLayout(agentFacts({ ...session, title: 'word '.repeat(60) }, false, false, 0, null), 1024, 1054, size);
  assert.equal(out.shot, null); assert.equal(out.title.length, 2); assert.ok(out.feed.length > 2);
});
test('a screenshot takes the room of the older lines, leaving the title, the latest lines and the progress', () => {
  const out = shown({ ...session, title: 'word '.repeat(60) });
  assert.equal(out.title.length, 1); assert.equal(out.feed.length, 2); assert.equal(out.feed.at(-1).text, layout().feed.at(-1).text); assert.ok(out.progress); assert.equal(out.shot.count, 3);
});
test('a screenshot sits below the text and above the progress, its shape kept and as large as fits', () => {
  const { shot: { box, rect } } = shown(), textEnd = 110 + 16 + 128 + 2 * 88, progressTop = 1054 - 70 - 130;
  assert.ok(box.y >= textEnd); assert.ok(box.y + box.h <= progressTop); assert.ok(box.h > 300);
  assert.ok(rect.x >= box.x && rect.y >= box.y && rect.x + rect.w <= box.x + box.w + 1e-6 && rect.y + rect.h <= box.y + box.h + 1e-6);
  assert.ok(Math.abs(rect.w / rect.h - 16 / 9) < 1e-6); assert.ok(Math.abs(rect.h - box.h) < 1e-6 || Math.abs(rect.w - box.w) < 1e-6);
});
test('a tall screenshot stays in the middle, and one with no size can\'t break the layout', () => {
  const { shot: { box, rect } } = shown(session, { ...shot, width: 400, height: 1600 });
  assert.ok(Math.abs(rect.x + rect.w / 2 - (box.x + box.w / 2)) < 1e-6); assert.ok(Math.abs(rect.w / rect.h - .25) < 1e-6);
  const empty = shown(session, { ...shot, width: 0, height: 0 });
  assert.ok(Number.isFinite(empty.shot.rect.w) && Number.isFinite(empty.shot.rect.h));
});
test('someone waiting keeps what they ask above a screenshot', () => {
  const out = shown({ ...session, status: 'question', requests: [{ title: 'Keep the schema?' }] });
  assert.equal(out.request, 'Keep the schema?'); assert.ok(out.shot.box.y >= 110 + 16 + 128 + 88); assert.ok(out.shot.box.h > 200);
});
test('a point on a display is on its screenshot only inside the picture', () => {
  const { shot: { rect } } = shown(), at = (x, y) => shotUnder(rect, x / 1024, 1 - y / 1054, 1024, 1054);
  assert.equal(at(rect.x + rect.w / 2, rect.y + rect.h / 2), true);
  assert.equal(at(rect.x + rect.w / 2, rect.y - 5), false); assert.equal(at(rect.x + rect.w / 2, rect.y + rect.h + 5), false);
  assert.equal(shotUnder(null, .5, .5, 1024, 1054), false);
});
test('an account is named once, with its windows under it', () => {
  const rows = [{ name: 'MAX', window: '5H' }, { name: 'MAX', window: 'W' }, { name: 'PRO', window: '5H' }];
  assert.deepEqual(limitGroups(rows).map(group => [group.name, group.rows.map(row => row.window)]), [['MAX', ['5H', 'W']], ['PRO', ['5H']]]);
});
test('two accounts with the same name stay apart', () => {
  const rows = [{ name: 'MAX', window: '5H' }, { name: 'MAX', window: 'W' }, { name: 'MAX', window: '5H' }];
  assert.deepEqual(limitGroups(rows).map(group => group.rows.length), [2, 1]);
});
test('an account stays together when the fullest limits were picked out of order', () => {
  const rows = [{ name: 'MAX', window: 'W' }, { name: 'PRO', window: '5H' }, { name: 'MAX', window: '5H' }];
  assert.deepEqual(limitGroups(rows).map(group => group.name), ['MAX', 'PRO']);
  assert.equal(limitGroups(rows)[0].rows.length, 2);
});

test('OpenCode spend is a row of its own that never reads as a hard limit', () => {
  const now = Date.UTC(2026, 10, 4, 12), account = (budget, spent) => ({ provider: 'opencode', periods: [{ id: 'today', usd: 2.41 }], week: { usd: spent }, budget: { mode: 'weekly', ...budget, spent, resetsAt: now + 3 * 86_400_000 } });
  assert.deepEqual(spendRows([{ provider: 'claude', windows: [] }, { provider: 'opencode', periods: [] }], now), []);
  const [budgeted] = spendRows([account({ usd: 25 }, 17.42)], now);
  assert.deepEqual([budgeted.window, budgeted.percent, budgeted.bar, budgeted.near, budgeted.full], ['WEEK', '70%', true, false, false]);
  assert.match(budgeted.left, /^\$7\.58 LEFT · 3D$/);
  const [near] = spendRows([account({ usd: 20 }, 17)], now), [over] = spendRows([account({ usd: 10 }, 12.5)], now);
  assert.deepEqual([near.near, near.full, over.near, over.full], [true, false, true, true]);
  assert.match(over.left, /^OVER BY \$2\.50/);
  const [bare] = spendRows([account({}, 4)], now);
  assert.deepEqual([bare.percent, bare.bar, bare.left], ['$4.00', false, 'TODAY $2.41']);
});
