// Paper planes round the office. Click the stack of paper on the filing cabinet by the printer (or E on it) and the view drops
// in behind a paper plane, held out over the room with today's rings strung out across it on a dotted line. Tap, click, Space
// or ↑ throws it; then hold and drag (a finger or the mouse), or the arrows or WASD, to steer: sideways turns, up and down
// pitch. Left be it glides gently down; held up it always climbs, and a dive pulled up comes out higher (planes-course.js).
// Each ring it goes through pushes it on; there's no clock: the run ends when it touches anything (the floor, a wall, a desk,
// someone's head). Through all of them is the time to beat, with a medal for it against the autopilot's (gold, silver,
// bronze); the next one to go for shows before a throw. Again (tap, Space) for another plane, straight away once through the
// last; Esc or ✕ steps back. People's bubbles fade back while you play, so they don't hide the rings.
// The course is laid round the office as it is (planes-course.js), the day's own, and kept while it still fits as desks come
// and go. `endless` (the yellow plane on the printer): rings laid on ahead as it goes, each a little smaller, a new lot every
// plane; the score is how many. Bests are kept per browser, per course and endless. With reduced motion the view doesn't
// bank, widen or shake, the plane in hand holds still and the rings don't pulse or pop.
import * as THREE from 'three';
import { toonMaterial, withOutline } from './toon.js';
import { nearestOpen } from './path.js';
import { dayKey, fnv1a } from './daily.js';
import { WALL_H } from './furniture.js';
import { newFlight, launch, fly, makeCourse, endless as endlessRings, holds, better, gap, medal, medalTime, MEDALS, HOLE, LAUNCH, AHEAD as LAID } from './planes-course.js';

const BEST = 'ai-control-planes-best', ENDLESS = 'ai-control-planes-endless', KEEP = 12; // bests for this many courses
const THROW = 1.15, HAND = 1.4, STAND = 0.85; // metres out from the stack it's thrown from, and how high; where you stand
const BACK = 1, LIFT = 0.28, AHEAD = 1.4, NEAREST = 0.35, FOV = 70; // the view behind the plane: how far back, up, looking how far on
const LOOKS = 1.3; // the plane drawn this much bigger than it flies, to be seen on a phone
// The stick: px a drag goes to full and that a finger may wander first, each way; how much gentler it starts than it ends (0
// even). Seconds after a crash before again.
const STICK = 44, DEAD = 5, EXPO = 0.6, AGAIN = 0.4;
// One way of the stick (px off where it went down) to -1..1: gentle near the middle for small corrections, quick to the end so a
// hard bank isn't far for a thumb.
const axis = px => { const m = Math.min(Math.max((Math.abs(px) - DEAD) / (STICK - DEAD), 0), 1); return Math.sign(px) * m * (1 - EXPO + EXPO * m * m); };
const NEXT = '#ffd23f', LAST = '#5ee08a';

// Sound, made up as it goes (as pinball's): a whoosh off the hand, a chime a note up the scale for each ring (endless, a
// little tune each ten), paper crumpling into things or skidding along the floor, and a run up the scale through the last
// ring, the further the better the medal, and a best rung in. It starts with a press (browsers wait for one); till then, none.
let audio, master, hiss;
const hear = () => { try { if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.gain.value = 0.3; master.connect(audio.destination); } if (audio.state === 'suspended') audio.resume(); } catch { /* no sound here */ } };
function tone(f, length, { type = 'sine', gain = 0.12, delay = 0, to = f } = {}) {
  const at = audio.currentTime + delay, o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(f, at); if (to !== f) o.frequency.exponentialRampToValueAtTime(to, at + length);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(g).connect(master); o.start(at); o.stop(at + length + 0.02);
}
// Noise through a band sliding `from` to `to` Hz: air, paper.
function rush(length, from, to, { q = 1, gain = 0.15, delay = 0, rise = 0.01 } = {}) {
  if (!hiss) { hiss = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate); const d = hiss.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const at = audio.currentTime + delay, s = audio.createBufferSource(), band = audio.createBiquadFilter(), g = audio.createGain();
  s.buffer = hiss; band.type = 'bandpass'; band.Q.value = q; band.frequency.setValueAtTime(from, at); band.frequency.exponentialRampToValueAtTime(to, at + length);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + rise); g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  s.connect(band).connect(g).connect(master); s.start(at, Math.random()); s.stop(at + length + 0.02);
}
const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760]; // pentatonic, two octaves up from C
const tune = (notes, { gap = 0.08, gain = 0.1, delay = 0 } = {}) => notes.forEach((f, i) => tone(f, 0.4, { type: 'triangle', gain, delay: delay + i * gap }));
const SOUNDS = {
  throw: () => rush(0.45, 600, 2400, { q: 0.7, gain: 0.3, rise: 0.08 }),
  ring: i => { const f = SCALE[i % SCALE.length]; tone(f, 0.7, { gain: 0.14 }); tone(f * 2.01, 0.3, { type: 'triangle', gain: 0.04 }); rush(0.3, 2600, 900, { q: 0.6, gain: 0.06, rise: 0.03 }); },
  ten: () => tune([784, 1047, 1319, 1568], { delay: 0.15 }),
  done: rank => tune([523, 659, 784, 1047, 1319, 1568].slice(0, 3 + rank), { delay: 0.15 }), // rank: 0 none, 3 gold
  crash: () => {
    tone(140, 0.14, { to: 55, type: 'triangle', gain: 0.2 });
    for (let k = 0; k < 8; k++) rush(0.03 + Math.random() * 0.05, 1500 + Math.random() * 3000, 900 + Math.random() * 1500, { q: 1.5, gain: 0.08 + Math.random() * 0.1, delay: k * 0.03 + Math.random() * 0.02, rise: 0.003 });
  },
  floor: () => rush(0.5, 1600, 400, { q: 0.5, gain: 0.15, rise: 0.02 }),
  best: () => tune([1568, 2093], { gap: 0.1, delay: 0.7 }),
};
const play = (name, arg) => { if (audio?.state === 'running') SOUNDS[name](arg); };

// A dart folded from a sheet, nose to +z: two wings off a keel, white both sides.
function dartGeometry() {
  const nose = [0, 0, 0.16], tail = [0, 0, -0.12], keel = [0, -0.035, -0.11], left = [0.12, 0.025, -0.12], right = [-0.12, 0.025, -0.12];
  const faces = [[nose, left, tail], [nose, tail, right], [nose, keel, tail]];
  const points = faces.flatMap(([a, b, c]) => [a, b, c, a, c, b]).flat(); // both windings: seen from either side
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.computeVertexNormals();
  return g;
}

// `canvas`: where presses come; `home()`: the paper stack (an Object3D, facing into the room); `grid()`: the walk grid;
// `world()`: what it flies through ({ boxes, columns (people now), people (where they sit and stand at their desks: the rings
// keep clear of those), width, depth }); `score(goal, verdict)`: the score bar (null clears it);
// `hit(id, line)`: someone was hit; `endless`: endless rings rather than the day's course.
export function createPlanes({ canvas, home, grid, world, score, hit = () => {}, endless = false }) {
  const store = endless ? ENDLESS : BEST;
  let bests = {}; try { bests = JSON.parse(localStorage.getItem(store)) || {}; } catch { /* no storage here */ }
  let f = null, course = null, key = '', sig = '', looked = 0, active = false, linger = 0, shake = 0, since = 0, fresh = true, shown = '', record = false, said = null, held = null;
  const keys = new Set(), stick = { id: null, x: 0, y: 0, dx: 0, dy: 0 }, from = new THREE.Vector3(), look = new THREE.Vector3(), wobble = new THREE.Vector3();
  const root = new THREE.Group(); root.visible = false;
  const space = { boxes: [], columns: [], ceiling: WALL_H, width: 0, depth: 0 };

  const plane = withOutline(new THREE.Mesh(dartGeometry(), toonMaterial('#fbfaf6', { side: THREE.DoubleSide })), 0.005);
  plane.rotation.order = 'YXZ'; plane.scale.setScalar(LOOKS); root.add(plane);
  // The rings: flat glass-like hoops, unlit; the next one clearest, with a faint film across it; the one after paler, the rest
  // fainter still; the last green. Ring i is drawn by rings[i % rings.length]: endless, a few go round.
  const torus = new THREE.TorusGeometry(HOLE, 0.033, 8, 40), film = new THREE.CircleGeometry(HOLE, 32), rings = [];
  const meshOf = i => rings[i % rings.length];
  const ring = () => {
    const mesh = new THREE.Mesh(torus, new THREE.MeshBasicMaterial({ color: NEXT, transparent: true, depthWrite: false })), disc = new THREE.Mesh(film, new THREE.MeshBasicMaterial({ color: NEXT, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    mesh.add(disc); mesh.userData = { disc, pop: 0 }; root.add(mesh); return mesh;
  };
  // The way round, dotted, while the plane's in hand.
  const guide = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.6 }));
  root.add(guide);
  // An arrow off the plane's nose to the next ring, when that's off to the side or behind.
  const arrow = withOutline(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 10).rotateX(Math.PI / 2), toonMaterial(NEXT)), 0.004); root.add(arrow);
  // A thin trail behind it.
  const TRAIL = 48, trailPoints = new Float32Array(TRAIL * 3), trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
  trail.geometry.setAttribute('position', new THREE.BufferAttribute(trailPoints, 3)); trail.frustumCulled = false; root.add(trail);
  root.traverse(node => { node.raycast = () => {}; });

  // The stick drawn where a finger (or the mouse) went down: a ring and a knob.
  const pad = document.createElement('div'); pad.className = 'office-stick'; pad.hidden = true; pad.appendChild(document.createElement('i'));
  canvas.parentElement?.appendChild(pad);
  // While playing, people's bubbles fade back so the rings show through (office.css).
  const dim = on => canvas.parentElement?.classList.toggle('office-planes', on);

  // Where it's thrown from: out from the stack, the way it faces.
  const facing = () => { const h = home(); return h ? { h, x: Math.sin(h.rotation.y), z: Math.cos(h.rotation.y) } : null; };
  const start = () => { const s = facing(); return s && { x: s.h.position.x + s.x * THROW, y: HAND, z: s.h.position.z + s.z * THROW, yaw: Math.atan2(s.x, s.z) }; };
  const best = () => bests[key] || null;
  // What there is to fly through now; and the course: the day's, kept while it still fits (looked at again only when
  // something's moved), else laid again. Endless: new rings `anew` (each plane), or when something's moved.
  const gather = () => { const w = world(); space.boxes = w.boxes; space.columns = w.columns; space.width = w.width; space.depth = w.depth; return w; };
  const signature = (boxes, people) => `${boxes.length}:${people.length}:${(boxes.reduce((sum, b) => sum + b.min.x * 3 + b.min.y * 5 + b.min.z * 7 + b.max.x * 11 + b.max.y * 13 + b.max.z * 17, 0)
    + people.reduce((sum, p) => sum + p.x * 19 + p.z * 23 + p.r * 29 + p.top * 31, 0)).toFixed(3)}`;
  const lay = (anew = false) => {
    const people = gather().people || [], at = start(); if (!at || !space.width) { course = null; return; }
    const today = dayKey(new Date()), now = `${endless ? '' : today}:${signature(space.boxes, people)}`;
    if (course && now === sig && !(endless && anew)) return; sig = now;
    const office = { start: at, boxes: space.boxes, people, width: space.width, depth: space.depth, ceiling: WALL_H };
    if (endless) { course = endlessRings(office); key = 'endless'; drawCourse(); return; }
    if (course?.rings.length && course.day === today && holds(course, office)) return;
    course = { ...makeCourse({ ...office, seed: `${today}:${space.width}x${space.depth}` }), day: today };
    key = `${today}:${fnv1a(course.rings.map(r => `${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)}`).join(';')).toString(36)}`;
    drawCourse();
  };
  const restart = (relay = true) => { if (relay) lay(true); const at = start(); f = at && course ? newFlight(at) : null; fresh = true; record = false; said = null; since = 0; };
  const keep = () => {
    const run = { rings: f.next, time: f.done }; if (!run.rings || !better(run, best())) return;
    record = true; bests[key] = run;
    const keys = Object.keys(bests); if (keys.length > KEEP) for (const k of keys.slice(0, keys.length - KEEP)) delete bests[k];
    try { localStorage.setItem(store, JSON.stringify(bests)); } catch { /* no storage here */ }
  };
  const throwIt = () => { if (f?.mode !== 'ready') return; launch(f); since = 0; play('throw'); };
  // Again: after a crash, or straight away once through the last ring (it flies on till then).
  const again = () => { if (f?.mode === 'fly' && f.done != null) { f.mode = 'over'; since = AGAIN; } if (f?.mode === 'over' && since >= AGAIN) restart(); };
  const seconds = t => `${t.toFixed(1)}s`;
  const place = t => MEDALS.findIndex(([m]) => m === medal(t, course.par)); // 0 gold … -1 none
  const showScore = () => {
    const b = best(), line = f ? [f.next, f.mode, f.done, record, said, b?.rings, b?.time, course?.par].join() : '';
    if (line === shown) return; shown = line;
    if (!f || !course) { score(null); return; }
    const touch = globalThis.matchMedia?.('(pointer: coarse)')?.matches, n = course.rings.length;
    const hint = f.mode === 'ready' ? (touch ? 'Tap to throw · drag to fly' : 'Space to throw · arrows to fly') : f.mode === 'over' || f.done != null ? (touch ? 'Tap again' : 'Space again') : null;
    // Round: the time and its medal; else how it came down. A best, either way.
    const timed = t => [medal(t, course.par), seconds(t)].filter(Boolean).join(' ');
    const ended = f.done != null ? timed(f.done) : f.mode === 'over' ? said : null, verdict = [ended, record && 'New best!'].filter(Boolean).join(' · ') || null;
    const got = endless ? `${f.next}` : `${f.next}/${n}`, top = !b ? null : endless ? `${b.rings}` : b.time != null ? timed(b.time) : `${b.rings}/${n}`;
    // The next medal up from the best, before a throw and after (none past gold).
    const has = place(b?.time), up = !endless && hint && course.par ? has < 0 ? MEDALS.at(-1) : MEDALS[has - 1] : null;
    score([{ text: `✈ ${got}` }, ...top ? [{ text: `Best ${top}` }] : [], ...up ? [{ text: `${up[0]} ${seconds(medalTime(course.par, up[1]))}` }] : [], ...hint ? [{ text: hint }] : []], verdict);
  };

  // Steering: the stick, and the keys, together.
  const KEYS = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], Space: null };
  const input = () => {
    let steer = 0, climb = 0;
    for (const code of keys) if (KEYS[code] && code !== held) { steer += KEYS[code][0]; climb += KEYS[code][1]; }
    // Each way on its own: a thumb's sweep sideways is seldom level, and shouldn't pitch.
    if (stick.id !== null) { steer += axis(stick.dx); climb -= axis(stick.dy); }
    return { steer: THREE.MathUtils.clamp(steer, -1, 1), climb: THREE.MathUtils.clamp(climb, -1, 1) };
  };

  const planes = {
    root,
    enter() { active = true; keys.clear(); held = null; if (!f || f.mode !== 'ready') restart(); shown = ''; showScore(); dim(true); hear(); },
    leave() { active = false; keys.clear(); letGo(); linger = 0.6; score(null); shown = ''; dim(false); if (f?.mode === 'fly') { keep(); f.mode = 'over'; } },
    blur() { keys.clear(); letGo(); },
    // In front of the stack, facing it.
    stand() {
      const s = facing(), g = grid(); if (!s) return { x: 0, z: 0, yaw: 0 };
      const spot = new THREE.Vector3(s.h.position.x + s.x * STAND, 0, s.h.position.z + s.z * STAND), p = g && nearestOpen(g, spot) || spot;
      return { x: p.x, z: p.z, yaw: Math.atan2(s.h.position.x - p.x, s.h.position.z - p.z) };
    },
    pose() { return { from: from.clone().add(wobble), look: look.clone().add(wobble), fov: FOV + bank.fov, roll: bank.roll, hands: false, wide: true }; },
    click() { return false; }, // presses are the stick's (below)
    // A key while playing: true if it's one of the planes' (office.js leaves it be). The key that threw doesn't steer till it's let go.
    key(code, down) {
      if (!(code in KEYS) || !active) return false;
      if (!down) { keys.delete(code); if (held === code) held = null; return true; }
      if (keys.has(code)) return true;
      hear();
      keys.add(code);
      if (f?.mode === 'ready' && (code === 'Space' || KEYS[code]?.[1] === 1)) { held = code; throwIt(); }
      else if (code === 'Space') { if (f?.mode === 'fly') { keep(); f.mode = 'over'; since = AGAIN; } again(); }
      return true;
    },
    update(dt, reduced) {
      if (!active && (linger -= dt) <= 0) { root.visible = false; return; }
      if (active && f?.mode === 'ready' && (looked += dt) > 1) { looked = 0; const was = course; lay(); if (course !== was) restart(false); }
      root.visible = !!f && !!course; if (!root.visible) return;
      if (active) {
        gather(); since += dt;
        for (const event of fly(f, input(), space, course, dt)) {
          if (event.type === 'ring') {
            if (!reduced) meshOf(event.index).userData.pop = 1;
            course.more?.(f); play('ring', event.index); if (endless && (event.index + 1) % 10 === 0) play('ten');
          }
          if (event.type === 'done') { keep(); const won = place(f.done); play('done', won < 0 ? 0 : MEDALS.length - won); if (record) play('best'); }
          if (event.type === 'crash') {
            if (!reduced) shake = event.surface === 'floor' ? 0.4 : 1;
            said = event.surface === 'person' ? 'Ouch!' : event.surface === 'floor' ? 'Landed' : 'Crash!';
            if (event.surface === 'person') hit(event.id, ['Hey!', 'Paper cut!', 'Watch it!', 'Really?'][Math.floor(Math.random() * 4)]);
            play(event.surface === 'floor' ? 'floor' : 'crash');
            if (f.done == null) { keep(); if (record) play('best'); }
          }
        }
        showScore();
      }
      draw(dt, reduced);
    },
  };

  // How many of the rings show: endless, those up to LAID past the next (more are laid out of sight).
  const showing = () => course.endless ? Math.min(course.rings.length, (f?.next || 0) + LAID + 1) : course.rings.length;
  // Enough rings to draw it (endless: those just passed, still popping, and those laid ahead), and the dotted way round.
  function drawCourse() {
    while (rings.length < (course.endless ? LAID + 5 : course.rings.length)) rings.push(ring());
    for (const mesh of rings) mesh.userData.ring = null;
    const at = start(), points = [new THREE.Vector3(at.x, at.y, at.z), ...course.rings.slice(0, course.endless ? LAID + 1 : undefined).map(r => new THREE.Vector3(r.x, r.y, r.z))];
    guide.geometry.dispose(); guide.geometry = new THREE.BufferGeometry().setFromPoints(points.length > 1 ? new THREE.CatmullRomCurve3(points).getPoints(points.length * 12) : points);
    guide.computeLineDistances();
  }

  const bank = { roll: 0, fov: 0 }, heading = new THREE.Vector3(), at = new THREE.Vector3(), want = new THREE.Vector3(), aim = new THREE.Vector3(), to = new THREE.Vector3();
  // Clear from the plane back to `p`: nothing in the way, inside the office.
  const open = p => p.x > 0.05 && p.z > 0.05 && p.x < space.width - 0.05 && p.z < space.depth - 0.05 && p.y < WALL_H - 0.05 && p.y > 0.05 && space.boxes.every(b => gap(b, p.x, p.y, p.z) > 0.06);
  const facingZ = new THREE.Vector3(0, 0, 1), normal = new THREE.Vector3();
  function draw(dt, reduced) {
    const t = performance.now() / 1000, n = course.rings.length;
    // The plane, and in hand bobbing a little.
    const bob = f.mode === 'ready' && !reduced ? Math.sin(t * 2.2) * 0.015 : 0;
    at.set(f.x, f.y + bob, f.z); plane.position.copy(at);
    plane.rotation.set(-f.pitch, f.yaw, f.mode === 'over' ? plane.rotation.z : f.roll);
    if (f.mode === 'over' && f.hit?.surface === 'floor') plane.rotation.x = 0;
    // The rings: passed ones pop and go, the next pulses. Endless rings are sized to their holes.
    for (const mesh of rings) mesh.visible = false;
    for (let i = course.endless ? Math.max(0, f.next - 2) : 0; i < showing(); i++) {
      const r = course.rings[i], mesh = meshOf(i), u = mesh.userData, size = (r.hole ?? HOLE) / HOLE, last = !course.endless && i === n - 1;
      if (u.ring !== r) { u.ring = r; mesh.position.set(r.x, r.y, r.z); mesh.quaternion.setFromUnitVectors(facingZ, normal.set(r.nx, r.ny, r.nz)); }
      if (i < f.next) { u.pop = reduced ? 0 : Math.max(0, u.pop - dt * 4); mesh.visible = u.pop > 0; mesh.scale.setScalar(size * (1 + (1 - u.pop) * 0.6)); mesh.material.opacity = u.pop * 0.7; u.disc.visible = false; continue; }
      const next = i === f.next, after = i === f.next + 1;
      mesh.visible = true; mesh.material.color.set(last ? LAST : next ? NEXT : '#ffffff'); u.disc.material.color.set(last ? LAST : NEXT);
      mesh.material.opacity = next ? 0.7 : after ? 0.42 : 0.24; u.disc.visible = next;
      mesh.scale.setScalar(size * (next && !reduced ? 1 + Math.sin(t * 5) * 0.05 : 1));
    }
    guide.visible = f.mode === 'ready';
    // The trail: where it's been, newest first.
    if (f.mode === 'fly') { trailPoints.copyWithin(3, 0, (TRAIL - 1) * 3); at.toArray(trailPoints, 0); }
    else if (f.mode === 'ready') for (let i = 0; i < TRAIL; i++) at.toArray(trailPoints, i * 3);
    trail.geometry.attributes.position.needsUpdate = true; trail.visible = f.mode !== 'ready';

    // The view: level behind and over it, looking on past it a little the way its nose goes; pulled in if something's in
    // the way. It follows up and down more slowly than round, so climbs and dives show. Banked with it, a little.
    heading.set(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch));
    if (f.mode !== 'over') {
      let back = NEAREST; const flat = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
      const spot = d => want.copy(at).addScaledVector(flat, -d).setY(at.y + LIFT * d / BACK);
      while (back < BACK && open(spot(back + 0.05))) back += 0.05;
      spot(back); aim.copy(at).addScaledVector(flat, AHEAD); aim.y += Math.tan(f.pitch) * AHEAD * 0.5;
    } else aim.copy(at); // a crash: stay put, looking at where it ended up
    const k = fresh ? 1 : 1 - Math.exp(-dt * 8), up = fresh ? 1 : 1 - Math.exp(-dt * 5);
    if (f.mode !== 'over') { from.x += (want.x - from.x) * k; from.z += (want.z - from.z) * k; from.y += (want.y - from.y) * up; }
    look.lerp(aim, fresh ? 1 : 1 - Math.exp(-dt * 9)); fresh = false;
    bank.roll += ((reduced || f.mode !== 'fly' ? 0 : -f.roll * 0.35) - bank.roll) * (1 - Math.exp(-dt * 5));
    bank.fov = reduced || f.mode !== 'fly' ? 0 : Math.max(0, f.speed - LAUNCH) * 3;
    wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.08 * shake); shake = Math.max(0, shake - dt * 3);

    // The arrow, when the next ring's more than about 35° off the way the view looks.
    const r = course.rings[f.next]; arrow.visible = false;
    if (r && f.mode === 'fly') {
      to.set(r.x - at.x, r.y - at.y, r.z - at.z).normalize(); const ahead = look.clone().sub(from).normalize();
      if (to.dot(ahead) < 0.82) { arrow.visible = true; arrow.position.copy(at).addScaledVector(to, 0.3); arrow.lookAt(at.clone().addScaledVector(to, 2)); }
    }
  }

  // Presses: down throws (a plane in hand) or goes again (after a crash), and from there the press steers as a stick, till it's let go.
  const letGo = () => { stick.id = null; stick.dx = stick.dy = 0; pad.hidden = true; };
  const showPad = () => {
    const box = canvas.getBoundingClientRect(), d = Math.hypot(stick.dx, stick.dy), k = d > STICK ? STICK / d : 1;
    pad.style.left = `${stick.x - box.left + canvas.offsetLeft}px`; pad.style.top = `${stick.y - box.top + canvas.offsetTop}px`;
    pad.firstChild.style.transform = `translate(${stick.dx * k}px, ${stick.dy * k}px)`;
  };
  canvas.addEventListener('pointerdown', event => {
    if (!active || !f || event.pointerType === 'mouse' && event.button !== 0 || stick.id !== null) return;
    hear();
    if (f.mode === 'over' || f.done != null) { again(); return; }
    if (f.mode === 'ready') throwIt();
    Object.assign(stick, { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0 });
    pad.hidden = false; showPad();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== stick.id) return;
    stick.dx = event.clientX - stick.x; stick.dy = event.clientY - stick.y;
    // Past full, where it went down comes along: back from there steers back at once, wherever the thumb has wandered.
    if (Math.abs(stick.dx) > STICK) { const over = stick.dx - Math.sign(stick.dx) * STICK; stick.x += over; stick.dx -= over; }
    if (Math.abs(stick.dy) > STICK) { const over = stick.dy - Math.sign(stick.dy) * STICK; stick.y += over; stick.dy -= over; }
    showPad();
  });
  const lift = event => { if (active) hear(); if (event.pointerId === stick.id) letGo(); };
  canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
  return planes;
}
