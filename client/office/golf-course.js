// Mini-golf holes for the secret room's green: their shape, slopes and what's in the way, how a ball rolls on them, and
// whether one can be made. Pure (no three.js), so holes and physics run under node --test.
//
// A hole is a green inside AREA: one to three straight legs (straight, L or dogleg, or one wide one) joined into a single
// outline, some corners cut off at an angle, wedges on the rails to bank off and, further on, walls and office things in the
// way; a mound or a hollow or two, the rest flat; a tee at one end, the cup at the other; and obstacles: bumpers, a coffee spill, a
// pipe, a windmill. What's in the way is put along the way, the line from the tee round the corners to the cup, so it's in
// the way. `difficulty` (0 to 1) sets how much of all that a hole gets. It's makeable if some putt from the tee drops
// (par 2) or leaves one that does (par 3).

// In the secret room's frame (secret.js): x away from the doorway's wall, z along it. The far end of the room (SECRET.w
// 13), 1.4 m clear of every wall, so there's room to walk round and for the view behind the ball.
export const AREA = { x0: 6.2, x1: 11.6, z0: -2.7, z1: 1.7 };
export const BALL = 0.022, CUP = 0.054, RAIL = 0.03, PIPE = 0.06; // radii; RAIL is half a rail's thickness
// A windmill: the sails turn once in PERIOD seconds, and with four of them one is down across the tunnel 40% of the time.
export const PERIOD = 3, shut = t => { const a = (t / PERIOD * 4) % 1; return a < 0.2 || a > 0.8; };
export const DT = 1 / 120, MAX = 4; // a step (s); the hardest putt (m/s)
// Friction (m/s²), how hard a slope pulls (per unit of slope), the fastest a ball drops in (m/s), how much of its speed a ball
// keeps off a rail, how long a putt may roll (s), the height grid's spacing and the outline's (m).
const DECEL = 0.6, PULL = 7, CAPTURE = 1.25, BOUNCE = 0.65, LIMIT = 12, GRID = 0.02, CELL = 0.05;
const SIZES = { books: { w: 0.22, d: 0.16 }, mug: { r: 0.05 }, duck: { r: 0.06 }, stapler: { w: 0.19, d: 0.05 } };

// mulberry32: a small seeded generator, the same numbers everywhere.
export const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const near = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);

// Inside a polygon [[x, z], …] (even-odd), and how far a point is from the nearest of its edges.
export function inside(poly, x, z) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit; }
  return hit;
}
const toSegment = (x, z, x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, t = clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(x - x1 - dx * t, z - z1 - dz * t); };
export const fromEdge = (poly, x, z) => { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, toSegment(x, z, ...poly[i], ...poly[(i + 1) % poly.length])); return d; };

// The outline of whatever `on(x, z)` covers (traced on a CELL grid over AREA): the edge of the covered cells, then
// straightened (simplify), so steps on a slant or a curve become a line or an arc.
function outline(on) {
  const cols = Math.ceil((AREA.x1 - AREA.x0) / CELL), rows = Math.ceil((AREA.z1 - AREA.z0) / CELL);
  const at = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && on(AREA.x0 + (i + 0.5) * CELL, AREA.z0 + (j + 0.5) * CELL);
  const next = new Map(), add = (a, b, c, d) => next.set(`${a},${b}`, [c, d]);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (at(i, j)) {
    if (!at(i, j - 1)) add(i, j, i + 1, j); if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1);
    if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1); if (!at(i - 1, j)) add(i, j + 1, i, j);
  }
  const start = next.keys().next().value, steps = [];
  for (let key = start; ;) { const [i, j] = key.split(',').map(Number), [a, b] = next.get(key); steps.push([AREA.x0 + i * CELL, AREA.z0 + j * CELL]); key = `${a},${b}`; if (key === start) break; }
  return simplify(steps, CELL * 1.2);
}
// Douglas-Peucker round a closed outline: drops every corner that's within `tolerance` of a straight line between those kept.
function simplify(points, tolerance) {
  const keep = new Uint8Array(points.length), far = points.reduce((best, p, i) => Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > Math.hypot(points[best][0] - points[0][0], points[best][1] - points[0][1]) ? i : best, 0);
  const split = (a, b) => {
    let worst = -1, most = tolerance;
    for (let i = a + 1; i < b; i++) { const d = toSegment(...points[i], ...points[a], ...points[b % points.length]); if (d > most) { most = d; worst = i; } }
    if (worst < 0) return; keep[worst] = 1; split(a, worst); split(worst, b);
  };
  keep[0] = keep[far] = 1; split(0, far); split(far, points.length);
  return points.filter((_, i) => keep[i]);
}
// Each real corner (not a bend on a curve) is left sharp, cut off at an angle, or rounded with an arc, never more than
// about half way along either side.
function corners(poly, r) {
  const out = [];
  poly.forEach((p, k) => {
    const a = poly.at(k - 1), b = poly[(k + 1) % poly.length], ux = a[0] - p[0], uz = a[1] - p[1], vx = b[0] - p[0], vz = b[1] - p[1], la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz);
    const angle = Math.acos(clamp((ux * vx + uz * vz) / (la * lb), -1, 1)), roll = r();
    if (angle > Math.PI * 0.75 || roll < 0.3) { out.push(p); return; }
    if (roll < 0.5) { const d = Math.min(0.45 * (0.4 + 0.6 * r()), la / 2.2, lb / 2.2); out.push([p[0] + ux / la * d, p[1] + uz / la * d], [p[0] + vx / lb * d, p[1] + vz / lb * d]); return; }
    // Rounded: an arc tangent to both sides, its centre on the line halfway between them.
    const t = Math.min((0.15 + 0.4 * r()) / Math.tan(angle / 2), la / 2.2, lb / 2.2), radius = t * Math.tan(angle / 2), bx = ux / la + vx / lb, bz = uz / la + vz / lb, bl = Math.hypot(bx, bz) || 1;
    const cx = p[0] + bx / bl * radius / Math.sin(angle / 2), cz = p[1] + bz / bl * radius / Math.sin(angle / 2);
    const from = Math.atan2(p[1] + uz / la * t - cz, p[0] + ux / la * t - cx); let sweep = Math.atan2(p[1] + vz / lb * t - cz, p[0] + vx / lb * t - cx) - from;
    sweep -= Math.round(sweep / (2 * Math.PI)) * 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / 0.3));
    for (let i = 0; i <= n; i++) out.push([cx + Math.cos(from + sweep * i / n) * radius, cz + Math.sin(from + sweep * i / n) * radius]);
  });
  return out;
}

// A hole from `seed` at `difficulty`, not yet checked (see survey).
export function make(difficulty, seed) {
  const r = rng(seed), between = (a, b) => a + (b - a) * r(), d = difficulty, snap = v => Math.round(v / CELL) * CELL;
  // Laid out in (v, u), v across the area and u along it, then maybe mirrored and turned end for end.
  // A hole runs along the area's longer side.
  const lengthwise = AREA.x1 - AREA.x0 > AREA.z1 - AREA.z0, V = lengthwise ? AREA.z1 - AREA.z0 : AREA.x1 - AREA.x0, U = lengthwise ? AREA.x1 - AREA.x0 : AREA.z1 - AREA.z0, W = snap(between(1.45, 1.7) - 0.55 * d);
  const kind = d < 0.12 ? ['straight', 'bowl'][Math.floor(r() * 2)] : d < 0.3 ? ['straight', 'L', 'bowl', 'funnel'][Math.floor(r() * 4)] : ['straight', 'L', 'L', 'Z', 'Z', 'wide', 'bowl', 'funnel', 'funnel'][Math.floor(r() * 9)];
  // Legs are rectangles; a round green is a disc [v, u, radius]; a funnel is a four-sided piece narrowing toward the cup.
  let legs, tee, cup, discs = [], funnels = [];
  if (kind === 'bowl') { // a lane opening into a round green round the cup
    const R = between(0.65, 1), vc = between(Math.max(R, W / 2), V - Math.max(R, W / 2)), L = snap(between(2.2, U - R - 0.2)), u0 = snap(between(0, U - L - R - 0.05));
    legs = [[snap(vc - W / 2), u0, snap(vc - W / 2) + W, u0 + L]]; discs = [[vc, u0 + L, R]];
    tee = [vc + W * between(-0.25, 0.25), u0 + 0.5]; cup = [vc + R * between(-0.45, 0.45), u0 + L + R * between(-0.2, 0.45)];
  } else if (kind === 'funnel') { // wide at the tee, narrowing to a neck (or a little round green) with the cup
    const wide = between(1.8, Math.min(2.8, V - 0.1)), neck = between(0.6, 0.9), vc = between(wide / 2, V - wide / 2), u0 = between(0, 0.4), u1 = u0 + between(1.6, 2.6), u2 = between(u1 + 1, U - 0.1);
    funnels = [[[vc - wide / 2, u0], [vc + wide / 2, u0], [vc + neck / 2, u1], [vc - neck / 2, u1]]]; legs = [[vc - neck / 2, u1 - 0.05, vc + neck / 2, u2]];
    if (r() < 0.5) discs = [[vc, u2, between(0.45, 0.65)]];
    tee = [vc + wide * between(-0.25, 0.25), u0 + 0.5]; cup = [vc + neck * between(-0.2, 0.2), u2 - (discs.length ? 0 : between(0.3, 0.5))];
  } else if (kind === 'straight' || kind === 'wide') {
    const w = kind === 'wide' ? snap(between(2.2, 3)) : W, L = snap(between(3.4, U - 0.1)), v0 = snap(between(0, V - w)), u0 = snap(between(0, U - L));
    legs = [[v0, u0, v0 + w, u0 + L]]; tee = [v0 + w * between(0.3, 0.7), u0 + 0.5]; cup = [v0 + w * between(0.25, 0.75), u0 + L - between(0.35, 0.9)];
  } else if (kind === 'L') {
    const L1 = snap(between(3, U - 0.1)), L2 = snap(between(2.2, V - 0.1)), u0 = snap(between(0, U - L1)), v0 = snap(between(0, V - L2));
    legs = [[v0, u0, v0 + W, u0 + L1], [v0, u0 + L1 - W, v0 + L2, u0 + L1]];
    tee = [v0 + W / 2, u0 + 0.5]; cup = [v0 + L2 - between(0.35, 0.8), u0 + L1 - W * between(0.3, 0.7)];
  } else { // up one side, across, up the other
    const u0 = snap(between(0, 0.4)), u1 = snap(between(U - 0.5, U)), um = snap(between(u0 + 1.7, u1 - 1.7)), v1 = snap(between(W + 0.7, V - W));
    legs = [[0, u0, W, snap(um + W / 2)], [0, snap(um - W / 2), v1 + W, snap(um + W / 2)], [v1, snap(um - W / 2), v1 + W, u1]];
    tee = [W / 2, u0 + 0.5]; cup = [v1 + W / 2, u1 - between(0.35, 0.8)];
  }
  const mirror = r() < 0.5, flip = r() < 0.5, across = v => mirror ? V - v : v, up = u => flip ? U - u : u;
  const at = (v, u) => lengthwise ? [AREA.x0 + up(u), AREA.z0 + across(v)] : [AREA.x0 + across(v), AREA.z0 + up(u)];
  const rects = legs.map(([a, b, c, e]) => { const [x0, z0] = at(a, b), [x1, z1] = at(c, e); return [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]; });
  const rounds = discs.map(([v, u, radius]) => [...at(v, u), radius]), quads = funnels.map(q => q.map(p => at(...p)));
  const poly = corners(outline((x, z) => rects.some(([a, b, c, e]) => x > a && x < c && z > b && z < e) || rounds.some(([cx, cz, radius]) => Math.hypot(x - cx, z - cz) < radius) || quads.some(q => inside(q, x, z))), r);
  [tee, cup] = [tee, cup].map(p => { const [x, z] = at(...p); return { x, z }; });
  const clear = (p, gap) => near(p, tee) > gap && near(p, cup) > gap;
  // The way: tee, the middle of each corner where one leg meets the next, cup. along(random, spread) is a spot on it, up to
  // `spread` metres to either side.
  const way = [tee, ...rects.slice(1).map((b, i) => { const a = rects[i]; return { x: (Math.max(a[0], b[0]) + Math.min(a[2], b[2])) / 2, z: (Math.max(a[1], b[1]) + Math.min(a[3], b[3])) / 2 }; }), cup];
  const along = (random, spread) => {
    const lengths = way.slice(1).map((p, i) => near(p, way[i])); let s = random() * lengths.reduce((a, b) => a + b, 0), i = 0;
    while (s > lengths[i] && i < lengths.length - 1) s -= lengths[i++];
    const a = way[i], b = way[i + 1], t = clamp(s / (lengths[i] || 1), 0, 1), off = (random() * 2 - 1) * spread;
    return { x: a.x + (b.x - a.x) * t - (b.z - a.z) / (lengths[i] || 1) * off, z: a.z + (b.z - a.z) * t + (b.x - a.x) / (lengths[i] || 1) * off };
  };

  // Wedges on the rails: a triangle on a long side, pointing in.
  const wedges = [];
  for (let tries = 0, count = d < 0.02 ? 0 : Math.floor(between(1, 2 + 3 * d)); wedges.length < count && tries < 30; tries++) {
    const k = Math.floor(r() * poly.length), [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length], len = Math.hypot(bx - ax, bz - az); if (len < 0.9) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len, t = between(0.2, 0.8) * len, mid = { x: ax + ux * t, z: az + uz * t }, base = between(0.3, 0.55), deep = between(0.18, 0.32), slide = between(-0.15, 0.15);
    const n = inside(poly, mid.x - uz * 0.05, mid.z + ux * 0.05) ? [-uz, ux] : [uz, -ux], apex = { x: mid.x + n[0] * deep + ux * slide, z: mid.z + n[1] * deep + uz * slide };
    if (!clear(mid, 0.55) || !clear(apex, 0.45) || !inside(poly, apex.x, apex.z)) continue;
    wedges.push([[mid.x - ux * base / 2, mid.z - uz * base / 2], [apex.x, apex.z], [mid.x + ux * base / 2, mid.z + uz * base / 2]]);
  }
  // Walls across the way, further on.
  const inner = [];
  for (let tries = 0, count = d < 0.2 ? 0 : Math.floor(between(0, 1.5 + 2 * d)); inner.length < count && tries < 30; tries++) {
    const { x, z } = along(r, 0.35), half = between(0.2, 0.45), a = r() * Math.PI, wall = [x - Math.cos(a) * half, z - Math.sin(a) * half, x + Math.cos(a) * half, z + Math.sin(a) * half];
    if ([[wall[0], wall[1]], [wall[2], wall[3]]].some(([px, pz]) => !inside(poly, px, pz) || fromEdge(poly, px, pz) < 0.25)) continue;
    if ([tee, cup].some(p => toSegment(p.x, p.z, ...wall) < 0.45)) continue;
    inner.push(wall);
  }
  // Office things in the way.
  const kinds = Object.keys(SIZES), things = [];
  for (let tries = 0, count = d < 0.12 ? 0 : Math.floor(between(0, 1.5 + 2.5 * d)); things.length < count && tries < 30; tries++) {
    const kind = kinds[Math.floor(r() * kinds.length)], o = { kind, ...SIZES[kind], ...along(r, 0.4), turn: r() * Math.PI };
    const reach = o.r || Math.hypot(o.w, o.d) / 2;
    if (!inside(poly, o.x, o.z) || fromEdge(poly, o.x, o.z) < reach + 0.12 || !clear(o, reach + 0.3) || things.some(p => near(p, o) < 0.4)) continue;
    things.push(o);
  }
  // From hole 4, a mound or a hollow or two on the way, compact and high enough to see; the rest of the green is flat, so a
  // putt only bends where you can see why.
  const bumps = d < 0.06 ? [] : Array.from({ length: Math.floor(between(1, 2 + 1.5 * d)) }, () => ({ ...along(r, 0.3), r: between(0.3, 0.5), a: (r() < 0.6 ? 1 : -1) * (0.08 + 0.06 * d) }));
  const features = obstacles(d, rng(seed * 31 + 17), { poly, rects, tee, cup, things, inner, clear, along });
  const walls = [...poly.map((p, i) => [...p, ...poly[(i + 1) % poly.length]]), ...wedges.flatMap(([p, q, s]) => [[...p, ...q], [...q, ...s]]), ...inner];
  const c = { difficulty, seed, outline: poly, wedges, inner, things, features, walls, tee, cup, bumps };
  c.grid = grid(c);
  return c;
}

// Obstacles, from their own seed (so adding them never reshapes a green), more and more of them as it gets harder: bumpers
// that kick the ball away, a coffee spill (roll in and it's a stroke's penalty, back to where you putted from), a pipe that
// swallows the ball and spits it out somewhere else, and a windmill across a leg whose sails block its tunnel now and then.
function obstacles(d, r, { poly, rects, tee, cup, things, inner, clear, along }) {
  const between = (a, b) => a + (b - a) * r(), out = [];
  const open = (x, z, gap) => inside(poly, x, z) && fromEdge(poly, x, z) > gap && clear({ x, z }, gap + 0.3) && things.every(o => near(o, { x, z }) > gap + 0.25) && inner.every(w => toSegment(x, z, ...w) > gap + 0.1) && out.every(f => near(f, { x, z }) > gap + 0.4 && (!f.to || near(f.to, { x, z }) > gap + 0.4));
  if (d >= 0.45 && r() < 0.7) { // across the middle of the longest leg, the sails toward the tee
    const [x0, z0, x1, z1] = rects.reduce((a, b) => Math.max(b[2] - b[0], b[3] - b[1]) > Math.max(a[2] - a[0], a[3] - a[1]) ? b : a), along = x1 - x0 > z1 - z0, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    const turn = along ? 0 : Math.PI / 2, side = ((tee.x - x) * Math.cos(turn) + (tee.z - z) * Math.sin(turn)) < 0 ? -1 : 1, part = s => ({ x: x - Math.sin(turn) * 0.24 * s, z: z + Math.cos(turn) * 0.24 * s, w: 0.3, d: 0.32, turn });
    const gx = x + Math.cos(turn) * 0.17 * side, gz = z + Math.sin(turn) * 0.17 * side;
    if (open(x, z, 0.45)) out.push({ kind: 'windmill', x, z, turn, side, parts: [part(-1), part(1)], gate: [gx + Math.sin(turn) * 0.09, gz - Math.cos(turn) * 0.09, gx - Math.sin(turn) * 0.09, gz + Math.cos(turn) * 0.09] });
  }
  if (d >= 0.35 && r() < 0.6) for (let tries = 0; tries < 20; tries++) { // a pipe on the way, coming out pointing roughly at the cup
    const { x, z } = along(r, 0.3), tx = between(AREA.x0, AREA.x1), tz = between(AREA.z0, AREA.z1), outward = Math.atan2(cup.z - tz, cup.x - tx) + between(-0.6, 0.6);
    if (Math.hypot(tx - x, tz - z) < 1.2 || !open(x, z, 0.12) || !open(tx, tz, 0.15) || !inside(poly, tx + Math.cos(outward) * 0.35, tz + Math.sin(outward) * 0.35)) continue;
    out.push({ kind: 'pipe', x, z, to: { x: tx, z: tz }, out: outward }); break;
  }
  for (let tries = 0, count = d < 0.2 ? 0 : Math.floor(between(0, 1.5 + d)); out.filter(f => f.kind === 'spill').length < count && tries < 20; tries++) {
    const rx = between(0.18, 0.32), rz = between(0.12, 0.22), { x, z } = along(r, 0.45);
    if (open(x, z, rx + 0.05)) out.push({ kind: 'spill', x, z, rx, rz, turn: r() * Math.PI });
  }
  for (let tries = 0, count = d < 0.02 ? 0 : Math.floor(between(1, 2 + 3 * d)); out.filter(f => f.kind === 'bumper').length < count && tries < 30; tries++) {
    const { x, z } = along(r, 0.4);
    if (open(x, z, 0.1)) out.push({ kind: 'bumper', x, z, r: 0.055 });
  }
  return out;
}
// How far round an obstacle the green is kept flat, so it sits level.
const footprint = f => f.kind === 'windmill' ? 0.5 : f.kind === 'spill' ? Math.max(f.rx, f.rz) : f.kind === 'pipe' ? 0.12 : 0.08;

// The green's height (above its base) on a GRID over the hole, and the slope's pull worked out from it: flat by the rails,
// at the tee and round the cup.
function grid(c) {
  const xs = c.outline.map(p => p[0]), zs = c.outline.map(p => p[1]), x0 = Math.min(...xs) - GRID, z0 = Math.min(...zs) - GRID;
  const cols = Math.ceil((Math.max(...xs) + GRID - x0) / GRID) + 1, rows = Math.ceil((Math.max(...zs) + GRID - z0) / GRID) + 1, h = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = x0 + i * GRID, z = z0 + j * GRID; if (!inside(c.outline, x, z)) continue;
    let v = 0;
    for (const b of c.bumps) v += b.a * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r));
    let flat = 1;
    for (const f of c.features) for (const p of f.to ? [f, f.to] : [f]) flat *= smooth(footprint(f), footprint(f) + 0.2, Math.hypot(x - p.x, z - p.z));
    h[j * cols + i] = flat * clamp(v, -0.18, 0.18) * smooth(0.04, 0.35, fromEdge(c.outline, x, z)) * smooth(0.1, 0.35, Math.hypot(x - c.cup.x, z - c.cup.z)) * smooth(0.05, 0.3, Math.hypot(x - c.tee.x, z - c.tee.z));
  }
  const px = new Float32Array(cols * rows), pz = new Float32Array(cols * rows);
  for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) { const k = j * cols + i; px[k] = -PULL * (h[k + 1] - h[k - 1]) / (2 * GRID); pz[k] = -PULL * (h[k + cols] - h[k - cols]) / (2 * GRID); }
  return { x0, z0, cols, rows, h, px, pz };
}
const sample = (g, field, x, z) => {
  const u = clamp((x - g.x0) / GRID, 0, g.cols - 1.001), v = clamp((z - g.z0) / GRID, 0, g.rows - 1.001), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * g.cols + i;
  return (field[k] * (1 - a) + field[k + 1] * a) * (1 - b) + (field[k + g.cols] * (1 - a) + field[k + g.cols + 1] * a) * b;
};
export const height = (c, x, z) => sample(c.grid, c.grid.h, x, z);

// A ball touching something: pushed out along (nx, nz) and bounced (barely moving, it just stops against it, or it would
// patter against a rail for ever); the push is remembered, so next step a slope can't press it on into what it rests on.
const hit = (b, nx, nz, depth) => {
  b.x += nx * depth; b.z += nz * depth;
  const vn = b.vx * nx + b.vz * nz, give = 1 + (vn < -0.08 ? BOUNCE : 0); if (vn < 0) { b.vx -= give * vn * nx; b.vz -= give * vn * nz; }
  b.touch.push([nx, nz]);
};
function thing(o, b) {
  if (o.r) { const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz); if (d < o.r + BALL && d > 1e-6) hit(b, dx / d, dz / d, o.r + BALL - d); return; }
  const cos = Math.cos(o.turn), sin = Math.sin(o.turn), lx = (b.x - o.x) * cos + (b.z - o.z) * sin, lz = -(b.x - o.x) * sin + (b.z - o.z) * cos;
  let nx = lx - clamp(lx, -o.w / 2, o.w / 2), nz = lz - clamp(lz, -o.d / 2, o.d / 2), depth;
  const d = Math.hypot(nx, nz);
  if (d > 1e-6) { if (d >= BALL) return; nx /= d; nz /= d; depth = BALL - d; }
  else { const px = o.w / 2 - Math.abs(lx), pz = o.d / 2 - Math.abs(lz); [nx, nz, depth] = px < pz ? [Math.sign(lx) || 1, 0, px + BALL] : [0, Math.sign(lz) || 1, pz + BALL]; } // inside: out the nearest side
  hit(b, nx * cos - nz * sin, nx * sin + nz * cos, depth);
}
// One step of a rolling ball { x, z, vx, vz, touch, t }: slope, friction, walls, things, obstacles, the cup. Sets b.sunk,
// b.rest or b.spilled; b.bumped or b.piped say what it hit on the way; b.t is the clock the windmill turns by.
export function step(c, b) {
  let fx = sample(c.grid, c.grid.px, b.x, b.z), fz = sample(c.grid, c.grid.pz, b.x, b.z);
  for (const [nx, nz] of b.touch) { const into = fx * nx + fz * nz; if (into < 0) { fx -= into * nx; fz -= into * nz; } }
  b.touch = [];
  b.vx += fx * DT; b.vz += fz * DT;
  const s = Math.hypot(b.vx, b.vz), drop = DECEL * DT;
  // Hardly moving for a quarter of a second where the slope (less what it rests against) is too gentle to start it rolling
  // back (creeping on the flat, nudging along a rail) is stopped: a ball that looks still is ready for the next putt. One
  // that slows at the top of its climb up a mound rolls back down.
  b.slow = s < 0.06 && Math.hypot(fx, fz) <= DECEL * 1.5 ? (b.slow || 0) + DT : 0;
  if (b.slow > 0.25) { b.vx = b.vz = 0; b.rest = true; return b; }
  if (s <= drop) { b.vx = b.vz = 0; if (Math.hypot(fx, fz) <= DECEL) { b.rest = true; return b; } }
  else { b.vx -= b.vx / s * drop; b.vz -= b.vz / s * drop; }
  b.x += b.vx * DT; b.z += b.vz * DT;
  // Walls are capsules RAIL round their line, so corners at any angle bounce true.
  for (const [x1, z1, x2, z2] of c.walls) {
    const dx = x2 - x1, dz = z2 - z1, t = clamp(((b.x - x1) * dx + (b.z - z1) * dz) / (dx * dx + dz * dz), 0, 1), ex = b.x - x1 - dx * t, ez = b.z - z1 - dz * t, d = Math.hypot(ex, ez);
    if (d < BALL + RAIL && d > 1e-9) hit(b, ex / d, ez / d, BALL + RAIL - d);
  }
  for (const o of c.things) thing(o, b);
  b.t += DT;
  for (const f of c.features) {
    if (f.kind === 'bumper') {
      const dx = b.x - f.x, dz = b.z - f.z, d = Math.hypot(dx, dz); if (d >= f.r + BALL || d < 1e-6) continue;
      hit(b, dx / d, dz / d, f.r + BALL - d);
      const s = Math.hypot(b.vx, b.vz), kick = Math.max(s * 1.1, 1.4);
      [b.vx, b.vz] = s > 1e-6 ? [b.vx / s * kick, b.vz / s * kick] : [dx / d * kick, dz / d * kick]; b.bumped = f;
    } else if (f.kind === 'spill') {
      const cos = Math.cos(f.turn), sin = Math.sin(f.turn), lx = (b.x - f.x) * cos + (b.z - f.z) * sin, lz = -(b.x - f.x) * sin + (b.z - f.z) * cos;
      if ((lx / f.rx) ** 2 + (lz / f.rz) ** 2 < 1) b.spilled = true;
    } else if (f.kind === 'pipe') {
      if (Math.hypot(b.x - f.x, b.z - f.z) >= PIPE) continue;
      const s = Math.max(0.7, Math.hypot(b.vx, b.vz) * 0.8), ox = Math.cos(f.out), oz = Math.sin(f.out);
      Object.assign(b, { x: f.to.x + ox * 0.1, z: f.to.z + oz * 0.1, vx: ox * s, vz: oz * s, touch: [], piped: f });
    } else {
      for (const part of f.parts) thing(part, b);
      if (!shut(b.t)) continue;
      const [x1, z1, x2, z2] = f.gate, dx = x2 - x1, dz = z2 - z1, t = clamp(((b.x - x1) * dx + (b.z - z1) * dz) / (dx * dx + dz * dz), 0, 1), ex = b.x - x1 - dx * t, ez = b.z - z1 - dz * t, d = Math.hypot(ex, ez);
      if (d < BALL + 0.012 && d > 1e-9) hit(b, ex / d, ez / d, BALL + 0.012 - d);
    }
  }
  if (Math.hypot(b.x - c.cup.x, b.z - c.cup.z) < CUP && Math.hypot(b.vx, b.vz) < CAPTURE) b.sunk = true;
  return b;
}
// Where a putt from `from` at (vx, vz), made at time t0 (for the windmill), ends up.
export function roll(c, from, vx, vz, t0 = 0) {
  const b = { x: from.x, z: from.z, vx, vz, touch: [], t: t0 };
  for (let t = 0; t < LIMIT && !b.sunk && !b.rest && !b.spilled; t += DT) step(c, b);
  return b;
}

// Whether a hole can be made, a little at a time (a generator, so the next one can be got ready between frames): putts
// all the way round, from straight at the cup outward, each at a range of strengths (and, past a windmill, a few moments
// in its turn), stopping at the first that drops. One that ends in coffee doesn't count as a place to putt again from.
// Returns 2 if one from the tee does, 3 if one leaves a putt that does, 0 if neither.
export function* survey(c) {
  const left = b => Math.hypot(b.x - c.cup.x, b.z - c.cup.z);
  function* putts(from, every) {
    const out = [], toward = Math.atan2(c.cup.z - from.z, c.cup.x - from.x), moments = c.features.some(f => f.kind === 'windmill') ? [0, 0.25, 0.5] : [0];
    for (let k = 0; k * every <= Math.PI; k++) for (const a of k ? [k * every, -k * every] : [0]) {
      for (let s = 0.4; s <= MAX; s += 0.25) for (const t0 of moments) { const b = roll(c, from, Math.cos(toward + a) * s, Math.sin(toward + a) * s, t0); if (b.sunk) return null; if (!b.spilled) out.push(b); }
      yield;
    }
    return out;
  }
  const first = yield* putts(c.tee, 0.044);
  if (!first) return 2;
  for (const b of first.sort((a, b) => left(a) - left(b)).slice(0, 3)) if (!(yield* putts(b, 0.07))) return 3;
  return 0;
}
export const par = c => { const it = survey(c); for (;;) { const s = it.next(); if (s.done) return s.value; } };

// The course: holes 1 to 50, harder as they go, the same for everyone, each with its par worked out ahead (a test checks
// them), so none has to be surveyed while you play.
export const HOLE_COUNT = 50, PARS = '22222232222222222232232322222332322333233233222233';
export const difficulty = n => Math.min(1, (n - 1) / 45);
export const seedOf = (n, k) => n * 7919 + k * 104729;
export const hole = n => ({ ...make(difficulty(n), seedOf(n, 0)), n, par: Number(PARS[n - 1]) });
// Endless: hole `index` of a run started with `seed`, harder as the run goes on; the first makeable try, surveyed a little at a
// time (yields between putts).
export function* endless(index, seed) {
  for (let k = 0; ; k++) { const c = make(Math.min(1, 0.3 + 0.035 * index), seed + index * 7919 + k * 104729), p = yield* survey(c); if (p) return { ...c, index, par: p }; }
}
