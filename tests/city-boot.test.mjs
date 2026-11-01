import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan } from '../client/city/plan.js';
import { powerLines, powerRoutes } from '../client/city/power.js';
import { bareCells, groundCells } from '../client/city/ground.js';
import { BOOT, CityBoot, blockGone, columnRuns } from '../client/city/boot.js';
import { ASK_MS, askForBoot, takeBootAsk } from '../client/city/boot-ask.js';

const pods = [['a', 0, 0], ['b', 1, 0], ['c', 0, 1], ['d', 1, 1], ['e', 2, 2]], ids = pods.flatMap(([key]) => [`${key}1`, `${key}2`]);
const desks = ids.map((id, i) => [id, { podKey: id[0], slot: i % 2, sessionId: id }]);
const layout = { pods: pods.map(([key, col, row]) => ({ key, name: key, cwd: `/${key}`, col, row })), desks: new Map(desks), grid: { cols: 3 } };
const providers = [{ name: 'Claude Code', connected: true }, { name: 'Codex', connected: true }];
const sessions = [...ids.map((id, i) => ({ id, provider: i % 3 ? 'claude' : 'codex' })), { id: 'kid', provider: 'claude', parentId: 'a1' }];
const plan = cityPlan(layout, {}, null, providers, sessions, ['']), routes = powerRoutes(plan, sessions), lines = powerLines(plan);
const fresh = (over = {}) => new CityBoot(over.plan ?? plan, over.routes ?? routes, over.lines ?? lines);
// Run a boot forward as frames would, to `until` on its own clock.
const to = (boot, until, ready = true, from = 1000) => { boot.at ??= from; while (boot.t < until && !boot.over) { boot.at += 16; boot.tick(boot.at, ready); } return boot; };
const startedAt = boot => { const seen = new Map(); while (!boot.over) { boot.at = (boot.at ?? 1000) + 16; boot.tick(boot.at, true); for (const { id } of plan.buildings) if (!seen.has(id) && boot.tower(id).rise > 0) seen.set(id, boot.t); } return seen; };

test('nothing has risen while the title is up', () => {
  const boot = to(fresh(), BOOT.CARD);
  for (const { id } of plan.buildings) assert.equal(boot.tower(id).rise, 0);
});
test('neighbourhoods rise one at a time, starting nearest the plants', () => {
  const seen = startedAt(fresh()), first = new Map();
  for (const { id, hoodKey } of plan.buildings) first.set(hoodKey, Math.min(first.get(hoodKey) ?? Infinity, seen.get(id)));
  const reach = hood => Math.min(...plan.plants.map(plant => Math.abs(hood.x - plant.x) + Math.abs(hood.z - plant.z)));
  const byReach = [...plan.hoods].sort((a, b) => reach(a) - reach(b)).map(hood => hood.key), byRise = [...first].sort((a, b) => a[1] - b[1]).map(([key]) => key);
  assert.deepEqual(byRise, byReach);
  assert.equal(new Set(first.values()).size, first.size, 'no two start together');
});
test('every tower is up by the end of the rise, however many there are', () => {
  for (const count of [1, 3, 40]) {
    const many = Array.from({ length: count }, (_, i) => `p${i}`), big = { pods: many.map((key, i) => ({ key, name: key, cwd: `/${key}`, col: i % 8, row: Math.floor(i / 8) })), desks: new Map(many.flatMap(key => [0, 1, 2, 3].map(slot => [`${key}${slot}`, { podKey: key, slot, sessionId: `${key}${slot}` }]))), grid: { cols: 8 } };
    const list = [...big.desks.keys()].map(id => ({ id, provider: 'claude' })), city = cityPlan(big, {}, null, providers, list, ['']), boot = to(new CityBoot(city, powerRoutes(city, list), powerLines(city)), BOOT.RISE_TO);
    for (const { id } of city.buildings) assert.equal(boot.tower(id).rise, 1, `${count} hoods: ${id}`);
  }
});
test('a subagent\'s annex goes up with its tower and lights with it', () => {
  const kids = sessions.filter(session => session.parentId), withKid = { ...plan, buildings: plan.buildings.map(b => b.id === 'a1' ? { ...b, subagents: kids.map(kid => ({ ...kid, storeys: 1 })) } : b) }, boot = fresh({ plan: withKid });
  for (const t of [BOOT.CARD + 400, BOOT.RISE_FROM + 700, BOOT.POWER_TO - 200]) { to(boot, t); assert.deepEqual({ ...boot.tower('kid'), lands: 0, lights: 0 }, { ...boot.tower('a1'), lands: 0, lights: 0 }); }
});
test('a tower lands once and lights once', () => {
  const boot = fresh(), lands = new Map(), lights = new Map();
  while (!boot.over) { boot.at = (boot.at ?? 1000) + 16; boot.tick(boot.at, true); for (const { id } of plan.buildings) { const { lands: l, lights: t } = boot.tower(id); if (l) lands.set(id, (lands.get(id) ?? 0) + 1); if (t) lights.set(id, (lights.get(id) ?? 0) + 1); } }
  for (const { id } of plan.buildings) { assert.equal(lands.get(id), 1, `${id} lands`); assert.ok((lights.get(id) ?? 0) === 1, `${id} lights`); }
});
test('no window lights before its tower is finished', () => {
  const boot = fresh();
  while (!boot.over) { boot.at = (boot.at ?? 1000) + 16; boot.tick(boot.at, true); for (const { id } of plan.buildings) { const { lit, rise } = boot.tower(id); if (lit) assert.equal(rise, 1, id); } }
});
test('a spark reaches a tower as it lights: the nearer the plant, the sooner', () => {
  const boot = fresh(), litAt = new Map(), length = route => route.points.reduce((sum, [x, z], i) => i ? sum + Math.abs(x - route.points[i - 1][0]) + Math.abs(z - route.points[i - 1][1]) : 0, 0);
  while (!boot.over) { boot.at = (boot.at ?? 1000) + 16; boot.tick(boot.at, true); for (const { id } of plan.buildings) if (!litAt.has(id) && boot.tower(id).lit) litAt.set(id, boot.t); }
  const byLength = [...routes].sort((a, b) => length(a) - length(b));
  for (let i = 1; i < byLength.length; i++) assert.ok(litAt.get(byLength[i].id) >= litAt.get(byLength[i - 1].id) - 32, `${byLength[i].id} after ${byLength[i - 1].id}`);
  assert.ok(litAt.get(byLength[0].id) >= BOOT.POWER_FROM);
});
test('nothing is unlit or dark once it ends', () => {
  const boot = fresh(); to(boot, BOOT.POWER_TO);
  assert.ok(boot.over);
  for (const { id } of plan.buildings) assert.deepEqual([boot.tower(id).rise, boot.tower(id).lit], [1, true], id);
  for (const { key } of plan.plants) assert.deepEqual(boot.plant(key), { rise: 1, on: true });
  for (const [x, z] of [[0, 0], [plan.bounds.w, plan.bounds.d], [-400, -400], [1000, 1000]]) { assert.equal(boot.dark(x, z), 0); assert.equal(boot.lit(x, z), true); assert.equal(boot.prop(x, z), 1); }
  assert.deepEqual(boot.sparks(), []);
  assert.deepEqual(boot.wireSparks(), []);
});
test('everything is dark, and stays so, until the power comes on', () => {
  const boot = fresh();
  for (const t of [BOOT.CARD, BOOT.RISE_FROM, BOOT.POWER_FROM - 16]) {
    to(boot, t);
    for (const [x, z] of [[plan.plants[0].x, plan.plants[0].z], [0, 0], [plan.bounds.w, plan.bounds.d], [-300, 900]]) { assert.equal(boot.dark(x, z), 1, `${x},${z} at ${t}`); assert.equal(boot.lit(x, z), false); }
    assert.deepEqual(boot.sparks(), []);
  }
});
test('the light moves outward from the plants', () => {
  const boot = to(fresh(), (BOOT.POWER_FROM + BOOT.POWER_TO) / 2), [plant] = plan.plants;
  assert.ok(boot.dark(plant.x, plant.z) < boot.dark(plan.bounds.w, plan.bounds.d));
  assert.equal(boot.dark(plant.x, plant.z), 0);
  assert.ok(boot.dark(plan.bounds.w * 2, plan.bounds.d * 2) > 0);
});
test('while the power comes on sparks run down the roads and the wires, away from the plants', () => {
  const boot = to(fresh(), BOOT.POWER_FROM + 100), early = boot.sparks(), wiresEarly = boot.wireSparks();
  assert.ok(early.length > 0); assert.ok(wiresEarly.length > 0);
  for (const { x, z, provider, head } of early) { assert.ok(['claude', 'codex'].includes(provider)); assert.equal(typeof head, 'boolean'); assert.ok(Number.isFinite(x + z)); }
  to(boot, BOOT.POWER_FROM + 300);
  const near = list => Math.min(...list.filter(spark => spark.head).map(({ x, z }) => Math.min(...plan.plants.map(plant => Math.abs(x - plant.x) + Math.abs(z - plant.z)))));
  assert.ok(near(boot.sparks()) > near(early));
});
test('a plant comes up first and only turns on when the power does', () => {
  const boot = fresh(), [{ key }] = plan.plants, [{ id }] = plan.buildings;
  assert.deepEqual(to(boot, BOOT.CARD).plant(key), { rise: 0, on: false });
  to(boot, BOOT.RISE_FROM + 400); assert.equal(boot.plant(key).rise, 1); assert.equal(boot.plant(key).on, false);
  assert.ok(boot.tower(id).rise < 1 || boot.t > BOOT.RISE_FROM);
  to(boot, BOOT.POWER_FROM + 16); assert.equal(boot.plant(key).on, true);
});
test('trees, lamps and pylons grow in during the rise, each at its own moment', () => {
  const boot = fresh(), spots = [[10, 10], [200, 40], [-100, 300], [400, 400], [33, 77]], up = new Map();
  while (!boot.over) { boot.at = (boot.at ?? 1000) + 16; boot.tick(boot.at, true); spots.forEach(spot => { if (!up.has(spot) && boot.prop(...spot) === 1) up.set(spot, boot.t); assert.ok(boot.prop(...spot) === 1 || boot.t <= BOOT.RISE_TO); }); }
  assert.ok(new Set(up.values()).size > 1);
  for (const at of up.values()) assert.ok(at <= BOOT.RISE_TO + 16);
});

test('the title waits for sprites, but not for ever', () => {
  const boot = to(fresh(), BOOT.CARD, false);
  for (let i = 0; i < 30; i++) { boot.at += 16; boot.tick(boot.at, false); }
  assert.ok(boot.t <= BOOT.CARD, 'held');
  assert.equal(boot.card().broken, 0);
  boot.at += 16; boot.tick(boot.at, true);
  assert.ok(boot.t > BOOT.CARD, 'goes once ready');
  const stuck = to(fresh(), BOOT.CARD, false);
  for (let i = 0; i < 400 && stuck.t <= BOOT.CARD; i++) { stuck.at += 16; stuck.tick(stuck.at, false); }
  assert.ok(stuck.t > BOOT.CARD, 'gives up waiting');
  assert.ok(stuck.at - 1000 <= BOOT.CARD + BOOT.WAIT_MAX + 100);
});
test('a long stall doesn\'t jump the intro: it carries on from where it was', () => {
  const boot = to(fresh(), 200), was = boot.t;
  boot.tick(boot.at + 5000, true);
  assert.ok(boot.t - was <= 100);
});
test('its clock starts with the first frame, wherever that falls', () => {
  const boot = fresh();
  assert.equal(boot.t, 0);
  boot.tick(987654, true);
  assert.equal(boot.t, 0);
  boot.tick(987670, true);
  assert.equal(boot.t, 16);
});

test('the card goes in order, ends still, and is gone once broken up', () => {
  const boot = fresh(), order = { band: Infinity, mark: Infinity, stamp: Infinity };
  while (boot.t < BOOT.CARD) {
    boot.at = (boot.at ?? 1000) + 8; boot.tick(boot.at, false); // Not ready, so that it comes to rest exactly at the end of the card.
    const card = boot.card();
    if (card.bands[0] > 0) order.band = Math.min(order.band, boot.t);
    if (card.mark > 0) order.mark = Math.min(order.mark, boot.t);
    if (card.stamp > 0) order.stamp = Math.min(order.stamp, boot.t);
    for (const value of [...card.bands, card.mark, card.stamp]) assert.ok(value >= 0 && value <= 1, JSON.stringify(card));
  }
  assert.ok(order.band < order.mark && order.mark < order.stamp, JSON.stringify(order));
  const still = boot.card();
  assert.deepEqual([still.bands, still.mark, still.stamp, still.shake], [[1, 1], 1, 1, 0]);
  assert.equal(still.broken, 0);
  to(boot, BOOT.RISE_FROM);
  assert.equal(boot.card().broken, 1);
  assert.equal(boot.card().gone, true);
});
test('the stamp lands with a shake', () => {
  const boot = fresh(); let most = 0;
  while (boot.t < BOOT.CARD) { boot.at = (boot.at ?? 1000) + 8; boot.tick(boot.at, true); if (boot.card().stamp === 1) most = Math.max(most, Math.abs(boot.card().shake)); }
  assert.ok(most >= 2, `${most}`);
});
test('the card breaks up in blocks: none at the start, all by the end, and not in a line', () => {
  const blocks = []; for (let row = 0; row < 12; row++) for (let col = 0; col < 20; col++) blocks.push([col, row]);
  assert.equal(blocks.filter(([c, r]) => blockGone(c, r, 0)).length, 0);
  assert.equal(blocks.filter(([c, r]) => blockGone(c, r, 1)).length, blocks.length);
  const half = blocks.filter(([c, r]) => blockGone(c, r, .5)).length;
  assert.ok(half > blocks.length * .3 && half < blocks.length * .7, `${half}`);
  for (let row = 0; row < 12; row++) { const row0 = blocks.filter(([c, r]) => r === row && blockGone(c, r, .5)).length; assert.ok(row0 > 0 && row0 < 20, `row ${row}: ${row0}`); }
  for (const t of [.2, .4, .6, .8]) for (const [c, r] of blocks) if (blockGone(c, r, t)) assert.ok(blockGone(c, r, t + .1), 'once gone it stays gone');
});

test('skipping jumps to the finished city at any point', () => {
  for (const t of [0, BOOT.CARD / 2, BOOT.RISE_FROM + 200, BOOT.POWER_FROM + 100]) {
    const boot = to(fresh(), t);
    boot.skip();
    assert.ok(boot.over);
    for (const { id } of plan.buildings) assert.deepEqual(boot.tower(id), { rise: 1, lit: true, lands: false, lights: false, litAt: 0 });
    assert.equal(boot.dark(10, 10), 0);
    assert.equal(boot.card().gone, true);
  }
});
test('once over it stays over: nothing starts it again', () => {
  const boot = to(fresh(), BOOT.POWER_TO);
  assert.ok(boot.over);
  const t = boot.t;
  boot.tick(boot.at + 16, true); boot.skip();
  assert.equal(boot.t, t);
  assert.ok(boot.over);
});
test('a tower that wasn\'t there when it began just stands', () => {
  const boot = to(fresh(), BOOT.RISE_FROM + 10);
  assert.deepEqual(boot.tower('new'), { rise: 1, lit: true, lands: false, lights: false, litAt: 0 });
});
test('with no plants the light still comes up and nothing waits on a spark', () => {
  const none = cityPlan(layout, {}, null, [], [], ['']), boot = new CityBoot(none, [], powerLines(none));
  to(boot, BOOT.POWER_FROM + 100);
  assert.deepEqual(boot.sparks(), []);
  assert.deepEqual(boot.wireSparks(), []);
  to(boot, BOOT.POWER_TO);
  assert.ok(boot.over);
  assert.equal(boot.dark(50, 50), 0);
});
test('an empty city boots without trouble', () => {
  const empty = cityPlan({ pods: [], desks: new Map(), grid: { cols: 1 } }, {}, null, [], [], ['']), boot = new CityBoot(empty, [], powerLines(empty));
  to(boot, BOOT.POWER_TO);
  assert.ok(boot.over);
});

test('an ask is taken once', () => {
  const root = { dataset: {} };
  assert.equal(takeBootAsk(root, 1000), false);
  askForBoot(root, 1000);
  assert.equal(takeBootAsk(root, 1500), true);
  assert.equal(takeBootAsk(root, 1600), false);
});
test('an ask nobody took in time is dropped: coming back from the list later doesn\'t set it off', () => {
  const root = { dataset: {} };
  askForBoot(root, 1000);
  assert.equal(takeBootAsk(root, 1000 + ASK_MS + 1), false);
  assert.equal(takeBootAsk(root, 1000 + 1), false, 'and is gone');
});

test('a sprite\'s columns: runs of the same foot, with how high each goes', () => {
  // A little V, like the front of a building: two columns low in the middle, then a clear column.
  const width = 5, height = 6, mask = new Uint8Array(width * height), fill = (col, top, bottom) => { for (let y = top; y <= bottom; y++) mask[col + y * width] = 1; };
  fill(0, 0, 3); fill(1, 1, 4); fill(2, 1, 4); fill(3, 2, 3);
  assert.deepEqual(columnRuns({ width, height, mask }), [{ x: 0, n: 1, foot: 3, top: 0 }, { x: 1, n: 2, foot: 4, top: 1 }, { x: 3, n: 1, foot: 3, top: 2 }]);
  assert.deepEqual(columnRuns({ width: 0, height: 0, mask: new Uint8Array(0) }), []);
});

test('the bare ground has no shadows of props that are not up yet, and no wires', () => {
  const cells = groundCells(plan, 'day'), bare = bareCells(cells);
  assert.deepEqual(bare.wires, []);
  assert.equal(bare.rgb.length, cells.rgb.length);
  let lighter = 0, darker = 0;
  for (let i = 0; i < cells.rgb.length; i += 3) {
    const was = cells.rgb[i] + cells.rgb[i + 1] + cells.rgb[i + 2], now = bare.rgb[i] + bare.rgb[i + 1] + bare.rgb[i + 2];
    if (now > was) lighter++; else if (now < was) darker++;
  }
  assert.ok(lighter > 0, 'some shadow lifted');
  assert.equal(darker, 0);
  assert.ok(cells.wires.length > 0, 'the real ground keeps its wires');
});
