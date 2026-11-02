// The crew: one seated figure at each occupied station, hard-surface and faceless, carrying the same signal as the display above it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CREW_Z, DECK } from './deck.js';
import { SIGNALS } from './palettes.js';
import { C, STD, add, lit, plate, seeded } from './parts.js';

// The armour plates' tones: muted, clear of the signal hues and too dull to bloom. A head and a suit together tell an agent from its neighbours.
export const SUITS = ['#7a4f73', '#50508c', '#3d5a4c', '#5e6472', '#2f6461'];
export const HEADS = ['dome', 'crest', 'tall', 'ring'], MARKS = ['bar', 'chevron', 'dots'];
// An agent always gets the look its id hashes to, unless someone seated already has it. Heads and suits come in different counts, so
// stepping one along each reaches every pair, and the next look along differs in both.
export function crewLook(id, taken) {
  const rnd = seeded(String(id)), pairs = HEADS.length * SUITS.length, start = Math.floor(rnd() * pairs), mark = Math.floor(rnd() * MARKS.length);
  const at = i => { const head = i % HEADS.length, suit = i % SUITS.length; return { head, suit, mark, key: `${head}-${suit}` }; };
  for (let i = 0; i < pairs; i++) { const look = at(start + i); if (!taken.has(look.key)) return look; }
  return at(start);
}
const POSES = {
  need: { turn: Math.PI, lean: 0, raise: 1, hands: false, track: false },
  working: { turn: 0, lean: .08, raise: 0, hands: true, track: true },
  idle: { turn: 0, lean: -.2, raise: 0, hands: false, track: false },
};
export const crewPose = signal => POSES[signal] || POSES.idle;
// How a seat changes hands. Only a session really coming or going shimmers: not the page loading, not a lost or returning connection.
export function crewArrival({ was, id, offline, wasOffline, started, still }) {
  if (was === id) return 'none';
  return !started || offline || wasOffline || still ? 'cut' : 'shimmer';
}

// All the shapes, shared by the whole crew. Heights are above the deck, and a figure faces the console, along -z, with its back to the room.
const SHOULDER = .68, NECK = .72, FADE = .5;
// A plate from one point to another, for limbs.
const up = new THREE.Vector3(0, 1, 0), spin = new THREE.Quaternion(), turned = new THREE.Matrix4();
function limb(a, b, width, depth = width) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), along = to.clone().sub(from), length = along.length();
  turned.makeRotationFromQuaternion(spin.setFromUnitVectors(up, along.normalize())).setPosition(from.add(to).multiplyScalar(.5));
  return plate(width, length, depth).applyMatrix4(turned);
}
const round = (geometry, x = 0, y = 0, z = 0) => geometry.toNonIndexed().translate(x, y, z);
const merged = parts => { for (const part of parts) part.deleteAttribute('uv'); return mergeGeometries(parts); };
const taper = (bottom, top, height, sides = 8, y = height / 2) => round(new THREE.CylinderGeometry(top, bottom, height, sides), 0, y);
// The hips to the neck, wider at the shoulders, with a plate on each.
const torsoShape = () => {
  const shape = new THREE.Shape(); shape.moveTo(-.095, 0); shape.lineTo(.095, 0); shape.lineTo(.145, .29); shape.lineTo(.05, .4); shape.lineTo(-.05, .4); shape.lineTo(-.145, .29); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: .13, bevelThickness: .015, bevelSize: .012, bevelSegments: 1 }).translate(0, 0, -.065);
};
const shoulder = s => plate(.11, .045, .16).rotateZ(s * -.35).translate(s * .155, .335, 0);
const arm = () => merged([limb([0, 0, 0], [0, -.22, -.08], .055), limb([0, -.22, -.08], [0, -.29, -.34], .05), plate(.06, .025, .09, 0, -.3, -.39)]);
const dotted = () => merged([-1, 0, 1].map(i => plate(.04, .04, .012, i * .06)));
const chevron = () => merged([-1, 1].map(s => plate(.1, .03, .012, s * .04).rotateZ(s * .6)));
const ringPiece = () => merged([round(new THREE.TorusGeometry(.13, .014, 6, 18).rotateX(Math.PI / 2 + .35), 0, .17), taper(.08, .07, .03, 8, .17), plate(.018, .09, .018, -.09, .12, .02, .004), plate(.018, .09, .018, .09, .12, .02, .004)]);
const crestPiece = () => {
  const shape = new THREE.Shape(); shape.moveTo(-.12, 0); shape.lineTo(.16, 0); shape.lineTo(.14, .1); shape.lineTo(.03, .2); shape.lineTo(-.06, .14); shape.closePath();
  return merged([new THREE.ExtrudeGeometry(shape, { depth: .04, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-.02, .12, 0), taper(.09, .07, .05, 8, .14)]);
};
const shapes = () => ({
  seat: merged([plate(.36, .05, .34, 0, .275, 0), plate(.3, .14, .05, 0, .37, .16), taper(.05, .035, .25), taper(.2, .17, .03, 10, .015)]),
  legs: merged([-1, 1].flatMap(s => [limb([s * .08, .34, -.02], [s * .08, .35, -.28], .085), limb([s * .08, .35, -.28], [s * .08, .03, -.32], .065), plate(.075, .045, .15, s * .08, .025, -.36)])),
  torso: merged([torsoShape(), shoulder(-1), shoulder(1), taper(.05, .05, .05, 8, .405)]),
  arm: arm(), head: taper(.088, .082, .17), visor: new THREE.CylinderGeometry(.09, .09, .04, 12, 1, true, Math.PI - 1.9, 3.8), spine: plate(.045, .17, .012, 0, 0, 0, .003), chest: plate(.14, .025, .012, 0, 0, 0, .003),
  heads: [
    merged([round(new THREE.SphereGeometry(.095, 12, 5, 0, 7, 0, Math.PI / 2), 0, .11)]),
    crestPiece(),
    taper(.08, .04, .24, 8, .08 + .12),
    ringPiece(),
  ],
  marks: [merged([plate(.17, .035, .012)]), chevron(), dotted()],
  shimmer: new THREE.CylinderGeometry(.34, .34, 1.5, 14, 1, true),
});
let shared = null;

// `station.group` holds the figure. `root` is what shows or hides it, and `body` the figure itself, without its shimmer.
export function createCrew(station, { still = false } = {}) {
  shared ||= shapes();
  const suit = STD(SUITS[0], .55, .2), under = STD('#262833', .5, .3), seat = STD('#3a3d46', .8, .05), mark = STD('#b4bac8', .6, .1), signal = lit('#000');
  const root = new THREE.Group(); root.position.set(0, DECK, CREW_Z); root.visible = false; station.group.add(root);
  const body = new THREE.Group(); root.add(body);
  add(shared.seat, seat, body); add(shared.legs, under, body);
  const hips = new THREE.Group(); hips.position.y = .32; body.add(hips);
  const torso = add(shared.torso, suit, hips);
  const head = add(shared.head, suit, hips, 0, NECK - .32 + .03);
  const headTop = add(shared.heads[0], suit, head); headTop.name = 'headTop';
  add(shared.visor, signal, head, 0, .1);
  add(shared.spine, signal, torso, 0, .14, .085); add(shared.chest, signal, torso, 0, .27, -.085);
  const badge = add(shared.marks[0], mark, torso, 0, .29, .085);
  const armAt = s => add(shared.arm, under, hips, s * .185, SHOULDER - .32, 0, 0, s * .24), leftArm = armAt(-1), hand = armAt(1); hand.name = 'hand';
  // A column of light, for coming and going; aiming passes through it.
  const shimmer = add(shared.shimmer, new THREE.MeshBasicMaterial({ color: C('#a8d8ff'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), root, 0, .75);
  shimmer.raycast = () => {}; shimmer.visible = false;
  const fading = [suit, under, seat, mark, signal];

  let tone = C(SIGNALS.idle), kind = 'idle', marked = null, on = false, fade = 0, phase = 0, shimmering = false, blends = 0;
  const now = { turn: 0, lean: 0, raise: 0, hands: 0, track: 0 };
  const see = () => { root.visible = fade > 0; for (const material of fading) { const clear = fade < 1; if (material.transparent !== clear) { material.transparent = clear; material.needsUpdate = true; } material.opacity = fade; } };
  return {
    root, body, shimmer,
    setLook({ head: h, suit: s, mark: m, key }) {
      headTop.geometry = shared.heads[h]; badge.geometry = shared.marks[m]; suit.color.copy(C(SUITS[s]));
      phase = [...String(key)].reduce((sum, c) => sum + c.charCodeAt(0), 0) * 1.7;
    },
    setSignal(next) { kind = next && SIGNALS[next] ? next : 'idle'; tone = C(SIGNALS[kind]); },
    setMarked(next) { marked = next; },
    // A shimmer while on and staying on means someone new has taken the seat.
    present(next, how) {
      if (next === on && how !== 'shimmer') return;
      if (next === on && !next) return;
      if (how === 'shimmer' && !still) { if (next === on) fade = 0; on = next; shimmering = true; blends = 0; see(); return; }
      on = next; shimmering = false; fade = +next; shimmer.visible = false; see();
    },
    paint(palette) { seat.color.copy(C(palette.chair)); },
    tick(dt, t) {
      const pose = crewPose(kind), k = still ? 1 : 1 - Math.exp(-dt * 6);
      now.turn += (pose.turn - now.turn) * k; now.lean += (pose.lean - now.lean) * k; now.raise += (pose.raise - now.raise) * k;
      now.hands += (+pose.hands - now.hands) * k; now.track += (+pose.track - now.track) * k;
      const time = still ? 0 : t + phase, rest = -.35 * (1 - now.hands), typing = now.hands * Math.sin(time * 7) * .035;
      body.rotation.y = now.turn; hips.rotation.x = -now.lean;
      leftArm.rotation.x = rest + typing; hand.rotation.x = rest * (1 - now.raise) + 1.05 * now.raise - typing; hand.rotation.y = .24 - .7 * now.raise; hand.rotation.z = -.3 * now.raise;
      head.rotation.y = now.track * Math.sin(time * .5) * .3; head.rotation.x = now.track * .22 + -hips.rotation.x * .5;
      const pulse = still ? 1 : .5 + .5 * Math.sin(t * 3.4), level = kind === 'need' ? Math.min(1, .3 + pulse * 1.2) : kind === 'working' ? 1 : .45;
      signal.color.copy(tone).multiplyScalar(level * (marked === false ? .25 : 1));
      if (!shimmering) return;
      fade = THREE.MathUtils.clamp(fade + (on ? dt : -dt) / FADE, 0, 1); blends += dt / FADE; see();
      shimmer.visible = root.visible; shimmer.material.color.copy(tone); shimmer.material.opacity = Math.sin(Math.PI * Math.min(1, blends)) * .5;
      if (blends >= 1) { shimmering = false; shimmer.visible = false; fade = +on; see(); }
    },
  };
}
