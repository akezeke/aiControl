// The painted battlefields: a plate wrapped all the way round for the distance, and a plate on the ground. Both are baked by scripts/fantasy-bake.mjs and shared between fights.
import * as THREE from 'three';
import { raw } from './rig.js';

// `sun`, `sky` and `bounce` light whoever stands there, the sun from `dir`. Barely tinted, so a character keeps its own colours, and a cool sky so shadow doesn't turn brown.
export const PLACES = {
  reactor: { fog: 0x0f4a3e, glow: 0x6dffb0, sun: 0xcfeade, sky: 0x6c8c8c, bounce: 0x2f5a50, dir: [-.3, .75, .6] },
  mesa: { fog: 0xc86a58, glow: 0xffd28a, sun: 0xf6ecdc, sky: 0x7ca0ac, bounce: 0x7a4a40, dir: [-.55, .6, .55] },
  wood: { fog: 0x1a6a42, glow: 0xd8ff7a, sun: 0xe0f0c8, sky: 0x6f9a84, bounce: 0x356244, dir: [.25, .85, .45] },
  meadow: { fog: 0xa8d8c8, glow: 0xfff0a0, sun: 0xfaf6e6, sky: 0x88aebc, bounce: 0x5c8850, dir: [-.45, .7, .55] },
  ember: { fog: 0x4a1008, glow: 0xff5a2a, sun: 0xf4d8cc, sky: 0x6c7a88, bounce: 0x6a2418, dir: [-.2, .8, .55] },
  wrecks: { fog: 0xc4dadf, glow: 0xffffff, sun: 0xf8f6f0, sky: 0x8aa8b4, bounce: 0x98acb4, dir: [.4, .7, .55] },
};
// A place taken again comes at another hour: its plates tinted, its light to match, and its backdrop turned so another stretch of it shows. Channel multipliers.
const HOURS = {
  dusk: { tint: [1, .66, .5], sun: [1.05, .78, .58], sky: [.8, .64, .9], turn: Math.PI },
  night: { tint: [.38, .48, .8], sun: [.5, .6, .95], sky: [.42, .5, .85], turn: Math.PI / 2 },
};
const scaled = (hex, [r, g, b]) => (Math.min(255, Math.round((hex >> 16 & 255) * r)) << 16) | (Math.min(255, Math.round((hex >> 8 & 255) * g)) << 8) | Math.min(255, Math.round((hex & 255) * b));
// The floor plate mirrors out to three times its size, so a steep or far camera never runs off it onto the backdrop's own painted ground, which is drawn much larger.
const RADIUS = 150, BELOW = -.5, ABOVE = .8, FLOOR = 52;
// A cylinder seen from inside, its top and bottom rows pulled closed so no orbit finds an edge.
function backdropGeometry() {
  const sides = 48, rows = [[-1.05, 0], [BELOW, 0], [ABOVE, 1], [1.05, 1], [1.7, 1], [3, 1]], position = [], uv = [], index = [];
  rows.forEach(([height, v], row) => { const narrowing = row > 2 ? [0, 0, 0, .8, .4, .02][row] : row === 0 ? .4 : 1; for (let i = 0; i <= sides; i++) { const u = i / sides, a = (u - .5) * Math.PI * 2; position.push(Math.sin(a) * RADIUS * narrowing, height * RADIUS, -Math.cos(a) * RADIUS * narrowing); uv.push(u, v); } });
  for (let row = 0; row < rows.length - 1; row++) for (let i = 0; i < sides; i++) { const a = row * (sides + 1) + i, b = a + sides + 1; index.push(a, b, a + 1, a + 1, b, b + 1); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(index);
  return geometry;
}
function floorFade() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), gradient = context.createRadialGradient(128, 128, 128 * .62, 128, 128, 128 * .96);
  gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#000');
  context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export class PlatePainter {
  textures = new Map(); backdrop = backdropGeometry(); floor = new THREE.PlaneGeometry(FLOOR * 3, FLOOR * 3).rotateX(-Math.PI / 2); fade = floorFade(); loader = new THREE.TextureLoader();
  // `low` is the small, crunchy version for the PS1 look.
  texture(place, kind, low) {
    const key = `${place}-${kind}${low ? '-low' : ''}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const texture = this.loader.load(low ? `/fantasy/${key}.png` : `/fantasy/${key}.webp`);
    texture.colorSpace = THREE.NoColorSpace; texture.wrapS = kind === 'back' ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
    if (kind === 'floor') { texture.wrapT = THREE.MirroredRepeatWrapping; texture.repeat.set(3, 3); texture.offset.set(-1, -1); }
    if (low) { texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; } else { texture.anisotropy = 4; }
    this.textures.set(key, texture);
    return texture;
  }
  dress(scene, place, low, time) {
    const hour = HOURS[time], tint = new THREE.Color(...(hour?.tint ?? [1, 1, 1]));
    const back = new THREE.Mesh(this.backdrop, new THREE.MeshBasicMaterial({ map: this.texture(place, 'back', low), side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    back.renderOrder = -2; back.frustumCulled = false; back.rotation.y = hour?.turn ?? 0;
    const floor = new THREE.Mesh(this.floor, new THREE.MeshBasicMaterial({ map: this.texture(place, 'floor', low), alphaMap: this.fade, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    floor.renderOrder = -1;
    scene.add(back, floor);
    return { back, floor, tone(amount) { back.material.color.copy(tint).multiplyScalar(amount); floor.material.color.copy(tint).multiplyScalar(amount); }, setLook: isLow => { back.material.map = this.texture(place, 'back', isLow); floor.material.map = this.texture(place, 'floor', isLow); back.material.needsUpdate = floor.material.needsUpdate = true; } };
  }
  dispose() { for (const texture of this.textures.values()) texture.dispose(); this.backdrop.dispose(); this.floor.dispose(); this.fade.dispose(); }
}
export const lightOf = (place, time) => {
  const light = PLACES[place] || PLACES.reactor, hour = HOURS[time];
  return hour ? { ...light, fog: scaled(light.fog, hour.tint), sun: scaled(light.sun, hour.sun), sky: scaled(light.sky, hour.sky), bounce: scaled(light.bounce, hour.tint) } : light;
};
export const glowOf = place => raw((PLACES[place] || PLACES.reactor).glow);
