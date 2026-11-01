// Trickshot: throw a thing from its taped mark across the kitchen and into where it goes. Clicking an item walks you to its mark and
// puts it in your hand, from your own eyes: you can look but not walk, and the doors stay shut till you leave. A shot is worked out
// whole at release (shot.js) and played back here, in the room's own frame, so the room growing under it changes nothing. No document here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createArc, drawnAt, launch } from './throwing.js';
import { makeBody, stopShort } from './flight.js';
import { MOST_TIME, createRun } from './shot.js';
import { ITEMS, MONDAY, STARTS } from './levels.js';
import { KITCHEN, ZONES, levelWorld } from './kitchen-plan.js';
import { challenges, copyLine, dayKey, goalOf } from './daily.js';
import { loadProgress, recordDaily, recordLevel, saveProgress } from './progress.js';
import { EYE } from './player.js';
import { toonMaterial, withOutline } from './toon.js';
import { WALL_H } from './furniture.js';

const HAND_BACK = 1, PARTY = 1.2, BITS = 24, GROUND = 0.008; // seconds the camera stays on where a shot ended; of confetti; how many; the tape's height
const LIT = '#ffd21f', ARROW = 0.09, OVER = 0.2, LEAST = 0.08, HIGHEST = 1, BOB = 0.025, BOBS = 2.2, TAP_ASIDE = -0.13, MARKER_SIGHT = { radius: 0.01, low: 0.01 }; // the marker: its colour; how tall per metre from the mark, so it looks the same size from near and far; how far its tip stays over its target, as a rule and when there's no room; as high as it goes to be seen; how far it bobs either way, and how fast (radians a second); to the side of the sink's middle, where the tap's spout is
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const SHOT_FOV = 52, WIDEST_FOV = 80, LANDSCAPE = 1.6, IN_SIGHT = 0.6; // its fov, and how far that opens on a narrow screen; how far out it lets the item go, of the way to the edge of the screen's narrower side
// The camera on a shot: where it would like to be, [behind, above, to the side of] the item; how near it may be; how fast it and its look catch up (m/s at most, for it), and how fast "behind" comes round after a bounce (per second); how much room it keeps.
const VIEWS = [[1.5, 0.6, 0], [1.2, 1, 0], [0.6, 1.4, 0], [0.9, 0.9, 0.9], [0.9, 0.9, -0.9], [-0.9, 0.9, 0], [0, 1.4, 0.5], [0, 1.4, -0.5]], NEAREST = 0.7, CATCH = 5, FASTEST = 8, EYES = 10, COMES_ROUND = 2.5, CAMERA = { radius: 0.15, low: 0.15 }, CLEAR = 1e-3, WEDGED = 1, CLIMB = 3, CLIMBS = 0.4;
// As much across as a landscape screen shows, as far as a fov can go without looking stretched.
export const shotFov = aspect => Math.max(SHOT_FOV, Math.min(WIDEST_FOV, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(SHOT_FOV / 2)) * LANDSCAPE / aspect))));
// Whatever the look is lagging behind, the item is never more than `most` (radians) off it, seen from `at`: `look` is drawn in that far, not snapped.
export const keepInSight = (look, item, at, most) => {
  const to = sight.subVectors(item, at), from = sightFrom.subVectors(look, at), far = to.length();
  if (!far || !from.lengthSq() || from.angleTo(to) <= most) return look;
  return look.copy(to).applyAxisAngle(from.cross(to).normalize().negate(), most).add(at);
};
const sight = new THREE.Vector3(), sightFrom = new THREE.Vector3();
let world; const flightWorld = () => world ??= levelWorld(); // ponytail: read only, the same boxes shot.js flies through (it keeps its own copy)

// Each centred where flight.js has it, resting `low` over what it's on.
const SHAPES = {
  paper: () => [new THREE.IcosahedronGeometry(ITEMS.paper.radius, 1), '#f2efe6'],
  rubber: () => [new THREE.SphereGeometry(ITEMS.rubber.radius, 14, 10), '#d8402f'],
  roll: () => [new THREE.SphereGeometry(ITEMS.roll.radius, 12, 8).scale(1, ITEMS.roll.low / ITEMS.roll.radius, 1.4), '#c98a46'],
  mug: () => [mergeGeometries([new THREE.CylinderGeometry(0.06, 0.055, ITEMS.mug.low * 2, 16), new THREE.TorusGeometry(0.03, 0.009, 6, 12).translate(0.065, 0, 0)]), '#3f78b5'],
  plate: () => [new THREE.CylinderGeometry(ITEMS.plate.radius, 0.055, ITEMS.plate.low * 2, 20), '#f4efe6'],
  teabag: () => [mergeGeometries([new THREE.BoxGeometry(0.055, ITEMS.teabag.low * 2, 0.055), new THREE.BoxGeometry(0.018, 0.004, 0.05).translate(0, 0, 0.05)]), '#d9c7a0'],
};
const makeItem = key => { const [geometry, color] = SHAPES[key](); const mesh = withOutline(new THREE.Mesh(geometry, toonMaterial(color)), 0.006); mesh.raycast = () => {}; return mesh; };
// A cross of tape on each mark, flat, so a click goes through to the floor.
const marks = () => {
  const strip = (x, z, turn) => new THREE.PlaneGeometry(0.34, 0.05).rotateX(-Math.PI / 2).rotateY(turn).translate(x, GROUND, z), tape = new THREE.Mesh(mergeGeometries(Object.values(STARTS).flatMap(({ x, z, stand }) => [strip(x, z, stand + Math.PI / 4), strip(x, z, stand - Math.PI / 4)])), toonMaterial('#f2c230'));
  tape.raycast = () => {};
  return tape;
};

// What to throw at: an arrow lit from within, its tip at its own origin, one tall, for overTarget to size. Unlit, so full light and none look alike, the ink keeps it off a white wall; the halo's plain alpha, for added light would vanish on white.
const makeMarker = () => {
  const m = withOutline(new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.27, 0.45], [0.1, 0.45], [0.1, 1], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 12), new THREE.MeshBasicMaterial({ color: LIT, toneMapped: false })), 0.04);
  const fade = new Uint8Array(32 * 32 * 4).map((_, i) => { if (i % 4 < 3) return 255; const at = i >> 2; return 255 * Math.max(0, 1 - Math.hypot((at % 32) - 15.5, (at >> 5) - 15.5) / 15.5) ** 2; });
  const map = new THREE.DataTexture(fade, 32, 32); map.magFilter = map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: LIT, depthWrite: false, toneMapped: false })); halo.position.y = 0.5; halo.scale.setScalar(2.4);
  m.add(halo); m.visible = false; m.raycast = () => {}; m.traverse(n => { n.raycast = () => {}; });
  m.glow = amount => { m.material.color.set(LIT).multiplyScalar(0.8 + 0.2 * amount); halo.material.opacity = 0.35 + 0.4 * amount; }; // amount: 0 to 1
  return m;
};

// Synthesised, like the pinball's, and all through one bus so a reset cuts it off. ponytail: no mute here, as the pinball has none.
let audio, master, bus;
const hear = () => { try { if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.gain.value = 0.35; master.connect(audio.destination); } audio.resume(); } catch { /* no sound here */ } };
function tone(from, to, length, type = 'sine', gain = 0.3, delay = 0) {
  if (!audio) return;
  if (!bus) { bus = audio.createGain(); bus.connect(master); }
  const at = audio.currentTime + delay, o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(from, at); o.frequency.exponentialRampToValueAtTime(to, at + length);
  g.gain.setValueAtTime(Math.min(0.6, gain), at); g.gain.exponentialRampToValueAtTime(0.0005, at + length);
  o.connect(g).connect(bus); o.start(at); o.stop(at + length + 0.02);
}
const hush = () => { bus?.disconnect(); bus = null; };
// The office is going: browsers allow only so many contexts, and the next release makes a new one.
export const closeAudio = () => { audio?.close().catch(() => {}); audio = master = bus = null; };
const knock = (surface, speed) => {
  const loud = Math.min(1, speed / 8);
  if (surface.startsWith('pan-')) { tone(1046, 1020, 0.5, 'triangle', 0.3 * loud + 0.08); tone(1570, 1540, 0.3, 'sine', 0.12 * loud); }
  else if (surface === 'floor') tone(150, 70, 0.1, 'sine', 0.3 * loud + 0.05);
  else tone(320, 150, 0.07, 'triangle', 0.22 * loud + 0.05);
};

// `aim()` is where a throw would go right now: { direction, charge }. `score(goal, verdict, copy)` shows what the shot asks and how it went (goalOf's list and a line or null), or a null goal clears it; `copy`: it's after a daily shot, so game.copy() has something to say. `share(line)` copies a line.
export function createTrickshot({ kitchen, hand, props, view, onPlay, aim, score, share, store, reducedMotion = () => false, clock = null }) {
  const progress = loadProgress(store), items = {}, holders = {}, hits = {}, rested = {};
  const marker = makeMarker(), arc = createArc(), axis = new THREE.Vector3(), pose = { from: new THREE.Vector3(), look: new THREE.Vector3(), fov: SHOT_FOV, hands: false };
  const follow = { at: new THREE.Vector3(), look: new THREE.Vector3(), ahead: new THREE.Vector3(), spot: new THREE.Vector3(), step: new THREE.Vector3(), from: new THREE.Vector3() };
  const eye = new THREE.Vector3(), now = new THREE.Vector3(), flying = new THREE.Vector3(), palm = new THREE.Vector3(), fromHand = new THREE.Vector3(); // `flying`: where it really is, the mesh only drawn from the hand
  let group = null, pending = null, entry = null, kind = null, mesh = null, angle = 0, moved = false, handBack = 0, partyLeft = 0, climb = 0, bob = 0, told = false; // told: this shot's verdict is out

  const bits = Array.from({ length: BITS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })), spots = new Float32Array(BITS * 3), colours = new Float32Array(BITS * 3);
  { const paper = ['#ffd166', '#ef476f', '#06d6a0', '#4f7cff'].map(c => new THREE.Color(c)); for (let i = 0; i < BITS; i++) paper[i % 4].toArray(colours, i * 3); }
  const partyShape = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(spots, 3).setUsage(THREE.DynamicDrawUsage)).setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const party = new THREE.Points(partyShape, new THREE.PointsMaterial({ size: 0.04, vertexColors: true })); party.visible = false; party.frustumCulled = false; party.raycast = () => {};

  // Where an item is when you're not playing it. Its Monday place: on the floor just ahead of its mark, two on one mark apart.
  const homeOf = id => {
    const { item, start } = MONDAY.find(e => e.id === id), { x, z, stand } = STARTS[start], sharing = MONDAY.filter(e => e.start === start), side = sharing.length > 1 ? (sharing[0].id === id ? -0.2 : 0.2) : 0;
    return [x + Math.sin(stand) * 0.35 + Math.cos(stand) * side, ITEMS[item].low, z + Math.cos(stand) * 0.35 - Math.sin(stand) * side];
  };
  // Put away on an earlier visit: somewhere on the floor of its target, its exact rest not being kept.
  const awayOf = (id, i) => {
    const { item, target } = MONDAY.find(e => e.id === id), { centre, half } = ZONES[target], a = i * Math.PI / 3, r = Math.min(half.x, half.z) * 0.4;
    return [centre.x + Math.cos(a) * r, centre.y - half.y + ITEMS[item].low, centre.z + Math.sin(a) * r];
  };
  const away = id => !ZONES[MONDAY.find(e => e.id === id).target].surface && !!(rested[id] || progress.lines[id]?.away); // what's only to hit stays where it's picked up
  const putBack = id => {
    const item = items[id], at = rested[id] ?? (away(id) ? awayOf(id, MONDAY.findIndex(e => e.id === id)) : homeOf(id));
    holders[id].add(item); item.position.fromArray(at); if (!rested[id]) item.rotation.set(0, 0, 0);
    // Clicked over a bin's rim, if that's where it is.
    hits[id].position.set(at[0], at[1] - ITEMS[MONDAY.find(e => e.id === id).item].low, at[2]); hits[id].scale.set(0.3, away(id) ? 0.75 : 0.35, 0.3);
  };

  const label = () => score?.(entry ? goalOf(entry, progress) : null, game.score, !!game.score && !!entry?.day);
  // Your eyes, in the room's frame: on the mark, where a shot's camera move has no say.
  const eyeNow = () => { const { x, z } = STARTS[entry.start]; return eye.set(x, EYE, z); };
  const palmNow = () => { const { x, z } = kitchen.origin; hand.palm.getWorldPosition(palm); palm.x -= x; palm.z -= z; return palm; };
  const inHand = () => { mesh.rotation.set(0, 0, 0); hand.hold(mesh, kind.radius, kind.low); };
  // The marker: over the target, under what's over that (a sink's cupboards), and higher if that's what it takes to see its tip from the mark (the bin's behind the orange from the stove).
  const overTarget = () => {
    const { centre, half } = ZONES[entry.target], top = centre.y + half.y, x = centre.x + (entry.target === 'sink' ? TAP_ASIDE : 0), { colliders } = flightWorld(); bob = 0; eyeNow();
    const far = ARROW * Math.hypot(eye.x - centre.x, eye.z - centre.z), under = top + OVER + far > WALL_H - BOB; marker.rotation.x = under ? Math.PI : 0; marker.glow(1); // hung under the ceiling (the banner), it points up from below: the ceiling isn't a collider, and there's no room for it above
    if (under) { marker.scale.setScalar(far); marker.position.set(x, centre.y - half.y - OVER, centre.z); return; }
    const room = stopShort(flying.set(x, top, centre.z), now.set(x, top + WALL_H, centre.z), MARKER_SIGHT, colliders).y - top - BOB;
    const size = Math.min(far, room - LEAST);
    marker.scale.setScalar(size);
    for (let over = Math.min(OVER, room - size); over <= HIGHEST; over += 0.1) { marker.position.set(x, top + over, centre.z); if (stopShort(eye, now.copy(marker.position), MARKER_SIGHT, colliders).equals(marker.position)) return; }
  };
  // Everything a shot set going stops: its sound, the pans, the confetti, and the camera comes straight back, so a throw leaves from your eyes.
  const stop = () => { hush(); kitchen.pans?.rest(); party.visible = false; partyLeft = 0; handBack = 0; moved = false; angle = 0; climb = 0; view?.play(null); if (view) view.gameAmount = 0; };

  // From the eyes on, it goes only through free space: it's walked to where it wants to be, one axis at a time so it slides along what's in the
  // way. So it can't be in anything, whatever the bounce.
  const followNow = dt => {
    const { at, look, ahead, spot, step, from } = follow, { colliders } = flightWorld();
    spot.subVectors(flying, now).setY(0);
    if (spot.lengthSq() > 1e-8) { spot.normalize(); ahead.lerp(spot, 1 - Math.exp(-dt * COMES_ROUND)); if (ahead.lengthSq() < 1e-4) ahead.copy(spot); else ahead.normalize(); }
    from.copy(flying); from.y += 0.05;
    // The first view with nothing between it and the item, or the best there is. A straight line out from the item, so what it's clear of it can see past.
    let most = -1;
    for (const [back, rise, side] of VIEWS) {
      step.set(flying.x - ahead.x * back + ahead.z * side, Math.min(flying.y + rise, WALL_H - CAMERA.radius), flying.z - ahead.z * back - ahead.x * side);
      step.x = THREE.MathUtils.clamp(step.x, CAMERA.radius - KITCHEN.width, -CAMERA.radius); step.z = THREE.MathUtils.clamp(step.z, KITCHEN.back + CAMERA.radius, KITCHEN.front - CAMERA.radius);
      const whole = from.distanceToSquared(step), got = from.distanceToSquared(stopShort(from, step, CAMERA, colliders));
      if (got > most) { most = got; spot.copy(step); }
      if (got > 0.99 * whole && got > NEAREST * NEAREST) { spot.copy(step); break; }
    }
    spot.sub(at).multiplyScalar(1 - Math.exp(-dt * CATCH)).clampLength(0, FASTEST * dt).add(at); // coming free of what held it back, it doesn't leap
    // One axis at a time it can wedge where two things meet (a cupboard's top and the banner): with nowhere to go it climbs a moment, and comes on over.
    const wanted = at.distanceToSquared(spot); from.copy(at);
    if (climb > 0) { climb -= dt; spot.y = Math.min(at.y + CLIMB * dt, WALL_H - CAMERA.radius); }
    for (const axis of ['x', 'z', 'y']) { // never right up to what it hit: stopShort doesn't count a box it starts in
      step.copy(at); step[axis] = spot[axis]; stopShort(at, step, CAMERA, colliders);
      const go = step[axis] - at[axis];
      if (step[axis] === spot[axis]) at[axis] = spot[axis]; else if (Math.abs(go) > CLEAR) at[axis] += go - Math.sign(go) * CLEAR;
    }
    if (wanted > WEDGED * WEDGED * dt * dt && at.distanceToSquared(from) < CLEAR * CLEAR) climb = CLIMBS;
    look.lerp(flying, 1 - Math.exp(-dt * EYES));
    const seen = view?.camera, fov = Math.min(seen?.fov ?? SHOT_FOV, pose.fov = shotFov(seen?.aspect ?? LANDSCAPE));
    keepInSight(look, flying, at, Math.atan(IN_SIGHT * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.min(1, seen?.aspect ?? LANDSCAPE)));
  };
  // The wait's over: the camera comes back, under reduced motion it never left, and the item's in your hand again. The verdict stays up till you throw.
  const handBackNow = () => {
    handBack = 0;
    if (moved) { moved = false; view?.play(null); if (view && stopShort(follow.at, now.copy(eyeNow()), CAMERA, flightWorld().colliders).distanceToSquared(eye) > 1e-6) view.gameAmount = 0; } // no easing back through the fridge
    game.run.reset(); inHand();
  };

  const celebrate = at => {
    if (reducedMotion()) return;
    tone(523, 527, 0.14, 'square', 0.14); tone(659, 664, 0.14, 'square', 0.14, 0.08); tone(784, 790, 0.14, 'square', 0.14, 0.16); tone(1047, 1054, 0.3, 'square', 0.16, 0.24);
    partyLeft = PARTY; party.visible = true;
    for (const b of bits) { b.x = at[0]; b.y = at[1]; b.z = at[2]; const a = Math.random() * 7; b.vx = Math.cos(a) * (0.3 + Math.random()); b.vy = 1.5 + Math.random() * 1.6; b.vz = Math.sin(a) * (0.3 + Math.random()); }
  };
  const blowUp = dt => {
    if (!partyLeft) return;
    partyLeft = Math.max(0, partyLeft - dt); party.visible = partyLeft > 0;
    bits.forEach((b, i) => { b.vy -= 5 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; spots[i * 3] = b.x; spots[i * 3 + 1] = b.y; spots[i * 3 + 2] = b.z; });
    partyShape.attributes.position.needsUpdate = true;
  };

  // Saved once a shot, at its end; its result's known from the release, so going again doesn't lose a made one.
  const record = r => {
    if (entry.day) { recordDaily(progress, entry.day, entry.index, r); saveProgress(progress, store); game.saved++; }
    else if (entry.id) { recordLevel(progress, entry.id, r); saveProgress(progress, store); game.saved++; if (r.made && !r.hit) rested[entry.id] = r.pos; }
  };
  // Still in the air, it's made already: whatever cuts the flight off keeps it. What it says, for a verdict.
  const keepMade = () => { const r = game.run.state === 'flying' && game.run.result.made ? game.run.result : null; if (r && !told) record(r); return r; };
  const says = r => r.made ? `${r.points} × ${r.multiplier} = ${r.score}` : 'Miss';
  const verdict = r => {
    told = true; record(r); game.score = says(r); label();
    if (r.made) celebrate(r.hit?.pos ?? r.pos); else tone(190, 110, 0.28, 'sawtooth', 0.1);
  };
  // The moment it really stops. Out of time and still up on something, or wedged, or a long miss cut off mid-air, or still bouncing off what it hit: not left hanging there.
  const stopped = r => {
    if (game.run.time < r.time || !r.rest && (r.hit || r.time >= MOST_TIME - 1e-6 && r.pos[1] > kind.low + 0.02)) handBackNow();
    else handBack = HAND_BACK;
  };

  const game = {
    free: true, progress, arc, party, marker, score: null, run: null, saved: 0, // `saved`: how many times progress has changed, for the boards
    item: id => items[id],
    get holding() { return !!entry && game.run.state === 'aiming'; },
    get retrying() { return !!entry && game.run.retrying; }, // a click, or the throw button, is another go
    get heldKind() { return kind; },
    // A shot's camera has the view, from the throw until it's handed back: your own aim waits, so you come back to the one you threw with.
    get following() { return moved; },
    // A Monday level by its id, or today's daily ('daily-0' to 'daily-2').
    entry(id) {
      const daily = /^daily-(\d)$/.exec(id);
      if (!daily) return MONDAY.find(e => e.id === id);
      const day = dayKey(new Date()), index = +daily[1];
      return { ...challenges(day)[index], day, index };
    },
    start(next) { pending = next; onPlay(game); },
    // Today's line (or the day this shot's for, should it have turned since), with your best per challenge.
    copy() { const day = entry?.day ?? dayKey(new Date()); share?.(copyLine(day, progress.daily[day] ?? [])); },
    // Its mark, facing the target: a phone's view is narrow, and the arrow's no use out of it.
    stand() { const { start, target } = pending ?? entry ?? MONDAY[0], { x, z } = STARTS[start], { centre } = ZONES[target]; return { x: kitchen.origin.x + x, z: kitchen.origin.z + z, yaw: Math.atan2(centre.x - x, centre.z - z) }; },
    build(room) {
      group = room;
      room.add(marks(), arc.mesh, party, marker);
      for (const { id, item } of MONDAY) {
        const holder = holders[id] = new THREE.Group();
        holder.userData.toggle = () => game.start(game.entry(id)); holder.userData.dropsHeld = true; // it's a level to start, not somewhere to throw what you've got
        const hit = hits[id] = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ visible: false }));
        items[id] = makeItem(item); holder.add(hit); room.add(holder); putBack(id);
      }
    },
    enter() {
      if (props.holding) props.throw(null, true);
      kitchen.shut(true);
      entry = pending ?? MONDAY[0]; pending = null; kind = ITEMS[entry.item]; mesh = items[entry.id] ?? items[MONDAY.find(e => e.item === entry.item).id];
      const { x, z } = STARTS[entry.start];
      game.run = createRun({ start: [x, EYE, z], reducedMotion: reducedMotion(), now: clock }); game.score = null;
      inHand(); label();
      overTarget();
    },
    leave() {
      if (!entry) return;
      keepMade(); stop(); hand.free(); arc.hide(); kitchen.shut(false); marker.visible = false;
      const id = MONDAY.find(e => e.id === entry.id)?.id ?? MONDAY.find(e => e.item === entry.item).id;
      entry = kind = mesh = null; game.score = null; label();
      putBack(id);
    },
    release(charge, direction) {
      if (!game.holding) return;
      hear(); eyeNow();
      const { pos, vel } = launch(kind, charge, { position: eye }, direction, ZERO);
      stopShort(eye, pos, kind, flightWorld().colliders);
      fromHand.subVectors(palmNow(), pos); flying.copy(pos); // before the hand lets go, with the charge's pull still in it
      hand.free(); mesh.removeFromParent(); group.add(mesh); drawnAt(mesh.position, pos, fromHand, 0, kind, flightWorld().colliders); arc.hide();
      axis.crossVectors(direction, UP).normalize(); if (!axis.lengthSq()) axis.set(1, 0, 0);
      game.score = null; told = false; label();
      game.run.shoot(makeBody(kind, pos, vel), ZONES[entry.target]);
      if (!reducedMotion()) { moved = true; follow.at.copy(eye); follow.look.copy(mesh.position); follow.ahead.set(direction.x, 0, direction.z); if (follow.ahead.lengthSq() < 1e-6) follow.ahead.set(Math.sin(STARTS[entry.start].stand), 0, Math.cos(STARTS[entry.start].stand)); follow.ahead.normalize(); view?.play(() => game.pose()); }
      tone(280, 640, 0.13, 'sine', 0.08 + 0.1 * charge);
    },
    abort() { hand.pull(0); },
    reset() {
      if (!entry) return;
      const r = keepMade();
      stop(); game.run.reset(); game.score = r?.made ? says(r) : null; inHand(); label();
    },
    click() { if (game.retrying) game.reset(); },
    key(code, down) {
      if (!entry || !down) return false;
      if (code === 'KeyR') { game.reset(); return true; }
      if (code === 'KeyC' && entry.day && game.score) { game.copy(); return true; }
      return false;
    },
    pose() {
      const { x, z } = kitchen.origin;
      pose.from.set(follow.at.x + x, follow.at.y, follow.at.z + z); pose.look.set(follow.look.x + x, follow.look.y, follow.look.z + z);
      return pose;
    },
    update(dt, at, still, shown) {
      blowUp(dt);
      if (!entry) return;
      marker.visible = !moved;
      if (!moved && !reducedMotion()) { const was = Math.sin(bob); bob += dt * BOBS; marker.position.y += (Math.sin(bob) - was) * BOB; marker.glow((Math.sin(bob) + 1) / 2); }
      const { run } = game;
      if (run.state === 'aiming') {
        const a = shown && aim?.();
        if (a) arc.show(kind, launch(kind, a.charge, { position: eyeNow() }, a.direction, ZERO), flightWorld(), eye, palmNow());
        return;
      }
      if (run.state === 'done') {
        if (moved) { now.copy(flying); followNow(dt); }
        if (handBack && (handBack -= dt) <= 0) handBackNow();
        return;
      }
      for (const event of run.advance(dt)) {
        if (event.type === 'made') { verdict(event.result); continue; } // a hit's made at the touch, and plays on
        if (event.type === 'end') { if (!told) verdict(event.result); stopped(event.result); continue; }
        knock(event.surface, event.speed);
        if (event.surface.startsWith('pan-') && !reducedMotion()) kitchen.pans?.hit(+event.surface.slice(4), event.speed);
      }
      if (run.state === 'aiming') return; // it went back in your hand
      now.copy(flying); run.at(flying);
      // A ball rolls by what it covers (with a top speed in the air); what lands the right way up comes back round to it.
      if (kind.upright) mesh.quaternion.setFromAxisAngle(axis, kind.tumble * Math.min(run.time, run.result.time - run.time));
      else { angle += Math.min(kind.tumble * dt, now.distanceTo(flying) / kind.radius); mesh.quaternion.setFromAxisAngle(axis, angle); }
      if (run.state === 'done') mesh.position.copy(flying); else drawnAt(mesh.position, flying, fromHand, run.time, kind, flightWorld().colliders);
      if (moved) followNow(dt);
    },
  };
  return game;
}
