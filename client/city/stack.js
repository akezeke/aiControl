// Sprite stacking: every object is a pile of horizontal slices, each lifted a pixel when drawn. Pure.
import { nearest, RAMPS } from './palette.js';

const CREAM = [255, 244, 214], INDIGO = [46, 42, 96], mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export class Stack {
  constructor(w, d, h) { this.w = w; this.d = d; this.h = h; this.v = new Array(w * d * h); }
  // Coordinates are centred on x and z; y is the layer.
  put(x, y, z, m) { const X = Math.floor(x + this.w / 2), Z = Math.floor(z + this.d / 2), Y = Math.floor(y); if (X >= 0 && Z >= 0 && Y >= 0 && X < this.w && Z < this.d && Y < this.h) this.v[X + Z * this.w + Y * this.w * this.d] = m; }
  box(x, y, z, W, H, D, m) { for (let Y = 0; Y < H; Y++) for (let Z = 0; Z < D; Z++) for (let X = 0; X < W; X++) this.put(x - W / 2 + X, y + Y, z - D / 2 + Z, m); }
  cyl(x, y, z, r, H, m, rt = r) { for (let Y = 0; Y < H; Y++) { const R = r + (rt - r) * (Y / Math.max(1, H - 1)); for (let Z = Math.floor(-R); Z <= R; Z++) for (let X = Math.floor(-R); X <= R; X++) if (Math.hypot(X + .5, Z + .5) <= R + .2) this.put(x + X, y + Y, z + Z, m); } }
  pyr(x, y, z, half, H, m) { for (let Y = 0; Y < H; Y++) { const R = half * (1 - Y / H); for (let Z = Math.floor(-R); Z < R; Z++) for (let X = Math.floor(-R); X < R; X++) this.put(x + X, y + Y, z + Z, m); } }
  line(p, q, m, t = 0) { const n = Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]), Math.abs(q[2] - p[2]))) || 1; for (let i = 0; i <= n; i++) { const a = i / n, x = p[0] + (q[0] - p[0]) * a, y = p[1] + (q[1] - p[1]) * a, z = p[2] + (q[2] - p[2]) * a; for (let X = -t; X <= t; X++) for (let Z = -t; Z <= t; Z++) this.put(x + X, y, z + Z, m); } }
  shape(x0, x1, y0, y1, z0, z1, f) { for (let Y = y0; Y < y1; Y++) for (let Z = z0; Z < z1; Z++) for (let X = x0; X < x1; X++) { const m = f(X, Y, Z); if (m) this.put(X, Y, Z, m); } }
  // Three flat tones per material: lit top, left face, shaded right face. Round shapes get a middle band instead of a gradient.
  bake() {
    const { w, d, h, v } = this, at = (x, y, z) => x < 0 || z < 0 || y < 0 || x >= w || z >= d || y >= h ? undefined : v[x + z * w + y * w * d];
    this.layers = [];
    for (let y = 0; y < h; y++) {
      const data = new Uint8Array(w * d * 4); let x0 = w, x1 = -1, z0 = d, z1 = -1;
      for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
        const m = v[x + z * w + y * w * d]; if (!m) continue;
        const top = !at(x, y + 1, z), nx = (at(x + 1, y, z) ? 0 : 1) - (at(x - 1, y, z) ? 0 : 1), nz = (at(x, y, z + 1) ? 0 : 1) - (at(x, y, z - 1) ? 0 : 1);
        // In 2:1 every other pixel of a wall samples the voxel just behind it, so a face is two voxels deep.
        const fx = nx > 0 || !at(x + 2, y, z), fz = nz > 0 || !at(x, y, z + 2), face = top ? 'top' : fx && !fz ? 'x' : fz && !fx ? 'z' : fx ? 'x' : nz ? 'z' : nx ? 'x' : 'in', corner = fx && fz;
        const c = typeof m === 'function' ? m(x - w / 2, y, z - d / 2, face, corner) : m;
        if (!c) continue;
        let out = c; const ramp = RAMPS.get(c.join());
        if (!c.unlit) {
          if (top) out = ramp ? ramp[0] : mix(c, CREAM, .14);
          else { let NX = 0, NZ = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if (!at(x + a, y, z + b)) { NX += a; NZ += b; } out = NX > 2 * NZ && NX > 0 ? (ramp ? ramp[2] : mix(c.map(q => q * .6), INDIGO, .2)) : NZ > 2 * NX || NX <= 0 ? c : (ramp ? ramp[2] : mix(c.map(q => q * .84), INDIGO, .08)); }
        }
        const i = (x + z * w) * 4;
        const P = nearest(out); for (let n = 0; n < 3; n++) data[i + n] = P[n];
        data[i + 3] = 255;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      this.layers.push(x1 < 0 ? null : { data, x0, x1, z0, z1 });
    }
    this.v = null;
    return this;
  }
}
