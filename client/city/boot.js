// Breaking ground: the city's intro, as numbers. Title card, bare ground, towers going up a neighbourhood at a time, then the power coming on from the plants outward. Pure: it says how far along everything is and the scene draws that.
import { fnv } from './identity.js';
import { pointAlong, routeLength } from './power.js';

export const BOOT = { CARD: 700, RISE_FROM: 1000, RISE_TO: 2400, POWER_FROM: 2200, POWER_TO: 2900, WAIT_MAX: 3000 };

const { CARD, RISE_FROM, RISE_TO, POWER_FROM, POWER_TO, WAIT_MAX } = BOOT;
const TOWER_MS = 420, PROP_MS = 200, PLANT_MS = 300, IN_HOOD_MS = 160, HOOD_LEAD = 160, HOOD_MAX = 320;
// The farthest thing lights a little before the end, so that nothing is left to do on the last frame.
const WAVE_ROOM = 1.1, EDGE = 60, TRAIL = [0, 5, 10], WIRE_TRAIL = [0, 4], NO_LONGER_THAN = 100, WIRE_SEED = 20;
const BANDS = [[0, 140], [50, 190]], MARK = [180, 330], STAMP = [330, 450], SHAKE = [450, 610], SHAKE_PX = 4, SHAKE_BEAT = 32;
const FINAL = Object.freeze({ rise: 1, lit: true, lands: false, lights: false, litAt: 0 });
const between = (t, [from, to]) => Math.min(1, Math.max(0, (t - from) / (to - from)));

// Each block of the card has its own moment, so it breaks up all over rather than in a sweep.
export function blockGone(col, row, t) { return t > 0 && (fnv(`${col}:${row}`) % 1000) / 1000 < t; }

// The cut through a rising sprite follows its foot: a column at a time, joined where the foot is level. A plain rectangle would slice across the building's corner.
export function columnRuns({ width, height, mask }) {
  const runs = [];
  for (let x = 0; x < width; x++) {
    let top = -1, foot = -1;
    for (let y = 0; y < height; y++) if (mask[x + y * width]) { if (top < 0) top = y; foot = y; }
    const last = runs.at(-1);
    if (foot < 0) continue;
    if (last && last.foot === foot && last.top === top && last.x + last.n === x) last.n++; else runs.push({ x, n: 1, foot, top });
  }
  return runs;
}

// What each wire's ends are from the nearest plant, along the wires. A wire the plants can't reach stays out of it.
function wireReach(plants, wires) {
  const ends = new Map(), key = (x, z) => `${x},${z}`, links = new Map();
  for (const [ax, az, bx, bz] of wires) {
    const a = key(ax, az), b = key(bx, bz), length = Math.abs(ax - bx) + Math.abs(az - bz);
    if (!links.has(a)) links.set(a, { x: ax, z: az, next: [] });
    if (!links.has(b)) links.set(b, { x: bx, z: bz, next: [] });
    links.get(a).next.push([b, length]); links.get(b).next.push([a, length]);
  }
  for (const [id, { x, z }] of links) {
    const near = Math.min(Infinity, ...plants.map(plant => Math.abs(plant.x - x) + Math.abs(plant.z - z)));
    if (near <= WIRE_SEED) ends.set(id, 0);
  }
  const queue = [...ends.keys()];
  while (queue.length) {
    queue.sort((a, b) => ends.get(b) - ends.get(a));
    const id = queue.pop();
    for (const [other, length] of links.get(id).next) {
      const through = ends.get(id) + length;
      if (through < (ends.get(other) ?? Infinity)) { ends.set(other, through); if (!queue.includes(other)) queue.push(other); }
    }
  }
  return wires.flatMap(([ax, az, bx, bz]) => {
    const da = ends.get(key(ax, az)), db = ends.get(key(bx, bz));
    if (da === undefined || db === undefined) return [];
    return [da <= db ? { ax, az, bx, bz, from: da, to: db } : { ax: bx, az: bz, bx: ax, bz: az, from: db, to: da }];
  });
}

export class CityBoot {
  constructor(plan, routes, lines) {
    this.t = 0; this.over = false; this.skipped = false; this.last = null; this.prev = 0; this.waited = 0;
    this.plants = plan.plants;
    this.routes = routes.map(route => ({ ...route, length: routeLength(route.points) }));
    this.wires = wireReach(plan.plants, [...lines.wires, ...lines.feeds]);
    const farthest = Math.max(1, ...this.routes.map(route => route.length), ...this.wires.map(wire => wire.to), ...[[0, 0], [plan.bounds.w, 0], [0, plan.bounds.d], [plan.bounds.w, plan.bounds.d]].map(([x, z]) => this.reach(x, z)));
    this.span = farthest * WAVE_ROOM;
    // Nearest the plants goes up first. Each neighbourhood has its turn, and however many there are they all fit.
    const order = [...plan.hoods].sort((a, b) => this.reach(a.x, a.z) - this.reach(b.x, b.z));
    const room = RISE_TO - RISE_FROM - HOOD_LEAD - TOWER_MS - IN_HOOD_MS, step = order.length > 1 ? Math.min(HOOD_MAX, room / (order.length - 1)) : 0;
    const startOf = new Map(order.map(({ key }, i) => [key, RISE_FROM + HOOD_LEAD + i * step]));
    const inHood = new Map();
    for (const building of plan.buildings) { const list = inHood.get(building.hoodKey) ?? []; list.push(building); inHood.set(building.hoodKey, list); }
    this.towers = new Map();
    for (const [hood, list] of inHood) list.forEach((building, i) => {
      const from = startOf.get(hood) + (list.length > 1 ? i * IN_HOOD_MS / (list.length - 1) : 0), up = from + TOWER_MS, route = this.routes.find(({ id }) => id === building.id);
      const arrives = POWER_FROM + (route ? route.length : Math.min(this.reach(building.x, building.z), this.span)) / this.span * (POWER_TO - POWER_FROM);
      const tower = { from, up, lights: Math.ceil(Math.max(arrives, up)) };
      this.towers.set(building.id, tower);
      for (const kid of building.subagents ?? []) this.towers.set(kid.id, tower);
    });
  }
  // Roads are square, so the wave is too: distance on the ground from the nearest plant, or from the corner of town if there are none yet.
  reach(x, z) {
    if (!this.plants.length) return Math.abs(x) + Math.abs(z);
    let near = Infinity;
    for (const plant of this.plants) { const d = Math.abs(plant.x - x) + Math.abs(plant.z - z); if (d < near) near = d; }
    return near;
  }
  // How far out the power has got.
  get wave() { return this.t < POWER_FROM ? -1 : (this.t - POWER_FROM) / (POWER_TO - POWER_FROM) * this.span; }

  // `ready`: its sprites are baked. The card holds for that, since a big city would otherwise rise half drawn.
  tick(now, ready) {
    if (this.over) return;
    if (this.last === null) { this.last = now; return; }
    const dt = Math.min(NO_LONGER_THAN, Math.max(0, now - this.last));
    this.last = now; this.prev = this.t;
    if (this.t === CARD && !ready && this.waited < WAIT_MAX) { this.waited += dt; return; }
    const next = this.t + dt;
    this.t = next > CARD && this.t < CARD && !ready ? CARD : next;
    if (this.t >= POWER_TO) this.over = true;
  }
  skip() { if (!this.over) { this.over = true; this.skipped = true; this.t = POWER_TO; } }

  tower(id) {
    const tower = this.towers.get(id);
    if (this.over || !tower) return FINAL;
    const { from, up, lights } = tower, lit = this.t >= lights;
    return { rise: Math.min(1, Math.max(0, (this.t - from) / (up - from))), lit, lands: this.prev < up && this.t >= up, lights: this.prev < lights && lit, litAt: lit ? lights : 0 };
  }
  plant(key) {
    if (this.over) return { rise: 1, on: true };
    const at = Math.max(0, this.plants.findIndex(plant => plant.key === key));
    return { rise: between(this.t, [RISE_FROM + at * 40, RISE_FROM + at * 40 + PLANT_MS]), on: this.t >= POWER_FROM };
  }
  // A tree, a lamp or a pylon. Each has its moment, from where it stands, and all are up before the wires go live.
  prop(x, z) {
    if (this.over) return 1;
    const from = RISE_FROM + ((Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663)) >>> 0) % (POWER_FROM - RISE_FROM - PROP_MS);
    return between(this.t, [from, from + PROP_MS]);
  }
  // 1 is unlit, 0 is the city as it really is.
  dark(x, z) {
    if (this.over) return 0;
    if (this.t < POWER_FROM) return 1;
    return Math.min(1, Math.max(0, (Math.min(this.reach(x, z), this.span) - this.wave) / EDGE));
  }
  lit(x, z) { return this.over || (this.t >= POWER_FROM && Math.min(this.reach(x, z), this.span) <= this.wave); }

  // Along the ground, one down every route, gone once it's arrived.
  sparks() {
    if (this.over || this.t < POWER_FROM) return [];
    const out = [], { wave } = this;
    for (const { points, length, provider } of this.routes) for (const back of TRAIL) {
      const at = wave - back;
      if (at < 0 || at > length) continue;
      const [x, z] = pointAlong(points, at);
      out.push({ x: Math.round(x), z: Math.round(z), provider, head: !back });
    }
    return out;
  }
  // Along the pylons, on whichever span it has got to.
  wireSparks() {
    if (this.over || this.t < POWER_FROM) return [];
    const out = [], { wave } = this;
    for (const { ax, az, bx, bz, from, to } of this.wires) for (const back of WIRE_TRAIL) {
      const at = wave - back;
      if (at < from || at > to || to === from) continue;
      const k = (at - from) / (to - from);
      out.push({ x: ax + (bx - ax) * k, z: az + (bz - az) * k, along: az === bz, k, head: !back });
    }
    return out;
  }

  // Hazard strips slam in, the mark drops, the name stamps on and the screen jolts. Then it breaks up.
  card() {
    const { t } = this;
    if (this.over || t >= RISE_FROM) return { bands: [1, 1], mark: 1, stamp: 1, shake: 0, broken: 1, gone: true };
    const beat = Math.floor((t - SHAKE[0]) / SHAKE_BEAT), left = 1 - between(t, SHAKE);
    return { bands: BANDS.map(band => between(t, band)), mark: between(t, MARK), stamp: between(t, STAMP), shake: t >= SHAKE[0] && t < SHAKE[1] ? Math.round(SHAKE_PX * left) * (beat % 2 ? -1 : 1) : 0, broken: between(t, [CARD, RISE_FROM]), gone: false };
  }
}
