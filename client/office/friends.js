// The other players in a meeting, as fruit in their own colour with a name tag, walking about the host's office (live.js
// brings their positions; office.js feeds them in). Built the first time they show up, disposed when they leave.
import * as THREE from 'three';
import { createFruit } from './fruit.js';
import { poseTargets } from './animation.js';
import { playerLook } from './meeting.js';

const EASE = 0.05, SNAP = 3, RUNNING = 1.7;

// Positions and yaw move toward the last update in about 0.15 s; a jump of more than 3 m is a teleport (the door) and snaps.
export function ease(from, to, dt) {
  if (Math.hypot(to.x - from.x, to.z - from.z) > SNAP) return { x: to.x, y: to.y, z: to.z, yaw: to.yaw };
  const k = 1 - Math.exp(-dt / EASE), turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k, yaw: from.yaw + turn * k };
}

export const gait = speed => speed < 0.3 ? 'standing' : speed < 3 ? 'walking' : 'running';

// Who's drawn: everyone at the meeting but you.
export const atMeeting = (roster, me) => roster.filter(p => p.at === 'meeting' && p.id !== me);

// The name in their colour on a dark plate, drawn once per name.
function tag(name, colour) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(244, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(20,20,24,0.78)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 14); g.fill();
  g.fillStyle = colour; g.fillText(name, 128, 33, 224);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createFriends(scene, { room, reducedMotion = () => false }) {
  const friends = new Map();
  let time = 0;

  function build(p) {
    const look = playerLook(p.name, p.fruit, p.colour), fruit = createFruit(look), root = new THREE.Group();
    root.add(fruit.group); root.visible = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag(p.name, p.colour), transparent: true, toneMapped: false }));
    sprite.scale.set(0.64, 0.16, 1); sprite.position.y = fruit.height + 0.2; root.add(sprite);
    scene.add(root);
    return { id: p.id, name: p.name, look: `${p.fruit}${p.colour}`, fruit, root, sprite, seed: [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 7, at: null, shown: null, pose: 'standing' };
  }
  function drop(f) { f.root.removeFromParent(); f.fruit.dispose(); f.sprite.material.map.dispose(); f.sprite.material.dispose(); }

  return {
    // `me` is your own id. Builds whoever just arrived, drops whoever left; a new name or look is built again.
    sync(roster, me) {
      const here = new Map(atMeeting(roster, me).map(p => [p.id, p]));
      for (const [id, f] of friends) {
        const p = here.get(id);
        if (!p || f.look !== `${p.fruit}${p.colour}`) { drop(f); friends.delete(id); }
        else if (f.name !== p.name) { f.name = p.name; f.sprite.material.map.dispose(); f.sprite.material.map = tag(p.name, p.colour); }
      }
      for (const [id, p] of here) if (!friends.has(id)) friends.set(id, build(p));
    },
    // A position message: where they are (feet on the floor), which way they face and what they're doing.
    move(id, { x, y, z, yaw, pose }) {
      const f = friends.get(id); if (!f) return;
      const to = { x, y, z, yaw }; f.pose = pose;
      f.to = to;
      if (!f.at) { f.at = { ...to }; f.root.visible = true; }
    },
    update(dt, now = time + dt) {
      time = now;
      const still = reducedMotion(), t = still ? 0 : time;
      for (const f of friends.values()) {
        if (!f.at) continue;
        f.at = ease(f.at, f.to, dt);
        f.root.position.set(f.at.x, f.at.y, f.at.z); f.root.rotation.y = f.at.yaw;
        // In a shut room they're behind its wall.
        const p = f.root.position; f.root.visible = !(room.kitchen.inside(p) && !room.kitchen.shown) && !(room.secret.inside(p) && !room.secret.shown);
        if (!f.root.visible) continue;
        const h = f.fruit.height, run = f.pose === 'running', moving = run || f.pose === 'walking';
        const target = poseTargets('walking', moving && !still ? t * (run ? RUNNING : 1) : 0, moving ? f.seed : 0, f.fruit);
        if (run) target.body.lean = 0.15;
        // Holding something out in front; playing a game, the hands up on it.
        if (f.pose === 'holding') target.limbs.rightHand = new THREE.Vector3(-0.14, 0.5 + h * 0.3, 0.3);
        else if (f.pose === 'playing') { target.limbs.leftHand = new THREE.Vector3(0.12, 0.45 + h * 0.3, 0.3); target.limbs.rightHand = new THREE.Vector3(-0.12, 0.45 + h * 0.3, 0.3); }
        f.fruit.setBody(target.body); f.fruit.setLimbs(target.limbs, target.elbows);
      }
    },
    dispose() { for (const f of friends.values()) drop(f); friends.clear(); },
  };
}
