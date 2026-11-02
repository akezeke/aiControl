// Small shared helpers for looks: sizes, easing, curves, dynamic tubes, glow textures, a GLSL noise and a vignette/grain pass.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Nominal radius of each kind in world units. The engine picks nodes with these, so keep visuals roughly this size.
export const SIZE = { you: 1.7, project: 1.35, session: .85, sub: .45 };
// ctx.setMotion(RIGID) for machine looks: nodes glide into place without overshoot, idle wander or event hops. Only the organic looks bounce.
export const RIGID = { zeta: 1, k: 70, drift: 0, kick: 0 };
// Semantic defaults; looks can use their own.
export const STATUS = { working: '#3ddc97', thinking: '#5ad1e8', compacting: '#a78bfa', permission: '#ffb020', question: '#ffb020', waiting: '#5aa9ff', idle: '#8b93a1', error: '#ff4d5e', offline: '#4a4f58' };

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOutCubic = t => 1 - Math.pow(1 - clamp(t), 3);
export const easeOutBack = (t, s = 1.70158) => { t = clamp(t) - 1; return t * t * ((s + 1) * t + s) + 1; };
export const easeInOutSine = t => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The status a node is mostly in right now, from its smoothed signals: 'work'|'think'|'compact'|'need'|'wait'|'idle'|'error'|'off'.
const KEYS = ['work', 'think', 'compact', 'need', 'wait', 'idle', 'error', 'off'];
export const dominant = node => KEYS.reduce((a, b) => node.s[b] > node.s[a] ? b : a, 'idle');
// A colour blended by the smoothed signals, so changes fade instead of snapping. `palette` maps the KEYS above to colours.
const mixTmp = new THREE.Color();
export function statusColor(node, palette, out = new THREE.Color()) {
  out.setRGB(0, 0, 0); let total = 0;
  for (const key of KEYS) { const w = node.s[key]; if (w < .001 || !palette[key]) continue; out.add(mixTmp.set(palette[key]).multiplyScalar(w)); total += w; }
  return total > 0 ? out.multiplyScalar(1 / total) : out.set(palette.idle || '#888');
}

// Quadratic bezier from a to b. `bend` pushes the middle sideways (fraction of length), `lift` raises it.
export function bendControl(a, b, bend = .15, lift = 0, out = new THREE.Vector3()) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
  return out.set((a.x + b.x) / 2 - dz / len * bend * len, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2 + dx / len * bend * len);
}
export function bezier(a, c, b, t, out = new THREE.Vector3()) {
  const u = 1 - t;
  return out.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z);
}

// A tube (or a flat ribbon facing up) rebuilt in place each frame from a point function. uv.x runs 0..1 along the whole curve
// even when only part of it is drawn, so shader patterns stay put; uv.y runs around. `radius(t)` sets thickness along it.
export class Tube {
  // u maps the sample parameter to uv.x, for tubes sampled unevenly (pointAt(warp(t))) whose shaders still want even distance along them.
  constructor({ segments = 32, radial = 8, flat = false, radius = () => .05, u = t => t } = {}) {
    this.segments = segments; this.radial = flat ? 1 : radial; this.flat = flat; this.radius = radius; this.u = u;
    const ring = this.radial + 1, count = (segments + 1) * ring;
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < segments; i++) for (let j = 0; j < this.radial; j++) {
      const a = i * ring + j, b = (i + 1) * ring + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
    g.setIndex(index);
    this._p = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
  }
  // pointAt(t, out) fills out with the curve point at t in 0..1. Draws t in [from, to].
  update(pointAt, from = 0, to = 1) {
    const { segments, radial, flat, radius } = this, ring = radial + 1, pts = this._p;
    const pos = this.geometry.attributes.position.array, nor = this.geometry.attributes.normal.array, uv = this.geometry.attributes.uv.array;
    for (let i = 0; i <= segments; i++) pointAt(from + (to - from) * i / segments, pts[i]);
    const tan = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const t = from + (to - from) * i / segments, r = radius(t);
      tan.subVectors(pts[Math.min(segments, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      n.crossVectors(tan, up); if (n.lengthSq() < 1e-6) n.set(1, 0, 0); n.normalize();
      b.crossVectors(n, tan).normalize();
      for (let j = 0; j <= radial; j++) {
        const k = (i * ring + j);
        if (flat) { v.copy(n).multiplyScalar(j ? r : -r); nor[k * 3] = 0; nor[k * 3 + 1] = 1; nor[k * 3 + 2] = 0; }
        else { const a = j / radial * Math.PI * 2; v.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a)); nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z; v.multiplyScalar(r); }
        pos[k * 3] = pts[i].x + v.x; pos[k * 3 + 1] = pts[i].y + v.y; pos[k * 3 + 2] = pts[i].z + v.z;
        uv[k * 2] = this.u(t); uv[k * 2 + 1] = j / radial;
      }
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.uv.needsUpdate = true;
    g.computeBoundingSphere();
  }
}

// Travelling pulses along a link: t runs 0..1 at `speed` per second. Looks decide what 0 and 1 mean and how to draw them.
export class Pulses {
  constructor() { this.list = []; }
  add(speed = 1.2, strength = 1, data) { this.list.push({ t: 0, speed, strength, data }); if (this.list.length > 8) this.list.shift(); }
  // Returns the pulses that just arrived. Both arrays are reused, so copy the result if you keep it past the frame.
  update(dt) {
    const done = this.done || (this.done = []); done.length = 0; let k = 0;
    for (const p of this.list) { p.t += p.speed * dt; if (p.t >= 1) done.push(p); else this.list[k++] = p; }
    this.list.length = k; return done;
  }
  // Up to four t values packed for a shader uniform; -1 where empty.
  vec4(out = new THREE.Vector4()) { const l = this.list; return out.set(l[0]?.t ?? -1, l[1]?.t ?? -1, l[2]?.t ?? -1, l[3]?.t ?? -1); }
}

const glowCache = new Map();
// A soft radial gradient sprite texture, white by default (tint with material colour).
export function glowTexture(stops = [[0, 'rgba(255,255,255,1)'], [.35, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']], size = 128) {
  const key = JSON.stringify(stops) + size;
  if (glowCache.has(key)) return glowCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  glowCache.set(key, tex); return tex;
}

// Draw something into a canvas texture: draw(ctx2d, size).
export function canvasTexture(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// Ashima simplex noise: float snoise(vec3).
export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

// Vignette, colour tint and film grain in one cheap pass. Add with ctx.addPass(vignettePass({...})); update pass.uniforms.time.value yourself or leave grain static.
export function vignettePass({ darkness = .45, offset = 1.0, grain = .03, tint = '#ffffff' } = {}) {
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, darkness: { value: darkness }, offset: { value: offset }, grain: { value: grain }, time: { value: 0 }, tint: { value: new THREE.Color(tint) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float darkness, offset, grain, time; uniform vec3 tint; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 u = (vUv - .5) * vec2(offset);
        c.rgb *= mix(vec3(1.0), tint, 1.0) * (1.0 - darkness * dot(u, u) * 1.6);
        // Grain scales with the pixel: this runs in linear light, and an additive grain turns to snow in dark scenes after the sRGB output.
        float g = h(vUv * 1000.0 + time) - .5; c.rgb *= 1.0 + g * grain * 5.0; c.rgb += g * grain * .06; gl_FragColor = c; }`,
  });
  return pass;
}

export const fmtWait = sec => sec < 60 ? `${Math.max(1, Math.round(sec))}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;
