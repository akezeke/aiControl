// The kitchen and lunch room, through swinging doors in the office's left wall. Everything thrown at in here is drawn where
// kitchen-plan.js says it is, with those boxes' shapes. It's built ahead of the doors, a slice at a time between frames (prepare, driven by office.js), so they
// open with nothing left to do; shut (or in the overview) it's skipped whole, like the games room (secret.js): not drawn, its matrices not kept up and no ray tested on it.
// The doors swing open as you come near, jump with reduced motion, and stop being a box to thrown things as soon as they start.
// Fruit and the goose stay out (their paths only know the office).
// ponytail: no lamp lights of its own, unlike the games room. The office's fill and daylight already reach in here and follow the switch,
// and a spot light would cost every lit pixel of the office with the doors shut (lights.js). Its lamps are only drawn.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_H, WALL_T, canvasTexture, floorShadow, glowTexture, once, paint, painted, piece, shared, swingDoor } from './furniture.js';
import { COPY, INK, cardsMesh, face, fit, lines, printOn } from './cutouts.js';
import { DOOR_H, DOOR_W, KITCHEN, PAN, SPOTS, VESSELS, behind, flightBoxes, walkBoxes } from './kitchen-plan.js';
import { kitchenDoor, kitchenShift } from './layout.js';
import { dims } from './lights.js';
import { createWindows } from './windows.js';
import { instancedOutline, toonMaterial } from './toon.js';

export const DOOR_NEAR = 2.5, DOOR_FAR = 3; // they open within the one, and once open they stay until past the other
const MOVE = 0.45, SWUNG = 1.62; // seconds to swing; radians, a little past square to the wall

const LOOK = { fridge: '#dfe3e6', counter: '#7aa095', sink: '#b9bec6', cupboard: '#8bb0a4', island: '#b5653a', cutout: '#b08a5a', banner: '#2f6b4f', 'sign-1': '#f2c230', 'sign-2': '#2b2f2c', basket: '#b98a4e', shelf: '#8a5a33', tray: '#3f78b5', table: '#e8d9b8', tableMug: '#f4efe6', chair: '#d65a4a', vending: '#c83b3b', bin: '#3a3d46', bucket: '#c9ccd2' };
const METAL = '#5a5f68', WATER = '#5f8796', GROUT = '#b7c7c2', TILE = '#dfe9e6', PLASTER = '#f3ead6', DARK = '#2b2f33', STEEL = '#b9bec6', RAIL = '#d3d8df', COPPER = '#c9743f', TIN = '#e6e8ea';

// A box from corner to corner, and one from a plan's box or tilted box.
const B = (x0, y0, z0, x1, y1, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const shaped = b => b.quaternion ? turned(b, new THREE.Vector3(), b.half) : B(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
// A little box at `at` in a tilted box's own frame, turned with it.
const turned = (b, at, half) => new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2).translate(at.x, at.y, at.z).applyQuaternion(b.quaternion).translate(b.centre.x, b.centre.y, b.centre.z);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const kind = b => b.surface.replace(/-.*$/, '');

// What stands in the room: every box of the plan in its colour, then what has no box of its own (legs, handles, the tap, the rack's wires).
function roomParts() {
  const boxes = flightBoxes().filter(b => kind(b) !== 'wall'), parts = boxes.filter(b => kind(b) !== 'pan' && !isCard(b)).map(b => [shaped(b), b.bounce === 0 ? WATER : LOOK[b.surface] ?? LOOK[kind(b)]]);
  const add = (geometry, color) => parts.push([geometry, color]), of = name => boxes.filter(b => b.surface === name);

  // Chairs: legs and back posts in the seat's frame, so they lie down with the tipped one.
  for (let n = 1; n <= 9; n++) {
    const [seat] = of(`chair-${n}`);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) add(turned(seat, V(sx * 0.19, -0.225, sz * 0.19), V(0.016, 0.205, 0.016)), METAL);
      add(turned(seat, V(sx * 0.17, 0.05, -0.2), V(0.012, 0.05, 0.012)), METAL);
    }
  }
  for (const { x, z, h } of SPOTS.lunchTables) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(B(x + sx * 0.62 - 0.025, 0, z + sz * 0.32 - 0.025, x + sx * 0.62 + 0.025, h - 0.04, z + sz * 0.32 + 0.025), METAL);

  // The counter: a top, a dark foot, its doors' edges and handles, an oven under four rings; the sink's tap.
  for (const [x0, x1] of [[-8.6, -7.1], [-6.5, -1.5]]) {
    add(B(x0, 0.89, -8, x1, 0.912, -7.385), '#efe9dc'); add(B(x0, 0, -7.402, x1, 0.07, -7.396), DARK);
    for (let x = x0 + 0.6; x < x1 - 0.05; x += 0.6) add(B(x - 0.004, 0.09, -7.404, x + 0.004, 0.86, -7.398), '#5d8378');
    for (let x = x0 + 0.3; x < x1 - 0.05; x += 0.6) if (x < -3.5 || x > -2.5) add(B(x - 0.07, 0.76, -7.415, x + 0.07, 0.78, -7.396), METAL);
  }
  add(B(-3.4, 0.09, -7.408, -2.6, 0.86, -7.398), '#454a52'); add(B(-3.28, 0.18, -7.414, -2.72, 0.56, -7.402), '#191b1f'); add(B(-3.3, 0.66, -7.43, -2.7, 0.685, -7.405), STEEL);
  for (const [x, z] of [[-3.2, -7.85], [-2.8, -7.85], [-3.2, -7.55], [-2.8, -7.55]]) { add(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20).translate(x, 0.916, z), '#1c1e22'); add(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 14).translate(x, 0.917, z), '#7d4236'); }
  const { x: tx, y: ty, z: tz } = SPOTS.tap;
  add(new THREE.CylinderGeometry(0.014, 0.018, 0.3, 10).translate(tx, ty + 0.15, tz), STEEL); add(B(tx - 0.012, ty + 0.285, tz, tx + 0.012, ty + 0.31, tz + 0.2), STEEL); add(B(tx - 0.014, ty + 0.25, tz + 0.18, tx + 0.014, ty + 0.3, tz + 0.205), STEEL);

  // Cupboards: an open one shows a shallow dark bay in the body behind its door, with a shelf and some mugs; all doors have a knob.
  [...Array(6).keys()].forEach(i => {
    const [body, door] = of(`cupboard-${i + 1}`), open = Math.abs(door.quaternion.y) > 0.01;
    add(turned(door, V(door.half.x - 0.07, -0.26, door.half.z + 0.012), V(0.012, 0.045, 0.012)), METAL);
    if (!open) return;
    const a = body.min.x + 0.04, b = body.max.x - 0.04;
    add(B(a, 1.54, -7.577, b, 2.16, -7.566), '#39403f'); add(B(a, 1.83, -7.579, b, 1.85, -7.562), '#8bb0a4');
    for (let k = 0; k < 4; k++) add(B(a + 0.1 + k * 0.26, 1.85, -7.58, a + 0.2 + k * 0.26, 1.96, -7.56), ['#e9e4d8', '#d65a4a', '#e9e4d8', '#3f78b5'][k]);
  });

  // The island's top and panels; the rack over it, a bright rail on two posts, each pan hung by its handle's end: a copper dish, tinned inside, a long handle, a hook.
  add(B(-6.53, 0.895, -4.18, -3.47, 0.922, -3.02), '#d8a56a');
  for (const z of [-4.155, -3.045]) for (let x = -6; x < -3.6; x += 0.5) add(B(x - 0.005, 0.08, z - 0.003, x + 0.005, 0.86, z + 0.003), '#8f4f2d');
  const { x: rx, y: ry, z: rz, w: rw } = SPOTS.panRack;
  add(new THREE.CylinderGeometry(0.02, 0.02, rw, 10).rotateZ(Math.PI / 2).translate(rx, ry, rz), RAIL);
  for (const x of [rx - rw / 2 + 0.1, rx + rw / 2 - 0.1]) add(new THREE.CylinderGeometry(0.012, 0.012, WALL_H - ry, 8).translate(x, (WALL_H + ry) / 2, rz), RAIL);
  for (let n = 1; n <= 3; n++) { // the pans themselves swing, and are drawn on their own (createPans)
    const [pan] = of(`pan-${n}`), end = panEnd(pan);
    add(new THREE.CylinderGeometry(0.005, 0.005, ry - end.y, 6).translate(end.x, (ry + end.y) / 2, end.z), RAIL);
    add(new THREE.TorusGeometry(0.024, 0.005, 6, 14).rotateY(Math.PI / 2).translate(end.x, ry + 0.012, rz), RAIL);
  }

  // The banner's two cords, each a strand to its top edge and one to its bottom, which is what tips it. The juicer on the counter.
  const [banner] = of('banner');
  for (const side of [-1, 1]) {
    const edge = y => V(side * banner.half.x * 0.8, y * banner.half.y, 0).applyQuaternion(banner.quaternion).add(banner.centre), knot = edge(1).setY(WALL_H);
    for (const y of [1, -1]) { const at = edge(y), along = knot.clone().sub(at); add(new THREE.CylinderGeometry(0.005, 0.005, along.length(), 5).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), along.clone().normalize())).translate((at.x + knot.x) / 2, (at.y + knot.y) / 2, (at.z + knot.z) / 2), '#3a3d46'); }
  }
  const { x: jx, z: jz } = JUICER;
  add(B(jx - 0.09, 0.91, jz - 0.09, jx + 0.09, 1.06, jz + 0.09), STEEL); add(dish([[0, 1.06], [0.09, 1.07], [0.115, 1.12], [0.105, 1.12], [0.05, 1.08]]).translate(jx, 0, jz), STEEL); add(new THREE.ConeGeometry(0.05, 0.07, 12).translate(jx, 1.115, jz), '#f4efe6');

  // The fridge's handle; the shelf's brackets; handles for the bucket and the mug.
  const [, fridgeDoor] = of('fridge'); add(turned(fridgeDoor, V(0.34, 0.1, fridgeDoor.half.z + 0.016), V(0.012, 0.3, 0.016)), METAL);
  for (const z of [SPOTS.shelf.z0 + 0.2, SPOTS.shelf.z1 - 0.2]) add(B(-10, 1.3, z - 0.012, -9.99, 1.46, z + 0.012), METAL), add(B(-10, 1.44, z - 0.012, -9.74, 1.46, z + 0.012), METAL);
  add(new THREE.TorusGeometry(VESSELS.bucket[3], 0.006, 6, 18, Math.PI).translate(VESSELS.bucket[0], VESSELS.bucket[4], VESSELS.bucket[2]), METAL);
  add(new THREE.TorusGeometry(0.035, 0.009, 6, 12).rotateY(Math.PI / 2).translate(VESSELS.tableMug[0], VESSELS.tableMug[1] + 0.06, VESSELS.tableMug[2] + VESSELS.tableMug[3] + 0.02), LOOK.tableMug);

  // The clipboard and the score board, blank for now.
  { const { x, y, z, w, h } = SPOTS.clipboard; add(B(x - 0.012, y - h / 2, z - w / 2, x + 0.012, y + h / 2, z + w / 2), '#a87b4f'); add(B(x - 0.016, y - h / 2 + 0.02, z - w / 2 + 0.02, x - 0.012, y + h / 2 - 0.03, z + w / 2 - 0.02), '#fbfaf5'); add(B(x - 0.024, y + h / 2 - 0.05, z - 0.05, x - 0.012, y + h / 2 - 0.005, z + 0.05), METAL); }
  { const { x, y, z, w, h } = SPOTS.scores; add(B(x - w / 2 - 0.04, y - h / 2 - 0.04, z, x + w / 2 + 0.04, y + h / 2 + 0.04, z + 0.02), '#6d4a2b'); add(B(x - w / 2, y - h / 2, z - 0.004, x + w / 2, y + h / 2, z), '#fbfaf5'); }
  return parts;
}

// A pan in its own frame: a copper dish, tinned inside, a long handle (on the rim, not through it), and the ring it hangs by.
const dish = points => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 28);
const panEnd = pan => V(PAN.reach, 0.018, 0).applyQuaternion(pan.quaternion).add(pan.centre);
const panParts = () => {
  const { r, reach } = PAN;
  return [[dish([[0, -0.012], [r - 0.02, -0.012], [r, 0.03], [r - 0.004, 0.034]]), COPPER], [dish([[r - 0.004, 0.034], [r - 0.024, -0.005], [0, -0.005]]), TIN],
    [new THREE.BoxGeometry(reach - r + 0.02, 0.012, 0.024).translate((r + reach) / 2 - 0.01, 0.018, 0), METAL], [new THREE.TorusGeometry(0.018, 0.005, 6, 12).translate(reach, 0.018, 0), RAIL]];
};
// Hit, a pan swings from its hook on a spring and settles: one mesh, its matrices touched only while something moves. Only to look at: its
// box in the plan stays where it is.
function createPans(group) {
  const pans = flightBoxes().filter(b => kind(b) === 'pan'), mesh = new THREE.InstancedMesh(once('kitchenPan', () => paint(panParts())), painted(), pans.length);
  mesh.raycast = () => {};
  instancedOutline(mesh, 0.008);
  const swinging = pans.map(() => ({ angle: 0, speed: 0 })), rest = pans.map(pan => new THREE.Matrix4().compose(pan.centre, pan.quaternion, V(1, 1, 1))), ends = pans.map(panEnd);
  const there = new THREE.Matrix4(), turn = new THREE.Matrix4(), back = new THREE.Matrix4(), out = new THREE.Matrix4();
  const place = i => { const { x, y, z } = ends[i]; there.makeTranslation(x, y, z); back.makeTranslation(-x, -y, -z); turn.makeRotationX(swinging[i].angle); mesh.setMatrixAt(i, out.copy(there).multiply(turn).multiply(back).multiply(rest[i])); };
  pans.forEach((_, i) => place(i));
  group.add(mesh);
  let moving = false;
  return {
    hit(n, speed) { const s = swinging[n - 1]; if (s) { s.speed += Math.min(speed, 10) * 0.5; moving = true; } },
    update(dt) {
      if (!moving) return;
      moving = false;
      swinging.forEach((s, i) => {
        s.speed += (-30 * s.angle - 1.6 * s.speed) * dt; s.angle += s.speed * dt;
        if (Math.abs(s.angle) < 0.002 && Math.abs(s.speed) < 0.02) s.angle = s.speed = 0; else moving = true;
        place(i);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    rest() { if (!moving) return; moving = false; swinging.forEach((s, i) => { s.angle = s.speed = 0; place(i); }); mesh.instanceMatrix.needsUpdate = true; },
  };
}

// What's printed on this room's own canvas, so one draw, each cell a step of its own; the cutouts' cards are on a sheet of their own (cutouts.js).
const JUICER = { x: -4.7, z: -7.62 }, isCard = b => /^cutout/.test(b.surface) && b.half.y > 0.7 && b.half.x > 0.4;
const ATLAS = [1156, 892], CELLS = { banner: [0, 0, 1024, 240], juicer: [1028, 0, 128, 128], motto: [0, 244, 1144, 134], wet: [0, 382, 300, 506], special: [304, 382, 340, 510] };
const { fromCell, onFace } = printOn(ATLAS);
const PRINTS = [
  g => { const [x, y, w, h] = CELLS.banner; g.fillStyle = LOOK.banner; g.fillRect(x, y, w, h); g.strokeStyle = '#f2c230'; g.lineWidth = 8; g.strokeRect(x + 12, y + 12, w - 24, h - 24); g.fillStyle = '#fbf6e8'; const big = fit(g, COPY.company, w - 70, 120, 104); g.font = face(big.size); lines(g, big.lines, x + w / 2, y + 88, big.size); g.fillStyle = '#f2c230'; g.font = face(58); lines(g, [COPY.motto], x + w / 2, y + 176, 58); },
  g => { const [x, y, w, h] = CELLS.motto, { size } = fit(g, COPY.wall, w - 8, h, 124); g.fillStyle = '#2f6b66'; g.font = face(size); lines(g, [COPY.wall], x + w / 2, y + h / 2 + 4, size); },
  g => { const [x, y, w, h] = CELLS.wet; g.fillStyle = LOOK['sign-1']; g.fillRect(x, y, w, h); g.fillStyle = INK; for (const [text, mid, tall] of [[COPY.wet[0], 126, 190], [COPY.wet[1], 358, 358]]) { const { size } = fit(g, text, w - 44, h, 200); g.save(); g.translate(x + w / 2, y + mid); g.scale(1, tall / size); g.font = face(size); lines(g, [text], 0, 0, size); g.restore(); } g.lineWidth = 10; g.strokeStyle = INK; g.strokeRect(x + 7, y + 7, w - 14, h - 14); },
  g => { const [x, y, w, h] = CELLS.special; g.fillStyle = LOOK['sign-2']; g.fillRect(x, y, w, h); g.strokeStyle = '#a87b4f'; g.lineWidth = 16; g.strokeRect(x + 8, y + 8, w - 16, h - 16); g.fillStyle = '#fbf6e8'; const top = COPY.special.slice(0, 2), a = fit(g, top.join(' '), w - 56, 170, 72), b = fit(g, COPY.special[2], w - 50, 120, 80); g.font = face(a.size); lines(g, top, x + w / 2, y + 150, a.size); g.fillStyle = '#f2c230'; g.font = face(b.size); lines(g, [COPY.special[2]], x + w / 2, y + 340, b.size); },
  g => { const [x, y, w, h] = CELLS.juicer; g.fillStyle = '#ffe873'; g.fillRect(x, y, w, h); g.fillStyle = INK; const { size } = fit(g, COPY.juicer[1], w - 14, 44, 34); g.font = face(size); lines(g, COPY.juicer, x + w / 2, y + h / 2, size); },
];
function printed(sheet) {
  const of = name => flightBoxes().filter(b => b.surface === name), cards = [1, 2, 3, 4].map(n => of(`cutout-${n}`).find(isCard)), [banner] = of('banner'), [jx, jz] = [JUICER.x, JUICER.z];
  const motto = new THREE.PlaneGeometry(SPOTS.motto.w, SPOTS.motto.h).rotateY(Math.PI / 2).translate(-KITCHEN.width + 0.006, SPOTS.motto.y, SPOTS.motto.z), note = new THREE.PlaneGeometry(0.11, 0.11).translate(jx, 0.985, jz + 0.092);
  const all = [onFace(banner, CELLS.banner), onFace(banner, CELLS.banner, true), ...of('sign-1').map(b => onFace(b, CELLS.wet)), ...of('sign-2').map(b => onFace(b, CELLS.special)), fromCell(motto, CELLS.motto), fromCell(note, CELLS.juicer)];
  const print = new THREE.Mesh(mergeGeometries(all), toonMaterial('#ffffff', { map: sheet, alphaTest: 0.5, alphaToCoverage: true }));
  print.raycast = () => {};
  return [print, cardsMesh(cards.map((card, look) => ({ card, look })))];
}

// The walls in plaster with their skirting, the north wall's tiles over the counter, and the office's wall lined this side, its doorway cut out.
function shellParts() {
  const { width: w, back, front } = KITCHEN, T = WALL_T, parts = [[B(-w - T, 0, back - T, 0, WALL_H, back), PLASTER], [B(-w - T, 0, front, 0, WALL_H, front + T), PLASTER], [B(-w - T, 0, back, -w, WALL_H, front), PLASTER]];
  const d = DOOR_W / 2, outline = new THREE.Shape().moveTo(back, 0).lineTo(-d, 0).lineTo(-d, DOOR_H).lineTo(d, DOOR_H).lineTo(d, 0).lineTo(front, 0).lineTo(front, WALL_H).lineTo(back, WALL_H);
  parts.push([new THREE.ShapeGeometry(outline).rotateY(-Math.PI / 2).translate(-0.005, 0, 0), PLASTER]);
  for (const b of [B(-w, 0, back, 0, 0.1, back + 0.012), B(-w, 0, front - 0.012, 0, 0.1, front), B(-w, 0, back, -w + 0.012, 0.1, front)]) parts.push([b, '#3a4352']);
  parts.push([B(-8.6, 0.91, back, -1.5, 1.5, back + 0.006), TILE]);
  for (let x = -8.6; x <= -1.5; x += 0.2) parts.push([B(x - 0.003, 0.91, back, x + 0.003, 1.5, back + 0.009), GROUT]);
  for (let y = 1.05; y < 1.5; y += 0.15) parts.push([B(-8.6, y - 0.003, back, -1.5, y + 0.003, back + 0.009), GROUT]);
  return parts;
}

// Glass that keeps its light when the switch is off: the vending machine's front, with rows of things in it, and the fridge, ajar.
function glowParts() {
  const parts = [[B(-9.198, 0.62, 0.06, -9.19, 1.82, 0.56), '#d6f2ff'], [B(-9.72, 0.06, -7.249, -9.08, 1.84, -7.245), '#fff6d8']];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 4; i++) parts.push([B(-9.19, 0.7 + row * 0.28, 0.1 + i * 0.11, -9.186, 0.86 + row * 0.28, 0.18 + i * 0.11), ['#e0a13a', '#c9473c', '#4c8fd6', '#5faa63'][(row * 3 + i) % 4]]);
  parts.push([B(-9.197, 0.62, 0.6, -9.19, 1.82, 0.74), '#30343a'], [B(-9.197, 0.14, 0.08, -9.19, 0.46, 0.72), '#1c1e22']);
  return parts;
}

// Vinyl squares, and the ceiling's tiles.
const vinyl = g => { for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) { g.fillStyle = (x + y) % 128 ? '#c6bdab' : '#e9e3d5'; g.fillRect(x, y, 64, 64); } };
const tile = g => { g.fillStyle = '#fbfbfa'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#d8dce2'; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128); };
const repeating = (draw, u, v) => { const t = canvasTexture(128, 128, draw); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(u, v); return t; };
// Where the lamps hang, and where the room's big things throw a shadow: x, z, w, d.
const LAMPS = [-7.8, -5, -2.2].flatMap(x => [[x, -5.2], [x, -2.3], [x, 0]]);
const SHADOWS = () => [[-9.4, -7.5, 1, 1], [-5, -7.6, 7.4, 1], [-5, -3.6, 3.3, 1.4], ...SPOTS.lunchTables.map(({ x, z, w, d }) => [x, z, w + 0.3, d + 0.3]), [-9.6, 0.4, 1, 1], ...flightBoxes().filter(isCard).map(b => [b.centre.x, b.centre.z, 0.85, 0.6]), ...['sign-1', 'sign-2'].map(name => flightBoxes().filter(b => b.surface === name)).map(([a, b]) => [(a.centre.x + b.centre.x) / 2, (a.centre.z + b.centre.z) / 2, 0.75, 0.55])];

// The room in its own frame (kitchen-plan.js's), as steps to run in order, each small enough to go between frames.
function roomSteps(group, done) {
  const { width: w, back, front } = KITCHEN, long = front - back, mid = (front + back) / 2;
  let parts, sheet;
  return [
    () => { const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, long).rotateX(-Math.PI / 2), toonMaterial('#ffffff', { map: repeating(vinyl, w, long) })); floor.position.set(-w / 2, 0, mid); floor.userData.floor = true; group.add(floor); },
    () => { const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, long).rotateX(Math.PI / 2), dims(new THREE.MeshBasicMaterial({ map: repeating(tile, w / 1.2, long / 1.2), color: '#dfe2e7' }), 0.3)); ceiling.position.set(-w / 2, WALL_H, mid); group.add(ceiling); },
    () => group.add(piece('kitchenShell', shellParts, 0)),
    () => { parts = shared.kitchenRoom ? null : roomParts(); },
    () => { once('kitchenRoom', () => paint(parts)); },
    () => group.add(piece('kitchenRoom', roomParts)),
    () => { sheet = canvasTexture(...ATLAS, (g, W, H, draw) => draw?.(g)); },
    ...PRINTS.map(draw => () => sheet.redraw(draw)),
    () => group.add(...printed(sheet)),
    // Switched off, the lamps go grey and their glow goes out (black adds nothing). A ray goes through what only shines.
    () => { const shine = new THREE.Mesh(once('kitchenGlow', () => paint(glowParts())), new THREE.MeshBasicMaterial({ vertexColors: true })); shine.raycast = () => {}; group.add(shine); },
    () => { const lamps = new THREE.Mesh(mergeGeometries(LAMPS.map(([x, z]) => B(x - 0.6, WALL_H - 0.05, z - 0.18, x + 0.6, WALL_H, z + 0.18))), dims(new THREE.MeshBasicMaterial({ color: '#fff8e2' }), 0.3)); lamps.raycast = () => {}; group.add(lamps); },
    () => { const glow = new THREE.Mesh(mergeGeometries(LAMPS.map(([x, z]) => new THREE.PlaneGeometry(3, 2).rotateX(Math.PI / 2).translate(x, WALL_H - 0.005, z))), dims(new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0)); glow.raycast = () => {}; group.add(glow); },
    () => { const shadows = floorShadow(1, 1, 0.3); shadows.geometry = mergeGeometries(SHADOWS().map(([x, z, sx, sz]) => new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(x, 0, z))); group.add(shadows); },
    () => { const windows = createWindows([-0.8]); windows.position.set(0, WALL_H / 2, back - WALL_T / 2); group.add(windows); },
    () => { once('kitchenPan', () => paint(panParts())); },
    () => done(createPans(group)),
  ];
}

export function createKitchen({ onMove } = {}) {
  let origin = null, depth = 0, t = 0, held = false, opened = false, fill = null, stood = [];
  const games = [];
  const group = new THREE.Group(); group.userData.kitchen = 'room'; group.visible = group.matrixWorldAutoUpdate = false;
  group.raycast = () => group.visible; // hidden, a ray (the pointer's, every hover) skips all of it
  // The doors hang on the office's wall, so they hide with it; their axes are the kitchen's. userData keeps room.js's bake off what moves.
  const doors = new THREE.Group(); doors.userData.kitchen = 'doors';
  const leaves = [-1, 1].map(side => { const leaf = swingDoor(); leaf.userData.leaf = true; leaf.position.set(0.03, 0, side * DOOR_W / 2); doors.add(leaf); return leaf; });
  const swing = open => { const e = open * open * (3 - 2 * open) * SWUNG; leaves[0].rotation.y = -e; leaves[1].rotation.y = Math.PI + e; };
  swing(0);
  // Where things are now, for thrown things and the doors: the room once they've first opened, and the shut door while it is.
  const refresh = () => { kitchen.flight = [...(opened ? stood : []), ...(t === 0 && fill ? [fill] : [])]; onMove?.(); };
  // What's still to build, in order, games last. A step's gone before it runs, so whoever gets to it first, nothing's built twice.
  const steps = roomSteps(group, pans => { kitchen.pans = pans; });

  const kitchen = {
    group, doors, flight: [],
    get origin() { return origin; },
    get shown() { return group.visible; },
    // Inside the kitchen (past the middle of the wall), at `p`.
    inside(p) { return !!origin && p.x < origin.x + WALL_T / 2 && p.x > origin.x - KITCHEN.width && p.z > origin.z + KITCHEN.back && p.z < origin.z + KITCHEN.front; },
    shut(on) { held = on; },
    add(game) { games.push(game); const build = () => game.build(group); if (steps.length) steps.push(build); else build(); },
    // Getting ready before anyone's near: each next() is a slice of work, and what it yields is to be waited for. The shaders are compiled with the
    // scene's lights, and hidden doesn't stop them (compile goes through all of it), so the room's first frame finds its programs; then each texture.
    // Update finishes the building if the doors get there first, and the rest is still worth doing then, for what that first frame didn't look at.
    * prepare(renderer, camera, scene) {
      while (steps.length) { steps.shift()(); yield; }
      if (!renderer) return;
      const known = new Set(renderer.info.programs);
      yield renderer.compileAsync(group, camera, scene);
      // A program's first use is what waits for its link, where the browser can't say it's finished. Better here than in the frame the doors open.
      for (const program of renderer.info.programs) if (!known.has(program)) { program.getUniforms(); program.getAttributes(); yield; }
      const maps = new Set(); group.traverse(node => { for (const material of [node.material].flat()) for (const value of Object.values(material ?? {})) if (value?.isTexture) maps.add(value); });
      for (const map of maps) { const had = renderer.info.memory.textures; renderer.initTexture(map); if (renderer.info.memory.textures > had) yield; } // one that's up already is nothing
    },
    // The room's `depth` (a new shell, `wall` being its left wall): the same kitchen moves with the door, telling kitchen.moved first, while
    // inside() still means where it was. Returns what blocks walking: its walls, what stands on the floor, and the floor behind it.
    build({ depth: now, shell, wall }) {
      if (origin && now !== depth) kitchen.moved?.(kitchenShift(depth, now));
      depth = now; origin = { x: -WALL_T, z: kitchenDoor(depth) }; group.position.set(origin.x, 0, origin.z);
      const all = flightBoxes(origin); fill = all.filter(b => b.surface === 'wall-e').at(-1); stood = all.filter(b => kind(b) !== 'wall');
      const local = depth / 2 - origin.z;
      doors.position.set(local, -WALL_H / 2, -WALL_T / 2); doors.rotation.y = -Math.PI / 2; wall.add(doors);
      const casing = piece('kitchenCasing', () => [[B(-0.03, 0, -DOOR_W / 2 - 0.06, WALL_T + 0.03, DOOR_H + 0.06, -DOOR_W / 2 + 0.005), '#2f6b66'], [B(-0.03, 0, DOOR_W / 2 - 0.005, WALL_T + 0.03, DOOR_H + 0.06, DOOR_W / 2 + 0.06), '#2f6b66'], [B(-0.03, DOOR_H - 0.005, -DOOR_W / 2, WALL_T + 0.03, DOOR_H + 0.06, DOOR_W / 2), '#2f6b66']]);
      casing.position.copy(doors.position); casing.rotation.copy(doors.rotation); wall.add(casing);
      casing.raycast = () => {}; // baked, its one box would fill the doorway and no tap would get through to the floor beyond
      // A sill across the doorway's floor, where the wall stands (neither room's floor reaches into it).
      const sill = piece('kitchenSill', () => [[B(-WALL_T, 0, -DOOR_W / 2, 0, 0.012, DOOR_W / 2), '#6d4a2b']], 0); sill.position.set(0, 0, origin.z); shell.add(sill);
      refresh();
      const blocks = games.flatMap(game => game.blocks ?? []).map(b => b.clone().translate(V(origin.x, 0, origin.z)));
      // The office's wall stops at its windows wall: in a small room the kitchen reaches further back, and that piece of the east wall is the kitchen's.
      const edge = origin.z + KITCHEN.back - WALL_T, east = edge < -WALL_T ? [Object.assign(new THREE.Box3(V(-WALL_T, 0, edge), V(0, WALL_H, -WALL_T)), { surface: 'wall-e' })] : [];
      return [...flightBoxes(origin, { doorShut: false }).filter(b => /^wall-[nsw]/.test(b.surface)), ...east, ...walkBoxes(origin), ...blocks, behind(origin)];
    },
    // Each frame, with where you stand (not the camera, which the overview lifts away).
    update(dt, at, still, overview) {
      if (!origin) return;
      const inside = kitchen.inside(at), far = Math.hypot(at.x - (origin.x + WALL_T / 2), at.z - origin.z), goal = !held && (inside || far < (t > 0 ? DOOR_FAR : DOOR_NEAR)) ? 1 : 0, was = t;
      if (t !== goal) t = still ? goal : THREE.MathUtils.clamp(t + (goal ? dt : -dt) / MOVE, 0, 1);
      const shown = (t > 0 || inside) && overview < 0.01, opening = !opened && (t > 0 || inside);
      // The first time it opens, whatever isn't built yet is. Things can be thrown at it from then on, whether the doors are open or not.
      if (opening) { opened = true; while (steps.length) steps.shift()(); }
      if (opening || (was === 0) !== (t === 0)) refresh();
      group.visible = group.matrixWorldAutoUpdate = shown;
      swing(overview < 0.01 ? t : 0); // the overview doesn't draw the room: nothing to see through
      if (shown) kitchen.pans?.update(dt);
      for (const game of games) game.update(dt, at, still, shown);
    },
  };
  return kitchen;
}
