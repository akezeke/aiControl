// Poses for each status and the cast of characters at their desks.
// A pose is plain numbers in the character's seat frame (facing +z), so two poses can be blended.
import * as THREE from 'three';
import { createFruit, LEG } from './fruit.js';
import { identity } from './status.js';
import { SEAT_H, DESK_H } from './room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BLEND = 6;        // per second; about half a second to settle
const SEAT_FORWARD = 0.2, STAND_SIDE = 0.8;
const LOOK_RANGE = 4;

// t is seconds (frozen at 0 with reduced motion), seed spreads characters out of step, h is the fruit's body height.
export function poseTargets(pose, t, seed, h) {
  const s = Math.sin, wave = k => s(t * k + seed);
  const seated = (lean, bob = 0) => ({ x: 0, z: SEAT_FORWARD, turn: 0, body: { y: SEAT_H + bob, tilt: 0, lean } });
  const standing = (bounce, tilt = 0) => ({ x: STAND_SIDE, z: -0.1, turn: 0, body: { y: LEG + bounce, tilt, lean: 0 } });
  const feetUnder = { leftFoot: V(-0.12, 0.03, 0.32), rightFoot: V(0.12, 0.03, 0.32) };
  const feetStand = { leftFoot: V(-0.11, 0.03, 0), rightFoot: V(0.11, 0.03, 0) };
  switch (pose) {
    case 'typing': return { ...seated(0.1, Math.abs(wave(4)) * 0.012), lookAtMonitor: true, limbs: {
      leftHand: V(-0.13, DESK_H + 0.04 + Math.max(0, wave(15)) * 0.035, 0.48), rightHand: V(0.13, DESK_H + 0.04 + Math.max(0, wave(15 + 1.7)) * 0.035, 0.48), ...feetUnder } };
    case 'waving': return { ...standing(Math.abs(wave(6)) * 0.06), limbs: {
      leftHand: V(-0.36 + wave(9) * 0.06, LEG + h + 0.22, 0.08), rightHand: V(0.36 - wave(9) * 0.06, LEG + h + 0.22, 0.08), ...feetStand } };
    case 'raising': return { ...standing(Math.abs(wave(3)) * 0.02, 0.12), limbs: {
      leftHand: V(-0.34, LEG + h * 0.25, 0.06), rightHand: V(0.22 + wave(5) * 0.03, LEG + h + 0.3, 0.06), ...feetStand } };
    case 'sleeping': return { ...seated(-0.24, wave(1.3) * 0.01), z: SEAT_FORWARD + 0.12, limbs: {
      leftHand: V(-0.2, SEAT_H + 0.08, 0.28), rightHand: V(0.2, SEAT_H + 0.08, 0.28), leftFoot: V(-0.16, 0.05, 0.62), rightFoot: V(0.16, 0.05, 0.62) } };
    case 'slumped': return { ...seated(0.55), limbs: {
      leftHand: V(-0.3, DESK_H + 0.03, 0.42), rightHand: V(0.3, DESK_H + 0.03, 0.42), ...feetUnder } };
    default: return { ...seated(0), limbs: {
      leftHand: V(-0.2, DESK_H + 0.03, 0.48), rightHand: V(0.2, DESK_H + 0.03, 0.48), ...feetUnder } };
  }
}

// Blends pose `b` into `a` in place by k (0..1).
export function blendPose(a, b, k) {
  a.x += (b.x - a.x) * k; a.z += (b.z - a.z) * k; a.turn += (b.turn - a.turn) * k;
  for (const key of ['y', 'tilt', 'lean']) a.body[key] += (b.body[key] - a.body[key]) * k;
  for (const name of Object.keys(b.limbs)) a.limbs[name].lerp(b.limbs[name], k);
  a.lookAtMonitor = b.lookAtMonitor;
  return a;
}
const clonePose = pose => ({ ...pose, body: { ...pose.body }, limbs: Object.fromEntries(Object.entries(pose.limbs).map(([k, v]) => [k, v.clone()])) });

const shadowGeometry = new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false });
const laptopGeometry = new THREE.BoxGeometry(0.5, 0.04, 0.34), laptopMaterial = new THREE.MeshToonMaterial({ color: '#c7ccd6' });

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
  positionOf(id) { const c = this.characters.get(id); return c && c.fruit.group.getWorldPosition(new THREE.Vector3()).setY(c.fruit.group.position.y + c.fruit.body.position.y * c.scale + c.fruit.height * c.scale); }

  sync(layout, sessions, room, statuses) {
    const seen = new Set();
    const place = (id, make) => {
      seen.add(id);
      let c = this.characters.get(id);
      if (!c) { c = make(); this.characters.set(id, c); this.scene.add(c.root); }
      const status = statuses.get(id);
      if (c.expression !== status.expression) { c.expression = status.expression; c.fruit.setExpression(status.expression); }
      if (c.pose !== status.pose) { c.pose = status.pose; c.fruit.setGrey(status.pose === 'still'); }
      return c;
    };
    for (const [id, desk] of layout.desks) {
      const anchor = room.deskAnchor(id); if (!anchor) continue;
      const c = place(id, () => this.#character(id, 1));
      c.anchor = anchor;
      desk.subagents.forEach((kid, i) => {
        const k = place(kid, () => this.#character(kid, 0.42, true));
        // Small helpers stand on the parent's desk beside the monitor, each at a tiny laptop.
        const side = new THREE.Vector3(Math.cos(anchor.facing), 0, -Math.sin(anchor.facing)), forward = new THREE.Vector3(Math.sin(anchor.facing), 0, Math.cos(anchor.facing));
        k.anchor = { seat: anchor.top.clone().addScaledVector(side, -0.62 + i * 0.3).addScaledVector(forward, -0.12), facing: anchor.facing };
        k.subPose = statuses.get(kid).pose === 'typing' ? 'typing' : 'still';
      });
      let plus = this.characters.get(`${id}#plus`);
      if (desk.overflow && (!plus || plus.count !== desk.overflow)) {
        if (plus) { plus.root.removeFromParent(); plus.root.material.map.dispose(); plus.root.material.dispose(); }
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: plusTexture(desk.overflow) })); sprite.scale.set(0.24, 0.12, 1);
        sprite.position.copy(anchor.top).add(new THREE.Vector3(0, 0.2, 0)); this.scene.add(sprite);
        plus = { root: sprite, count: desk.overflow, plus: true }; this.characters.set(`${id}#plus`, plus);
      }
      if (desk.overflow) seen.add(`${id}#plus`);
    }
    for (const [id, c] of this.characters) if (!seen.has(id)) this.#remove(id, c);
  }

  #character(id, scale, small = false) {
    const fruit = createFruit(identity(id), { scale }), root = new THREE.Group();
    root.add(fruit.group);
    if (!small) { const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial); shadow.position.y = 0.006; root.add(shadow); }
    else { const laptop = new THREE.Mesh(laptopGeometry, laptopMaterial); laptop.position.set(0, 0.02, 0.32); fruit.group.add(laptop); }
    const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 100;
    return { id, fruit, root, scale, small, seed, current: null, blinkAt: seed / 30, blinkUntil: 0 };
  }

  #remove(id, c) {
    if (c.plus) { c.root.removeFromParent(); c.root.material.map.dispose(); c.root.material.dispose(); }
    else c.fruit.dispose(), c.root.removeFromParent();
    this.characters.delete(id);
  }

  update(dt, playerPos) {
    const still = this.reducedMotion();
    this.time += dt;
    const t = still ? 0 : this.time, k = still ? 1 : 1 - Math.exp(-dt * BLEND), local = new THREE.Vector3();
    for (const c of this.characters.values()) {
      if (c.plus || !c.anchor) continue;
      const { fruit } = c, pose = c.small ? (c.subPose === 'typing' ? 'standTyping' : 'standStill') : c.pose;
      const target = c.small ? smallPose(pose, t, c.seed) : poseTargets(pose, t, c.seed, fruit.height);
      // Standing characters turn toward the boss when they want something.
      if (!c.small && playerPos && (pose === 'waving' || pose === 'raising')) {
        const at = c.root.position, angle = Math.atan2(playerPos.x - at.x, playerPos.z - at.z) - c.anchor.facing;
        target.turn = Math.atan2(Math.sin(angle), Math.cos(angle));
      }
      if (!c.current) c.current = clonePose(target); else blendPose(c.current, target, k);
      const p = c.current, facing = c.anchor.facing;
      c.root.position.copy(c.anchor.seat).setY(c.small ? c.anchor.seat.y : 0)
        .add(new THREE.Vector3(Math.cos(facing) * p.x + Math.sin(facing) * p.z, 0, -Math.sin(facing) * p.x + Math.cos(facing) * p.z));
      c.root.rotation.y = facing + p.turn;
      fruit.setBody(p.body); fruit.setLimbs(p.limbs);
      // Blink every few seconds; asleep eyes are drawn closed anyway.
      if (this.time > c.blinkAt) { c.blinkUntil = this.time + 0.12; c.blinkAt = this.time + 2 + ((c.seed * 7 + this.time * 13) % 3); }
      fruit.setBlink(this.time < c.blinkUntil ? 0.1 : 1);
      if (playerPos && !c.small && c.root.position.distanceTo(local.copy(playerPos).setY(0)) < LOOK_RANGE) fruit.lookAt(fruit.group.worldToLocal(local.copy(playerPos)));
      else fruit.lookAt(null);
    }
  }

  dispose() { for (const [id, c] of this.characters) this.#remove(id, c); }
}

function smallPose(pose, t, seed) {
  const typing = pose === 'standTyping', tap = k => typing ? Math.max(0, Math.sin(t * k + seed)) * 0.04 : 0;
  return { x: 0, z: 0, turn: 0, body: { y: LEG, tilt: 0, lean: typing ? 0.12 : 0 }, limbs: {
    leftHand: V(-0.12, LEG + 0.1 + tap(14), 0.3), rightHand: V(0.12, LEG + 0.1 + tap(15.7), 0.3),
    leftFoot: V(-0.11, 0.03, 0), rightFoot: V(0.11, 0.03, 0) } };
}
