// Which plant feeds which tower, and the pylons round the edge of town. Pure: where things go, in numbers.
import { fnv } from './identity.js';
import { ROAD } from './plan.js';

// The lines keep this far off the roads because a wire is drawn up in the air, and so over the ground to one side of it, a different side in each view.
const MIDDLE = ROAD / 2, SPAN = 90, NORTH = -26, BEHIND = -118, START = -14, APART = 24, SPUR_OFF = 60, FEED_END = 6, FEED_BACK = 13, FEED_INTO = 10;
const SPEED = .05, REST = 60, TRAIL = [0, 5, 10];

// An account that has lost its plant still has its agent's first, rather than a tower nothing feeds.
const plantOf = (plants, { provider, account }) => plants.find(plant => plant.provider === provider && (plant.account === undefined || plant.account === (account || ''))) ?? plants.find(plant => plant.provider === provider);

// Out along the plant's road and down the middle of the streets, to the road the lot faces and up its path.
export function powerRoutes(plan, sessions) {
  const { xs, zs } = plan.roads, buildings = new Map(plan.buildings.map(building => [building.id, building]));
  return sessions.flatMap(session => {
    const building = buildings.get(session.id), plant = building && plantOf(plan.plants, session);
    if (!plant) return [];
    const hood = plan.hoods.find(({ key }) => key === building.hoodKey), street = zs[hood.row + (building.slot & 1)] + MIDDLE, { x, z } = building;
    const points = plant.provider === 'claude'
      ? [[plant.x, plant.z], [xs[0] + MIDDLE, plant.z], [xs[0] + MIDDLE, street], [x, street], [x, z]]
      : [[plant.x, plant.z], [plant.x, zs[0] + MIDDLE], [xs[hood.col] + MIDDLE, zs[0] + MIDDLE], [xs[hood.col] + MIDDLE, street], [x, street], [x, z]];
    return [{ id: session.id, plant: plant.key, provider: plant.provider, points }];
  });
}

export const routeLength = points => points.reduce((sum, [x, z], i) => i ? sum + Math.abs(x - points[i - 1][0]) + Math.abs(z - points[i - 1][1]) : 0, 0);
export function pointAlong(points, distance) {
  let left = distance;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], leg = Math.abs(bx - ax) + Math.abs(bz - az);
    if (left <= leg && leg) { const t = left / leg; return [ax + (bx - ax) * t, az + (bz - az) * t]; }
    left -= leg;
  }
  return points.at(-1);
}
// The whole way, to show which towers a plant feeds.
export function routeDots(points, every) {
  const dots = [], length = routeLength(points);
  for (let s = 0; s <= length; s += every) dots.push(pointAlong(points, s).map(Math.round));
  return dots;
}
// One spark down each route, then a rest. Each starts somewhere of its own, so a city's worth don't move as one.
export function pulsesAt(routes, now) {
  const pulses = [];
  for (const { id, provider, points } of routes) {
    const length = routeLength(points), lap = length + REST, s = (now * SPEED + fnv(id) % lap) % lap;
    for (const back of TRAIL) {
      const at = s - back;
      if (at < 0 || at > length) continue;
      const [x, z] = pointAlong(points, at);
      pulses.push({ x: Math.round(x), z: Math.round(z), head: !back, provider });
    }
  }
  return pulses;
}

// Stops at least, and as many between as keep the spans short.
function trunk(stops) {
  const all = [...new Set(stops)].sort((a, b) => a - b), out = [];
  all.forEach((stop, i) => {
    out.push(stop);
    const next = all[i + 1];
    if (next === undefined) return;
    const n = Math.ceil((next - stop) / SPAN);
    for (let k = 1; k < n; k++) out.push(Math.round(stop + (next - stop) * k / n));
  });
  return out;
}
// A line along the north of town to the plant there, and another down behind the plants on the west: no road runs out that far, so neither crosses one, and far enough behind that no pylon stands in front of a plant when the view's turned round.
export function powerLines(plan) {
  const poles = new Map(), wires = [], feeds = [], claudes = plan.plants.filter(plant => plant.provider === 'claude'), codexes = plan.plants.filter(plant => plant.provider !== 'claude');
  const pole = (x, z, along) => { const key = `${x},${z}`; if (!poles.has(key)) poles.set(key, { x, z, along }); };
  const string = (along, across, stops) => stops.forEach((at, i) => {
    const [x, z] = along ? [at, across] : [across, at];
    pole(x, z, along);
    if (i) { const was = stops[i - 1]; wires.push(along ? [was, z, x, z] : [x, was, x, z]); }
  });
  // In a small city a plant can be nearly level with where the line starts, whose pylon then serves it.
  const snap = (stop, start) => Math.abs(stop - start) < APART ? start : stop;
  const start = claudes.length ? BEHIND : START, stopFor = plant => snap(Math.round(plant.x - SPUR_OFF), start);
  if (claudes.length) string(false, BEHIND, trunk([NORTH, ...claudes.map(plant => snap(Math.round(plant.z), NORTH))]));
  if (codexes.length) string(true, NORTH, trunk([start, ...codexes.map(stopFor)]));
  for (const plant of claudes) feeds.push([plant.x - FEED_INTO, Math.round(plant.z), BEHIND, snap(Math.round(plant.z), NORTH)]);
  // The Codex plant is north of its road, so its line goes in at the back, clear of the road from every side.
  for (const plant of codexes) {
    const x = stopFor(plant), z = Math.round(plant.z - FEED_BACK);
    string(false, x, [z, NORTH]);
    feeds.push([Math.round(plant.x - FEED_END), z, x, z]);
  }
  return { poles: [...poles.values()], wires, feeds };
}
