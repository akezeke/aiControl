// RC racing round the office (the plan: docs/superpowers/plans/2026-11-11-office-rc-racing.md). The RC car on its dock by the
// filing cabinet (room.js) starts it: pick the NPCs' difficulty and race the day's circuit, or Just drive, anywhere, over
// ramps scattered round the office and glider ramps that throw you over a row of desks, or Collect the day's ten paperclips
// on the clock (some up where only a jump reaches; an arrow over the car points to the nearest). W/↑ throttle, S/↓ brake then reverse,
// A D/← → steer, Space (held) drifts (steering into it tightens it, away widens it) and letting go after a good slide boosts;
// Space just off a ramp is a trick, a boost if it lands straight. C goes round the views (mid, chase, the driver's own eyes,
// high), R back on the track (or to the dock), Esc leaves. On a touchscreen it drives itself forward: hold the left or right
// half to steer, both to drift (then lift one to steer in it; or to back up when it's stopped); 📷 changes the view. The low
// views sit at a tiny driver's eye height, so the office towers over you.
// The rules are rc-physics.js's, the looks rc-car.js's. Every number that shapes the feel is in TUNE (globalThis.rcTune).
import * as THREE from 'three';
import { WALL_H } from './furniture.js';
import { TUNE, SIZE, STEP, newCar, step, floorMap, groundAt } from './rc-physics.js';
import { buildCar, disposeCar, lighten } from './rc-car.js';
import { createTrack, atMeeting, tag } from './friends.js';
import { mm } from './live.js';
import { WIDTH, makeCircuit, racePar, project, rail, createDriver, AUTOPILOT, scatterRamps, placePickups, reaches, SKILL, personalityOf } from './rc-course.js';
import { buildTrack, disposeTrack, buildRamps, buildPickups } from './rc-track.js';
import { dayKey } from './daily.js';

// The views, in C's order, in metres of the office. Behind: how far back (stretching by `stretch` of it flat out) and how high,
// what it looks at (ahead, lift), how fast it catches up (follow) and comes round (turn). `seat`: the driver's eyes, in the
// car's own frame (before SIZE, leaning with the body), looking `ahead` on. `fov`, and `kick` more flat out.
const VIEWS = {
  mid: { back: 0.45, up: 0.28, ahead: 0.85, lift: 0.03, stretch: 0.25, fov: 62, kick: 12, follow: 8, turn: 4, name: 'Mid' },
  chase: { back: 0.28, up: 0.11, ahead: 1.3, lift: 0.09, stretch: 0.35, fov: 70, kick: 16, follow: 12, turn: 6, name: 'Chase' },
  seat: { seat: [0, 0.16, -0.035], ahead: 2, lift: 0.08, fov: 74, kick: 16, follow: 30, name: 'Driver' },
  high: { back: 1.1, up: 1.3, ahead: 0.4, lift: 0, stretch: 0, fov: 58, kick: 6, follow: 5, turn: 2.5, name: 'High' },
};
const ORDER = Object.keys(VIEWS);
// The picker: the NPCs' difficulty, just driving, or collecting (kept per browser, as the last picked).
const LEVELS = ['easy', 'normal', 'hard'], PICK = [...LEVELS, 'free', 'collect'], NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', free: 'Just drive', collect: 'Collect' }, LEVEL_KEY = 'ai-control-rc-difficulty';
// Collect's bests per browser, per day's paperclips ({ day, time } in s), the last KEEP.
const COLLECT_KEY = 'ai-control-rc-collect';
// Laps a race; bests per browser, per circuit ({ day, lap, finish } in s), the last KEEP circuits'.
const LAPS = 3, BEST_KEY = 'ai-control-rc-best', KEEP = 12;
// The field: up to FIELD NPCs (more jam the half-metre track at the first corner, and each car is a dozen more draw calls),
// made up to SPARES.length with spare cars in plain colours. The countdown: 3, 2, 1 a BEAT (s)
// each; throttle pressed within JUMP (s) of GO boosts for START_BOOST, held from before it spins the wheels for SPIN. "Final
// lap!" shows FINAL_FOR s.
const FIELD = 4, SPARES = ['#8b8f99', '#c9c4b8', '#6d7480'], BEAT = 0.8, JUMP = 0.3, START_BOOST = 0.6, SPIN = 0.5, FINAL_FOR = 1.5;
// At a meeting your car is told every TELL_MS (ms); a friend's goes SILENCE (s) after their last word.
const TELL_MS = 100, SILENCE = 3;
const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
// Medals for a lap, against par: gold within it, silver and bronze within these times it.
const MEDALS = [['🥇', 1], ['🥈', 1.15], ['🥉', 1.35]];
const medal = (lap, par) => par ? MEDALS.find(([, k]) => lap <= par * k)?.[0] ?? null : null;
const clock = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const loadBests = (key = BEST_KEY) => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
globalThis.rcViews = VIEWS; // eye height, distance and field of view, live from the console too

// Sound: a soft engine hum whose note follows the speed (low and filtered: it's under everything, not over it), tyres hissing
// in a slide, a thud on a knock. Made on enter (a key or press came first).
let audio, master, engine, tyres, noise;
function startSound() {
  try {
    if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.gain.value = 0.25; master.connect(audio.destination); }
    if (audio.state === 'suspended') audio.resume();
    if (engine) return;
    const a = audio.createOscillator(), b = audio.createOscillator(), low = audio.createBiquadFilter(), g = audio.createGain();
    a.type = 'triangle'; b.type = 'sine'; low.type = 'lowpass'; low.frequency.value = 400; low.Q.value = 0.3; g.gain.value = 0;
    a.connect(low); b.connect(low); low.connect(g).connect(master); a.start(); b.start();
    noise ??= audio.createBuffer(1, audio.sampleRate, audio.sampleRate); const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = audio.createBufferSource(), band = audio.createBiquadFilter(), ng = audio.createGain();
    n.buffer = noise; n.loop = true; band.type = 'bandpass'; band.frequency.value = 1400; band.Q.value = 0.8; ng.gain.value = 0;
    n.connect(band).connect(ng).connect(master); n.start();
    engine = { a, b, low, g }; tyres = { n, g: ng };
  } catch { /* no sound here */ }
}
function stopSound() {
  if (!engine) return;
  const at = audio.currentTime;
  for (const node of [engine.a, engine.b, tyres.n]) node.stop(at + 0.15);
  engine.g.gain.setTargetAtTime(0, at, 0.04); tyres.g.gain.setTargetAtTime(0, at, 0.04); engine = tyres = null;
}
function soundFor(speed, throttle, slip, boosting) {
  if (!engine) return;
  const wind = (Math.abs(speed) / TUNE.top) ** 2 * 0.05;
  const at = audio.currentTime, f = 48 + Math.abs(speed) * 20 + (boosting ? 25 : 0);
  engine.a.frequency.setTargetAtTime(f, at, 0.05); engine.b.frequency.setTargetAtTime(f / 2, at, 0.05);
  engine.low.frequency.setTargetAtTime(260 + Math.abs(throttle) * 220 + Math.abs(speed) * 30, at, 0.08);
  engine.g.gain.setTargetAtTime(0.01 + Math.abs(throttle) * 0.014, at, 0.12);
  tyres.g.gain.setTargetAtTime(Math.min(0.08, Math.max(0, slip - 0.5) * 0.04 + wind * 0.6), at, 0.04);
}
// A little tune: notes (Hz) a beat apart, a lap's chime or the finish.
function tune(notes) {
  if (!engine) return;
  notes.forEach((f, k) => {
    const at = audio.currentTime + k * 0.09, o = audio.createOscillator(), g = audio.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, at); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.12, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(g).connect(master); o.start(at); o.stop(at + 0.37);
  });
}
// Air through a band of noise: a takeoff's whoosh (rising), the wing's paper flap (short and high).
function whoosh(from, to, secs, gain) {
  if (!engine) return;
  const at = audio.currentTime, n = audio.createBufferSource(), band = audio.createBiquadFilter(), g = audio.createGain();
  n.buffer = noise; band.type = 'bandpass'; band.Q.value = 1.2; band.frequency.setValueAtTime(from, at); band.frequency.exponentialRampToValueAtTime(to, at + secs);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + secs * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, at + secs);
  n.connect(band).connect(g).connect(master); n.start(at, Math.random() * 0.5); n.stop(at + secs + 0.02);
}
function thud(speed) {
  if (!engine) return;
  const at = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(160, at); o.frequency.exponentialRampToValueAtTime(50, at + 0.12);
  g.gain.setValueAtTime(Math.min(0.3, speed * 0.07), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
  o.connect(g).connect(master); o.start(at); o.stop(at + 0.17);
}

// Marks the rear tyres leave in a slide, and puffs of dust: both rings of instances, the oldest reused.
function trails(root) {
  const MARKS = 700, marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#141418', transparent: true, opacity: 0.32, depthWrite: false }), MARKS);
  marks.count = 0; marks.frustumCulled = false; root.add(marks);
  const PUFFS = 60, puffs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshBasicMaterial({ color: '#ffffff' }), PUFFS);
  puffs.frustumCulled = false; root.add(puffs);
  const life = new Float32Array(PUFFS), pos = Array.from({ length: PUFFS }, () => new THREE.Vector3()), colour = new THREE.Color();
  let mark = 0, puff = 0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < PUFFS; i++) { puffs.setMatrixAt(i, m.makeScale(0, 0, 0)); puffs.setColorAt(i, colour.set('#fff')); }
  return {
    line(a, b) {
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < 0.005) return;
      // Just over the track's lane and tape.
      m.compose(p.set((a.x + b.x) / 2, 0.0195, (a.z + b.z) / 2), q.setFromAxisAngle(Y, Math.atan2(dx, dz)), s.set(0.035 * SIZE, 1, len + 0.005));
      marks.setMatrixAt(mark, m); mark = (mark + 1) % MARKS; marks.count = Math.min(MARKS, marks.count + 1); marks.instanceMatrix.needsUpdate = true;
    },
    puff(at, tint) { pos[puff].copy(at); life[puff] = 1; puffs.setColorAt(puff, colour.set(tint)); puffs.instanceColor.needsUpdate = true; puff = (puff + 1) % PUFFS; },
    update(dt) {
      for (let i = 0; i < PUFFS; i++) {
        if (life[i] <= 0) continue;
        life[i] = Math.max(0, life[i] - dt * 2); pos[i].y += dt * 0.15 * SIZE;
        const k = life[i], r = (0.006 + (1 - k) * 0.018 * Math.min(1, k * 4)) * SIZE;
        puffs.setMatrixAt(i, m.compose(pos[i], q.identity(), s.setScalar(k > 0 ? r : 0)));
      }
      puffs.instanceMatrix.needsUpdate = true;
    },
    clear() { marks.count = 0; mark = 0; life.fill(0); },
  };
}

// Dust in the air round the car, specks to something this small: still where they hang, so they stream past, drawn as streaks
// as long as the car goes in STREAK seconds. They're kept in a box round the car, wrapped from one side to the other. Where
// they are on screen decides how bright: none inside the ellipse CLEAR (of the half-width and half-height), fading in to full
// by EDGE of it, so they stream past the edges of the picture whatever the view, and the middle stays clear. Added on, so dark is
// none.
function motes(root, camera) {
  const N = 140, BOX = 2.4, HIGH = 0.5, STREAK = 0.09, CLEAR = 0.7, EDGE = 1.05, at = new Float32Array(N * 3), points = new Float32Array(N * 6), shades = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) { at[i * 3] = (Math.random() - 0.5) * BOX; at[i * 3 + 1] = 0.01 + Math.random() ** 1.6 * HIGH; at[i * 3 + 2] = (Math.random() - 0.5) * BOX; }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  lines.geometry.setAttribute('position', new THREE.BufferAttribute(points, 3)); lines.geometry.setAttribute('color', new THREE.BufferAttribute(shades, 3));
  lines.frustumCulled = false; root.add(lines);
  const wrap = (v, centre) => centre + ((((v - centre) % BOX) + BOX * 1.5) % BOX) - BOX / 2, p = new THREE.Vector3();
  return {
    // x, z: the car; vx, vz: its velocity in the office (m/s); amount 0..1: how much they show. On screen as the view was last drawn.
    update(x, z, vx, vz, amount) {
      lines.material.opacity = amount; lines.visible = amount > 0.02; if (!lines.visible) return;
      for (let i = 0; i < N; i++) {
        const px = at[i * 3] = wrap(at[i * 3], x), py = at[i * 3 + 1], pz = at[i * 3 + 2] = wrap(at[i * 3 + 2], z);
        p.set(px, py, pz).project(camera);
        const e = Math.hypot(p.x / 0.8, p.y / 0.75), k = p.z > 1 ? 0 : THREE.MathUtils.smoothstep(e, CLEAR, EDGE);
        points.set([px, py, pz, px - vx * STREAK, py, pz - vz * STREAK], i * 6);
        shades.fill(k, i * 6, i * 6 + 6);
      }
      lines.geometry.attributes.position.needsUpdate = true; lines.geometry.attributes.color.needsUpdate = true;
    },
    hide() { lines.visible = false; },
  };
}

// `solids()`: the room's root, for the floor map; `boxes()`: the room's flight boxes, only to tell when it's changed (a new
// list comes with every snapshot, the same boxes mostly); `people()`: columns { id, x, z, r }; `from()`: the dock, { x, z, yaw }
// with yaw into the room; `bounds()`: the office's { width, depth } (the circuit stays in it); `racers()`: the sessions that
// race, [{ id, colour, busy, at }]; `score(lines, verdict)`: the bar;
// `hit(id, line)`: someone was run into; `camera`: its near plane comes in while driving, the driver's eyes being a few cm from
// the windscreen; `dark()`: the room's lights are off, so the headlights show; `send(message)`: tells a meeting; `parked()`:
// the car on the dock, hidden while it's out racing; `time(name, fn)`: runs fn, timing it for the debug view (debug.js).
export function createRace({ canvas, camera, solids, boxes, people, from, bounds, racers = () => [], score, hit = () => {}, dark = () => false, send = () => {}, parked = () => null, time = (name, fn) => fn() }) {
  let lit = 0;
  let map = null, mapOf = null, mapSig = '';
  const none = { each() {}, open: () => true };
  const signature = list => list.reduce((sum, b) => sum + b.min.x * 3 + b.min.y * 5 + b.min.z * 7 + b.max.x * 11 + b.max.y * 13 + b.max.z * 17, list.length).toFixed(3);
  // The floor map, made again (when the room's changed) only as a race is laid, and kept through it: a desk coming up mid-race
  // is a ghost till the finish.
  const solid = () => {
    const list = boxes(); if (list === mapOf && map) return map;
    mapOf = list; const sig = signature(list); if (sig !== mapSig || !map) { mapSig = sig; const t = performance.now(); map = floorMap(solids()) || none; globalThis.rcMapMs = performance.now() - t; }
    return map;
  };
  const blocks = () => map || none;
  const root = new THREE.Group(); root.visible = false;
  const { car, body, wing, wheels, fronts, flames, driver, lamps } = buildCar(); root.add(car);
  car.rotation.order = 'YXZ'; // its pitch (up a ramp, along an arc) about its own width, after its heading
  // Its shadow on whatever's under it, in the air: a dark disc, fainter the higher it is.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthWrite: false }));
  shadow.visible = false; root.add(shadow);
  // Collecting: a gold arrow over the car, pointing at the nearest paperclip left.
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd84a' }));
  arrow.visible = false; root.add(arrow);
  let world = { solids: { each() {}, open: () => true }, columns: [] }, wingOut = 0, flip = 0, tilt = 0, blend = 0;
  const fx = trails(root), dust = motes(root, camera);
  let near = camera.near;
  const setNear = n => { camera.near = n; camera.updateProjectionMatrix(); };
  // The edges darken flat out, the way a view narrows at speed.
  const vignette = document.createElement('div');
  Object.assign(vignette.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 1, opacity: 0, background: 'radial-gradient(ellipse at 50% 55%, transparent 52%, rgba(10,8,20,.55) 100%)' });
  canvas.parentElement?.appendChild(vignette);
  const keys = new Set(), touches = new Map(); let touch = false, sliding = false;
  // A meeting hears where your car is while you drive, and 'off' when you're done.
  let told = 0, out = false;
  const tell = () => {
    const now = performance.now(); if (now - told < TELL_MS) return; told = now; out = true;
    send({ type: 'car', mode: 'drive', x: mm(c.x), y: mm(c.y), z: mm(c.z), yaw: mm(c.yaw), steer: mm(c.steer), glide: !!c.air?.glide, t: Math.round(now) });
  };
  const recall = () => { if (out) { send({ type: 'car', mode: 'off' }); out = false; } };
  const c = newCar({ x: 0, z: 0, yaw: 0 });
  globalThis.rcCar = c; globalThis.rcWorld = () => ({ ...world, clips: loose?.clips }); // dev: the car, what it drives on and the paperclips, from the console (headless checks), as rcTune
  let active = false, view = ORDER[0], home = null, acc = 0, said = '', shake = 0, bumped = 0, accel = 0, camBack = 0;
  // The physics steps at STEP; what's drawn is between the last two steps, so it glides at any frame rate instead of juddering.
  const prev = { x: 0, y: 0, z: 0, yaw: 0 }, shown = { x: 0, y: 0, z: 0, yaw: 0 };
  const lean = { roll: 0, rv: 0, pitch: 0, pv: 0 }, cam = { yaw: 0, from: new THREE.Vector3(), look: new THREE.Vector3(), fov: 70, roll: 0 };
  const wobble = new THREE.Vector3(), rear = [new THREE.Vector3(), new THREE.Vector3()], was = [null, null], want = new THREE.Vector3(), aim = new THREE.Vector3();

  const button = document.createElement('button');
  button.textContent = '📷'; button.title = 'Change view (C)'; button.hidden = true;
  Object.assign(button.style, { position: 'absolute', bottom: '72px', right: '16px', zIndex: 5, font: '20px system-ui', padding: '6px 10px', borderRadius: '10px', border: '0', background: '#0008', color: '#fff' });
  button.addEventListener('pointerdown', event => event.stopPropagation());
  button.addEventListener('click', () => swap());
  canvas.parentElement?.appendChild(button);
  const swap = () => { view = ORDER[(ORDER.indexOf(view) + 1) % ORDER.length]; said = ''; };
  const rescueButton = button.cloneNode(); rescueButton.textContent = '↺'; rescueButton.title = 'Back on the track (R)'; rescueButton.style.right = '72px';
  rescueButton.addEventListener('pointerdown', event => event.stopPropagation()); rescueButton.addEventListener('click', () => rescue());
  canvas.parentElement?.appendChild(rescueButton);

  // The NPCs' difficulty, picked as you step up: three buttons over the view, the last one picked lit (kept per browser).
  let level = 'normal', picking = false;
  try { const kept = localStorage.getItem(LEVEL_KEY); if (PICK.includes(kept)) level = kept; } catch { /* no storage here */ }
  const picker = document.createElement('div'); picker.hidden = true;
  Object.assign(picker.style, { position: 'absolute', left: '50%', top: '40%', transform: 'translateX(-50%)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px', width: 'max-content', maxWidth: 'calc(100% - 32px)', zIndex: 5 });
  const choices = PICK.map(name => {
    const b = document.createElement('button'); b.textContent = NAMES[name]; b.dataset.level = name;
    Object.assign(b.style, { font: '600 18px system-ui', padding: '10px 18px', borderRadius: '12px', border: '0', cursor: 'pointer' });
    b.addEventListener('pointerdown', event => event.stopPropagation()); b.addEventListener('click', () => choose(name));
    picker.appendChild(b); return b;
  });
  canvas.parentElement?.appendChild(picker);
  const light = () => { for (const b of choices) { const on = b.dataset.level === level; b.style.background = on ? '#ffd23f' : '#000a'; b.style.color = on ? '#1b1c22' : '#fff'; } };
  const choose = name => { level = name; try { localStorage.setItem(LEVEL_KEY, name); } catch { /* no storage here */ } picking = false; picker.hidden = true; keys.clear(); said = ''; race = { state: 'lay', free: name === 'free', collect: name === 'collect' }; setTimeout(lay, 30); };

  // The race: laid once you've picked (the next frame, as the map, the circuit and its par take a moment, and kept for the day
  // and the office as it is), then three laps from the back of the grid on simulated time. A lap counts once it's passed a
  // quarter, half and three quarters of the way round in order and crosses the line. state: 'lay', 'race', 'done', or 'free'
  // (just driving, picked or with no room for a circuit: `why` 'none'), over the day's scattered ramps (`loose`, kept as the
  // circuit is), or 'collect' then 'got' (the paperclips, `loose.clips`; the clock starts with the throttle). (A time trial till
  // the NPCs come.)
  let race = null, laid = null, loose = null, road = true;
  // The track's kerbs, for a car (each keeps its own place along it, `near`).
  const rails = car => { const r = rail(laid.circuit, car.x, car.z, car.near ?? -1); car.near = r.i; return r.depth ? r : null; };
  const autopilot = createDriver({ skill: AUTOPILOT });
  function lay() {
    if (!active || race?.state !== 'lay') return;
    const m = solid(), room = bounds?.(), d = home;
    const seed = room ? `${dayKey(new Date())}:${room.width.toFixed(1)}x${room.depth.toFixed(1)}` : '', key = `${seed}:${mapSig}`;
    const start = { x: d.x + Math.sin(d.yaw) * 0.6, z: d.z + Math.cos(d.yaw) * 0.6, yaw: d.yaw };
    const roam = why => {
      if (loose?.key !== key) {
        if (loose?.group) disposeTrack(loose.group);
        if (loose?.clipped) disposeTrack(loose.clipped); // the last day's (or room's) paperclips too
        const ramps = room && m !== none ? scatterRamps({ map: m, room, start, seed, columns: people() }) : [];
        loose = { key, ramps, group: buildRamps(ramps) }; root.add(loose.group);
      }
      clearField(); loose.group.visible = true; if (laid?.track) laid.track.visible = false;
      if (loose.clipped) loose.clipped.visible = false;
      race = { state: 'free', why }; said = '';
    };
    if (race.free) { roam(); return; }
    if (race.collect) {
      roam();
      if (!loose.clipped) { loose.clips = room && m !== none ? placePickups({ map: m, room, start, seed, ramps: loose.ramps, columns: people() }) : []; loose.clipped = buildPickups(loose.clips); root.add(loose.clipped); }
      collect(); return;
    }
    if (loose) { loose.group.visible = false; if (loose.clipped) loose.clipped.visible = false; }
    if (laid?.key !== key) {
      if (laid?.track) disposeTrack(laid.track);
      const circuit = room && m !== none ? makeCircuit({ map: m, room, start, seed }) : null;
      laid = { key, circuit, par: circuit && racePar(circuit, { solids: m, columns: [] }), track: circuit && buildTrack(circuit) };
      if (laid.track) root.add(laid.track);
    }
    if (laid.track) laid.track.visible = true;
    if (laid.circuit) go(); else roam('none');
  }
  // Collect from the start: every paperclip out, by the dock, the clock at nought till the throttle.
  function collect() {
    for (const { node } of loose.clipped.userData.items) node.visible = true;
    loose.clipped.visible = true; rescue(true);
    race = { state: 'collect', t: 0, going: false, got: 0, taken: new Set(), best: loadBests(COLLECT_KEY)[loose.key]?.time ?? null }; said = '';
  }
  // Each paperclip the car's middle is within reach of; all of them, the time and a best kept.
  function pickUp() {
    for (const [k, { node, clip }] of loose.clipped.userData.items.entries()) {
      if (race.taken.has(k) || !reaches(c, clip)) continue;
      race.taken.add(k); race.got++; node.visible = false; said = '';
      for (let n = 0; n < 6; n++) fx.puff(node.position, '#ffd84a');
      if (race.got < loose.clips.length) { tune([1319, 1760]); continue; }
      race.state = 'got'; race.time = race.t;
      const all = loadBests(COLLECT_KEY), had = all[loose.key];
      race.record = !had || race.t < had.time;
      delete all[loose.key]; all[loose.key] = { day: dayKey(new Date()), time: had ? Math.min(had.time, race.t) : race.t };
      for (const old of Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - KEEP))) delete all[old];
      try { localStorage.setItem(COLLECT_KEY, JSON.stringify(all)); } catch { /* no storage here */ }
      tune([523, 659, 784, 1047, ...race.record ? [1319] : []]);
    }
  }
  // The field: a car for each racer (racers(): your sessions, busiest first), spare ones to make SPARES.length, on the grid
  // ahead of you, each in its desk's colour. Each { parts, car (rc-physics.js's), drive, prev, near, last, done (m round), time
  // (s, finished), pop (0..1, coming back after a respawn), flip (a trick's roll) }.
  let npcs = [];
  function clearField() {
    for (const n of npcs) disposeCar(n.parts);
    npcs = [];
  }
  function makeField() {
    clearField();
    const list = racers().slice(0, FIELD), day = dayKey(new Date()), { circuit } = laid;
    while (list.length < SPARES.length) list.push({ id: `spare${list.length}`, colour: SPARES[list.length] });
    npcs = list.map((r, k) => {
      const parts = lighten(buildCar({ colour: r.colour })), car = Object.assign(newCar(circuit.grid[k]), { id: r.id });
      for (const m of [parts.lamps.pool, ...parts.lamps.beams]) m.visible = false;
      root.add(parts.car);
      return { parts, car, drive: createDriver({ skill: SKILL[level] ?? SKILL.normal, personality: personalityOf(r.id), seed: `${r.id}:${day}` }), prev: { x: car.x, y: 0, z: car.z, yaw: car.yaw }, near: -1, last: null, done: -(circuit.length - project(circuit, car.x, car.z).s), time: null, pop: 1, flip: 0 };
    });
    for (const n of npcs) { n.start = n.done; n.parts.car.rotation.order = 'YXZ'; }
  }
  // Each NPC a step: its driver (the rubber band from how far ahead you are), the physics, how far round it's got.
  function stepField() {
    const { circuit } = laid, L = circuit.length;
    for (const n of npcs) {
      const k = n.car; Object.assign(n.prev, { x: k.x, y: k.y, z: k.z, yaw: k.yaw });
      const input = n.drive(k, circuit, world, race.t, { gap: race.done - n.done, final: n.done > (LAPS - 1) * L });
      if (input.respawned) n.pop = 0;
      step(k, input, world, STEP, []);
      const at = project(circuit, k.x, k.z, n.near); n.near = at.i;
      if (n.last !== null) { let d = at.s - n.last; if (d < -L / 2) d += L; if (d > L / 2) d -= L; n.done += d; }
      n.last = at.s;
      if (n.time === null && n.done >= LAPS * L) n.time = race.t;
    }
  }
  // To the back of the grid behind the field, and the countdown.
  function go() {
    makeField();
    const { circuit } = laid, slot = circuit.grid[npcs.length];
    put(slot.x, slot.z, slot.yaw); c.id = 'you';
    race = { state: 'count', t: -3 * BEAT, lapStart: 0, laps: [], passed: 0, near: -1, s: 0, done: -(circuit.length - project(circuit, slot.x, slot.z).s), place: npcs.length + 1, pressed: null, spin: 0, finalAt: null, best: loadBests()[circuit.key]?.lap ?? null };
    road = true; said = '';
  }
  // The countdown's beeps, and at GO: a boost for throttle pressed just before it, wheelspin for throttle held from earlier.
  function countdown(i) {
    const was = Math.ceil(-race.t / BEAT); race.t += STEP;
    if (i.throttle > 0) race.pressed ??= race.t; else race.pressed = null;
    const now = Math.ceil(-race.t / BEAT);
    if (now !== was && now > 0) tune([440]);
    if (race.t < 0) return;
    race.state = 'race'; race.t = 0; said = ''; tune([880]);
    if (race.pressed !== null) { if (race.pressed >= -JUMP) { c.boost = START_BOOST; } else race.spin = SPIN; }
  }
  // The car at rest at (x, z) facing yaw, the view straight behind it.
  function put(x, z, yaw) {
    Object.assign(c, newCar({ x, z, yaw })); Object.assign(prev, { x, y: 0, z, yaw }); Object.assign(shown, prev);
    accel = 0; camBack = VIEWS[view].back || 0; cam.yaw = yaw; place(1); fx.clear(); was[0] = was[1] = null;
  }
  // Back on the track where you'd got to, facing on, stopped; just driving or collecting (or `dock`), back by the dock.
  function rescue(dock = false) {
    if (dock || race?.state === 'free' || race?.state === 'collect') { put(home.x + Math.sin(home.yaw) * 0.35, home.z + Math.cos(home.yaw) * 0.35, home.yaw); return; }
    if (race?.state !== 'race') return;
    const { points } = laid.circuit, count = points.length / 2, i = Math.max(0, race.near), b = (i + 1) % count;
    put(points[i * 2], points[i * 2 + 1], Math.atan2(points[b * 2] - points[i * 2], points[b * 2 + 1] - points[i * 2 + 1]));
  }
  // After each step: how far round, the checkpoints and the line, and whether it's on the road.
  function progress() {
    const { circuit } = laid, L = circuit.length, at = project(circuit, c.x, c.z, race.near);
    road = Math.abs(at.side) <= WIDTH / 2 + 0.03;
    if (race.near >= 0) { let d = at.s - race.s; if (d < -L / 2) d += L; if (d > L / 2) d -= L; race.done += d; }
    // Where you are in the field (by how far round), and a whoosh passing someone.
    const place = 1 + npcs.filter(n => n.done > race.done).length;
    if (place < race.place) whoosh(500, 1400, 0.25, 0.05);
    if (place !== race.place) { race.place = place; said = ''; }
    if (race.near >= 0) {
      const was = race.s, f = circuit.checkpoints[race.passed] * L;
      if (race.passed < circuit.checkpoints.length && was < f && at.s >= f && at.s - was < L / 2) race.passed++;
      if (was > 0.75 * L && at.s < 0.25 * L && race.passed === circuit.checkpoints.length) lapped();
    }
    race.near = at.i; race.s = at.s;
  }
  function lapped() {
    race.laps.push(race.t - race.lapStart); race.lapStart = race.t; race.passed = 0; said = '';
    if (race.laps.length === LAPS - 1) race.finalAt = race.t;
    if (race.laps.length < LAPS) { tune([784, 1047]); return; }
    race.state = 'done';
    const lap = Math.min(...race.laps), finish = race.laps.reduce((a, b) => a + b, 0), all = loadBests(), had = all[laid.circuit.key];
    race.record = !had || lap < had.lap; race.lap = lap; race.finish = finish;
    // Those still going: a finishing time from what's left at their pace so far. Your place by finishing times.
    const L = laid.circuit.length, timeOf = n => n.time ?? race.t + (LAPS * L - n.done) / Math.max(0.05, (n.done - n.start) / race.t);
    race.place = 1 + npcs.filter(n => timeOf(n) < race.t).length;
    delete all[laid.circuit.key];
    all[laid.circuit.key] = { day: dayKey(new Date()), lap: had ? Math.min(had.lap, lap) : lap, finish: had ? Math.min(had.finish, finish) : finish };
    for (const k of Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - KEEP))) delete all[k];
    try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch { /* no storage here */ }
    tune([523, 659, 784, 1047, ...race.record ? [1319] : []]);
  }

  const input = () => {
    const k = code => keys.has(code) ? 1 : 0;
    let throttle = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'), steer = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft'), drift = keys.has('Space');
    if (touch && touches.size) {
      const sides = [...touches.values()], left = sides.includes('L'), right = sides.includes('R');
      steer = (right ? 1 : 0) - (left ? 1 : 0); throttle = 1;
      // Both halves: a drift (or backing up, stopped), held while either stays down, so lifting one steers in it.
      if (left && right) { if (Math.abs(c.fwd) < 0.6 || c.fwd < 0) throttle = -1; else sliding = true; }
      drift = sliding;
    } else { sliding = false; if (touch && !keys.size) throttle = 1; }
    return { throttle: Math.max(-1, Math.min(1, throttle)), steer: Math.max(-1, Math.min(1, steer)), drift };
  };
  const hint = () => {
    const now = race?.state === 'race' ? (race.t - race.lapStart).toFixed(1) : race?.state === 'collect' ? race.t.toFixed(1) : race?.state === 'count' ? Math.ceil(-race.t / BEAT) : '';
    const final = race?.state === 'race' && race.finalAt !== null && race.t - race.finalAt < FINAL_FOR, started = race?.state === 'race' && race.t < 0.7;
    const line = `${view}:${touch}:${picking}:${race?.state}:${now}:${race?.laps?.length}:${race?.got}:${race?.place}:${final}:${started}`; if (line === said) return; said = line;
    if (race?.state === 'count') { score([{ text: `🚦 ${now}` }]); return; }
    if (picking) { score([{ text: '🏎' }, ...touch ? [] : [{ text: '← → · Enter' }]]); return; }
    if (race?.state === 'lay') { score([{ text: '🏁 …' }]); return; }
    if (race?.state === 'race') {
      // The next medal up from your best, as planes do: bronze with none yet, nothing past gold.
      const par = laid.par, has = race.best == null ? -1 : MEDALS.findIndex(([icon]) => icon === medal(race.best, par)), next = has < 0 ? MEDALS.at(-1) : MEDALS[has - 1];
      score([{ text: `${race.place}/${npcs.length + 1}` }, { text: `Lap ${Math.min(LAPS, race.laps.length + 1)}/${LAPS}` }, { text: clock(race.t - race.lapStart) },
        ...race.best != null ? [{ text: `Best ${clock(race.best)}` }] : [], ...!race.laps.length && next && par ? [{ text: `${next[0]} ${clock(par * next[1])}` }] : []], started ? 'GO!' : final ? 'Final lap!' : null);
      return;
    }
    if (race?.state === 'collect') {
      score([{ text: `📎 ${race.got}/${loose.clips.length}` }, { text: clock(race.t) }, ...race.best != null ? [{ text: `Best ${clock(race.best)}` }] : []]);
      return;
    }
    if (race?.state === 'got') {
      score([{ text: `🏁 ${clock(race.time)}` }, ...race.best != null && !race.record ? [{ text: `Best ${clock(race.best)}` }] : [], { text: touch ? 'Tap again' : 'Space again' }], race.record ? 'New best!' : null);
      return;
    }
    if (race?.state === 'done') {
      score([{ text: `🏁 ${ordinal(race.place)} of ${npcs.length + 1}` }, { text: `Total ${clock(race.finish)}` }, { text: `Best lap ${clock(race.lap)} ${medal(race.lap, laid.par) ?? ''}`.trim() }, { text: touch ? 'Tap again' : 'Space again' }], race.record ? 'New best!' : null);
      return;
    }
    const keysLine = touch ? 'Hold sides to steer · both to drift, then lift one' : `WASD · Space drift, trick · R ${race?.state === 'free' ? 'dock' : 'track'} · C view`;
    score([{ text: race?.state === 'free' ? race.why ? '🏎 No room for a track' : '🏎 Just drive' : `🏎 ${VIEWS[view].name} view` }, { text: keysLine }]);
  };

  const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyR', 'Enter', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);
  const PICKS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
  const game = {
    root,
    enter() {
      active = true; keys.clear(); touches.clear(); home = from(); picking = true; light(); picker.hidden = false;
      const p = parked(); if (p) p.visible = false;
      // On the floor just in front of the dock, facing into the room.
      Object.assign(c, newCar({ x: home.x + Math.sin(home.yaw) * 0.35, z: home.z + Math.cos(home.yaw) * 0.35, yaw: home.yaw }));
      Object.assign(prev, { x: c.x, y: 0, z: c.z, yaw: c.yaw }); Object.assign(shown, prev); accel = 0; camBack = VIEWS[view].back || 0;
      cam.yaw = c.yaw; place(1); fx.clear(); was[0] = was[1] = null; root.visible = true; button.hidden = false; said = ''; hint(); startSound();
      canvas.parentElement?.classList.add('office-planes'); near = camera.near; setNear(0.01);
    },
    leave() { recall(); clearField(); const p = parked(); if (p) p.visible = true; active = false; picking = false; race = null; picker.hidden = true; root.visible = false; button.hidden = true; rescueButton.hidden = true; vignette.style.opacity = 0; dust.hide(); keys.clear(); touches.clear(); score(null); stopSound(); canvas.parentElement?.classList.remove('office-planes'); setNear(near); },
    blur() { keys.clear(); touches.clear(); },
    // In front of the dock, facing it.
    stand() { const d = home || from(); return { x: d.x + Math.sin(d.yaw) * 0.9, z: d.z + Math.cos(d.yaw) * 0.9, yaw: d.yaw + Math.PI }; },
    // Wide on a phone held upright: past the office's usual widest, so a corner coming shows in portrait too.
    pose() { return { from: cam.from.clone().add(wobble), look: cam.look.clone().add(wobble), fov: cam.fov, roll: cam.roll, hands: false, wide: true, widest: 115 }; },
    click() { return false; },
    key(code, down) {
      if (!active || !KEYS.has(code)) return false;
      touch = false;
      if (picking) {
        if (!down) return true;
        if (code in PICKS) { level = PICK[(PICK.indexOf(level) + PICKS[code] + PICK.length) % PICK.length]; light(); }
        else if (code === 'Enter' || code === 'Space') choose(level);
        else if (code.startsWith('Digit')) choose(PICK[+code.slice(5) - 1]);
        return true;
      }
      if (!down) { keys.delete(code); return true; }
      if (code === 'KeyC') { if (!keys.has(code)) swap(); keys.add(code); return true; }
      if (code === 'KeyR') { if (!keys.has(code)) rescue(); keys.add(code); return true; }
      if (code === 'Space' && (race?.state === 'done' || race?.state === 'got')) { if (!keys.has(code)) { if (race.state === 'got') collect(); else go(); } keys.add(code); return true; }
      keys.add(code); return true;
    },
    update(dt, reduced) {
      if (!active) return;
      const events = [], racing = race?.state === 'race', free = ['free', 'collect', 'got'].includes(race?.state), onTrack = !free && race && race.state !== 'lay' && laid?.circuit;
      world = { solids: blocks(), columns: time('race people', people), ramps: free ? loose.ramps : onTrack ? laid.circuit.ramps : [], cars: onTrack ? [c, ...npcs.map(n => n.car)] : [], ...onTrack && { surface: () => ({ ground: 0, road }), rails } };
      acc = Math.min(acc + dt, 0.1);
      // Still while picking, laying or done; the autopilot drives while rcAuto is set (a dev switch for checks, as rcTune).
      const idle = picking || !race || race.state === 'lay' || race.state === 'done' || race.state === 'got' || race.state === 'count', i = idle ? { throttle: 0, steer: 0, drift: false } : racing && globalThis.rcAuto ? autopilot(c, laid.circuit, world, race.t) : input(), before = c.fwd;
      let steps = 0;
      const held = race?.state === 'count' ? input() : null;
      time('race physics', () => { while (acc >= STEP) {
        prev.x = c.x; prev.y = c.y; prev.z = c.z; prev.yaw = c.yaw;
        if (race?.state === 'count') countdown(held);
        const spinning = race?.spin > 0; if (spinning) race.spin -= STEP;
        step(c, spinning ? { ...i, throttle: 0 } : i, world, STEP, events); acc -= STEP; steps++;
        if (npcs.length && (race?.state === 'race' || race?.state === 'done')) stepField();
        if (racing && race.state === 'race') { race.t += STEP; progress(); }
        if (race?.state === 'collect') { if (i.throttle) race.going = true; if (race.going) race.t += STEP; pickUp(); }
      } });
      rescueButton.hidden = !(racing && touch);
      const a = blend = acc / STEP; shown.x = prev.x + (c.x - prev.x) * a; shown.y = prev.y + (c.y - prev.y) * a; shown.z = prev.z + (c.z - prev.z) * a; shown.yaw = prev.yaw + (c.yaw - prev.yaw) * a;
      // How hard it's speeding up or braking, smoothed: frames take 0, 1 or 2 steps, and the body shouldn't twitch with that.
      if (steps) accel += ((c.fwd - before) / (steps * STEP) - accel) * (1 - Math.exp(-dt * 8));
      for (const e of events) {
        if (e.type === 'bump' && e.speed > 0.8 && bumped <= 0) { thud(e.speed); bumped = 0.12; if (!reduced) shake = Math.min(1, e.speed / 5); if (e.id && e.speed > 1.5) hit(e.id, ['Hey!', 'My ankles!', 'Watch it!', 'Vroom yourself!'][Math.floor(Math.random() * 4)]); }
        // Off a ramp: a whoosh; the wing out with a paper flap; down with a thump (a jingle for a trick landed straight).
        else if (e.type === 'takeoff' && Math.abs(c.fwd) > 1) whoosh(300, e.glide ? 1600 : 1100, e.glide ? 0.6 : 0.3, e.glide ? 0.12 : 0.07);
        else if (e.type === 'unfold') whoosh(2600, 1800, 0.18, 0.08);
        else if (e.type === 'land') { if (e.fall > 0.4) thud(Math.min(4, e.fall * 2.5)); if (e.trick === 'clean') tune([880, 1175, 1568]); if (!reduced && e.fall > 1.5) shake = Math.min(0.6, e.fall / 6); }
      }
      bumped -= dt;
      time('race sound', () => soundFor(c.fwd, i.throttle, c.air ? 0 : Math.abs(c.side) + (i.drift && Math.abs(c.fwd) > 1 ? 1 : 0), c.boost > 0));
      time('race draw', () => draw(dt, reduced, i));
      if (!picking) tell();
      time('race hint', hint);
    },
  };

  function draw(dt, reduced, i) {
    car.position.set(shown.x, shown.y, shown.z); car.rotation.y = shown.yaw;
    // Nose up a ramp and along its arc in the air (gently on the wing), from the way it's going.
    const flat = Math.hypot(c.vx, c.vz) * TUNE.pace, slope = c.air?.glide ? 0.3 : 1;
    tilt += (-Math.atan2(c.vy * slope, Math.max(0.3, flat)) * (c.air || c.on ? 1 : 0) - tilt) * (1 - Math.exp(-dt * 14));
    car.rotation.x = tilt;
    // The paper wing: out from its spine over a quarter second on the glide (at once with reduced motion), folded on landing.
    wingOut = c.air?.glide ? reduced ? 1 : Math.min(1, wingOut + dt * 4) : 0;
    wing.visible = wingOut > 0; wing.scale.set(Math.max(0.05, wingOut), 1, 1);
    // A trick: one roll over the next 0.4 s (none with reduced motion; the boost still counts).
    flip = c.air?.trick && !reduced ? Math.min(1, flip + dt / 0.4) : 0;
    const under = groundAt(world, shown.x, shown.z, shown.y).y, high = shown.y - under;
    shadow.visible = high > 0.02; shadow.position.set(shown.x, under + 0.019, shown.z); shadow.material.opacity = 0.35 * Math.max(0, 1 - high / 1.4);
    for (const f of fronts) f.rotation.y = -c.steer * 0.45;
    for (const w of wheels) w.rotation.x += c.fwd * TUNE.pace * dt / w.userData.r;
    // The body leans out of a turn and dips under braking, on a spring that overshoots a little.
    const roll = THREE.MathUtils.clamp(c.fwd * c.spin * 0.02, -0.14, 0.14), pitch = THREE.MathUtils.clamp(-accel * 0.008, -0.09, 0.09);
    // In steps of STEP at most: in one long frame (0.1 s) a spring this stiff blows up, and the driver's view rides on it.
    for (let left = dt; left > 0; left -= STEP) {
      const h = Math.min(left, STEP);
      lean.rv += (180 * (roll - lean.roll) - 14 * lean.rv) * h; lean.roll += lean.rv * h;
      lean.pv += (160 * (pitch - lean.pitch) - 13 * lean.pv) * h; lean.pitch += lean.pv * h;
    }
    body.rotation.set(reduced ? 0 : lean.pitch, 0, (reduced ? 0 : lean.roll) + (view === 'seat' ? 0 : flip * Math.PI * 2)); // from in it, no barrel roll
    for (const flame of flames) { flame.visible = c.boost > 0; flame.scale.setScalar(reduced ? 1 : 0.8 + Math.random() * 0.5); }
    driver.visible = view !== 'seat'; // you're in it
    // Headlights come up as the room goes dark; the brake lights glow braking, and dimly with the headlights on.
    lit += ((dark() ? 1 : 0) - lit) * (1 - Math.exp(-dt * 4));
    lamps.pool.visible = lamps.beams[0].visible = lamps.beams[1].visible = lit > 0.01;
    lamps.pool.material.opacity = lit * 0.55; lamps.beam.opacity = lit * 0.02;
    lamps.front.color.set(lit > 0.5 ? '#fff7d6' : '#e8e1c8');
    lamps.tail.color.set(i.throttle < 0 && c.fwd > 0.3 ? '#ff2b2b' : lit > 0.5 ? '#a51818' : '#6a1414');

    // Rear tyres: a mark while it slides (or brakes hard), and dust in a drift, bluer then orange as the boost charges.
    const sliding = shown.y < 0.005 && (Math.abs(c.side) > 0.45 || (i.drift && Math.abs(c.fwd) > 1) || (i.throttle < 0 && c.fwd > 1.5)); // on the floor
    const s = Math.sin(shown.yaw), co = Math.cos(shown.yaw);
    for (const [k, x] of [[0, 0.115 * SIZE], [1, -0.115 * SIZE]]) {
      rear[k].set(shown.x - co * x - s * 0.115 * SIZE, 0.01, shown.z + s * x - co * 0.115 * SIZE);
      if (sliding) { if (was[k]) fx.line(was[k], rear[k]); was[k] = (was[k] || new THREE.Vector3()).copy(rear[k]); } else was[k] = null;
      if (sliding && !reduced && Math.random() < 0.3) fx.puff(rear[k], c.charge >= TUNE.boostFull ? '#ff9a3c' : c.charge > 0.3 ? '#7fd3ff' : '#e9e6df');
    }
    fx.update(dt);
    // The field, between its last two steps as yours is: wheels, steering, a trick's roll, flames, and a respawn growing back.
    for (const n of npcs) {
      const k = n.car, p = n.prev, car = n.parts.car, x = p.x + (k.x - p.x) * blend, y = p.y + (k.y - p.y) * blend, z = p.z + (k.z - p.z) * blend;
      car.position.set(x, y, z); car.rotation.y = p.yaw + Math.atan2(Math.sin(k.yaw - p.yaw), Math.cos(k.yaw - p.yaw)) * blend;
      car.rotation.x = k.air || k.on ? -Math.atan2(k.vy, Math.max(0.3, Math.hypot(k.vx, k.vz) * TUNE.pace)) : 0;
      n.pop = reduced ? 1 : Math.min(1, n.pop + dt / 0.3); car.scale.setScalar(SIZE * Math.max(0.01, n.pop));
      for (const f of n.parts.fronts) f.rotation.y = -k.steer * 0.45;
      for (const w of n.parts.wheels) w.rotation.x += k.fwd * TUNE.pace * dt / w.userData.r;
      n.flip = k.air?.trick && !reduced ? Math.min(1, n.flip + dt / 0.4) : 0; n.parts.body.rotation.z = n.flip * Math.PI * 2;
      n.parts.wing.visible = !!k.air?.glide;
      for (const f of n.parts.flames) f.visible = k.boost > 0;
    }
    // Collecting: the paperclips turn and bob, and the arrow points at the nearest one left (not from the driver's seat).
    const items = (race?.state === 'collect' || race?.state === 'got') && loose?.clipped?.userData.items;
    let target = null, nearest = Infinity;
    if (items) for (const [k, { node, clip }] of items.entries()) {
      node.rotation.y += dt * 2.2; node.position.y = clip.y + (reduced ? 0 : Math.sin(performance.now() / 400 + k) * 0.01);
      if (!race.taken.has(k)) { const d = Math.hypot(clip.x - shown.x, clip.z - shown.z); if (d < nearest) { nearest = d; target = node.position; } }
    }
    arrow.visible = !!target && race.state === 'collect' && view !== 'seat';
    if (arrow.visible) { arrow.position.set(shown.x, shown.y + 0.14, shown.z); arrow.lookAt(target); }
    const fast = Math.min(1, Math.hypot(c.vx, c.vz) / TUNE.top);
    dust.update(shown.x, shown.z, c.vx * TUNE.pace, c.vz * TUNE.pace, view === 'high' ? 0 : Math.min(1, THREE.MathUtils.smoothstep(fast, 0.5, 0.95) + (c.draft ? 0.35 : 0))); // none slow, all of them near flat out, more in a slipstream
    vignette.style.opacity = view === 'high' ? 0 : (fast ** 2 * 0.5 + (c.boost > 0 ? 0.25 : 0)).toFixed(3);
    time('race view', () => place(1 - Math.exp(-dt * VIEWS[view].follow), dt, reduced));
  }

  // The view: behind and over the car along a heading that trails the car's (so a drift shows it sideways), looking on ahead;
  // pulled in when something's between. Wider the faster, with a little roll into turns in the low view.
  const open = p => p.y < WALL_H - 0.08 && blocks().open(p);
  function place(k, dt = 0, reduced = false) {
    const v = VIEWS[view], speed = Math.hypot(c.vx, c.vz), fast = Math.min(1, speed / TUNE.top);
    // The view widens flat out, more on a boost.
    const fov = v.fov + (reduced ? 0 : fast ** 2 * v.kick + (c.boost > 0 ? v.kick / 2 : 0));
    if (v.seat) {
      car.updateMatrixWorld(true); cam.yaw = shown.yaw;
      body.localToWorld(want.fromArray(v.seat)); body.localToWorld(aim.set(v.seat[0], v.seat[1] + v.lift, v.seat[2] + v.ahead));
      if (k >= 1) { cam.from.copy(want); cam.look.copy(aim); } else { cam.from.lerp(want, k); cam.look.lerp(aim, k); }
      cam.fov = fov; cam.roll = reduced ? 0 : -lean.roll * 0.6;
      wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.015 * shake); shake = Math.max(0, shake - dt * 4);
      return;
    }
    let d = shown.yaw - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += k >= 1 ? d : d * (1 - Math.exp(-dt * v.turn));
    const bx = Math.sin(cam.yaw), bz = Math.cos(cam.yaw), far = v.back * (1 + v.stretch * fast);
    let back = 0.08; const spot = t => want.set(shown.x - bx * t, shown.y + v.up * (0.6 + 0.4 * t / far), shown.z - bz * t);
    while (back < far && open(spot(back + 0.02))) back += 0.02;
    // In at once when something's in the way, out again gently, so it doesn't twitch at the edge of something.
    camBack = k >= 1 || back < camBack ? back : camBack + (back - camBack) * (1 - Math.exp(-dt * 3));
    spot(camBack); aim.set(shown.x + bx * v.ahead, shown.y + v.lift, shown.z + bz * v.ahead);
    if (k >= 1) { cam.from.copy(want); cam.look.copy(aim); } else { cam.from.lerp(want, k); cam.look.lerp(aim, Math.min(1, k * 1.4)); }
    cam.fov = fov;
    cam.roll += ((reduced || view !== 'chase' ? 0 : c.spin * 0.035) - cam.roll) * Math.min(1, dt * 6);
    wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.025 * shake); shake = Math.max(0, shake - dt * 4);
  }

  canvas.addEventListener('pointerdown', event => {
    if (!active || picking || event.pointerType === 'mouse') return;
    if (race?.state === 'done') { go(); return; }
    if (race?.state === 'got') { collect(); return; }
    touch = true; startSound();
    const box = canvas.getBoundingClientRect(); touches.set(event.pointerId, event.clientX < box.left + box.width / 2 ? 'L' : 'R');
  });
  const lift = event => touches.delete(event.pointerId);
  canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
  return game;
}

// Friends' cars at a meeting: each player's as they drive it, played back by their clock (friends.js's track, as planes.js's
// createFlyers does planes), in their colour with their name over it, a ghost nothing hits. Built from their first word,
// dropped on 'off', SILENCE s after their last, or when either of you leaves. (The track carries the steering as roll and
// the wing as pose.)
export function createDrivers(scene, { clock = () => performance.now() / 1000 } = {}) {
  const cars = new Map(), ignored = () => {}; // id → { root, parts, sprite, track, at, colour, name, heard }
  let here = new Map();
  function build(p) {
    const root = new THREE.Group(), parts = buildCar({ colour: p.colour });
    parts.car.rotation.order = 'YXZ'; for (const m of [parts.lamps.pool, ...parts.lamps.beams]) m.visible = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag(p.name, p.colour), transparent: true, toneMapped: false, depthWrite: false }));
    sprite.renderOrder = 4; sprite.scale.set(0.3, 0.075, 1); root.add(parts.car, sprite); root.visible = false;
    root.traverse(o => { o.raycast = ignored; }); scene.add(root);
    return { root, parts, sprite, track: createTrack(), at: {}, colour: p.colour, name: p.name, heard: 0 };
  }
  function drop(id) {
    const n = cars.get(id); if (!n) return;
    disposeCar(n.parts); n.root.removeFromParent(); n.sprite.material.map.dispose(); n.sprite.material.dispose();
    cars.delete(id);
  }
  return {
    // `me` is your own id; `show` false (you're not at the meeting) shows none. A new name or colour builds it again.
    sync(roster, me, show = true) {
      here = new Map(show ? atMeeting(roster, me).map(p => [p.id, p]) : []);
      for (const [id, n] of cars) { const p = here.get(id); if (!p || p.colour !== n.colour || p.name !== n.name) drop(id); }
    },
    heard(id, m) {
      const p = here.get(id); if (!p) return;
      if (m.mode === 'off') { drop(id); return; }
      let n = cars.get(id); if (!n) cars.set(id, n = build(p));
      n.track.heard({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, roll: m.steer, pose: m.glide, t: m.t }, clock()); n.heard = clock();
    },
    has(id) { return cars.has(id); },
    update() {
      const now = clock();
      for (const [id, n] of cars) {
        if (now - n.heard > SILENCE) { drop(id); continue; }
        const a = n.track.at(now, n.at); if (!a) continue;
        n.root.visible = true; n.parts.car.position.set(a.x, a.y, a.z); n.parts.car.rotation.y = a.yaw;
        for (const f of n.parts.fronts) f.rotation.y = -a.roll * 0.45;
        n.parts.wing.visible = !!a.pose;
        n.sprite.position.set(a.x, a.y + 0.2, a.z);
      }
    },
    dispose() { for (const id of [...cars.keys()]) drop(id); here = new Map(); },
  };
}
