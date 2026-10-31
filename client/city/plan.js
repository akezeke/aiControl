// Where everything in the city stands, from the same layout Office seats people by: a project is a neighbourhood, a slot a lot,
// and every grid position that has no project is a park. Pure: numbers and names, no drawing.
import { SCREEN } from './sprite.js';
import { fnv, lookOf, tower } from './identity.js';

export const LOT = 70, PARK = 26, WALK = 2, ROAD = 14, BELT = PARK + WALK * 2 + ROAD, EDGE = ROAD + WALK * 2, PLANT = 60, PLOT = 2;
// Annexes stand to the screen's right and left of their parent however the city is turned: never in its column, so neither covers the other.
export const SPOTS = [[28, -4], [-16, 16], [4, -28]];

const DEFAULT_STOREYS = 4, ANNEX_STOREYS = 2;
const KINDS = ['park', 'park', 'pond', 'plaza', 'court', 'parking', 'market', 'park'];

export const screen = (x, z, view) => SCREEN[view](x, z);
export function unproject(sx, sy, view) {
  const a = sx / 2;
  return [[sy + a, sy - a], [sy - a, -sy - a], [-sy - a, a - sy], [a - sy, a + sy]][view];
}
export const turned = ([a, b], view) => [[a, b], [b, -a], [-a, -b], [-b, a]][view];
export function annexAt(building, i, view) { const [a, b] = turned(SPOTS[i], view); return { x: building.x + a, z: building.z + b }; }

const parcel = (seed, x, z, w, d) => ({ kind: KINDS[fnv(seed) % KINDS.length], x, z, w, d, seed });

// `previous` is what this page last drew: while it stays open the columns only grow, so nothing already on screen slides.
export function cityPlan(layout, towers = {}, previous = null, providers = [], sessions = []) {
  towers ||= {};
  const before = new Map((previous?.hoods || []).map(hood => [hood.key, hood])), desks = [...layout.desks.values()];
  const slotsOf = key => desks.filter(desk => desk.podKey === key).map(desk => desk.slot);
  const hoods = layout.pods.map(pod => {
    const used = Math.max(-1, ...slotsOf(pod.key)) + 1;
    return { key: pod.key, name: pod.name, cwd: pod.cwd, col: pod.col, row: pod.row, cols: Math.max(2, Math.ceil((used + 1) / 2), before.get(pod.key)?.cols || 0) };
  });
  const gridCols = Math.max(1, layout.grid?.cols || 1, previous?.widths.length || 0, ...hoods.map(hood => hood.col + 1));
  const rows = Math.max(1, previous ? previous.roads.zs.length - 1 : 1, ...hoods.map(hood => hood.row + 1));
  const widths = Array.from({ length: gridCols }, (_, c) => Math.max(2 * LOT, previous?.widths[c] || 0, ...hoods.filter(hood => hood.col === c).map(hood => hood.cols * LOT)));
  const xs = [EDGE]; widths.forEach((w, i) => { xs[i + 1] = xs[i] + w + BELT; });
  const zAt = row => EDGE + row * (2 * LOT + BELT), W = xs.at(-1), D = zAt(rows);

  const buildings = [], parcels = [], parks = [];
  for (const hood of hoods) {
    hood.x = xs[hood.col]; hood.z = zAt(hood.row);
    hood.sign = { x: hood.x + hood.cols * LOT / 2, z: hood.z - WALK };
    const slotOwner = new Map(desks.filter(desk => desk.podKey === hood.key).map(desk => [desk.slot, desk.sessionId]));
    hood.lots = Array.from({ length: hood.cols * 2 }, (_, slot) => ({ key: `${hood.key}:${slot}`, slot, x: hood.x + (slot >> 1) * LOT + LOT / 2, z: hood.z + (slot & 1) * LOT + LOT / 2, sessionId: slotOwner.get(slot) ?? null, cols: hood.cols }));
    // Each neighbourhood keeps its own parcels, seeded by its name: part of remembering where it is.
    const width = widths[hood.col], across = width / LOT, x1 = hood.x + width, z1 = hood.z + 2 * LOT;
    for (let i = 0; i < across; i++) parcels.push(parcel(`${hood.name}:s${i}`, hood.x + i * LOT + 1, z1 + 1, LOT - 2, PARK - 2));
    for (let i = 0; i < 2; i++) parcels.push(parcel(`${hood.name}:e${i}`, x1 + 1, hood.z + i * LOT + 1, PARK - 2, LOT - 2));
    parcels.push(parcel(`${hood.name}:c`, x1 + 1, z1 + 1, PARK - 2, PARK - 2));
    // A wider neighbour in the same grid column leaves room: parcels too, numbered by place so growing doesn't reshuffle the rest.
    for (let i = hood.cols; i < across; i++) for (let r = 0; r < 2; r++) parcels.push(parcel(`${hood.name}:e${2 + i * 2 + r}`, hood.x + i * LOT + 1, hood.z + r * LOT + 1, LOT - 2, LOT - 2));
  }
  for (let row = 0; row < rows; row++) widths.forEach((w, c) => {
    if (!hoods.some(hood => hood.col === c && hood.row === row)) parks.push({ x: xs[c] + 1, z: zAt(row) + 1, w: w + PARK - 2, d: 2 * LOT + PARK - 2, seed: `park:${c}:${row}` });
  });

  for (const desk of desks) {
    const hood = hoods.find(h => h.key === desk.podKey), lot = hood?.lots[desk.slot];
    if (!lot) continue;
    const kids = desk.subagents || [], building = {
      id: desk.sessionId, hoodKey: hood.key, slot: desk.slot, x: lot.x, z: lot.z, look: towers[desk.sessionId]?.look ? lookOf(desk.sessionId, towers[desk.sessionId].look) : tower(desk.sessionId),
      storeys: towers[desk.sessionId]?.storeys ?? DEFAULT_STOREYS,
      subagents: kids.slice(0, SPOTS.length).map(id => ({ id, storeys: towers[id]?.storeys ?? ANNEX_STOREYS, leaving: !!desk.leaving?.includes(id) })),
      overflow: (desk.overflow || 0) + Math.max(0, kids.length - SPOTS.length),
    };
    if (desk.vacantSince !== undefined) building.vacantSince = desk.vacantSince;
    buildings.push(building);
  }

  const connected = name => providers.find(provider => provider.name === name)?.connected === true;
  // An agent that isn't set up here has no plant. One that was, or that has sessions in the city, stays when it drops: dark, which is why they are.
  const plants = [{ provider: 'claude', name: 'Claude Code', x: -PLANT, z: D * .62, connected: connected('Claude Code') }, { provider: 'codex', name: 'Codex', x: W * .62, z: -PLANT, connected: connected('Codex') }]
    .filter(plant => plant.connected || sessions.some(session => session.provider === plant.provider) || previous?.plants.some(was => was.provider === plant.provider));
  const roads = { xs: [...xs.slice(0, -1).map(x => x - ROAD - WALK), W - ROAD - WALK], zs: Array.from({ length: rows + 1 }, (_, i) => zAt(i) - ROAD - WALK) };
  return { hoods, buildings, roads, parcels, parks, plants, bounds: { w: W, d: D }, widths };
}

export const spawnTarget = (hood, lot) => hood.cwd ? { cwd: hood.cwd, slot: lot.slot } : { cwd: null, slot: null };

export function lotAt(plan, x, z) {
  for (const hood of plan.hoods) {
    const c = Math.floor((x - hood.x) / LOT), r = Math.floor((z - hood.z) / LOT);
    if (c >= 0 && c < hood.cols && (r === 0 || r === 1)) return hood.lots[c * 2 + r];
  }
  return null;
}
