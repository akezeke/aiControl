// Fruit characters, after the concept art: a smooth fruit body with a drawn-on face, thin black noodle limbs,
// cartoon hands and rounded shoes. This is the only module that knows how a character is built.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint, painted } from './furniture.js';
import { toonMaterial, withOutline } from './toon.js';

// Each part of a character that shares a material is baked into one geometry, so a fruit costs a handful of draw calls.
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const place = new THREE.Object3D();
// Bakes a placement into a geometry: at `position`, turned by Euler angles [x, y, z] or with its +z side facing a point.
function baked(geometry, position, turn = [0, 0, 0]) {
  place.position.copy(position);
  if (Array.isArray(turn)) place.rotation.set(...turn); else place.lookAt(turn);
  place.updateMatrix();
  return geometry.applyMatrix4(place.matrix);
}
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
  texture.colorSpace = THREE.NoColorSpace;
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
// Wear and going grey are painted by the body's own shader, not by see-through copies of the body (a draw call each):
// bruises that show more as their test drops, and a banana's black ends. Returns the uniforms that set them.
function wearable(material) {
  const skin = {
    bruiseMap: { value: bruises() }, tipMap: { value: tipFade() }, tests: { value: new THREE.Vector3(2, 2, 2) }, grey: { value: 0 },
    spotColor: { value: new THREE.Color('#7a4a1c') }, rotColor: { value: new THREE.Color('#3b2414') }, tipColor: { value: new THREE.Color('#2e1f10') }, greyColor: { value: new THREE.Color('#9b9a97') },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, skin);
    shader.vertexShader = `varying vec2 vSkinUv;\n${shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvSkinUv = uv;')}`;
    shader.fragmentShader = `uniform sampler2D bruiseMap;\nuniform sampler2D tipMap;\nuniform vec3 tests, spotColor, rotColor, tipColor, greyColor;\nuniform float grey;\nvarying vec2 vSkinUv;\n${shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, greyColor, grey);
      // Each layer is a 90% coat with the texture as its alpha, shown where that alpha passes the layer's test. Mixed in
      // screen space (gamma 2.2) like blended overlays, or faint freckles vanish into a bright skin.
      float bruise = texture2D(bruiseMap, vSkinUv * vec2(2.5, 1.5)).g * 0.9, tip = texture2D(tipMap, vSkinUv).g * 0.9;
      vec3 shown = pow(diffuseColor.rgb, vec3(1.0 / 2.2));
      shown = mix(shown, pow(spotColor, vec3(1.0 / 2.2)), step(tests.x, bruise) * bruise);
      shown = mix(shown, pow(rotColor, vec3(1.0 / 2.2)), step(tests.y, bruise) * bruise);
      diffuseColor.rgb = pow(mix(shown, pow(tipColor, vec3(1.0 / 2.2)), step(tests.z, tip) * tip), vec3(2.2));`)}`;
  };
  material.customProgramCacheKey = () => 'fruit-skin';
  return skin;
}

// Black parts shared by every fruit.
let hand, shoe, fly;
const flyGeometry = () => fly ??= new THREE.SphereGeometry(0.017, 6, 4);
export function handGeometry() {
  if (hand) return hand;
  const parts = [new THREE.SphereGeometry(0.042, 14, 10).scale(1, 0.8, 1.1)];
  for (const [x, len] of [[-0.024, 0.05], [0, 0.058], [0.024, 0.05]]) parts.push(new THREE.CapsuleGeometry(0.012, len, 4, 8).translate(x, 0, 0).rotateX(Math.PI / 2).translate(0, 0, 0.045 + len / 2 - 0.01));
  parts.push(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8).rotateZ(Math.PI / 2.6).translate(-0.045, 0.012, 0.02));
  return hand = mergeGeometries(parts);
}
const shoeGeometry = () => shoe ??= new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8).scale(1, 0.75, 1.7).translate(0, -0.012, 0.035);

// The four noodle limbs with their hands and shoes, as one mesh. A limb's tube follows a quadratic bezier and is rewritten
// in place (in TubeGeometry's layout) when it moves; its hand or shoe is copied from a template to the tube's end.
const LIMBS = { leftHand: LIMB_R, rightHand: LIMB_R, leftFoot: LIMB_R * 1.1, rightFoot: LIMB_R * 1.1 };
const ONE = V(1, 1, 1), MIRROR = V(-1, 1, 1), FORWARD = V(0, 0, 1), m = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), p = V(0, 0), n = V(0, 0);
class Limbs {
  constructor(material) {
    const names = Object.keys(LIMBS), line = new THREE.QuadraticBezierCurve3(V(0, 0), V(0, 0.1), V(0, 0.2));
    const parts = [...names.map(() => new THREE.TubeGeometry(line, TUBE, 1, RADIAL)), ...names.map(name => name.endsWith('Hand') ? handGeometry() : shoeGeometry())];
    let vertex = 0, index = 0;
    const slots = parts.map(g => { const slot = { start: vertex, count: g.attributes.position.count, first: index, size: g.index.count }; vertex += slot.count; index += slot.size; return slot; });
    this.geometry = mergeGeometries(parts);
    // The right hand is a mirrored left hand, so its triangles wind the other way round to keep facing out.
    const order = this.geometry.index.array, right = slots[names.length + 1];
    for (let i = right.first; i < right.first + right.size; i += 3) [order[i + 1], order[i + 2]] = [order[i + 2], order[i + 1]];
    // Limbs move every frame, so the bounds are fixed: wide enough for a reach across the desk or heels up on it.
    this.geometry.boundingSphere = new THREE.Sphere(V(0, 0.6, 0.2), 1.3);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.limbs = Object.fromEntries(names.map((name, i) => [name, { radius: LIMBS[name], tube: slots[i], end: slots[names.length + i], template: parts[names.length + i].attributes, curve: new THREE.QuadraticBezierCurve3(V(0, 0), V(0, 0), V(0, 0)), last: null }]));
  }
  // A limb's tube runs from `from`, bowed by `bend`, to `to`; a hand there points along it, a shoe is turned by `turn`.
  set(name, from, bend, to, turn) {
    const limb = this.limbs[name], key = [from, to, bend].map(v => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`).join();
    if (key === limb.last) return;
    limb.last = key;
    const { curve, radius, tube, end, template } = limb, { position, normal } = this.geometry.attributes;
    curve.v0.copy(from); curve.v2.copy(to); curve.v1.copy(from).add(to).multiplyScalar(0.5).add(bend);
    curve.updateArcLengths(); // getPointAt and the frames read a cached length table
    const { tangents, normals, binormals } = curve.computeFrenetFrames(TUBE, false);
    for (let i = 0; i <= TUBE; i++) {
      curve.getPointAt(i / TUBE, p);
      for (let j = 0; j <= RADIAL; j++) {
        const a = j / RADIAL * Math.PI * 2, k = tube.start + i * (RADIAL + 1) + j;
        n.copy(normals[i]).multiplyScalar(-Math.cos(a)).addScaledVector(binormals[i], Math.sin(a)).normalize();
        normal.setXYZ(k, n.x, n.y, n.z); position.setXYZ(k, p.x + n.x * radius, p.y + n.y * radius, p.z + n.z * radius);
      }
    }
    if (turn) q.setFromEuler(turn); else q.setFromUnitVectors(FORWARD, tangents[TUBE]);
    m.compose(to, q, name === 'rightHand' ? MIRROR : ONE); nm.getNormalMatrix(m);
    for (let i = 0; i < end.count; i++) {
      p.fromBufferAttribute(template.position, i).applyMatrix4(m); position.setXYZ(end.start + i, p.x, p.y, p.z);
      n.fromBufferAttribute(template.normal, i).applyMatrix3(nm).normalize(); normal.setXYZ(end.start + i, n.x, n.y, n.z);
    }
    for (const attribute of [position, normal]) { for (const { start, count } of [tube, end]) attribute.addUpdateRange(start * 3, count * 3); attribute.needsUpdate = true; }
  }
}

function arc(points, radius = 0.007) {
  const curve = points.length === 3 ? new THREE.QuadraticBezierCurve3(...points) : new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 12, radius, 5);
}

// Stems, leaves and caps: one painted geometry per kind of fruit, shared.
const stems = new Map();
function stemGeometry(fruit, h) {
  if (stems.has(fruit)) return stems.get(fruit);
  const green = '#4f9a2c', brown = '#6b4423', parts = [];
  if (fruit === 'apple' || fruit === 'pear') {
    parts.push([arc([V(0, h - 0.06), V(0.01, h + 0.06), V(-0.03, h + 0.12)], 0.016), brown]);
    if (fruit === 'apple') parts.push([baked(new THREE.SphereGeometry(0.07, 12, 8).scale(1, 0.18, 0.5), V(0.07, h + 0.08), [0, 0, 0.5]), green]);
  } else if (fruit === 'pineapple') {
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, tall = i % 2 ? 0.2 : 0.3;
      parts.push([baked(new THREE.ConeGeometry(0.04, tall, 6).translate(0, tall / 2, 0), V(Math.cos(a) * 0.04, h - 0.02, Math.sin(a) * 0.04), [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45]), green]);
    }
  } else if (fruit === 'orange') parts.push([new THREE.SphereGeometry(0.03, 10, 6).scale(1, 0.4, 1).translate(0, h, 0), green]);
  else if (fruit === 'eggplant' || fruit === 'strawberry') {
    for (let i = 0; i < 6; i++) parts.push([baked(new THREE.SphereGeometry(0.075, 10, 6).scale(1, 0.15, 0.45).translate(0.06, 0, 0), V(0, h - (fruit === 'eggplant' ? 0.035 : 0.01)), [0, i / 6 * Math.PI * 2, -0.35]), green]);
    parts.push([new THREE.CylinderGeometry(0.018, 0.025, 0.09, 8).translate(0, h + 0.03, 0), fruit === 'eggplant' ? green : '#3f7d22']);
  } else if (fruit === 'banana') {
    parts.push([new THREE.CylinderGeometry(0.02, 0.028, 0.07, 8).translate(0, 0.03, 0).translate(...bananaSpine.getPoint(1).toArray()), brown]);
    parts.push([new THREE.SphereGeometry(0.03, 8, 6).translate(...bananaSpine.getPoint(0).toArray()), brown]);
  }
  const geometry = parts.length ? paint(parts) : null;
  stems.set(fruit, geometry);
  return geometry;
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

  const stem = stemGeometry(fruit, h);
  if (stem) body.add(withOutline(new THREE.Mesh(stem, painted()), 0.008));

  // Face: small black eyes, brows and a mouth, a little above the middle of the body like in the concept art.
  const faceY = h * (fruit === 'banana' ? 0.72 : fruit === 'strawberry' ? 0.5 : 0.6), spread = fruit === 'banana' ? 0.36 : 0.27;
  const face = new THREE.Group(); body.add(face);
  // A point straight out from the body's axis, for things on the skin to face.
  const outward = at => V(2 * at.x - shape.surface(at.y).x, at.y, 2 * at.z);
  // Both eyes are one mesh pivoting on the body's axis: turning it slides them around the skin, squashing it closes them.
  const centre = shape.surface(faceY);
  const eyeGeometry = mergeGeometries([-1, 1].map(side => { const at = onSkin(side * spread, faceY, -0.004); return baked(new THREE.SphereGeometry(0.042, 14, 10).scale(0.72, 1.12, 0.45), at, outward(at)); })).translate(-centre.x, -faceY, 0);
  const eyes = new THREE.Mesh(eyeGeometry, ink); own.push(eyeGeometry); face.add(eyes);
  const placeEyes = (dx = 0, dy = 0) => { const { x, r } = shape.surface(faceY + dy), out = r - centre.r; eyes.position.set(x + Math.sin(dx) * out, faceY + dy, Math.cos(dx) * out); eyes.rotation.y = dx; };
  placeEyes();
  // Brows, mouth and bags are one painted mesh, rebuilt when the expression or the wear changes.
  const lines = new THREE.Mesh(new THREE.BufferGeometry(), painted()); face.add(lines);
  let expression = [], bags = [];
  const redraw = () => { lines.geometry.dispose(); lines.geometry = paint([...expression, ...bags]); };
  const setExpression = name => {
    expression = [];
    const line = (points, radius) => expression.push([arc(points, radius), INK]);
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
    eyes.visible = name !== 'asleep';
    if (name === 'asleep') {
      for (const side of [-1, 1]) line([onSkin(side * s - 0.05, faceY), onSkin(side * s, faceY - 0.022), onSkin(side * s + 0.05, faceY)], 0.007);
      const at = onSkin(0, mouthY, 0); expression.push([baked(new THREE.TorusGeometry(0.016, 0.006, 6, 14), at, outward(at)), INK]);
    } else if (shapes.mouth) {
      const [corner, middle] = shapes.mouth, half = shapes.width / 2 / Math.max(0.15, shape.surface(mouthY).r), { shift = 0, slant = 0 } = shapes;
      line([onSkin(shift - half, mouthY + corner - slant), onSkin(shift, mouthY + middle * 2), onSkin(shift + half, mouthY + corner + slant)], 0.007);
    }
    redraw();
  };
  setExpression('smile');

  // Wear: the skin browns and bruises (a banana's ends go black), then come bags under the eyes, heavy lids and flies.
  const skin = wearable(colorMaterial);
  // The flies are three copies of one sphere; they circle in a fixed ball above the head.
  const buzzX = shape.surface(h * 0.9).x, flies = new THREE.InstancedMesh(flyGeometry(), ink, 3);
  flies.visible = false; flies.boundingSphere = new THREE.Sphere(V(buzzX, h + 0.1), 0.4); body.add(flies); own.push(flies);
  const bagHalf = 0.034 / centre.r;
  let droop = 1, blink = 1;
  const setWear = wear => {
    bags = [];
    // Front-loaded, so even a mildly tired fruit looks it.
    const age = Math.min(1, wear * 1.6);
    colorMaterial.color.copy(fresh).lerp(ROT, age * 0.6);
    skin.tests.value.set(wear > 0.05 ? 1 - age * 0.8 : 2, wear > 0.25 ? 1 - (wear - 0.2) * 0.75 : 2, fruit === 'banana' && wear > 0.15 ? 1 - age * 0.75 : 2); // 2: never shows
    flies.visible = wear >= 0.7;
    for (let level = 0; level < (wear >= 0.75 ? 2 : wear >= 0.4 ? 1 : 0); level++) for (const side of [-1, 1]) {
      const y = faceY - 0.058 - level * 0.016;
      bags.push([arc([onSkin(side * spread - bagHalf, y + 0.008), onSkin(side * spread, y - 0.006), onSkin(side * spread + bagHalf, y + 0.008)], 0.0045), '#6a5470']);
    }
    redraw();
    droop = 1 - Math.max(0, wear - 0.3) * 0.55;
    eyes.scale.y = Math.max(0.1, blink * droop);
  };

  // Accessories.
  if (accessory === 'glasses') {
    // Frames and lenses: two meshes.
    const frames = [], lenses = [], lens = new THREE.MeshBasicMaterial({ color: '#dff3ff', transparent: true, opacity: 0.25 });
    for (const side of [-1, 1]) {
      const at = onSkin(side * spread, faceY, 0.03);
      frames.push(baked(new THREE.TorusGeometry(0.06, 0.007, 6, 24), at, outward(at))); lenses.push(baked(new THREE.CircleGeometry(0.058, 20), at, outward(at)));
      frames.push(arc([onSkin(side * (spread + 0.06), faceY, 0.028), onSkin(side * 1.2, faceY + 0.01, 0.01), onSkin(side * 1.6, faceY - 0.01, -0.01)], 0.006));
    }
    frames.push(arc([onSkin(-spread + 0.07, faceY + 0.01, 0.032), onSkin(0, faceY + 0.025, 0.036), onSkin(spread - 0.07, faceY + 0.01, 0.032)], 0.006));
    const frame = mergeGeometries(frames), glass = mergeGeometries(lenses); own.push(frame, glass, lens);
    face.add(new THREE.Mesh(frame, toonMaterial('#7a4b3a')), new THREE.Mesh(glass, lens));
  } else if (accessory === 'tie') {
    // Collar, blade and knot: one mesh and its outline.
    const collarY = faceY - 0.14, { x, r } = shape.surface(collarY), tieMaterial = toonMaterial('#ffffff', { map: stripes() });
    const collar = new THREE.TorusGeometry(r + 0.008, 0.014, 6, 40).rotateX(Math.PI / 2).translate(x, collarY, 0);
    const blade = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.03, 0), new THREE.Vector2(0.03, 0), new THREE.Vector2(0.045, -0.15), new THREE.Vector2(0, -0.19), new THREE.Vector2(-0.045, -0.15)]), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    blade.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 8; });
    const top = onSkin(0, collarY - 0.01, 0.006), bottom = onSkin(0, collarY - 0.18, 0.006);
    // Tilt so the blade's lower end follows the skin: rotating about x moves (0, -L, 0) to z = -L·sin(a).
    baked(blade, top, [Math.atan2(top.z - bottom.z, top.y - bottom.y), 0, 0]);
    const knot = new THREE.SphereGeometry(0.03, 10, 8).scale(1, 0.9, 0.6).translate(...onSkin(0, collarY, 0.012).toArray());
    const tie = mergeGeometries([collar, blade, knot].map(g => g.index ? g.toNonIndexed() : g)); own.push(tie, tieMaterial);
    body.add(withOutline(new THREE.Mesh(tie, tieMaterial), 0.006));
  }

  // Limbs. Anchors start inside the body so no join ever shows. Facing +z, the left side is +x.
  const shoulderY = h * (fruit === 'banana' ? 0.42 : 0.4), hipY = Math.min(0.06, h * 0.1);
  const anchor = {
    leftHand: () => { const { x, r } = shape.surface(shoulderY); return V(x + r - 0.05, shoulderY, 0); },
    rightHand: () => { const { x, r } = shape.surface(shoulderY); return V(x - r + 0.05, shoulderY, 0); },
    leftFoot: () => V(shape.surface(hipY + 0.04).x + 0.09, hipY + 0.03, 0),
    rightFoot: () => V(shape.surface(hipY + 0.04).x - 0.09, hipY + 0.03, 0),
  };
  const limbs = new Limbs(limbMaterial), hands = { leftHand: 1, rightHand: -1 }; own.push(limbs.geometry); group.add(limbs.mesh);
  const from = new THREE.Vector3(), bend = new THREE.Vector3(), heel = new THREE.Euler();
  const setLimbs = targets => {
    body.updateMatrix();
    for (const [name, to] of Object.entries(targets)) {
      from.copy(anchor[name]()).applyMatrix4(body.matrix);
      const arm = name in hands, side = arm ? hands[name] : name === 'leftFoot' ? 1 : -1;
      // Arms bow outward and down; legs bend a little forward at the knee.
      if (arm) bend.set(side * 0.07, -0.06, 0.02); else bend.set(side * 0.02, 0, 0.06);
      // A foot up off the floor rests on its heel, toes up.
      limbs.set(name, from, bend, to, arm ? null : heel.set(-Math.min(1, Math.max(0, to.y - 0.1) * 2), 0, 0));
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
      if (!flies.visible) return;
      for (let i = 0; i < 3; i++) { const a = t * (2.4 + i * 0.9) + i * 2.1; flies.setMatrixAt(i, m.makeTranslation(buzzX + Math.sin(a) * 0.24 + Math.sin(a * 3.1) * 0.04, h + 0.1 + Math.sin(a * 1.7 + i) * 0.07, Math.cos(a) * 0.24)); }
      flies.instanceMatrix.needsUpdate = true;
    },
    setGrey(on) { skin.grey.value = +on; },
    setBlink(open) { if (open === blink) return; blink = open; eyes.scale.y = Math.max(0.1, open * droop); },
    // Eyes slide a little toward a point given in the fruit's local space; null looks ahead.
    lookAt(point) { if (!point) { placeEyes(); return; } const dx = THREE.MathUtils.clamp(Math.atan2(point.x, point.z) * 0.25, -0.12, 0.12), dy = THREE.MathUtils.clamp((point.y - body.position.y - faceY) * 0.05, -0.02, 0.02); placeEyes(dx, dy); },
    dispose() { group.removeFromParent(); lines.geometry.dispose(); for (const item of own) item.dispose(); },
  };
}
