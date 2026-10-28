// Poses for each status and the cast of characters at their desks.
// A pose is plain numbers in the character's seat frame (facing +z), so two poses can be blended.
import * as THREE from 'three';
import { createFruit, LEG } from './fruit.js';
import { identity } from './status.js';
import { SEAT_H, DESK_H, CHAIR_Z, KEYS_Z, HELPER_SCALE } from './room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BLEND = 6;        // per second; about half a second to settle
const SETTLED = 0.7;    // seconds after a pose change, after which the pose is followed exactly (blending would damp fast typing)
// The sitter's root sits a little forward of the chair; standing, they step out behind it.
const SEAT_FORWARD = 0.06, STAND_BACK = -0.8;
const KEYS = KEYS_Z - CHAIR_Z - SEAT_FORWARD, MOUSE_X = 0.33; // keyboard and mouse, from the sitter's root
const LOOK_RANGE = 4, WALK_SPEED = 2, GOODBYE = 1.2;

// t is seconds (frozen at 0 with reduced motion), seed spreads characters out of step, h is the fruit's body height,
// wear (0..1) slows typing down.
export function poseTargets(pose, t, seed, h, wear = 0) {
  const s = Math.sin, wave = k => s(t * k + seed), clamp = THREE.MathUtils.clamp;
  const seated = (lean, bob = 0) => ({ x: 0, z: SEAT_FORWARD, turn: 0, body: { y: SEAT_H + bob, tilt: 0, lean } });
  const standing = (bounce, tilt = 0) => ({ x: 0, z: STAND_BACK, turn: 0, body: { y: LEG + bounce, tilt, lean: 0 } });
  const feetUnder = { leftFoot: V(-0.12, 0.03, 0.32), rightFoot: V(0.12, 0.03, 0.32) };
  const feetStand = { leftFoot: V(-0.11, 0.03, 0), rightFoot: V(0.11, 0.03, 0) };
  switch (pose) {
    // Quick taps, the hands out of step and wandering over the keys; every so often a pause to read, the right hand on the mouse.
    case 'typing': {
      const reading = clamp((wave(0.45) + s(t * 0.17 + seed * 2) * 0.7 - 0.85) * 3, 0, 1), typing = 1 - reading, rate = 22 * (1 - wear * 0.4);
      const tap = phase => DESK_H + 0.035 + Math.abs(s(t * rate + seed + phase)) * 0.03 * typing;
      const body = seated(0.1 * typing - 0.03 * reading, Math.abs(wave(rate / 2)) * 0.005 * typing);
      body.body.tilt = wave(0.7) * 0.025;
      return { ...body, limbs: {
        leftHand: V(-0.12 + wave(1.3) * 0.04 - reading * 0.06, tap(0), KEYS + wave(0.9) * 0.02 - reading * 0.04),
        rightHand: V(0.12 + s(t * 1.1 + seed + 2) * 0.04 + reading * (MOUSE_X - 0.12), tap(1.3) + reading * 0.01, KEYS + s(t * 0.8 + seed + 1) * 0.02),
        ...feetUnder } };
    }
    // Leaning back, hand at the chin, the other on the desk, tapping a finger.
    case 'thinking': return { ...seated(-0.1, wave(1.2) * 0.006), limbs: {
      leftHand: V(-0.24, DESK_H + 0.03, KEYS - 0.08), rightHand: V(0.09, SEAT_H + h * 0.46 + Math.max(0, wave(3)) * 0.012, 0.33), ...feetUnder } };
    case 'waving': return { ...standing(Math.abs(wave(6)) * 0.06), limbs: {
      leftHand: V(-0.36 + wave(9) * 0.06, LEG + h + 0.22, 0.08), rightHand: V(0.36 - wave(9) * 0.06, LEG + h + 0.22, 0.08), ...feetStand } };
    case 'raising': return { ...standing(Math.abs(wave(3)) * 0.02, 0.12), limbs: {
      leftHand: V(-0.34, LEG + h * 0.25, 0.06), rightHand: V(0.22 + wave(5) * 0.03, LEG + h + 0.3, 0.06), ...feetStand } };
    case 'sleeping': return { ...seated(-0.24, wave(1.3) * 0.01), z: SEAT_FORWARD + 0.04, limbs: {
      leftHand: V(-0.2, SEAT_H + 0.08, 0.28), rightHand: V(0.2, SEAT_H + 0.08, 0.28), leftFoot: V(-0.16, 0.05, 0.62), rightFoot: V(0.16, 0.05, 0.62) } };
    // Walking to or from the door: legs and arms swing in opposition.
    case 'walking': return { ...standing(Math.abs(wave(8)) * 0.03), x: 0, z: 0, limbs: {
      leftHand: V(-0.34, LEG + h * 0.3, wave(8) * 0.14), rightHand: V(0.34, LEG + h * 0.3, -wave(8) * 0.14),
      leftFoot: V(-0.11, 0.03 + Math.max(0, wave(8)) * 0.06, -wave(8) * 0.16), rightFoot: V(0.11, 0.03 + Math.max(0, -wave(8)) * 0.06, wave(8) * 0.16) } };
    case 'slumped': return { ...seated(0.55), limbs: {
      leftHand: V(-0.3, DESK_H + 0.03, KEYS - 0.06), rightHand: V(0.3, DESK_H + 0.03, KEYS - 0.06), ...feetUnder } };
    default: return { ...seated(0), limbs: {
      leftHand: V(-0.2, DESK_H + 0.03, KEYS - 0.06), rightHand: V(0.2, DESK_H + 0.03, KEYS - 0.06), ...feetUnder } };
  }
}

// Blends pose `b` into `a` in place by k (0..1); turning has its own rate.
export function blendPose(a, b, k, kTurn = k) {
  a.x += (b.x - a.x) * k; a.z += (b.z - a.z) * k; a.turn += (b.turn - a.turn) * kTurn;
  for (const key of ['y', 'tilt', 'lean']) a.body[key] += (b.body[key] - a.body[key]) * k;
  for (const name of Object.keys(b.limbs)) a.limbs[name].lerp(b.limbs[name], k);
  return a;
}
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
  constructor(scene, { reducedMotion = () => false } = {}) {
    this.scene = scene; this.reducedMotion = reducedMotion; this.characters = new Map(); this.time = 0;
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
      if (c.expression !== status.expression) { c.expression = status.expression; c.fruit.setExpression(status.expression); }
      if (c.pose !== status.pose) { c.pose = status.pose; c.changed = this.time; c.fruit.setGrey(status.pose === 'still'); }
      if (c.wear !== (status.wear || 0)) { c.wear = status.wear || 0; c.changed = this.time; c.fruit.setWear(c.wear); }
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
    const fruit = createFruit(identity(id), { scale }), root = new THREE.Group();
    root.userData.sessionId = id;
    root.add(fruit.group);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial); shadow.position.y = 0.017; shadow.scale.setScalar(scale); root.add(shadow);
    const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 100;
    return { id, fruit, root, scale, seed, current: null, changed: 0, wear: 0, blinkAt: seed / 30, blinkUntil: 0 };
  }

  #remove(id, c) {
    if (c.plus) { c.root.removeFromParent(); c.root.material.map.dispose(); c.root.material.dispose(); }
    else c.fruit.dispose(), c.root.removeFromParent();
    this.characters.delete(id);
  }

  update(dt, playerPos) {
    if (this.frozen) return; // connection lost: everyone holds still until it's back
    const still = this.reducedMotion();
    this.time += dt;
    const t = still ? 0 : this.time, k = still ? 1 : 1 - Math.exp(-dt * BLEND), local = new THREE.Vector3();
    for (const c of this.characters.values()) {
      if (c.plus || !c.anchor) continue;
      const { fruit, pose } = c;
      if (c.trip && this.#walk(c, dt, t, k)) continue;
      const target = poseTargets(pose, t, c.seed, fruit.height, c.wear);
      // Worn out: slouched lower and to one side.
      if (c.wear) { target.body.lean += 0.12 * c.wear; target.body.y -= 0.03 * c.wear; target.body.tilt += 0.1 * c.wear; }
      // Standing characters turn toward the boss when they want something, and anyone you're talking to turns in their chair.
      if (playerPos && (pose === 'waving' || pose === 'raising' || this.facingYou === c.id)) {
        const at = c.root.position, angle = Math.atan2(playerPos.x - at.x, playerPos.z - at.z) - c.anchor.facing;
        target.turn = Math.atan2(Math.sin(angle), Math.cos(angle));
      }
      if (!c.current) c.current = clonePose(target); else blendPose(c.current, target, this.time - c.changed > SETTLED ? 1 : k, k);
      const p = c.current, facing = c.anchor.facing, x = p.x * c.scale, z = p.z * c.scale;
      c.root.position.copy(c.anchor.seat).setY(0).add(new THREE.Vector3(Math.cos(facing) * x + Math.sin(facing) * z, 0, -Math.sin(facing) * x + Math.cos(facing) * z));
      c.root.rotation.y = facing + p.turn;
      fruit.setBody(p.body); fruit.setLimbs(p.limbs);
      // Blink every few seconds; asleep eyes are drawn closed anyway.
      if (this.time > c.blinkAt) { c.blinkUntil = this.time + 0.12; c.blinkAt = this.time + 2 + ((c.seed * 7 + this.time * 13) % 3); }
      fruit.setBlink(this.time < c.blinkUntil ? 0.1 : 1);
      if (playerPos && c.root.position.distanceTo(local.copy(playerPos).setY(0)) < LOOK_RANGE) fruit.lookAt(fruit.group.worldToLocal(local.copy(playerPos)));
      else fruit.lookAt(pose === 'thinking' ? local.set(0.6, p.body.y + fruit.faceY + 0.6, 1) : null); // thinking looks up and away
    }
  }

  // Moves a character along its trip (door → desk, or desk → door). Returns true while the trip owns the character.
  #walk(c, dt, t, k) {
    const trip = c.trip, { fruit } = c;
    if (trip.wait > 0) { trip.wait -= dt; return false; } // still waving goodbye at the desk
    if (!trip.at) trip.at = c.root.position.clone().setY(0);
    const seat = c.anchor.seat.clone().setY(0), goal = trip.to === 'desk' ? seat : this.door, to = goal.clone().sub(trip.at), distance = to.length();
    if (distance < 0.05) {
      c.trip = null;
      if (trip.to === 'door') c.root.visible = false;
      return trip.to === 'door';
    }
    trip.at.addScaledVector(to.normalize(), Math.min(distance, WALK_SPEED * dt));
    const target = poseTargets('walking', t, c.seed, fruit.height);
    if (!c.current) c.current = clonePose(target); else blendPose(c.current, target, k);
    c.root.position.copy(trip.at); c.root.rotation.y = Math.atan2(to.x, to.z);
    fruit.setBody(c.current.body); fruit.setLimbs(c.current.limbs); fruit.lookAt(null);
    return true;
  }

  dispose() { for (const [id, c] of this.characters) this.#remove(id, c); }
}

