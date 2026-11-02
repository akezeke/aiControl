// Low-Hanging Fruit's cardboard cutouts, and every word the company has printed. The cards are on one small sheet, built with the office and
// shared with the kitchen; the rest of the kitchen's print (kitchen.js) waits for the kitchen. Three of them stand along the office's walls,
// in gaps that move with the room: a thrown thing bounces off them, the player, the fruit and the goose walk round them, a tap goes through.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TiltedBox } from './flight.js';
import { LIMB, outline } from './fruit.js';
import { canvasTexture } from './furniture.js';
import { cutout } from './kitchen-plan.js';
import { toonMaterial } from './toon.js';

// Every word the company has printed. Its name goes everywhere from here.
export const COPY = {
  company: 'LOW-HANGING FRUIT LTD.', motto: 'Ripe for disruption.', wall: 'RIPE FOR DISRUPTION', wet: ['CAUTION:', 'MOIST'], special: ["TODAY'S", 'SPECIAL:', 'SYNERGY'], juicer: ['NOT', 'FUNNY'],
  // In the plan's order: cutout-1 is the pear.
  cutouts: [{ fruit: 'pear', says: "LET'S PEAR PROGRAM!" }, { fruit: 'orange', says: 'ORANGE YOU GLAD IT SHIPPED?' }, { fruit: 'banana', says: 'NEVER SLIP ON A DEADLINE' }, { fruit: 'lemon', says: 'ZERO LEMONS SHIPPED*', small: '*this quarter' }],
};

export const INK = '#1b1a1f';
const CARDS = ['#2f6b66', '#1f7a8c', '#c9473c', '#3a6ea5'], FRUIT = ['#b5c934', '#f28c28', '#f7d23e', '#f9e04b'], KRAFT = '#b08a5a'; // the fruits' colours are status.js's
export const face = (size, family = 'system-ui, sans-serif') => `bold ${size}px ${family}`;
// The biggest size up to `most` at which each word of `text` fits in `w` and the wrapped lines in `h`: lines, size.
export const fit = (g, text, w, h, most) => {
  for (let size = most; ; size -= 2) {
    g.font = face(size);
    const lines = []; let line = '';
    for (const word of text.split(' ')) { const next = line ? `${line} ${word}` : word; if (line && g.measureText(next).width > w) { lines.push(line); line = word; } else line = next; }
    lines.push(line);
    if (size <= 16 || (lines.length * size * 1.12 <= h && !lines.some(l => g.measureText(l).width > w))) return { lines, size };
  }
};
export const lines = (g, list, x, y, size, step = size * 1.12) => { g.textAlign = 'center'; g.textBaseline = 'middle'; list.forEach((l, i) => g.fillText(l, x, y + (i - (list.length - 1) / 2) * step)); };

// A sheet of print `size` in pixels: fromCell puts a geometry's picture in a cell of it, onFace makes a plane on a box's face from a cell, from
// the front or (`behind`) its back as you'd read it from there, so it's where a throw meets it and turns with it.
export const printOn = ([W, H]) => {
  const fromCell = (g, [x, y, w, h]) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / W, 1 - (y + (1 - uv.getY(i)) * h) / H); return g; };
  return { fromCell, onFace: (b, cell, behind = false) => {
    const g = fromCell(new THREE.PlaneGeometry(b.half.x * 2, b.half.y * 2), cell);
    if (behind) g.rotateY(Math.PI);
    return g.translate(0, 0, (behind ? -1 : 1) * (b.half.z + 0.0015)).applyQuaternion(b.quaternion).translate(b.centre.x, b.centre.y, b.centre.z);
  } };
};

// A card's drawn at 512 x 880 and scaled to its cell: the smallest that still reads from 1.5 m. 4 px between cells, so mipmaps don't bleed.
const SCALE = 0.375, GAP = 4, CARD_W = 512 * SCALE, CARD_H = 880 * SCALE;
const CELLS = [0, 1, 2, 3].map(i => [i * (CARD_W + GAP), 0, CARD_W, CARD_H]), BACK = [4 * (CARD_W + GAP), 0, 128 * SCALE, 220 * SCALE], SHEET = [BACK[0] + BACK[2], CARD_H];
const PLAIN = [BACK[0] + BACK[2] / 4, BACK[3] / 5, BACK[2] / 2, BACK[3] / 5]; // bare card on the back, for the struts
const { fromCell, onFace } = printOn(SHEET);

// The fruit's own black hand (fruit.js's fistGeometry) side-on: an arm up to a wide fist, fingers stacked at the far side, a short fat thumb at the near edge leaning off them. It's on anything, so it has a light edge.
function drawThumb(g, hx, hy, fromX, fromY) {
  const FINGER = 100 / 3;
  const parts = [[hx - 52, hy - 50, 100, 100, 34], ...[0, 1, 2].map(k => [hx + 4, hy - 50 + k * FINGER, 56, FINGER, FINGER / 2])];
  g.save(); g.lineCap = g.lineJoin = 'round';
  for (const [color, grow] of [['#fbf6e8', 8], [LIMB, 0]]) {
    g.strokeStyle = g.fillStyle = color; g.lineWidth = 20 + grow; g.beginPath(); g.moveTo(fromX, fromY); g.quadraticCurveTo(hx - 56, fromY, hx - 38, hy + 34); g.stroke(); g.lineWidth = grow;
    g.save(); g.translate(hx - 28, hy - 34); g.rotate(-0.26); g.beginPath(); g.roundRect(-23, -56, 46, 80, 23); g.fill(); if (grow) g.stroke(); g.restore();
    for (const p of parts) { g.beginPath(); g.roundRect(...p); g.fill(); if (grow) g.stroke(); }
  }
  g.strokeStyle = '#fbf6e8'; g.lineWidth = 3; for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(hx + 22, hy - 50 + k * FINGER); g.lineTo(hx + 52, hy - 50 + k * FINGER); g.stroke(); }
  g.restore();
}
function drawCutout(g, { fruit, says, small }, i) {
  g.save(); g.translate(CELLS[i][0], 0); g.scale(SCALE, SCALE);
  g.beginPath(); g.roundRect(8, 6, 496, 868, 34); g.fillStyle = CARDS[i]; g.fill(); g.save(); g.clip();
  g.fillStyle = '#ffffff22'; for (let a = 0; a < 12; a++) { g.beginPath(); g.moveTo(240, 590); const t = (a + 0.5) * Math.PI / 6; g.arc(240, 590, 900, t, t + 0.26); g.fill(); }
  g.fillStyle = INK; g.fillRect(0, 806, 512, 80); g.fillStyle = '#fbf6e8'; g.font = face(30); lines(g, [COPY.company], 256, 842, 30); g.restore();
  // The fruit, as tall as there's room for, feet on the strip.
  const shape = outline(fruit), xs = shape.map(p => p[0]), ys = shape.map(p => p[1]), low = Math.min(...ys), high = Math.max(...ys), scale = 440 / (high - low), mid = (Math.min(...xs) + Math.max(...xs)) / 2, at = ([x, y]) => [230 + (x - mid) * scale, 796 - (y - low) * scale];
  g.lineJoin = 'round'; g.beginPath(); shape.forEach(p => g.lineTo(...at(p))); g.closePath(); g.fillStyle = FRUIT[i]; g.fill(); g.lineWidth = 10; g.strokeStyle = INK; g.stroke();
  const top = at([mid, high]); if (fruit !== 'banana') { g.lineWidth = 14; g.lineCap = 'round'; g.strokeStyle = '#6b4a2a'; g.beginPath(); g.moveTo(top[0], top[1] + 4); g.lineTo(top[0] + 12, top[1] - 26); g.stroke(); g.fillStyle = '#4f9a4a'; g.beginPath(); g.ellipse(top[0] + 44, top[1] - 16, 34, 15, -0.35, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke(); }
  // A face, like theirs, and the thumb's arm reaching off the body: the same idea as the thumbsup pose.
  const fy = 796 - 0.42 * 440, fx = fruit === 'banana' ? 282 : 230; g.fillStyle = INK;
  for (const side of [-1, 1]) { g.beginPath(); g.ellipse(fx + side * 38, fy, 13, 19, 0, 0, 7); g.fill(); }
  g.lineWidth = 9; g.lineCap = 'round'; g.strokeStyle = INK; g.beginPath(); g.arc(fx, fy + 32, 40, 0.25, Math.PI - 0.25); g.stroke();
  drawThumb(g, 420, 566, fx + 84, 680);
  // What it says, and a line from the bubble to the fruit.
  const bx = 22, by = 20, bw = 468, bh = 262; g.fillStyle = '#ffffff'; g.lineWidth = 8; g.beginPath(); g.moveTo(170, by + bh - 6); g.lineTo(fx - 14, top[1] - 8 > by + bh + 6 ? top[1] - 8 : by + bh + 26); g.lineTo(270, by + bh - 6); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.roundRect(bx, by, bw, bh, 30); g.fill(); g.stroke(); g.beginPath(); g.moveTo(174, by + bh - 4); g.lineTo(266, by + bh - 4); g.lineWidth = 10; g.strokeStyle = '#fff'; g.stroke();
  const room = small ? bh - 62 : bh - 28, { lines: said, size } = fit(g, says, bw - 36, room, 84); g.fillStyle = INK; g.font = face(size); lines(g, said, bx + bw / 2, by + 14 + room / 2, size);
  if (small) { g.font = face(30); lines(g, [small], bx + bw / 2, by + bh - 30, 30); }
  g.restore();
}
function drawSheet(g, W, H) {
  g.clearRect(0, 0, W, H);
  COPY.cutouts.forEach((c, i) => drawCutout(g, c, i));
  g.save(); g.translate(BACK[0], BACK[1]); g.scale(SCALE, SCALE); g.fillStyle = KRAFT; g.beginPath(); g.roundRect(2, 1, 124, 218, 9); g.fill(); g.fillStyle = '#9a7648'; g.fillRect(2, 150, 124, 3); g.restore();
}

// One material for both rooms: the sheet's built the first time it's asked for, which is the office's first shell, and stays for the next.
let look;
export const cardsMaterial = () => look ??= Object.assign(toonMaterial('#ffffff', { map: canvasTexture(...SHEET, drawSheet), alphaTest: 0.5, alphaToCoverage: true }), { userData: { shared: true } });
// A card's edge, in bare card: from exactly side-on both its faces are seen from behind and aren't drawn, and it'd be gone. Four strips on the print's outline (drawCutout's margins), stopping at its rounded corners.
const edges = b => {
  const x = b.half.x * (1 - 8 / 256), y = b.half.y * (1 - 6 / 440), round = b.half.x * 34 / 256, thick = b.half.z * 2, at = g => fromCell(g, PLAIN);
  return [
    ...[1, -1].map(side => at(new THREE.PlaneGeometry(thick, 2 * (y - round))).rotateY(side * Math.PI / 2).translate(side * x, 0, 0)),
    ...[1, -1].map(side => at(new THREE.PlaneGeometry(2 * (x - round), thick)).rotateX(-side * Math.PI / 2).translate(0, side * y, 0)),
  ].map(g => g.applyQuaternion(b.quaternion).translate(b.centre.x, b.centre.y, b.centre.z));
};
// `standing` in one mesh, so one draw: each { card, look } its printed front, kraft back and edges, each strut in bare card. A tap goes through, as baked boxes would stop it.
export const cardsMesh = standing => {
  const strut = b => fromCell(new THREE.BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2), PLAIN).applyQuaternion(b.quaternion).translate(b.centre.x, b.centre.y, b.centre.z);
  const mesh = new THREE.Mesh(mergeGeometries(standing.flatMap(c => [onFace(c.card, CELLS[c.look]), onFace(c.card, BACK, true), ...edges(c.card), ...c.strut ? [strut(c.strut)] : []])), cardsMaterial());
  mesh.raycast = () => {};
  return mesh;
};

// The windows wall's bays: a window in each, a poster between each two (room.js).
export const bays = width => Math.max(1, Math.floor(width / 4));
// The pear, in a room whose cells are `cellW` wide. A helper's desk can leave one row to walk along the windows wall (layout.js), so a walker has to step round the
// pear between the third helpers either side: both ways past it are open only with it 1 to 9 cm short of where a cell ends, whatever the project's size (tests/office-cutouts.test.mjs).
// So no sliding along to dodge a poster: the next gap along, and the last is always clear. With one project it stands beside the orange, as far along as the plant lets them.
const PEAR_LEFT = 0.407, PEAR_RIGHT = 0.453, POSTER = 0.37, SHORT = 0.05; // how far each reaches from its x, and how far short
const pearX = (width, cellW) => {
  const last = width - 1.95, pitch = width / bays(width);
  for (let x = cellW - SHORT; x < last; x += cellW) { const poster = Math.round(x / pitch) * pitch; if (x + PEAR_RIGHT < poster - POSTER || x - PEAR_LEFT > poster + POSTER) return x; }
  return last;
};
// Where they stand in a room `width` by `depth`, and how: which card, x, z, yaw and lean in degrees. Windows are low enough to stand in front of; posters aren't.
// The orange is at the windows wall's far end, against the corner's plant. The banana's on the right wall, in the gap between the first two pictures; a room with no pictures
// has the gap left between the bin and where the secret shelf slides to. They go by the room's size alone: nothing stands past the last project, however wide its cells.
const spots = (width, depth, cellW) => [
  { look: 0, wall: 'windows', x: pearX(width, cellW), z: 0.45, yaw: -15, lean: 7 },
  { look: 1, wall: 'windows', x: width - 1.21, z: 0.48, yaw: -22, lean: 9 },
  { look: 2, wall: 'right', x: width - 0.54, z: depth > 11.3 ? 4.7 : 3.32, yaw: -72, lean: 12 },
];
// ponytail: real rooms are at least 10 deep (layout.js); any shallower and the third would stand in the secret shelf's way.
// Each with its card and strut as thrown things meet them (named for its fruit, so surfaceTier knows them) and the one box that's walked round.
export const officeCutouts = ({ width, depth, cellW }) => spots(width, depth, cellW).map(spot => {
  const { fruit } = COPY.cutouts[spot.look], surface = `cutout-${fruit}`, [card, strut] = cutout(surface, spot.x, spot.z, spot.yaw, spot.lean).map(part => new TiltedBox(part));
  return { ...spot, fruit, card, strut, walk: Object.assign(new THREE.Box3().union(card).union(strut), { surface, walkOnly: true }) };
});
