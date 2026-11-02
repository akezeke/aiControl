import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, ROAD } from '../client/city/plan.js';
import { groundCells, paintGround, reachOf } from '../client/city/ground.js';
import { pointAlong, powerLines, powerRoutes, pulsesAt, routeDots, routeLength } from '../client/city/power.js';
import { pylon } from '../client/city/generator.js';

const ids = ['s1', 's2', 's3', 's4'], desks = ids.map((id, i) => [id, { podKey: i < 2 ? 'a' : 'b', slot: i % 2, sessionId: id }]);
const layout = { pods: [{ key: 'a', name: 'alpha', cwd: '/a', col: 0, row: 0 }, { key: 'b', name: 'beta', cwd: '/b', col: 1, row: 1 }], desks: new Map(desks), grid: { cols: 2 } };
const providers = [{ name: 'Claude Code', connected: true }, { name: 'Codex', connected: true }];
const sessions = [{ id: 's1', provider: 'claude' }, { id: 's2', provider: 'claude', account: 'work' }, { id: 's3', provider: 'codex' }, { id: 's4', provider: 'claude', account: 'gone' }, { id: 'kid', provider: 'claude', parentId: 's1' }, { id: 'nowhere', provider: 'codex' }];
const plan = cityPlan(layout, {}, null, providers, sessions, ['', 'work']), routes = powerRoutes(plan, sessions), routeOf = id => routes.find(route => route.id === id);

test('a session is fed by its own account\'s plant', () => {
  assert.equal(routeOf('s1').plant, 'claude');
  assert.equal(routeOf('s2').plant, 'claude:work');
  assert.equal(routeOf('s3').plant, 'codex');
});
test('an account with no plant any more falls back on the agent\'s first, rather than leaving a tower unfed', () => assert.equal(routeOf('s4').plant, 'claude'));
test('only towers get a route: not subagents, and not sessions with no building', () => assert.deepEqual(routes.map(route => route.id).sort(), ['s1', 's2', 's3', 's4']));
test('a route goes from the plant to the tower, turning square corners', () => {
  for (const route of routes) {
    const plant = plan.plants.find(p => p.key === route.plant), building = plan.buildings.find(b => b.id === route.id), { points } = route;
    assert.deepEqual(points[0], [plant.x, plant.z]);
    assert.deepEqual(points.at(-1), [building.x, building.z]);
    for (let i = 1; i < points.length; i++) assert.ok(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1], `${route.id} leg ${i}`);
  }
});
test('between the plant and its lot a route keeps to the middle of the roads', () => {
  const centreX = new Set(plan.roads.xs.map(x => x + ROAD / 2)), centreZ = new Set(plan.roads.zs.map(z => z + ROAD / 2));
  for (const { points, id } of routes) for (let i = 1; i < points.length - 1; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    if (i === 1) continue; // Out along the plant's spur, to where the roads begin.
    assert.ok(ax === bx ? centreX.has(ax) : centreZ.has(az), `${id} leg ${i}: ${ax},${az} to ${bx},${bz}`);
  }
});
test('a south lot is reached by the road to its south', () => {
  const south = plan.buildings.find(b => b.slot & 1), hood = plan.hoods.find(h => h.key === south.hoodKey), { points } = routeOf(south.id);
  assert.equal(points.at(-2)[1], plan.roads.zs[hood.row + 1] + ROAD / 2);
});
test('along a route: a place for any distance, from the start to the end and no further', () => {
  const { points } = routeOf('s3'), length = routeLength(points);
  assert.deepEqual(pointAlong(points, 0), points[0]);
  assert.deepEqual(pointAlong(points, length), points.at(-1));
  assert.deepEqual(pointAlong(points, length + 50), points.at(-1));
  const [ax, az] = points[0], [bx, bz] = points[1], first = Math.hypot(bx - ax, bz - az);
  assert.deepEqual(pointAlong(points, first / 2), [(ax + bx) / 2, (az + bz) / 2]);
});
test('dots mark a route all the way, evenly', () => {
  const { points } = routeOf('s1'), dots = routeDots(points, 6);
  assert.deepEqual(dots[0], points[0].map(Math.round));
  assert.equal(dots.length, Math.floor(routeLength(points) / 6) + 1);
  assert.ok(dots.every(([x, z], i) => !i || Math.abs(x - dots[i - 1][0]) + Math.abs(z - dots[i - 1][1]) <= 7));
});
test('pulses run down the routes they are asked for, and every route has its turn', () => {
  const one = [routeOf('s1')];
  const seen = new Set();
  for (let now = 0; now < 40000; now += 125) for (const { x, z, head } of pulsesAt(one, now)) { if (head) seen.add(`${x},${z}`); }
  assert.ok(seen.size > 20, `${seen.size} places`);
  const at = pulsesAt(routes, 12345);
  assert.ok(at.length > 0 && at.length <= routes.length * 3);
  let going = 0; while (!pulsesAt(one, going).length) going += 125;
  assert.notDeepEqual(pulsesAt(one, going), pulsesAt(one, going + 250));
});

const lines = powerLines(plan), { w: W, d: D } = plan.bounds;
test('the lines start at each plant and are one connected network', () => {
  assert.ok(lines.poles.length >= 8);
  for (const plant of plan.plants) assert.ok(lines.poles.some(({ x, z }) => Math.hypot(x - plant.x, z - plant.z) < 70), `no pole by ${plant.key}`);
  const key = ([x, z]) => `${x},${z}`, poles = new Set(lines.poles.map(({ x, z }) => key([x, z])));
  for (const [ax, az, bx, bz] of lines.wires) { assert.ok(poles.has(key([ax, az]))); assert.ok(poles.has(key([bx, bz]))); }
  const near = new Map(); for (const [ax, az, bx, bz] of lines.wires) { (near.get(key([ax, az])) ?? near.set(key([ax, az]), []).get(key([ax, az]))).push(key([bx, bz])); (near.get(key([bx, bz])) ?? near.set(key([bx, bz]), []).get(key([bx, bz]))).push(key([ax, az])); }
  const seen = new Set(), walk = [key([lines.poles[0].x, lines.poles[0].z])];
  while (walk.length) { const at = walk.pop(); if (!seen.has(at)) { seen.add(at); walk.push(...(near.get(at) || [])); } }
  assert.equal(seen.size, poles.size, 'every pole on one network');
});
test('wires carry on from the last pylon into each plant', () => {
  assert.equal(lines.feeds.length, plan.plants.length);
  for (const plant of plan.plants) assert.ok(lines.feeds.some(([ax, az, bx, bz]) => Math.hypot(ax - plant.x, az - plant.z) < 20 && lines.poles.some(({ x, z }) => x === bx && z === bz)), plant.key);
});
test('poles stand clear of the city, its roads and the sea', () => {
  const reach = reachOf(W, D);
  for (const { x, z } of lines.poles) {
    assert.ok(x < 0 || z < 0, `in the city at ${x},${z}`);
    assert.ok(reach(x, z) < -6, `too near the water at ${x},${z}`);
    for (const plant of plan.plants) {
      if (plant.provider === 'claude') assert.ok(!(x > -44 && x < 0 && Math.abs(z - plant.z) < 11), `on ${plant.key}'s road at ${x},${z}`);
      else assert.ok(!(z > -48 && z < 0 && Math.abs(x - plant.x) < 11), `on the Codex road at ${x},${z}`);
    }
  }
});
test('no two pylons stand side by side, in a big city or a small one', () => {
  const tiny = { pods: [{ key: 'a', name: 'alpha', cwd: '/a', col: 0, row: 0 }], desks: new Map(), grid: { cols: 1 } };
  for (const city of [plan, cityPlan(tiny, {}, null, providers, [], ['', 'work']), cityPlan(tiny, {}, null, providers, [], ['', 'work', 'side'])]) {
    const { poles } = powerLines(city);
    poles.forEach((a, i) => poles.slice(i + 1).forEach(b => assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 24, `${a.x},${a.z} and ${b.x},${b.z}`)));
  }
});
test('no plants, no lines; and a plant alone only has its own side', () => {
  const none = cityPlan(layout, {}, null, [], [], ['']);
  assert.deepEqual(powerLines(none), { poles: [], wires: [], feeds: [] });
  const codexOnly = cityPlan(layout, {}, null, [{ name: 'Codex', connected: true }], [], ['']);
  assert.ok(powerLines(codexOnly).poles.every(({ z }) => z < 0));
});
test('the ground carries the pylons and paints their wires, in every view', () => {
  const cells = groundCells(plan), blank = { ...cells, wires: [] };
  const standing = cells.props.filter(({ stack }) => stack === pylon(true) || stack === pylon(false));
  assert.equal(standing.length, lines.poles.length);
  assert.ok(pylon(true).h > 12);
  for (const view of [0, 1, 2, 3]) {
    const a = paintGround(cells, view).rgba, b = paintGround(blank, view).rgba;
    let differ = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differ++;
    assert.ok(differ > 40, `${differ} wire pixels in view ${view}`);
  }
});

test('an OpenCode session is fed by its own plant, on the north line beside Codex\'s', () => {
  const withOpenCode = [...providers, { name: 'OpenCode', connected: true }], all = [...sessions, { id: 's5', provider: 'opencode' }];
  const layout5 = { ...layout, desks: new Map([...desks, ['s5', { podKey: 'b', slot: 1, sessionId: 's5' }]]) };
  const city = cityPlan(layout5, {}, null, withOpenCode, all, ['', 'work']), route = powerRoutes(city, all).find(item => item.id === 's5');
  assert.equal(route.plant, 'opencode');
  const plant = city.plants.find(item => item.key === 'opencode'), { poles, feeds } = powerLines(city);
  assert.deepEqual(route.points[0], [plant.x, plant.z]);
  assert.equal(feeds.length, city.plants.length, 'every plant has a feed');
  assert.ok(poles.every((pole, i) => poles.findIndex(other => other.x === pole.x && other.z === pole.z) === i), 'no two poles share a place');
});
