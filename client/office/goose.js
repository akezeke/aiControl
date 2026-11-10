// The office goose: it waddles about between the desks, honks, makes off with things (props.js), creeps up on whoever's asleep
// at their desk to honk them awake, now and then stands about by a snake's food (never in its way), and won't have the boss near it. Come close and it charges, wings out, and nips; hit it
// with anything, click it or take back what it took, and it chases you for longer. Its ways round the furniture come from path.js. With reduced motion it stands still and a click just honks.
// At a meeting one page keeps it: its goose goes for anyone there, and tells the others its plans and what it does; they watch,
// playing those back, and poke it (goose-plan.js).
import * as THREE from 'three';
import { piece } from './furniture.js';
import { toonMaterial, withOutline } from './toon.js';
import { findPath, nearestOpen, index } from './path.js';
import { reach as flood } from './snake.js';
import { standSpots, nearestSpot, nextSpot, gooseRole, routeAt, gapOf, eased, planOf, planKey, planDue, round2, PLAN_EVERY } from './goose-plan.js';

export const GOOSE = 'goose'; // its id for the bubbles and props.js's hits
// m/s by mode (you walk at 4), standing in the rest; metres per radian of a leg's swing.
const SPEED = { walk: 0.75, fetch: 0.75, visit: 0.75, haul: 0.95, sneak: 0.45, chase: 2.6 }, STRIDE = 0.07;
const NEAR = 1.3, NIP = 0.55, NECK = 0.95, SHOVE = 0.35, BERTH = 0.5; // metres; BERTH: what it keeps off the snake's food on its way by it
// Seconds: a chase for coming close, and for anything worse; then it leaves you be; how often a chase looks for you again; how old
// a plan heard at home may be for a new keeper to carry on from (the server's own limit).
const SHORT = 2.5, LONG = 6, CALM = 8, REPLAN = 0.5, STALE = 10;
// Seconds: between honks, thefts, pranks and visits to the food; a loiter; a while at one spot by the food, and at the food in all.
const HONKS = [20, 40], THEFTS = [40, 90], PRANKS = [45, 120], VISITS = [30, 60], LOITER = [2, 6], MILL = [2, 4], STAY = [6, 12];
const LINES = ['HONK!', 'Honk!', 'HONK HONK!'], WOKEN = ['Wha—?!', "I'm up! I'm up!", 'Huh?!', 'Not again…'], IDLE = ['look', 'peck', 'preen'];
const WHITE = '#f7f5ef', ORANGE = '#ff9f1c', INK = '#1b1a1f';
// The shoulder the head is placed from; where the neck starts, deep in the chest so it grows out of the body at any angle; the
// beak's tip on the head.
const PIVOT = new THREE.Vector3(0, 0.44, 0.13), ROOT = new THREE.Vector3(0, 0.36, 0.06), TIP = new THREE.Vector3(0, -0.02, 0.14);
const ROWS = 14, AROUND = 10, THICK = 0.05, THIN = 0.03; // the neck's rings, the points round each, its radius at the base and the head
// The head's place (lean from upright and turn from ahead, `len` from the neck's base), the neck's shape on the way (`bend` an S,
// `bow` a C bulging forward, or up when it's leaning over), the head's tilt (down +) and turn, the beak open, the wings spread.
const REST = { lean: 0.25, turn: 0, len: 0.3, bend: 0.2, bow: 0, pitch: 0.1, look: 0, jaw: 0, wings: 0 };
const rand = ([a, b]) => a + Math.random() * (b - a), pick = list => list[Math.floor(Math.random() * list.length)];
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z), r2 = v => Math.round(v * 100) / 100; // r2: one number as round2 has it
// How near the line from a to b comes to p, all [x, z].
const gap = ([ax, az], [bx, bz], [px, pz]) => { const dx = bx - ax, dz = bz - az, k = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(ax + dx * k - px, az + dz * k - pz); };
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z);
const beak = (r, h, x, y, z) => new THREE.ConeGeometry(r, h, 10).rotateX(Math.PI / 2).translate(x, y, z); // pointing ahead (+z)

// Facing +z, feet on the floor: a body and tail, a neck that bends (bendNeck), a head with the top of the beak, a jaw that opens,
// wings that spread and legs that swing. Eight meshes with their outlines.
function model() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  body.add(piece('goose-body', () => [[ball(0.15, 0, 0.36, -0.02, 1, 0.85, 1.55), WHITE], [new THREE.ConeGeometry(0.07, 0.15, 10).rotateX(0.5 - Math.PI / 2).translate(0, 0.43, -0.27), WHITE]]));
  // Only the tube's layout is kept: bendNeck moves every point. Open-ended, its normals do for the outline's too.
  const tube = new THREE.CylinderGeometry(THIN, THICK, 1, AROUND, ROWS, true); tube.setAttribute('outlineNormal', tube.attributes.normal);
  const neck = withOutline(new THREE.Mesh(tube, toonMaterial(WHITE)), 0.006); body.add(neck);
  const head = new THREE.Group(); head.rotation.order = 'YXZ'; body.add(head);
  head.add(piece('goose-head', () => [[ball(0.058, 0, 0, 0, 0.9, 0.9, 1.15), WHITE], [beak(0.027, 0.09, 0, -0.006, 0.1), ORANGE], [ball(0.02, 0, 0.024, 0.058), ORANGE], ...[1, -1].map(side => [ball(0.011, side * 0.043, 0.018, 0.03), INK])], 0.006));
  const jaw = piece('goose-jaw', () => [[beak(0.02, 0.075, 0, 0, 0.0375), ORANGE]], 0.004); jaw.position.set(0, -0.024, 0.06); head.add(jaw);
  const wings = [1, -1].map(side => { const wing = piece('goose-wing', () => [[ball(0.1, 0, -0.02, -0.11, 0.3, 0.7, 1.45), '#ebe8e0']], 0.006); wing.position.set(side * 0.13, 0.42, 0.06); wing.rotation.order = 'ZYX'; body.add(wing); return wing; });
  const legs = [1, -1].map(side => { const leg = piece('goose-leg', () => [[new THREE.CylinderGeometry(0.013, 0.013, 0.24, 6).translate(0, -0.12, 0), ORANGE], [ball(0.035, 0, -0.245, 0.04, 1.1, 0.3, 1.4), ORANGE]], 0.004); leg.position.set(side * 0.06, 0.26, 0); root.add(leg); return leg; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20).rotateX(-Math.PI / 2).scale(1, 1, 1.5), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.position.y = 0.017; shadow.raycast = () => {}; root.add(shadow);
  return { root, body, neck, head, jaw, wings, legs };
}

// The neck along a curve from the chest to the head (in the body's frame), in the upright plane it turns to: out through the
// shoulder, then off the straight line by `bend` (opposite ways at a third and two thirds, an S) and `bow` (the same way, a C).
// In place, every frame; returns where the head goes.
const curve = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], v = Array.from({ length: 6 }, () => new THREE.Vector3());
function bendNeck(tube, { lean, turn, len, bend, bow }) {
  const [a, b, c, d] = curve, [across, side, centre, tangent, outward, ring] = v;
  across.set(Math.cos(lean) * Math.sin(turn), -Math.sin(lean), Math.cos(lean) * Math.cos(turn)); // square to the line: forward when upright, down when leaning right over
  side.set(Math.cos(turn), 0, -Math.sin(turn)); // square to the plane
  d.set(Math.sin(lean) * Math.sin(turn), Math.cos(lean), Math.sin(lean) * Math.cos(turn)).multiplyScalar(len).add(PIVOT);
  a.copy(ROOT); b.lerpVectors(PIVOT, d, 0.15).addScaledVector(across, (bow + bend) * len); c.lerpVectors(PIVOT, d, 2 / 3).addScaledVector(across, (bow - bend) * len);
  const { position, normal } = tube.attributes;
  for (let row = 0; row <= ROWS; row++) { // row 0 is at the head
    const t = 1 - row / ROWS, u = 1 - t, r = THICK + (THIN - THICK) * t;
    centre.copy(a).multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
    tangent.copy(a).multiplyScalar(-3 * u * u).addScaledVector(b, 3 * u * u - 6 * u * t).addScaledVector(c, 6 * u * t - 3 * t * t).addScaledVector(d, 3 * t * t).normalize();
    outward.crossVectors(side, tangent).normalize(); // with `side`, the tube's own x and z
    for (let k = 0; k <= AROUND; k++) {
      const angle = k / AROUND * Math.PI * 2, i = row * (AROUND + 1) + k;
      ring.copy(side).multiplyScalar(Math.sin(angle)).addScaledVector(outward, Math.cos(angle));
      normal.setXYZ(i, ring.x, ring.y, ring.z); position.setXYZ(i, centre.x + ring.x * r, centre.y + ring.y * r, centre.z + ring.z * r);
    }
  }
  position.needsUpdate = normal.needsUpdate = true; tube.computeBoundingSphere();
  return d;
}

// `walkable()`: path.js's grid of the room as it is now; `busy()`: you're in the overview or off to someone, so it lets you be;
// `say(icon, text)`: its speech bubble; `sleepers()`: [{ id, at }] of who's asleep and their seat; `wake(id, line)`: one jumps;
// `foods()`: [{ food: [x, z], head: [x, z] }] of each snake's food and its head; `others()`: [{ id, x, z, busy }] of the others at a
// meeting; `me()`: your id; `net(message)`: one to the meeting.
export function createGoose(scene, { props, player, walkable, bounds, busy, reducedMotion, say, sleepers, wake, foods = () => [], others = () => [], me = () => null, net = () => {} }) {
  const { root, body, neck, head, jaw, wings, legs } = model(); root.visible = false; scene.add(root);
  const at = root.position, pose = { ...REST }, aim = { ...REST }, dir = new THREE.Vector3(), local = new THREE.Vector3(), tip = new THREE.Vector3(), above = new THREE.Vector3();
  let t = 0, yaw = 0, phase = 0, stepping = 0, mode = 'loiter', idle = 'look', side = 1, until = 0, path = null, loot = null, mine = false, last = null, victim = null, prey = null; // mine: it's had it in its beak; last: what it took last time; prey: whose id it's chasing
  let chaseUntil = 0, replanAt = 0, calmUntil = 0, honkUntil = 0, honkIn = rand(HONKS), stealIn = rand(THEFTS), prankIn = rand(PRANKS), visitIn = rand(VISITS);
  let target = null, visiting = null; // what it has its eye on (strike); the food it's by: { food, spots, spot, leaveAt }
  // At a meeting: this page's role and the keeper's id; the last plan heard from anyone ({ m, r: when, age }) and the keeper's one
  // being played; how far the drawn goose is off it; a copy held in the beak; took: you took back what it had, so plans still
  // saying it has it are let be till one says it hasn't; when it may show at home; who's at the meeting, and who's newly come.
  let role = 'home', keeper = null, kept = null, plan = null, offset = [0, 0], ghost = null, took = false, spawnAt = 0, present = new Set();
  const arrived = new Set(), aimAt = new THREE.Vector3(), goal = new THREE.Vector3();
  // Keeping it: when its last plan went and what made it that plan (planKey); you as one it might go for, and what the next plan's
  // key is worked out from, both filled in place.
  let sentAt = -Infinity, sentKey = null;
  const yourself = { id: null, x: 0, z: 0, busy: false }, probe = { mode, idle, carry: null, target: null, route: [] }, aimed = [0, 0, 0], ends = [[0, 0]], none = [];

  const honk = (icon = '🪿') => { honkUntil = t + 0.6; say(icon, pick(LINES)); };
  const tell = m => { if (role === 'keeper') net(m); }; // what the keeper's goose did, for the others to act out
  const alone = () => role === 'keeper' && present.size < 2; // keeping it with nobody else there: it acts as at home
  const bill = () => head.localToWorld(tip.copy(TIP)); // the beak's tip, where what it carries goes (props.js)
  const loiter = (seconds = rand(LOITER)) => { mode = 'loiter'; path = null; target = null; until = t + seconds; idle = pick(IDLE); side = Math.random() < 0.5 ? 1 : -1; };
  const go = (to, next) => { const way = to && findPath(walkable(), at, to); if (way) { path = way; mode = next; } return !!way; };
  // An open spot at least `far` away, from a few tries.
  const spot = far => {
    const { width, depth } = bounds(), grid = walkable();
    for (let i = 0; i < 8; i++) { const p = nearestOpen(grid, new THREE.Vector3(Math.random() * width, 0, Math.random() * depth)); if (p && flat(p, at) >= far) return p; }
    return null;
  };
  // Within reach of the neck from where it stands.
  const reach = (from, p) => Math.hypot(Math.max(0, flat(from, p) - PIVOT.z), p.y - PIVOT.y) < NECK;
  // Something lying still it can get at from the floor (a desk thing from beside its desk), from a few tries; not what it just left.
  const steal = () => {
    const grid = walkable();
    for (const b of props.loose().filter(b => b !== last).sort(() => Math.random() - 0.5).slice(0, 4)) {
      const stand = nearestOpen(grid, b.pos);
      if (stand && reach(stand, b.pos) && go(stand, 'fetch')) { loot = last = b; return; }
    }
  };
  // Someone asleep it can stand beside (the open spot nearest their seat), from a few tries.
  const prank = () => {
    const grid = walkable();
    for (const s of sleepers().sort(() => Math.random() - 0.5).slice(0, 3)) {
      const stand = nearestOpen(grid, s.at);
      if (stand && flat(stand, s.at) < 1.2 && go(stand, 'sneak')) { victim = s; return; }
    }
  };
  // A way to the stand spot `s` that keeps BERTH off the food all along, so it never walks over it; or null.
  const wayTo = (s, food) => {
    const way = findPath(walkable(), at, new THREE.Vector3(s[0], 0, s[1]));
    return way?.every((p, i) => gap(i ? [way[i - 1].x, way[i - 1].z] : [at.x, at.z], [p.x, p.z], food) >= BERTH) ? way : null;
  };
  // Off to the snake's food nearest it: to the nearest spot 0.75–1 m from it that still leaves the snake a way in (goose-plan.js)
  // and has a way there. Only the spots it can get to are kept (one flood from where it stands), so no search for a way is wasted.
  const visit = () => {
    const list = foods(), food = nearestSpot(list.map(f => f.food), [at.x, at.z]); if (!food) return;
    const grid = walkable(), steps = flood(grid, [at.x, at.z]), far = s => Math.hypot(s[0] - at.x, s[1] - at.z);
    const spots = standSpots(grid, food, list.find(f => f.food === food).head).filter(s => steps[index(grid, { x: s[0], z: s[1] })] >= 0).sort((a, b) => far(a) - far(b));
    for (const s of spots) { const way = wayTo(s, food); if (way) { path = way; mode = 'visit'; visiting = { food, spots, spot: s, leaveAt: Infinity }; return; } }
  };
  // A while at a spot by the food, looking about or pecking; its stay counts from first getting there.
  const mill = () => {
    mode = 'mill'; path = null; until = t + rand(MILL); idle = Math.random() < 0.5 ? 'look' : 'peck'; side = Math.random() < 0.5 ? 1 : -1;
    if (visiting.leaveAt === Infinity) visiting.leaveAt = t + rand(STAY);
  };
  // Lets go of what's in its beak (or was, till you took it): the thing itself falls, a copy fades. A keeper says so, `quiet` when
  // every page's goose is letting go anyway (a keeper change, through the door).
  const drop = quiet => { if (loot?.carried) props.drop(loot); if (mine && !quiet) tell({ type: 'goosed', what: 'drop' }); loot = null; mine = false; ghost?.release(); ghost = null; };
  const carrying = () => !!(loot?.carried || ghost);
  // Who it might go for, as they are now ({ id, x, z, busy }): you, and while it's kept here, the others at the meeting.
  const you = () => { yourself.id = me(); yourself.x = player.position.x; yourself.z = player.position.z; yourself.busy = busy(); return yourself; };
  const quarry = id => { if (id === me()) return you(); if (role === 'keeper') for (const o of others()) if (o.id === id) return o; return null; };
  const close = p => !p.busy && Math.hypot(p.x - at.x, p.z - at.z) < NEAR;
  const near = () => { if (close(you())) return yourself; if (role === 'keeper') for (const o of others()) if (close(o)) return o; return null; };
  // Gets cross: drops what it has, honks, and goes for `id` for `seconds`, unless they're busy. At home (or keeping it alone) with
  // reduced motion it only honks; a keeper goes for them whatever its own page's setting.
  const provoke = (seconds, icon = '🪿', id = me()) => {
    if ((role === 'home' || alone()) && reducedMotion()) { honk(icon); return; }
    drop(); honk(icon); tell({ type: 'goosed', what: 'honk', icon });
    const p = quarry(id); if (!p || p.busy) return;
    mode = 'chase'; prey = id; chaseUntil = Math.max(chaseUntil, t + seconds); replanAt = 0;
  };
  // Caught them: a nip and a honk, a shove if it's you (not while busy, or with reduced motion), and that'll do for a while.
  const nip = p => {
    honk('💢'); tell({ type: 'goosed', what: 'nip', who: p.id });
    if (p === yourself && !busy() && !reducedMotion()) player.step(dir.set(p.x - at.x, 0, p.z - at.z).normalize().multiplyScalar(SHOVE));
    calmUntil = t + CALM; loiter();
  };
  const turnTo = (want, dt) => { const turn = want - yaw; yaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 8); };
  const face = (p, dt) => turnTo(Math.atan2(p.x - at.x, p.z - at.z), dt);
  // Along the path at the mode's speed; true once at its end.
  const follow = dt => {
    while (path.length > 1 && flat(at, path[0]) < 0.05) path.shift();
    const next = path[0], d = flat(at, next); if (d < 0.05) return true;
    const step = Math.min(d, SPEED[mode] * dt);
    at.x += (next.x - at.x) / d * step; at.z += (next.z - at.z) / d * step; phase += step / STRIDE; stepping = 1;
    face(next, dt);
    return false;
  };

  // What it's up to, a frame at a time.
  function think(dt) {
    if (loot?.held) { const taken = mine; drop(); if (taken) poked('took', '💢'); else loiter(); } // you got there first, or took it back
    if (mode !== 'chase' && t > calmUntil) { const p = near(); if (p) provoke(SHORT, '🪿', p.id); } // come too close and it charges
    if (mode === 'loiter' || mode === 'walk') { honkIn -= dt; stealIn -= dt; prankIn -= dt; if (foods().length) visitIn -= dt; }
    if (honkIn < 0) { honkIn = rand(HONKS); if (role !== 'keeper' || alone()) honk(); } // kept for others, it honks only at something, which they hear of
    // Off again when its stay is up, or once the food's gone (eaten, or its snake with it).
    if ((mode === 'visit' || mode === 'mill') && (t > visiting.leaveAt || !foods().some(f => Math.hypot(f.food[0] - visiting.food[0], f.food[1] - visiting.food[1]) < 0.01))) { visiting = null; loiter(); }
    if (mode === 'chase') {
      const p = quarry(prey); // after them where they are now, till they're busy or gone, or it's had enough
      if (!p || p.busy || t > chaseUntil) { calmUntil = t + 2; loiter(1); return; }
      if (t > replanAt) { replanAt = t + REPLAN; goal.set(p.x, 0, p.z); path = findPath(walkable(), at, goal) || [goal.clone()]; }
      follow(dt);
      if (Math.hypot(p.x - at.x, p.z - at.z) < NIP) nip(p);
    } else if (mode === 'walk') { if (follow(dt)) { at.x = path[0].x; at.z = path[0].z; loiter(); } } // right onto its end: a visit walked on (carryOn) stops on its spot
    // Right onto the spot: a few cm short of it could shut the snake out.
    else if (mode === 'visit') { if (follow(dt)) { at.x = visiting.spot[0]; at.z = visiting.spot[1]; mill(); } }
    // Facing the food; then on to another spot by it, by a way that keeps off the food, or a while longer here.
    else if (mode === 'mill') {
      face(dir.set(visiting.food[0], 0, visiting.food[1]), dt);
      if (t > until) {
        const next = nextSpot(visiting.spots.filter(s => gap(visiting.spot, s, visiting.food) >= BERTH), visiting.spot), way = next && wayTo(next, visiting.food);
        if (way) { path = way; mode = 'visit'; visiting.spot = next; } else mill();
      }
    } else if (!loot && (mode === 'fetch' || mode === 'reach' || mode === 'haul' || mode === 'drop')) loiter(); // let go of it (a keeper change, a poke): that theft's off
    else if (mode === 'fetch') {
      if (follow(dt)) { mode = 'reach'; until = t + 0.9; }
    } else if (mode === 'reach') {
      face(loot.pos, dt);
      if (!loot.carried && !reach(at, loot.pos)) { loot = null; loiter(); } // it moved
      else if (!loot.carried) { if (t > until - 0.4 && (mine = props.carry(loot, bill))) tell({ type: 'goosed', what: 'take', kind: loot.kind.key, spot: round2(loot.pos.toArray()) }); }
      else if (t > until && !go(spot(3), 'haul')) { mode = 'drop'; until = t + 0.6; } // nowhere to take it: down it goes here
    } else if (mode === 'haul') { if (follow(dt)) { mode = 'drop'; until = t + 0.6; } }
    else if (mode === 'drop') { if (t > until) { drop(); honk(); loiter(); } }
    else if (mode === 'sneak') { if (follow(dt)) { mode = 'aim'; until = t + 0.8; } }
    // A moment lining up on them, then the honk, if they're still asleep.
    else if (mode === 'aim') {
      face(victim.at, dt);
      if (t > until) { if (sleepers().some(s => s.id === victim.id)) { honk(); wake(victim.id, pick(WOKEN)); tell({ type: 'goosed', what: 'wake', spot: round2([victim.at.x, victim.at.z]) }); } victim = null; loiter(); }
    } else if (t > until) {
      // Whatever's due, in turn, while it's still loitering: one that finds nothing to do doesn't hold up the next.
      if (stealIn < 0) { stealIn = rand(THEFTS); steal(); }
      if (mode === 'loiter' && prankIn < 0) { prankIn = rand(PRANKS); prank(); }
      if (mode === 'loiter' && visitIn < 0) { visitIn = rand(VISITS); visit(); }
      if (mode === 'loiter' && !go(spot(1), 'walk')) loiter(1);
    }
    // The thing it's reaching for, or the seat of whoever it's creeping up on.
    target = mode === 'reach' ? loot?.pos ?? null : mode === 'sneak' || mode === 'aim' ? victim?.at ?? null : null;
  }

  // Your click, hit or taking back: on a watcher a poke for the keeper's goose to act on, else it goes for you; with reduced motion
  // at a meeting just a honk, here alone (at home provoke sees to that).
  const poked = (why, icon) => { if (role !== 'home' && reducedMotion()) honk(icon); else if (role === 'watcher') net({ type: 'poke', why }); else provoke(LONG, icon); };
  // Keeping it: its plan to the others when one's due (goose-plan.js), on a change or someone new come at most twice a second,
  // else every 2 s (give or take a µs: t is a sum of frame times, so 30 of them can come to 0.4999…). What would change it
  // (planKey) comes from the probe, so a whole plan is built only to go out, and nothing at all till one could be.
  function share() {
    if (t + 1e-6 - sentAt < PLAN_EVERY) return;
    const end = path?.[Math.min(path.length, 32) - 1];
    probe.mode = mode; probe.idle = idle; probe.carry = loot?.carried ? loot.kind.key : null; probe.target = target && aimed; probe.route = end ? ends : none;
    if (target) { aimed[0] = r2(target.x); aimed[1] = r2(target.y); aimed[2] = r2(target.z); }
    if (end) { ends[0][0] = r2(end.x); ends[0][1] = r2(end.z); }
    const key = planKey(probe); if (!planDue(t + 1e-6, sentAt, key !== sentKey || arrived.size > 0)) return;
    net(planOf({ at, yaw, mode, idle, speed: SPEED[mode] ?? 0, path, carry: probe.carry, target })); sentAt = t; sentKey = key; arrived.clear();
  }
  // Running the goose from a plan `p` (a watcher's being played, or one heard at home): from where it's drawn, or with `jump` where
  // the plan puts it by now; a walk or visit with route left walks the rest of it, anything else loiters. One standing by the
  // food stands on the plan's spot, not where the easing still has it: a few cm off could shut the snake out.
  function carryOn({ m, r, age }, jump) {
    const now = routeAt(m.at, m.route, m.speed, t - r + age / 1000), on = (m.mode === 'walk' || m.mode === 'visit') && m.speed > 0 && now.route.length;
    if (jump || (!on && (m.mode === 'mill' || m.mode === 'visit'))) { at.x = now.at[0]; at.z = now.at[1]; }
    if (jump) { root.visible = true; yaw = m.yaw; }
    loiter();
    if (on) { mode = 'walk'; path = now.route.map(([x, z]) => new THREE.Vector3(x, 0, z)); }
  }
  const fresh = p => !!p && t - p.r + p.age / 1000 < STALE; // a plan heard recently enough to run the goose from
  // A plan from the keeper: a hidden goose shows where it puts it by now; a shown one stays where it's drawn and eases onto it
  // (jumping a gap over a metre). The beak is put right, should a take or drop have been lost on the way.
  function adopt(p) {
    const { m } = p, [x, z] = routeAt(m.at, m.route, m.speed, t - p.r + p.age / 1000).at;
    if (!root.visible) { root.visible = true; offset = [0, 0]; yaw = m.yaw; } else offset = gapOf([at.x, at.z], [x, z]);
    at.x = x + offset[0]; at.z = z + offset[1];
    plan = p; mode = m.mode; idle = m.idle; path = null; target = m.target ? aimAt.fromArray(m.target) : null;
    if (!m.carry) { took = false; drop(); } else if (!took && !carrying()) ghost = props.holdGhost(m.carry, bill);
  }
  // The keeper's goose played back, a frame at a time: where the plan's route puts it by now, plus what's left of the offset. It
  // faces along the route while that goes on (routeAt calls a route with no speed moving), keeps that heading once a walk's
  // route runs out, and turns to the plan's yaw when it stands; its feet go by how far it's drawn moving.
  function play(dt) {
    if (loot?.held) { drop(); took = true; poked('took', '💢'); } // you took it back: yours at once
    if (!plan) return; // standing where it is till the new keeper's first plan
    const { m, r, age } = plan, now = routeAt(m.at, m.route, m.speed, t - r + age / 1000);
    offset = eased(offset, dt);
    const x = now.at[0] + offset[0], z = now.at[1] + offset[1], moved = Math.hypot(x - at.x, z - at.z);
    at.x = x; at.z = z;
    if (moved > dt * 0.05) { phase += moved / STRIDE; stepping = 1; } // over 5 cm/s
    if (!(m.speed > 0)) turnTo(m.yaw, dt); else if (now.moving) turnTo(Math.atan2(now.dir[0], now.dir[1]), dt); // the yaw it set off with is stale
  }
  // What the keeper's goose did, acted out here: a nip shoves you if it's you; a take puts your own thing of that kind by its spot
  // in the beak, else a copy; a wake startles your sleeper by that seat. A nip, drop and wake each come with their honk.
  function happened(m) {
    if (m.what === 'nip') {
      honk('💢'); const you = player.position;
      if (m.who === me() && !busy() && !reducedMotion()) player.step(dir.set(you.x - at.x, 0, you.z - at.z).normalize().multiplyScalar(SHOVE));
    } else if (m.what === 'take') {
      drop(); took = false; // a new theft: the keeper's moved on from any you took back
      const [sx, sy, sz] = m.spot; let near = null, best = 0.5;
      for (const b of props.loose()) { const d = Math.hypot(b.pos.x - sx, b.pos.y - sy, b.pos.z - sz); if (b.kind.key === m.kind && d <= best) { near = b; best = d; } }
      if (near && props.carry(near, bill)) loot = near; else ghost = props.holdGhost(m.kind, bill);
    } else if (m.what === 'drop') { drop(); honk(); }
    else if (m.what === 'wake') {
      let near = null, best = 0.5;
      for (const s of sleepers()) { const d = Math.hypot(s.at.x - m.spot[0], s.at.z - m.spot[1]); if (d <= best) { near = s; best = d; } }
      honk(); if (near) wake(near.id, pick(WOKEN));
    } else if (m.what === 'honk') honk(m.icon);
  }

  // How it holds itself for what it's doing, eased toward.
  function strike(dt, still) {
    Object.assign(aim, REST);
    if (still) { /* stands as it is */ }
    else if (mode === 'chase') Object.assign(aim, { lean: 1.2, len: 0.36, bend: 0.3, pitch: -0.15, jaw: 0.35 + Math.sin(t * 30) * 0.1, wings: 0.85 + Math.sin(t * 14) * 0.15 });
    else if (mode === 'reach' && !carrying() && target) {
      root.updateMatrixWorld(); root.worldToLocal(local.copy(target)).sub(PIVOT);
      const d = local.length();
      Object.assign(aim, { lean: Math.acos(THREE.MathUtils.clamp(local.y / d, -1, 1)), turn: Math.atan2(local.x, local.z), len: THREE.MathUtils.clamp(d - 0.13, 0.25, NECK), bend: 0.06, pitch: Math.atan2(-local.y, Math.hypot(local.x, local.z)) });
    } else if (mode === 'drop') Object.assign(aim, { lean: 1.7, len: 0.3, bend: 0, bow: -0.3, pitch: 0.7 });
    else if (carrying()) Object.assign(aim, { lean: 0.55, pitch: 0.25 });
    else if (mode === 'sneak' || mode === 'aim') Object.assign(aim, { lean: 1.05, len: 0.38, bend: 0.1, pitch: -0.05 }); // creeping, neck out low
    else if (mode === 'walk' || mode === 'fetch' || mode === 'visit') aim.lean = 0.3 + Math.sin(phase * 2) * 0.08; // bobbing along
    else if (idle === 'look') { aim.turn = Math.sin(t * 0.8 + side) * 0.35; aim.look = Math.sin(t * 0.8 + side) * 0.6; }
    else if (idle === 'peck') { const peck = Math.sin(t * 1.3 + side) > 0 ? Math.max(0, Math.sin(t * 11)) ** 3 : 0; Object.assign(aim, { lean: 1.95 + 0.4 * peck, len: 0.42, bend: 0.05, bow: -0.35, pitch: 1 }); }
    else if (idle === 'preen') Object.assign(aim, { lean: 1.3, turn: side * 2.5, len: 0.26, bend: 0, bow: -0.5, pitch: 0.5 + Math.sin(t * 12) * 0.15 });
    // A honk: head thrown up, beak working.
    if (!still && t < honkUntil && mode !== 'chase' && mode !== 'reach') Object.assign(aim, { lean: 0.05, turn: 0, len: 0.36, bend: 0.1, pitch: -0.7, look: 0, jaw: 0.15 + 0.4 * Math.abs(Math.sin((honkUntil - t) * 10)) });
    const k = still ? 1 : 1 - Math.exp(-dt * 10);
    for (const key in pose) pose[key] += (aim[key] - pose[key]) * k;
    stepping *= still ? 0 : 1 - k * 0.5;
  }

  const goose = {
    root,
    get mode() { return mode; }, // what it's up to
    // For props.js: things thrown, and coffee, hit it.
    get column() { return { id: GOOSE, x: at.x, z: at.z, r: 0.2, top: 0.55 }; },
    columns() { return root.visible ? [goose.column] : []; }, // what's in the way of things on the floor (the snake): nothing while it's not there
    // Just over its head, for its bubble.
    top() { return root.visible ? head.getWorldPosition(above).setY(above.y + 0.16) : null; },
    hit() { poked('hit', '💢'); },
    honk, // just a honk, beak open and a bubble: the snake bumped into it
    poke() { poked('click', '🪿'); },
    // The meeting's roster, each time it changes: this page's role (goose-plan.js). A new keeper means every page's goose lets go
    // of what it carries; a watcher's then stands where it is (hidden, coming from home) till the new keeper's plan, played at
    // once if one under STALE s old is in already. Keeping it or home again, a watcher's goose runs on from where it's drawn, and
    // one from home from a plan heard under STALE s ago, else as it was; a new keeper's first plan goes at once, and the plans
    // kept are no more use to it (its own goose is the truth now: handed back later, it mustn't jump to one from before).
    roster(players, myId) {
      const was = role, from = keeper, played = plan;
      ({ role, keeper } = gooseRole(players, myId));
      for (const p of players) if (p.at === 'meeting' && !present.has(p.id)) arrived.add(p.id);
      present = new Set(players.filter(p => p.at === 'meeting').map(p => p.id));
      if (role === 'home' && was !== 'home') kept = null; // that meeting's plans are no use at home
      if (keeper === from) return;
      drop(true); took = false; plan = null; sentAt = -Infinity;
      if (role === 'watcher') { if (was === 'home') root.visible = false; else loiter(); if (kept?.m.id === keeper && fresh(kept)) adopt(kept); }
      else if (was === 'watcher') { if (played) carryOn(played); else loiter(); }
      else if (was === 'home' && fresh(kept)) carryOn(kept, true);
      if (role === 'keeper') kept = null;
    },
    // A message from the meeting, checked and with its sender's id. A plan from anyone is kept; the keeper's plans and what its
    // goose did are played on a watcher (one still hidden waits for a plan). A poke sets the keeper's goose on whoever sent it.
    heard(m) {
      if (m.type === 'goose') { kept = { m, r: t, age: m.age ?? 0 }; if (role === 'watcher' && m.id === keeper) adopt(kept); }
      else if (m.type === 'goosed' && role === 'watcher' && m.id === keeper && root.visible) happened(m);
      else if (m.type === 'poke' && role === 'keeper' && root.visible) provoke(LONG, m.why === 'click' ? '🪿' : '💢', m.id);
    },
    // Through the door: it lets go, the plans kept were that meeting's, and it's away a second, so a guest arriving never sees a
    // stray goose before the roster says whose it is. Into a meeting (still at home: the keeper's first plan can come before the
    // floor, and the roster naming the keeper after it) the plan kept stays, for roster() to show at once; going home, they were
    // that meeting's.
    reset(into = false) { drop(true); took = false; plan = null; if (!into) kept = null; root.visible = false; spawnAt = t + 1; },
    update(dt) {
      const room = bounds(); if (!room) return;
      const still = reducedMotion();
      t += dt;
      if (role === 'watcher') { if (!root.visible) return; play(dt); } // hidden till the keeper's first plan
      else {
        // In by the lounge on the first frame there's a room (a second after going through the door), facing into it.
        if (!root.visible) { if (t < spawnAt) return; root.visible = true; const home = nearestOpen(walkable(), new THREE.Vector3(room.width - 2.4, 0, room.depth - 2.7)); if (home) at.copy(home); yaw = Math.atan2(room.width / 2 - at.x, room.depth / 2 - at.z); loiter(); }
        if (still && (role === 'home' || alone())) { drop(); if (mode !== 'loiter') loiter(); } else think(dt);
        if (role === 'keeper') share();
      }
      strike(dt, still); // at a meeting with reduced motion it still moves, without the waddle, wings or neck
      root.rotation.y = yaw;
      body.rotation.set(0.15 * pose.wings, 0, Math.sin(phase) * 0.12 * stepping); // waddling side to side; leaning in to a charge
      body.position.y = Math.abs(Math.sin(phase)) * 0.015 * stepping;
      legs[0].rotation.x = Math.sin(phase) * 0.6 * stepping; legs[1].rotation.x = -legs[0].rotation.x;
      head.position.copy(bendNeck(neck.geometry, pose)); head.rotation.set(pose.pitch, pose.turn + pose.look, 0);
      jaw.rotation.x = pose.jaw;
      wings.forEach((wing, i) => { const s = i ? -1 : 1; wing.rotation.set(0, -s * 1.2 * pose.wings, s * 0.7 * pose.wings); });
      root.updateMatrixWorld(true); // props.update moves what's in its beak after this
    },
    dispose() { drop(true); root.removeFromParent(); },
  };
  root.userData.toggle = () => goose.poke(); // a click or E on it
  return goose;
}
