// Characters are convex parts with per-vertex colour, and clothes sample a shared stack of woven patterns (weave.js). Every part of a character is merged into one mesh with a bone index per vertex, so a whole character is one draw.
import * as THREE from 'three';
import { weaveTexture } from './weave.js';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const mix = (a, b, t) => a + (b - a) * t;
// Colours here are written as they should appear: the canvas outputs them untouched, so they skip three's conversion to linear.
export const raw = hex => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
const rgb = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
export const shade = (c, f) => { const [r, g, b] = rgb(c), to = v => Math.round(clamp(v * f) * 255); return to(r) << 16 | to(g) << 8 | to(b); };
export const blend = (a, b, t) => { const x = rgb(a), y = rgb(b), to = i => Math.round(mix(x[i], y[i], t) * 255); return to(0) << 16 | to(1) << 8 | to(2); };

const TMP = new THREE.Vector3(), M4 = new THREE.Matrix4(), EUL = new THREE.Euler(), QUAT = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1), AT = new THREE.Vector3();
export class Geo {
  p = []; n = []; c = []; worn = [];
  xf(o = {}) { EUL.set(o.rx || 0, o.ry || 0, o.rz || 0); QUAT.setFromEuler(EUL); AT.set(o.x || 0, o.y || 0, o.z || 0); M4.compose(AT, QUAT, ONE); const m = M4.clone(), f = v => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m); f.m = m; return f; }
  // Faces orient themselves away from the part's centre.
  face(pts, cols, inside) {
    const [a, b, c] = pts, n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const mid = pts.reduce((m, v) => m.add(v), new THREE.Vector3()).divideScalar(pts.length);
    const order = pts.map((_, i) => i);
    if (n.dot(TMP.subVectors(mid, inside)) < 0) { n.negate(); order.reverse(); }
    for (let i = 1; i < order.length - 1; i++) for (const k of [order[0], order[i], order[i + 1]]) { this.p.push(pts[k].x, pts[k].y, pts[k].z); this.n.push(n.x, n.y, n.z); this.c.push(...cols[k]); }
  }
  // A box centred at its position, optionally tapering towards the bottom. `c2` colours the bottom corners.
  box(w, h, d, c, o = {}) {
    const f = this.xf(o), w2 = o.w2 ?? w, d2 = o.d2 ?? d, ca = rgb(c), cb = rgb(o.c2 ?? c), T = [[-w / 2, h / 2, -d / 2], [w / 2, h / 2, -d / 2], [w / 2, h / 2, d / 2], [-w / 2, h / 2, d / 2]].map(f), B = [[-w2 / 2, -h / 2, -d2 / 2], [w2 / 2, -h / 2, -d2 / 2], [w2 / 2, -h / 2, d2 / 2], [-w2 / 2, -h / 2, d2 / 2]].map(f), inside = f([0, 0, 0]);
    this.face(T, [ca, ca, ca, ca], inside); this.face(B, [cb, cb, cb, cb], inside);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.face([T[i], T[j], B[j], B[i]], [ca, ca, cb, cb], inside); }
    return this;
  }
  cyl(r, r2, h, sides, c, o = {}) {
    const f = this.xf(o), ca = rgb(c), cb = rgb(o.c2 ?? c), ring = (rad, y) => Array.from({ length: sides }, (_, i) => { const a = i / sides * Math.PI * 2 + (o.turn || 0); return f([Math.cos(a) * rad * (o.sx || 1), y, Math.sin(a) * rad * (o.sz || 1)]); }), T = ring(r, h / 2), B = ring(r2, -h / 2), inside = f([0, 0, 0]);
    if (r > .001) this.face(T, T.map(() => ca), inside);
    if (r2 > .001) this.face(B, B.map(() => cb), inside);
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; if (r > .001 && r2 > .001) this.face([T[i], T[j], B[j], B[i]], [ca, ca, cb, cb], inside); else if (r > .001) this.face([T[i], T[j], B[i]], [ca, ca, cb], inside); else this.face([T[i], B[j], B[i]], [ca, cb, cb], inside); }
    return this;
  }
  // A pyramid, from a base at its position to an apex `h` along local +y.
  spike(r, h, c, o = {}) { return this.cyl(.0001, r, h, o.sides || 4, c, { ...o, c2: o.c2 ?? shade(c, .7), turn: Math.PI / 4 }); }
  gem(r, h, c, o = {}) { const up = { ...o, y: (o.y || 0) + h / 4, c2: c }, down = { ...o, y: (o.y || 0) - h / 4 }; this.cyl(.0001, r, h / 2, o.sides || 4, c, up); return this.cyl(r, .0001, h / 2, o.sides || 4, shade(c, .75), down); }
}

// One vertex-colour shader for both looks, no outlines: polygons lit by the light of the place they stand in. uLook: 0 is the PS1 look (snapped vertices, dither, 15-bit colour), 1 the same polygons drawn clean, with a soft highlight on metal.
const BONES = 26;
const SKIN = `attribute float bone; uniform mat4 uBones[${BONES}];`;
const VERT = `${SKIN} attribute vec3 weave, ink; uniform float uLook; uniform vec2 uRes; varying vec3 vCol, vN, vV, vUp, vWeave, vInk; varying float vDist, vHeight;
void main(){ vWeave = weave; vInk = ink; mat4 b = uBones[int(bone + .5)]; vec4 world = b * vec4(position, 1.), mv = viewMatrix * world; vec4 p = projectionMatrix * mv; vCol = color; vN = mat3(viewMatrix) * mat3(b) * normal; vV = -mv.xyz; vUp = mat3(viewMatrix) * vec3(0., 1., 0.); vDist = length(mv.xyz); vHeight = world.y;
  if (uLook < .5) { p.xyz /= p.w; vec2 grid = uRes * .5; p.xy = floor(p.xy * grid + .5) / grid; p.xyz *= p.w; } gl_Position = p; }`;
const BAYER = `float b2(float x, float y){ return mod(x * 2. + y * 3., 4.); }
float bayer(vec2 v){ vec2 f = mod(floor(v), 4.); return (4. * b2(mod(f.x, 2.), mod(f.y, 2.)) + b2(floor(f.x / 2.), floor(f.y / 2.)) + .5) / 16.; }`;
const FRAG = `uniform float uLook, uGrey, uDim, uFlash, uDissolve; uniform vec3 uTint, uFlashCol, uFog, uSun, uSky, uBounce, uSunDir; uniform sampler2DArray uWeave; varying vec3 vCol, vN, vV, vUp, vWeave, vInk; varying float vDist, vHeight;
${BAYER}
void main(){ vec3 n = normalize(vN), l = normalize((viewMatrix * vec4(uSunDir, 0.)).xyz);
  // The sun, plus what the sky and the lit ground give back; darker near the feet, where the ground shuts out the sky.
  float sun = max(dot(n, l), 0.), up = dot(n, vUp) * .5 + .5;
  // Parts without a pattern say so with a negative layer.
  vec3 cloth = vCol; if (vWeave.z > -.5) { vec2 t = texture(uWeave, vWeave).rg; cloth = mix(vCol, vInk, t.g) * t.r * 2.; }
  vec3 c = cloth * (mix(uBounce, uSky, up) + uSun * sun) * mix(.74, 1., smoothstep(0., .9, vHeight));
  if (uLook > .5) { float top = max(max(vCol.r, vCol.g), vCol.b), metal = smoothstep(.26, .08, top - min(min(vCol.r, vCol.g), vCol.b)) * smoothstep(.3, .6, top), spec = max(dot(n, normalize(l + normalize(vV))), 0.); c += uSun * (pow(spec, 30.) * metal * .55 + pow(spec, 9.) * .05); }
  c *= uTint; float g2 = dot(c, vec3(.3, .59, .11)); c = mix(c, vec3(g2) * vec3(.9, .88, .82), uGrey); c *= 1. - uDim * .55;
  c = mix(c, uFlashCol, uFlash);
  if (uDissolve > 0.) { if (bayer(gl_FragCoord.xy * .5) < uDissolve) discard; c = mix(c, vec3(.95, .32, .08), uDissolve); }
  c = mix(c, uFog, .4 * smoothstep(45., 110., vDist));
  if (uLook < .5) { c += (bayer(gl_FragCoord.xy) - .5) / 22.; c = floor(c * 31. + .5) / 31.; }
  gl_FragColor = vec4(c, 1.); }`;

// What every character in a fight shares: `look` is shared by all fights, the rest set before a fight renders.
export const newShared = (look, place) => ({ uLook: look, uRes: { value: new THREE.Vector2(400, 300) }, uFog: { value: raw(place.fog) }, uSun: { value: raw(place.sun) }, uSky: { value: raw(place.sky) }, uBounce: { value: raw(place.bounce) }, uSunDir: { value: new THREE.Vector3(...place.dir) } });

// One character: a tree of bones, with parts added to them. Call build() once, after the last part.
export class Rig {
  bones = []; parts = []; J = {};
  constructor(scene, shared) { this.scene = scene; this.shared = shared; this.root = new THREE.Group(); scene.add(this.root); this.bones.push(this.root); }
  joint(parent, name, x, y, z, geo) {
    const bone = new THREE.Group(); bone.position.set(x, y, z); parent.add(bone); this.bones.push(bone);
    if (name) this.J[name] = bone;
    if (geo) this.part(bone, geo);
    return bone;
  }
  part(bone, geo) { this.parts.push({ geo, at: this.bones.indexOf(bone) }); return this; }
  build() {
    if (this.bones.length > BONES) throw new Error(`Too many bones: ${this.bones.length}`);
    const count = this.parts.reduce((n, { geo }) => n + geo.p.length / 3, 0), p = new Float32Array(count * 3), n = new Float32Array(count * 3), c = new Float32Array(count * 3), b = new Float32Array(count), weave = new Float32Array(count * 3).fill(-1), ink = new Float32Array(count * 3);
    let start = 0;
    for (const { geo, at } of this.parts) { const size = geo.p.length / 3; p.set(geo.p, start * 3); n.set(geo.n, start * 3); c.set(geo.c, start * 3); b.fill(at, start, start + size); for (const { from, uv, rgb: tone } of geo.worn) { weave.set(uv, (start + from) * 3); for (let i = 0; i < uv.length / 3; i++) ink.set(tone, (start + from + i) * 3); } start += size; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('bone', new THREE.BufferAttribute(b, 1)); g.setAttribute('weave', new THREE.BufferAttribute(weave, 3)); g.setAttribute('ink', new THREE.BufferAttribute(ink, 3));
    const matrices = Array.from({ length: BONES }, (_, i) => (this.bones[i] || this.root).matrixWorld), uBones = { value: matrices }, uDissolve = { value: 0 }, s = this.shared;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, vertexColors: true, uniforms: { uBones, uDissolve, uWeave: { value: weaveTexture() }, uLook: s.uLook, uRes: s.uRes, uFog: s.uFog, uSun: s.uSun, uSky: s.uSky, uBounce: s.uBounce, uSunDir: s.uSunDir, uGrey: { value: 0 }, uDim: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uFlashCol: { value: raw(0xffffff) } } });
    this.body = new THREE.Mesh(g, this.mat); this.body.frustumCulled = false; this.body.matrixAutoUpdate = false; this.body.matrixWorldAutoUpdate = false; this.scene.add(this.body); this.geometry = g; this.parts = [];
    return this;
  }
  get u() { return this.mat.uniforms; }
  show(on) { this.body.visible = on; }
  dispose() { this.scene.remove(this.root, this.body); this.geometry.dispose(); this.mat.dispose(); }
}
