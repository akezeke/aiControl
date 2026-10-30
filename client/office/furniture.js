// Furniture and dressing: desk items, coffee cups, plants, the lounge, the coffee corner and what hangs on the walls.
// Most pieces are baked into one vertex-coloured geometry (one draw call plus its outline) and shared between copies.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial, withOutline } from './toon.js';

export const WALL_H = 3, WALL_T = 0.2;
export const shared = {};
export const once = (key, make) => shared[key] ??= make();
export const rounded = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, r);

export function mesh(geometry, material, outline = 0.01) {
  const m = new THREE.Mesh(geometry, material);
  return outline ? withOutline(m, outline) : m;
}

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  texture.redraw = (...args) => { draw(canvas.getContext('2d'), width, height, ...args); texture.needsUpdate = true; };
  texture.redraw();
  return texture;
}

// Bakes [geometry, colour, cell?] parts into one geometry with per-vertex colour; a part with an atlas cell shows that
// picture across its uvs, the rest sit on the atlas's white cell.
export function paint(parts) {
  return mergeGeometries(parts.map(([geometry, color, cell]) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry, c = new THREE.Color(color), count = g.attributes.position.count, colors = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    const [u0, v0, u1, v1] = cellRect(cell ?? 0);
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = cell == null ? (u0 + u1) / 2 : u0 + g.attributes.uv.getX(i) * (u1 - u0);
      uvs[i * 2 + 1] = cell == null ? (v0 + v1) / 2 : v0 + g.attributes.uv.getY(i) * (v1 - v0);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return g;
  }));
}
let paintMaterial;
export const painted = () => paintMaterial ??= Object.assign(toonMaterial('#ffffff', { vertexColors: true, map: atlasTexture() }), { userData: { shared: true } });
// A shared painted piece; `parts` only runs the first time.
export const piece = (key, parts, outline = 0.008) => mesh(once(key, () => paint(parts())), painted(), outline);

// Small helpers for building parts.
const box = (w, h, d, x, y, z, r = 0.01) => (r ? rounded(w, h, d, r) : new THREE.BoxGeometry(w, h, d)).translate(x, y, z);
const cyl = (top, bottom, h, x, y, z, n = 14) => new THREE.CylinderGeometry(top, bottom, h, n).translate(x, y, z);
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 8).scale(sx, sy, sz).translate(x, y, z);
// Deterministic jitter so copies of a piece look the same every load.
const jitter = (i, salt = 1) => { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };

// Things on a desk, in the desk's frame: the sitter is at -z.
export function deskItem(kind) {
  const leaves = ['#5cb85c', '#4a9e4a', '#6cc66c'];
  const make = {
    plant: () => [[cyl(0.07, 0.055, 0.12, 0, 0.06, 0), '#d9774b'], ...[[0, 0.2, 0, 0.08], [0.05, 0.16, 0.03, 0.06], [-0.05, 0.17, -0.02, 0.065]].map(([x, y, z, r], i) => [ball(r, x, y, z), leaves[i]])],
    mug: () => [[cyl(0.045, 0.04, 0.1, 0, 0.05, 0), '#f2f2f2'], [new THREE.TorusGeometry(0.03, 0.009, 6, 12).translate(0.05, 0.05, 0), '#f2f2f2'], [cyl(0.04, 0.04, 0.004, 0, 0.097, 0), '#5a3a22']],
    duck: () => [[ball(0.06, 0, 0.05, 0, 1, 0.85, 1.2), '#ffd93b'], [ball(0.04, 0, 0.12, -0.04), '#ffd93b'], [new THREE.ConeGeometry(0.018, 0.04, 8).rotateX(-Math.PI / 2).translate(0, 0.115, -0.085), '#ff8c1a']],
    // A family photo facing the sitter.
    frame: () => [[box(0.15, 0.12, 0.014, 0, 0.07, 0, 0.004), '#8c6a4f'], [new THREE.PlaneGeometry(0.12, 0.09).rotateY(Math.PI).translate(0, 0.07, -0.0075), '#ffffff', PHOTO]].map(([g, c, cell]) => [g.rotateX(0.2), c, cell]),
    cactus: () => [[cyl(0.05, 0.04, 0.08, 0, 0.04, 0), '#e8b07a'], [new THREE.CapsuleGeometry(0.035, 0.1, 4, 10).translate(0, 0.15, 0), '#4f9a5c'], [new THREE.CapsuleGeometry(0.018, 0.04, 4, 8).rotateZ(0.9).translate(0.045, 0.16, 0), '#4f9a5c'], [new THREE.CapsuleGeometry(0.016, 0.03, 4, 8).rotateZ(-0.9).translate(-0.042, 0.13, 0), '#4f9a5c'], [ball(0.012, 0, 0.225, 0), '#ff7aa8']],
    books: () => ['#d1495b', '#2e86ab', '#edae49'].map((color, i) => [box(0.2 - i * 0.02, 0.035, 0.14 - i * 0.01, 0, 0.018 + i * 0.036, 0, 0.004).rotateY((i - 1) * 0.2), color]),
  }[kind];
  return make ? loose(piece(`item-${kind}`, make, 0.006), kind) : new THREE.Group();
}
// Desk things can be picked up and thrown (props.js); `kind` says which.
const loose = (item, kind) => { item.userData.loose = kind; return item; };

// A takeaway coffee: paper cup, cardboard sleeve, lid.
export const coffeeCup = () => loose(piece('cup', () => [[cyl(0.04, 0.03, 0.12, 0, 0.06, 0), '#f4efe6'], [cyl(0.0385, 0.035, 0.045, 0, 0.065, 0), '#b07a4a'], [cyl(0.043, 0.043, 0.012, 0, 0.124, 0), '#ffffff'], [cyl(0.03, 0.038, 0.012, 0, 0.136, 0), '#ffffff']], 0.005), 'cup');

// Floor plants in three shapes.
export function plant(kind = 'bush') {
  return piece(`plant-${kind}`, () => {
    const parts = [[cyl(0.2, 0.15, 0.38, 0, 0.19, 0, 16), '#d9774b'], [cyl(0.21, 0.205, 0.05, 0, 0.38, 0, 16), '#c4673d'], [cyl(0.185, 0.185, 0.02, 0, 0.4, 0, 16), '#5a3d2b']];
    const greens = ['#4f9a4a', '#5cae4f', '#3f8a44', '#6cbf5a'];
    if (kind === 'snake') for (let i = 0; i < 8; i++) {
      const a = i * 2.4, r = 0.04 + jitter(i) * 0.09, tall = 0.55 + jitter(i, 2) * 0.45;
      parts.push([new THREE.ConeGeometry(0.06, tall, 5).scale(1, 1, 0.3).rotateY(a).translate(0, tall / 2, 0).rotateX(Math.cos(a) * 0.18).rotateZ(Math.sin(a) * 0.18).translate(Math.cos(a) * r, 0.39, Math.sin(a) * r), greens[i % 4]]);
    } else if (kind === 'tree') {
      parts.push([cyl(0.025, 0.035, 1.1, 0, 0.95, 0, 8), '#6b4423']);
      for (let i = 0; i < 9; i++) { const a = i * 2.1, r = 0.12 + jitter(i) * 0.1; parts.push([ball(0.16 + jitter(i, 3) * 0.08, Math.cos(a) * r, 1.25 + jitter(i, 4) * 0.5, Math.sin(a) * r), greens[i % 4]]); }
    } else for (let i = 0; i < 8; i++) { const a = i * 2.4, r = 0.1 + jitter(i) * 0.08; parts.push([ball(0.15 + jitter(i, 5) * 0.08, Math.cos(a) * r, 0.55 + jitter(i, 6) * 0.3, Math.sin(a) * r), greens[i % 4]]); }
    return parts;
  }, 0.01);
}

// Wall art: a few posters and pictures, drawn once.
const art = [
  (g, w, h) => { // ship it
    g.fillStyle = '#26315c'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff99'; for (let i = 0; i < 30; i++) g.fillRect(jitter(i) * w, jitter(i, 2) * h * 0.7, 3, 3);
    g.save(); g.translate(w / 2, h * 0.42); g.rotate(0.5);
    g.fillStyle = '#ff9f1c'; g.beginPath(); g.moveTo(-22, 70); g.lineTo(0, 130); g.lineTo(22, 70); g.fill();
    g.fillStyle = '#e63946'; g.beginPath(); g.moveTo(-34, 30); g.lineTo(-60, 80); g.lineTo(-30, 70); g.fill(); g.beginPath(); g.moveTo(34, 30); g.lineTo(60, 80); g.lineTo(30, 70); g.fill();
    g.fillStyle = '#f1f1f1'; g.beginPath(); g.ellipse(0, 0, 36, 82, 0, 0, 7); g.fill(); g.fillStyle = '#6ec3f4'; g.beginPath(); g.arc(0, -16, 15, 0, 7); g.fill(); g.restore();
    g.fillStyle = '#ffd166'; g.font = 'bold 58px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('SHIP IT', w / 2, h - 40);
  },
  (g, w, h) => { // mountains at sunrise
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#ff9a8b'); sky.addColorStop(0.6, '#ffd6a5'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(w * 0.62, h * 0.42, 46, 0, 7); g.fill();
    for (const [x, top, color] of [[0.3, 0.38, '#6d597a'], [0.75, 0.5, '#8e7aa8'], [0.5, 0.62, '#355070']]) { g.fillStyle = color; g.beginPath(); g.moveTo(w * (x - 0.6), h); g.lineTo(w * x, h * top); g.lineTo(w * (x + 0.6), h); g.fill(); }
  },
  (g, w, h) => { // five a day
    g.fillStyle = '#fdf0d5'; g.fillRect(0, 0, w, h);
    ['#e63946', '#f28c28', '#f9e04b', '#7cb518', '#7a3ea8'].forEach((color, i) => { const a = i / 5 * Math.PI * 2 - Math.PI / 2, x = w / 2 + Math.cos(a) * 70, y = h * 0.4 + Math.sin(a) * 70; g.fillStyle = color; g.beginPath(); g.arc(x, y, 34, 0, 7); g.fill(); g.fillStyle = '#4f9a2c'; g.beginPath(); g.ellipse(x + 8, y - 34, 10, 5, -0.5, 0, 7); g.fill(); });
    g.fillStyle = '#2f3542'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('5 A DAY', w / 2, h - 44);
  },
  (g, w, h) => { // mid-century shapes
    g.fillStyle = '#f4ecdf'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e07a5f'; g.beginPath(); g.arc(w * 0.35, h * 0.35, 70, 0, 7); g.fill();
    g.fillStyle = '#3d405b'; g.fillRect(w * 0.45, h * 0.3, 90, 170);
    g.fillStyle = '#81b29a'; g.beginPath(); g.arc(w * 0.55, h * 0.75, 80, Math.PI, 0); g.fill();
    g.fillStyle = '#f2cc8f'; g.beginPath(); g.arc(w * 0.25, h * 0.7, 30, 0, 7); g.fill();
  },
  (g, w, h) => { // sea and a sailing boat
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#8ecae6'); sky.addColorStop(1, '#e0f4ff'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#219ebc'; g.fillRect(0, h * 0.62, w, h); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(w * 0.5, h * 0.2); g.lineTo(w * 0.5, h * 0.55); g.lineTo(w * 0.7, h * 0.55); g.fill();
    g.fillStyle = '#9b2226'; g.beginPath(); g.moveTo(w * 0.36, h * 0.58); g.lineTo(w * 0.74, h * 0.58); g.lineTo(w * 0.68, h * 0.66); g.lineTo(w * 0.42, h * 0.66); g.fill();
    g.fillStyle = '#ffb703'; g.beginPath(); g.arc(w * 0.2, h * 0.22, 30, 0, 7); g.fill();
  },
  (g, w, h) => { // a big monstera leaf
    g.fillStyle = '#f1e9da'; g.fillRect(0, 0, w, h); g.fillStyle = '#2d6a4f'; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.32, h * 0.38, 0.4, 0, 7); g.fill();
    g.strokeStyle = '#f1e9da'; g.lineWidth = 10; for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + Math.cos(i * 0.45 + 0.4) * w, h / 2 + Math.sin(i * 0.45 + 0.4) * w); g.stroke(); }
  },
];
// The family on the desks' photos, drawn 4:3 and stretched to its cell (the photo is 4:3 again).
const photo = (g, w, h) => {
  g.scale(1, h / (w * 0.75)); h = w * 0.75;
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#7ec8f2'); sky.addColorStop(1, '#d8f0ff'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffd93b'; g.beginPath(); g.arc(w * 0.84, h * 0.2, 18, 0, 7); g.fill();
  g.fillStyle = '#7cc36a'; g.beginPath(); g.ellipse(w / 2, h * 1.08, w * 0.8, h * 0.4, 0, 0, 7); g.fill();
  for (const [x, y, r, color] of [[0.28, 0.58, 32, '#d62828'], [0.54, 0.54, 36, '#b5c934'], [0.76, 0.68, 22, '#f28c28']]) {
    g.fillStyle = '#6b4423'; g.fillRect(w * x - 2, h * y - r - 9, 4, 12);
    g.fillStyle = color; g.beginPath(); g.arc(w * x, h * y, r, 0, 7); g.fill();
    g.fillStyle = '#1b1a1f'; for (const s of [-1, 1]) { g.beginPath(); g.arc(w * x + s * r * 0.3, h * y - r * 0.15, r * 0.1, 0, 7); g.fill(); }
    g.strokeStyle = '#1b1a1f'; g.lineWidth = 3; g.beginPath(); g.arc(w * x, h * y, r * 0.4, 0.35, Math.PI - 0.35); g.stroke();
  }
};
// The art and the photo on one canvas, the painted material's map, so a picture is just more painted geometry and costs no
// draw call of its own. Cell 0 (at uv 0, 0) is white: what isn't a picture samples it and shows its vertex colour.
const sheet = [(g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }, ...art, photo], PHOTO = sheet.length - 1;
const CELL = [256, 320], COLS = 4, SIZE = [CELL[0] * COLS, CELL[1] * Math.ceil(sheet.length / COLS)];
// Cell k's [u0, v0, u1, v1], rows counted up from the bottom, inset a few texels so the neighbours don't bleed in.
const cellRect = k => {
  const x = (k % COLS) * CELL[0], y = Math.floor(k / COLS) * CELL[1], inset = 3;
  return [(x + inset) / SIZE[0], (y + inset) / SIZE[1], (x + CELL[0] - inset) / SIZE[0], (y + CELL[1] - inset) / SIZE[1]];
};
let atlas;
const atlasTexture = () => atlas ??= canvasTexture(...SIZE, g => sheet.forEach((draw, k) => {
  g.save(); g.translate((k % COLS) * CELL[0], SIZE[1] - (Math.floor(k / COLS) + 1) * CELL[1]);
  g.beginPath(); g.rect(0, 0, ...CELL); g.clip(); draw(g, ...CELL); g.restore();
}));
// A framed picture facing +z, its back on the wall.
export const picture = (i, w = 0.8, h = 1) => piece(`picture${i}:${w}x${h}`, () => [
  [rounded(w + 0.08, h + 0.08, 0.04, 0.015), ['#2f3542', '#8c6a4f', '#ffffff'][i % 3]], [new THREE.PlaneGeometry(w, h).translate(0, 0, 0.021), '#ffffff', 1 + i % art.length],
]);

// Lounge: a sofa, an armchair and a low table, each facing +z.
const cushion = '#e07a5f', cushionDark = '#c8664c';
export const sofa = () => piece('sofa', () => [
  [box(1.9, 0.26, 0.86, 0, 0.2, 0, 0.05), cushionDark], [box(0.86, 0.14, 0.68, -0.44, 0.39, 0.06, 0.05), cushion], [box(0.86, 0.14, 0.68, 0.44, 0.39, 0.06, 0.05), cushion],
  [box(1.9, 0.5, 0.22, 0, 0.55, -0.32, 0.07), cushion], [box(0.2, 0.48, 0.86, -0.85, 0.36, 0, 0.06), cushionDark], [box(0.2, 0.48, 0.86, 0.85, 0.36, 0, 0.06), cushionDark],
  [box(0.34, 0.3, 0.12, -0.55, 0.58, -0.16, 0.05).rotateZ(0.15), '#f2cc8f'], [box(0.34, 0.3, 0.12, 0.6, 0.58, -0.16, 0.05).rotateZ(-0.2), '#81b29a'],
  ...[[-0.85, -0.36], [0.85, -0.36], [-0.85, 0.36], [0.85, 0.36]].map(([x, z]) => [cyl(0.03, 0.025, 0.08, x, 0.04, z, 8), '#3a2a1e']),
]);
export const armchair = () => piece('armchair', () => [
  [box(0.86, 0.26, 0.82, 0, 0.2, 0, 0.05), cushionDark], [box(0.62, 0.14, 0.64, 0, 0.39, 0.06, 0.05), '#3d8b8b'], [box(0.86, 0.5, 0.2, 0, 0.55, -0.31, 0.07), '#3d8b8b'],
  [box(0.16, 0.46, 0.82, -0.35, 0.36, 0, 0.06), cushionDark], [box(0.16, 0.46, 0.82, 0.35, 0.36, 0, 0.06), cushionDark],
  ...[[-0.36, -0.34], [0.36, -0.34], [-0.36, 0.34], [0.36, 0.34]].map(([x, z]) => [cyl(0.03, 0.025, 0.08, x, 0.04, z, 8), '#3a2a1e']),
]);
export const lowTable = () => piece('lowTable', () => [
  [box(1.1, 0.05, 0.6, 0, 0.4, 0, 0.02), '#9b6a43'], ...[[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]].map(([x, z]) => [cyl(0.025, 0.02, 0.38, x, 0.19, z, 8), '#7a5236']),
  [box(0.26, 0.012, 0.2, -0.22, 0.432, 0.02, 0.003).rotateY(0.3), '#2e86ab'], [box(0.24, 0.012, 0.19, -0.2, 0.444, 0.03, 0.003).rotateY(0.1), '#edae49'],
  [cyl(0.04, 0.035, 0.09, 0.3, 0.47, -0.05), '#f2f2f2'], [ball(0.06, 0.05, 0.47, 0.1, 1.4, 0.5, 1), '#f7d23e'],
]);
export function floorLamp() {
  const group = new THREE.Group();
  group.add(piece('lampStand', () => [[cyl(0.16, 0.18, 0.03, 0, 0.015, 0, 20), '#2f3542'], [cyl(0.014, 0.014, 1.45, 0, 0.74, 0, 8), '#2f3542']], 0.006));
  const shade = mesh(once('lampShade', () => new THREE.CylinderGeometry(0.16, 0.24, 0.3, 20, 1, true)), new THREE.MeshBasicMaterial({ color: '#ffe9b8', side: THREE.DoubleSide }), 0.008); shade.position.y = 1.5; group.add(shade);
  return group;
}
// A rug with a border; `w`×`d` metres.
export function rug(w, d, color = '#6d9dc5', border = '#f2e8cf') {
  const texture = canvasTexture(256, Math.round(256 * d / w), (g, tw, th) => { g.fillStyle = border; g.fillRect(0, 0, tw, th); g.fillStyle = color; g.fillRect(14, 14, tw - 28, th - 28); g.strokeStyle = border; g.lineWidth = 4; g.strokeRect(30, 30, tw - 60, th - 60); });
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, 0.014, d, 2, 0.006), toonMaterial('#ffffff', { map: texture })); m.position.y = 0.007;
  return m;
}

// Coffee corner: a counter, its machine, mugs on a shelf above, and a water cooler.
export const counter = () => piece('counter', () => [
  [box(2, 0.86, 0.6, 0, 0.43, 0, 0.02), '#e8e1d4'], [box(2.06, 0.05, 0.66, 0, 0.885, 0.01, 0.015), '#7a5c46'],
  ...[-0.75, -0.25, 0.25, 0.75].map(x => [box(0.46, 0.7, 0.012, x, 0.42, 0.302, 0.004), '#ddd4c4']), ...[-0.55, -0.45, 0.45, 0.55].map(x => [box(0.02, 0.14, 0.02, x, 0.62, 0.315, 0.006), '#8a8f99']),
  // A kettle and a stack of cups.
  [cyl(0.08, 0.1, 0.2, 0.15, 1.01, -0.05, 16), '#d1495b'], [cyl(0.03, 0.03, 0.04, 0.15, 1.13, -0.05), '#2f3542'], ...[0, 1, 2, 3].map(i => [cyl(0.04, 0.03, 0.1, 0.55, 0.96 + i * 0.03, 0), '#f4efe6']),
]);
// The coffee machine and its cup, in the counter's frame (a piece of its own, so it can be outlined); userData.spout is where it pours.
export const coffeeMachine = () => Object.assign(piece('coffeeMachine', () => [
  [box(0.34, 0.44, 0.32, -0.5, 1.13, -0.04, 0.03), '#2f3542'], [box(0.36, 0.06, 0.34, -0.5, 1.37, -0.04, 0.02), '#c9ced8'], [box(0.1, 0.05, 0.08, -0.5, 1.06, 0.13, 0.01), '#c9ced8'],
  [box(0.26, 0.02, 0.14, -0.5, 0.92, 0.12, 0.005), '#8a8f99'], [cyl(0.035, 0.03, 0.08, -0.5, 0.97, 0.13), '#f2f2f2'], [ball(0.015, -0.4, 1.22, 0.115), '#5ee08a'],
]), { userData: { spout: new THREE.Vector3(-0.5, 1.03, 0.13) } });
export const mugShelf = () => piece('mugShelf', () => [
  [box(1.2, 0.04, 0.22, 0, 0, 0, 0.01), '#7a5c46'], ...['#e63946', '#2e86ab', '#f9e04b', '#7cb518', '#f2f2f2'].flatMap((color, i) => [[cyl(0.045, 0.04, 0.1, -0.44 + i * 0.22, 0.07, 0.01), color], [new THREE.TorusGeometry(0.03, 0.009, 6, 12).translate(-0.39 + i * 0.22, 0.07, 0.01), color]]),
]);
export const waterCooler = () => piece('cooler', () => [
  [box(0.34, 0.95, 0.34, 0, 0.475, 0, 0.03), '#e9eef2'], [cyl(0.13, 0.15, 0.36, 0, 1.15, 0, 16), '#9fd8f7'], [cyl(0.06, 0.13, 0.08, 0, 0.99, 0, 16), '#9fd8f7'],
  [box(0.04, 0.05, 0.04, -0.06, 0.78, 0.18, 0.008), '#2e86ab'], [box(0.04, 0.05, 0.04, 0.06, 0.78, 0.18, 0.008), '#e63946'], [box(0.24, 0.02, 0.1, 0, 0.62, 0.17, 0.006), '#8a8f99'],
]);

// Odds and ends.
export const bookshelf = () => piece('bookshelf', () => {
  const parts = [[box(0.9, 1.9, 0.04, 0, 0.95, -0.16, 0), '#9b6a43'], [box(0.04, 1.9, 0.36, -0.43, 0.95, 0, 0), '#9b6a43'], [box(0.04, 1.9, 0.36, 0.43, 0.95, 0, 0), '#9b6a43']];
  const colors = ['#d1495b', '#2e86ab', '#edae49', '#00798c', '#30638e', '#e07a5f', '#81b29a', '#3d405b'];
  for (let shelf = 0; shelf < 5; shelf++) {
    const y = 0.03 + shelf * 0.45; parts.push([box(0.86, 0.03, 0.34, 0, y, 0, 0), '#9b6a43']);
    if (shelf === 4) break;
    let x = -0.38; for (let i = 0; x < 0.32 - (shelf % 2) * 0.25; i++) { const w = 0.04 + jitter(i, shelf) * 0.04, h = 0.24 + jitter(i, shelf + 9) * 0.12; parts.push([box(w, h, 0.24, x + w / 2, y + 0.015 + h / 2, 0.02, 0.004), colors[(i + shelf * 3) % colors.length]]); x += w + 0.006; }
  }
  parts.push([cyl(0.06, 0.05, 0.1, 0.25, 1.92, 0), '#d9774b'], [ball(0.08, 0.25, 2.02, 0), '#5cae4f'], [ball(0.05, -0.2, 1.87, 0.02), '#f2c14e'], [cyl(0.05, 0.06, 0.04, -0.2, 1.83, 0.02), '#2f3542']);
  return parts;
});
export const printer = () => piece('printer', () => [
  [box(0.62, 0.62, 0.52, 0, 0.31, 0, 0.02), '#c9ced8'], [box(0.58, 0.012, 0.012, 0, 0.42, 0.262, 0), '#8a8f99'], [box(0.12, 0.02, 0.02, 0, 0.52, 0.265, 0.005), '#8a8f99'],
  [box(0.52, 0.26, 0.44, 0, 0.75, 0, 0.03), '#eef0f3'], [box(0.4, 0.02, 0.18, 0, 0.89, -0.06, 0.005), '#3a3d46'], [box(0.3, 0.01, 0.16, 0, 0.66, 0.24, 0.003), '#ffffff'], [ball(0.012, 0.2, 0.84, 0.22), '#5ee08a'],
]);
export const filingCabinet = () => piece('filing', () => [
  [box(0.46, 1.02, 0.56, 0, 0.51, 0, 0.02), '#8a96a8'], ...[0.2, 0.52, 0.84].flatMap(y => [[box(0.4, 0.28, 0.012, 0, y, 0.282, 0.004), '#9ba7b8'], [box(0.12, 0.025, 0.025, 0, y + 0.06, 0.295, 0.008), '#3a3d46']]),
]);
export const coatRack = () => piece('coatRack', () => [
  [cyl(0.2, 0.24, 0.04, 0, 0.02, 0, 16), '#5a3d2b'], [cyl(0.025, 0.03, 1.75, 0, 0.9, 0, 8), '#7a5236'], [ball(0.04, 0, 1.79, 0), '#7a5236'],
  ...[0, 1, 2, 3].map(i => [new THREE.CapsuleGeometry(0.012, 0.12, 4, 6).rotateZ(Math.PI / 2 - 0.5).translate(0.06, 1.68, 0).rotateY(i * Math.PI / 2), '#7a5236']),
  [box(0.36, 0.7, 0.14, 0.02, 1.32, 0.12, 0.06), '#3d5a80'], [box(0.08, 0.5, 0.02, -0.08, 1.38, 0.19, 0.01), '#e63946'],
]);
export const extinguisher = () => piece('extinguisher', () => [
  [cyl(0.085, 0.085, 0.46, 0, 0.23, 0.1, 16), '#d62828'], [cyl(0.03, 0.04, 0.06, 0, 0.49, 0.1, 10), '#2f3542'], [box(0.14, 0.02, 0.03, 0.02, 0.53, 0.1, 0.006), '#2f3542'],
  [new THREE.TorusGeometry(0.1, 0.012, 6, 14, Math.PI).rotateY(Math.PI / 2).translate(0.09, 0.4, 0.1), '#1b1a1f'], [box(0.1, 0.06, 0.04, 0, 0.36, 0.02, 0.005), '#3a3d46'],
]);

// The ceiling lamps' soft glow, and the soft dark patch under furniture.
let glow, softShadow;
export const glowTexture = () => glow ??= canvasTexture(64, 64, (g, w) => { const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); grad.addColorStop(0, 'rgba(255,236,190,0.4)'); grad.addColorStop(0.35, 'rgba(255,236,190,0.14)'); grad.addColorStop(1, 'rgba(255,236,190,0)'); g.fillStyle = grad; g.fillRect(0, 0, w, w); });
export const shadowTexture = () => softShadow ??= canvasTexture(64, 64, (g, w) => { g.fillStyle = '#000'; for (let i = 0; i < 12; i++) { g.globalAlpha = 0.09; g.beginPath(); g.roundRect(2 + i * 2, 2 + i * 2, w - 4 - i * 4, w - 4 - i * 4, 14 - i); g.fill(); } });
// A soft shadow on the floor, `w`×`d` metres; it sits just above the rugs.
const shadowMaterials = {};
export function floorShadow(w, d, opacity = 0.35) {
  const material = shadowMaterials[opacity] ??= new THREE.MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, opacity, depthWrite: false, userData: { shared: true } });
  const m = new THREE.Mesh(once('shadowPlane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), material);
  m.scale.set(w, 1, d); m.position.y = 0.016; m.raycast = () => {};
  return m;
}
