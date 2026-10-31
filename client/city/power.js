// Which plant feeds which tower, and the pylons round the edge of town. Pure: where things go, in numbers.
import { fnv } from './identity.js';
import { ROAD } from './plan.js';

const MIDDLE = ROAD / 2, SPAN = 90, TRUNK = -6, FEED_INTO = 10, APART = 24, SPUR_OFF = 12, ROAD_CLEAR = 11;
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

// Stops at least, and as many between as keep the spans short, leaving out any that would stand on a road it crosses. The far end is only a place to stop, so it gives way to a stop it would crowd.
function trunk(stops, end, crossings) {
  const all = [...new Set(stops.some(stop => Math.abs(stop - end) < APART) ? stops : [...stops, end])].sort((a, b) => a - b), out = [];
  all.forEach((stop, i) => {
    out.push(stop);
    const next = all[i + 1];
    if (next === undefined) return;
    const n = Math.ceil((next - stop) / SPAN);
    for (let k = 1; k < n; k++) { const at = Math.round(stop + (next - stop) * k / n); if (!crossings.some(c => Math.abs(at - c) < ROAD_CLEAR)) out.push(at); }
  });
  return out;
}
// A line up the west side and another along the north, meeting at the corner. It stops level with each plant, a little way off the plant's road so nothing stands on one, and the wires go on from there into the plant.
export function powerLines(plan) {
  const { w, d } = plan.bounds, poles = new Map(), wires = [], feeds = [], claudes = plan.plants.filter(plant => plant.provider === 'claude'), codexes = plan.plants.filter(plant => plant.provider !== 'claude');
  const pole = (x, z, along) => { const key = `${x},${z}`; if (!poles.has(key)) poles.set(key, { x, z, along }); };
  const string = (along, across, stops) => stops.forEach((at, i) => {
    const [x, z] = along ? [at, across] : [across, at];
    pole(x, z, along);
    if (i) { const was = stops[i - 1]; wires.push(along ? [was, z, x, z] : [x, was, x, z]); }
  });
  // In a small city a plant can be nearly level with the corner, whose pylon then serves it.
  const branch = at => { const stop = Math.round(at - SPUR_OFF); return stop - TRUNK < APART ? TRUNK : stop; };
  if (claudes.length) string(false, TRUNK, trunk([TRUNK, ...claudes.map(plant => branch(plant.z))], d, claudes.map(plant => plant.z)));
  if (codexes.length) string(true, TRUNK, trunk([TRUNK, ...codexes.map(plant => branch(plant.x))], w, codexes.map(plant => plant.x)));
  for (const plant of claudes) feeds.push([plant.x + FEED_INTO, Math.round(plant.z - SPUR_OFF), TRUNK, branch(plant.z)]);
  for (const plant of codexes) feeds.push([Math.round(plant.x - SPUR_OFF), plant.z + FEED_INTO, branch(plant.x), TRUNK]);
  return { poles: [...poles.values()], wires, feeds };
}
