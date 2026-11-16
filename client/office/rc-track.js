// The day's RC circuit drawn on the office floor (rc-course.js lays it): a darker lane, masking-tape edges in dashes, red and
// white kerbs along both edges (open where another part of it comes through), a checkered start line and an arch over it, and
// its ramps (buildRamps, also for just driving). Nothing in it is clickable.
import * as THREE from 'three';
import { toonMaterial } from './toon.js';
import { canvasTexture, glowTexture } from './furniture.js';
import { WIDTH, KERB } from './rc-course.js';

// Heights over the floor (m): the lane just over the rugs (0.014), its tape and the start line over that.
const LANE = 0.016, TAPE = 0.017, LINE = 0.018, TAPE_W = 0.035, DASH = 0.15;
// Kerbs: how high (m; the car is ~9 cm), the length of each red or white stripe, and how far out past KERB (rc-course.js).
const KERB_H = 0.035, KERB_STRIPE = 0.12, KERB_OUT = 0.006;
const ignore = () => {};

// A strip of quads along the circuit, `off` metres right of the centreline, `w` wide, at height y; `skip(i)` leaves the
// quad from sample i out (dashes).
function strip(circuit, off, w, y, skip = () => false) {
  const { points } = circuit, count = points.length / 2, position = [], index = [];
  for (let i = 0; i <= count; i++) {
    const k = i % count, a = (k - 1 + count) % count, b = (k + 1) % count;
    let fx = points[b * 2] - points[a * 2], fz = points[b * 2 + 1] - points[a * 2 + 1]; const d = Math.hypot(fx, fz) || 1; fx /= d; fz /= d;
    const rx = -fz, rz = fx, x = points[k * 2], z = points[k * 2 + 1];
    position.push(x + rx * (off - w / 2), y, z + rz * (off - w / 2), x + rx * (off + w / 2), y, z + rz * (off + w / 2));
    // Wound to face up (left, right, next left; right, next right, next left): the other way it's culled from above.
    if (i < count && !skip(i)) { const v = i * 2; index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); g.setIndex(index); g.computeVertexNormals();
  return g;
}

export function buildTrack(circuit) {
  const group = new THREE.Group(), { points, length } = circuit, count = points.length / 2, spacing = length / count;
  const lane = new THREE.Mesh(strip(circuit, 0, WIDTH, LANE), new THREE.MeshBasicMaterial({ color: '#141824', transparent: true, opacity: 0.32, depthWrite: false }));
  // Two tape edges, each a dash every other DASH metres.
  const dashed = i => Math.floor(i * spacing / DASH) % 2 === 1;
  const edges = [WIDTH / 2, -WIDTH / 2].map(off => strip(circuit, off, TAPE_W, TAPE, dashed));
  const tape = new THREE.Mesh(mergeTwo(edges[0], edges[1]), toonMaterial('#f2cf6b'));
  // The start line: a checkered band across sample 0, and an arch over it (two posts and a checkered banner).
  const checks = canvasTexture(128, 32, (g, w, h) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#1b1c22' : '#f4f1ea'; g.fillRect(i * w / 16, j * h / 4, w / 16, h / 4); } });
  const fx = points[2] - points[(count - 1) * 2], fz = points[3] - points[(count - 1) * 2 + 1], yaw = Math.atan2(fx, fz);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, 0.06).rotateX(-Math.PI / 2), toonMaterial('#ffffff', { map: checks }));
  line.position.set(points[0], LINE, points[1]); line.rotation.y = yaw;
  const arch = new THREE.Group(), post = new THREE.CylinderGeometry(0.008, 0.008, 0.32, 8), dark = toonMaterial('#2b2d35');
  for (const side of [1, -1]) { const m = new THREE.Mesh(post, dark); m.position.set(side * (WIDTH / 2 + 0.03), 0.16, 0); arch.add(m); }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 0.08, 0.05, 0.01), toonMaterial('#ffffff', { map: checks })); banner.position.y = 0.32; arch.add(banner);
  arch.position.set(points[0], 0, points[1]); arch.rotation.y = yaw;
  group.add(lane, tape, kerbs(circuit), line, arch, buildRamps(circuit.ramps || []));
  group.traverse(node => { node.raycast = ignore; });
  return group;
}

// Ramps (rc-physics.js's wedges: `w` wide, `l` long, rising to `h` at the lip, the way yaw faces): a slate wedge whose slope
// shows cream chevrons pointing on, or, a glider ramp, yellow with dark arrows. Its slope starts just over the lane so it shows.
export function buildRamps(ramps) {
  const group = new THREE.Group(), looks = {};
  const look = glider => looks[glider] ??= {
    body: toonMaterial(glider ? '#d99a1e' : '#2f3442', { side: THREE.DoubleSide }),
    top: toonMaterial('#ffffff', { map: canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = glider ? '#ffc93c' : '#3a4152'; g.fillRect(0, 0, w, h);
      g.strokeStyle = glider ? '#2b2d35' : '#f2e6c8'; g.lineWidth = 7; g.lineJoin = 'round';
      // Pointing to the canvas's foot: the lip (rotated flat, the canvas's top is the ramp's back).
      for (const y of [0.2, 0.55]) { g.beginPath(); g.moveTo(w * 0.18, h * y); g.lineTo(w * 0.5, h * (y + 0.22)); g.lineTo(w * 0.82, h * y); g.stroke(); }
    }) }),
  };
  for (const r of ramps) {
    const { body, top } = look(r.glider), ramp = new THREE.Group(), w = r.w / 2, l = r.l / 2, h = r.h, low = LINE + 0.001;
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(r.w, Math.hypot(r.l, h - low)).rotateX(-Math.PI / 2).rotateX(-Math.atan2(h - low, r.l)).translate(0, (h + low) / 2, 0), top);
    // Its sides and the lip's face: a triangle each side, a quad across the front.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      w, 0, -l, w, 0, l, w, h, l, w, 0, -l, w, h, l, w, low, -l,
      -w, 0, -l, -w, h, l, -w, 0, l, -w, 0, -l, -w, low, -l, -w, h, l,
      -w, 0, l, -w, h, l, w, h, l, -w, 0, l, w, h, l, w, 0, l,
    ], 3)); g.computeVertexNormals();
    ramp.add(slope, new THREE.Mesh(g, body));
    ramp.position.set(r.x, 0, r.z); ramp.rotation.y = r.yaw;
    group.add(ramp);
  }
  group.traverse(node => { node.raycast = ignore; });
  return group;
}

// A low wall along each edge, a quad a sample, in stripes; none where circuit.open says another part of the road comes
// through it (each side its own).
function kerbs({ points, length, open = { right: new Uint8Array(points.length / 2), left: new Uint8Array(points.length / 2) } }) {
  const count = points.length / 2, spacing = length / count, position = [], colour = [], red = new THREE.Color('#d8382c'), white = new THREE.Color('#f2efe8');
  const at = i => {
    const k = (i % count + count) % count, a = (k - 1 + count) % count, b = (k + 1) % count;
    const fx = points[b * 2] - points[a * 2], fz = points[b * 2 + 1] - points[a * 2 + 1], d = Math.hypot(fx, fz) || 1;
    return [points[k * 2], points[k * 2 + 1], -fz / d, fx / d];
  };
  for (const side of [1, -1]) for (let i = 0, gaps = open[side > 0 ? 'right' : 'left']; i < count; i++) {
    if (gaps[i] || gaps[(i + 1) % count]) continue;
    const [x0, z0, rx0, rz0] = at(i), [x1, z1, rx1, rz1] = at(i + 1), off = side * (KERB + KERB_OUT);
    const ax = x0 + rx0 * off, az = z0 + rz0 * off, bx = x1 + rx1 * off, bz = z1 + rz1 * off;
    position.push(ax, 0, az, bx, 0, bz, bx, KERB_H, bz, ax, 0, az, bx, KERB_H, bz, ax, KERB_H, az);
    const c = Math.floor(i * spacing / KERB_STRIPE) % 2 ? red : white;
    for (let v = 0; v < 6; v++) colour.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, toonMaterial('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
}

const mergeTwo = (a, b) => {
  const pa = a.attributes.position.array, pb = b.attributes.position.array, g = new THREE.BufferGeometry(), offset = pa.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pa, ...pb], 3));
  g.setIndex([...a.index.array, ...Array.from(b.index.array, i => i + offset)]); g.computeVertexNormals();
  return g;
};

// Collect's paperclips (rc-course.js's placePickups): gold wire bent into three loops, 9.5 cm tall, each with a glow round it
// so it shows across the office. → a group; its userData.items: [{ node, clip }] (rc.js spins them and hides those taken).
export function buildPickups(clips) {
  const group = new THREE.Group(), pts = [];
  const line = (x0, y0, x1, y1) => { for (let k = 0; k <= 4; k++) pts.push(new THREE.Vector3(x0 + (x1 - x0) * k / 4, y0 + (y1 - y0) * k / 4, 0)); };
  const turn = (cx, cy, r, from, to) => { for (let k = 1; k < 8; k++) { const a = from + (to - from) * k / 8; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0)); } };
  line(0.15, 0.3, 0.15, -0.55); turn(-0.05, -0.55, 0.2, 0, -Math.PI);
  line(-0.25, -0.55, -0.25, 0.6); turn(0.075, 0.6, 0.325, Math.PI, 0);
  line(0.4, 0.6, 0.4, -0.75); turn(0, -0.75, 0.4, 0, -Math.PI);
  line(-0.4, -0.75, -0.4, 0.35);
  const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.07, 6, false).scale(0.05, 0.05, 0.05);
  const gold = toonMaterial('#f6c33b', { emissive: '#4a3300' }), glow = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd84a', blending: THREE.AdditiveBlending, depthWrite: false });
  glow.userData.shared = true; // one for all of them, and its texture is furniture.js's
  group.userData.items = clips.map(clip => {
    const node = new THREE.Group(), halo = new THREE.Sprite(glow); halo.scale.setScalar(0.3);
    node.add(new THREE.Mesh(wire, gold), halo); node.position.set(clip.x, clip.y, clip.z); group.add(node);
    return { node, clip };
  });
  group.traverse(node => { node.raycast = ignore; });
  return group;
}

// Frees a track's (or buildRamps', buildPickups') geometry and its own materials and textures (shared ones once, and not
// those marked shared).
export function disposeTrack(group) {
  const seen = new Set();
  group.traverse(node => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    if (!seen.has(node.material) && !node.material.userData.shared) { seen.add(node.material); node.material.map?.dispose(); node.material.dispose(); }
  });
  group.removeFromParent();
}
