// The generators' modelling kit: rounded parts with smooth normals and cut plates for blades, capes and wings. Few polygons either way, as on the old consoles.
import * as THREE from 'three';
import { Geo, shade } from './rig.js';
import { PATTERNS, layerOf } from './weave.js';

const V = THREE.Vector3, rgb = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const lerpColour = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export class Shape extends Geo {
  // Rows of points, each row a closed loop of the same length. Poles are rows shrunk to a point; open ends get a flat cap.
  grid(rows, colours, o = {}) {
    const last = rows.length - 1, n = rows[0].length, mid = rows.map(row => row.reduce((sum, p) => sum.add(p), new V()).divideScalar(n));
    const pole = rows.map((row, i) => row.every(p => p.distanceToSquared(mid[i]) < 4e-6));
    const tri = (a, b, c, na, nb, nc, ca, cb, cc) => {
      const flip = new V().subVectors(b, a).cross(new V().subVectors(c, a)).dot(new V().add(na).add(nb).add(nc)) < 0;
      for (const [p, nrm, col] of flip ? [[a, na, ca], [c, nc, cc], [b, nb, cb]] : [[a, na, ca], [b, nb, cb], [c, nc, cc]]) { this.p.push(p.x, p.y, p.z); this.n.push(nrm.x, nrm.y, nrm.z); this.c.push(...col); }
    };
    if (o.flat) {
      for (let i = 0; i < last; i++) {
        const inside = mid[i].clone().add(mid[i + 1]).multiplyScalar(.5), ci = colours[i], cj = colours[i + 1];
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n, a = rows[i][j], b = rows[i][k], c = rows[i + 1][k], d = rows[i + 1][j];
          if (!pole[i]) this.face([a, b, c], [ci, ci, cj], inside);
          if (!pole[i + 1]) this.face([a, c, d], [ci, cj, cj], inside);
        }
      }
    } else {
      const normals = rows.map((row, i) => row.map((p, j) => {
        if (pole[i]) return new V().subVectors(mid[i], mid[i ? i - 1 : 1]).normalize();
        const across = new V().subVectors(row[(j + 1) % n], row[(j + n - 1) % n]), along = new V().subVectors(rows[Math.min(i + 1, last)][j], rows[Math.max(i - 1, 0)][j]), out = new V().subVectors(p, mid[i]), nrm = across.cross(along);
        if (nrm.lengthSq() < 1e-9) nrm.copy(out);
        nrm.normalize();
        return nrm.dot(out) < 0 ? nrm.negate() : nrm;
      }));
      for (let i = 0; i < last; i++) for (let j = 0; j < n; j++) {
        const k = (j + 1) % n, a = rows[i][j], b = rows[i][k], c = rows[i + 1][k], d = rows[i + 1][j], ni = normals[i], nj = normals[i + 1];
        if (!pole[i]) tri(a, b, c, ni[j], ni[k], nj[k], colours[i], colours[i], colours[i + 1]);
        if (!pole[i + 1]) tri(a, c, d, ni[j], nj[k], nj[j], colours[i], colours[i + 1], colours[i + 1]);
      }
    }
    for (const [i, next] of [[0, 1], [last, last - 1]]) if (!pole[i]) {
      const up = new V().subVectors(mid[i], mid[next]).normalize(), col = colours[i];
      for (let j = 0; j < n; j++) tri(mid[i], rows[i][j], rows[i][(j + 1) % n], up, up, up, col, col, col);
    }
    return this;
  }
  // A turned shape, top row first: each row is [radius, y] with an optional colour. `sx`/`sz` flatten it, `lean` tips rows along z by their height.
  lathe(profile, c, o = {}) {
    const f = this.xf(o), sides = o.sides || 8, c2 = o.c2 ?? c, top = profile[0][1], bottom = profile.at(-1)[1], span = top - bottom || 1;
    const rows = profile.map(([radius, y]) => Array.from({ length: sides }, (_, i) => { const a = (i + .5) / sides * Math.PI * 2 + (o.turn || 0); return f([Math.cos(a) * radius * (o.sx ?? 1), y, Math.sin(a) * radius * (o.sz ?? 1) + (o.lean || 0) * (y - bottom)]); }));
    const colours = profile.map(([, y, own]) => own != null ? rgb(own) : lerpColour(rgb(c), rgb(c2), (top - y) / span));
    const from = this.p.length / 3; this.grid(rows, colours, o);
    if (o.cloth) this.drape(from, f, o, profile);
    return this;
  }
  // Gives the vertices since `from` their place on a pattern, undoing `f` to find it. `cloth` is { pat, ink }. A turned part wraps the pattern around itself a whole number of times, so it meets itself; a flat one, without `profile`, lies straight on it.
  drape(from, f, o, profile) {
    const { pat, ink } = o.cloth, { per = 1, band } = PATTERNS[pat], back = f.m.clone().invert(), at = new V(), count = this.p.length / 3 - from, uv = new Float32Array(count * 3), layer = layerOf(pat);
    const ys = profile?.map(row => row[1]) ?? [0], low = Math.min(...ys), high = Math.max(...ys), tall = high - low || 1, sx = o.sx ?? 1, sz = o.sz ?? 1;
    const round = profile?.reduce((sum, row) => sum + row[0], 0) / (profile?.length || 1) * Math.PI * (sx + sz), turns = profile ? Math.max(1, Math.round(band ? round / (tall * band) : round * per)) : 1;
    for (let t = 0; t < count; t += 3) {
      const corners = [0, 1, 2].map(i => { const k = (from + t + i) * 3; at.set(this.p[k], this.p[k + 1], this.p[k + 2]).applyMatrix4(back); return { x: at.x, y: at.y, z: at.z }; });
      if (!profile) { corners.forEach(({ x, y }, i) => uv.set([x * per, y * per, layer], (t + i) * 3)); continue; }
      const round2 = corners.map(({ x, y, z }) => { const zz = (z - (o.lean || 0) * (y - low)) / sz, xx = x / sx; return xx * xx + zz * zz < 1e-5 ? null : Math.atan2(zz, xx) / (Math.PI * 2); }), known = round2.filter(u => u != null), least = Math.min(...known);
      const seen = known.map(u => (u - least > .5 ? u - 1 : u)), mean = seen.reduce((sum, u) => sum + u, 0) / (seen.length || 1);
      corners.forEach(({ y }, i) => { const u = round2[i] == null ? mean : round2[i] - least > .5 ? round2[i] - 1 : round2[i]; uv.set([u * turns, band ? (y - low) / tall : y * per, layer], (t + i) * 3); });
    }
    this.worn.push({ from, uv, rgb: rgb(ink ?? 0) });
  }
  // An ellipsoid; `top` and `low` (0–1) cut it short of its poles, for caps and bowls.
  ball(rx, ry, rz, c, o = {}) {
    const rings = o.rings || 5, top = (o.top ?? 1) * Math.PI / 2, low = -(o.low ?? 1) * Math.PI / 2, profile = [];
    for (let i = 0; i <= rings; i++) { const a = top + (low - top) * i / rings, radius = Math.cos(a); profile.push([Math.abs(radius) < 1e-3 ? .0001 : radius * rx, Math.sin(a) * ry]); }
    return this.lathe(profile, c, { ...o, sz: rz / rx * (o.sz ?? 1) });
  }
  // A curved tube through points, its radius running between `radii` (the last can be 0, for a point).
  tube(points, radii, c, o = {}) {
    const f = this.xf(o), sides = o.sides || 5, path = points.map(p => new V(...p)), count = path.length, c2 = rgb(o.c2 ?? c), c1 = rgb(c), rows = [], colours = [];
    let side = null;
    for (let i = 0; i < count; i++) {
      const along = new V().subVectors(path[Math.min(i + 1, count - 1)], path[Math.max(i - 1, 0)]).normalize();
      if (!side) { side = new V().crossVectors(along, Math.abs(along.y) > .9 ? new V(1, 0, 0) : new V(0, 1, 0)).normalize(); } else side.addScaledVector(along, -side.dot(along)).normalize();
      const up = new V().crossVectors(along, side), t = count > 1 ? i / (count - 1) : 0, at = t * (radii.length - 1), lo = Math.floor(at), radius = Math.max(.0001, radii[lo] + ((radii[lo + 1] ?? radii[lo]) - radii[lo]) * (at - lo));
      rows.push(Array.from({ length: sides }, (_, j) => { const a = j / sides * Math.PI * 2, p = path[i].clone().addScaledVector(side, Math.cos(a) * radius).addScaledVector(up, Math.sin(a) * radius); return f([p.x, p.y, p.z]); }));
      colours.push(lerpColour(c1, c2, t));
    }
    return this.grid(rows, colours, o);
  }
  // A shape cut from a sheet: an outline in x and y, `thick` deep in z, faces raised to a ridge along its middle. For blades, shields, capes and wings. `c2` colours the rim.
  plate(outline, thick, c, o = {}) {
    const from = this.p.length / 3, f = this.xf(o), ca = rgb(c), cb = rgb(o.c2 ?? c), half = thick / 2, ridge = o.ridge ?? 0, cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
    const front = outline.map(([x, y]) => f([x, y, half])), back = outline.map(([x, y]) => f([x, y, -half])), inside = f([cx, cy, 0]), apexF = f([cx, cy, half + ridge]), apexB = f([cx, cy, -half - ridge]);
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      this.face([apexF, front[i], front[j]], [ca, cb, cb], inside);
      this.face([apexB, back[i], back[j]], [ca, cb, cb], inside);
      if (thick > .001) this.face([front[i], front[j], back[j], back[i]], [cb, cb, cb, cb], inside);
    }
    if (o.cloth) this.drape(from, f, o);
    return this;
  }
  // A faceted lump, each corner pushed about by `rand`.
  rock(r, c, rand, o = {}) {
    const f = this.xf(o), sides = o.sides || 6, rings = o.rings || 4, rough = o.rough ?? .22, sy = o.sy ?? 1, sz = o.sz ?? 1, rows = [], colours = [], c1 = rgb(c), c2 = rgb(o.c2 ?? shade(c, .7));
    for (let i = 0; i <= rings; i++) {
      const a = Math.PI / 2 - i / rings * Math.PI, ring = Math.cos(a), turn = i * .5;
      rows.push(Array.from({ length: sides }, (_, j) => { const b = (j + turn) / sides * Math.PI * 2, k = i && i < rings ? 1 + (rand() - .5) * rough * 2 : 1; return f([Math.cos(b) * ring * r * k, Math.sin(a) * r * sy * k, Math.sin(b) * ring * r * sz * k]); }));
      colours.push(lerpColour(c1, c2, i / rings));
    }
    return this.grid(rows, colours, { flat: true });
  }
}
// A limb hanging down from its joint: round at both ends, `r1` at the top and `r2` at the bottom.
export const limb = (g, r1, r2, len, c, o = {}) => g.lathe([[.0001, r1 * .75], [r1 * .78, r1 * .42], [r1, 0], [(r1 + r2) / 2 * (o.bulge ?? 1.05), -len * .5], [r2, -len], [.0001, -len - r2 * .6]], c, { sides: 7, ...o });
