// The office itself: floor, walls, ceiling and lights, door, windows, desks with chairs and computers, project signs,
// the wall boards and the dressing around the edges (coffee corner, lounge, plants, shelves, pictures).
// Coordinates come straight from layout.js: the room spans x 0..width, z 0..depth, the door is on the front wall (z = depth).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial, withOutline } from './toon.js';
import { createLights, dims } from './lights.js';
import { createSlacking } from './slack.js';
import { createWindows } from './windows.js';
import { createScreens, SCREEN_W, SCREEN_H } from './screens.js';
import { DESK_W, DESK_D } from './layout.js';
import {
  WALL_H, WALL_T, shared, once, rounded, mesh, canvasTexture, paint, painted, piece, deskItem, coffeeCup, plant, picture, sofa, armchair, lowTable, floorLamp, rug,
  counter, coffeeMachine, mugShelf, waterCooler, bookshelf, printer, filingCabinet, coatRack, extinguisher, glowTexture, floorShadow,
} from './furniture.js';

export { WALL_H };
export const DESK_H = 0.76, SEAT_H = 0.47, HELPER_SCALE = 0.42;
// In a desk's frame: the chair sits back from the desk edge so the sitter's body clears it; hands reach the keyboard.
export const CHAIR_Z = -(DESK_D / 2 + 0.42), KEYS_Z = -0.27, MOUSE_X = -0.33;
export const BACK_Z = -0.34; // front of the chair back, from the chair's centre
const MONITOR_Z = DESK_D * 0.28;
// A screen's light, in its desk's frame: from the face of the screen (any further out lights the monitor like a desk lamp),
// level with it toward the sitter.
const BEAM = { from: new THREE.Vector3(0, DESK_H + 0.34, MONITOR_Z - 0.04), to: new THREE.Vector3(0, DESK_H + 0.22, CHAIR_Z) };
// Each pod's colours: its rug, and its chairs in a stronger shade.
const teams = [['#f4a6a6', '#e0675c'], ['#a6d8f4', '#3d8fd1'], ['#b9e4a1', '#4fa84a'], ['#f6d28b', '#e8a23a'], ['#cdb4f2', '#8a63d2'], ['#f7b8de', '#d9559c']];
// Helpers' tiny desks in the parent desk's frame: either side of its chair, then behind it.
const HELPER_SPOTS = [[0.56, -0.66], [-0.56, -0.66], [-0.6, -1.42]];
const CUP_SPOTS = [[0.5, -0.34], [0.62, -0.3], [0.56, -0.2], [0.68, -0.19], [0.5, -0.1], [0.63, -0.09]];
const ITEM_SPOTS = [[-0.6, 0.22], [-0.42, 0.3], [-0.62, -0.06]]; // the front-left corner stays free, and the back left for a second monitor
const leds = { green: '#5ee08a', amber: '#ffb23e', dark: '#4d6fa8', red: '#ff6b6b', off: '#2a2d35' };

const B = (w, h, d, x, y, z, r = 0.01) => (r ? rounded(w, h, d, r) : new THREE.BoxGeometry(w, h, d)).translate(x, y, z);
const C = (top, bottom, h, x, y, z, n = 14) => new THREE.CylinderGeometry(top, bottom, h, n).translate(x, y, z);
const deskParts = width => [
  [B(width * 0.94, 0.07, DESK_D * 0.92, 0, DESK_H - 0.035, 0, 0.03), '#f3f1ec'],
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => [C(0.035, 0.03, DESK_H - 0.07, x * width * 0.42, (DESK_H - 0.07) / 2, z * DESK_D * 0.36, 10), '#3a3d46']),
  [B(width * 0.8, 0.34, 0.02, 0, DESK_H - 0.24, DESK_D * 0.36, 0.006), '#d5dae1'],
];
// Chunky bezel with a bump on the back; the screen is a separate plane.
const monitorParts = () => [
  [B(0.62, 0.4, 0.06, 0, DESK_H + 0.34, MONITOR_Z, 0.03), '#3a3d46'], [B(0.34, 0.22, 0.06, 0, DESK_H + 0.32, MONITOR_Z + 0.05, 0.025), '#3a3d46'],
  [C(0.03, 0.03, 0.14, 0, DESK_H + 0.09, MONITOR_Z + 0.02, 8), '#3a3d46'], [C(0.12, 0.13, 0.025, 0, DESK_H + 0.012, MONITOR_Z, 20), '#3a3d46'],
];
// A second, smaller monitor for a session with screenshots to show: back left, turned to face the chair. Merged into the
// first, so it costs no draws; its glass starts past the first's bezel (x > SIDE.edge).
const SIDE = { x: 0.53, z: 0.16, y: DESK_H + 0.3, turn: Math.atan2(0.53, 0.16 - CHAIR_Z), edge: 0.315 };
const sideMonitorParts = () => [
  [B(0.465, 0.3, 0.045, 0, SIDE.y, 0, 0.022), '#3a3d46'], [B(0.26, 0.16, 0.045, 0, SIDE.y - 0.015, 0.035, 0.018), '#3a3d46'],
  [C(0.024, 0.024, 0.16, 0, DESK_H + 0.08, 0.02, 8), '#3a3d46'], [C(0.09, 0.1, 0.02, 0, DESK_H + 0.01, 0, 20), '#3a3d46'],
].map(([geometry, c]) => [geometry.rotateY(SIDE.turn).translate(SIDE.x, 0, SIDE.z), c]);
const keyboardParts = () => [
  [B(0.42, 0.025, 0.14, 0, DESK_H + 0.0125, KEYS_Z, 0.012), '#e9e6df'], ...[-0.04, 0, 0.04].map(z => [B(0.38, 0.008, 0.028, 0, DESK_H + 0.026, KEYS_Z + z, 0.003), '#cfc9bd']),
  [B(0.2, 0.006, 0.18, MOUSE_X, DESK_H + 0.003, KEYS_Z, 0.003), '#3d5a80'], [new THREE.SphereGeometry(0.03, 12, 8).scale(0.8, 0.5, 1.25).translate(MOUSE_X, DESK_H + 0.016, KEYS_Z), '#e9e6df'],
];
const TOWER = [-0.5, 0.06]; // on the floor under the desk, leaving the top free
const BIN = [0.46, -0.22]; // under the desk on the sitter's left, by the front edge
// A waste bin with paper poking out of it (~600 vertices).
const binParts = color => [
  [C(0.12, 0.1, 0.3, 0, 0.15, 0, 16), color], [C(0.127, 0.127, 0.02, 0, 0.292, 0, 16), color], [new THREE.CircleGeometry(0.11, 16).rotateX(-Math.PI / 2).translate(0, 0.3035, 0), '#2a2d35'],
  ...[[0.03, 0.02, 0.04], [-0.04, 0.01, 0.034], [0, -0.05, 0.036]].map(([x, z, r], i) => [new THREE.IcosahedronGeometry(r, 0).rotateY(i).translate(x, 0.3 + r * 0.4, z), '#f4f1ea']),
];
// Post-its facing +z, [x, y, tilt, colour, z]: the paper and two scribbled lines as flat quads, 18 vertices. No outline shows, as on the rugs:
// a flat quad's hull faces away and only shows from behind, so put notes where their backs are hidden.
const NOTE = { yellow: '#ffe066', pink: '#ff9fb2', blue: '#8fd3ff', green: '#b9f18c' };
const noteParts = notes => notes.flatMap(([x, y, tilt, color, z = 0]) => [
  [new THREE.PlaneGeometry(0.075, 0.075).translate(0, 0, 0.0015), color], [new THREE.PlaneGeometry(0.05, 0.005).translate(0, 0.012, 0.0025), '#3a4352'], [new THREE.PlaneGeometry(0.036, 0.005).translate(-0.007, -0.008, 0.0025), '#3a4352'],
].map(([geometry, c]) => [geometry.rotateZ(tilt).translate(x, y, z), c]));
// Stuck to the bezel, the first identity().notes of them, facing the sitter; inside its edges so the one opposite can't see their backs.
const MONITOR_NOTES = [[0.255, 0.1, 0.12, NOTE.yellow], [-0.255, -0.09, -0.1, NOTE.pink], [0.14, 0.15, 0.08, NOTE.green]];
const monitorNoteParts = n => noteParts(MONITOR_NOTES.slice(0, n)).map(([geometry, c]) => [geometry.rotateY(Math.PI).translate(0, DESK_H + 0.34, MONITOR_Z - 0.0345), c]);
const towerParts = () => [
  [B(0.18, 0.42, 0.4, 0, 0.21, 0, 0.02), '#2f3542'], [B(0.12, 0.014, 0.01, 0, 0.33, -0.2, 0.003), '#8a8f99'], [B(0.12, 0.014, 0.01, 0, 0.3, -0.2, 0.003), '#8a8f99'],
  ...[0.08, 0.11, 0.14].map(y => [B(0.1, 0.006, 0.006, 0, y, -0.2, 0), '#4a5160']), [C(0.018, 0.018, 0.012, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 0.24, -0.2), '#8a8f99'],
];
// Whose agent sits there, as in the list: Claude's ✳ or Codex's ⌘ on a cream disc, flat and facing +z.
const P = (w, h, x, y, a = 0) => new THREE.PlaneGeometry(w, h).rotateZ(a).translate(x, y, 0.002);
const markParts = provider => {
  const strokes = provider === 'codex'
    ? [...[-1, 1].flatMap(s => [P(0.08, 0.008, 0, s * 0.02), P(0.008, 0.08, s * 0.02, 0)]), ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => new THREE.RingGeometry(0.011, 0.019, 20).translate(x * 0.035, y * 0.035, 0.002))]
    : [0, 1, 2, 3].map(i => P(0.1, 0.014, 0, 0, i * Math.PI / 4));
  return [[new THREE.CircleGeometry(0.075, 24), '#fffaf0'], ...strokes.map(geometry => [geometry, provider === 'codex' ? '#1d2330' : '#d97757'])];
};
// Office chair: padded seat and back on a gas post, five-star base on casters, the agent's mark on the back. Its origin is on
// the floor under the seat.
const chairParts = (seat, provider) => {
  const dark = '#3a3d46', parts = [
    [C(0.055, 0.06, 0.06, 0, 0.08, 0), dark], [C(0.024, 0.024, SEAT_H - 0.18, 0, 0.1 + (SEAT_H - 0.18) / 2, 0, 10), '#8a8f99'], [B(0.22, 0.04, 0.22, 0, SEAT_H - 0.11, 0, 0.01), dark],
    [B(0.52, 0.09, 0.48, 0, SEAT_H - 0.045, 0, 0.04), seat], [B(0.07, 0.03, 0.16, 0, SEAT_H - 0.1, -0.26, 0.008), dark], [B(0.07, 0.4, 0.03, 0, SEAT_H + 0.08, -0.34, 0.008), dark],
    [rounded(0.46, 0.48, 0.08, 0.04).rotateX(-0.15).translate(0, SEAT_H + 0.38, BACK_Z - 0.04), seat],
    ...provider ? markParts(provider).map(([geometry, c]) => [geometry.rotateY(Math.PI).translate(0, 0.07, -0.041).rotateX(-0.15).translate(0, SEAT_H + 0.38, BACK_Z - 0.04), c]) : [],
  ];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + Math.PI;
    parts.push([B(0.05, 0.035, 0.26, 0, 0.075, 0.13, 0.012).rotateY(a), dark], [new THREE.SphereGeometry(0.032, 10, 8).translate(0, 0.032, 0.27).rotateY(a), '#1b1a1f']);
  }
  return parts;
};

// Plan mode's clipboard, flat on the desk left of the keyboard, clip away from the sitter: a ticked list on the paper.
const clipboard = () => {
  const item = piece('clipboard', () => [
    [B(0.17, 0.008, 0.23, 0, 0.004, 0, 0.004), '#b5835a'], [B(0.15, 0.002, 0.19, 0, 0.009, -0.012, 0), '#ffffff'], [B(0.07, 0.014, 0.03, 0, 0.013, 0.1, 0.005), '#9aa1ab'],
    ...[0, 1, 2, 3].flatMap(i => [[B(0.016, 0.001, 0.016, -0.05, 0.0105, 0.055 - i * 0.04, 0), i < 2 ? '#4fa84a' : '#c9cfdb'], [B(0.08, 0.001, 0.006, 0.01, 0.0105, 0.055 - i * 0.04, 0), '#3a4352']]),
  ], 0.005);
  item.position.set(0.24, DESK_H, -0.03); item.rotation.y = 0.25;
  return item;
};

// The desk, its tower, its bin and its chair in one shared geometry; userData.solids are the desk and the chair as boxes in the
// desk's frame (what blocks walking and throws). What's on the desk stays apart, to be picked up.
function deskGeometry(width, color, helper, provider) {
  const at = (parts, x, z) => parts.map(([geometry, c]) => [geometry.translate(x, 0, z), c]);
  const top = paint(deskParts(width)), chair = paint(at(chairParts(color, provider), 0, CHAIR_Z)), parts = [top, chair];
  if (!helper) parts.push(paint(at(towerParts(), ...TOWER)), paint(at(binParts('#8a8f99'), ...BIN)));
  const geometry = mergeGeometries(parts);
  geometry.userData.solids = [top, chair].map(g => (g.computeBoundingBox(), g.boundingBox));
  return geometry;
}

// One desk in its own frame: the sitter faces +z from the chair at -z; the monitor is at the far (+z) edge facing them.
// A helper's desk is the same, narrower and bare, unmarked, and scaled down. `notes` post-its are stuck to the monitor.
const monitorPiece = (notes, pair) => piece(`monitor${notes}${pair ? 'pair' : ''}`, () => [...monitorParts(), ...monitorNoteParts(notes), ...(pair ? sideMonitorParts() : [])]);
function createDesk(color, width = DESK_W, helper = false, notes = 0, provider = '') {
  const group = new THREE.Group(), key = `desk${width}${color}${helper ? 'helper' : provider}`;
  const geometry = once(key, () => deskGeometry(width, color, helper, !helper && provider)), monitor = monitorPiece(notes, false);
  group.add(mesh(geometry, painted(), 0.008), monitor, piece('keyboard', keyboardParts, 0.005));
  // The screen is a tiny terminal of the session's latest lines; room.sync redraws it when they change, and screens.js shows
  // it where `screen` is. That's the monitor's (which sits at the desk's origin), as is where a second one's glass would be.
  const screenTexture = canvasTexture(SCREEN_W, SCREEN_H, drawScreen);
  const screen = new THREE.Object3D(); screen.position.set(0, DESK_H + 0.34, MONITOR_Z - 0.032); screen.rotation.y = Math.PI; screen.userData.glass = 'main'; monitor.add(screen);
  const side = new THREE.Object3D(); side.position.set(0, SIDE.y, -0.0245).applyAxisAngle(new THREE.Vector3(0, 1, 0), SIDE.turn).add(new THREE.Vector3(SIDE.x, 0, SIDE.z));
  side.rotation.y = Math.PI + SIDE.turn; side.userData.glass = 'side'; monitor.add(side);
  const chair = new THREE.Object3D(); chair.position.z = CHAIR_Z; group.add(chair); // where the sitter sits
  // The desk's and the chair's shadows in one, in the desk's frame; room.sync draws every desk's in one mesh.
  const plane = floorShadow(1, 1).geometry;
  const shadow = once(`deskShadow${width}`, () => mergeGeometries([plane.clone().scale(width, 1, DESK_D * 1.05), plane.clone().scale(0.72, 1, 0.72).translate(0, 0, CHAIR_Z)]));
  const desk = { group, screen, screenTexture, chair, color, monitor, notes, shadow, solids: geometry.userData.solids };
  if (helper) return desk;
  desk.led = new THREE.Mesh(once('led', () => new THREE.SphereGeometry(0.012, 8, 6)), new THREE.MeshBasicMaterial({ color: leds.off })); desk.led.position.set(TOWER[0], 0.39, TOWER[1] - 0.205); group.add(desk.led);
  desk.cups = new THREE.Group(); desk.cups.position.y = DESK_H; group.add(desk.cups);
  desk.clipboard = clipboard(); desk.clipboard.visible = false; group.add(desk.clipboard);
  desk.slack = { show: null, wary: false, busted: 0, calm: 0 }; // slack.js: something silly on the screen now and then
  desk.helpers = [];
  return desk;
}

const tints = { green: ['#0f2a1a', '#5ee08a'], amber: ['#2e2108', '#ffb23e'], dark: ['#151821', '#7d8699'], red: ['#2e0f0f', '#ff6b6b'], off: ['#0d0e12', '#3a3f4b'] };
// Drawn at 432×256 and scaled to the canvas, so helpers' smaller screens show the same thing.
function drawScreen(g, w, h, monitor = null, tone = 'off') {
  const [background, accent] = tints[tone] || tints.off;
  g.setTransform(w / 432, 0, 0, h / 256, 0, 0); w = 432; h = 256;
  g.fillStyle = background; g.fillRect(0, 0, w, h);
  if (!monitor) return;
  g.fillStyle = accent; g.fillRect(0, 0, w, 34);
  // The plan as a row of boxes before the title (the post-its cover the bar's right end): filled when done, a dot in the one
  // under way.
  const steps = monitor.plan || [], box = Math.min(14, (150 - 4 * steps.length) / steps.length), list = steps.length && steps.length * (box + 4) + 6;
  g.fillStyle = g.strokeStyle = background;
  steps.forEach((step, i) => {
    const x = 10 + i * (box + 4), y = 17 - box / 2;
    if (step === 'done') g.fillRect(x, y, box, box);
    else { g.lineWidth = 2; g.strokeRect(x + 1, y + 1, box - 2, box - 2); if (step === 'active') g.fillRect(x + box / 4, y + box / 4, box / 2, box / 2); }
  });
  g.font = 'bold 20px ui-monospace, monospace'; g.textBaseline = 'middle';
  g.fillText(clip(g, monitor.title, w - 20 - list), 10 + list, 18);
  g.font = '17px ui-monospace, monospace'; g.textBaseline = 'top';
  monitor.lines.forEach(({ text, kind }, i) => {
    g.fillStyle = kind === 'user' ? '#ffffff' : kind === 'tool' ? accent : '#c9cfdb';
    g.fillText(clip(g, `${kind === 'user' ? '› ' : kind === 'tool' ? '• ' : '  '}${text}`, w - 20), 10, 46 + i * 34);
  });
}
// The second monitor: the newest screenshot, fitted in, and how many there are.
function drawShot(g, w, h, shot = null) {
  g.fillStyle = '#0d0e12'; g.fillRect(0, 0, w, h);
  if (!shot) return;
  const { bitmap, count } = shot, k = Math.min(w / bitmap.width, h / bitmap.height), dw = bitmap.width * k, dh = bitmap.height * k;
  g.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  if (count < 2) return;
  g.font = 'bold 20px system-ui, sans-serif'; const label = String(count), pill = g.measureText(label).width + 16;
  g.fillStyle = '#1b1a1fd9'; g.beginPath(); g.roundRect(w - pill - 8, h - 34, pill, 26, 13); g.fill();
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w - 8 - pill / 2, h - 20);
}
const clip = (g, text, max) => { let t = String(text); while (t.length > 1 && g.measureText(t).width > max) t = t.slice(0, -2) + '…'; return t; };

function signTexture(name) {
  return canvasTexture(512, 128, (g, w, h, waiting = false) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = waiting ? '#ffb23e' : '#2f3542'; g.beginPath(); g.roundRect(0, 0, w, h, 28); g.fill();
    g.fillStyle = '#fffaf0'; g.beginPath(); g.roundRect(10, 10, w - 20, h - 20, 20); g.fill();
    g.fillStyle = '#2f3542'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // Shrink to fit first; only very long names get cut.
    let size = 60, text = name; g.font = `bold ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > w - 60 && size > 36) g.font = `bold ${size -= 2}px system-ui, sans-serif`;
    while (g.measureText(text).width > w - 60 && text.length > 3) text = text.slice(0, -2) + '…';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

// A sign that can hire wears a blue + badge on its corner, lit from inside like the sign's face, so both stay bright with the
// lights off. Shared by every sign; its rim samples the plain blue in the texture's corner, so it's one draw.
let badgeLook;
const badgeMaterial = () => badgeLook ??= new THREE.MeshBasicMaterial({ userData: { shared: true },
  map: canvasTexture(64, 64, (g, w) => { g.fillStyle = '#2f7cf6'; g.fillRect(0, 0, w, w); g.fillStyle = '#ffffff'; g.fillRect(w * 0.44, w * 0.22, w * 0.12, w * 0.56); g.fillRect(w * 0.22, w * 0.44, w * 0.56, w * 0.12); }) });
const badgeGeometry = () => { const g = new THREE.CylinderGeometry(0.12, 0.12, 0.07, 24); for (let i = 0; i < 50; i++) g.attributes.uv.setXY(i, 0.05, 0.05); g.clearGroups(); return g.rotateX(Math.PI / 2); };
// The board's edges in one group and its two faces in another (a box's groups run +x, -x, +y, -y, +z, -z).
const boardGeometry = () => { const g = rounded(1.6, 0.4, 0.05, 0.03), [, , , , front, back] = g.groups; g.clearGroups(); g.addGroup(0, front.start, 0); g.addGroup(front.start, front.count + back.count, 1); return g; };

export function createRoom(scene, renderer) {
  const root = new THREE.Group(); scene.add(root);
  // Every screen, on shared textures (screens.js); `shots`: each session's newest screenshot, for its second monitor.
  const screens = createScreens(root, renderer), shots = new Map();
  const shell = new THREE.Group(); root.add(shell);
  // Fill, daylight and the screens' glow (lights.js); the ceiling lamps (point lights, in the shell) do the rest.
  const lights = createLights(root, BEAM);
  // Back to the terminal: redrawn from the latest status even if it hasn't changed.
  const slacking = createSlacking(desk => { desk.screenKey = null; redraw(desk, desk.status); });
  const desks = new Map(), signs = new Map(), podColors = new Map(); // pod key → index into teams, kept as pods come and go
  const deskShadows = floorShadow(1, 1, 0.3); deskShadows.geometry = new THREE.BufferGeometry(); root.add(deskShadows);
  const room = {
    colliders: [], furnitureColliders: [], fadeables: { ceiling: null, walls: [] }, boards: {},
    deskAnchor(id) {
      const desk = desks.get(id); if (!desk) return null;
      desk.group.updateMatrixWorld();
      return {
        seat: desk.chair.getWorldPosition(new THREE.Vector3()).setY(SEAT_H),
        facing: desk.group.rotation.y,
        monitor: desk.screen.getWorldPosition(new THREE.Vector3()),
        slack: desk.slack,
        top: new THREE.Vector3(0, DESK_H, 0).applyMatrix4(desk.group.matrixWorld),
        helpers: desk.helpers.map(helper => ({ seat: helper.chair.getWorldPosition(new THREE.Vector3()).setY(0), facing: desk.group.rotation.y, top: new THREE.Vector3(0, DESK_H, 0).applyMatrix4(helper.group.matrixWorld) })),
      };
    },
    sync(layout, statuses) {
      if (room.size !== `${layout.room.width}x${layout.room.depth}`) buildShell(layout);
      const solid = [];
      for (const pod of layout.pods) if (!podColors.has(pod.key)) podColors.set(pod.key, podColors.size % teams.length);
      for (const [id, place] of layout.desks) {
        let desk = desks.get(id);
        if (!desk) {
          desk = createDesk(teams[podColors.get(place.podKey)][1], DESK_W, false, statuses.get(id)?.identity?.notes, statuses.get(id)?.provider); addItems(desk, statuses.get(id)?.identity?.props || []); desks.set(id, desk); root.add(desk.group);
          desk.glass = screens.add(desk.screen, desk.screenTexture, 0.54, 0.32); showShot(desk, shots.get(id));
        }
        desk.group.position.set(place.x, 0, place.z); desk.group.rotation.y = place.rotation; desk.monitor.userData.monitor = id;
        const status = statuses.get(id);
        redraw(desk, status);
        if (desk.led.material.userData.tone !== status?.screen) { desk.led.material.userData.tone = status?.screen; desk.led.material.color.set(leds[status?.screen] || leds.off); }
        setCups(desk, status?.cups || 0); desk.clipboard.visible = status?.mode === 'plan';
        // One tiny desk per helper on show.
        while (desk.helpers.length > place.subagents.length) removeDesk(desk.helpers.pop());
        place.subagents.forEach((kid, i) => {
          let helper = desk.helpers[i];
          if (!helper) { helper = desk.helpers[i] = createDesk(desk.color, 1, true); helper.group.scale.setScalar(HELPER_SCALE); helper.group.position.set(HELPER_SPOTS[i][0], 0, HELPER_SPOTS[i][1]); desk.group.add(helper.group); helper.glass = screens.add(helper.screen, helper.screenTexture, 0.54, 0.32); }
          helper.monitor.userData.monitor = kid; redraw(helper, statuses.get(kid));
        });
        desk.group.updateMatrixWorld(true);
        // The desk, its monitor (inside the desk's footprint, so only thrown things notice it), the chair and any helpers' desks,
        // each with whose it is (props.js: they mind coffee on their desk).
        const [top, seat] = desk.solids.map(box => box.clone().applyMatrix4(desk.group.matrixWorld));
        for (const [box, owner] of [[top, id], [new THREE.Box3().setFromObject(desk.monitor), id], [seat, id], ...desk.helpers.map((helper, i) => [new THREE.Box3().setFromObject(helper.group), place.subagents[i]])]) solid.push(Object.assign(box, { owner }));
      }
      for (const [id, desk] of desks) if (!layout.desks.has(id)) { removeDesk(desk); desks.delete(id); }
      screens.moved();
      // Every desk's shadow in one mesh, rebuilt when one moves, comes or goes.
      const all = [...desks.values()].flatMap(desk => [desk, ...desk.helpers]), toRoot = root.matrixWorld.clone().invert();
      const at = all.map(desk => toRoot.clone().multiply(desk.group.matrixWorld)), key = at.map(m => m.elements.map(v => v.toFixed(3)).join()).join(';');
      if (deskShadows.userData.key !== key) {
        deskShadows.userData.key = key; deskShadows.geometry.dispose();
        deskShadows.geometry = all.length ? mergeGeometries(all.map((desk, i) => desk.shadow.clone().applyMatrix4(at[i]))) : new THREE.BufferGeometry();
      }
      const podKeys = new Set();
      for (const pod of layout.pods) {
        podKeys.add(pod.key);
        let sign = signs.get(pod.key);
        if (!sign) { sign = createSign(pod); signs.set(pod.key, sign); root.add(sign.group); }
        sign.group.position.set(pod.x, 0, pod.z);
        sign.rug.scale.set(pod.width + 0.6, 1, pod.depth + 0.4);
        sign.board.userData.hire = pod.cwd ? { cwd: pod.cwd, name: pod.name } : null; // clicking it starts another agent in the pod's folder
        sign.badge.visible = !!pod.cwd;
        const waiting = pod.deskIds.some(id => statuses.get(id)?.bubble?.highlight);
        if (sign.waiting !== waiting) { sign.waiting = waiting; sign.texture.redraw(waiting); }
      }
      for (const [key, sign] of signs) if (!podKeys.has(key)) { disposeTree(sign.group); signs.delete(key); }
      room.colliders = [...room.wallColliders, ...room.furnitureColliders, ...solid];
      lights.refresh();
    },
    // A session's newest screenshot ({ bitmap, count }) for its second monitor, or null for none (and no second monitor).
    setShot(id, shot) { if (shot) shots.set(id, shot); else shots.delete(id); const desk = desks.get(id); if (desk) showShot(desk, shot); },
    // Which of a monitor's screens a point on it is nearest: its glass (where it is), and whether it's the second one's.
    glass(monitor, point) {
      const side = !!point && monitor.children.some(child => child.userData.glass === 'side') && !!desks.get(monitor.userData.monitor)?.side && monitor.worldToLocal(point.clone()).x > SIDE.edge;
      return { anchor: monitor.children.find(child => child.userData.glass === (side ? 'side' : 'main')), side };
    },
    // Each frame: the light switch, the screens' light on the desks nearest the camera, anyone slacking off, then the screens
    // drawn on since the last frame.
    update(dt, eye, still) { const all = [...desks.values()]; lights.update(dt, eye, still, all); slacking.update(dt, eye, still, all); screens.flush(); },
    dispose() { disposeTree(root); },
  };

  const redraw = (desk, status) => {
    desk.glow = status?.screen; desk.status = status;
    if (desk.slack?.show) return; // slack.js has the screen
    const key = JSON.stringify([status?.screen, status?.monitor]);
    if (desk.screenKey !== key) { desk.screenKey = key; desk.screenTexture.redraw(status?.monitor, status?.screen); }
  };
  // Two monitors while there are screenshots to show, else one: the monitor is swapped for the other piece, glass and all.
  function showShot(desk, shot = null) {
    if (!!shot !== !!desk.side) {
      const old = desk.monitor, next = monitorPiece(desk.notes, !!shot);
      next.userData = old.userData;
      for (const child of [...old.children]) if (!child.userData.outline) next.add(child);
      old.removeFromParent(); desk.group.add(next); desk.monitor = next;
      if (shot) { const texture = canvasTexture(SCREEN_W, SCREEN_H, drawShot); desk.side = { texture, glass: screens.add(next.children.find(child => child.userData.glass === 'side'), texture, 0.405, 0.24), shot: null }; }
      else { screens.remove(desk.side.glass); desk.side.texture.dispose(); desk.side = null; }
      screens.moved();
    }
    if (shot && desk.side.shot !== shot) { desk.side.shot = shot; desk.side.texture.redraw(shot); }
  }
  function addItems(desk, props) {
    props.forEach((prop, i) => { const item = deskItem(prop); item.position.set(ITEM_SPOTS[i][0], DESK_H, ITEM_SPOTS[i][1]); item.rotation.y = (i - 0.5) * 0.5; desk.group.add(item); });
  }
  // Takeaway cups pile up at the front right while a turn drags on.
  function setCups(desk, count) {
    const cups = desk.cups.children;
    while (cups.length > count) cups.at(-1).removeFromParent();
    while (cups.length < count) { const cup = coffeeCup(), [x, z] = CUP_SPOTS[cups.length]; cup.position.set(x, 0, z); cup.rotation.y = cups.length * 2.1; desk.cups.add(cup); }
  }

  function createSign(pod) {
    const group = new THREE.Group(), texture = signTexture(pod.name), y = 2.35;
    const board = new THREE.Mesh(once('sign', boardGeometry), [toonMaterial('#2f3542'), new THREE.MeshBasicMaterial({ map: texture })]);
    board.position.y = y; group.add(board);
    // The badge is a child of the board, so it tilts with it in the overview; a coin, thick enough to show on both faces.
    const badge = new THREE.Mesh(once('signBadge', badgeGeometry), badgeMaterial()); badge.position.set(0.8, 0.2, 0); board.add(badge);
    const cords = new THREE.Mesh(once('cords', () => mergeGeometries([-0.6, 0.6].map(x => new THREE.CylinderGeometry(0.008, 0.008, WALL_H - y - 0.2, 6).translate(x, 0, 0)))), toonMaterial('#2f3542'));
    cords.position.y = (WALL_H + y + 0.2) / 2; group.add(cords);
    const rug = new THREE.Mesh(once('rug', () => new RoundedBoxGeometry(1, 0.012, 1, 2, 0.005)), toonMaterial(teams[podColors.get(pod.key)][0])); rug.position.y = 0.006; group.add(rug);
    return { group, board, badge, texture, rug, waiting: null };
  }

  function removeDesk(desk) {
    desk.group.removeFromParent();
    for (const d of [desk, ...desk.helpers || []]) { screens.remove(d.glass); screens.remove(d.side?.glass); d.screenTexture.dispose(); d.side?.texture.dispose(); d.led?.material.dispose(); }
  }

  function buildShell({ room: { width, depth }, door }) {
    disposeTree(shell, false);
    room.size = `${width}x${depth}`;
    // Floor: carpet tiles, a shade apart, drawn once into a repeating texture.
    const carpet = canvasTexture(128, 128, g => {
      for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) { g.fillStyle = (x + y) % 128 ? '#8899af' : '#8192a9'; g.fillRect(x, y, 64, 64); }
      g.strokeStyle = '#7889a0'; g.lineWidth = 1.5; g.strokeRect(0, 0, 128, 128); g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
    });
    carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.repeat.set(width / 1.6, depth / 1.6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), toonMaterial('#ffffff', { map: carpet }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(width / 2, 0, depth / 2); floor.userData.floor = true; shell.add(floor);

    // Walls, each with the inward normal used to fade the ones between the overview camera and the room.
    // What hangs on a wall is its child, so it hides with the wall. Side walls' local x runs toward -z: x = depth / 2 - z.
    room.fadeables.walls = []; room.wallColliders = [];
    const wall = (w, x, z, rotation, normal, color = '#eef1f5') => {
      const m = mesh(new THREE.BoxGeometry(w, WALL_H, WALL_T), toonMaterial(color, { transparent: true }), 0);
      m.position.set(x, WALL_H / 2, z); m.rotation.y = rotation; shell.add(m);
      const trim = mesh(new THREE.BoxGeometry(w, 0.14, WALL_T + 0.04), toonMaterial('#3a4352'), 0); trim.position.y = -WALL_H / 2 + 0.07; m.add(trim);
      room.fadeables.walls.push({ mesh: m, normal });
      room.wallColliders.push(new THREE.Box3().setFromObject(m));
      return m;
    };
    // Two accent walls: teal behind the windows, coral on the right.
    const back = wall(width + WALL_T * 2, width / 2, -WALL_T / 2, 0, new THREE.Vector3(0, 0, 1), '#3fa39b');
    const front = wall(width + WALL_T * 2, width / 2, depth + WALL_T / 2, 0, new THREE.Vector3(0, 0, -1));
    const left = wall(depth, -WALL_T / 2, depth / 2, Math.PI / 2, new THREE.Vector3(1, 0, 0));
    const right = wall(depth, width + WALL_T / 2, depth / 2, Math.PI / 2, new THREE.Vector3(-1, 0, 0), '#ee8a6c');
    // Hangs `item` on a wall at world height y; `along` is the wall's local x. Back and left walls face +z locally, front and right -z.
    const hang = (on, item, along, y, out = 0.02) => { const flip = on === front || on === right; item.position.set(along, y - WALL_H / 2, (WALL_T / 2 + out) * (flip ? -1 : 1)); if (flip) item.rotation.y = Math.PI; on.add(item); return item; };

    // Furniture standing on the floor; each blocks walking.
    room.furnitureColliders = [];
    const place = (item, x, z, rotation = 0, solid = true) => {
      item.position.set(x, 0, z); item.rotation.y = rotation; shell.add(item);
      if (solid) { item.updateMatrixWorld(true); room.furnitureColliders.push(new THREE.Box3().setFromObject(item)); }
      return item;
    };
    const shadowUnder = (x, z, w, d, rotation = 0) => { const s = floorShadow(w, d, 0.3); s.position.set(x, 0.016, z); s.rotation.y = rotation; shell.add(s); };
    const bin = (color, x, z) => { place(piece(`bin${color}`, () => binParts(color)), x, z); shadowUnder(x, z, 0.34, 0.34); };
    // Post-its, hung or placed like anything else; bake() merges them into what's around.
    const notes = (key, list) => piece(`notes-${key}`, () => noteParts(list));

    // Windows on the back wall (windows.js), with posters and plants between them.
    const count = Math.max(1, Math.floor(width / 4)), xs = Array.from({ length: count }, (_, i) => -width / 2 + (i + 0.5) * width / count);
    const windows = createWindows(xs); back.add(windows);
    for (const [i, x] of xs.entries()) {
      if (i) { hang(back, picture(i - 1, 0.7, 0.95), x - width / count / 2, 1.75); if (i % 2) place(plant('bush'), x - width / count / 2 + width / 2, 0.45); }
    }
    place(plant('tree'), 0.5, 0.5); place(plant('snake'), width - 0.5, 0.5);

    // Door in the front wall, facing into the room, with a coat rack, an extinguisher and the light switch beside it.
    const doorGroup = new THREE.Group(); doorGroup.position.set(door.x - width / 2, -WALL_H / 2, -WALL_T / 2 - 0.02); doorGroup.rotation.y = Math.PI; front.add(doorGroup);
    const panel = mesh(rounded(1.05, 2.15, 0.06, 0.03), toonMaterial('#e0574a')); panel.position.y = 1.075; doorGroup.add(panel);
    const knob = mesh(new THREE.SphereGeometry(0.04, 12, 8), toonMaterial('#f2c14e'), 0.006); knob.position.set(0.4, 1.05, 0.06); doorGroup.add(knob);
    const doorNote = notes('door', [[0, 0, 0.06, NOTE.yellow]]); doorNote.position.set(-0.15, 1.5, 0.0325); doorGroup.add(doorNote);
    // A brass name plate; boards.js writes the machine's name on it.
    const plateGroup = new THREE.Group(); plateGroup.position.set(0, 1.82, 0.036); doorGroup.add(plateGroup);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.096), dims(new THREE.MeshBasicMaterial({ color: '#ffffff' }))); plate.position.z = 0.0065;
    plateGroup.add(piece('plate', () => [[rounded(0.48, 0.13, 0.012, 0.005), '#c9a227']]), plate);
    place(coatRack(), door.x + 0.85, depth - 0.35, 0.4);
    hang(front, extinguisher(), door.x - width / 2 - 0.75, 0.25, 0);
    hang(front, lights.createSwitch(), door.x - width / 2 - 0.72, 1.2, 0.008);
    hang(front, notes('switch', [[0, 0, -0.08, NOTE.yellow]]), door.x - width / 2 - 0.72, 1.38, 0.004);

    // Boards; boards.js draws on their faces. The whiteboard is on the left wall, the clock above the door, the waiting board beside it.
    const board = (w, h, frameColor) => { const g = new THREE.Group(); const frame = mesh(rounded(w + 0.1, h + 0.1, 0.05, 0.02), toonMaterial(frameColor), 0.008); g.add(frame); const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), dims(new THREE.MeshBasicMaterial({ color: '#ffffff' }))); face.position.z = 0.03; g.add(face); g.userData.face = face; return g; };
    const whiteboard = hang(left, board(2.4, 1.2, '#c0c4cc'), 0, 1.65, 0.03);
    const clock = new THREE.Group(); const rim = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 32).rotateX(Math.PI / 2), toonMaterial('#2f3542'), 0.008); clock.add(rim);
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), dims(new THREE.MeshBasicMaterial({ color: '#ffffff' }))); clockFace.position.z = 0.032; clock.add(clockFace); clock.userData.face = clockFace;
    hang(front, clock, door.x - width / 2, 2.6, 0.04);
    const waiting = hang(front, board(1.1, 0.8, '#3a4352'), door.x - width / 2 - 1.4, 1.5, 0.03);
    // Post-its on the boards' frames, clear of what boards.js writes.
    hang(left, notes('whiteboard', [[0, 0.32, 0.1, NOTE.yellow], [0.012, 0.2, -0.07, NOTE.yellow], [-0.008, -0.34, 0.05, NOTE.pink]]), 1.24, 1.65, 0.0585);
    hang(front, notes('noticeboard', [[-0.57, 0.41, -0.15, NOTE.pink], [0.57, -0.4, 0.12, NOTE.blue], [0.585, -0.29, -0.06, NOTE.yellow]]), door.x - width / 2 - 1.4, 1.5, 0.0585);
    room.boards = { whiteboard: whiteboard.userData.face, clock: clockFace, waiting: waiting.userData.face, plate };

    // Left wall: a bookshelf at the back, the coffee corner at the front, pictures where there's room.
    const along = z => depth / 2 - z;
    place(bookshelf(), 0.2, 1.45, Math.PI / 2); shadowUnder(0.25, 1.45, 0.5, 1);
    if (depth / 2 - 1.3 - 1.95 > 1.1) hang(left, picture(1, 0.8, 0.6), along((1.95 + depth / 2 - 1.3) / 2), 1.7);
    place(counter(), 0.32, depth - 1.6, Math.PI / 2); shadowUnder(0.35, depth - 1.6, 0.7, 2.1);
    // E or a click on the machine fills the boss's mug (room.onCoffee, from office.js).
    room.coffeeMachine = place(coffeeMachine(), 0.32, depth - 1.6, Math.PI / 2, false); room.coffeeMachine.userData.toggle = () => room.onCoffee?.();
    hang(left, mugShelf(), along(depth - 1.6), 1.75, 0.11);
    hang(left, notes('coffee', [[0, 0.05, 0.08, NOTE.yellow], [0.07, -0.05, -0.12, NOTE.green]]), along(depth - 0.75), 1.25, 0.004);
    bin('#3a3d46', 0.3, depth - 0.35);
    if (depth - 3.05 > depth / 2 + 1.35) place(waterCooler(), 0.24, depth - 3.05, Math.PI / 2);
    if (depth - 3.65 > depth / 2 + 1.35) place(plant('bush'), 0.42, depth - 3.65);

    // Right wall: printer and filing cabinet at the back, pictures along it, the lounge in the front corner.
    place(printer(), width - 0.36, 1.25, -Math.PI / 2); place(filingCabinet(), width - 0.32, 2.05, -Math.PI / 2); shadowUnder(width - 0.35, 1.65, 0.65, 1.4);
    place(notes('printer', [[0.16, 0.76, 0.1, NOTE.pink, 0.2235]]), width - 0.36, 1.25, -Math.PI / 2, false); // on its front
    bin('#2e86ab', width - 0.3, 2.62);
    for (let z = 3.4, i = 2; z < depth - 3.4; z += 2.6, i++) hang(right, picture(i, 0.75, 0.95), along(z), 1.7); // from 2, so the lounge's picture 0 comes round late

    // Lounge: a rug, a sofa against the front wall, an armchair, a low table, a lamp and a plant.
    const lx = width - 2.1;
    const lounge = rug(3.1, 2.5, '#f2c14e'); lounge.position.set(width - 1.85, 0.007, depth - 1.5); shell.add(lounge);
    place(sofa(), lx, depth - 0.5, Math.PI); shadowUnder(lx, depth - 0.5, 2, 0.95);
    place(armchair(), width - 0.6, depth - 1.75, -Math.PI / 2); shadowUnder(width - 0.6, depth - 1.75, 0.9, 0.95);
    place(lowTable(), lx, depth - 1.65); shadowUnder(lx, depth - 1.65, 1.2, 0.7);
    place(floorLamp(), width - 0.38, depth - 0.38);
    if (lx - 1.3 > door.x + 1.4) place(plant('snake'), lx - 1.3, depth - 0.45);
    hang(front, picture(0, 1.2, 0.8), lx - width / 2, 1.85);
    // Front wall left of the boards: a picture and a plant when there's room.
    if (door.x - 2.2 > 2) { hang(front, picture(5, 0.8, 0.8), (door.x - 2.2) / 2 + 0.4 - width / 2, 1.7); place(plant('bush'), door.x - 2.6, depth - 0.45); }

    // Ceiling tiles and round lamps, each with a soft glow; hidden as one group in the overview.
    const tiles = canvasTexture(128, 128, g => { g.fillStyle = '#fbfbfa'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#d8dce2'; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128); });
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(width / 1.2, depth / 1.2);
    const ceiling = new THREE.Group(); shell.add(ceiling);
    // Switched off, the lamps go grey and their glow goes out (black adds nothing).
    const ceilingPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), dims(new THREE.MeshBasicMaterial({ map: tiles, color: '#dfe2e7', transparent: true }), 0.3));
    ceilingPlane.rotation.x = Math.PI / 2; ceilingPlane.position.set(width / 2, WALL_H, depth / 2); ceiling.add(ceilingPlane);
    const lampMaterial = dims(new THREE.MeshBasicMaterial({ color: '#fff8e2', transparent: true }), 0.45), glowMaterial = dims(new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0);
    for (let x = 2; x < width - 1; x += 4) for (let z = 2; z < depth - 1; z += 4) {
      const lamp = new THREE.Mesh(once('lamp', () => new THREE.CylinderGeometry(0.35, 0.4, 0.06, 24)), lampMaterial); lamp.position.set(x, WALL_H - 0.03, z); ceiling.add(lamp);
      const glow = new THREE.Mesh(once('glow', () => new THREE.PlaneGeometry(2.4, 2.4).rotateX(Math.PI / 2)), glowMaterial); glow.position.set(x, WALL_H - 0.005, z); ceiling.add(glow);
    }
    room.fadeables.ceiling = ceiling;
    // The lamps' light: a few point lights on a coarse grid (each one costs every lit pixel, so not one per lamp).
    const cols = Math.ceil(width / 8), rows = Math.ceil(depth / 8);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const light = dims(new THREE.PointLight('#ffecd0', 6, 0, 1.5), 0); light.position.set((i + 0.5) * width / cols, WALL_H - 0.35, (j + 0.5) * depth / rows); shell.add(light);
    }
    // What stands still goes into a few merged meshes; the windows move with the view, so they stay.
    bake(shell, [ceiling]); bake(ceiling);
    for (const w of [back, front, left, right]) bake(w, [windows]);
  }

  return room;
}

// Merges the plain meshes under `group` (no userData, nothing below them but an outline; plain groups are looked into) into one
// mesh per material and outline: far fewer draw calls for things that never move. Collider boxes are taken first; a merged
// mesh is picked by the boxes of what went into it.
function bake(group, keep = []) {
  group.updateMatrixWorld(true);
  const toGroup = group.matrixWorld.clone().invert(), buckets = new Map(), sharedGeometry = new Set(Object.values(shared));
  const visit = node => {
    if (keep.includes(node) || !node.visible || Object.keys(node.userData).length) return;
    if (node.constructor === THREE.Group) node.children.forEach(visit);
    if (node.constructor !== THREE.Mesh || Array.isArray(node.material) || node.children.some(child => !child.userData.outline)) return;
    const key = `${node.material.uuid}:${node.children[0]?.material.userData.thickness || 0}`;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(node);
  };
  group.children.forEach(visit);
  for (const [key, nodes] of buckets) {
    if (nodes.length < 2) continue;
    const thickness = Number(key.split(':')[1]), boxes = [];
    const geometries = nodes.map(node => {
      const matrix = toGroup.clone().multiply(node.matrixWorld), g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      g.applyMatrix4(matrix);
      if (thickness) g.attributes.outlineNormal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix)); else g.deleteAttribute('outlineNormal');
      return g;
    });
    const geometry = mergeGeometries(geometries); if (!geometry) continue;
    for (const node of nodes) {
      if (node.raycast === THREE.Mesh.prototype.raycast) boxes.push(new THREE.Box3().setFromObject(node).applyMatrix4(toGroup));
      const parent = node.parent; node.removeFromParent();
      if (!sharedGeometry.has(node.geometry)) node.geometry.dispose();
      if (parent !== group && parent.constructor === THREE.Group && !parent.children.length) parent.removeFromParent();
    }
    const merged = mesh(geometry, nodes[0].material, thickness); group.add(merged);
    const ray = new THREE.Ray(), point = new THREE.Vector3(), inverse = new THREE.Matrix4();
    merged.raycast = (raycaster, hits) => {
      ray.copy(raycaster.ray).applyMatrix4(inverse.copy(merged.matrixWorld).invert());
      for (const box of boxes) {
        if (!ray.intersectBox(box, point)) continue;
        point.applyMatrix4(merged.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(point);
        if (distance >= raycaster.near && distance <= raycaster.far) hits.push({ distance, point: point.clone(), object: merged });
      }
    };
  }
}

// Removes a subtree and frees what only it uses; shared geometries stay for the next desk and are freed with the scene on unmount.
function disposeTree(object, removeSelf = true) {
  const sharedGeometry = new Set(Object.values(shared));
  for (const child of [...object.children]) {
    child.traverse(node => {
      if (node.geometry && !sharedGeometry.has(node.geometry)) node.geometry.dispose();
      for (const material of [node.material].flat()) if (material && !material.userData?.shared) { material.map?.dispose(); if (material.type === 'MeshBasicMaterial') material.dispose(); }
    });
    if (!removeSelf || object !== child) child.removeFromParent();
  }
  if (removeSelf) object.removeFromParent();
}
