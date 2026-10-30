// Poses for each status and the cast of characters at their desks.
// A pose is plain numbers in the character's seat frame (facing +z), so two poses can be blended.
import * as THREE from 'three';
import { createFruit, LEG } from './fruit.js';
import { identity } from './status.js';
import { SEAT_H, DESK_H, CHAIR_Z, KEYS_Z, MOUSE_X, BACK_Z, HELPER_SCALE } from './room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BLEND = 6;        // per second; about half a second to settle
const SETTLED = 0.7;    // seconds after a pose change, after which the pose is followed exactly (blending would damp fast typing)
// The sitter's root sits a little forward of the chair; standing, they step out behind it.
const SEAT_FORWARD = 0.06, STAND_BACK = -0.8, STANDING = new Set(['waving', 'raising', 'impatient']);
const KEYS = KEYS_Z - CHAIR_Z - SEAT_FORWARD; // the keyboard, from the sitter's root (the mouse's x is the same from either)
const LOOK_RANGE = 4, WALK_SPEED = 2, GOODBYE = 1.2, STARTLED = 2.5, FINISHED = 2.5, WORKING = new Set(['typing', 'thinking', 'squeezing']);
// Waiting on you gets louder: a raised hand, then after a couple of minutes both arms waving, after ten a tapping foot.
const WAVE_AFTER = 2 * 60_000, TAP_AFTER = 10 * 60_000;
// Neighbours within NEAR metres react: a thumbs up for a finish, and every GLANCE_EVERY seconds a GLANCE_FOR look at a red desk.
const NEAR = 6, GLANCE_EVERY = 7, GLANCE_FOR = 1.6;
export const waitingPose = (since, now = Date.now()) => now - since >= TAP_AFTER ? 'impatient' : now - since >= WAVE_AFTER ? 'waving' : 'raising';

// t is seconds (frozen at 0 with reduced motion), seed spreads characters out of step, fruit gives the body's height and shape,
// wear (0..1) slows typing down and slumps a sleeper further, habit picks the character's own way of doing it (status.js).
// Facing +z, the left side is +x.
export function poseTargets(pose, t, seed, fruit, wear = 0, habit = '') {
  const s = Math.sin, wave = k => s(t * k + seed), clamp = THREE.MathUtils.clamp, h = fruit.height;
  const seated = (lean, bob = 0) => ({ x: 0, z: SEAT_FORWARD, turn: 0, body: { y: SEAT_H + bob, tilt: 0, lean } });
  const standing = (bounce, tilt = 0) => ({ x: 0, z: STAND_BACK, turn: 0, body: { y: LEG + bounce, tilt, lean: 0 } });
  const feetUnder = { leftFoot: V(0.12, 0.03, 0.32), rightFoot: V(-0.12, 0.03, 0.32) };
  const feetStand = { leftFoot: V(0.11, 0.03, 0), rightFoot: V(-0.11, 0.03, 0) };
  switch (pose) {
    // Quick taps, the hands out of step and wandering over the keys; every so often a pause to read, the right hand on the mouse.
    // Just caught slacking off ('busted'): sitting up straight and typing flat out, no pauses.
    // Hunt and peck: hunched in, one finger lifted high and hopping from key to key, the other hand idle at the desk's edge.
    case 'busted': case 'typing': {
      if (pose === 'typing' && habit === 'peck') {
        const u = (t * 7 * (1 - wear * 0.4) + seed) / Math.PI, hop = Math.floor(u), f = u - hop, key = n => V(s(n * 12.99) * 0.1 - 0.04, 0, KEYS + s(n * 7.1) * 0.03);
        const finger = key(hop).lerp(key(hop + 1), f * f * (3 - 2 * f)).setY(DESK_H + 0.035 + s(f * Math.PI) * 0.08), base = seated(0.2);
        base.body.tilt = (finger.x + 0.04) * 0.3;
        return { ...base, limbs: { leftHand: V(0.22, DESK_H + 0.03, KEYS - 0.12), rightHand: finger, ...feetUnder } };
      }
      const eager = pose === 'busted', reading = eager ? 0 : clamp((wave(0.45) + s(t * 0.17 + seed * 2) * 0.7 - 0.85) * 3, 0, 1), typing = 1 - reading, rate = eager ? 30 : 22 * (1 - wear * 0.4);
      const tap = phase => DESK_H + 0.035 + Math.abs(s(t * rate + seed + phase)) * 0.03 * typing;
      const body = seated(eager ? 0.16 : 0.1 * typing - 0.03 * reading, Math.abs(wave(rate / 2)) * 0.005 * typing + (eager ? 0.02 : 0));
      body.body.tilt = eager ? 0 : wave(0.7) * 0.025;
      return { ...body, limbs: {
        leftHand: V(0.12 + wave(1.3) * 0.04 + reading * 0.06, tap(0), KEYS + wave(0.9) * 0.02 - reading * 0.04),
        rightHand: V(-0.12 + s(t * 1.1 + seed + 2) * 0.04 + reading * (MOUSE_X + 0.12), tap(1.3) + reading * 0.01, KEYS + s(t * 0.8 + seed + 1) * 0.02),
        ...feetUnder } };
    }
    // Leaning back, hand at the chin, the other on the desk, tapping a finger; or scratching the head;
    // or leaning right back, hands behind the head, staring at the ceiling.
    case 'thinking': {
      const desk = V(0.24, DESK_H + 0.03, KEYS - 0.08), crown = fruit.surface(h * 0.82);
      if (habit === 'scratch') return { ...seated(0.02, wave(1.2) * 0.006), elbows: 0.3, limbs: {
        leftHand: desk, rightHand: V(crown.x - crown.r - 0.03, SEAT_H + h * 0.8 + wave(14) * 0.02, 0.06 + wave(9) * 0.015), ...feetUnder } };
      if (habit === 'ceiling') return { ...seated(-0.2, wave(0.8) * 0.004), elbows: 0.4, glance: V(0.2, SEAT_H + h + 2, 0.8), limbs: {
        leftHand: V(crown.x + crown.r * 0.5, SEAT_H + h * 0.78, -crown.r - 0.1), rightHand: V(crown.x - crown.r * 0.5, SEAT_H + h * 0.78, -crown.r - 0.1), ...feetUnder } };
      return { ...seated(-0.1, wave(1.2) * 0.006), limbs: {
        leftHand: desk, rightHand: V(-0.09, SEAT_H + h * 0.46 + Math.max(0, wave(3)) * 0.012, 0.33), ...feetUnder } };
    }
    // Compacting: hunched forward hugging itself, eyes screwed shut (fruit.js), shivering hard enough to see across the room.
    case 'squeezing': {
      const shiver = wave(31) * 0.06 + s(t * 47 + seed * 3) * 0.03, waist = fruit.surface(h * 0.45), base = seated(0.12, Math.abs(wave(19)) * 0.01);
      const hand = side => V(waist.x + side * (waist.r + 0.03), SEAT_H + h * 0.45, 0.04);
      return { ...base, x: wave(37) * 0.02, body: { ...base.body, tilt: shiver }, limbs: { leftHand: hand(1), rightHand: hand(-1), ...feetUnder } };
    }
    case 'waving': return { ...standing(Math.abs(wave(6)) * 0.06), limbs: {
      leftHand: V(0.36 - wave(9) * 0.06, LEG + h + 0.22, 0.08), rightHand: V(-0.36 + wave(9) * 0.06, LEG + h + 0.22, 0.08), ...feetStand } };
    case 'raising': return { ...standing(Math.abs(wave(3)) * 0.02, -0.12), limbs: {
      leftHand: V(0.34, LEG + h * 0.25, 0.06), rightHand: V(-0.22 - wave(5) * 0.03, LEG + h + 0.3, 0.06), ...feetStand } };
    // Waited ten minutes: hands on hips, elbows out, a foot tapping, and every few seconds a look down at the watch on the left wrist.
    case 'impatient': {
      const tap = Math.max(0, wave(9)), hip = fruit.surface(h * 0.32), check = clamp(s(t * 0.8 + seed) * 3, 0, 1);
      const akimbo = side => V(hip.x + side * (hip.r + 0.06), LEG + h * 0.32, 0.05), watch = V(0.06, LEG + h * 0.24, fruit.surface(h * 0.24).r + 0.08);
      return { ...standing(tap * 0.01, 0.04), elbows: 0.18, glance: check > 0.5 ? watch : null, limbs: {
        leftHand: akimbo(1).lerp(watch, check), rightHand: akimbo(-1), leftFoot: V(0.11, 0.03, 0), rightFoot: V(-0.11, 0.03 + tap * 0.05, 0.03) } };
    }
    // Just finished (the finish habit): a long stretch, arms overhead, swaying, eyes shut and mouth open in a yawn (the 'asleep' face)...
    case 'stretching': {
      const base = seated(-0.14); base.body.tilt = wave(1.6) * 0.06;
      return { ...base, limbs: { leftHand: V(0.15, SEAT_H + h + 0.3, -0.04), rightHand: V(-0.15, SEAT_H + h + 0.3, -0.04), ...feetUnder } };
    }
    // ...or a cheer, bouncing in the seat with both arms up in a V.
    case 'cheering': {
      const bounce = Math.abs(wave(7)), wide = fruit.surface(h * 0.6).r + 0.22, up = SEAT_H + h + 0.1 + bounce * 0.06;
      return { ...seated(0.02, bounce * 0.03), limbs: { leftHand: V(wide, up, 0.06), rightHand: V(-wide, up, 0.06), ...feetUnder } };
    }
    // Sunk back against the chair, breathing slowly, head lolling to one side, arms hanging down past the seat, heels up on the desk
    // in front of the keyboard (legs down to the floor would pass through the seat).
    // Thin fruit sit further back: the widest part of the body rests on the chair back.
    // Or dozing upright, hands folded in the lap, head to one side, feet on the floor.
    case 'sleeping': {
      if (habit === 'lap') {
        const base = seated(-0.08 + wave(1.3) * 0.012, wave(1.3) * 0.004 - wear * 0.02), lap = fruit.surface(h * 0.12).r + 0.05;
        base.body.tilt = 0.14 + wear * 0.1 + wave(0.3) * 0.015;
        return { ...base, limbs: { leftHand: V(-0.02, SEAT_H + 0.08, lap), rightHand: V(0.03, SEAT_H + 0.1, lap + 0.01), ...feetUnder } };
      }
      const lean = -0.2 + wave(1.3) * 0.012, tilt = 0.06 + wear * 0.1 + wave(0.3) * 0.015, y = SEAT_H - 0.015 - wear * 0.02;
      const z = BACK_Z + 0.015 + fruit.surface(h * 0.45).r + h * 0.09;
      const hang = side => V(side * 0.32 + tilt * 0.3, Math.max(0.15, y + h * 0.4 - 0.3), -0.04 - h * 0.08 + wave(1.3) * 0.008);
      return { x: 0, z, turn: 0, body: { y, tilt, lean }, limbs: {
        leftHand: hang(1), rightHand: hang(-1), leftFoot: V(0.09, DESK_H + 0.06, KEYS + SEAT_FORWARD - 0.1 - z), rightFoot: V(-0.09, DESK_H + 0.06, KEYS + SEAT_FORWARD - 0.1 - z) } };
    }
    // Walking to or from the door: legs and arms swing in opposition.
    case 'walking': return { ...standing(Math.abs(wave(8)) * 0.03), x: 0, z: 0, limbs: {
      leftHand: V(0.34, LEG + h * 0.3, wave(8) * 0.14), rightHand: V(-0.34, LEG + h * 0.3, -wave(8) * 0.14),
      leftFoot: V(0.11, 0.03 + Math.max(0, wave(8)) * 0.06, -wave(8) * 0.16), rightFoot: V(-0.11, 0.03 + Math.max(0, -wave(8)) * 0.06, wave(8) * 0.16) } };
    // Slacking off (slack.js): leaning back, the right hand on the mouse, the left on the desk; a chuckle now and then.
    case 'slacking': {
      const chuckle = Math.max(0, wave(0.7)) ** 6;
      return { ...seated(-0.12, Math.abs(s(t * 15)) * 0.01 * chuckle), limbs: {
        leftHand: V(0.24, DESK_H + 0.03, KEYS - 0.1), rightHand: V(MOUSE_X, DESK_H + 0.045, KEYS + wave(0.6) * 0.015), ...feetUnder } };
    }
    case 'slumped': return { ...seated(0.55), limbs: {
      leftHand: V(0.3, DESK_H + 0.03, KEYS - 0.06), rightHand: V(-0.3, DESK_H + 0.03, KEYS - 0.06), ...feetUnder } };
    // Talking to you: turned in the chair, sitting up, hands resting in the lap, nodding now and then.
    case 'listening': {
      const lap = fruit.surface(h * 0.12).r + 0.05;
      return { ...seated(-0.04 + Math.max(0, wave(0.9)) ** 8 * 0.08, wave(1.2) * 0.004), limbs: {
        leftHand: V(0.11, SEAT_H + 0.07, lap), rightHand: V(-0.11, SEAT_H + 0.07, lap), ...feetUnder } };
    }
    // A neighbour just finished: a thumbs up raised beside the head on their side (habit 'left' or 'right'), clear of monitors
    // and chair backs (fruit.js swaps the hand for a fist), the other hand in the lap.
    case 'thumbsup': {
      const side = habit === 'left' ? 1 : -1, lap = fruit.surface(h * 0.12).r + 0.05, beside = fruit.surface(h * 0.8).r + 0.12, pump = Math.max(0, wave(5));
      const up = V(side * beside, SEAT_H + h + 0.04 + pump * 0.03, 0.08), rest = V(-side * 0.11, SEAT_H + 0.07, lap);
      return { ...seated(-0.04, pump * 0.01), thumb: side > 0 ? 'leftHand' : 'rightHand', elbows: 0.08, limbs: {
        leftHand: side > 0 ? up : rest, rightHand: side > 0 ? rest : up, ...feetUnder } };
    }
    // A neighbour's desk went red: typing stops, hands still on the keys, craning for a worried look over (Cast.update turns the body).
    case 'concerned': return { ...seated(0.06, 0.03), limbs: {
      leftHand: V(0.12, DESK_H + 0.035, KEYS), rightHand: V(-0.12, DESK_H + 0.035, KEYS), ...feetUnder } };
    default: return { ...seated(0), limbs: {
      leftHand: V(0.2, DESK_H + 0.03, KEYS - 0.06), rightHand: V(-0.2, DESK_H + 0.03, KEYS - 0.06), ...feetUnder } };
  }
}

// Blends pose `b` into `a` in place by k (0..1); turning has its own rate.
export function blendPose(a, b, k, kTurn = k) {
  a.x += (b.x - a.x) * k; a.z += (b.z - a.z) * k; a.turn += (b.turn - a.turn) * kTurn;
  for (const key of ['y', 'tilt', 'lean', 'turn']) a.body[key] = (a.body[key] || 0) + ((b.body[key] || 0) - (a.body[key] || 0)) * k;
  a.elbows = (a.elbows || 0) + ((b.elbows || 0) - (a.elbows || 0)) * k;
  for (const name of Object.keys(b.limbs)) a.limbs[name].lerp(b.limbs[name], k);
  return a;
}
// The turn (from the seat's facing, -π..π) that faces c toward a world position.
const toward = (c, at) => { const a = Math.atan2(at.x - c.root.position.x, at.z - c.root.position.z) - c.anchor.facing; return Math.atan2(Math.sin(a), Math.cos(a)); };
const clonePose = pose => ({ ...pose, body: { ...pose.body }, limbs: Object.fromEntries(Object.entries(pose.limbs).map(([k, v]) => [k, v.clone()])) });

const shadowGeometry = new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false });

function plusTexture(n) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const g = canvas.getContext('2d'); g.fillStyle = '#2f3542'; g.beginPath(); g.roundRect(4, 4, 120, 56, 28); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 36px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`+${n}`, 64, 34);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export class Cast {
  // `route(from, to)`: waypoints round the furniture (path.js), or null for none.
  constructor(scene, { reducedMotion = () => false, route = () => null } = {}) {
    this.scene = scene; this.reducedMotion = reducedMotion; this.route = route; this.characters = new Map(); this.time = 0;
  }

  characterAt(id) { return this.characters.get(id)?.fruit; }
  // Who's turned toward you right now (the one you're talking to), or null.
  greet(id) { this.facingYou = id; }
  // Just above the character's head, in world space.
  positionOf(id) { const c = this.characters.get(id); if (!c?.fruit) return null; const p = c.fruit.body.getWorldPosition(new THREE.Vector3()); p.y += c.fruit.height * c.scale + 0.08; return p; }

  sync(layout, sessions, room, statuses, { animate = true } = {}) {
    const seen = new Set(), still = this.reducedMotion();
    this.door = new THREE.Vector3(layout.door.x, 0, layout.door.z - 0.6);
    const firstSync = !this.synced; this.synced = true;
    const place = (id, make) => {
      seen.add(id);
      let c = this.characters.get(id);
      if (!c) { c = make(); this.characters.set(id, c); this.scene.add(c.root); }
      const status = statuses.get(id) || { pose: 'waving', expression: 'smile' };
      c.expression = status.expression; c.since = status.since;
      // Done: a sitter going from work to idle stretches or punches the air before nodding off (not on a page load).
      if (c.pose !== status.pose && !firstSync && !still && WORKING.has(c.pose) && status.pose === 'sleeping') { c.finished = this.time; c.fan = undefined; }
      if (c.pose !== status.pose) { c.pose = status.pose; c.changed = this.time; c.fruit.setGrey(status.pose === 'still'); }
      if (c.wear !== (status.wear || 0)) { c.wear = status.wear || 0; c.changed = this.time; c.fruit.setWear(c.wear); }
      if (c.shades !== (status.mode === 'bypass')) { c.shades = status.mode === 'bypass'; c.fruit.setShades(c.shades); }
      return c;
    };
    for (const [id, desk] of layout.desks) {
      const anchor = room.deskAnchor(id); if (!anchor) continue;
      const isNew = !this.characters.has(id), c = place(id, () => this.#character(id, 1));
      c.anchor = anchor;
      // Newcomers walk in from the door (not on the first load, when everyone is simply there).
      if (isNew && !firstSync && animate && !still) c.trip = { at: this.door.clone(), to: 'desk' };
      // Ended sessions say goodbye, then walk out; with reduced motion they just vanish.
      if (desk.vacantSince === undefined && c.leaving) { c.leaving = false; c.root.visible = true; c.trip = still ? null : { to: 'desk' }; }
      if (desk.vacantSince !== undefined && !c.leaving) { c.leaving = true; c.trip = still ? null : { wait: GOODBYE, to: 'door' }; c.root.visible = !still; }
      // Helpers sit at their own tiny desks beside the parent's; more than fit show as a +N above the last one.
      desk.subagents.forEach((kid, i) => { const k = place(kid, () => this.#character(kid, HELPER_SCALE)); k.anchor = anchor.helpers[i]; });
      let plus = this.characters.get(`${id}#plus`);
      if (desk.overflow && (!plus || plus.count !== desk.overflow)) {
        if (plus) { plus.root.removeFromParent(); plus.root.material.map.dispose(); plus.root.material.dispose(); }
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: plusTexture(desk.overflow) })); sprite.scale.set(0.24, 0.12, 1);
        sprite.position.copy(anchor.helpers.at(-1).top).add(new THREE.Vector3(0, 0.6, 0)); this.scene.add(sprite);
        plus = { root: sprite, count: desk.overflow, plus: true }; this.characters.set(`${id}#plus`, plus);
      }
      if (desk.overflow) seen.add(`${id}#plus`);
    }
    for (const [id, c] of this.characters) if (!seen.has(id)) this.#remove(id, c);
  }

  #character(id, scale) {
    const who = identity(id), fruit = createFruit(who, { scale }), root = new THREE.Group();
    root.userData.sessionId = id;
    root.add(fruit.group);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial); shadow.position.y = 0.017; shadow.scale.setScalar(scale); root.add(shadow);
    const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 100;
    return { id, fruit, root, scale, seed, habits: who.habits, current: null, changed: 0, wear: 0, blinkAt: seed / 30, blinkUntil: 0 };
  }

  #remove(id, c) {
    if (c.plus) { c.root.removeFromParent(); c.root.material.map.dispose(); c.root.material.dispose(); }
    else c.fruit.dispose(), c.root.removeFromParent();
    this.characters.delete(id);
  }

  // Hit by something or the boss's coffee, or their desk was: a jump, then a frown and a glare at the boss for a moment.
  startle(id) { const c = this.characters.get(id); if (c && !c.plus) c.startled = this.time; }

  update(dt, playerPos) {
    if (this.frozen) return; // connection lost: everyone holds still until it's back
    const still = this.reducedMotion();
    this.time += dt;
    const t = still ? 0 : this.time, k = still ? 1 : 1 - Math.exp(-dt * BLEND), local = new THREE.Vector3(), head = new THREE.Vector3();
    // Neighbours react (not with reduced motion): the nearest awake sitter gives someone who just finished a thumbs up,
    // and anyone typing or thinking near a red desk keeps glancing over.
    const sitters = [...this.characters.values()].filter(c => !c.plus && c.anchor && !c.trip && !c.leaving), fans = new Map();
    const nearest = (c, ok) => { let best = null, d = NEAR; for (const o of sitters) if (o !== c && ok(o)) { const e = o.root.position.distanceTo(c.root.position); if (e < d) [best, d] = [o, e]; } return best; };
    const red = still ? [] : sitters.filter(o => o.pose === 'slumped');
    if (!still) for (const f of sitters) if (this.time - f.finished < FINISHED) {
      if (f.fan === undefined) f.fan = nearest(f, o => ['typing', 'thinking', 'sleeping'].includes(o.pose) && !(this.time - o.finished < FINISHED) && this.facingYou !== o.id && !fans.has(o.id))?.id ?? null;
      if (f.fan) fans.set(f.fan, f);
    }
    for (const c of this.characters.values()) {
      if (c.plus || !c.anchor) continue;
      const { fruit } = c;
      // Whoever you're talking to stops what they're doing (a sleeper wakes up), turns in the chair and listens.
      // A working or idle sitter may be slacking off (room.js and slack.js have it), or just caught at it.
      const talking = this.facingYou === c.id && !STANDING.has(c.pose), busy = ['typing', 'thinking', 'sleeping'].includes(c.pose), slack = c.anchor.slack;
      const finishing = this.time - c.finished < FINISHED, cheer = c.habits.finish, cheering = fans.get(c.id);
      const worry = red.length && ['typing', 'thinking'].includes(c.pose) && (this.time + c.seed) % GLANCE_EVERY < GLANCE_FOR ? nearest(c, o => o.pose === 'slumped') : null;
      const pose = talking ? 'listening' : finishing ? cheer : cheering ? 'thumbsup' : busy && slack?.show ? 'slacking' : busy && slack?.busted ? 'busted'
        : worry ? 'concerned' : STANDING.has(c.pose) && c.since ? waitingPose(c.since) : c.pose;
      const since = this.time - c.startled, startled = since < STARTLED;
      const face = startled ? 'frown' : talking && ['asleep', 'squeezed'].includes(c.expression) ? 'neutral' : pose === 'slacking' ? (slack.wary ? 'worried' : 'smile') : pose === 'busted' ? 'worried' : pose === 'impatient' ? 'annoyed' : pose === 'stretching' ? 'asleep' : pose === 'cheering' || pose === 'thumbsup' ? 'smile' : pose === 'concerned' ? 'worried' : c.expression;
      if (c.shown !== pose) { if (c.shown) c.changed = this.time; c.shown = pose; }
      if (c.face !== face) { c.face = face; fruit.setExpression(face); }
      fruit.buzz(t);
      if (c.trip && this.#walk(c, dt, t, k)) continue;
      // Reacting to a neighbour, they look at them: turned in the chair for a thumbs up (not so far the chair back hides them),
      // just twisting round (hands on the keys) when worried.
      const other = pose === 'thumbsup' ? cheering : pose === 'concerned' ? worry : null, turn = other ? toward(c, other.root.position) : 0;
      const target = poseTargets(pose, t, c.seed, fruit, c.wear, pose === 'thumbsup' ? (turn > 0 ? 'left' : 'right') : c.habits[pose]);
      if (startled && !still && since < 0.4) target.body.y += 0.16 * Math.sin(Math.PI * since / 0.4);
      // Worn out: slouched lower and to one side (a sleeper already is; one caught slacking sits up straight).
      if (c.wear && pose !== 'sleeping' && pose !== 'busted') { target.body.lean += 0.12 * c.wear; target.body.y -= 0.03 * c.wear; target.body.tilt += 0.1 * c.wear; }
      if (other) {
        if (other === cheering) target.turn = THREE.MathUtils.clamp(turn, -1.3, 1.3); else target.body.turn = THREE.MathUtils.clamp(turn, -0.9, 0.9);
        other.fruit.body.getWorldPosition(head).y += other.fruit.height * other.scale * 0.6; target.glance = fruit.group.worldToLocal(head);
      }
      // Standing characters turn toward the boss when they want something, and anyone you're talking to turns in their chair.
      if (playerPos && (STANDING.has(pose) || this.facingYou === c.id || startled)) target.turn = toward(c, playerPos);
      // Caught out, they snap to it; startled, they whip round.
      const kPose = (pose === 'busted' || startled) && !still ? 1 - Math.exp(-dt * 20) : k;
      if (!c.current) c.current = clonePose(target); else blendPose(c.current, target, this.time - c.changed > SETTLED ? 1 : kPose, kPose);
      const p = c.current, facing = c.anchor.facing, x = p.x * c.scale, z = p.z * c.scale;
      c.root.position.copy(c.anchor.seat).setY(0).add(new THREE.Vector3(Math.cos(facing) * x + Math.sin(facing) * z, 0, -Math.sin(facing) * x + Math.cos(facing) * z));
      c.root.rotation.y = facing + p.turn;
      fruit.setBody(p.body); fruit.setLimbs(p.limbs, p.elbows, target.thumb);
      // Blink every few seconds; asleep eyes are drawn closed anyway.
      if (this.time > c.blinkAt) { c.blinkUntil = this.time + 0.12; c.blinkAt = this.time + 2 + ((c.seed * 7 + this.time * 13) % 3); }
      fruit.setBlink(this.time < c.blinkUntil ? 0.1 : 1);
      if (target.glance) fruit.lookAt(target.glance);
      else if (playerPos && c.root.position.distanceTo(local.copy(playerPos).setY(0)) < LOOK_RANGE) fruit.lookAt(fruit.group.worldToLocal(local.copy(playerPos)));
      else fruit.lookAt(pose === 'thinking' ? local.set(0.6, p.body.y + fruit.faceY + 0.6, 1) : null); // thinking looks up and away
    }
  }

  // Moves a character along its trip (door → desk, or desk → door), round the desks: the way is worked out once per trip,
  // straight there if there's none. Returns true while the trip owns the character.
  #walk(c, dt, t, k) {
    const trip = c.trip, { fruit } = c;
    if (trip.wait > 0) { trip.wait -= dt; return false; } // still waving goodbye at the desk
    if (!trip.at) trip.at = c.root.position.clone().setY(0);
    const goal = trip.to === 'desk' ? c.anchor.seat.clone().setY(0) : this.door;
    trip.path ??= this.route(trip.at, goal) || [goal];
    while (trip.path.length > 1 && trip.at.distanceTo(trip.path[0]) < 0.05) trip.path.shift();
    const to = trip.path[0].clone().sub(trip.at), distance = to.length();
    if (trip.path.length === 1 && distance < 0.05) {
      c.trip = null;
      if (trip.to === 'door') c.root.visible = false;
      return trip.to === 'door';
    }
    trip.at.addScaledVector(to.normalize(), Math.min(distance, WALK_SPEED * dt));
    const target = poseTargets('walking', t, c.seed, fruit);
    if (!c.current) c.current = clonePose(target); else blendPose(c.current, target, k);
    const yaw = c.root.rotation.y, turn = Math.atan2(to.x, to.z) - yaw; // turning the corners rather than snapping round
    c.root.position.copy(trip.at); c.root.rotation.y = yaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 10);
    fruit.setBody(c.current.body); fruit.setLimbs(c.current.limbs, c.current.elbows); fruit.lookAt(null);
    return true;
  }

  dispose() { for (const [id, c] of this.characters) this.#remove(id, c); }
}

