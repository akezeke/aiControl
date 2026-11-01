// One project's battle: its own scene and camera, kept in step with the sessions. Everything that happens here answers something that really happened; time only decides how it looks.
import * as THREE from 'three';
import { clamp, mix, newShared, raw } from './rig.js';
import { POSE, makeCharacter, setPose } from './characters.js';
import { makeEnemy, makeHourglass, makeMinion } from './enemies.js';
import { abilityOf, deliver, actionWords } from './abilities.js';
import { FOV, PARTY_VIEW, PITCH, fit, homeView, spotsFor, spriteBox } from './camera.js';
import { Effects, flareMap, labelTexture, bubbleTexture } from './fx.js';
import { lightOf, glowOf } from './places.js';
import { ENEMY_LINE, busy, formation, hasTurn, needsYou, resting, tokens } from './roster.js';

const OVERHEAD = 3.2, YELLOW = 0xffc738, RED = 0xff5a4d, GREEN = 0x6fe39a, TEAL = 0x56c2a6, POSE_STEP = 1 / 15, MAX_MINIONS = 3;
const SLOTS = [[-.8, .9], [.05, 1.3], [-1.45, .4]], FINALE = { step: .55, charge: 1.75, blow: 3.2, dur: 4.4 };
const smoothRange = (x, a, b) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const halfOf = enemy => Math.max(.8, (enemy?.h ?? 0) * .7);
const MARK_SIZE = 1.36; // Of a bubble's height, per unit of the mark's own size.
const MARKS = { permission: ['READY!', '#ffc738', .55], question: ['?', '#ffc738', .85], done: ['DONE', '#f3ead2', .44], error: ['ERROR', '#ff5a4d', .46], idle: ['Zzz', '#d4d6b8', .4] };

// What every fight shares: the blob under everyone and the marker over whoever matters.
export function createProps() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d'), gradient = context.createRadialGradient(48, 48, 12, 48, 48, 48);
  gradient.addColorStop(0, '#000000e0'); gradient.addColorStop(.72, '#00000099'); gradient.addColorStop(1, '#00000000');
  context.fillStyle = gradient; context.fillRect(0, 0, 96, 96);
  const shadow = new THREE.CanvasTexture(canvas); shadow.colorSpace = THREE.NoColorSpace;
  const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), cone = new THREE.ConeGeometry(.2, .4, 4).rotateX(Math.PI), ring = new THREE.RingGeometry(.9, 1, 32).rotateX(-Math.PI / 2), band = new THREE.RingGeometry(.76, 1, 32).rotateX(-Math.PI / 2);
  return { shadow, disc, cone, ring, band, dispose() { shadow.dispose(); disc.dispose(); cone.dispose(); ring.dispose(); band.dispose(); } };
}

const motesOf = (place, count = 40) => {
  const points = [];
  for (let i = 0; i < count; i++) points.push((Math.random() - .5) * 30, Math.random() * 7.5, (Math.random() - .5) * 22);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const motes = new THREE.Points(geometry, new THREE.PointsMaterial({ color: glowOf(place), size: .2, map: flareMap(), transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  motes.frustumCulled = false; motes.renderOrder = 3;
  return motes;
};

export class Fight {
  perRank = 5; roomy = true; members = new Map(); enemies = []; spots = []; partySpots = []; count = -1; started = false; t = Math.random() * 40; dark = 0; darkT = 0; hitstop = 0; cine = null; user = null; zoom = 1; zoomGoal = 1; view = null; hoverId = null; aim = new THREE.Vector3(); pose = new THREE.Vector3();
  // `stage`: { plates, props, look, calm, low(), announce(fight, member, ability), isZoomed(fight) }.
  constructor(data, stage) {
    this.stage = stage; this.project = data.project; this.place = data.place; this.time = data.time; this.data = data; this.next = data;
    this.scene = new THREE.Scene();
    this.shared = newShared(stage.look, lightOf(data.place, data.time));
    this.plates = stage.plates.dress(this.scene, data.place, stage.low(), data.time);
    this.fx = new Effects(this.scene, stage.calm); this.fx.low = stage.low;
    this.camera = new THREE.PerspectiveCamera(FOV, 1.5, .2, 600);
    this.motes = motesOf(data.place); this.scene.add(this.motes);
    this.taken = new Set();
    this.cursor = new THREE.Mesh(stage.props.cone, new THREE.MeshBasicMaterial({ color: raw(0xf3ead2), toneMapped: false })); this.cursor.visible = false; this.scene.add(this.cursor);
  }
  // Applied on the next frame this fight is drawn, so fights nobody can see build nothing.
  sync(data) { this.data = data; this.next = data; if (data.place !== this.place || data.time !== this.time) this.moveTo(data.place, data.time); }
  // Another project took this one's place: the same fight, on the field it likes next.
  moveTo(place, time) {
    this.place = place; this.time = time;
    this.scene.remove(this.plates.back, this.plates.floor); this.plates.back.material.dispose(); this.plates.floor.material.dispose();
    this.plates = this.stage.plates.dress(this.scene, place, this.stage.low(), time);
    const light = lightOf(place, time);
    for (const [uniform, key] of [['uFog', 'fog'], ['uSun', 'sun'], ['uSky', 'sky'], ['uBounce', 'bounce']]) this.shared[uniform].value.copy(raw(light[key]));
    this.shared.uSunDir.value.set(...light.dir); this.motes.material.color.copy(glowOf(place));
  }

  shadow(radius) {
    const mesh = new THREE.Mesh(this.stage.props.disc, new THREE.MeshBasicMaterial({ map: this.stage.props.shadow, transparent: true, depthWrite: false, toneMapped: false, opacity: .85 }));
    mesh.scale.setScalar(radius); mesh.position.y = .03; mesh.renderOrder = 0; this.scene.add(mesh);
    return mesh;
  }
  // A ring on the ground under everyone who can be picked: faint always, bright when pointed at or open.
  spot(mesh, position, radius, id, calm) {
    const hot = this.hoverId === id || this.stage.selected?.() === id;
    if (mesh.hot !== hot) { mesh.hot = hot; mesh.geometry = this.stage.props[hot ? 'band' : 'ring']; mesh.material.opacity = hot ? 1 : .38; mesh.material.color.setHex(hot ? 0xfff4c4 : 0xf3ead2, THREE.LinearSRGBColorSpace); }
    mesh.position.set(position.x, .07, position.z); mesh.scale.setScalar(radius * (hot && !calm ? 1.04 + Math.sin(this.t * 5) * .04 : 1));
  }
  newSpot() {
    const mesh = new THREE.Mesh(this.stage.props.ring, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: .38, color: raw(0xf3ead2), toneMapped: false }));
    mesh.renderOrder = 2; mesh.hot = false; this.scene.add(mesh);
    return mesh;
  }
  label(text, color, height) {
    const { texture, aspect } = labelTexture(text, color), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.scale.set(height * aspect, height, 1); sprite.renderOrder = 20; sprite.base = height; sprite.ratio = aspect; this.scene.add(sprite);
    return sprite;
  }
  bubble(words) {
    const { texture, aspect } = bubbleTexture(words), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.center.set(.5, 0); sprite.renderOrder = 19; sprite.ratio = aspect; this.scene.add(sprite);
    return sprite;
  }
  wordsOf(member) {
    const { state } = member, wide = this.roomy && this.stage.isZoomed(this);
    if (member.leaving) return '';
    if (state === 'compacting') return 'Compacting';
    if (state === 'thinking') return 'Thinking';
    if (state === 'working') return actionWords(member.line || 'Working', wide);
    if (state === 'waiting') return actionWords(member.data.job || 'Waiting', wide);
    return '';
  }
  drop(thing) { if (!thing) return; this.scene.remove(thing); thing.material?.dispose?.(); }

  reconcile(data) {
    const ids = new Set(data.members.map(member => member.id));
    for (const member of this.members.values()) if (!ids.has(member.id) && !member.leaving) this.leave(member);
    this.count = data.members.length;
    const { party } = formation(this.count, [], data.members.map(d => resting(d.state)), this.perRank);
    data.members.forEach((d, i) => {
      let member = this.members.get(d.id);
      if (member?.leaving) { this.remove(member); member = null; }
      const fresh = !member;
      if (fresh) member = this.join(d, party[i]);
      member.home.set(...party[i]);
      this.receive(member, d, fresh);
    });
    this.placed = data; this.spreadFoes(data);
    this.started = true;
  }
  // Everyone on the enemy line gets the room they and their lessers need, and the camera takes in what that comes to.
  spreadFoes(data) {
    const members = data.members.map(d => this.members.get(d.id));
    const widths = members.map(member => this.arrange(member)), back = data.members.map(d => resting(d.state)), shape = formation(this.count, widths, back, this.perRank), key = `${widths.join()}|${back.join()}|${this.perRank}`;
    if (key !== this.shape) { this.shape = key; this.spots = spotsFor(shape); this.partySpots = spotsFor({ party: shape.party, enemies: [], tall: 4.1 }); /* Room for what's over their heads. */ }
    // Whoever's busy stands a step ahead of the line.
    members.forEach((member, i) => { member.foe.set(...shape.enemies[i]); member.home.set(...shape.party[i]); if (busy(data.members[i].state)) member.home.x -= .8; });
    for (const enemy of this.enemies) if (enemy.owner && !enemy.dying) {
      if (!enemy.placed) { enemy.placed = true; enemy.at.set(enemy.owner.foe.x + enemy.offset[0], 0, enemy.owner.foe.z + enemy.offset[1]); enemy.rig.root.position.copy(enemy.at); }
    }
  }
  // Lessers stand to either side of their main enemy, along the line and a little forward. Returns how much of the line that takes.
  arrange(member) {
    if (!this.mainOf(member) && !this.lessersOf(member).length) return 0;
    const near = halfOf(this.mainOf(member)), reach = [near, near];
    for (const enemy of this.lessersOf(member)) {
      const side = enemy.index % 2, half = halfOf(enemy), along = (side ? -1 : 1) * (reach[side] + half);
      enemy.offset = [ENEMY_LINE[0] * along + .8, ENEMY_LINE[1] * along]; reach[side] += half * 2;
    }
    return 2 * Math.max(reach[0], reach[1]) + .6;
  }

  join(d, at) {
    const char = makeCharacter(d, this.scene, this.shared, this.taken); char.rig.show(true);
    const member = { id: d.id, data: d, char, aura: char.aura, rig: char.rig, home: new THREE.Vector3(...at), foe: new THREE.Vector3(), minions: new Map(), shadow: this.shadow(1.05 * char.tall), flash: 0, poseClock: 0, phase: Math.random() * 6.28, act: null, pending: null, line: '', again: .4 + Math.random() * 2, foeIn: 2 + Math.random() * 5, hurt: 0, on: busy(d.state) ? 1 : 0, leaving: false };
    // Light on the ground under whoever's busy: the first thing to look for in a crowded fight.
    member.pool = new THREE.Mesh(this.stage.props.disc, new THREE.MeshBasicMaterial({ map: flareMap(), color: raw(char.aura), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    member.halo = new THREE.Mesh(this.stage.props.ring, new THREE.MeshBasicMaterial({ color: raw(char.aura), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
    member.pool.renderOrder = member.halo.renderOrder = 1; this.scene.add(member.pool, member.halo); member.spot = this.newSpot();
    char.rig.root.rotation.y = -Math.PI / 2; char.rig.root.position.copy(member.home);
    this.members.set(d.id, member);
    if (this.started && !this.stage.calm) this.fx.dropIn(char.rig.root.position.clone().setY(1.2), char.aura);
    return member;
  }
  leave(member) {
    member.leaving = true; member.act = null; member.pending = null; member.state = 'ended'; this.clearMarks(member); this.endTurn(member, true);
    for (const minion of member.minions.values()) minion.leaving = true;
  }
  remove(member) {
    this.clearMarks(member); member.char.rig.dispose(); this.drop(member.shadow); this.drop(member.extra); this.drop(member.pool); this.drop(member.halo); this.drop(member.spot); this.drop(member.bubble);
    for (const minion of member.minions.values()) this.removeMinion(minion);
    for (const enemy of this.enemies) if (enemy.owner === member) { enemy.owner = null; enemy.dying = true; }
    this.members.delete(member.id);
  }

  // A new snapshot against what this member last did. A fresh one takes its state silently: nothing happened, we just arrived.
  receive(member, d, fresh) {
    const calm = this.stage.calm, used = d.hp?.used ?? null;
    member.data = d;
    if (fresh) {
      member.state = d.state; member.stateAt = Date.now(); member.turn = d.turn; member.used = used; member.doneSteps = d.plan?.done ?? 0; member.toolId = d.tool?.id; member.seen = d.detail; member.line = d.state === 'working' ? d.detail : '';
      this.enter(member, d.state, true); this.syncMinions(member, d, true); setPose(member.char.rig.J, POSE[this.poseKey(member)], 1);
      return;
    }
    const turnChanged = d.turn !== member.turn; member.turn = d.turn;
    if (d.state !== member.state) { member.state = d.state; member.stateAt = Date.now(); this.enter(member, d.state, false); }
    else if (turnChanged && hasTurn(d.state)) this.ensureTurn(member, false);
    else if (hasTurn(d.state)) this.syncLessers(member, false);
    // HP moves only by what the session really spent or got back.
    if (used != null && member.used != null) {
      const spent = used - member.used, top = member.char.rig.root.position.clone().setY(2.5);
      if (spent >= 100) {
        // The number lands with the blow that carries it; only what the session really spent ever shows.
        const land = () => { const at = member.char.rig.root.position.clone().setY(2.5); this.fx.number(at, `-${tokens(spent)}`, '#ff8a7a', .5); member.flash = .8; member.hurt = .4; if (!calm) { member.char.rig.root.position.x += .7; this.fx.flare(at.setY(1.3), RED, 2.4, .25); this.fx.burst(at, RED, 8, 3.2); this.jolt(.2); } };
        const foe = this.mainOf(member);
        if (foe && !calm && !foe.attack && !foe.dying) this.foeAttack(foe, member, land); else land();
      } else if (spent <= -100) this.fx.number(top, `+${tokens(-spent)}`, '#6fe39a', .8);
    }
    if (used != null) member.used = used;
    // A finished plan step takes one of the small ones with it.
    const done = d.plan?.done ?? 0;
    if (done > member.doneSteps) this.syncLessers(member, false);
    member.doneSteps = done;
    // A new tool line is a new attack; only the newest ever waits.
    member.line = d.state === 'working' ? d.detail : '';
    if (d.detail !== member.seen) { member.seen = d.detail; if (d.state === 'working' && d.detail) member.pending = d.detail; }
    // "Miss!" is only ever a tool call that really failed.
    if (d.tool?.id !== member.toolId) {
      member.toolId = d.tool?.id;
      if (d.tool?.failed) this.miss(member);
    }
    this.syncMinions(member, d, false);
  }

  mainOf(member) { return this.enemies.find(enemy => enemy.owner === member && enemy.main && !enemy.dying && !enemy.doomed); }
  lessersOf(member) { return this.enemies.filter(enemy => enemy.owner === member && !enemy.main && !enemy.dying && !enemy.doomed); }
  spawn(member, main, index, born) {
    const d = member.data, soldier = d.family === 'soldier', size = main ? 1 : soldier ? .95 : .55;
    const enemy = makeEnemy(`${member.id}:${d.turn}${main ? '' : `:s${index}`}`, d.family, this.scene, this.shared, size);
    enemy.rig.show(true); enemy.rig.root.rotation.y = Math.PI / 2; enemy.owner = member; enemy.main = main; enemy.turn = d.turn; enemy.offset = [0, 0]; enemy.index = index;
    enemy.at = new THREE.Vector3(member.foe.x + enemy.offset[0], 0, member.foe.z + enemy.offset[1]); enemy.rig.root.position.copy(enemy.at); enemy.born = born;
    enemy.shadow = this.shadow(Math.max(.7, Math.min(2.1, enemy.h * .5))); this.enemies.push(enemy);
    return enemy;
  }
  ensureTurn(member, fresh) {
    const main = this.mainOf(member);
    if (main && main.turn !== member.turn) this.endTurn(member, false);
    if (!this.mainOf(member)) this.spawn(member, true, 0, fresh ? 1 : 0);
    this.syncLessers(member, fresh);
  }
  syncLessers(member, fresh) {
    const plan = member.data.plan, most = this.count <= 2 ? 3 : this.count <= 4 ? 2 : 1, want = plan ? Math.min(most, Math.max(0, plan.total - plan.done - 1)) : 0, have = this.lessersOf(member);
    for (let i = want; i < have.length; i++) {
      const enemy = have[i]; enemy.dying = true;
      if (this.stage.calm) continue;
      const at = enemy.rig.root.position.clone().setY(enemy.h * .5); this.fx.flare(at, 0xffe9b0, 3, .4); this.fx.burst(at, 0xffb060, 12, 3.6); this.fx.shock(at, 0xffb060, 2.6);
    }
    for (let i = have.length; i < want; i++) this.spawn(member, false, i, fresh ? 1 : 0);
  }
  endTurn(member, quiet) {
    // A final blow already under way brings its own enemies down.
    if (quiet) member.finale = null;
    for (const enemy of this.enemies) if (enemy.owner === member && !enemy.dying && (quiet || !enemy.doomed)) {
      enemy.dying = true;
      if (!quiet && !this.stage.calm && enemy.main && enemy.born >= 1) this.fx.finish(enemy, 0xff6a3d, () => this.members.has(member.id));
    }
  }
  // The turn ended, so its enemy gets one last attack, a short scene of its own: they step out and charge up close, and the blow goes off as the camera pulls back to take in both. Only that brings the enemy down. It stands for the real end of a turn, so it says so.
  finalBlow(member, main) {
    const root = member.char.rig.root.position, cls = member.data.cls, kind = cls === 'sage' ? 'spell' : cls === 'gunner' ? 'shots' : 'blades', from = root.clone(), spot = from.clone();
    spot.add(main.at.clone().sub(from).setY(0).setLength(1.9));
    const finale = member.finale = { t: 0, kind, enemy: main, landed: false, from, spot };
    // Whatever they were up to, they're back on their spot for it.
    for (const enemy of this.enemies) if (enemy.owner === member && !enemy.dying) { enemy.doomed = true; enemy.attack = null; }
    this.stage.announce(this, member, { name: 'Final Blow', line: `${member.data.title} is done`, dur: FINALE.dur - .4, big: true, final: true });
    if (!this.stage.isZoomed(this)) this.fx.number(spot.clone().setY(3.3 * member.char.tall), 'FINAL BLOW', '#ffc738', .8);
    this.darkT = FINALE.dur - .3; this.darkLevel = .7;
    // Two turns ending together: the first keeps the camera.
    if (!this.user && !this.cine?.finale) this.cine = { t: 0, dur: FINALE.dur, finale, tall: member.char.tall, h: main.h };
    this.fx.finaleCharge(member, spot, member.aura, member.char.tall, FINALE.step, FINALE.charge - FINALE.step);
    this.fx.finaleBlow(kind, member, spot, main, member.aura, FINALE.charge, FINALE.blow, () => { if (member.finale === finale) this.finalLands(member, finale); });
  }
  finalLands(member, finale) {
    finale.landed = true; this.hitstop = .16; this.jolt(.9);
    for (const enemy of this.enemies) if (enemy.owner === member && enemy.doomed && !enemy.dying) {
      enemy.dying = true; enemy.flash = 1; enemy.kick = 1;
      if (enemy.main) this.fx.finish(enemy, member.aura, () => this.members.has(member.id));
      else { const at = enemy.rig.root.position.clone().setY(enemy.h * .5); this.fx.flare(at, member.aura, 3, .4); this.fx.burst(at, member.aura, 12, 3.6); }
    }
  }
  // A new turn doesn't wait for the old one's scene to finish.
  cutFinale(member) {
    if (!member.finale) return;
    if (!member.finale.landed) this.finalLands(member, member.finale);
    if (this.cine?.finale === member.finale) this.cine = null;
    member.finale = null;
  }

  clearMarks(member) { this.drop(member.mark); member.mark = null; this.drop(member.pointer); member.pointer = null; if (member.glass) { member.glass.dispose(); member.glass = null; } }
  dressMarks(member, state) {
    this.clearMarks(member);
    const mark = MARKS[state];
    if (mark) member.mark = this.label(...mark);
    if (needsYou(state)) { member.pointer = new THREE.Mesh(this.stage.props.cone, new THREE.MeshBasicMaterial({ color: raw(YELLOW), toneMapped: false })); this.scene.add(member.pointer); }
    if (state === 'waiting') { member.glass = makeHourglass(this.scene, this.shared); member.glass.show(true); }
  }
  // Words were drawn before the font arrived.
  relabel() { for (const member of this.members.values()) if (!member.leaving) { this.dressMarks(member, member.state); this.syncExtra(member); member.words = null; } }

  enter(member, state, fresh) {
    const calm = this.stage.calm, root = member.char.rig.root.position;
    if (state !== 'working') { member.act = null; member.pending = null; }
    this.dressMarks(member, state);
    const finishing = !fresh && !calm && (state === 'done' || state === 'idle') ? this.mainOf(member) : null;
    if (hasTurn(state)) { this.cutFinale(member); this.ensureTurn(member, fresh); }
    else if (finishing && finishing.born >= 1) this.finalBlow(member, finishing);
    else this.endTurn(member, fresh || state === 'offline');
    if (fresh) return;
    if (state === 'compacting') { member.cureIn = 1.6; this.stage.announce(this, member, { name: 'Compacting', line: '', dur: 2.4, big: true }); }
    if (calm) return;
    if (state === 'compacting') {
      this.darkT = 1.8; this.darkLevel = .45; this.fx.flash(GREEN, .16); this.fx.cure(root, member.char.tall); this.fx.flare(root.clone().setY(1.4), GREEN, 3.6, .9);
      for (let i = 0; i < 4; i++) this.fx.after(i * .22, () => this.fx.gather(member.char.rig.root.position.clone().setY(2.4), 0xb4ffd0, 8, .6));
    } else if (needsYou(state)) { this.fx.flare(root.clone().setY(2.8), YELLOW, 3.4, .5); this.fx.shock(root, YELLOW, 2.2); }
    else if (state === 'error') { this.fx.flash(RED, .18); this.fx.burst(root.clone().setY(1.2), RED, 16, 3.8); this.fx.jolt(.5); }
  }

  syncMinions(member, d, fresh) {
    const wanted = d.minions.slice(0, MAX_MINIONS), ids = new Set(wanted.map(minion => minion.id));
    for (const minion of member.minions.values()) if (!ids.has(minion.id)) minion.leaving = true;
    wanted.forEach((data, slot) => {
      let minion = member.minions.get(data.id);
      if (!minion) {
        minion = makeMinion(data.kind, data.id, this.scene, this.shared); minion.rig.show(true); minion.id = data.id; minion.rig.root.rotation.y = -Math.PI / 2; minion.shadow = this.shadow(.42); minion.spot = this.newSpot(); minion.seen = data.detail; minion.drop = fresh || !this.started ? 0 : 1;
        member.minions.set(data.id, minion);
        if (minion.drop && !this.stage.calm) { const at = member.char.rig.root.position.clone(); at.x += SLOTS[slot][0]; at.z += SLOTS[slot][1]; this.fx.dropIn(at.setY(1), member.aura); }
      }
      minion.slot = slot; minion.data = data;
      if (data.detail !== minion.seen) {
        minion.seen = data.detail;
        const foe = this.mainOf(member);
        if (data.detail && foe && !this.stage.calm) this.fx.dart(minion.rig.root.position.clone(), foe.rig.root.position.clone().setY(foe.h * .55), abilityOf(data.detail).color);
      }
    });
    this.syncExtra(member);
  }
  // More minions than fit beside their owner read as a count.
  syncExtra(member) {
    const count = member.data.minions.length; this.drop(member.extra); member.extra = null;
    if (count > MAX_MINIONS) member.extra = this.label(`×${count}`, '#f3ead2', .36);
  }
  removeMinion(minion) { minion.rig.dispose(); this.drop(minion.shadow); this.drop(minion.spot); }

  start(member, plain) {
    const enemy = this.mainOf(member) || this.lessersOf(member)[0], ability = deliver(plain, member.data.cls);
    if (!enemy && !ability.summon) return;
    member.act = { ability, t: 0, enemy, landed: false };
    const root = member.char.rig.root.position;
    if (!this.stage.calm) {
      if (ability.cast) {
        const hands = root.clone().setY(2.5 * member.char.tall);
        this.fx.circle(root, ability.color, ability.dur * .85, ability.big ? 2.4 : 1.7); this.fx.charge(hands, ability.color, ability.dur * .38, ability.big ? 2.2 : 1.3); this.fx.gather(root.clone().setY(1.5), ability.color, ability.big ? 26 : 11, ability.dur * .4);
      }
      if (ability.big || ability.summon) {
        this.darkT = ability.dur + .5; this.darkLevel = ability.big ? .7 : .45;
        if (this.stage.isZoomed(this) && !this.user && !this.cine?.finale) this.cine = { t: 0, dur: ability.dur + .35, target: (ability.summon || !enemy ? root : enemy.rig.root.position).clone(), side: ability.summon ? -1 : 1, around: ability.summon ? Math.PI / 2 : 0 };
      }
    }
    this.stage.announce(this, member, ability);
  }
  impact(member, act) {
    const { ability, enemy } = act, lessers = this.lessersOf(member), main = enemy && !enemy.dying ? enemy : null, target = ability.melee && lessers.length && Math.random() < .35 ? lessers[0] : main, calm = this.stage.calm;
    const to = target ? target.rig.root.position.clone().setY(target.h * .55) : member.char.rig.root.position.clone().setY(1.3);
    // A spell hurts when it gets there, not when it leaves.
    const land = () => {
      if (!ability.hit || !target) return;
      target.flash = .9; target.kick = 1;
      if (!calm) { this.hitstop = ability.big ? .14 : .06; if (!ability.big) this.fx.burst(to, ability.color, 6, 2.8); }
    };
    if (calm) land(); else this.fx.move(ability, member, target, to, land);
  }
  // An enemy's turn: a charge across the field or a shot from where it stands. `land` is what the blow carries, or nothing and the member just takes it on the guard.
  foeAttack(enemy, member, land) {
    enemy.attack = { t: 0, dur: enemy.spits ? 1 : 1.05, target: member, land, landed: false };
    if (enemy.spits) { const at = enemy.rig.root.position; this.fx.circle(at, enemy.glow, .8, 1.3); this.fx.charge(at.clone().setY(enemy.h * .8), enemy.glow, .42, 1.1); }
  }
  foeLands(enemy) {
    const { target: member, land } = enemy.attack, root = member.char.rig.root.position;
    if (member.leaving) return;
    if (land) return land();
    const at = root.clone().setY(1.5); this.fx.flare(at, 0xffffff, 1.8, .18); this.fx.burst(at, 0xfff4d0, 5, 2.6); root.x += .22; member.hurt = .12;
  }
  jolt(amount) { if (this.stage.isZoomed(this)) this.fx.jolt(amount); }
  miss(member) {
    const enemy = this.mainOf(member), at = enemy ? enemy.rig.root.position.clone().setY(enemy.h + .35) : member.char.rig.root.position.clone().setY(2.8);
    this.fx.number(at, 'Miss!', '#f3ead2', .56);
    this.stage.announce(this, member, { name: 'Miss!', line: member.data.detail, dur: 1 });
    if (enemy) enemy.dodge = 1;
  }

  poseKey(member) {
    if (member.finale) {
      const { t, kind, landed } = member.finale;
      if (landed) return 'done';
      if (t < FINALE.step) return (t * 7.5 | 0) % 2 ? 'stepR' : 'stepL';
      if (t < FINALE.charge) return kind === 'shots' ? 'aim' : kind === 'spell' ? 'cast' : 'gather';
      return kind === 'blades' ? (t * 5.5 | 0) % 2 ? 'strike' : 'windup' : kind === 'spell' ? 'release' : 'aim';
    }
    if (member.hurt > 0) return 'hurt';
    if (member.act) { const { ability, t } = member.act, u = t / ability.dur; return ability.melee ? u < .3 ? 'windup' : u < .62 ? 'strike' : 'stance' : member.data.cls === 'gunner' ? 'aim' : u < .78 ? 'cast' : 'stance'; }
    switch (member.state) {
      case 'working': return member.data.hp && member.data.hp.ratio < .1 ? 'hurt' : member.data.cls === 'gunner' ? 'aim' : 'stance';
      case 'thinking': return 'think';
      case 'compacting': return 'cast';
      case 'idle': return 'ko';
      case 'permission': case 'question': return 'ready';
      case 'waiting': return 'wait';
      case 'done': return 'done';
      case 'error': return 'kneel';
      default: return 'stance';
    }
  }

  stepMember(member, dt) {
    const calm = this.stage.calm, char = member.char, rig = char.rig, u = rig.u, root = rig.root.position, t = this.t, state = member.state, working = state === 'working';
    if (working && !member.leaving) {
      if (member.act) {
        const act = member.act, ability = act.ability, before = act.t; act.t += dt;
        const hitAt = ability.melee ? .36 : .38;
        if (!act.landed && before / ability.dur < hitAt && act.t / ability.dur >= hitAt) { act.landed = true; this.impact(member, act); }
        if (act.t >= ability.dur) member.act = null;
      } else if (member.pending) {
        const line = member.pending; member.pending = null; member.again = 3 + Math.random() * 3; this.start(member, abilityOf(line));
      } else if (!calm && member.line) {
        // Still on the same tool: it keeps swinging, but a summon or a big spell happens once.
        member.again -= dt;
        if (member.again <= 0) { member.again = 3 + Math.random() * 3; const ability = abilityOf(member.line); if (!ability.big && !ability.summon) this.start(member, ability); }
      }
    }
    // Enemies take their turns while a member's busy with them; these carry no number, nothing was really lost.
    member.hurt = Math.max(0, member.hurt - dt);
    if (!calm && busy(state) && state !== 'compacting' && !member.act && !member.leaving) {
      member.foeIn -= dt;
      if (member.foeIn <= 0) {
        member.foeIn = 4 + Math.random() * 5;
        const foes = this.enemies.filter(enemy => enemy.owner === member && !enemy.dying && !enemy.doomed && !enemy.attack && enemy.born >= 1), foe = foes[Math.random() * foes.length | 0];
        if (foe) this.foeAttack(foe, member, null);
      }
    }
    // Offline is turned to stone mid-stance: nothing moves.
    if (state !== 'offline') {
      member.poseClock += dt;
      if (this.shared.uLook.value > .5 || member.poseClock >= POSE_STEP) {
        const step = member.poseClock; member.poseClock = 0;
        setPose(rig.J, POSE[this.poseKey(member)], calm ? 1 : 1 - Math.exp(-step * (member.act || member.finale ? 22 : 9)));
        if (!calm && rig.J.torso) rig.J.torso.position.y = .06 + (busy(state) ? Math.sin(t * 3.4 + member.phase) * .04 : needsYou(state) ? Math.sin(t * 2.4 + member.phase) * .018 : 0);
      }
      if (rig.J.cape && !calm) rig.J.cape.rotation.x = char.cape + Math.sin(t * 3.4 + member.phase) * .08 + (member.act?.ability.melee ? .6 : 0);
    }
    member.flash = Math.max(0, member.flash - dt * 5);
    u.uFlash.value = member.flash; u.uFlashCol.value.setHex(RED, THREE.LinearSRGBColorSpace);
    const ease = 1 - Math.exp(-dt * 6);
    u.uGrey.value = mix(u.uGrey.value, state === 'offline' ? 1 : state === 'idle' ? .55 : 0, ease); u.uDim.value = mix(u.uDim.value, state === 'idle' ? .8 : state === 'error' ? .25 : 0, ease);
    const berserk = member.data.mode === 'berserk' && state !== 'offline', pulse = calm ? 0 : Math.sin(t * 5) * .08;
    if (state === 'error') u.uTint.value.setRGB(1, .7, .68); else if (berserk) u.uTint.value.setRGB(1, .68 + pulse, .62 + pulse); else u.uTint.value.setRGB(1, 1, 1);
    u.uDissolve.value = member.leaving ? clamp(u.uDissolve.value + dt * 1.3) : 0;

    // A melee move runs out and back; everything else stands at home.
    const act = member.act, finale = member.finale;
    if (finale) { finale.t += dt; if (finale.t >= FINALE.dur) member.finale = null; }
    // They face what they're hitting, or the other side of the field when they aren't.
    const facing = finale && !calm ? finale.enemy : act?.enemy, turn = facing ? Math.atan2(facing.at.x - root.x, facing.at.z - root.z) : -Math.PI / 2;
    const swing = ((turn - rig.root.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    rig.root.rotation.y += swing * (calm ? 1 : 1 - Math.exp(-dt * 10));
    if (finale && member.finale && !calm) {
      // Out of the line in a few steps, and they stay there for the scene. Blades go on in and cut back and forth across the enemy's near side, where the camera still sees them, and come back as it falls.
      const out = smoothRange(finale.t, 0, FINALE.step), dash = finale.kind === 'blades' && !finale.landed ? clamp((finale.t - FINALE.charge - .2) / .25) : 0;
      if (dash > 0) {
        const there = finale.enemy.at, a = finale.t * 8;
        root.x = mix(finale.spot.x, there.x + Math.cos(a) * 1.6, dash); root.z = mix(finale.spot.z, there.z + 1 + Math.sin(a) ** 2 * .6, dash); root.y = dash * (.5 + Math.abs(Math.sin(a * .5)) * 1.5);
      } else if (finale.landed) root.lerp(finale.spot, 1 - Math.exp(-dt * 9));
      else {
        const shake = finale.t > FINALE.step && finale.t < FINALE.charge ? Math.sin(t * 60) * .012 * (finale.t / FINALE.charge) : 0;
        root.x = mix(finale.from.x, finale.spot.x, out) + shake; root.z = mix(finale.from.z, finale.spot.z, out) + shake; root.y = Math.abs(Math.sin(out * Math.PI * 2)) * .06;
      }
    } else if (act?.ability.melee && act.enemy && !calm) {
      const q = act.t / act.ability.dur, there = act.enemy.rig.root.position, out = clamp(q / .3), back = clamp((q - .62) / .38), v = out * (1 - back);
      root.x = mix(member.home.x, there.x + 1.5, v); root.z = mix(member.home.z, there.z, v); root.y = Math.sin(v * Math.PI) * .9 * (1 - back * .3);
      if (v > .02 && v < .98 && Math.random() < .7) this.fx.burst(root.clone().setY(root.y + 1), member.aura, 1, .5);
    } else if (calm) root.copy(member.home);
    // A knock is over in a moment; walking to another row takes a little while.
    else root.lerp(member.home, 1 - Math.exp(-dt * (root.distanceToSquared(member.home) > 1.2 ? 2.8 : 12)));
    member.shadow.position.set(root.x, .03, root.z); member.shadow.material.opacity = .85 * (1 - u.uDissolve.value);
    member.spot.visible = !member.leaving; this.spot(member.spot, root, 1.12 * char.tall, member.id, calm);
    member.on = mix(member.on, busy(state) && !member.leaving ? 1 : 0, ease);
    const lit = member.on * (calm ? .8 : .78 + Math.sin(t * 4.2 + member.phase) * .22), size = 1.75 * char.tall;
    member.pool.visible = member.halo.visible = member.on > .02;
    member.pool.position.set(root.x, .05, root.z); member.pool.scale.setScalar(size * 1.35); member.pool.material.opacity = lit * .85;
    member.halo.position.set(root.x, .06, root.z); member.halo.scale.setScalar(size * (calm ? .9 : .85 + (t * .7 + member.phase) % 1 * .25)); member.halo.material.opacity = lit;

    const top = OVERHEAD * char.tall, bob = calm ? 0 : Math.sin(t * 4) * .05;
    const headline = state === 'error' ? 2.6 : state === 'idle' ? 1.15 : top;
    if (member.pointer) { member.pointer.position.set(root.x, top + (calm ? 0 : Math.abs(Math.sin(t * 5)) * .16), root.z); if (!calm) member.pointer.rotation.y = t * 3; }
    if (member.mark) {
      member.mark.position.set(root.x, headline + bob + (member.pointer ? .55 : 0), root.z); member.mark.visible = !member.finale;
    }
    if (member.glass) { const q = t * 1.4; member.glass.root.position.set(root.x, top, root.z); if (!calm) member.glass.root.rotation.set(0, t * .4, Math.floor(q) * Math.PI + clamp((q % 1) * 4) * Math.PI); }
    // What they're up to, in the air above them.
    const words = this.wordsOf(member);
    if (words !== member.words) {
      member.words = words;
      if (!words) { this.drop(member.bubble); member.bubble = null; }
      else if (member.bubble) { const { texture, aspect } = bubbleTexture(words); member.bubble.material.map = texture; member.bubble.ratio = aspect; }
      else member.bubble = this.bubble(words);
    }
    if (member.bubble) member.bubble.position.set(root.x, top + (member.glass ? .9 : .2) + bob, root.z);
    if (member.extra) { member.extra.position.set(root.x - .8, 1.5, root.z + .9); member.extra.visible = !member.leaving; }

    if (!calm && !member.leaving) {
      if (member.data.mode === 'scan' && Math.random() < dt * 1.3) this.fx.ring(this.pose.set(root.x, 2.5 * char.tall, root.z), TEAL, .35, .55, .6);
      if (state === 'thinking' && Math.random() < dt * 8) this.fx.burst(this.pose.set(root.x + (Math.random() - .5) * .9, 2.4 * char.tall + Math.random() * .5, root.z + (Math.random() - .5) * .9), 0xffe9a8, 1, .5);
      if (state === 'working' && Math.random() < dt * 5) this.fx.rise(this.pose.set(root.x + (Math.random() - .5) * 1.5, .2, root.z + (Math.random() - .5) * 1.5), member.aura);
      if (state === 'compacting') {
        if (Math.random() < dt * 10) this.fx.rise(this.pose.set(root.x + (Math.random() - .5) * 1.1, 0, root.z + (Math.random() - .5) * 1.1), 0xb4ffd0);
        // As long as it takes, the healing keeps coming; the number only ever comes from what it really won back.
        member.cureIn = (member.cureIn ?? 0) - dt;
        if (member.cureIn <= 0) { member.cureIn = 2.6; this.fx.cure(root, char.tall); }
      }
    }
    for (const minion of member.minions.values()) this.stepMinion(member, minion, dt);
  }
  stepMinion(member, minion, dt) {
    const calm = this.stage.calm, u = minion.rig.u, root = member.char.rig.root.position, a = this.t * 1.7 + minion.phase, [dx, dz] = SLOTS[minion.slot] || SLOTS[0], busy = minion.data && ['working', 'thinking', 'compacting'].includes(minion.data.state);
    minion.drop = Math.max(0, minion.drop - dt * 2.2);
    minion.rig.root.position.set(root.x + dx, .75 + minion.slot * .2 + (calm ? 0 : Math.sin(a) * .14) + minion.drop * minion.drop * 8, root.z + dz);
    if (!calm) for (const [bone, swing] of minion.wings) bone.rotation.z = Math.sin(this.t * (busy ? 16 : 7) + minion.phase) * swing;
    u.uDim.value = busy ? 0 : .4;
    u.uDissolve.value = minion.leaving ? clamp(u.uDissolve.value + dt * 1.6) : 0;
    minion.shadow.position.set(minion.rig.root.position.x, .03, minion.rig.root.position.z); minion.shadow.material.opacity = .7 * (1 - u.uDissolve.value);
    minion.spot.visible = !minion.leaving; this.spot(minion.spot, minion.rig.root.position, .5, minion.id, calm);
    if (minion.leaving && u.uDissolve.value >= 1) { this.removeMinion(minion); member.minions.delete(minion.id); }
  }
  stepEnemy(enemy, dt) {
    const calm = this.stage.calm, u = enemy.rig.u, root = enemy.rig.root.position;
    enemy.flash = Math.max(0, enemy.flash - dt * 5); enemy.kick = Math.max(0, enemy.kick - dt * 3.5); enemy.dodge = Math.max(0, enemy.dodge - dt * 2.4); enemy.born = Math.min(1, enemy.born + dt * 1.6);
    if (enemy.owner) { enemy.at.x = mix(enemy.at.x, enemy.owner.foe.x + enemy.offset[0], 1 - Math.exp(-dt * 6)); enemy.at.z = mix(enemy.at.z, enemy.owner.foe.z + enemy.offset[1], 1 - Math.exp(-dt * 6)); }
    root.x = enemy.at.x - enemy.kick * .35 - (calm ? 0 : Math.sin(enemy.dodge * Math.PI)) * .9; root.z = enemy.at.z; root.y = 0;
    // Its turn: backs up, then either runs the blow across the field or lets a shot go.
    let swing = 0;
    const attack = enemy.attack;
    if (attack) {
      attack.t += dt;
      const q = attack.t / attack.dur, there = attack.target.char.rig.root.position;
      if (attack.target.leaving || enemy.dying || enemy.doomed) enemy.attack = null;
      else {
        swing = q < .4 ? q / .4 : 1 - clamp((q - .4) / .4);
        if (enemy.spits) {
          root.x -= Math.sin(clamp(q / .42) * Math.PI) * .4;
          if (!attack.landed && q >= .42) { attack.landed = true; const from = root.clone().setY(enemy.h * .8), held = enemy.attack; this.fx.orb(from, there.clone().setY(1.5), enemy.glow, { size: 1.5, arc: .6, life: .3, done: () => { enemy.attack = enemy.attack || held; this.foeLands(enemy); if (enemy.attack === held && held.t >= held.dur) enemy.attack = null; } }); }
        } else {
          const out = clamp((q - .12) / .26), back = clamp((q - .6) / .4), v = out * (1 - back);
          if (q < .12) root.x -= q / .12 * .5;
          root.x = mix(root.x, there.x - 1.7, v); root.z = mix(root.z, there.z, v); root.y = Math.sin(v * Math.PI) * .7;
          if (!attack.landed && q >= .4) { attack.landed = true; this.foeLands(enemy); }
        }
        if (attack.t >= attack.dur && enemy.attack === attack) enemy.attack = null;
      }
    }
    if (!calm) enemy.anim(this.t, Math.max(enemy.kick, swing));
    u.uFlash.value = enemy.dying ? Math.max(enemy.flash, calm ? 0 : .25 + Math.sin(this.t * 40) * .25) : enemy.flash;
    u.uDissolve.value = enemy.dying ? clamp(u.uDissolve.value + dt * 1.25) : (1 - enemy.born) * .9;
    enemy.inner.scale.y = enemy.scale * (enemy.dying ? 1 + u.uDissolve.value * .15 : 1);
    enemy.shadow.position.set(root.x, .03, root.z); enemy.shadow.material.opacity = .85 * (1 - u.uDissolve.value);
    if (enemy.dying && u.uDissolve.value >= 1) { enemy.rig.dispose(); this.drop(enemy.shadow); return false; }
    return true;
  }

  // One frame of this fight, only when it's on screen. `frozen` is the connection lost: everything holds where it is.
  tick(dt, frozen) {
    if (this.next && !frozen) { const data = this.next; this.next = null; this.reconcile(data); }
    if (!this.started) { const data = this.data; this.next = null; this.reconcile(data); }
    if (frozen) dt = 0;
    this.fx.update(dt);
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= .1; }
    if (this.cine) { this.cine.t += dt; if (this.cine.t >= this.cine.dur) this.cine = null; }
    this.darkT = Math.max(0, this.darkT - dt); this.dark = mix(this.dark, this.darkT > 0 ? this.darkLevel ?? 1 : 0, 1 - Math.exp(-dt * 3.5));
    this.plates.tone(1 - this.dark * .72);
    this.t += dt;
    if (!this.stage.calm) { this.motes.position.y = Math.sin(this.t * .25) * .5; this.motes.rotation.y = Math.sin(this.t * .08) * .3; }
    for (const member of [...this.members.values()]) {
      this.stepMember(member, dt);
      if (member.leaving && member.char.rig.u.uDissolve.value >= 1) this.remove(member);
    }
    this.enemies = this.enemies.filter(enemy => this.stepEnemy(enemy, dt));
    const hovered = this.hoverId && this.members.get(this.hoverId);
    this.cursor.visible = !!hovered && !hovered.pointer;
    if (this.cursor.visible) { const root = hovered.char.rig.root.position; this.cursor.position.set(root.x, OVERHEAD * hovered.char.tall + (this.stage.calm ? 0 : Math.abs(Math.sin(this.t * 5)) * .12), root.z); }
  }

  // Dragging takes the camera from wherever it is; only ⟲ or leaving the fight gives it back.
  orbit(dx, dy) {
    this.cine = null;
    const from = this.user || { yaw: this.view?.yaw ?? .5, pitch: this.view?.pitch ?? .27 };
    this.user = { yaw: from.yaw - dx * .006, pitch: clamp(from.pitch + dy * .004, PITCH.low, PITCH.high) };
  }
  zoomBy(factor) { this.cine = null; this.zoomGoal = clamp(this.zoomGoal * factor, .45, 1.8); }
  resetView() { this.user = null; this.zoomGoal = 1; }

  placeCamera(aspect, dt, cover) {
    const calm = this.stage.calm, partyFirst = this.stage.phone() && !this.stage.isZoomed(this), home = partyFirst && (this.members.size < 3 || aspect / Math.max(.2, 1 - cover) < 1.2) ? PARTY_VIEW : homeView(aspect), goal = this.user || home, k = calm || !this.view ? 1 : 1 - Math.exp(-dt * 7);
    this.view = this.view || { yaw: goal.yaw, pitch: goal.pitch };
    this.view.yaw = mix(this.view.yaw, goal.yaw, k); this.view.pitch = mix(this.view.pitch, goal.pitch, k); this.zoom = mix(this.zoom, this.zoomGoal, k);
    const sway = calm || this.user ? 0 : Math.sin(this.t * .19) * .04;
    const shot = fit({ spots: partyFirst ? this.partySpots : this.spots, aspect, yaw: this.view.yaw + sway, pitch: this.view.pitch, clear: cover });
    const camera = this.camera, position = this.pose;
    // What it takes to see everyone changes in jumps, when an enemy arrives or a panel opens; the camera eases there.
    if (this.shot) { this.shot.distance = mix(this.shot.distance, shot.distance, k); for (let i = 0; i < 3; i++) this.shot.target[i] = mix(this.shot.target[i], shot.target[i], k); }
    else this.shot = { distance: shot.distance, target: [...shot.target] };
    const { distance, target } = this.shot;
    position.set(target[0] + shot.back[0] * distance * this.zoom, target[1] + shot.back[1] * distance * this.zoom, target[2] + shot.back[2] * distance * this.zoom);
    this.aim.set(...target);
    // Big moves swing in and always settle back. A summon is shot from behind its caster, across the party's line rather than down it, so nobody stands in the way.
    if (this.cine?.finale && !calm) this.finaleCamera(this.cine, position, aspect, cover);
    else if (this.cine && !calm) {
      const c = this.cine, q = clamp(c.t / c.dur), s = Math.sin(q * Math.PI), bell = s * s * (3 - 2 * s), angle = c.around + mix(.75, -.1, q) * c.side, near = aspect < 1 ? 7 / aspect : 9;
      position.x = mix(position.x, c.target.x + Math.sin(angle) * near, bell); position.y = mix(position.y, 2, bell); position.z = mix(position.z, c.target.z + Math.cos(angle) * near, bell);
      this.aim.x = mix(this.aim.x, c.target.x, bell); this.aim.y = mix(this.aim.y, 1.5, bell); this.aim.z = mix(this.aim.z, c.target.z, bell);
    }
    if (this.fx.shake > 0) { position.x += (Math.random() - .5) * .34 * this.fx.shake; position.y += (Math.random() - .5) * .2 * this.fx.shake; }
    camera.position.copy(position); camera.up.set(0, 1, 0); camera.lookAt(this.aim);
    this.plates.back.position.copy(camera.position);
  }

  // Close and low in front of them while they step out and charge, drifting in. On release it pulls back and round to the side, far enough to hold them and the enemy in one frame.
  finaleCamera(c, position, aspect, cover) {
    const { finale, tall, h, t } = c, tan = Math.tan(FOV * Math.PI / 360), room = 1 - cover, me = finale.spot, foe = finale.enemy.at;
    const dx = foe.x - me.x, dz = foe.z - me.z, apart = Math.hypot(dx, dz) || 1, ax = dx / apart, az = dz / apart;
    // Square to the line between them, on the side the camera already stands.
    const flip = ax < 0 ? -1 : 1, nx = -az * flip, nz = ax * flip;
    const tight = Math.max(1.5 * tall / tan / room, 1.15 / tan / aspect) * mix(1.2, 1, smoothRange(t, FINALE.step * .5, FINALE.charge));
    const closeX = me.x + ax * tight * .78 + nx * tight * .62, closeY = 1.1 * tall, closeZ = me.z + az * tight * .78 + nz * tight * .62;
    const high = Math.max(h, 3 * tall), far = Math.max((apart / 2 + 2.2) / tan / aspect, (high / 2 + .9) / tan / room);
    const midX = (me.x + foe.x) / 2, midZ = (me.z + foe.z) / 2, wideX = midX + nx * far - ax * far * .16, wideY = high * .45 + far * .13, wideZ = midZ + nz * far - az * far * .16;
    const back = smoothRange(t, FINALE.charge - .02, FINALE.charge + .55), on = smoothRange(t, 0, .6) * (1 - smoothRange(t, FINALE.dur - .7, FINALE.dur));
    position.x = mix(position.x, mix(closeX, wideX, back), on); position.y = mix(position.y, mix(closeY, wideY, back), on); position.z = mix(position.z, mix(closeZ, wideZ, back), on);
    this.aim.x = mix(this.aim.x, mix(me.x, midX, back), on); this.aim.y = mix(this.aim.y, mix(1.55 * tall, high * .42, back), on); this.aim.z = mix(this.aim.z, mix(me.z, midZ, back), on);
  }

  // `rect` and `clip` in buffer pixels, `cover` { bottom, top, right } the shares of the height and width taken by windows. The ground runs on under them, and everyone stands in what's left.
  render(renderer, rect, clip, scale, cover, dt) {
    const w = rect.w, h = rect.h, right = cover.right || 0, covered = cover.bottom + cover.top;
    // Short ranks when there's height to spare and little width: everyone can be drawn larger.
    const perRank = w < h ? 3 : w / scale < 520 ? 4 : 5;
    if (perRank !== this.perRank) { this.perRank = perRank; if (this.placed) this.spreadFoes(this.placed); }
    this.placeCamera(w * (1 - right) / h, dt, covered);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w * right / 2, h * (cover.bottom - cover.top) / 2, w, h);
    this.roomy = w / scale >= 520;
    // Bubbles grow with the room they have, so a big screen isn't left squinting at phone-sized words.
    this.placeBubbles(w, h, cover.top * h, Math.min(60, 22 + Math.min(w / 1.6, h) / scale * .03) * scale, dt);
    this.shared.uRes.value.set(w, h);
    renderer.setViewport(rect.x, rect.y, w, h); renderer.setScissor(clip.x, clip.y, clip.w, clip.h);
    const words = this.stage.words, sharp = words ? this.scene.children.filter(child => child.isSprite && child.visible && child.material.map?.words) : [];
    for (const sprite of sharp) sprite.visible = false;
    renderer.render(this.scene, this.camera);
    for (const sprite of sharp) sprite.visible = true;
    if (sharp.length) this.paintWords(words, sharp, rect, clip);
  }

  // Each text sprite where and how big the renderer would have put it, in `words`' finer pixels. Buffer rows count up from the bottom, its count down from the top.
  paintWords({ context, fine, height }, sprites, rect, clip) {
    context.save(); context.beginPath(); context.rect(clip.x * fine, (height - clip.y - clip.h) * fine, clip.w * fine, clip.h * fine); context.clip();
    context.imageSmoothingQuality = 'high';
    for (const sprite of sprites.sort((a, b) => a.renderOrder - b.renderOrder)) {
      const box = spriteBox(sprite, this.camera, rect.w, rect.h); if (!box) continue;
      context.globalAlpha = sprite.material.opacity;
      context.drawImage(sprite.material.map.image, (rect.x + box.left) * fine, (height - rect.y - rect.h + box.top) * fine, box.wide * fine, box.tall * fine);
    }
    context.restore();
  }

  // A bubble keeps its size on screen however far the camera stands. The lowest on screen stays put, each one that would cover it climbs above, and any at the edge of the frame slides in. Done in the sprite's own centre, so it's a move on screen whatever the camera's doing.
  placeBubbles(w, h, top, tall, dt) {
    const world = tall * 2 * Math.tan(FOV * Math.PI / 360) / h, list = [], clear = tall * .84, ease = this.stage.calm ? 1 : Math.min(1, dt * 12);
    this.camera.updateMatrixWorld();
    for (const member of this.members.values()) {
      // A mark is as big as it's built up close, and from far off never smaller than the bubbles beside it. It grows upward, off whoever's under it.
      const { mark } = member;
      if (mark) { const near = Math.max(mark.base, world * this.camera.position.distanceTo(mark.position) * mark.base * MARK_SIZE); mark.scale.set(near * mark.ratio, near, 1); mark.center.y = .5 * mark.base / near;
        const high = near / (world * this.camera.position.distanceTo(mark.position)) * tall;
        this.pose.copy(mark.position).project(this.camera);
        member.sign = { x: (this.pose.x + 1) / 2, foot: (1 - this.pose.y) / 2 + mark.center.y * high / h, half: high * mark.ratio / 2 / w, tall: high / h };
      } else member.sign = null;
      const bubble = member.bubble; if (!bubble) continue;
      const size = world * this.camera.position.distanceTo(bubble.position);
      bubble.scale.set(size * bubble.ratio, size, 1);
      this.pose.copy(bubble.position).project(this.camera);
      list.push({ member, x: (this.pose.x + 1) / 2 * w, foot: (1 - this.pose.y) / 2 * h, half: tall * bubble.ratio / 2 });
    }
    list.sort((a, b) => b.foot - a.foot);
    const done = [];
    for (const item of list) {
      const x = Math.max(item.half + 2, Math.min(w - item.half - 2, item.x));
      let foot = item.foot;
      for (let moved = true; moved;) {
        moved = false;
        for (const other of done) if (Math.abs(other.x - x) < other.half + item.half + 2 && foot > other.foot - clear && foot - clear < other.foot) { foot = other.foot - clear; moved = true; }
      }
      foot = Math.max(foot, top + tall);
      done.push({ x, foot, half: item.half });
      const { member } = item, lift = (item.foot - foot) / tall, slide = (x - item.x) / (item.half * 2);
      member.lift = member.lift == null ? lift : member.lift + (lift - member.lift) * ease;
      member.slide = member.slide == null ? slide : member.slide + (slide - member.slide) * ease;
      member.bubble.center.set(.5 - member.slide, -member.lift); member.bubble.visible = this.hoverId !== member.id && !this.cine?.finale;
      member.plate = { x: x / w, foot: foot / h, half: item.half / w, tall: tall / h };
    }
  }

  // Where someone's words hang, as fractions of the fight's rectangle: the tip of their bubble, or the air over their head if they haven't one.
  anchorOf(id) {
    const member = this.members.get(id);
    if (member?.bubble && member.plate) return { x: member.plate.x, y: member.plate.foot, wide: member.plate.half * 2, tall: member.plate.tall };
    let root = member?.char.rig.root.position, up = member ? OVERHEAD * member.char.tall : .9;
    if (!root) for (const owner of this.members.values()) { const minion = owner.minions.get(id); if (minion) root = minion.rig.root.position; }
    if (!root) return null;
    this.pose.copy(root); this.pose.y += up; this.pose.project(this.camera);
    return { x: (this.pose.x + 1) / 2, y: (1 - this.pose.y) / 2, wide: 0, tall: 0 };
  }
  // What's under a point, in CSS pixels from the top left of the fight's rectangle. An enemy answers for its owner, unless `people` asks only for those who fight on our side.
  hit(x, y, width, height, people = false) {
    let best = null, nearest = Infinity;
    const screen = (position, up) => { this.pose.copy(position); this.pose.y += up; this.pose.project(this.camera); return [(this.pose.x + 1) / 2 * width, (1 - this.pose.y) / 2 * height]; };
    const test = (root, tall, wide, id) => {
      const [fx, fy] = screen(root, 0), [, hy] = screen(root, tall), half = Math.max(people ? 26 : 14, (fy - hy) * wide), middle = (fy + hy) / 2, spare = people ? 14 : 5;
      if (Math.abs(x - fx) > half || y < hy - spare || y > fy + spare) return;
      const distance = Math.hypot(x - fx, y - middle);
      if (distance < nearest) { nearest = distance; best = id; }
    };
    // Bubbles and marks are the easiest things to hit, so they go first.
    const on = plate => plate && Math.abs(x - plate.x * width) <= plate.half * width && y <= plate.foot * height && y >= (plate.foot - plate.tall) * height;
    for (const member of this.members.values()) if (!member.leaving && ((member.bubble && on(member.plate)) || (member.mark?.visible && on(member.sign)))) return member.id;
    if (!people) for (const enemy of this.enemies) if (enemy.owner && !enemy.dying) test(enemy.rig.root.position, enemy.h, .4, enemy.owner.id);
    for (const member of this.members.values()) if (!member.leaving) {
      test(member.char.rig.root.position, 2.9 * member.char.tall, .3, member.id);
      for (const minion of member.minions.values()) if (!minion.leaving) { const before = nearest; test(minion.rig.root.position.clone().setY(minion.rig.root.position.y - .3), .8, .5, minion.id); if (nearest < before) nearest *= .2; }
    }
    return best;
  }

  // Nothing here would look wrong drawn less often: nobody's busy and no effect is running.
  get quiet() { if (this.fx.live.length || this.fx.waits.length || this.cine || this.darkT > 0) return false; for (const member of this.members.values()) if (member.finale || busy(member.state)) return false; return true; }

  // How long a member has been in this state, as the time to show; a request knows exactly.
  since(id) { const member = this.members.get(id); return member?.stateAt ?? null; }
  turnOf(id) { const member = this.members.get(id); return member ? { main: !!this.mainOf(member), lessers: this.lessersOf(member).length, family: this.mainOf(member)?.family } : null; }

  setLook(low) {
    this.plates.setLook(low);
  }
  dispose() {
    for (const member of [...this.members.values()]) this.remove(member);
    for (const enemy of this.enemies) { enemy.rig.dispose(); this.drop(enemy.shadow); }
    this.fx.dispose(); this.motes.geometry.dispose(); this.motes.material.dispose(); this.cursor.material.dispose();
    this.plates.back.material.dispose(); this.plates.floor.material.dispose();
    this.enemies = []; this.scene.clear();
  }
}
