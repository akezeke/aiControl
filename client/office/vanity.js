// The boss's vanity, in the boss's office (boss.js): an oil portrait, a magazine cover, a motivational poster, a year of
// employee-of-the-month frames, a trophy, a name plate and a gold statue on a plinth. Every one of them is the boss: you, in
// your own fruit and colour (dress). The pictures share one canvas, drawn again only when the look changes, and one mesh; their
// frames are one baked piece. Built in world metres (boss-plan.js), facing the floor or into the office.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOSS, DESK } from './boss-plan.js';
import { canvasTexture, piece, rounded } from './furniture.js';
import { outline } from './fruit.js';
import { dims } from './lights.js';
import { COLOURS, playerLook } from './meeting.js';
import { FRUITS, naturalColor } from './status.js';
import { toonMaterial, withOutline } from './toon.js';

const SIZE = 1024, INK = '#1b1a1f', GILT = '#c9a227', BROWN = '#3a2a08';
// Where each picture is on the canvas, [x, y, width, height] in pixels from its top left, and how big it hangs, [w, h] in metres.
const AREA = {
  portrait: [0, 0, 400, 512, 0.72, 0.92], magazine: [408, 0, 300, 400, 0.42, 0.56], poster: [716, 0, 300, 400, 0.48, 0.64],
  month: [0, 520, 600, 480, 0.9, 0.72], name: [608, 520, 400, 80, 0.36, 0.072], trophy: [608, 608, 240, 80, 0.12, 0.04], plinth: [856, 608, 160, 80, 0.2, 0.1],
};
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const STATUE = 0.42, PLINTH = { x: 0.45, z: 0.35, w: 0.36, h: 0.75 }; // the statue's height; its plinth, in the back-left corner under the portrait, out of the way round the desk
const fruits = new Set(FRUITS);
const bodyOf = (fruit, colour, name) => name ? playerLook(name, fruit, colour).color : naturalColor(fruit, 'boss'); // as friends see you
const start = { fruit: 'apple', colour: COLOURS[0], body: bodyOf('apple', COLOURS[0], '') };

// The biggest font up to `size` that fits `text` in `width`.
const fit = (g, text, width, size, font) => { for (g.font = font(size); size > 8 && g.measureText(text).width > width; size--) g.font = font(size - 1); };

// A fruit `height` px tall standing at (x, foot), drawn as cutouts.js draws its: body, ink line, stem and leaf, and a face, here
// smug (half-lidded, one brow up, a smirk), in a shirt collar and a tie of its colour; a crown instead of the stem if asked.
function drawFruit(g, { fruit, colour, body }, x, foot, height, crown = false) {
  const shape = outline(fruit), xs = shape.map(p => p[0]), ys = shape.map(p => p[1]), low = Math.min(...ys), high = Math.max(...ys);
  const k = height / (high - low), mid = (Math.min(...xs) + Math.max(...xs)) / 2, u = height / 100, at = ([px, py]) => [x + (px - mid) * k, foot - (py - low) * k];
  const trace = () => { g.beginPath(); shape.forEach(p => g.lineTo(...at(p))); g.closePath(); };
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  trace(); g.fillStyle = body; g.fill();
  g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.ellipse(x - 16 * u, foot - 68 * u, 9 * u, 16 * u, -0.4, 0, 7); g.fill(); g.restore();
  trace(); g.lineWidth = 2.4 * u; g.strokeStyle = INK; g.stroke();
  const [tx, ty] = at([mid, high]);
  if (crown) {
    g.save(); g.translate(tx + 2 * u, ty + 2 * u); g.rotate(0.14);
    g.beginPath(); g.moveTo(-13 * u, 0); g.lineTo(-14 * u, -13 * u); g.lineTo(-7 * u, -6 * u); g.lineTo(0, -16 * u); g.lineTo(7 * u, -6 * u); g.lineTo(14 * u, -13 * u); g.lineTo(13 * u, 0); g.closePath();
    g.fillStyle = '#f2c14e'; g.fill(); g.lineWidth = 1.6 * u; g.stroke();
    [[-7, -2.5, '#e63946'], [0, -2.5, '#3a86ff'], [7, -2.5, '#06d6a0']].forEach(([jx, jy, c]) => { g.fillStyle = c; g.beginPath(); g.arc(jx * u, jy * u, 1.7 * u, 0, 7); g.fill(); });
    g.restore();
  } else if (fruit !== 'banana') {
    g.lineWidth = 3 * u; g.strokeStyle = '#6b4a2a'; g.beginPath(); g.moveTo(tx, ty + u); g.lineTo(tx + 3 * u, ty - 6 * u); g.stroke();
    g.fillStyle = '#4f9a4a'; g.beginPath(); g.ellipse(tx + 10 * u, ty - 4 * u, 8 * u, 3.4 * u, -0.35, 0, 7); g.fill(); g.lineWidth = 1.4 * u; g.strokeStyle = INK; g.stroke();
  }
  const fx = fruit === 'banana' ? x + 12 * u : x, fy = foot - 42 * u;
  g.strokeStyle = INK; g.fillStyle = INK;
  for (const side of [-1, 1]) {
    const ex = fx + side * 8.6 * u; g.fillStyle = INK; g.beginPath(); g.ellipse(ex, fy, 3 * u, 4.3 * u, 0, 0, 7); g.fill();
    g.fillStyle = body; g.fillRect(ex - 4 * u, fy - 5 * u, 8 * u, 4.6 * u); // the lids, half down
    g.lineWidth = 1.5 * u; g.beginPath(); g.moveTo(ex - 3.6 * u, fy - 0.4 * u); g.lineTo(ex + 3.6 * u, fy - 0.4 * u); g.stroke();
  }
  g.lineWidth = 1.6 * u; g.beginPath(); g.moveTo(fx - 12 * u, fy - 7 * u); g.lineTo(fx - 5 * u, fy - 6.6 * u); g.stroke(); // one brow level,
  g.beginPath(); g.moveTo(fx + 5 * u, fy - 8 * u); g.quadraticCurveTo(fx + 9 * u, fy - 13 * u, fx + 13 * u, fy - 9.5 * u); g.stroke(); // one up
  g.lineWidth = 2 * u; g.beginPath(); g.moveTo(fx - 6 * u, fy + 8 * u); g.quadraticCurveTo(fx + u, fy + 11 * u, fx + 8 * u, fy + 6 * u); g.lineTo(fx + 9.5 * u, fy + 4.3 * u); g.stroke();
  // The collar, then the tie: its knot, then its blade to a point.
  g.lineWidth = 1.2 * u; g.fillStyle = '#ffffff';
  for (const side of [-1, 1]) { g.beginPath(); g.moveTo(fx + side * 2 * u, fy + 14 * u); g.lineTo(fx + side * 9 * u, fy + 12.5 * u); g.lineTo(fx + side * 4.5 * u, fy + 19 * u); g.closePath(); g.fill(); g.stroke(); }
  g.fillStyle = colour;
  g.beginPath(); g.moveTo(fx - 2.6 * u, fy + 14 * u); g.lineTo(fx + 2.6 * u, fy + 14 * u); g.lineTo(fx + 1.8 * u, fy + 18 * u); g.lineTo(fx - 1.8 * u, fy + 18 * u); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(fx - 1.8 * u, fy + 18 * u); g.lineTo(fx + 1.8 * u, fy + 18 * u); g.lineTo(fx + 3.6 * u, fy + 31 * u); g.lineTo(fx, fy + 35 * u); g.lineTo(fx - 3.6 * u, fy + 31 * u); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// Painted by the boss, of the boss: dark varnish, a red drape, the crown, a little brass title on the frame.
function portrait(g, look, w, h) {
  const bg = g.createRadialGradient(w * 0.55, h * 0.4, 20, w / 2, h / 2, h * 0.65); bg.addColorStop(0, '#6b4a2a'); bg.addColorStop(1, '#1a0f08');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#7a1f2b' : '#5c1520'; g.beginPath(); g.moveTo(i * 20, 0); g.quadraticCurveTo(i * 20 + 34, h / 2, i * 12 + 6, h); g.lineTo(i * 12 + 22, h); g.quadraticCurveTo(i * 20 + 54, h / 2, i * 20 + 20, 0); g.closePath(); g.fill(); }
  g.strokeStyle = '#d9b26a'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, h * 0.42); g.quadraticCurveTo(60, h * 0.5, 104, h * 0.44); g.stroke();
  drawFruit(g, look, w * 0.56, h - 58, 320, true);
  let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647; // brushwork: the same strokes every time
  g.globalAlpha = 0.07; for (let i = 0; i < 260; i++) { g.strokeStyle = rnd() < 0.5 ? '#000000' : '#ffffff'; g.lineWidth = 2 + rnd() * 3; const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16); g.stroke(); }
  g.globalAlpha = 1; g.strokeStyle = BROWN; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = GILT; g.fillRect(w / 2 - 64, h - 36, 128, 22); g.fillStyle = BROWN; g.font = 'bold 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SELF-PORTRAIT', w / 2, h - 25);
}

// The cover of the only magazine that matters, in your colour.
function magazine(g, look, w, h) {
  g.fillStyle = look.colour; g.fillRect(0, 0, w, h);
  const burst = g.createRadialGradient(w * 0.6, h * 0.55, 10, w * 0.6, h * 0.55, w * 0.7); burst.addColorStop(0, 'rgba(255,255,255,0.45)'); burst.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = burst; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#ffffff'; g.strokeStyle = INK; g.lineWidth = 5; g.lineJoin = 'round';
  fit(g, 'BOSS', w - 24, 112, s => `900 ${s}px Georgia, serif`); g.strokeText('BOSS', w / 2, 96); g.fillText('BOSS', w / 2, 96);
  g.fillStyle = INK; g.fillRect(0, 104, w, 20); g.fillStyle = '#ffffff'; g.font = 'bold 14px sans-serif'; g.fillText('MONTHLY', w / 2, 119);
  drawFruit(g, look, w * 0.6, h - 34, 250);
  const shout = (text, x, y, size, colour = '#ffffff', align = 'left') => { g.textAlign = align; g.font = `bold ${size}px sans-serif`; g.lineWidth = 4; g.strokeStyle = INK; g.strokeText(text, x, y); g.fillStyle = colour; g.fillText(text, x, y); };
  shout('HOW I DID IT', 12, 156, 17); shout('ALL MYSELF', 12, 176, 17); shout('MY 5 A.M.', 12, 214, 17, '#ffe14d'); shout('ROUTINE', 12, 234, 17, '#ffe14d');
  g.fillStyle = INK; g.fillRect(0, h - 84, w, 46); g.textAlign = 'center';
  fit(g, 'BOSS OF THE YEAR', w - 20, 34, s => `900 ${s}px "Arial Black", Impact, sans-serif`); g.fillStyle = '#ffe14d'; g.fillText('BOSS OF THE YEAR', w / 2, h - 49);
  g.fillStyle = '#ffffff'; g.fillRect(w - 64, h - 34, 54, 28); g.fillStyle = INK; // a barcode
  for (let i = 0, x = w - 60; x < w - 14; i++) { const bar = 1 + (i * 7 % 3); g.fillRect(x, h - 31, bar, 19); x += bar + 1 + (i * 5 % 2); }
}

// A motivational poster: black, the photo framed in a white line, a word in spaced capitals and a line under it.
function poster(g, look, w, h) {
  g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, w, h);
  const [px, py, pw, ph] = [26, 26, w - 52, 254];
  const sky = g.createLinearGradient(0, py, 0, py + ph); sky.addColorStop(0, '#3a6fc4'); sky.addColorStop(1, '#ffb36b'); g.fillStyle = sky; g.fillRect(px, py, pw, ph);
  g.save(); g.beginPath(); g.rect(px, py, pw, ph); g.clip();
  g.fillStyle = '#5a6478'; g.beginPath(); g.moveTo(px, py + ph); g.lineTo(px + 40, py + 170); g.lineTo(px + 90, py + 210); g.lineTo(w / 2, py + 120); g.lineTo(px + pw - 60, py + 200); g.lineTo(px + pw, py + 160); g.lineTo(px + pw, py + ph); g.fill();
  g.fillStyle = '#f4f6fa'; g.beginPath(); g.moveTo(w / 2 - 34, py + 152); g.lineTo(w / 2, py + 120); g.lineTo(w / 2 + 30, py + 148); g.lineTo(w / 2 + 12, py + 142); g.lineTo(w / 2, py + 154); g.lineTo(w / 2 - 14, py + 144); g.fill();
  g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2 + 26, py + 124); g.lineTo(w / 2 + 26, py + 64); g.stroke();
  g.fillStyle = look.colour; g.beginPath(); g.moveTo(w / 2 + 27, py + 64); g.lineTo(w / 2 + 62, py + 74); g.lineTo(w / 2 + 27, py + 84); g.fill();
  drawFruit(g, look, w / 2, py + 124, 64);
  g.restore(); g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(px - 6, py - 6, pw + 12, ph + 12);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#ffffff'; g.font = '30px Georgia, serif'; g.fillText('L E A D E R S H I P', w / 2, 332);
  g.fillStyle = '#c9ccd3'; g.font = 'italic 14px Georgia, serif'; g.fillText('Nobody else made it up here.', w / 2, 362);
}

// A wooden plaque, its brass header and twelve framed months, every one of them the boss.
function months(g, look, w, h) {
  g.fillStyle = '#5a3a22'; g.fillRect(0, 0, w, h); g.strokeStyle = '#4a2f1b'; g.lineWidth = 2;
  for (let y = 9; y < h; y += 17) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w / 3, y + 6, 2 * w / 3, y - 6, w, y + 3); g.stroke(); }
  g.strokeStyle = GILT; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = GILT; g.fillRect(70, 22, w - 140, 50); g.strokeStyle = BROWN; g.lineWidth = 2; g.strokeRect(74, 26, w - 148, 42);
  g.fillStyle = BROWN; g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, 'EMPLOYEE OF THE MONTH', w - 170, 30, s => `bold ${s}px Georgia, serif`); g.fillText('EMPLOYEE OF THE MONTH', w / 2, 48);
  const cw = (w - 60) / 4, ch = (h - 104) / 3;
  MONTHS.forEach((month, i) => {
    const x = 30 + (i % 4) * cw, y = 88 + Math.floor(i / 4) * ch;
    g.fillStyle = INK; g.fillRect(x + 10, y + 4, cw - 20, ch - 30); g.fillStyle = '#bcd3e6'; g.fillRect(x + 16, y + 10, cw - 32, ch - 42);
    g.save(); g.beginPath(); g.rect(x + 16, y + 10, cw - 32, ch - 42); g.clip(); drawFruit(g, look, x + cw / 2, y + ch - 32, ch - 56); g.restore();
    g.fillStyle = GILT; g.fillRect(x + cw / 2 - 26, y + ch - 24, 52, 18); g.fillStyle = BROWN; g.font = 'bold 13px sans-serif'; g.fillText(month, x + cw / 2, y + ch - 15);
  });
}

// Gold letters on black, and brass with black ones.
const plaque = (text, paper, ink, font) => (g, look, w, h) => {
  g.fillStyle = paper; g.fillRect(0, 0, w, h); g.strokeStyle = ink; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, text, w - 24, h * 0.62, font); g.fillText(text, w / 2, h / 2 + 2);
};
const DRAW = {
  portrait, magazine, poster, month: months,
  name: plaque('THE BOSS', INK, '#e8c45a', s => `bold ${s}px Georgia, serif`), trophy: plaque('#1 BOSS', INK, '#e8c45a', s => `900 ${s}px sans-serif`), plinth: plaque('ME', GILT, BROWN, s => `bold ${s}px Georgia, serif`),
};
function draw(g, W, H, look = start) {
  g.clearRect(0, 0, W, H);
  for (const [key, [x, y, w, h]] of Object.entries(AREA)) { g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); DRAW[key](g, look, w, h); g.restore(); }
}

// A picture's face: a plane its size facing +z, showing its part of the canvas.
function card(key) {
  const [x, y, w, h, mw, mh] = AREA[key], geometry = new THREE.PlaneGeometry(mw, mh), uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / SIZE, 1 - (y + (1 - uv.getY(i)) * h) / SIZE);
  return geometry;
}
// The statue: the fruit's body turned in gold (a banana's cut from its outline, as it isn't round), STATUE tall from its foot.
function statueGeometry(fruit) {
  const shape = outline(fruit), xs = shape.map(p => p[0]), ys = shape.map(p => p[1]), low = Math.min(...ys), k = STATUE / (Math.max(...ys) - low), mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const geometry = fruit === 'banana'
    ? new THREE.ExtrudeGeometry(new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2((x - mid) * k, (y - low) * k))), { depth: 0.07, bevelThickness: 0.02, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -0.035)
    : new THREE.LatheGeometry(shape.slice(0, shape.length / 2).map(([x, y]) => new THREE.Vector2(x * k, (y - low) * k)), 32); // outline's first half is the profile, foot to top
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}

// `top`: the desk top's height. Returns the group to add, the canvas (`texture`), the statue's mesh, what blocks walking (the
// plinth), and dress(fruit, colour, name): the look, from the meeting's roster or what's saved, every frame; `name` makes the
// body the colour friends see you in.
export function createVanity({ top }) {
  const group = new THREE.Group(), texture = canvasTexture(SIZE, SIZE, draw);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const place = (x, y, z, yaw = 0) => m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, yaw), new THREE.Vector3(1, 1, 1)).clone();
  // Where each hangs or stands, facing +z before it's turned: on the windows wall left of its window (above the statue, clear
  // of its head), along the left wall, on the desk facing the floor, on the plinth's front.
  const LEFT = Math.PI / 2, deskTop = (x, z) => place(DESK.x + x, top, DESK.z + z);
  const at = {
    portrait: place(0.52, 1.8, 0), magazine: place(0, 1.55, 1.0, LEFT), month: place(0, 1.55, 2.05, LEFT), poster: place(0, 1.68, 3.15, LEFT),
    name: deskTop(-0.48, 0.36), trophy: deskTop(0.62, 0.2), plinth: place(PLINTH.x, 0, PLINTH.z),
  };
  const tilt = new THREE.Matrix4().makeRotationX(-0.3), up = (y, z = 0) => new THREE.Matrix4().makeTranslation(0, y, z);
  const faces = {
    portrait: up(0, 0.061), magazine: up(0, 0.027), poster: up(0, 0.027), month: up(0, 0.031),
    name: up(0.064).multiply(tilt).multiply(up(0, 0.0075)), trophy: up(0.03, 0.0555), plinth: up(PLINTH.h - 0.2, PLINTH.w / 2 + 0.002),
  };
  const lathe = (points, n = 20) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), n);
  const cup = lathe([[0, 0.05], [0.05, 0.07], [0.064, 0.13], [0.07, 0.13], [0.068, 0.11], [0.055, 0.06], [0.03, 0.02], [0.012, 0]]).translate(0, 0.167, 0);
  const handle = side => new THREE.TorusGeometry(0.032, 0.007, 6, 12, Math.PI).rotateZ(-side * Math.PI / 2).translate(side * 0.066, 0.24, 0);
  const B = (w, h, d, x, y, z, r = 0.006) => rounded(w, h, d, r).translate(x, y, z);
  const frames = {
    portrait: [[B(0.86, 1.06, 0.06, 0, 0, 0.03, 0.02), GILT], [B(0.9, 1.1, 0.03, 0, 0, 0.015, 0.01), '#8a6d12'], // and its picture light
      [B(0.03, 0.03, 0.16, 0, 0.57, 0.08), '#b8912a'], [new THREE.CylinderGeometry(0.035, 0.035, 0.44, 12).rotateZ(Math.PI / 2).translate(0, 0.6, 0.17), '#b8912a']],
    magazine: [[B(0.48, 0.62, 0.025, 0, 0, 0.0125), INK]], poster: [[B(0.54, 0.7, 0.025, 0, 0, 0.0125), '#9aa1ab']], month: [[B(0.94, 0.76, 0.03, 0, 0, 0.015, 0.01), '#4a2f1b']],
    name: [[B(0.42, 0.014, 0.08, 0, 0.007, 0), INK], [rounded(0.4, 0.1, 0.014, 0.004).applyMatrix4(tilt).translate(0, 0.064, 0), INK]],
    trophy: [[B(0.15, 0.06, 0.11, 0, 0.03, 0), INK], [B(0.11, 0.035, 0.08, 0, 0.0775, 0), INK], [new THREE.CylinderGeometry(0.03, 0.035, 0.012, 16).translate(0, 0.101, 0), '#e0b23a'],
      [new THREE.CylinderGeometry(0.01, 0.012, 0.06, 10).translate(0, 0.137, 0), '#e0b23a'], [cup, '#e0b23a'], [handle(1), '#e0b23a'], [handle(-1), '#e0b23a']],
    plinth: [[B(0.4, 0.06, 0.4, 0, 0.03, 0), '#2f3542'], [B(PLINTH.w, PLINTH.h - 0.1, PLINTH.w, 0, PLINTH.h / 2, 0), '#22252c'], [B(0.4, 0.05, 0.4, 0, PLINTH.h - 0.025, 0), '#2f3542']],
  };
  group.add(piece('bossVanity', () => Object.entries(frames).flatMap(([key, parts]) => parts.map(([geometry, colour]) => [geometry.applyMatrix4(at[key]), colour])), 0.006));
  const cards = new THREE.Mesh(mergeGeometries(Object.keys(AREA).map(key => card(key).applyMatrix4(faces[key]).applyMatrix4(at[key]))), dims(new THREE.MeshBasicMaterial({ map: texture })));
  group.add(cards);

  const statues = new Map(), sculpt = fruit => { if (!statues.has(fruit)) statues.set(fruit, statueGeometry(fruit)); return statues.get(fruit); };
  const statue = new THREE.Mesh(sculpt(start.fruit), toonMaterial('#d9a92e'));
  statue.position.set(PLINTH.x, PLINTH.h, PLINTH.z); group.add(withOutline(statue, 0.006));
  const plinth = new THREE.Box3(new THREE.Vector3(PLINTH.x - 0.2, 0, PLINTH.z - 0.2), new THREE.Vector3(PLINTH.x + 0.2, PLINTH.h + STATUE, PLINTH.z + 0.2));

  let worn = `${start.fruit}|${start.colour}|`;
  return {
    group, texture, statue, colliders: [plinth],
    dress(fruit, colour, name) {
      if (!fruits.has(fruit)) fruit = start.fruit;
      if (typeof colour !== 'string') colour = start.colour;
      if (typeof name !== 'string') name = '';
      const key = `${fruit}|${colour}|${name}`; if (key === worn) return;
      const was = worn.split('|')[0]; worn = key;
      texture.redraw({ fruit, colour, body: bodyOf(fruit, colour, name) });
      if (fruit !== was) { statue.clear(); statue.geometry = sculpt(fruit); withOutline(statue, 0.006); }
    },
  };
}
