// The show: spell circles, slashes, pillars and floating numbers, on a fight's own clock so they stop when the fight isn't drawn. Meshes come from a small pool, so a long battle allocates nothing. With reduced motion only numbers and words appear, and they sit still.
import * as THREE from 'three';
import { clamp, mix } from './rig.js';

const CAP = 140, UP = -Math.PI / 2;
const DIAMOND = new THREE.OctahedronGeometry(.11, 0), RING = new THREE.RingGeometry(.86, 1, 28), SQUARE = new THREE.RingGeometry(.82, 1, 4), TUBE = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), CUBE = new THREE.BoxGeometry(.3, .3, .3), CONE = new THREE.ConeGeometry(.12, .5, 5), SLASH = (() => {
  const n = 14, p = [], ix = [];
  for (let i = 0; i <= n; i++) { const a = -1.2 + i / n * 2.4, w = Math.sin(i / n * Math.PI) * .32; p.push(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0, Math.cos(a) * (1.25 - w), Math.sin(a) * (1.25 - w), 0); if (i < n) ix.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); return g;
})();
let flareTexture = null;
function flare() {
  if (flareTexture) return flareTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff'); g.addColorStop(.25, '#ffffffaa'); g.addColorStop(1, '#ffffff00'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  flareTexture = new THREE.CanvasTexture(c); flareTexture.colorSpace = THREE.NoColorSpace;
  return flareTexture;
}

// Words drawn once in the theme's face. Numbers come and go, so these are kept to a limit.
const LABELS = new Map(), LABEL_LIMIT = 80;
export function labelTexture(text, color) {
  const key = `${text}|${color}`;
  let label = LABELS.get(key);
  if (label) { LABELS.delete(key); LABELS.set(key, label); return label; }
  const font = '800 66px Nunito, system-ui, sans-serif', canvas = document.createElement('canvas'); let context = canvas.getContext('2d');
  context.font = font; const width = Math.ceil(context.measureText(text).width) + 28; canvas.width = width; canvas.height = 100;
  context = canvas.getContext('2d'); context.font = font; context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineWidth = 12; context.lineJoin = 'round'; context.strokeStyle = '#0e0b08'; context.strokeText(text, width / 2, 52); context.fillStyle = color; context.fillText(text, width / 2, 52);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.NoColorSpace; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.words = true;
  label = { texture, aspect: width / 100 };
  LABELS.set(key, label);
  if (LABELS.size > LABEL_LIMIT) { const [oldest, gone] = LABELS.entries().next().value; LABELS.delete(oldest); gone.texture.dispose(); }
  return label;
}
// Bright at the foot, nothing at the head. Added to the screen, black draws nothing.
let FADE = null;
const fade = () => {
  if (FADE) return FADE;
  const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 64;
  const context = canvas.getContext('2d'), ramp = context.createLinearGradient(0, 64, 0, 0);
  ramp.addColorStop(0, '#fff'); ramp.addColorStop(.45, '#999'); ramp.addColorStop(1, '#000');
  context.fillStyle = ramp; context.fillRect(0, 0, 2, 64);
  FADE = new THREE.CanvasTexture(canvas); FADE.colorSpace = THREE.NoColorSpace;
  return FADE;
};
// A small window with a tail, for what someone's doing right now, in the windows' own pixels (scripts/fantasy-frames.mjs): a cell of 6 is about two screen pixels at the size it's shown. Shares the labels' limit.
const CELL = 6, BODY = 17, BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], OUTLINE = '#000000c8', SHADOW = '#00000070';
const LIT = { top: '#f4f2ea', left: '#dcdcd2', right: '#9a9c92', bottom: '#7d7f76' }, DIM = { top: '#9fa197', left: '#8f9188', right: '#62645c', bottom: '#53554e' };
const TAIL = ['dFFFFFd', 'bdFFFdb', 'obdFdbo', '.obdbo.', '..obo..', '...o...'];
// The bubble's gradient in 14 bands, each channel in steps of 4.
const BANDS = Array.from({ length: 14 }, (_, i) => { const t = (i + .5) / 14, [a, b, k] = t < .5 ? [[26, 114, 96], [13, 69, 55], t * 2] : [[13, 69, 55], [6, 35, 29], t * 2 - 1]; return a.map((v, j) => Math.round((v + (b[j] - v) * k) / 4) * 4); });
export function bubbleTexture(text) {
  const key = `bubble|${text}`;
  let label = LABELS.get(key);
  if (label) { LABELS.delete(key); LABELS.set(key, label); return label; }
  const font = '800 57px Nunito, system-ui, sans-serif', canvas = document.createElement('canvas'); let context = canvas.getContext('2d');
  context.font = font;
  const cols = Math.max(23, Math.ceil((context.measureText(text).width + 60) / CELL)) | 1, rows = BODY + 4, width = cols * CELL, height = rows * CELL, box = BODY * CELL; // Odd, so the tail has a middle.
  canvas.width = width; canvas.height = height;
  // The window's bands at 120°, under the Bayer dither.
  const fill = (x, y) => {
    const t = clamp(((x - cols / 2) * .866 + (y - BODY / 2) * .5) / (cols * .866 + BODY * .5) + .5, 0, .999), v = BAYER[y % 4 * 4 + x % 4] / 15 - .5;
    return `rgb(${BANDS[Math.floor(t * BANDS.length)].map(c => Math.round(v > 0 ? c + (255 - c) * v * 28 / 255 : c * (1 + v * 44 / 255))).join()})`;
  };
  const depth = (x, y) => { if (y < 0 || y >= BODY) return -1; const r = cols - 1 - x, b = BODY - 1 - y; return Math.min(x, y, r, b, x + y - 2, r + y - 2, x + b - 2, r + b - 2); };
  const cells = new Map();
  for (let y = 0; y <= BODY; y++) for (let x = 0; x < cols; x++) {
    const d = depth(x, y);
    if (d < 0) { if (depth(x, y - 1) >= 0) cells.set(`${x},${y}`, SHADOW); continue; }
    const near = { top: y, left: x, right: cols - 1 - x, bottom: BODY - 1 - y }, side = Object.keys(near).reduce((a, k) => near[k] < near[a] ? k : a, 'top');
    cells.set(`${x},${y}`, d === 0 ? OUTLINE : d === 1 ? LIT[side] : d === 2 ? DIM[side] : fill(x, y));
  }
  // The tail opens the frame's bottom bands and steps down to a point, its shadow under it.
  const left = (cols - 1) / 2 - 3, top = BODY - 3, ink = { d: DIM.bottom, b: LIT.bottom, o: OUTLINE };
  TAIL.forEach((row, r) => [...row].forEach((c, i) => { if (c !== '.') cells.set(`${left + i},${top + r}`, c === 'F' ? fill(left + i, top + r) : ink[c]); }));
  for (let r = 3; r <= TAIL.length; r++) for (let i = 0; i < 7; i++) if ((TAIL[r]?.[i] ?? '.') === '.' && TAIL[r - 1][i] === 'o') cells.set(`${left + i},${top + r}`, SHADOW);
  for (const [at, color] of cells) { const [x, y] = at.split(','); context.fillStyle = color; context.fillRect(x * CELL, y * CELL, CELL, CELL); }
  context.font = font; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#000'; context.fillText(text, width / 2 + 3, box / 2 + 4); context.fillStyle = '#fff9e6'; context.fillText(text, width / 2, box / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.NoColorSpace; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.words = true;
  label = { texture, aspect: width / height };
  LABELS.set(key, label);
  if (LABELS.size > LABEL_LIMIT) { const [oldest, gone] = LABELS.entries().next().value; LABELS.delete(oldest); gone.texture.dispose(); }
  return label;
}
export function clearLabels() { for (const { texture } of LABELS.values()) texture.dispose(); LABELS.clear(); }
export const flareMap = () => flare();

const at = (x, y, z) => new THREE.Vector3(x, y, z);
const onFloor = position => at(position.x, .07, position.z);

export class Effects {
  live = []; waits = []; meshes = []; sprites = []; clock = 0; shake = 0;
  constructor(scene, calm) {
    this.scene = scene; this.calm = calm;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } }, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor, uAlpha); }' }));
    this.screen.frustumCulled = false; this.screen.renderOrder = 30; this.screen.visible = false; scene.add(this.screen);
  }
  mesh(geometry, color, opacity = 1, additive = true) {
    if (this.live.length >= CAP) return null;
    let mesh = this.meshes.pop();
    if (!mesh) { mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); mesh.frustumCulled = false; mesh.renderOrder = 5; this.scene.add(mesh); }
    if (mesh.material.map) { mesh.material.map = null; mesh.material.needsUpdate = true; }
    mesh.geometry = geometry; mesh.visible = true; mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.setScalar(1);
    mesh.material.color.setHex(color, THREE.LinearSRGBColorSpace); mesh.material.opacity = opacity; mesh.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    return mesh;
  }
  sprite(map, color = 0xffffff, additive = false) {
    if (this.live.length >= CAP) return null;
    let sprite = this.sprites.pop();
    if (!sprite) { sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); sprite.frustumCulled = false; this.scene.add(sprite); }
    sprite.visible = true; sprite.material.map = map; sprite.material.color.setHex(color, THREE.LinearSRGBColorSpace); sprite.material.opacity = 1; sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    return sprite;
  }
  run(thing, life, step, pool) { this.live.push({ thing, life, step, t: 0, pool }); return thing; }
  after(seconds, fn) { this.waits.push({ at: this.clock + seconds, fn }); }

  update(dt) {
    this.clock += dt;
    for (let i = this.waits.length - 1; i >= 0; i--) if (this.waits[i].at <= this.clock) { const { fn } = this.waits[i]; this.waits.splice(i, 1); fn(); }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const item = this.live[i]; item.t += dt;
      const p = Math.min(1, item.t / item.life); item.step(p, dt);
      if (p >= 1) { item.thing.visible = false; item.pool.push(item.thing); this.live.splice(i, 1); }
    }
    const alpha = this.screen.material.uniforms.uAlpha; alpha.value = Math.max(0, alpha.value - dt * 2.4); this.screen.visible = alpha.value > .002;
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }
  // The whole picture lights up only for what's rare: a skill, an error, a compact. Ordinary hits stay on their target.
  flash(color, amount = .14) { if (this.calm) return; this.screen.material.uniforms.uColor.value.setHex(color, THREE.LinearSRGBColorSpace); const alpha = this.screen.material.uniforms.uAlpha; alpha.value = Math.max(alpha.value, Math.min(.18, amount)); }
  jolt(amount) { if (!this.calm) this.shake = Math.max(this.shake, amount); }

  burst(position, color, count = 9, speed = 3) {
    for (let i = 0; i < count; i++) {
      const mesh = this.mesh(DIAMOND, color); if (!mesh) return;
      const a = Math.random() * 6.28, y = Math.random() * 1.6 - .2, v = at(Math.cos(a) * speed * (.4 + Math.random()), y * speed, Math.sin(a) * speed * (.4 + Math.random())); mesh.position.copy(position);
      this.run(mesh, .55, (p, d) => { v.y -= 7 * d; mesh.position.addScaledVector(v, d); mesh.rotation.x += d * 9; mesh.material.opacity = 1 - p; }, this.meshes);
    }
  }
  slash(position, color) { const mesh = this.mesh(SLASH, color); if (!mesh) return; mesh.position.copy(position); mesh.rotation.set(0, Math.PI * .3, Math.random() * 1.2 - 2.1); this.run(mesh, .3, p => { mesh.scale.setScalar(.7 + p * 1.1); mesh.material.opacity = 1 - p * p; }, this.meshes); }
  ring(position, color, from = .3, to = 3, life = .55) { const mesh = this.mesh(RING, color); if (!mesh) return; mesh.position.copy(position); mesh.rotation.x = UP; this.run(mesh, life, p => { mesh.scale.setScalar(mix(from, to, p)); mesh.material.opacity = 1 - p; }, this.meshes); }
  sweep(enemy, color) { const mesh = this.mesh(RING, color), base = enemy.rig.root.position; if (!mesh) return; mesh.rotation.x = UP; mesh.scale.setScalar(1.15); this.run(mesh, .55, p => { mesh.position.set(base.x, base.y + (enemy.h + .3) * (1 - p), base.z); mesh.material.opacity = Math.max(0, p * 2 - 1); }, this.meshes); }
  // A column of light goes out as it climbs: it has no top to see.
  pillar(position, color, radius = .9, life = 1, height = 11) { const mesh = this.mesh(TUBE, color, .7); if (!mesh) return; mesh.material.map = fade(); mesh.material.needsUpdate = true; mesh.position.copy(position); this.run(mesh, life, p => { const q = Math.min(1, p * 5); mesh.scale.set(radius * (1.2 - p * .9), height * q, radius * (1.2 - p * .9)); mesh.position.y = position.y + height * q / 2; mesh.material.opacity = .75 * (1 - p); }, this.meshes); }
  bolt(position, color, half = .2) {
    if (this.live.length >= CAP) return;
    const points = [], index = []; let x = position.x, z = position.z;
    for (let i = 0; i <= 7; i++) { const y = position.y + 9 * (7 - i) / 7; points.push(x - half, y, z - half * .6, x + half, y, z + half * .6); x = position.x + (Math.random() - .5) * (i < 6 ? 1 : 0); z = position.z + (Math.random() - .5) * (i < 6 ? 1 : 0); if (i < 7) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false })); mesh.material.color.setHex(color, THREE.LinearSRGBColorSpace); mesh.frustumCulled = false; mesh.renderOrder = 5; this.scene.add(mesh);
    // Its shape is new each time, so this one doesn't go back to the pool.
    const spent = { push: () => { this.scene.remove(mesh); geometry.dispose(); mesh.material.dispose(); } };
    this.run(mesh, .26, p => { mesh.material.opacity = 1 - p * p; }, spent);
  }
  rune(enemy, color) { const mesh = this.mesh(SQUARE, color), base = enemy.rig.root.position; if (!mesh) return; mesh.rotation.x = UP; this.run(mesh, .6, p => { mesh.position.set(base.x, base.y + enemy.h + 1.5 - Math.min(1, p * 2.2) * (enemy.h + 1.4), base.z); mesh.rotation.z = p * 4; mesh.scale.setScalar(2 - p * .6); mesh.material.opacity = 1 - Math.max(0, p * 2 - 1); }, this.meshes); }
  rain(position, color) {
    for (let i = 0; i < 7; i++) {
      const mesh = this.mesh(CUBE, color, 1, false); if (!mesh) return;
      const x = position.x + (Math.random() - .5) * 1.5, z = position.z + (Math.random() - .5) * 1.5, off = i * .07; mesh.position.set(x, 9, z);
      this.run(mesh, .55 + off, p => { const a = clamp((p * (.55 + off) - off) / .4); mesh.position.y = mix(8, position.y, a * a); mesh.rotation.x += .2; mesh.material.opacity = 1 - Math.max(0, p * 4 - 3); }, this.meshes);
    }
  }
  rocket(from, to, color, done) {
    const mesh = this.mesh(CONE, color, 1, false); if (!mesh) return done?.(); mesh.position.copy(from); let last = 0;
    this.run(mesh, .5, p => { mesh.position.lerpVectors(from, to, p); mesh.position.y += Math.sin(p * Math.PI) * 3.2; mesh.rotation.z = (1 - p * 2) * 1.2 + Math.PI / 2; if (p - last > .1) { last = p; this.burst(mesh.position, 0xffd98a, 1, .5); } if (p > .96 && done) { done(); done = null; } }, this.meshes);
  }
  // What a spell is before it's cast: light growing in the hands.
  charge(position, color, life = .4, size = 1.3) {
    const hands = position.clone();
    this.flareGrow(hands, color, life, size * 1.5); this.flareGrow(hands, 0xffffff, life, size * .7);
    for (let i = 0; i < 2; i++) this.after(i * life * .4, () => this.ring(hands, color, size * 1.3, .1, life * .5));
  }
  flareGrow(position, color, life, size) { const sprite = this.sprite(flare(), color, true); if (!sprite) return; sprite.position.copy(position); sprite.renderOrder = 6; this.run(sprite, life, p => { sprite.scale.setScalar(size * (.15 + p * .85)); sprite.material.opacity = Math.min(1, p * 3); }, this.sprites); }
  // A ball of light on its way, with a tail. `done` fires when it arrives, even if the pool ran out.
  orb(from, to, color, { life = .3, arc = 1, size = 1.5, done } = {}) {
    const sprite = this.sprite(flare(), color, true); if (!sprite) return done?.();
    const heart = this.sprite(flare(), 0xffffff, true); let last = 0;
    sprite.position.copy(from); sprite.renderOrder = 7; if (heart) { heart.position.copy(from); heart.renderOrder = 8; heart.scale.setScalar(size * .5); this.run(heart, life, p => { heart.position.lerpVectors(from, to, p); heart.position.y += Math.sin(p * Math.PI) * arc; }, this.sprites); }
    this.run(sprite, life, p => {
      sprite.position.lerpVectors(from, to, p); sprite.position.y += Math.sin(p * Math.PI) * arc; sprite.scale.setScalar(size * (1 + Math.sin(p * 18) * .12));
      if (p - last > .14) { last = p; this.flare(sprite.position, color, size * .6, .22); this.burst(sprite.position, color, 1, .7); }
      if (p >= 1 && done) { const fn = done; done = null; fn(); }
    }, this.sprites);
  }
  // A straight line of light from one point to another.
  beam(from, to, color, life = .4, width = .12) {
    const mesh = this.mesh(TUBE, color, .9); if (!mesh) return; const length = from.distanceTo(to), dir = to.clone().sub(from).normalize();
    mesh.position.lerpVectors(from, to, .5); mesh.quaternion.setFromUnitVectors(at(0, 1, 0), dir);
    this.run(mesh, life, p => { const w = width * (1 - p * p) * (1 + Math.sin(p * 40) * .2); mesh.scale.set(w, length, w); mesh.material.opacity = .9 * (1 - p * p); }, this.meshes);
  }
  // Flames licking up off the ground in a ring.
  flames(position, color, count = 14, radius = .9, height = 3.4) {
    for (let i = 0; i < count; i++) {
      const mesh = this.mesh(CONE, i % 3 ? color : 0xffe9a0); if (!mesh) return;
      const a = i / count * 6.28 + Math.random(), d = radius * (.3 + Math.random() * .7), x = position.x + Math.cos(a) * d, z = position.z + Math.sin(a) * d, off = Math.random() * .3, wide = 2.2 + Math.random() * 2, tall = height * (.7 + Math.random() * .5); mesh.position.set(x, 0, z);
      this.run(mesh, .62, p => { const q = clamp((p - off) / (1 - off)); mesh.visible = q > 0; mesh.position.y = q * tall * .8 + .3; mesh.scale.set(wide * (1 - q * .75), 3 + q * 3, wide * (1 - q * .75)); mesh.material.opacity = 1 - q * q; }, this.meshes);
    }
  }
  // Sparks winding up around someone.
  helix(position, color, height = 3.4, count = 16, life = .8) {
    for (let i = 0; i < count; i++) {
      const mesh = this.mesh(DIAMOND, color); if (!mesh) return; const off = i / count * .5, phase = i * .9;
      this.run(mesh, life, p => { const q = clamp((p - off) / (1 - off)), a = phase + q * 6; mesh.visible = q > 0; mesh.position.set(position.x + Math.cos(a) * 1.1 * (1 - q * .4), position.y + q * height, position.z + Math.sin(a) * 1.1 * (1 - q * .4)); mesh.material.opacity = 1 - q * q; }, this.meshes);
    }
  }
  // Cure: cast on oneself, a green column winding up around them and sparkles falling back down.
  cure(position, tall = 1) {
    const floor = onFloor(position), top = 3.4 * tall, green = 0x6dffa8, white = 0xeafff0;
    this.circle(floor, green, 1.5, 1.8); this.helix(floor, green, top, 12, 1.3); this.helix(floor, white, top, 7, 1.1);
    this.after(.3, () => { this.pillar(floor, green, .6, .9, 7); this.ring(floor, white, .25, 2.2, .6); });
    for (let i = 0; i < 4; i++) this.after(.5 + i * .16, () => { const p = at(position.x + (Math.random() - .5) * 1.4, top * (.45 + Math.random() * .5), position.z + (Math.random() - .5) * 1.4); this.flare(p, i % 2 ? white : green, 1.5, .3); this.burst(p, green, 3, 1.4); });
  }
  // A small shot: a minion's tool call.
  dart(from, to, color) {
    const mesh = this.mesh(DIAMOND, color); if (!mesh) return; mesh.position.copy(from); mesh.scale.setScalar(1.3);
    this.run(mesh, .32, p => { mesh.position.lerpVectors(from, to, p); mesh.position.y += Math.sin(p * Math.PI) * .9; mesh.rotation.y += .4; if (p >= 1) this.flare(to, color, 1, .2); }, this.meshes);
  }
  flare(position, color, size = 2, life = .35) { const sprite = this.sprite(flare(), color, true); if (!sprite) return; sprite.position.copy(position); sprite.renderOrder = 6; this.run(sprite, life, p => { sprite.scale.setScalar(size * (1 + p * .5)); sprite.material.opacity = 1 - p; }, this.sprites); }
  // Words fly with or without motion; a calm screen still needs them.
  number(position, text, color, height = .62) {
    const label = labelTexture(text, color), sprite = this.sprite(label.texture); if (!sprite) return;
    sprite.position.copy(position); sprite.position.x += (Math.random() - .5) * .5; sprite.scale.set(height * label.aspect, height, 1); sprite.renderOrder = 22;
    let v = this.calm ? 0 : 3.6; const floor = position.y;
    this.run(sprite, 1.15, (p, d) => { if (!this.calm) { v -= 15 * d; sprite.position.y += v * d; if (sprite.position.y < floor) { sprite.position.y = floor; v = Math.abs(v) * .42; } } sprite.material.opacity = p > .75 ? (1 - p) * 4 : 1; }, this.sprites);
  }
  circle(position, color, life = .8, radius = 1.2) {
    for (const [geometry, turn, scale] of [[RING, 0, 1], [SQUARE, 0, .8], [SQUARE, Math.PI / 4, .8]]) {
      const mesh = this.mesh(geometry, color); if (!mesh) return;
      mesh.position.copy(onFloor(position)); mesh.rotation.x = UP; mesh.renderOrder = 4;
      this.run(mesh, life, p => { mesh.rotation.z = turn + p * 3.4; mesh.scale.setScalar(radius * scale * Math.min(1, p * 6)); mesh.material.opacity = 1 - Math.max(0, p * 3 - 2); }, this.meshes);
    }
  }
  gather(position, color, count = 12, life = .55) {
    for (let i = 0; i < count; i++) {
      const mesh = this.mesh(DIAMOND, color); if (!mesh) return;
      const a = Math.random() * 6.28, b = Math.random() * 3.14, d = 1.4 + Math.random() * 1.6, from = at(position.x + Math.cos(a) * Math.sin(b) * d, position.y + Math.cos(b) * d, position.z + Math.sin(a) * Math.sin(b) * d), off = Math.random() * .4; mesh.position.copy(from);
      this.run(mesh, life, p => { const q = clamp((p - off) / (1 - off)); mesh.position.lerpVectors(from, position, q * q); mesh.scale.setScalar(.6 + q); mesh.material.opacity = q > 0 ? 1 : 0; }, this.meshes);
    }
  }
  shock(position, color, radius = 5) { const floor = onFloor(position); this.ring(floor, color, .3, radius, .5); this.ring(floor, 0xffffff, .2, radius * .7, .36); }
  // A turn ending: its enemy goes up in small blasts, then one big one.
  finish(enemy, color, alive) {
    const base = enemy.rig.root.position.clone();
    for (let i = 0; i < 5; i++) this.after(i * .11, () => { if (!alive()) return; const p = base.clone(); p.x += (Math.random() - .5) * 1.6; p.y = Math.random() * enemy.h; p.z += (Math.random() - .5) * 1.6; this.flare(p, color, 1.8, .3); this.burst(p, color, 5, 3); });
    this.after(.56, () => { if (!alive()) return; const p = base.clone().setY(enemy.h * .5); this.flare(p, color, 4.5, .4); this.burst(p, 0xffe9b0, 18, 5.4); this.shock(p, color, 5); this.jolt(.4); });
  }
  // Where a shot leaves a gunner's weapon, the two guns taking turns if they carry two.
  muzzle(member, other) {
    const { wR, wL } = member.rig.J, wrist = other && wL?.tip ? wL : wR;
    if (!wrist?.tip) return member.rig.root.position.clone().setY(1.5);
    wrist.updateWorldMatrix(true, false);
    return wrist.localToWorld(new THREE.Vector3(0, 0, wrist.tip));
  }
  // Up with the arm and back with the shoulders, once; the pose brings them down again.
  kick(member, size = 1) { const { aR, aL, torso } = member.rig.J; for (const arm of [aR, aL]) if (arm) arm.rotation.x -= .16 * size; if (torso) torso.rotation.x -= .06 * size; }
  // One round: the flash at the barrel, a tracer, the hit, a spent case, and a kick for the arm.
  round(member, p, color, other) {
    const from = this.muzzle(member, other);
    this.kick(member);
    this.flare(from, 0xffe9a0, 1.7, .08); this.beam(from, p, 0xfff0c0, .1, .055); this.flare(p, color, 1.6, .14); this.burst(p, 0xffd98a, 3, 3);
    const shell = this.mesh(DIAMOND, 0xe0b040, 1, false);
    if (shell) { shell.position.copy(from).lerp(member.rig.root.position.clone().setY(from.y), .5); shell.scale.setScalar(.07); const vx = 1 + Math.random(), vz = (Math.random() - .5) * 2; let vy = 3; this.run(shell, .5, (t, d) => { shell.position.x += vx * d; shell.position.z += vz * d; shell.position.y = Math.max(.05, shell.position.y + vy * d); vy -= 12 * d; shell.rotation.x += d * 20; shell.material.opacity = 1 - t * t; }, this.meshes); }
  }
  // A final blow, first half: light gathering on whoever earned it, once they've stepped out to `spot`.
  finaleCharge(member, spot, color, tall, wait, life) {
    const floor = onFloor(spot), gun = member.data.cls === 'gunner', hands = () => gun ? this.muzzle(member) : spot.clone().setY(2.5 * tall);
    this.after(wait, () => {
      this.circle(floor, color, life + .2, 2.4); this.helix(floor, color, 3.8 * tall, 16, life); this.helix(floor, 0xfff4c4, 3.8 * tall, 10, life); this.gather(hands(), color, 22, life); this.charge(hands(), color, life, 2.2);
      for (let i = 0; i < 3; i++) this.after(i * life * .3, () => this.ring(floor, color, .3, 3, .4));
    });
  }
  // Second half: what each class does with it, from `from` seconds in; `land` goes off with the last blow, at `last`. Timed here, not by distance, so every class's scene is the same length.
  finaleBlow(kind, member, spot, enemy, color, from, last, land) {
    // The enemy's own spot, not where it is: it can still be on its way back, and the line moves when someone drops to the back row.
    const p = at(0, enemy.h * .55, 0), floor = at(0, 0, 0), after = (t, fn) => this.after(t, () => { p.x = floor.x = enemy.at.x; p.z = floor.z = enemy.at.z; fn(); });
    p.x = floor.x = enemy.at.x; p.z = floor.z = enemy.at.z;
    const hands = spot.clone().setY(1.75 * member.char.tall);
    if (kind === 'blades') for (let t = from + .5; t < last; t += .17) after(t, () => { const white = Math.random() < .4; this.slash(p, white ? 0xffffff : color); this.flare(p, color, 2.2, .16); this.burst(p, color, 6, 3.8); });
    else if (kind === 'spell') {
      after(from, () => { this.flash(color, .1); this.orb(hands, p, color, { size: 2.6, arc: 1, life: .32, done: () => { this.flare(p, color, 3.4, .3); this.shock(p, color, 3); } }); });
      after(from + .3, () => this.circle(floor, color, last - from, 3.4));
      for (let t = from + .4; t < last - .2; t += .2) after(t, () => this.orb(at(p.x + (Math.random() - .5) * 6, 13, p.z + (Math.random() - .5) * 5), p, color, { size: 1.8, arc: 0, life: .26, done: () => { this.flare(p, color, 2.6, .2); this.ring(floor, color, .3, 3.4, .4); } }));
    } else {
      let other = false;
      for (let t = from + .02; t < last - .4; t += .085) after(t, () => { other = !other; this.round(member, p, color, other); });
      after(last - .4, () => { this.kick(member, 2.5); this.rocket(this.muzzle(member), p, color, () => {}); });
    }
    after(last, () => {
      land(); this.flash(color, .12); this.jolt(.9);
      this.pillar(floor, color, 1.8, 1.2, 14); this.pillar(floor, 0xfff4c4, .8, .9, 14); this.circle(floor, color, 1, 3.4); this.flames(floor, color, 16, 2, 4.4); this.flare(p, color, 6, .6); this.burst(p, color, 22, 5.6);
      this.shock(floor, color, 6); this.after(.14, () => this.shock(floor, 0xfff4c4, 8));
    });
  }
  // Compacting: small diamonds drifting up off the ground.
  rise(position, color) { const mesh = this.mesh(DIAMOND, color); if (!mesh) return; mesh.position.copy(position); this.run(mesh, .9, (p, d) => { mesh.position.y += d * 2; mesh.material.opacity = 1 - p; }, this.meshes); }
  dropIn(position, color) { this.pillar(onFloor(position), color, .45, .6, 7); this.flare(position, color, 2.4, .35); this.ring(onFloor(position), color, .2, 1.8, .5); }

  // A tool call as a spell. `to` is where it lands on the enemy, `land` what happens to the enemy when it gets there.
  move(ability, member, enemy, to, land) {
    const color = ability.color, aura = member.aura, p = to, floor = at(p.x, 0, p.z), me = member.rig.root.position, gun = member.data.cls === 'gunner', hands = gun ? this.muzzle(member) : me.clone().setY(2.4 * member.char.tall);
    const blow = () => { for (const d of [0, .07, .14]) this.after(d, () => this.slash(p, d === .07 ? 0xffffff : aura)); this.flare(p, aura, 3.2, .28); this.burst(p, aura, 8, 3.6); };
    // A sage's blade leaves the hand as a spell; a gunner's as a burst of fire.
    if (ability.ranged) return this.orb(hands, p, aura, { size: 1.5, done: () => { land(); blow(); this.shock(p, aura, 2.6); } });
    if (ability.shot) {
      for (const d of [0, .09, .18]) this.after(d, () => { this.round(member, p, color, d === .09); if (d === .18) land(); });
      return;
    }
    // Whatever else a gunner does starts with a shot, so it comes out of the gun.
    if (gun && ability.hit) this.round(member, p, color);
    switch (ability.key) {
      // Reading: a beam that looks the target over.
      case 'scan': this.beam(hands, p, color, .55, .1); if (enemy) { this.sweep(enemy, color); this.after(.16, () => this.sweep(enemy, 0xeafff0)); } this.flare(p, color, 2.6, .5); land(); break;
      // Searching: three lights hunting, each marking the ground where it lands.
      case 'seek': for (const d of [0, .13, .26]) this.after(d, () => this.orb(hands, p, color, { size: .9, life: .26, arc: 1.2 + d * 4, done: () => { this.ring(onFloor(p), color, .2, 3, .5); this.flare(p, color, 1.8, .2); } })); land(); break;
      case 'cut': blow(); land(); break;
      // Writing: a fireball, then the ground goes up.
      case 'forge': this.orb(hands, p, color, { size: 2.2, arc: 1.6, life: .34, done: () => { land(); this.flames(floor, color); this.flare(p, 0xffc070, 4, .45); this.shock(p, color, 3.6); this.jolt(.3); } }); break;
      // Testing: lightning, three times.
      case 'trial': for (const d of [0, .14, .28]) this.after(d, () => { const strike = at(p.x + (Math.random() - .5), 0, p.z + (Math.random() - .5)); this.bolt(strike, color, .24); this.bolt(strike, 0xffffff, .09); this.flare(p, color, 2.6, .2); this.burst(p, color, 5, 3.4); if (d === 0) land(); }); break;
      // Committing: a sigil comes down and locks.
      case 'seal': if (enemy) { this.rune(enemy, color); this.after(.1, () => this.rune(enemy, 0xfff0b0)); } this.after(.33, () => { land(); this.shock(p, color, 3.8); this.flare(p, color, 4, .4); this.helix(floor, color, 3, 12, .6); }); break;
      case 'launch': this.rocket(hands, p, color, () => { land(); this.flare(p, 0xffb080, 4.5, .4); this.burst(p, color, 18, 4.8); this.flames(floor, color, 10, 1.2, 2.6); this.shock(p, color, 4.4); this.jolt(.4); }); break;
      // Installing: light winding up around the caster.
      case 'supply': this.helix(onFloor(me), color, 3.6, 18, .75); this.ring(onFloor(me), color, .2, 2.4, .6); this.flare(hands, color, 2.6, .5); land(); break;
      // The web: a comet from far away.
      case 'sight': this.orb(at(p.x + 5, 13, p.z - 3), p, color, { size: 2, arc: 0, life: .3, done: () => { land(); this.pillar(floor, color, .9, .7); this.flare(p, color, 4.4, .4); this.shock(p, color, 3.4); this.jolt(.2); } }); break;
      case 'summon': { const s = onFloor(me); s.x -= 1; s.z += .8; this.circle(s, color, 1, 2.2); this.pillar(s, color, .7, .9, 10); this.helix(s, color, 4, 14, .8); this.flare(s.clone().setY(1.2), color, 4.5, .5); land(); break; }
      case 'skill':
        land(); this.pillar(floor, color, 1.7, 1.4, 14); this.pillar(floor, 0xffffff, .8, .9, 14); this.circle(floor, color, 1.3, 3.2); this.flames(floor, color, 16, 2, 4.4); this.flash(color, .14); this.flare(p, color, 6, .7); this.jolt(1);
        for (let i = 0; i < 6; i++) this.after(.12 + i * .13, () => { this.burst(p, i % 2 ? color : 0xffffff, 9, 4.6); this.shock(floor, color, 2.4 + i * .9); });
        break;
      default: land(); this.flare(p, aura, 3, .25); this.burst(p, aura, 12, 3.6);
    }
  }
  dispose() {
    for (const list of [this.meshes, this.sprites, this.live.map(item => item.thing)]) for (const thing of list) { this.scene.remove(thing); thing.material?.dispose(); }
    this.screen.geometry.dispose(); this.screen.material.dispose(); this.live = []; this.waits = [];
  }
}
