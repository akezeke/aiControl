// RC racing's circuits, pure (no document, no window), so Node can lay and drive them: the day's loop round the office from
// the car's floor map (rc-physics.js), its racing line, and where along it a car is. rc.js draws it and races on it.
import * as THREE from 'three';
import { fnv1a, mulberry32 } from './daily.js';
import { R, TUNE, STEP, newCar, step } from './rc-physics.js';

// The track's width (m); every centreline point keeps CLEAR from anything solid, so a car on the track's edge just misses it.
export const WIDTH = 0.5;
// The kerbs stand this far (m) out from the centreline: past the road's edge, a strip of slow floor before them.
export const KERB = WIDTH / 2 + 0.17;
const CLEAR = WIDTH / 2 + R;
// Metres between centreline samples; the coarse grid's cell (m) for picking points and joining them; tries before giving up,
// then a few plainer ones (4 points, none forced under a desk); the lap's least and most length (m): at ~1.4 m/s across the
// office, the spec's 20-35 s par is 28-49 m.
const SPACING = 0.05, COARSE = 0.2, ATTEMPTS = 32, PLAIN = 4, SHORTEST = 6, LONGEST = 50;
// Control points: how many, how far apart at least (m). Joins keep to the middle of the floor: a step within PREFER (m) of
// anything costs up to 1 + KEEP_OFF times more, so a corner has room to be rounded.
const FEWEST = 6, MOST = 10, APART = 0.8, PREFER = 0.9, KEEP_OFF = 6, OPEN = 0.6;
// Of the first few circuits that work (CHOICES), the one whose lap is nearest AIM (m): ~25 s at par in a real office, mid-way
// in the spec's 20-35 s (a small office can't hold one that long, and gets its longest).
const CHOICES = 4, AIM = 42, BAYS = 45, TRAIL = 20; // a lap through the aisles beats one round points, when there is one
// The aisle graph: inner aisles picked this many times as often as those along the walls; two parts of a lap may run close
// only within CROSS (m) of a crossing.
const INNER = 4, UNDER = 12, CROSS = 1, SNAP = 1.5, BENDS = 2;
const DETOUR = 1.3; // an aisle driven no more than this much longer than straight along (and half a metre)
const SEARCH = 4000; // steps a search through the aisles may take for a lap
// The share of days whose lap looks for a tunnel under the desks first (half); the rest look for a figure of eight (where an
// office has both, a lap seldom fits both in).
const UNDER_DAYS = 0.5;
// Tunnels: under a row of desks (legs at the corners, the PC hung up, the bin out front; room.js), driven straight along, from
// OUT_PAST (m) before it to as far after; at least MIN_TUNNEL (m) of it; up to TUNNELS a lap.
const OUT_PAST = 2, MIN_TUNNEL = 1.6, TUNNELS = 2;
// A tunnel's ends are on open floor, this far (m) from anything, at most ROOM_FOR (m) past its row: a turn into or out of it
// needs room clear of the row's end (smoothing pulls a corner inward), and a row's end by a wall hasn't got it. Other points
// keep OFF_ENDS (m) from its ends: one just off an end is a hairpin.
const OPEN_END = 0.8, ROOM_FOR = 3, OFF_ENDS = 2;
// The racing line: smoothing passes, and how far it may stray from the centreline (m).
const PASSES = 40, LINE_OFF = WIDTH / 2 - 0.08;
// The centreline's relaxing, on points ROUGH (m) apart: at most this many passes, till no corner is sharper than this (1/m: a
// 0.33 m radius, a hairpin; the car turns no tighter than ~0.31 m at any speed, and slows for it), with a margin, as the
// spline through them then rounds a little differently. Tight spots pin it, so it can't always get rounder.
const ROUGH = 0.2, RELAX = 200, SHARPEST = 3;
// How clear (m) the relaxing likes it, and how far a pass may push a point out toward that.
const WANT = 0.6, PUSH = 0.03;
// Two parts of the lap further apart along it than ALONG (m) must be further apart across than WIDTH + GAP, so it never
// runs alongside itself (where you are on it would be a guess).
const ALONG = 1.5, GAP = 0.1;
// A kerb's gap reaches at least this far (m) past it onto the other road.
const GAP_PAST = 0.15;
// Further than this (m) from where it was along the road, a car is looked for all along it.
const LOST = 0.8;
// The grid: 8 slots, two abreast this far either side of the line, rows this far apart, the first this far behind the start.
const SLOTS = 8, ABREAST = 0.15, ROWS = 0.3;

// A small binary heap of [priority, value], lowest first.
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(p, v) { a.push([p, v]); let i = a.length - 1; while (i) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } },
    pop() {
      const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
      return top[1];
    },
  };
}

// The day's circuit: `map` (floorMap, with clearance), `room` { left, back, width, depth } (the office; the circuit
// stays in it), `start` { x, z, yaw } (by the dock), `seed` (the day and the office). → { key, points (x, z every ≤ 5 cm, a
// closed loop from the start line), length, line (the racing line, the same indexing), curvature (1/m), grid (8 slots, front
// first), checkpoints, ramps (rc-physics.js's, each with `s`, where along the lap) } or null when nothing fits.
export function makeCircuit({ map, room, start, seed }) {
  if (!map?.clearance) return null;
  const left = room.left ?? 0, back = room.back ?? 0, cols = Math.floor(room.width / COARSE), rows = Math.floor(room.depth / COARSE), n = cols * rows;
  const xOf = k => left + (k % cols + 0.5) * COARSE, zOf = k => back + (Math.floor(k / cols) + 0.5) * COARSE;
  const clear = new Float32Array(n);
  for (let k = 0; k < n; k++) clear[k] = map.clearance(xOf(k), zOf(k));
  const free = k => clear[k] >= CLEAR + 0.02;
  // The free cell nearest the start, and every free cell reachable from it (inside a sofa can look like open floor).
  let first = -1, nearest = Infinity;
  for (let k = 0; k < n; k++) if (free(k)) { const d = Math.hypot(xOf(k) - start.x, zOf(k) - start.z); if (d < nearest) { nearest = d; first = k; } }
  if (first < 0) return null;
  const NEIGHBOURS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  const around = (k, fn) => { const i = k % cols, j = Math.floor(k / cols); for (const [di, dj, step] of NEIGHBOURS) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < cols && b < rows && free(b * cols + a)) fn(b * cols + a, step); } };
  const reached = new Uint8Array(n), reachable = [first]; reached[first] = 1;
  for (let q = 0; q < reachable.length; q++) around(reachable[q], k => { if (!reached[k]) { reached[k] = 1; reachable.push(k); } });
  // The other control points only on open floor, OPEN (m) from anything: one in a nook is a U-turn too.
  const open = reachable.filter(k => clear[k] >= OPEN);
  // The tunnels (rows): { a, b: its ends [x, z]; x, z: its middle; ka, kb: the free cells by its ends }.
  const nearCell = (x, z) => {
    const i0 = Math.floor((x - left) / COARSE), j0 = Math.floor((z - back) / COARSE); let best = -1, d = Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = i0 + di, j = j0 + dj, k = j * cols + i; if (i < 0 || j < 0 || i >= cols || j >= rows || !reached[k]) continue;
      const e = (xOf(k) - x) ** 2 + (zOf(k) - z) ** 2; if (e < d) { d = e; best = k; }
    }
    return best;
  };
  const tunnels = [];
  for (const t of findRows(map, room)) { const ka = nearCell(...t.a), kb = nearCell(...t.b); if (ka >= 0 && kb >= 0) tunnels.push({ ...t, ka, kb }); }
  // A* from cell a to cell b over free cells, dearer near walls: the cells on the way, or null.
  const join = (a, b) => {
    const cost = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), open = heap(), bi = b % cols, bj = Math.floor(b / cols);
    const guess = k => { const di = Math.abs(k % cols - bi), dj = Math.abs(Math.floor(k / cols) - bj); return Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj); };
    cost[a] = 0; open.push(guess(a), a);
    while (open.size) {
      const k = open.pop(); if (k === b) break;
      around(k, (m, step) => { const c = cost[k] + step * (1 + KEEP_OFF * Math.max(0, (PREFER - clear[m]) / PREFER) ** 2); if (c < cost[m]) { cost[m] = c; from[m] = k; open.push(c + guess(m), m); } });
    }
    if (from[b] < 0 && a !== b) return null;
    const path = []; for (let k = b; k !== a; k = from[k]) path.push(k); path.push(a);
    return path.reverse();
  };
  // How far from the start control points may be (m), shrunk while laps come out too long (a big office's corners make 70 m).
  let chosen = null, reach = Math.hypot(room.width, room.depth);
  const within = k => Math.hypot(xOf(k) - xOf(first), zOf(k) - zOf(first)) <= reach;
  const tripStops = (rand, plain, attempt) => {
      // Points on open floor anywhere it may reach, and a tunnel or two (each a unit: its middle, with its two ends), then the
      // shortest way round them all: nearest first, then untangled (2-opt). That goes between the pods and weaves, where going
      // round the points' middle only ever went round the room. (The start isn't one of them: by the dock and a wall, the loop
      // would come in and go out the same way; the lap starts at its point nearest it, in finish.)
      const want = plain ? 4 : FEWEST + Math.floor(rand() * (MOST - FEWEST + 1)), units = [];
      // Apart from each other, and from a tunnel's ends: a point just off one is a hairpin out of it.
      const apart = (x, z) => units.every(u => Math.hypot(u.x - x, u.z - z) >= APART * (u.tunnel ? 2 : 1) && (!u.tunnel || [u.tunnel.a, u.tunnel.b].every(([ex, ez]) => Math.hypot(ex - x, ez - z) >= OFF_ENDS)));
      // Every other try has a tunnel or two; the rest none, in case none will fit.
      if (!plain && attempt % 2 === 0) for (let tries = 0, n = 1 + Math.floor(rand() * TUNNELS); tries < 40 && units.length < Math.min(n, tunnels.length); tries++) {
        const t = tunnels[Math.floor(rand() * tunnels.length)]; if (Math.hypot(t.x - xOf(first), t.z - zOf(first)) <= reach && apart(t.x, t.z)) units.push({ x: t.x, z: t.z, tunnel: t });
      }
      const pool = open.filter(within), from = pool.length >= 30 ? pool : open.length >= 30 ? open : reachable;
      for (let tries = 0; units.length < want && tries < 400; tries++) { const k = from[Math.floor(rand() * from.length)]; if (apart(xOf(k), zOf(k))) units.push({ x: xOf(k), z: zOf(k), k }); }
      if (units.length < 3) return null;
      // Distances by a tunnel's ends, not its middle: in by one, out by the other, whichever suits (ends: where it's entered and
      // left, given what's before and after it).
      const ends = (u, before, after) => {
        if (!u.tunnel) return [[u.x, u.z], [u.x, u.z]];
        const { a, b } = u.tunnel, d = (p, q) => Math.hypot(p[0] - q.x, p[1] - q.z);
        return d(a, before) + d(b, after) <= d(b, before) + d(a, after) ? [a, b] : [b, a];
      };
      const length = tour => tour.reduce((sum, u, i) => {
        const next = tour[(i + 1) % tour.length], [, out] = ends(u, tour[(i - 1 + tour.length) % tour.length], next), [into] = ends(next, u, tour[(i + 2) % tour.length]);
        return sum + Math.hypot(out[0] - into[0], out[1] - into[1]);
      }, 0);
      const tour = [units.splice(Math.floor(rand() * units.length), 1)[0]];
      while (units.length) { let best = 0; for (let i = 1; i < units.length; i++) if (Math.hypot(units[i].x - tour.at(-1).x, units[i].z - tour.at(-1).z) < Math.hypot(units[best].x - tour.at(-1).x, units[best].z - tour.at(-1).z)) best = i; tour.push(units.splice(best, 1)[0]); }
      for (let better = true; better;) {
        better = false;
        for (let i = 0; i < tour.length - 1; i++) for (let j = i + 2; j < tour.length; j++) {
          const tried = [...tour.slice(0, i + 1), ...tour.slice(i + 1, j + 1).reverse(), ...tour.slice(j + 1)];
          if (length(tried) < length(tour) - 1e-6) { tour.splice(0, tour.length, ...tried); better = true; }
        }
      }
      // Each stop: the cell it's arrived at by, the one it's left from, and (a tunnel) the straight line through it, whichever
      // way round suits its neighbours.
      const stops = tour.map((u, i) => {
        if (!u.tunnel) return { arrive: u.k, leave: u.k, inner: [] };
        const [p, q] = ends(u, tour[(i - 1 + tour.length) % tour.length], tour[(i + 1) % tour.length]), on = p === u.tunnel.a, { ka, kb } = u.tunnel;
        const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.1);
        return { arrive: on ? ka : kb, leave: on ? kb : ka, inner: Array.from({ length: steps + 1 }, (_, s) => [p[0] + (q[0] - p[0]) * s / steps, p[1] + (q[1] - p[1]) * s / steps]) };
      });
      return stops;
  };
  // The aisles as a graph (aisleGraph): where they cross, the stretches between, and tunnels under rows of desks from the aisle
  // one side of a pod to the aisle the other. A lap is a closed trail through it: no stretch twice, and a node twice only
  // straight across (a crossing: a figure of eight, half the lap one way round and half the other). Tunnels are picked
  // UNDER times as often as a stretch of aisle, inner aisles INNER times as often as those along the walls. Its corners are
  // right angles in an aisle: brake or drift. → { stops, crossings: [[x, z]] } or null.
  const grid = room.pods?.length && room.cellW ? podGrid(room) : null, graph = grid && aisleGraph(grid, tunnels, map);
  // An aisle is only one where it can be driven near enough straight: the boss's glass office takes a pod's place in the grid,
  // and the aisle lines through it (and the node inside) would have the lap go round it, every try failing.
  if (graph) graph.edges = graph.edges.filter(e => {
    if (e.tunnel) return true;
    const p = graph.nodes[e.a], q = graph.nodes[e.b], a = nearCell(p.x, p.z), b = nearCell(q.x, q.z), way = a >= 0 && b >= 0 && join(a, b);
    if (!way) return false;
    let run = 0; for (let i = 1; i < way.length; i++) run += Math.hypot(xOf(way[i]) - xOf(way[i - 1]), zOf(way[i]) - zOf(way[i - 1]));
    return run <= Math.hypot(q.x - p.x, q.z - p.z) * DETOUR + 0.5;
  });
  const shapeStops = (rand, under) => {
    const { nodes, edges } = graph, from = nodes.map(() => []);
    edges.forEach((e, i) => { from[e.a].push(i); from[e.b].push(i); });
    let startNode = from.findIndex(list => list.length); // the nearest with an aisle left
    if (startNode < 0) return null;
    nodes.forEach((p, i) => { if (from[i].length && Math.hypot(p.x - start.x, p.z - start.z) < Math.hypot(nodes[startNode].x - start.x, nodes[startNode].z - start.z)) startNode = i; });
    // Depth first from the start, each node's ways tried in a weighted random order, backing up from a dead end or a lap that
    // won't do, for at most SEARCH steps (a walk that never backs up all but never closed a lap in an aisle grid that's a ladder).
    const used = new Set(), seen = new Map([[startNode, 1]]), trail = [startNode], via = [], across = new Map(); // across: went straight over it
    let budget = SEARCH, fallback = null;
    // The ways on from `at`, come along `way`: none used yet, and over a node already passed only straight on, and only if
    // the first pass went straight over too (a crossing, an X: a T has a kerb's gap open onto the floor).
    const ways = (at, way) => {
      const options = from[at].flatMap(i => {
        if (used.has(i)) return [];
        const e = edges[i], to = e.a === at ? e.b : e.a, dx = nodes[to].x - nodes[at].x, dz = nodes[to].z - nodes[at].z, d = Math.hypot(dx, dz), straight = way && (dx * way[0] + dz * way[1]) / d > 0.9;
        if (seen.get(at) > 1 && (!straight || at !== startNode && !across.get(at))) return [];
        return [[i, (e.tunnel ? UNDER : e.outer ? 1 : INNER) * (way && !straight ? 1.5 : 1)]];
      }), order = [];
      while (options.length) {
        let pick = rand() * options.reduce((sum, [, w]) => sum + w, 0), j = 0;
        while (j < options.length - 1 && (pick -= options[j][1]) > 0) j++;
        order.push(options.splice(j, 1)[0][0]);
      }
      return order;
    };
    // A closed trail as a lap: its corners turn both ways, at least BENDS against the way round (a plain rectangle round one pod
    // turns one way only: round again; one turn against it is a shallow notch). → { stops, crossings } or null.
    const lap = () => {
      let lefts = 0, rights = 0;
      for (let i = 0; i < trail.length - 1; i++) {
        const p = nodes[trail[(i - 1 + trail.length - 1) % (trail.length - 1)]], q = nodes[trail[i]], r = nodes[trail[i + 1]];
        const turn = (q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x), size = Math.hypot(q.x - p.x, q.z - p.z) * Math.hypot(r.x - q.x, r.z - q.z);
        if (turn > 0.5 * size) lefts++; else if (turn < -0.5 * size) rights++;
      }
      if (Math.min(lefts, rights) < BENDS) return null;
      const cells = trail.map(n => nearCell(nodes[n].x, nodes[n].z));
      if (cells.some(k => k < 0)) return null;
      // Each node a stop, but a tunnel's two a single one, with the straight line under the desks between them.
      const stops = [];
      for (let i = 0; i < via.length; i++) {
        const p = nodes[trail[i]], q = nodes[trail[i + 1]];
        if (edges[via[i]].tunnel) {
          const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.1);
          stops.push({ arrive: cells[i], leave: cells[i + 1], inner: Array.from({ length: steps + 1 }, (_, k) => [p.x + (q.x - p.x) * k / steps, p.z + (q.z - p.z) * k / steps]) });
        } else if (!(i > 0 && edges[via[i - 1]].tunnel)) stops.push({ arrive: cells[i], leave: cells[i], inner: [] }); // a tunnel's way out is a stop already
      }
      const crossings = [...seen].filter(([n, times]) => times > 1 && n !== startNode).map(([n]) => [nodes[n].x, nodes[n].z]);
      return { stops, crossings };
    };
    const walk = (at, way, length) => {
      if (--budget < 0) return null;
      // A lap: on a day for going `under` the desks the first through a tunnel, else the first that crosses itself (a figure of
      // eight); failing that, the first that does.
      if (at === startNode && used.size >= 6) { const found = lap(); if (found && (under ? via.some(i => edges[i].tunnel) : found.crossings.length)) return found; fallback ||= found; return null; }
      if (seen.get(at) > 2 || length > LONGEST * 1.1) return null;
      for (const i of ways(at, way)) {
        const e = edges[i], to = e.a === at ? e.b : e.a, d = Math.hypot(nodes[to].x - nodes[at].x, nodes[to].z - nodes[at].z);
        const next = [(nodes[to].x - nodes[at].x) / d, (nodes[to].z - nodes[at].z) / d], first = seen.get(at) === 1 && !across.has(at);
        if (first) across.set(at, !!way && way[0] * next[0] + way[1] * next[1] > 0.9);
        used.add(i); via.push(i); trail.push(to); seen.set(to, (seen.get(to) || 0) + 1);
        const found = walk(to, next, length + d);
        if (found) return found;
        seen.set(to, seen.get(to) - 1); trail.pop(); via.pop(); used.delete(i);
        if (first) across.delete(at);
        if (budget < 0) return null;
      }
      return null;
    };
    return walk(startNode, null, 0) || fallback;
  };
  // A tunnel day or not: the second draw, as the first of seeds that differ only at the end (a day's, say) bunch up.
  const day = mulberry32(fnv1a(`rc-under:${seed}`)); day();
  const under = day() < UNDER_DAYS;
  for (let attempt = 0, found = 0; attempt < ATTEMPTS + PLAIN && found < CHOICES; attempt++) {
    if (attempt === ATTEMPTS && chosen) break; // the plain ones are only for when nothing else worked
    const rand = mulberry32(fnv1a(`rc:${seed}:${attempt}`)), plain = attempt >= ATTEMPTS;
    // Two tries in three (an office with pods) trace the outline of a group of them; the rest go the shortest way round points
    // and a tunnel or two.
    const shaped = grid && !plain && attempt % 3 !== 1 ? shapeStops(rand, under) : null, stops = shaped ? shaped.stops : tripStops(rand, plain, attempt), crossings = shaped?.crossings || [];
    if (!stops) continue;
    const path = [];
    let joined = true;
    for (let i = 0; i < stops.length && joined; i++) {
      path.push(...stops[i].inner);
      const leg = join(stops[i].leave, stops[(i + 1) % stops.length].arrive);
      if (!leg) joined = false; else path.push(...leg.slice(stops[i].inner.length ? 1 : 0, -1).map(k => [xOf(k), zOf(k)]));
    }
    if (!joined) continue;
    erase(path);
    let run = 0; for (let i = 0; i < path.length; i++) { const p = path[i], q = path[(i + 1) % path.length]; run += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    if (run > LONGEST * 1.2) { reach *= 0.8; continue; }
    const circuit = smooth(path, map, rand, crossings);
    if (circuit?.tooLong) { reach *= 0.85; continue; }
    // Of those that work, the one that turns most the other way (a lap that weaves), going under desks counting for half a turn
    // more, and bays (how much of its hull it leaves out) for BAYS turns each, as long as it's no shorter than SHORTEST.
    if (circuit && (plain || circuit.length >= SHORTEST)) {
      found++;
      const under = Array.from({ length: circuit.points.length / 2 }, (_, i) => i).some(i => map.roofed(circuit.points[i * 2], circuit.points[i * 2 + 1]));
      circuit.varied = minority(circuit.points) + (under ? 3 * Math.PI : 0) + (1 - fill(circuit.points)) * BAYS + (shaped ? TRAIL : 0);
      if (!chosen || circuit.varied > chosen.varied) chosen = circuit;
    }
  }
  if (!chosen) return null;
  const circuit = finish(chosen, seed, start);
  placeRamps(circuit, map, mulberry32(fnv1a(`rc-ramps:${seed}`)));
  return circuit;
}

// The tunnels, on the fine map: under something flat (a row of desks, a table), the line down its middle along x or z (where
// it's clearest across: the routing grid's cells are too coarse to find it), clear all along, coming out onto free floor
// OUT_PAST (m) beyond each end. A row counts as one, though its desks' tops leave a gap where they meet.
// → [{ a, b: its ends [x, z]; x, z: its middle }].
function findRows(map, room) {
  const left = room.left ?? 0, back = room.back ?? 0, cols = Math.floor(room.width / COARSE), rows = Math.floor(room.depth / COARSE);
  const found = [], lines = new Set();
  for (let k = 0; k < cols * rows; k++) {
    const cx = left + (k % cols + 0.5) * COARSE, cz = back + (Math.floor(k / cols) + 0.5) * COARSE;
    if (!map.roofed(cx, cz)) continue;
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      let off = 0, most = 0;
      for (let o = -0.2; o <= 0.2001; o += 0.01) { const c = map.clearance(cx + az * o, cz + ax * o); if (c > most) { most = c; off = o; } }
      if (most < CLEAR + 0.01) continue;
      const x0 = cx + az * off, z0 = cz + ax * off;
      const end = sign => {
        for (let t = 0.05, outside = 0; t < 12; t += 0.05) {
          const x = x0 + ax * sign * t, z = z0 + az * sign * t;
          if (map.clearance(x, z) < CLEAR + 0.01) return null;
          if (map.roofed(x, z)) { outside = 0; continue; }
          if ((outside += 0.05) >= OUT_PAST && map.clearance(x, z) >= OPEN_END) return [x, z];
          if (outside > ROOM_FOR) return null;
        }
        return null;
      };
      const a = end(-1), b = end(1);
      if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < MIN_TUNNEL + 2 * OUT_PAST) continue;
      const line = `${ax}:${(ax ? z0 : x0).toFixed(1)}:${(ax ? a[0] : a[1]).toFixed(0)}`;
      if (lines.has(line)) continue;
      lines.add(line);
      found.push({ a, b, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
    }
  }
  return found;
}

// Ramps (rc-physics.js's: { x, z, yaw, w, l, h, glider }): small ones for a hop, and a glider ramp that throws a car up over
// a row of desks on its paper wing. A glider ramp's lip goes one of LIP_BACK (m) short of the row, tried in turn.
const HOP = { w: WIDTH, l: 0.4, h: 0.1, glider: false }, GLIDER = { w: WIDTH, l: 0.4, h: 0.15, glider: true }, LIP_BACK = [0.7, 0.8, 0.6, 0.9];
// A lap's small ramps: RAMPS, on a straight (within STRAIGHT_RAMP (m) of the line it faces along, from RUN_UP (m) before to
// RUN_OUT after: where it runs up straight, and lands on the track),
// RAMPS_APART (m) apart along it, NOT_NEAR (m) from any other part of the lap. Just driving: up to SCATTER on open floor with
// RUN_UP and RUN_OUT + 0.7 clear of anything by ROOM (m), and up to GLIDERS glider ramps. A hop flies ~1.4 m.
const RAMPS = [2, 4], STRAIGHT_RAMP = 0.12, RUN_UP = 1.2, RUN_OUT = 1.6, RAMPS_APART = 3, NOT_NEAR = 1.1, SCATTER = 8, ROOM = 0.36, GLIDERS = 3, GLIDE_TRIES = 40;

// A jump off `ramp` from 1.5 m before it, flat out at `speed` (felt m/s) straight on, till it lands: where the car was each step
// in the air ({ x, y, z }), whether its wing came out, and where it landed (y over 0 on a desk); null if it met anything (people,
// `columns`, too).
function arc(ramp, map, speed, columns = []) {
  const fx = Math.sin(ramp.yaw), fz = Math.cos(ramp.yaw), car = newCar({ x: ramp.x - fx * 1.5, z: ramp.z - fz * 1.5, yaw: ramp.yaw });
  Object.assign(car, { vx: fx * speed, vz: fz * speed, fwd: speed });
  const world = { solids: map, columns, ramps: [ramp] }, events = [], path = [];
  let unfolded = false;
  for (let t = 0; t < 6; t += STEP) {
    events.length = 0; step(car, { throttle: 1, steer: 0, drift: false }, world, STEP, events);
    if (car.air) path.push({ x: car.x, y: car.y, z: car.z });
    for (const e of events) {
      if (e.type === 'bump') return null;
      if (e.type === 'unfold') unfolded = true;
      if (e.type === 'land') return { path, unfolded, x: car.x, z: car.z, y: car.y };
    }
  }
  return null;
}
// A glider ramp's flight: where it lands, if its wing came out and it met nothing; else null.
const flight = (ramp, map, speed, columns) => { const a = arc(ramp, map, speed, columns); return a?.unfolded ? a : null; };
// A glider ramp's flight flat out comes down on the floor (or anywhere, `onTop`: on a desk too), and slower meets nothing either
// (it may come down on the desks it was to fly over, and drive off their end). → where it lands flat out, or null.
const flies = (ramp, map, onTop = false, columns = []) => { const fast = flight(ramp, map, TUNE.top, columns); return fast && (onTop || fast.y === 0) && flight(ramp, map, TUNE.top * 0.8, columns) ? fast : null; };
// Clear of people (columns: [{ x, z, r }], as the car meets them) by `pad` (m).
const clearOf = (columns, x, z, pad) => columns.every(c => Math.hypot(c.x - x, c.z - z) >= c.r + pad);

// The lap's small ramps, into circuit.ramps: on straights, away from the start, not under desks, and where the lap doesn't
// pass. (No glider ramp on a lap: most laps follow the aisles, and turn into a row of desks at the crossing just before it,
// so there's no straight to run up to one. Just driving has them.)
function placeRamps(circuit, map, rand) {
  const { points, length } = circuit, count = points.length / 2, per = length / count, at = i => (i % count + count) % count;
  const straight = (i, before, after) => {
    const f = frame(circuit, i);
    for (let k = -Math.round(before / per); k <= Math.round(after / per); k++) { const j = at(i + k); if (Math.abs((points[j * 2] - f.x) * -f.fz + (points[j * 2 + 1] - f.z) * f.fx) > STRAIGHT_RAMP) return false; }
    return true;
  };
  const under = Array.from({ length: count }, (_, i) => map.roofed(points[i * 2], points[i * 2 + 1])), taken = [];
  const want = RAMPS[0] + Math.floor(rand() * (RAMPS[1] - RAMPS[0] + 1)), apart = Math.ceil(1.5 / per);
  const tries = Array.from({ length: Math.floor(count / 5) }, (_, k) => k * 5).sort(() => rand() - 0.5);
  for (const i of tries) {
    if (circuit.ramps.length >= want) break;
    const s = i * per;
    if (s < 1.5 || s > length - 1.5 || taken.some(([a, b]) => s >= a && s <= b) || !straight(i, RUN_UP, RUN_OUT)) continue;
    let ok = true;
    for (let k = -Math.round(0.3 / per); k <= Math.round(1.2 / per) && ok; k++) ok = !under[at(i + k)];
    for (let j = 0; j < count && ok; j++) {
      const along = Math.min(Math.abs(j - i), count - Math.abs(j - i));
      if (along >= apart && Math.hypot(points[j * 2] - points[i * 2], points[j * 2 + 1] - points[i * 2 + 1]) <= NOT_NEAR) ok = false;
    }
    if (!ok) continue;
    const f = frame(circuit, i);
    circuit.ramps.push({ x: f.x, z: f.z, yaw: Math.atan2(f.fx, f.fz), ...HOP, s }); taken.push([s - RAMPS_APART, s + RAMPS_APART]);
  }
}

// Where a car can drive to from `start`: through FINE (m) squares with its radius (and a little) clear, from square to
// square. (Clearance alone takes a boxed-in space, under a sofa say, for open floor.) → reached(x, z).
const FINE = 0.05;
function drivable(map, room, start) {
  const left = room.left ?? 0, back = room.back ?? 0, cols = Math.ceil(room.width / FINE), rows = Math.ceil(room.depth / FINE), seen = new Uint8Array(cols * rows);
  const cell = (x, z) => { const i = Math.floor((x - left) / FINE), j = Math.floor((z - back) / FINE); return i >= 0 && j >= 0 && i < cols && j < rows ? j * cols + i : -1; };
  const fits = k => map.clearance(left + (k % cols + 0.5) * FINE, back + (Math.floor(k / cols) + 0.5) * FINE) >= R + 0.02;
  const first = cell(start.x, start.z), queue = first >= 0 ? [first] : [];
  if (first >= 0) seen[first] = 1;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % cols, j = Math.floor(k / cols);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, n = b * cols + a; if (a >= 0 && b >= 0 && a < cols && b < rows && !seen[n] && fits(n)) { seen[n] = 1; queue.push(n); } }
  }
  return (x, z) => { const k = cell(x, z); return k >= 0 && seen[k] === 1; };
}

// Collect: COLLECT paperclips a day, PICK_APART (m) apart and from the start: up to HOP_CLIPS at the top of a hop off a small
// ramp (flat out), one along each glide where it's over a desk, UNDER_CLIPS under desks, the rest on open floor, each CAR_MID
// up (a car's middle). A car takes one within PICK_R (m) across of its middle (its side brushing past it, and some) and
// PICK_H up or down: generous, as a paperclip's glow looks bigger than it is.
const PICK_R = 0.22, PICK_H = 0.2, COLLECT = 10, PICK_APART = 1, HOP_CLIPS = 3, UNDER_CLIPS = 2, CAR_MID = 0.04;
export const reaches = (car, clip) => Math.hypot(clip.x - car.x, clip.z - car.z) < PICK_R && Math.abs(clip.y - car.y - CAR_MID) < PICK_H;
// → [{ x, y, z, kind: 'hop' | 'glide' | 'under' | 'floor' }], or fewer where the office hasn't the room. Clear of people.
export function placePickups({ map, room, start, seed, ramps, columns = [] }) {
  if (!map?.clearance) return [];
  const rand = mulberry32(fnv1a(`rc-collect:${seed}`)), clips = [], reached = drivable(map, room, start);
  const fits = (x, z) => Math.hypot(x - start.x, z - start.z) > PICK_APART && clips.every(p => Math.hypot(p.x - x, p.z - z) >= PICK_APART);
  const put = (x, y, z, kind) => { if (clips.length < COLLECT && fits(x, z) && clearOf(columns, x, z, 0.2)) { clips.push({ x, y: y + CAR_MID, z, kind }); return true; } return false; };
  for (const r of ramps.filter(r => r.glider)) {
    // Over a desk if it flies one, else at the top of its arc.
    const path = arc(r, map, TUNE.top, columns)?.path ?? [], over = path.filter(p => map.roofed(p.x, p.z) && p.y > 0.8);
    const p = over.length ? over[over.length >> 1] : path.reduce((a, b) => !a || b.y > a.y ? b : a, null);
    if (p) put(p.x, p.y, p.z, 'glide');
  }
  for (const r of ramps.filter(r => !r.glider).sort(() => rand() - 0.5)) {
    if (clips.filter(p => p.kind === 'hop').length >= HOP_CLIPS) break;
    const path = arc(r, map, TUNE.top, columns)?.path;
    if (path?.length) { const top = path.reduce((a, b) => b.y > a.y ? b : a); put(top.x, top.y, top.z, 'hop'); }
  }
  const left = room.left ?? 0, back = room.back ?? 0, cols = Math.floor(room.width / COARSE), rows = Math.floor(room.depth / COARSE);
  const cells = Array.from({ length: cols * rows }, (_, k) => [left + (k % cols + 0.5) * COARSE, back + (Math.floor(k / cols) + 0.5) * COARSE]).sort(() => rand() - 0.5);
  for (const [x, z] of cells) if (clips.filter(p => p.kind === 'under').length < UNDER_CLIPS && map.roofed(x, z) && map.clearance(x, z) >= R + 0.1 && reached(x, z)) put(x, 0, z, 'under');
  for (const [x, z] of cells) if (!map.roofed(x, z) && map.clearance(x, z) >= 0.3 && reached(x, z)) put(x, 0, z, 'floor');
  return clips;
}

// Just driving, no track: ramps scattered on the open floor (seeded by `seed`, the day and the office), each with room to run up
// to it and land, and up to GLIDERS glider ramps (before rows of desks, at a desk or table, or anywhere with room to fly), each
// flight checked clear (flies). Clear of people (`columns`), as of walls.
export function scatterRamps({ map, room, start, seed, columns = [] }) {
  if (!map?.clearance) return [];
  const rand = mulberry32(fnv1a(`rc-free:${seed}`)), ramps = [], far = (x, z, d) => ramps.every(r => Math.hypot(r.x - x, r.z - z) >= d), reached = drivable(map, room, start);
  const runUp = r => reached(r.x - Math.sin(r.yaw) * RUN_UP, r.z - Math.cos(r.yaw) * RUN_UP); // it can be driven at
  // Its way, from RUN_UP before it to `after` past it, clear of people.
  const passable = (r, after) => { for (let u = -RUN_UP; u <= after + 1e-9; u += 0.1) if (!clearOf(columns, r.x + Math.sin(r.yaw) * u, r.z + Math.cos(r.yaw) * u, R + 0.02)) return false; return true; };
  for (const row of findRows(map, room).sort(() => rand() - 0.5)) {
    for (const [p, q] of [[row.a, row.b], [row.b, row.a]]) {
      if (ramps.length >= GLIDERS) break;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]), dx = (q[0] - p[0]) / d, dz = (q[1] - p[1]) / d;
      let into = 0; while (into < d && !map.roofed(p[0] + dx * into, p[1] + dz * into)) into += 0.05;
      for (const back of LIP_BACK) {
        const u = into - back - GLIDER.l / 2, r = { x: p[0] + dx * u, z: p[1] + dz * u, yaw: Math.atan2(dx, dz), ...GLIDER };
        if (far(r.x, r.z, 3) && Math.hypot(r.x - start.x, r.z - start.z) > 2 && runUp(r) && passable(r, 0.5) && flies(r, map, false, columns)) { ramps.push(r); break; }
      }
    }
  }
  const left = room.left ?? 0, back = room.back ?? 0, cols = Math.floor(room.width / COARSE), rows = Math.floor(room.depth / COARSE);
  const cells = Array.from({ length: cols * rows }, (_, k) => k).sort(() => rand() - 0.5);
  // No rows to fly along (or not enough): at anything flat to fly over (a desk across, a table), straight at it from open floor;
  // coming down on it is fine, just driving. Tried from a few hundred spots.
  for (const k of cells.slice(0, 400)) {
    if (ramps.length >= GLIDERS) break;
    const x = left + (k % cols + 0.5) * COARSE, z = back + (Math.floor(k / cols) + 0.5) * COARSE;
    if (map.clearance(x, z) < OPEN || Math.hypot(x - start.x, z - start.z) <= 2 || !far(x, z, 3)) continue;
    for (const yaw of [0, 1, 2, 3].map(q => q * Math.PI / 2)) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      let into = 0.6; while (into < 2.5 && !map.roofed(x + fx * into, z + fz * into)) into += 0.05;
      if (into >= 2.5) continue;
      const u = into - LIP_BACK[0] - GLIDER.l / 2, r = { x: x + fx * u, z: z + fz * u, yaw, ...GLIDER };
      if (runUp(r) && passable(r, 0.5) && flies(r, map, true, columns)) { ramps.push(r); break; }
    }
  }
  // Still room for more: anywhere on open floor with a clear run-up, flying wherever it goes (onto a desk is fine).
  for (let k = 0, tries = 0; k < cells.length && ramps.length < GLIDERS && tries < GLIDE_TRIES; k++) {
    const x = left + (cells[k] % cols + 0.5) * COARSE, z = back + (Math.floor(cells[k] / cols) + 0.5) * COARSE, yaw = Math.floor(rand() * 4) * Math.PI / 2;
    if (map.clearance(x, z) < OPEN || Math.hypot(x - start.x, z - start.z) <= 2 || !far(x, z, 3)) continue;
    const r = { x, z, yaw, ...GLIDER };
    let clear = runUp(r) && passable(r, 0.5);
    for (let u = -1.5; u <= 1 && clear; u += 0.05) clear = map.clearance(x + Math.sin(yaw) * u, z + Math.cos(yaw) * u) >= ROOM;
    if (!clear) continue;
    tries++;
    if (flies(r, map, true, columns)) ramps.push(r);
  }
  for (const k of cells) {
    if (ramps.length >= SCATTER + GLIDERS) break;
    const x = left + (k % cols + 0.5) * COARSE, z = back + (Math.floor(k / cols) + 0.5) * COARSE, yaw = Math.floor(rand() * 4) * Math.PI / 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
    if (Math.hypot(x - start.x, z - start.z) <= 1.2 || !far(x, z, 2)) continue;
    let ok = true;
    for (let u = -RUN_UP; u <= RUN_OUT + 0.7 + 1e-9 && ok; u += 0.05) ok = map.clearance(x + fx * u, z + fz * u) >= ROOM && !map.roofed(x + fx * u, z + fz * u);
    if (ok && runUp({ x, z, yaw }) && passable({ x, z, yaw }, RUN_OUT + 0.7)) ramps.push({ x, z, yaw, ...HOP });
  }
  return ramps;
}

// Cuts, in place, every out-and-back from the joined way ([x, z]s): where it comes back within SPIKE (m) of where it was, less
// than LOOP (m) of way before, having gone round next to nothing (under FLAT m²), what's between goes. A control point down a
// corridor, then the next one back up it, makes such a spike, and no smoothing rounds it; a way round a desk encloses the desk.
const SPIKE = 0.25, LOOP = 4, FLAT = 0.5;
function erase(path) {
  const area = (i, j) => { let sum = 0; for (let k = i; k <= j; k++) { const a = path[k], b = path[k === j ? i : k + 1]; sum += a[0] * b[1] - b[0] * a[1]; } return Math.abs(sum) / 2; };
  for (let i = 0; i < path.length; i++) {
    for (let j = i + 3, run = 0; j < path.length; j++) {
      run += Math.hypot(path[j][0] - path[j - 1][0], path[j][1] - path[j - 1][1]); if (run > LOOP) break;
      if (Math.hypot(path[j][0] - path[i][0], path[j][1] - path[i][1]) <= SPIKE && area(i, j) < FLAT) { path.splice(i + 1, j - i - 1); break; }
    }
  }
}

// The joined cells as a closed line, resampled every ≤ ROUGH and relaxed, pass after pass, toward each point's neighbours
// (never nearer anything than CLEAR allows) until no corner is tighter than SHARPEST; a closed centripetal Catmull-Rom through
// those, sampled every ≤ SPACING. Null if the corners won't come round, it strays near anything or runs alongside itself;
// { tooLong } if it's over LONGEST.
function smooth(path, map, rand, crossings = []) {
  const rough = resample(path, ROUGH), count = rough.length / 2;
  if (count < 8) return null;
  const fits = () => sharpest(rough, 1) <= SHARPEST * 0.85;
  for (let pass = 0; pass < RELAX && (pass % 5 || !fits()); pass++) {
    const was = Float32Array.from(rough);
    for (let i = 0; i < count; i++) {
      const a = (i - 1 + count) % count, b = (i + 1) % count, x = (was[a * 2] + was[b * 2]) / 2, z = (was[a * 2 + 1] + was[b * 2 + 1]) / 2;
      if (map.clearance(x, z) >= CLEAR + 0.01 || map.clearance(x, z) >= map.clearance(was[i * 2], was[i * 2 + 1])) { rough[i * 2] = x; rough[i * 2 + 1] = z; }
    }
    // And pushed away from anything nearer than WANT (m), up the clearance's slope: smoothing alone only pulls a bend inward,
    // and a bend round a pod's corner then pins against it; pushed out, it can swing wide round it instead.
    for (let i = 0; i < count; i++) {
      const x = rough[i * 2], z = rough[i * 2 + 1], c = map.clearance(x, z); if (c >= WANT) continue;
      const gx = map.clearance(x + 0.05, z) - map.clearance(x - 0.05, z), gz = map.clearance(x, z + 0.05) - map.clearance(x, z - 0.05), g = Math.hypot(gx, gz);
      if (g < 1e-6) continue;
      const by = Math.min(PUSH, (WANT - c) * 0.5), nx = x + gx / g * by, nz = z + gz / g * by;
      if (map.clearance(nx, nz) > c) { rough[i * 2] = nx; rough[i * 2 + 1] = nz; }
    }
  }
  if (!fits()) return null;
  chicanes(rough, map, rand);
  const apart = Math.ceil(ALONG / rough.spacing);
  for (let i = 0; i < count; i++) for (let j = i + apart; j < count - apart + i && j < count; j++) {
    if (Math.hypot(rough[i * 2] - rough[j * 2], rough[i * 2 + 1] - rough[j * 2 + 1]) < WIDTH + GAP && !crossings.some(([x, z]) => Math.hypot(rough[i * 2] - x, rough[i * 2 + 1] - z) < CROSS)) return null;
  }
  const spline = new THREE.CatmullRomCurve3(Array.from({ length: count }, (_, i) => new THREE.Vector3(rough[i * 2], 0, rough[i * 2 + 1])), true, 'centripetal');
  spline.arcLengthDivisions = count * 20; spline.updateArcLengths();
  const length = spline.getLength();
  if (length > LONGEST) return { tooLong: true };
  const n = Math.ceil(length / (SPACING * 0.98)), spaced = spline.getSpacedPoints(n), points = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { points[i * 2] = spaced[i].x; points[i * 2 + 1] = spaced[i].z; }
  for (let i = 0; i < n; i++) if (map.clearance(points[i * 2], points[i * 2 + 1]) < CLEAR) return null;
  if (sharpest(points, 3) > SHARPEST) return null;
  return { points, length };
}

// Chicanes: on the straightest stretches the line swings out and back, an S (one way, then the other), as wide as the floor
// allows, so a lap round the room turns both ways, not only round. Up to CHICANES a lap, each CHICANE (m) long, swinging up to
// SWING (m) out, on stretches no sharper than STRAIGHT (1/m); its shape, sin(2πu)·sin²(πu), starts and ends straight.
const CHICANES = 3, CHICANE = 4, SWING = 0.5, STRAIGHT = 0.5, PEAK = 0.65;
function chicanes(rough, map, rand) {
  const count = rough.length / 2, len = Math.round(CHICANE / rough.spacing), used = new Uint8Array(count), was = Float32Array.from(rough);
  const normal = i => { const a = (i - 1 + count) % count, b = (i + 1) % count, fx = was[b * 2] - was[a * 2], fz = was[b * 2 + 1] - was[a * 2 + 1], d = Math.hypot(fx, fz) || 1; return [-fz / d, fx / d]; };
  for (let tries = 0, placed = 0; tries < 30 && placed < CHICANES; tries++) {
    const start = Math.floor(rand() * count), side = rand() < 0.5 ? 1 : -1;
    let straight = true;
    for (let t = -2; t <= len + 2 && straight; t++) { const i = (start + t + count) % count; if (used[i] || curve(was, i, 1) > STRAIGHT) straight = false; }
    if (!straight) continue;
    for (let swing = SWING; swing >= 0.2; swing -= 0.05) {
      const moved = [];
      for (let t = 0; t <= len; t++) {
        const i = (start + t) % count, [nx, nz] = normal(i), u = t / len, off = side * swing / PEAK * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u) ** 2;
        moved.push([i, was[i * 2] + nx * off, was[i * 2 + 1] + nz * off]);
      }
      if (!moved.every(([, x, z]) => map.clearance(x, z) >= CLEAR + 0.03)) continue;
      for (const [i, x, z] of moved) { rough[i * 2] = x; rough[i * 2 + 1] = z; }
      if (moved.every(([i]) => curve(rough, i, 1) <= SHARPEST * 0.85)) { for (const [i] of moved) used[i] = 1; placed++; break; }
      for (const [i] of moved) { rough[i * 2] = was[i * 2]; rough[i * 2 + 1] = was[i * 2 + 1]; }
    }
  }
}

// A closed line through `path` ([x, z]s) at even steps of at most `most` × 0.98 (so the last, back to the start, is within it).
function resample(path, most) {
  const n = path.length, run = [0];
  for (let i = 1; i <= n; i++) run.push(run[i - 1] + Math.hypot(path[i % n][0] - path[i - 1][0], path[i % n][1] - path[i - 1][1]));
  const total = run[n], count = Math.max(1, Math.ceil(total / (most * 0.98))), spacing = total / count, points = new Float32Array(count * 2);
  points.spacing = spacing;
  for (let k = 0, i = 0; k < count; k++) {
    const at = k * spacing; while (run[i + 1] < at) i++;
    const t = (at - run[i]) / Math.max(1e-9, run[i + 1] - run[i]), a = path[i], b = path[(i + 1) % n];
    points[k * 2] = a[0] + (b[0] - a[0]) * t; points[k * 2 + 1] = a[1] + (b[1] - a[1]) * t;
  }
  return points;
}

// The pods' grid (room: { pods (col, row, x, z, width, depth), cellW, width, depth }), as its aisles: xs[c], the line down the
// aisle left of column c (xs[cols], right of the last), zs[r] across the aisle in front of row r (zs[rows], behind the last).
function podGrid({ pods, cellW, width, depth }) {
  const cols = Math.max(...pods.map(p => p.col)) + 1, rows = Math.max(...pods.map(p => p.row)) + 1, left = pods[0].x - pods[0].width / 2 - pods[0].col * cellW;
  const right = c => left + c * cellW + Math.max(0, ...pods.filter(p => p.col === c).map(p => p.width));
  const top = r => Math.min(...pods.filter(p => p.row === r).map(p => p.z - p.depth / 2)), bottom = r => Math.max(...pods.filter(p => p.row === r).map(p => p.z + p.depth / 2));
  const xs = Array.from({ length: cols + 1 }, (_, c) => c === 0 ? left / 2 : c === cols ? (right(cols - 1) + width) / 2 : (right(c - 1) + left + c * cellW) / 2);
  const zs = Array.from({ length: rows + 1 }, (_, r) => r === 0 ? top(0) / 2 : r === rows ? (bottom(rows - 1) + depth) / 2 : (bottom(r - 1) + top(r)) / 2);
  return { cols, rows, xs, zs };
}

// The aisles of the pods' grid as a graph: nodes where they cross, edges along them to the next node (`outer` along the walls),
// and each tunnel along a row of desks (`tunnels`, from makeCircuit) as an edge across its pod, between the aisle lines either
// side at the row (splitting those). → { nodes: [{ x, z }], edges: [{ a, b, outer, tunnel }] }.
function aisleGraph({ cols, rows, xs, zs }, tunnels, map) {
  const nodes = [], edges = [], node = (x, z) => { let i = nodes.findIndex(p => Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.05); if (i < 0) { i = nodes.length; nodes.push({ x, z }); } return i; };
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) node(xs[c], zs[r]);
  for (const t of tunnels) {
    if (Math.abs(t.a[1] - t.b[1]) > 0.01) continue; // rows of desks run along x
    // Its ends to the aisle lines nearest them (within SNAP), if it's clear straight on that far.
    const z = t.a[1], lo = Math.min(t.a[0], t.b[0]), hi = Math.max(t.a[0], t.b[0]);
    const left = xs.filter(x => x < t.x && Math.abs(x - lo) <= SNAP).sort((p, q) => Math.abs(p - lo) - Math.abs(q - lo))[0], right = xs.filter(x => x > t.x && Math.abs(x - hi) <= SNAP).sort((p, q) => Math.abs(p - hi) - Math.abs(q - hi))[0];
    if (left === undefined || right === undefined) continue;
    let clear = true; for (let x = left; x <= right && clear; x += 0.05) clear = map.clearance(x, z) >= CLEAR + 0.01;
    if (clear) edges.push({ a: node(left, z), b: node(right, z), tunnel: true });
  }
  xs.forEach((x, c) => { const on = nodes.map((p, i) => [p, i]).filter(([p]) => Math.abs(p.x - x) < 0.05).sort(([p], [q]) => p.z - q.z); for (let k = 1; k < on.length; k++) edges.push({ a: on[k - 1][1], b: on[k][1], outer: c === 0 || c === cols }); });
  zs.forEach((z, r) => { const on = nodes.map((p, i) => [p, i]).filter(([p]) => Math.abs(p.z - z) < 0.05).sort(([p], [q]) => p.x - q.x); for (let k = 1; k < on.length; k++) edges.push({ a: on[k - 1][1], b: on[k][1], outer: r === 0 || r === rows }); });
  return { nodes, edges };
}

// How much of its convex hull a closed line fills: near 1 round or oval, less with a bay in it.
function fill(points) {
  const n = points.length / 2, pts = Array.from({ length: n }, (_, i) => [points[i * 2], points[i * 2 + 1]]);
  const area = p => Math.abs(p.reduce((sum, [x, z], i) => { const [nx, nz] = p[(i + 1) % p.length]; return sum + x * nz - nx * z; }, 0)) / 2;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const q of sorted) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of sorted.reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return area(pts) / area([...lo.slice(0, -1), ...hi.slice(0, -1)]);
}

// How far (rad) a closed line turns its lesser way round, in steps of 5 samples: a round loop turns one way only, a lap that
// weaves turns both.
function minority(points) {
  const n = points.length / 2, k = 5, p = i => [points[(i % n) * 2], points[(i % n) * 2 + 1]];
  let left = 0, right = 0;
  for (let i = 0; i < n; i += k) {
    const [ax, az] = p(i), [bx, bz] = p(i + k), [cx, cz] = p(i + 2 * k);
    let d = Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - ax, bz - az); d = Math.atan2(Math.sin(d), Math.cos(d));
    if (d > 0) left += d; else right -= d;
  }
  return Math.min(left, right);
}

// The sharpest corner on a closed line (1/m): Menger curvature over points `k` apart (one 5 cm apart is noise).
function sharpest(points, k) {
  const count = points.length / 2;
  let most = 0;
  for (let i = 0; i < count; i++) most = Math.max(most, curve(points, i, k));
  return most;
}
function curve(points, i, k = 3) {
  const count = points.length / 2, a = (i - k + count) % count, b = (i + k) % count;
  const ax = points[a * 2], az = points[a * 2 + 1], px = points[i * 2], pz = points[i * 2 + 1], bx = points[b * 2], bz = points[b * 2 + 1];
  const area2 = Math.abs((px - ax) * (bz - az) - (pz - az) * (bx - ax)), sides = Math.hypot(px - ax, pz - az) * Math.hypot(bx - px, bz - pz) * Math.hypot(bx - ax, bz - az);
  return sides > 1e-9 ? 2 * area2 / sides : 0;
}

// The rest of a circuit from its centreline: the racing line, curvature, the grid and its key.
function finish({ points: loop, length }, seed, start) {
  // From the sample nearest the start (the dock), so the line and the grid are by it.
  let first = 0, best = Infinity;
  for (let i = 0; i < loop.length / 2; i++) { const d = (loop[i * 2] - start.x) ** 2 + (loop[i * 2 + 1] - start.z) ** 2; if (d < best) { best = d; first = i; } }
  const points = new Float32Array(loop.length);
  for (let i = 0; i < loop.length / 2; i++) { const k = (i + first) % (loop.length / 2); points[i * 2] = loop[k * 2]; points[i * 2 + 1] = loop[k * 2 + 1]; }
  const count = points.length / 2, at = i => (i % count + count) % count;
  const line = Float32Array.from(points);
  for (let pass = 0; pass < PASSES; pass++) {
    const was = Float32Array.from(line);
    for (let i = 0; i < count; i++) {
      const a = at(i - 1), b = at(i + 1);
      let x = (was[a * 2] + was[b * 2]) / 2, z = (was[a * 2 + 1] + was[b * 2 + 1]) / 2;
      const dx = x - points[i * 2], dz = z - points[i * 2 + 1], d = Math.hypot(dx, dz);
      if (d > LINE_OFF) { x = points[i * 2] + dx * LINE_OFF / d; z = points[i * 2 + 1] + dz * LINE_OFF / d; }
      line[i * 2] = x; line[i * 2 + 1] = z;
    }
  }
  const curvature = Float32Array.from({ length: count }, (_, i) => curve(points, i));
  // A kerb opens, each side on its own, only where another part of the road (more than ALONG along the lap away) comes through
  // it: where it and a little past it (GAP_PAST) are both inside that part's kerbs. Off the road at a crossing is onto the
  // other road, then, never the floor.
  const open = { right: new Uint8Array(count), left: new Uint8Array(count) }, apart = Math.ceil(ALONG / (length / count));
  for (let i = 0; i < count; i++) {
    const a = at(i - 1), b = at(i + 1), fx = points[b * 2] - points[a * 2], fz = points[b * 2 + 1] - points[a * 2 + 1], d = Math.hypot(fx, fz) || 1, rx = -fz / d, rz = fx / d;
    for (const [name, side] of [['right', 1], ['left', -1]]) {
      const inside = off => { const x = points[i * 2] + rx * side * off, z = points[i * 2 + 1] + rz * side * off; for (let j = i + apart; j < i + count - apart; j++) { const k = j % count; if (Math.hypot(points[k * 2] - x, points[k * 2 + 1] - z) < KERB - 0.02) return true; } return false; };
      if (inside(KERB) && inside(KERB + GAP_PAST)) open[name][i] = 1;
    }
  }
  const circuit = { points, length, line, curvature, open, checkpoints: [0.25, 0.5, 0.75], ramps: [] };
  circuit.grid = Array.from({ length: SLOTS }, (_, k) => {
    const i = at(-Math.round((ROWS + ROWS * Math.floor(k / 2)) / (length / count))), { x, z, fx, fz } = frame(circuit, i), side = k % 2 ? -ABREAST : ABREAST;
    return { x: x - fz * side, z: z + fx * side, yaw: Math.atan2(fx, fz) };
  });
  circuit.key = fnv1a(`${seed}|${Array.from({ length: Math.ceil(count / 10) }, (_, j) => `${points[j * 20].toFixed(2)},${points[j * 20 + 1].toFixed(2)}`).join(';')}`).toString(36);
  return circuit;
}

// Sample i's point and the way on there (a unit vector).
function frame(circuit, i) {
  const { points } = circuit, count = points.length / 2, a = (i - 1 + count) % count, b = (i + 1) % count;
  const fx = points[b * 2] - points[a * 2], fz = points[b * 2 + 1] - points[a * 2 + 1], d = Math.hypot(fx, fz) || 1;
  return { x: points[i * 2], z: points[i * 2 + 1], fx: fx / d, fz: fz / d };
}

// Where (x, z) is on the circuit: the nearest sample i (within 40 of `near`, when given and it's within LOST of there; else
// anywhere), metres along to it, and metres to the right of the centreline (left negative).
export function project(circuit, x, z, near = -1) {
  const { points, length } = circuit, count = points.length / 2;
  let best = 0, bestD = Infinity;
  const look = i => { const d = (points[i * 2] - x) ** 2 + (points[i * 2 + 1] - z) ** 2; if (d < bestD) { bestD = d; best = i; } };
  if (near >= 0) for (let d = -40; d <= 40; d++) look(((near + d) % count + count) % count);
  // Not near there (onto another part of the road at a crossing, or put somewhere): look everywhere.
  if (near < 0 || bestD > LOST * LOST) for (let i = 0; i < count; i++) look(i);
  const f = frame(circuit, best);
  return { i: best, s: best * length / count, side: (x - f.x) * -f.fz + (z - f.z) * f.fx };
}

// How well NPCs drive, by difficulty: how far off their line they wander (m), how fast they take a corner (of what it
// allows), and mistakes a lap; `drift`: whether it drifts the tight corners; `tricks`: whether it tricks off a hop; `hold`:
// the share of the speed it's after that it's flat out to (it coasts above that: 1, never); `ease`: how much a leader eases off
// ahead of you (the rubber band's other half; BAND unless said); `pace`: its top speed, of everyone's (Hard's engine is a little
// hotter). AUTOPILOT sets par.
export const SKILL = {
  easy: { wander: 0.12, corner: 0.82, mistakes: 0.6, drift: false, tricks: false },
  normal: { wander: 0.05, corner: 0.95, mistakes: 0.2, drift: false, tricks: true, hold: 1, ease: 0.04 },
  hard: { wander: 0.02, corner: 1.08, mistakes: 0.1, drift: true, tricks: true, hold: 1, ease: 0, pace: 1.05 },
};
export const AUTOPILOT = { wander: 0, corner: 0.97, mistakes: 0, drift: true, tricks: false };
// How an NPC drives, from its session's id: steady holds its line; a drifter drifts the tight corners whatever its skill; a
// charger carries CHARGE more into corners and runs WIDER of its line.
export const PERSONALITIES = ['steady', 'drifter', 'charger'];
export const personalityOf = id => PERSONALITIES[fnv1a(String(id)) % PERSONALITIES.length];
const CHARGE = 0.04, WIDER = 0.05;
// Mistakes: running wide (aiming RUN_WIDE m outside its line for WIDE_FOR s) or braking late (LATE times the speed into the
// next BRAKING m). The rubber band: up to BAND of its target and top speed (over anyone's, behind you), at BAND_GAP m between you,
// all race long. Stuck: STUCK s without getting
// on, it backs out for BACK_UP s, steering the other way; still stuck at RESPAWN s, it's put back on its line BEHIND m back.
const RUN_WIDE = 0.15, WIDE_FOR = 1, LATE = 1.2, BAND = 0.08, BAND_GAP = 4, STUCK = 2, BACK_UP = 0.6, RESPAWN = 4, BEHIND = 0.5;
// The fastest felt speed that can follow a curve of `curvature` (1/m in the office): the car turns at most TUNE.turn × how much
// steering it has at that speed, and a curve asks for curvature × the office speed (felt × pace). Drifting, it has more
// (driftTurn, and no less flat out), less SLIDE_LOSS for the slide. Tables, worked out again whenever TUNE changes (it's live).
const SLIDE_LOSS = 0.8;
const tables = new Map();
function cornerSpeed(curvature, drift = false) {
  const T = TUNE, sig = `${drift},${T.turn},${T.turnPeak},${T.turnFade},${T.driftTurn},${T.top},${T.pace}`;
  if (!tables.has(sig)) {
    const table = [];
    for (let v = 0.1; v <= T.top + 1e-9; v += 0.05) {
      const feel = Math.min(1, v / T.turnPeak) / (drift ? 1 / (T.driftTurn * SLIDE_LOSS) : 1 + Math.max(0, v - T.turnPeak) * T.turnFade);
      table.push([v, T.turn * feel / (v * T.pace)]); // the tightest curve (1/m) it can follow at v
    }
    tables.set(sig, table);
  }
  let best = 0.1;
  for (const [v, tightest] of tables.get(sig)) if (tightest >= curvature) best = v;
  return best;
}
// What a driver looks ahead over for corners (m). It drifts (skill.drift) a corner a drift takes DRIFT_GAIN times as fast as
// grip, from when the curve within NEAR (m) ahead is DRIFT_IN (1/m) till it's under DRIFT_OUT, letting go to boost out.
const BRAKING = 1.5, NEAR = 0.3, DRIFT_IN = 1.2, DRIFT_OUT = 0.6, DRIFT_GAIN = 1.15;

// A driver: `drive(c, circuit, world, t, { gap, final })` → this step's input for car c ({ throttle, steer, drift, target:
// the speed it wants, respawned: true the step it's put back }). It aims at its line `0.35 + 0.12 × speed` m ahead (office
// m/s), wandering off it by its skill's `wander`, steering by the heading error, and holds the speed the sharpest curve within
// BRAKING allows, times its skill's `corner`, drifting the tight ones if it does (or is a drifter), tricking off hops if it
// does. `gap`: metres you're ahead of it round the lap (behind, negative): the rubber band. (`final`: its last lap.)
export function createDriver({ skill = AUTOPILOT, personality = 'steady', seed = '' } = {}) {
  const rand = mulberry32(fnv1a(`npc:${seed}`)), phase = [rand() * 6.3, rand() * 6.3];
  const corner = skill.corner + (personality === 'charger' ? CHARGE : 0), wider = personality === 'charger' ? WIDER : 0, drifts = skill.drift || personality === 'drifter';
  let near = -1, drifting = 0, last = null, done = 0, best = 0, still = 0, backing = 0, mistake = null, steered = 0;
  return (c, circuit, world, t, { gap = 0, final = false } = {}) => {
    const { line, points, curvature, length } = circuit, count = line.length / 2, spacing = length / count, speed = Math.hypot(c.vx, c.vz) * TUNE.pace;
    const at = project(circuit, c.x, c.z, near); near = at.i;
    // How far it's got, and whether it's getting anywhere: stuck, back out; still stuck, back on its line a little behind.
    if (last !== null) { let d = at.s - last; if (d < -length / 2) d += length; if (d > length / 2) d -= length; done += d; }
    if (last !== null && last > length * 0.75 && at.s < length * 0.25 && rand() < skill.mistakes) mistake = { at: rand() * length * 0.9, kind: rand() < 0.5 ? 'wide' : 'late', until: null };
    last = at.s;
    if (done > best + 0.05) { best = done; still = 0; } else still += STEP;
    if (still >= RESPAWN) {
      const i = ((at.i - Math.round(BEHIND / spacing)) % count + count) % count, b = (i + 1) % count;
      Object.assign(c, newCar({ x: line[i * 2], z: line[i * 2 + 1], yaw: Math.atan2(line[b * 2] - line[i * 2], line[b * 2 + 1] - line[i * 2 + 1]) }));
      still = 0; backing = 0; best = done; last = null; near = -1;
      return { throttle: 0, steer: 0, drift: false, target: 0, respawned: true };
    }
    if (still >= STUCK && !backing) backing = BACK_UP;
    if (backing > 0) { backing -= STEP; if (backing <= 0) { still = STUCK - 1; backing = 0; } return { throttle: -1, steer: -Math.sign(steered || 1), drift: false, target: 0 }; }
    // A mistake, once it's reached the spot: running wide for a second, or braking late into the next corner.
    if (mistake && mistake.until === null && at.s >= mistake.at && at.s < mistake.at + 1) mistake.until = mistake.kind === 'wide' ? t + WIDE_FOR : at.s + BRAKING;
    const wide = mistake?.kind === 'wide' && mistake.until !== null && t < mistake.until, late = mistake?.kind === 'late' && mistake.until !== null && at.s < mistake.until;
    if (mistake?.until !== null && mistake && !wide && !late) mistake = null;
    const ahead = (at.i + Math.round((0.35 + 0.12 * speed) / spacing)) % count;
    // Its aim: the line there, moved across by its wandering, and outward (away from the line's inside) running wide.
    const nx = -(points[((ahead + 1) % count) * 2 + 1] - points[((ahead - 1 + count) % count) * 2 + 1]), nz = points[((ahead + 1) % count) * 2] - points[((ahead - 1 + count) % count) * 2], nl = Math.hypot(nx, nz) || 1;
    const inside = Math.sign((line[ahead * 2] - points[ahead * 2]) * nx + (line[ahead * 2 + 1] - points[ahead * 2 + 1]) * nz);
    const across = skill.wander * (0.6 * Math.sin(0.7 * t + phase[0]) + 0.4 * Math.sin(0.31 * t + phase[1])) - inside * (wider + (wide ? RUN_WIDE : 0));
    const ax = line[ahead * 2] + nx / nl * across, az = line[ahead * 2 + 1] + nz / nl * across;
    let error = Math.atan2(ax - c.x, az - c.z) - c.yaw; error = Math.atan2(Math.sin(error), Math.cos(error));
    let sharpest = 0, soon = 0;
    for (let k = 0, n = Math.round(BRAKING / spacing); k <= n; k++) { const v = curvature[(at.i + k) % count]; sharpest = Math.max(sharpest, v); if (k * spacing <= NEAR) soon = Math.max(soon, v); }
    const steer = Math.max(-1, Math.min(1, -error * 2.5)), grip = cornerSpeed(sharpest), slide = cornerSpeed(sharpest, true), fwd = c.fwd;
    steered = steer;
    if (!drifts || c.air) drifting = 0;
    else if (!drifting) { if (soon >= DRIFT_IN && slide >= grip * DRIFT_GAIN && fwd > 1.5 && Math.abs(steer) > 0.3) drifting = Math.sign(steer); }
    else if (soon < DRIFT_OUT || steer * drifting < -0.6 || fwd < 1) drifting = 0;
    const band = 1 + Math.max(-1, Math.min(1, gap / BAND_GAP)) * (gap < 0 ? skill.ease ?? BAND : BAND), pace = skill.pace ?? 1; c.pull = band * pace;
    const target = Math.min(TUNE.top * band * pace, corner * (drifting ? slide : grip) * (late ? LATE : 1) * band);
    const throttle = fwd < target * (skill.hold ?? 0.9) ? 1 : fwd > target * 1.15 ? -1 : 0;
    // A trick off a hop: drift pressed just after leaving its lip.
    const trick = skill.tricks && c.air && !c.air.glider && c.air.since > 0.04 && c.air.since < 0.1;
    return { throttle, steer, drift: drifting !== 0 || !!trick, target };
  };
}

// Par: the autopilot (or `skill`) from the front of the grid, three laps; its best lap (s), or null if a lap takes over a minute.
export function racePar(circuit, world, skill = AUTOPILOT) {
  const drive = createDriver({ skill }), car = newCar(circuit.grid[0]), laps = [];
  world = { ...world, ramps: circuit.ramps };
  let near = -1, last = null, done = -(circuit.length - project(circuit, car.x, car.z).s), lapStart = 0, t = 0;
  while (laps.length < 3) {
    step(car, drive(car, circuit, world, t), world, STEP, []); t += STEP;
    const at = project(circuit, car.x, car.z, near); near = at.i;
    if (last !== null) { let d = at.s - last; if (d < -circuit.length / 2) d += circuit.length; if (d > circuit.length / 2) d -= circuit.length; done += d; }
    last = at.s;
    if (done >= circuit.length * (laps.length + 1)) { laps.push(t - lapStart); lapStart = t; }
    if (t - lapStart > 60) return null;
  }
  return Math.min(...laps);
}

// The kerbs, KERB either side of the track: where (x, z) is on it (its sample i, looked for near `near`), and, if a car there (radius
// R) is pressed past one, which way is back onto the track and how far. None through a gap (open) onto the other road.
export function rail(circuit, x, z, near = -1) {
  const at = project(circuit, x, z, near), over = Math.abs(at.side) + R - KERB;
  if (over <= 0) return { i: at.i };
  // Through a gap: onto the other road, followed (its i) as it's the nearer; anywhere else in a gap, as if a kerb's end.
  if (circuit.open[at.side > 0 ? 'right' : 'left'][at.i]) { const other = project(circuit, x, z); if (Math.abs(other.side) < Math.abs(at.side)) return { i: other.i }; }
  const f = frame(circuit, at.i), s = Math.sign(at.side);
  return { i: at.i, nx: s * f.fz, nz: -s * f.fx, depth: over };
}
