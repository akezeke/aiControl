// Fruit characters, after the concept art: a smooth fruit body with a drawn-on face, thin black noodle limbs,
// cartoon hands and rounded shoes. This is the only module that knows how a character is built.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial, withOutline } from './toon.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
export const LEG = 0.56;            // hip to floor when standing
const LIMB_R = 0.02, TUBE = 14, RADIAL = 7;
const INK = '#1b1a1f', LIMB = '#26252b', ROT = new THREE.Color('#5c3c1c'); // ROT: what wear browns the skin toward

// Profiles run bottom to top as [radius, height]; a Catmull-Rom pass smooths them before lathing.
const profiles = {
  apple: [[0, 0.02], [0.1, 0], [0.21, 0.05], [0.29, 0.17], [0.32, 0.33], [0.31, 0.49], [0.25, 0.62], [0.14, 0.68], [0.05, 0.64], [0, 0.61]],
  pear: [[0, 0], [0.19, 0.015], [0.3, 0.12], [0.31, 0.27], [0.24, 0.42], [0.16, 0.55], [0.12, 0.66], [0.06, 0.72], [0, 0.73]],
  orange: Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + Math.PI * i / 12; return [Math.max(0, Math.cos(a) * 0.34), 0.34 + Math.sin(a) * 0.34]; }),
  lemon: [[0, -0.02], [0.05, 0.01], [0.17, 0.07], [0.26, 0.2], [0.28, 0.33], [0.25, 0.46], [0.15, 0.58], [0.05, 0.64], [0, 0.67]],
  eggplant: [[0, 0], [0.2, 0.02], [0.31, 0.14], [0.31, 0.3], [0.24, 0.46], [0.17, 0.6], [0.13, 0.72], [0.06, 0.78], [0, 0.79]],
  strawberry: [[0, 0], [0.06, 0.02], [0.16, 0.13], [0.26, 0.3], [0.31, 0.45], [0.28, 0.55], [0.14, 0.6], [0, 0.6]],
  // The boss only.
  pineapple: [[0, 0], [0.18, 0.02], [0.29, 0.14], [0.32, 0.32], [0.3, 0.5], [0.22, 0.64], [0.1, 0.69], [0, 0.7]],
};
// Banana: a bent tube, fattest in the middle; `curve` is its spine.
const bananaSpine = new THREE.CatmullRomCurve3([V(-0.02, 0.0), V(0.11, 0.2), V(0.14, 0.42), V(0.08, 0.66), V(-0.06, 0.86)]);
const bananaRadius = t => 0.035 + 0.13 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7);

// Vertices at one position (a seam, a pole) share the average of their normals, so the skin shades as one surface.
function shareNormals(geometry) {
  const { position, normal } = geometry.attributes, at = new Map(), n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) { const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1e5)).join(); (at.get(key) || at.set(key, []).get(key)).push(i); }
  for (const same of at.values()) {
    if (same.length < 2) continue;
    n.set(0, 0, 0); for (const i of same) n.x += normal.getX(i), n.y += normal.getY(i), n.z += normal.getZ(i);
    n.normalize(); for (const i of same) normal.setXYZ(i, n.x, n.y, n.z);
  }
}

function smooth(points, count = 28) {
  const curve = new THREE.CatmullRomCurve3(points.map(([r, y]) => V(r, y)));
  return curve.getPoints(count).map(p => new THREE.Vector2(Math.max(0, p.x), p.y));
}

// Each body: geometry plus a `surface(y)` → { x, r } (centre offset and radius at height y) so the face and clothes sit on it.
const bodies = new Map();
function bodyShape(fruit) {
  if (bodies.has(fruit)) return bodies.get(fruit);
  let shape;
  if (fruit === 'banana') {
    // A unit tube bent along the spine, its rings scaled to the radius, then each end rounded off with rings shrinking to a point.
    const RINGS = 40, SIDES = 20, CAP = 5, ring = SIDES + 1;
    const tube = new THREE.TubeGeometry(bananaSpine, RINGS, 1, SIDES, false), position = tube.attributes.position, centre = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= RINGS; i++) {
      bananaSpine.getPoint(i / RINGS, centre);
      for (let j = 0; j <= SIDES; j++) { const k = i * ring + j; v.fromBufferAttribute(position, k).sub(centre).multiplyScalar(bananaRadius(i / RINGS)).add(centre); position.setXYZ(k, v.x, v.y, v.z); }
    }
    const points = [...position.array], uvs = [...tube.attributes.uv.array], index = [...tube.index.array];
    for (const end of [0, 1]) {
      const base = end * RINGS * ring, out = bananaSpine.getTangent(end).multiplyScalar(end ? 1 : -1), r = bananaRadius(end);
      bananaSpine.getPoint(end, centre);
      let previous = base;
      for (let k = 1; k <= CAP; k++) {
        const angle = k / CAP * Math.PI / 2, first = points.length / 3;
        for (let j = 0; j <= SIDES; j++) {
          v.fromArray(points, (base + j) * 3).sub(centre).multiplyScalar(Math.cos(angle)).add(centre).addScaledVector(out, r * Math.sin(angle));
          points.push(v.x, v.y, v.z); uvs.push(end, j / SIDES);
        }
        // Same winding as the tube's own rings: the far end carries on along it, the near end runs backwards.
        for (let j = 0; j < SIDES; j++) {
          const [a0, a1, b0, b1] = end ? [previous + j, previous + j + 1, first + j, first + j + 1] : [first + j, first + j + 1, previous + j, previous + j + 1];
          index.push(a0, b0, a1, b0, b1, a1);
        }
        previous = first;
      }
    }
    tube.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(index);
    geometry.computeVertexNormals(); shareNormals(geometry);
    const spine = bananaSpine.getSpacedPoints(60);
    shape = { geometry, height: 0.86, surface: y => { const found = spine.findIndex(p => p.y >= y), t = found < 0 ? 60 : found; return { x: spine[t].x, r: bananaRadius(t / 60) }; } };
  } else {
    const points = smooth(profiles[fruit]);
    const geometry = new THREE.LatheGeometry(points, 40);
    const surface = y => {
      for (let i = 1; i < points.length; i++) if (points[i].y >= y && points[i - 1].y <= y) { const a = points[i - 1], b = points[i], k = (y - a.y) / ((b.y - a.y) || 1); return { x: 0, r: a.x + (b.x - a.x) * k }; }
      return { x: 0, r: 0.05 };
    };
    shape = { geometry, height: points.at(-1).y, surface };
  }
  bodies.set(fruit, shape);
  return shape;
}

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
const textures = {};
const peel = () => textures.peel ??= canvasTexture(128, (g, n) => { g.fillStyle = '#808080'; g.fillRect(0, 0, n, n); for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.5 ? '#6a6a6a' : '#999'; g.beginPath(); g.arc(Math.random() * n, Math.random() * n, 1 + Math.random() * 1.5, 0, 7); g.fill(); } });
const seeds = color => textures[`seeds${color}`] ??= canvasTexture(128, (g, n) => {
  g.fillStyle = color; g.fillRect(0, 0, n, n); g.fillStyle = '#f6e27a';
  for (let y = 6; y < n; y += 16) for (let x = (y / 16 % 2) * 8 + 4; x < n; x += 16) { g.beginPath(); g.ellipse(x, y, 1.8, 3, 0, 0, 7); g.fill(); }
});
const stripes = () => textures.tie ??= canvasTexture(64, (g, n) => {
  g.fillStyle = '#3d4f8c'; g.fillRect(0, 0, n, n); g.strokeStyle = '#c9d2ee'; g.lineWidth = 4;
  for (let i = -n; i < n * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + n, n); g.stroke(); }
});

// Bruises for a tired fruit: speckles and soft spots of different strengths, so lowering the alpha test first freckles the skin,
// then adds spots and grows them; the strongest spots get dark cores from a second, stricter test.
function bruises() {
  if (textures.bruises) return textures.bruises;
  const texture = textures.bruises = canvasTexture(256, (g, n) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, n, n); g.globalCompositeOperation = 'lighten';
    const spot = (r, low, high) => {
      const x = Math.random() * n, y = Math.random() * n, v = Math.round(low + Math.random() * (high - low));
      for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { // drawn again across the edges so the texture tiles
        const fill = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); fill.addColorStop(0.35, `rgb(${v},${v},${v})`); fill.addColorStop(1, '#000'); // a flat core, so a spot shows up already sized
        g.fillStyle = fill; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    };
    for (let i = 0; i < 170; i++) spot(5 + Math.random() * 4, 110, 235);
    for (let i = 0; i < 26; i++) spot(10 + Math.random() * 20, 115, 250);
  });
  texture.colorSpace = THREE.NoColorSpace; texture.repeat.set(2.5, 1.5);
  return texture;
}
// A banana goes black from the ends in (u runs along it, the caps sit at 0 and 1).
const tipFade = () => textures.tipFade ??= Object.assign(canvasTexture(64, (g, n) => {
  const fade = g.createLinearGradient(0, 0, n, 0); fade.addColorStop(0, '#fff'); fade.addColorStop(0.3, '#000'); fade.addColorStop(0.7, '#000'); fade.addColorStop(1, '#fff');
  g.fillStyle = fade; g.fillRect(0, 0, n, n);
}), { colorSpace: THREE.NoColorSpace });

const diamonds = () => textures.pineapple ??= canvasTexture(128, (g, n) => {
  g.fillStyle = '#f2b632'; g.fillRect(0, 0, n, n); g.strokeStyle = '#b97d1c'; g.lineWidth = 4;
  for (let i = -n; i < n * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + n, n); g.stroke(); g.beginPath(); g.moveTo(i + n, 0); g.lineTo(i, n); g.stroke(); }
});
function bodyMaterial(fruit, color) {
  if (fruit === 'orange') return toonMaterial(color, { bumpMap: peel(), bumpScale: 1.2 });
  if (fruit === 'pineapple') { const map = diamonds().clone(); map.repeat.set(4, 2); map.needsUpdate = true; return toonMaterial('#ffffff', { map }); }
  if (fruit === 'strawberry') { const map = seeds(color).clone(); map.repeat.set(3, 2); map.needsUpdate = true; return toonMaterial('#ffffff', { map }); }
  return toonMaterial(color).clone(); // its own, since wear browns it
}

// Black parts shared by every fruit.
let hand, shoe, fly;
const flyGeometry = () => fly ??= new THREE.SphereGeometry(0.017, 6, 4);
export function handGeometry() {
  if (hand) return hand;
  const parts = [new THREE.SphereGeometry(0.042, 14, 10).scale(1, 0.8, 1.1)];
  for (const [x, len] of [[-0.024, 0.05], [0, 0.058], [0.024, 0.05]]) parts.push(new THREE.CapsuleGeometry(0.012, len, 4, 8).translate(x, 0, 0).rotateX(Math.PI / 2).translate(0, 0, 0.045 + len / 2 - 0.01));
  parts.push(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8).rotateZ(Math.PI / 2.6).translate(-0.045, 0.012, 0.02));
  return hand = mergeGeometries(parts.map(g => g.toNonIndexed()));
}
const shoeGeometry = () => shoe ??= new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8).scale(1, 0.75, 1.7).translate(0, -0.012, 0.035);

// A noodle limb: a tube along a quadratic bezier, rewritten in place each update with the same layout as TubeGeometry.
class Limb {
  constructor(material, radius) {
    this.radius = radius;
    this.curve = new THREE.QuadraticBezierCurve3(V(0, 0), V(0, 0), V(0, 0));
    this.mesh = new THREE.Mesh(new THREE.TubeGeometry(this.curve, TUBE, radius, RADIAL), material);
    this.mesh.frustumCulled = false;
    this.last = null;
  }
  set(from, bend, to) {
    const key = `${from.x.toFixed(3)},${from.y.toFixed(3)},${from.z.toFixed(3)},${to.x.toFixed(3)},${to.y.toFixed(3)},${to.z.toFixed(3)},${bend.x.toFixed(3)},${bend.y.toFixed(3)},${bend.z.toFixed(3)}`;
    if (key === this.last) return;
    this.last = key;
    this.curve.v0.copy(from); this.curve.v2.copy(to); this.curve.v1.copy(from).add(to).multiplyScalar(0.5).add(bend);
    this.curve.updateArcLengths(); // getPointAt and the frames read a cached length table
    const { tangents, normals, binormals } = this.curve.computeFrenetFrames(TUBE, false), position = this.mesh.geometry.attributes.position, normal = this.mesh.geometry.attributes.normal, p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i <= TUBE; i++) {
      this.curve.getPointAt(i / TUBE, p);
      for (let j = 0; j <= RADIAL; j++) {
        const a = j / RADIAL * Math.PI * 2;
        n.copy(normals[i]).multiplyScalar(-Math.cos(a)).addScaledVector(binormals[i], Math.sin(a)).normalize();
        const k = i * (RADIAL + 1) + j;
        normal.setXYZ(k, n.x, n.y, n.z); position.setXYZ(k, p.x + n.x * this.radius, p.y + n.y * this.radius, p.z + n.z * this.radius);
      }
    }
    position.needsUpdate = normal.needsUpdate = true;
    this.end = tangents[TUBE];
  }
}

function arc(points, radius = 0.007) {
  const curve = points.length === 3 ? new THREE.QuadraticBezierCurve3(...points) : new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 12, radius, 5);
}

export function createFruit({ fruit, color, accessory }, { scale = 1 } = {}) {
  const shape = bodyShape(fruit), ink = toonMaterial(INK), limbMaterial = toonMaterial(LIMB), own = [];
  const group = new THREE.Group(), body = new THREE.Group();
  group.add(body); group.scale.setScalar(scale);
  body.position.y = LEG;

  const colorMaterial = bodyMaterial(fruit, color), fresh = colorMaterial.color.clone(), fruitMesh = withOutline(new THREE.Mesh(shape.geometry, colorMaterial));
  fruitMesh.userData.part = 'body'; body.add(fruitMesh); own.push(colorMaterial);
  const h = shape.height;
  // Where something sits on the front of the body: `angle` around the vertical, `y` up the body, `out` off the skin.
  const onSkin = (angle, y, out = 0.004) => { const { x, r } = shape.surface(y); return V(x + Math.sin(angle) * (r + out), y, Math.cos(angle) * (r + out)); };

  // Stems, leaves and caps.
  const green = toonMaterial('#4f9a2c'), brown = toonMaterial('#6b4423');
  const add = (geometry, material, outline = true) => { const mesh = new THREE.Mesh(geometry, material); own.push(geometry); body.add(outline ? withOutline(mesh, 0.008) : mesh); return mesh; };
  if (fruit === 'apple' || fruit === 'pear') {
    add(arc([V(0, h - 0.06), V(0.01, h + 0.06), V(-0.03, h + 0.12)], 0.016), brown);
    if (fruit === 'apple') { const leaf = add(new THREE.SphereGeometry(0.07, 12, 8).scale(1, 0.18, 0.5), green); leaf.position.set(0.07, h + 0.08, 0); leaf.rotation.z = 0.5; }
  } else if (fruit === 'pineapple') {
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, tall = i % 2 ? 0.2 : 0.3, leaf = add(new THREE.ConeGeometry(0.04, tall, 6).translate(0, tall / 2, 0), green);
      leaf.position.set(Math.cos(a) * 0.04, h - 0.02, Math.sin(a) * 0.04); leaf.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    }
  } else if (fruit === 'orange') add(new THREE.SphereGeometry(0.03, 10, 6).scale(1, 0.4, 1).translate(0, h, 0), green);
  else if (fruit === 'eggplant' || fruit === 'strawberry') {
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, leaf = add(new THREE.SphereGeometry(0.075, 10, 6).scale(1, 0.15, 0.45).translate(0.06, 0, 0), green);
      leaf.position.set(0, h - (fruit === 'eggplant' ? 0.035 : 0.01), 0); leaf.rotation.set(0, a, -0.35);
    }
    add(new THREE.CylinderGeometry(0.018, 0.025, 0.09, 8).translate(0, h + 0.03, 0), fruit === 'eggplant' ? green : toonMaterial('#3f7d22'));
  } else if (fruit === 'banana') {
    const tip = bananaSpine.getPoint(1), base = bananaSpine.getPoint(0);
    add(new THREE.CylinderGeometry(0.02, 0.028, 0.07, 8).translate(0, 0.03, 0), brown).position.copy(tip);
    add(new THREE.SphereGeometry(0.03, 8, 6), brown, false).position.copy(base);
  }

  // Face: small black eyes, brows and a mouth, a little above the middle of the body like in the concept art.
  const faceY = h * (fruit === 'banana' ? 0.72 : fruit === 'strawberry' ? 0.5 : 0.6), spread = fruit === 'banana' ? 0.36 : 0.27;
  const face = new THREE.Group(); body.add(face);
  const eyeGeometry = new THREE.SphereGeometry(0.042, 14, 10).scale(0.72, 1.12, 0.45); own.push(eyeGeometry);
  const eyes = [-1, 1].map(side => { const eye = new THREE.Mesh(eyeGeometry, ink); face.add(eye); eye.userData.side = side; return eye; });
  const placeEyes = (dx = 0, dy = 0) => eyes.forEach(eye => { eye.position.copy(onSkin(eye.userData.side * spread + dx, faceY + dy, -0.004)); eye.lookAt(eye.position.clone().setY(eye.position.y).multiplyScalar(2).setY(eye.position.y)); });
  placeEyes();
  let lines = [];
  const setExpression = name => {
    for (const mesh of lines) { face.remove(mesh); mesh.geometry.dispose(); }
    lines = [];
    const line = (points, radius) => { const mesh = new THREE.Mesh(arc(points, radius), ink); face.add(mesh); lines.push(mesh); };
    const browY = faceY + 0.085, mouthY = faceY - 0.085, s = spread;
    // Each brow: inner/outer heights; mouth: corner and middle heights (middle below corners = smile).
    const shapes = {
      smile: { brows: [0, 0], mouth: [0, -0.03], width: 0.17 },
      worried: { brows: [0.02, -0.012], mouth: [-0.012, 0.006], width: 0.1 },
      curious: { brows: [0, 0], raise: 0.025, mouth: [0, 0], width: 0.07 },
      frown: { brows: [-0.02, 0.01], mouth: [-0.02, 0.012], width: 0.11 },
      neutral: { brows: [0, 0], mouth: [0, -0.008], width: 0.09 },
      // One brow up, a small flat mouth pushed to one side and slanted: "hmm".
      thinking: { brows: [-0.01, 0.004], raise: 0.03, mouth: [0, 0], width: 0.06, shift: 0.1, slant: 0.012 },
      asleep: { brows: [0, 0], mouth: null, width: 0 },
    }[name] || {};
    for (const side of [-1, 1]) {
      const [inner, outer] = shapes.brows || [0, 0], raise = side === 1 ? shapes.raise || 0 : 0;
      line([onSkin(side * (s - 0.07), browY + inner + raise), onSkin(side * s, browY + 0.012 + (inner + outer) / 2 + raise), onSkin(side * (s + 0.07), browY + outer + raise)], 0.006);
    }
    eyes.forEach(eye => { eye.visible = name !== 'asleep'; });
    if (name === 'asleep') {
      for (const side of [-1, 1]) line([onSkin(side * s - 0.05, faceY), onSkin(side * s, faceY - 0.022), onSkin(side * s + 0.05, faceY)], 0.007);
      const o = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.006, 6, 14), ink); o.position.copy(onSkin(0, mouthY, 0)); o.lookAt(o.position.clone().multiplyScalar(2).setY(o.position.y)); face.add(o); lines.push(o);
    } else if (shapes.mouth) {
      const [corner, middle] = shapes.mouth, half = shapes.width / 2 / Math.max(0.15, shape.surface(mouthY).r), { shift = 0, slant = 0 } = shapes;
      line([onSkin(shift - half, mouthY + corner - slant), onSkin(shift, mouthY + middle * 2), onSkin(shift + half, mouthY + corner + slant)], 0.007);
    }
  };
  setExpression('smile');

  // Wear: the skin browns and bruises (a banana's ends go black), then come bags under the eyes, heavy lids and flies.
  const overlay = (color, alphaMap, offset) => {
    const mesh = new THREE.Mesh(shape.geometry, toonMaterial(color, { alphaMap, alphaTest: 1, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }));
    mesh.visible = false; mesh.raycast = () => {}; own.push(mesh.material); body.add(mesh); return mesh;
  };
  const spots = overlay('#7a4a1c', bruises(), -2), rot = overlay('#3b2414', bruises(), -3), tips = fruit === 'banana' ? overlay('#2e1f10', tipFade(), -3) : null;
  const flies = [0, 1, 2].map(() => { const fly = new THREE.Mesh(flyGeometry(), ink); fly.visible = false; body.add(fly); return fly; }), buzzX = shape.surface(h * 0.9).x;
  const bagMaterial = toonMaterial('#6a5470'), bagHalf = 0.034 / shape.surface(faceY).r;
  let bags = [], droop = 1, blink = 1;
  const setWear = wear => {
    for (const mesh of bags) { face.remove(mesh); mesh.geometry.dispose(); }
    bags = [];
    // Front-loaded, so even a mildly tired fruit looks it.
    const age = Math.min(1, wear * 1.6);
    colorMaterial.color.copy(fresh).lerp(ROT, age * 0.6);
    spots.visible = wear > 0.05; spots.material.alphaTest = 1 - age * 0.8;
    rot.visible = wear > 0.25; rot.material.alphaTest = 1 - (wear - 0.2) * 0.75;
    if (tips) { tips.visible = wear > 0.15; tips.material.alphaTest = 1 - age * 0.75; }
    flies.forEach(fly => { fly.visible = wear >= 0.7; });
    for (let level = 0; level < (wear >= 0.75 ? 2 : wear >= 0.4 ? 1 : 0); level++) for (const side of [-1, 1]) {
      const y = faceY - 0.058 - level * 0.016, mesh = new THREE.Mesh(arc([onSkin(side * spread - bagHalf, y + 0.008), onSkin(side * spread, y - 0.006), onSkin(side * spread + bagHalf, y + 0.008)], 0.0045), bagMaterial);
      face.add(mesh); bags.push(mesh);
    }
    droop = 1 - Math.max(0, wear - 0.3) * 0.55;
    eyes.forEach(eye => { eye.scale.y = Math.max(0.1, blink * droop); });
  };

  // Accessories.
  if (accessory === 'glasses') {
    const rim = new THREE.TorusGeometry(0.06, 0.007, 6, 24), lensGeometry = new THREE.CircleGeometry(0.058, 20), lens = new THREE.MeshBasicMaterial({ color: '#dff3ff', transparent: true, opacity: 0.25 }); own.push(rim, lensGeometry, lens);
    const rimMaterial = toonMaterial('#7a4b3a');
    for (const side of [-1, 1]) {
      const at = onSkin(side * spread, faceY, 0.03), ring = new THREE.Mesh(rim, rimMaterial), glass = new THREE.Mesh(lensGeometry, lens);
      for (const m of [ring, glass]) { m.position.copy(at); m.lookAt(at.clone().multiplyScalar(2).setY(at.y)); face.add(m); }
    }
    face.add(new THREE.Mesh(arc([onSkin(-spread + 0.07, faceY + 0.01, 0.032), onSkin(0, faceY + 0.025, 0.036), onSkin(spread - 0.07, faceY + 0.01, 0.032)], 0.006), rimMaterial));
    for (const side of [-1, 1]) face.add(new THREE.Mesh(arc([onSkin(side * (spread + 0.06), faceY, 0.028), onSkin(side * 1.2, faceY + 0.01, 0.01), onSkin(side * 1.6, faceY - 0.01, -0.01)], 0.006), rimMaterial));
  } else if (accessory === 'tie') {
    const collarY = faceY - 0.14, { x, r } = shape.surface(collarY), tieMaterial = toonMaterial('#ffffff', { map: stripes() });
    const collar = new THREE.Mesh(new THREE.TorusGeometry(r + 0.008, 0.014, 6, 40).rotateX(Math.PI / 2).translate(x, collarY, 0), tieMaterial); own.push(collar.geometry); body.add(collar);
    const blade = new THREE.Shape([new THREE.Vector2(-0.03, 0), new THREE.Vector2(0.03, 0), new THREE.Vector2(0.045, -0.15), new THREE.Vector2(0, -0.19), new THREE.Vector2(-0.045, -0.15)]);
    const tie = new THREE.Mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 }), tieMaterial); own.push(tie.geometry);
    tie.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 8; });
    const top = onSkin(0, collarY - 0.01, 0.006), bottom = onSkin(0, collarY - 0.18, 0.006);
    // Tilt so the blade's lower end follows the skin: rotating about x moves (0, -L, 0) to z = -L·sin(a).
    tie.position.copy(top); tie.rotation.x = Math.atan2(top.z - bottom.z, top.y - bottom.y); body.add(withOutline(tie, 0.006));
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8).scale(1, 0.9, 0.6), tieMaterial); own.push(knot.geometry); knot.position.copy(onSkin(0, collarY, 0.012)); body.add(withOutline(knot, 0.006));
  }

  // Limbs. Anchors start inside the body so no join ever shows. Facing +z, the left side is +x.
  const shoulderY = h * (fruit === 'banana' ? 0.42 : 0.4), hipY = Math.min(0.06, h * 0.1);
  const anchor = {
    leftHand: () => { const { x, r } = shape.surface(shoulderY); return V(x + r - 0.05, shoulderY, 0); },
    rightHand: () => { const { x, r } = shape.surface(shoulderY); return V(x - r + 0.05, shoulderY, 0); },
    leftFoot: () => V(shape.surface(hipY + 0.04).x + 0.09, hipY + 0.03, 0),
    rightFoot: () => V(shape.surface(hipY + 0.04).x - 0.09, hipY + 0.03, 0),
  };
  const limbs = {}, ends = {}, hands = { leftHand: 1, rightHand: -1 };
  for (const name of Object.keys(anchor)) {
    limbs[name] = new Limb(limbMaterial, name.endsWith('Foot') ? LIMB_R * 1.1 : LIMB_R); own.push(limbs[name].mesh.geometry); group.add(limbs[name].mesh);
    ends[name] = new THREE.Mesh(name in hands ? handGeometry() : shoeGeometry(), limbMaterial); group.add(ends[name]);
  }
  ends.rightHand.scale.x = -1; // the hand mesh is a left hand
  const from = new THREE.Vector3(), bend = new THREE.Vector3(), q = new THREE.Quaternion(), forward = V(0, 0, 1);
  const setLimbs = targets => {
    body.updateMatrix();
    for (const [name, to] of Object.entries(targets)) {
      from.copy(anchor[name]()).applyMatrix4(body.matrix);
      const arm = name in hands, side = arm ? hands[name] : name === 'leftFoot' ? 1 : -1;
      // Arms bow outward and down; legs bend a little forward at the knee.
      if (arm) bend.set(side * 0.07, -0.06, 0.02); else bend.set(side * 0.02, 0, 0.06);
      limbs[name].set(from, bend, to);
      const end = ends[name]; end.position.copy(to);
      if (arm) { q.setFromUnitVectors(forward, limbs[name].end); end.quaternion.copy(q); }
      else end.rotation.set(-Math.min(1, Math.max(0, to.y - 0.1) * 2), 0, 0); // a foot up off the floor rests on its heel, toes up
    }
  };
  // Hands hang a little out from the shoulders; feet sit under the hips.
  const shoulder = name => anchor[name]().add(body.position);
  const rest = { leftHand: shoulder('leftHand').add(V(0.12, -0.32, 0.04)), rightHand: shoulder('rightHand').add(V(-0.12, -0.32, 0.04)), leftFoot: V(anchor.leftFoot().x + 0.02, 0.03, 0), rightFoot: V(anchor.rightFoot().x - 0.02, 0.03, 0) };
  setLimbs(rest);

  return {
    group, body, height: h, surface: shape.surface, rest, faceY,
    setBody({ y = LEG, tilt = 0, lean = 0, turn = 0 } = {}) { body.position.y = y; body.rotation.set(lean, turn, tilt); },
    setLimbs, setExpression, setWear,
    // Offline sessions turn grey; the colour comes back when they do.
    // Flies loop around a worn-out head; t is seconds, frozen with reduced motion.
    buzz(t) {
      if (!flies[0].visible) return;
      flies.forEach((fly, i) => { const a = t * (2.4 + i * 0.9) + i * 2.1; fly.position.set(buzzX + Math.sin(a) * 0.24 + Math.sin(a * 3.1) * 0.04, h + 0.1 + Math.sin(a * 1.7 + i) * 0.07, Math.cos(a) * 0.24); });
    },
    setGrey(on) { fruitMesh.material = on ? toonMaterial('#9b9a97') : colorMaterial; },
    setBlink(open) { if (open === blink) return; blink = open; eyes.forEach(eye => { eye.scale.y = Math.max(0.1, open * droop); }); },
    // Eyes slide a little toward a point given in the fruit's local space; null looks ahead.
    lookAt(point) { if (!point) { placeEyes(); return; } const dx = THREE.MathUtils.clamp(Math.atan2(point.x, point.z) * 0.25, -0.12, 0.12), dy = THREE.MathUtils.clamp((point.y - body.position.y - faceY) * 0.05, -0.02, 0.02); placeEyes(dx, dy); },
    dispose() { group.removeFromParent(); for (const mesh of [...lines, ...bags]) mesh.geometry.dispose(); for (const item of own) item.dispose(); },
  };
}
