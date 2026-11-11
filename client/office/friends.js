// The other players in a meeting, as fruit in their own colour with a name tag, walking about the host's office (live.js
// brings their positions; office.js feeds them in). Built the first time they show up, disposed when they leave.
import * as THREE from 'three';
import { createFruit, LEG } from './fruit.js';
import { poseTargets } from './animation.js';
import { playerLook } from './meeting.js';
import { CHAIR, DESK, seatedAtBoss } from './boss-plan.js';

const SNAP = 3, RUNNING = 1.7;
const GAP = 1 / 15, PAUSE = 0.25, NEED_MAX = 0.35, RELAX = 0.02, WARP = 0.1, MARGIN = 0.01, DRIFT = 1e-3, KEEP = 16;

// One friend's moves, played back a little late at an even pace however the network bunches them: drawn between the two
// positions either side of a playback clock. Each move carries the sender's clock (`t`, ms; without it, when it came). The
// delay is the longest lately from one move to the next one's arrival (held at its peak, let go at 20 ms a second), and the
// playback clock speeds up or slows down by up to 10% rather than jump when that changes. With nothing newer yet it waits
// on the last place, then carries on from there. A pause (standing still) gets a stop just before the next move, so nobody
// drifts across it, and a jump of more than 3 m (the door) snaps. Times are in seconds; `at` writes into `out`, allocating nothing.
// A paper plane's moves (planes.js's flyers) carry its pitch and roll as well; a walker's are 0.
export function createTrack() {
  const samples = [];
  let offset = Infinity, need = GAP, clock = null, then = null;
  const copy = (out, s) => { out.x = s.x; out.y = s.y; out.z = s.z; out.yaw = s.yaw; out.pitch = s.pitch; out.roll = s.roll; out.pose = s.pose; return out; };
  return {
    heard(m, now) {
      const t = m.t === undefined ? now : m.t / 1000;
      let last = samples.at(-1);
      // Their clock went back, or a long silence: another page of theirs, or they were away. Start again.
      if (last && (t < last.t || t - last.t > 5)) { samples.length = 0; offset = Infinity; need = GAP; clock = null; last = undefined; }
      const d = last ? t - last.t : 0, pause = last && d >= PAUSE;
      if (last && d === 0) samples.pop(); // the same moment again: the newer wins
      else if (pause) samples.push({ ...last, t: t - GAP }); // still till just before this
      const before = samples.at(-1);
      samples.push({ t, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch ?? 0, roll: m.roll ?? 0, pose: m.pose });
      if (samples.length > KEEP) samples.shift();
      // The quickest a move has come (creeping up a little, as two machines' clocks drift), and how long this one took
      // from the one before it was due.
      offset = Math.min(offset + d * DRIFT, now - t);
      if (before) need = Math.min(NEED_MAX, Math.max(need, now - before.t - offset));
      // Waiting where they stood: anywhere up to this move is the same place, so the clock can skip the pause.
      if (pause && clock !== null && clock >= last.t) clock = Math.max(last.t, Math.min(t - GAP, now - offset - need - MARGIN));
    },
    at(now, out) {
      if (!samples.length) return null;
      const dt = then === null ? 0 : Math.max(0, now - then); then = now;
      need = Math.max(0, need - dt * RELAX);
      const want = now - offset - need - MARGIN;
      if (clock === null || Math.abs(want - clock) > 0.5) clock = want;
      else clock += dt + Math.max(-WARP * dt, Math.min(WARP * dt, want - clock - dt));
      clock = Math.min(clock, samples.at(-1).t);
      while (samples.length > 1 && samples[1].t <= clock) samples.shift();
      const a = samples[0], b = samples[1];
      if (!b || clock <= a.t) return copy(out, a); // before the first, or at the last: there
      if (Math.hypot(b.x - a.x, b.z - a.z) > SNAP) return copy(out, b);
      const u = (clock - a.t) / (b.t - a.t), turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
      out.x = a.x + (b.x - a.x) * u; out.y = a.y + (b.y - a.y) * u; out.z = a.z + (b.z - a.z) * u; out.yaw = a.yaw + turn * u; out.pose = a.pose;
      out.pitch = a.pitch + (b.pitch - a.pitch) * u; out.roll = a.roll + (b.roll - a.roll) * u;
      return out;
    },
  };
}
const ignored = () => {}, HAND = new THREE.Vector3(), HAND2 = new THREE.Vector3();

export const gait = speed => speed < 0.3 ? 'standing' : speed < 3 ? 'walking' : 'running';

// Who's drawn: everyone at the meeting but you.
export const atMeeting = (roster, me) => roster.filter(p => p.at === 'meeting' && p.id !== me);

// The name in their colour on a dark plate, drawn once per name (snakes.js puts it over their snake's head too).
export function tag(name, colour) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(244, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(20,20,24,0.78)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 14); g.fill();
  g.fillStyle = colour; g.fillText(name, 128, 33, 224);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// `clock`: seconds, the same for when a move's heard and when it's drawn. `hidden(id)`: they're shown some other way (as their snake).
export function createFriends(scene, { room, reducedMotion = () => false, clock = () => performance.now() / 1000, hidden = () => false }) {
  const friends = new Map(), tracks = new Map(); // tracks: everyone's moves, even before they're built (the roster and their move can arrive either way round)
  let time = 0;

  function build(p) {
    const look = playerLook(p.name, p.fruit, p.colour), fruit = createFruit(look), root = new THREE.Group();
    root.add(fruit.group); root.visible = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag(p.name, p.colour), transparent: true, toneMapped: false, depthWrite: false }));
    sprite.renderOrder = 4;
    sprite.scale.set(0.8, 0.2, 1); sprite.position.y = LEG + fruit.height + 0.22; root.add(sprite); // above the cap
    root.traverse(n => { n.raycast = ignored; }); // friends pass through each other and aren't clickable
    scene.add(root);
    return { id: p.id, name: p.name, look: `${p.fruit}${p.colour}`, fruit, root, sprite, seed: [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 7, at: { x: 0, y: 0, z: 0, yaw: 0, pose: 'standing' } };
  }
  function drop(f) { f.root.removeFromParent(); f.fruit.dispose(); f.sprite.material.map.dispose(); f.sprite.material.dispose(); }

  return {
    // `me` is your own id; `show` false (you're not at the meeting) shows nobody. Builds whoever just arrived, drops whoever left;
    // a new name or look is built again.
    sync(roster, me, show = true) {
      const here = new Map(show ? atMeeting(roster, me).map(p => [p.id, p]) : []);
      for (const id of tracks.keys()) if (!roster.some(p => p.id === id)) tracks.delete(id);
      for (const [id, f] of friends) {
        const p = here.get(id);
        if (!p || f.look !== `${p.fruit}${p.colour}`) { drop(f); friends.delete(id); }
        else if (f.name !== p.name) { f.name = p.name; f.sprite.material.map.dispose(); f.sprite.material.map = tag(p.name, p.colour); }
      }
      for (const [id, p] of here) if (!friends.has(id)) { const f = build(p); friends.set(id, f); f.root.visible = tracks.has(id) && !hidden(id); }
    },
    // A position message: where they are (feet on the floor), which way they face, what they're doing and when (`t`).
    move(id, m) {
      let track = tracks.get(id); if (!track) tracks.set(id, track = createTrack());
      track.heard(m, clock());
    },
    update(dt, now = time + dt) {
      time = now;
      const still = reducedMotion(), t = still ? 0 : time, when = clock();
      for (const f of friends.values()) {
        const at = tracks.get(f.id)?.at(when, f.at); if (!at) continue;
        f.placed = true;
        const h = f.fruit.height, pose = at.pose, run = pose === 'running', moving = run || pose === 'walking';
        // Playing at the boss's computer: sat in its chair at the keyboard, placed as Cast places a sitter (animation.js).
        const boss = pose === 'playing' && seatedAtBoss(at);
        const target = boss ? poseTargets('typing', t, f.seed, f.fruit) : poseTargets('walking', moving && !still ? t * (run ? RUNNING : 1) : 0, moving ? f.seed : 0, f.fruit);
        if (boss) { const facing = DESK.rotation, { x, z } = target; f.root.position.set(CHAIR.x + Math.cos(facing) * x + Math.sin(facing) * z, 0, CHAIR.z - Math.sin(facing) * x + Math.cos(facing) * z); f.root.rotation.y = facing; }
        else { f.root.position.set(at.x, at.y, at.z); f.root.rotation.y = at.yaw; }
        // Out as their snake, or in a shut room behind its wall.
        const p = f.root.position; f.root.visible = !hidden(f.id) && !(room.kitchen.inside(p) && !room.kitchen.shown) && !(room.secret.inside(p) && !room.secret.shown);
        if (!f.root.visible) continue;
        if (run) target.body.lean = 0.15;
        // Holding something out in front; playing a game, the hands up on it.
        if (pose === 'holding') target.limbs.rightHand = HAND.set(-0.14, 0.5 + h * 0.3, 0.3);
        else if (pose === 'playing' && !boss) { target.limbs.leftHand = HAND.set(0.12, 0.45 + h * 0.3, 0.3); target.limbs.rightHand = HAND2.set(-0.12, 0.45 + h * 0.3, 0.3); }
        f.fruit.setBody(target.body); f.fruit.setLimbs(target.limbs, target.elbows);
      }
    },
    // Where each friend with a position stands, shown or not, for the goose. `busy`: playing a game, or in the kitchen (it keeps
    // off them); `pose` as they sent it, so office.js can tell who's at the boss's computer.
    positions() { return [...friends.values()].filter(f => f.placed).map(f => ({ id: f.id, x: f.at.x, z: f.at.z, busy: f.at.pose === 'playing' || room.kitchen.inside(f.root.position), pose: f.at.pose })); },
    dispose() { for (const f of friends.values()) drop(f); friends.clear(); tracks.clear(); },
  };
}
