// The office itself: floor, walls, ceiling and lights, door, windows, desks with chairs and computers, project signs,
// the wall boards and the dressing around the edges (coffee corner, lounge, plants, shelves, pictures).
// Coordinates come straight from layout.js: the room spans x 0..width, z 0..depth, the door is on the front wall (z = depth).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMaterial } from './toon.js';
import { DESK_W, DESK_D } from './layout.js';
import {
  WALL_H, WALL_T, shared, once, rounded, mesh, canvasTexture, piece, deskItem, coffeeCup, plant, picture, sofa, armchair, lowTable, floorLamp, rug,
  counter, mugShelf, waterCooler, bookshelf, printer, filingCabinet, coatRack, extinguisher, glowTexture, floorShadow,
} from './furniture.js';

export { WALL_H };
export const DESK_H = 0.76, SEAT_H = 0.47, HELPER_SCALE = 0.42;
// In a desk's frame: the chair sits back from the desk edge so the sitter's body clears it; hands reach the keyboard.
export const CHAIR_Z = -(DESK_D / 2 + 0.42), KEYS_Z = -0.27, MOUSE_X = -0.33;
export const BACK_Z = -0.34; // front of the chair back, from the chair's centre
const MONITOR_Z = DESK_D * 0.28;
// Each pod's colours: its rug, and its chairs in a stronger shade.
const teams = [['#f4a6a6', '#e0675c'], ['#a6d8f4', '#3d8fd1'], ['#b9e4a1', '#4fa84a'], ['#f6d28b', '#e8a23a'], ['#cdb4f2', '#8a63d2'], ['#f7b8de', '#d9559c']];
// Helpers' tiny desks in the parent desk's frame: either side of its chair, then behind it.
const HELPER_SPOTS = [[0.56, -0.66], [-0.56, -0.66], [-0.6, -1.42]];
const CUP_SPOTS = [[0.5, -0.34], [0.62, -0.3], [0.56, -0.2], [0.68, -0.19], [0.5, -0.1], [0.63, -0.09]];
const ITEM_SPOTS = [[-0.6, 0.22], [-0.42, 0.3], [0.6, 0.24]]; // the front-left corner stays free
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
const keyboardParts = () => [
  [B(0.42, 0.025, 0.14, 0, DESK_H + 0.0125, KEYS_Z, 0.012), '#e9e6df'], ...[-0.04, 0, 0.04].map(z => [B(0.38, 0.008, 0.028, 0, DESK_H + 0.026, KEYS_Z + z, 0.003), '#cfc9bd']),
  [B(0.2, 0.006, 0.18, MOUSE_X, DESK_H + 0.003, KEYS_Z, 0.003), '#3d5a80'], [new THREE.SphereGeometry(0.03, 12, 8).scale(0.8, 0.5, 1.25).translate(MOUSE_X, DESK_H + 0.016, KEYS_Z), '#e9e6df'],
];
const towerParts = () => [
  [B(0.18, 0.42, 0.4, 0, 0.21, 0, 0.02), '#2f3542'], [B(0.12, 0.014, 0.01, 0, 0.33, -0.2, 0.003), '#8a8f99'], [B(0.12, 0.014, 0.01, 0, 0.3, -0.2, 0.003), '#8a8f99'],
  ...[0.08, 0.11, 0.14].map(y => [B(0.1, 0.006, 0.006, 0, y, -0.2, 0), '#4a5160']), [C(0.018, 0.018, 0.012, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 0.24, -0.2), '#8a8f99'],
];
// Office chair: padded seat and back on a gas post, five-star base on casters. Its origin is on the floor under the seat.
const chairParts = seat => {
  const dark = '#3a3d46', parts = [
    [C(0.055, 0.06, 0.06, 0, 0.08, 0), dark], [C(0.024, 0.024, SEAT_H - 0.18, 0, 0.1 + (SEAT_H - 0.18) / 2, 0, 10), '#8a8f99'], [B(0.22, 0.04, 0.22, 0, SEAT_H - 0.11, 0, 0.01), dark],
    [B(0.52, 0.09, 0.48, 0, SEAT_H - 0.045, 0, 0.04), seat], [B(0.07, 0.03, 0.16, 0, SEAT_H - 0.1, -0.26, 0.008), dark], [B(0.07, 0.4, 0.03, 0, SEAT_H + 0.08, -0.34, 0.008), dark],
    [rounded(0.46, 0.48, 0.08, 0.04).rotateX(-0.15).translate(0, SEAT_H + 0.38, BACK_Z - 0.04), seat],
  ];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + Math.PI;
    parts.push([B(0.05, 0.035, 0.26, 0, 0.075, 0.13, 0.012).rotateY(a), dark], [new THREE.SphereGeometry(0.032, 10, 8).translate(0, 0.032, 0.27).rotateY(a), '#1b1a1f']);
  }
  return parts;
};

// One desk in its own frame: the sitter faces +z from the chair at -z; the monitor is at the far (+z) edge facing them.
// A helper's desk is the same, narrower and bare, and scaled down.
function createDesk(color, width = DESK_W, helper = false) {
  const group = new THREE.Group();
  group.add(piece(`desk${width}`, () => deskParts(width)), piece('monitor', monitorParts), piece('keyboard', keyboardParts, 0.005));
  // The screen is a tiny terminal of the session's latest lines; room.sync redraws it when they change.
  const screenTexture = helper ? canvasTexture(216, 128, drawScreen) : canvasTexture(432, 256, drawScreen);
  const screen = new THREE.Mesh(once('screen', () => new THREE.PlaneGeometry(0.54, 0.32)), new THREE.MeshBasicMaterial({ map: screenTexture }));
  screen.position.set(0, DESK_H + 0.34, MONITOR_Z - 0.032); screen.rotation.y = Math.PI; group.add(screen);
  const chair = piece(`chair${color}`, () => chairParts(color)); chair.position.z = CHAIR_Z; group.add(chair);
  const chairShadow = floorShadow(0.72, 0.72, 0.3); chairShadow.position.z = CHAIR_Z; group.add(floorShadow(width, DESK_D * 1.05, 0.3), chairShadow);
  const desk = { group, screen, screenTexture, chair, color };
  if (helper) return desk;
  const tower = piece('tower', towerParts); tower.position.set(-0.5, 0, 0.06); group.add(tower); // on the floor under the desk, leaving the top free
  desk.led = new THREE.Mesh(once('led', () => new THREE.SphereGeometry(0.012, 8, 6)), new THREE.MeshBasicMaterial({ color: leds.off })); desk.led.position.set(0, 0.39, -0.205); tower.add(desk.led);
  desk.cups = new THREE.Group(); desk.cups.position.y = DESK_H; group.add(desk.cups);
  desk.helpers = [];
  return desk;
}

const tints = { green: ['#0f2a1a', '#5ee08a'], amber: ['#2e2108', '#ffb23e'], dark: ['#151821', '#7d8699'], red: ['#2e0f0f', '#ff6b6b'], off: ['#0d0e12', '#3a3f4b'], spare: ['#151821', '#4f7cff'] };
// Drawn at 432×256 and scaled to the canvas, so helpers' smaller screens show the same thing.
function drawScreen(g, w, h, monitor = null, tone = 'off') {
  const [background, accent] = tints[tone] || tints.off;
  g.setTransform(w / 432, 0, 0, h / 256, 0, 0); w = 432; h = 256;
  g.fillStyle = background; g.fillRect(0, 0, w, h);
  // A spare desk's screen is a big + : start someone here.
  if (tone === 'spare') { g.fillStyle = accent; g.fillRect(w / 2 - 9, h / 2 - 54, 18, 108); g.fillRect(w / 2 - 54, h / 2 - 9, 108, 18); }
  if (!monitor) return;
  g.fillStyle = accent; g.fillRect(0, 0, w, 34);
  g.fillStyle = background; g.font = 'bold 20px ui-monospace, monospace'; g.textBaseline = 'middle';
  g.fillText(clip(g, monitor.title, w - 20), 10, 18);
  g.font = '17px ui-monospace, monospace'; g.textBaseline = 'top';
  monitor.lines.forEach(({ text, kind }, i) => {
    g.fillStyle = kind === 'user' ? '#ffffff' : kind === 'tool' ? accent : '#c9cfdb';
    g.fillText(clip(g, `${kind === 'user' ? '› ' : kind === 'tool' ? '• ' : '  '}${text}`, w - 20), 10, 46 + i * 34);
  });
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

export function createRoom(scene) {
  const root = new THREE.Group(); scene.add(root);
  const shell = new THREE.Group(); root.add(shell);
  // Soft fill plus daylight through the back windows; the ceiling lamps (point lights, in the shell) do the rest.
  const sun = new THREE.DirectionalLight('#fff8ee', 0.55); sun.position.set(-2, 6, -7);
  root.add(new THREE.HemisphereLight('#f6f4ff', '#5d6575', 0.6), sun);
  const desks = new Map(), spares = new Map(), signs = new Map(), podColors = new Map(); // pod key → index into teams, kept as pods come and go
  const room = {
    colliders: [], furnitureColliders: [], fadeables: { ceiling: null, walls: [] }, boards: {},
    deskAnchor(id) {
      const desk = desks.get(id); if (!desk) return null;
      desk.group.updateMatrixWorld();
      return {
        seat: desk.chair.getWorldPosition(new THREE.Vector3()).setY(SEAT_H),
        facing: desk.group.rotation.y,
        monitor: desk.screen.getWorldPosition(new THREE.Vector3()),
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
        if (!desk) { desk = createDesk(teams[podColors.get(place.podKey)][1]); addItems(desk, statuses.get(id)?.identity?.props || []); desks.set(id, desk); root.add(desk.group); }
        desk.group.position.set(place.x, 0, place.z); desk.group.rotation.y = place.rotation;
        const status = statuses.get(id);
        redraw(desk, status);
        if (desk.led.material.userData.tone !== status?.screen) { desk.led.material.userData.tone = status?.screen; desk.led.material.color.set(leds[status?.screen] || leds.off); }
        setCups(desk, status?.cups || 0);
        // One tiny desk per helper on show.
        while (desk.helpers.length > place.subagents.length) removeDesk(desk.helpers.pop());
        place.subagents.forEach((kid, i) => {
          let helper = desk.helpers[i];
          if (!helper) { helper = desk.helpers[i] = createDesk(desk.color, 1, true); helper.group.scale.setScalar(HELPER_SCALE); helper.group.position.set(HELPER_SPOTS[i][0], 0, HELPER_SPOTS[i][1]); desk.group.add(helper.group); }
          redraw(helper, statuses.get(kid));
        });
        desk.group.updateMatrixWorld(true);
        for (const part of [desk.group.children[0], desk.chair, ...desk.helpers.map(helper => helper.group)]) solid.push(new THREE.Box3().setFromObject(part));
      }
      for (const [id, desk] of desks) if (!layout.desks.has(id)) { removeDesk(desk); desks.delete(id); }
      const podKeys = new Set();
      for (const pod of layout.pods) {
        podKeys.add(pod.key);
        let sign = signs.get(pod.key);
        if (!sign) { sign = createSign(pod); signs.set(pod.key, sign); root.add(sign.group); }
        sign.group.position.set(pod.x, 0, pod.z);
        sign.rug.scale.set(pod.width + 0.6, 1, pod.depth + 0.4);
        const waiting = pod.deskIds.some(id => statuses.get(id)?.bubble?.highlight);
        if (sign.waiting !== waiting) { sign.waiting = waiting; sign.texture.redraw(waiting); }
      }
      for (const [key, sign] of signs) if (!podKeys.has(key)) { disposeTree(sign.group); signs.delete(key); }
      // Each pod's spare desk, bare and switched off but for a + on the screen (and the back of the monitor, for the far side
      // of the pod); clicking it starts an agent in the pod's folder.
      for (const pod of layout.pods) {
        let desk = spares.get(pod.key);
        if (!pod.spare) { if (desk) { removeDesk(desk); spares.delete(pod.key); } continue; }
        if (!desk) {
          desk = createDesk(teams[podColors.get(pod.key)][1]); desk.screenTexture.redraw(null, 'spare'); spares.set(pod.key, desk); root.add(desk.group);
          const back = new THREE.Mesh(once('screenBack', () => new THREE.PlaneGeometry(0.3, 0.18)), desk.screen.material); back.position.set(0, DESK_H + 0.32, MONITOR_Z + 0.081); desk.group.add(back);
        }
        desk.group.userData.spare = { cwd: pod.cwd, name: pod.name };
        desk.group.position.set(pod.spare.x, 0, pod.spare.z); desk.group.rotation.y = pod.spare.rotation; desk.group.updateMatrixWorld(true);
        for (const part of [desk.group.children[0], desk.chair]) solid.push(new THREE.Box3().setFromObject(part));
      }
      for (const [key, desk] of spares) if (!podKeys.has(key)) { removeDesk(desk); spares.delete(key); }
      room.colliders = [...room.wallColliders, ...room.furnitureColliders, ...solid];
    },
    dispose() { disposeTree(root); },
  };

  const redraw = (desk, status) => {
    const key = JSON.stringify([status?.screen, status?.monitor]);
    if (desk.screenKey !== key) { desk.screenKey = key; desk.screenTexture.redraw(status?.monitor, status?.screen); }
  };
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
    const board = new THREE.Mesh(once('sign', () => rounded(1.6, 0.4, 0.05, 0.03)), [null, null, null, null, null, null].map((_, i) => i === 4 || i === 5 ? new THREE.MeshBasicMaterial({ map: texture }) : toonMaterial('#2f3542')));
    board.position.y = y; group.add(board);
    for (const x of [-0.6, 0.6]) { const cord = new THREE.Mesh(once('cord', () => new THREE.CylinderGeometry(0.008, 0.008, WALL_H - y - 0.2, 6)), toonMaterial('#2f3542')); cord.position.set(x, (WALL_H + y + 0.2) / 2, 0); group.add(cord); }
    const rug = new THREE.Mesh(once('rug', () => new RoundedBoxGeometry(1, 0.012, 1, 2, 0.005)), toonMaterial(teams[podColors.get(pod.key)][0])); rug.position.y = 0.006; group.add(rug);
    return { group, texture, rug, waiting: null };
  }

  function removeDesk(desk) {
    desk.group.removeFromParent();
    for (const d of [desk, ...desk.helpers || []]) { d.screenTexture.dispose(); d.screen.material.dispose(); d.led?.material.dispose(); }
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

    // Windows on the back wall: a frame around a sky gradient (no real cutout needed), with posters and plants between them.
    const sky = canvasTexture(64, 128, g => { const grad = g.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, '#6ec3f4'); grad.addColorStop(1, '#d8f1ff'); g.fillStyle = grad; g.fillRect(0, 0, 64, 128); g.fillStyle = '#ffffffcc'; g.beginPath(); g.ellipse(22, 40, 14, 6, 0, 0, 7); g.ellipse(34, 37, 10, 7, 0, 0, 7); g.fill(); });
    const count = Math.max(1, Math.floor(width / 4));
    for (let i = 0; i < count; i++) {
      const x = -width / 2 + (i + 0.5) * width / count;
      const frame = mesh(rounded(1.5, 1.3, 0.06, 0.03), toonMaterial('#ffffff'), 0.008); frame.position.set(x, 0.25, WALL_T / 2 + 0.03); back.add(frame);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.16), new THREE.MeshBasicMaterial({ map: sky, transparent: true })); glass.position.set(x, 0.25, WALL_T / 2 + 0.065); back.add(glass);
      const bar = mesh(new THREE.BoxGeometry(0.05, 1.16, 0.03), toonMaterial('#ffffff'), 0); bar.position.set(x, 0.25, WALL_T / 2 + 0.07); back.add(bar);
      const sill = mesh(rounded(1.6, 0.05, 0.16, 0.02), toonMaterial('#ffffff'), 0.006); sill.position.set(x, -0.43, WALL_T / 2 + 0.08); back.add(sill);
      if (i) { hang(back, picture(i - 1, 0.7, 0.95), x - width / count / 2, 1.75); if (i % 2) place(plant('bush'), x - width / count / 2 + width / 2, 0.45); }
    }
    place(plant('tree'), 0.5, 0.5); place(plant('snake'), width - 0.5, 0.5);

    // Door in the front wall, facing into the room, with a coat rack and an extinguisher beside it.
    const doorGroup = new THREE.Group(); doorGroup.position.set(door.x - width / 2, -WALL_H / 2, -WALL_T / 2 - 0.02); doorGroup.rotation.y = Math.PI; front.add(doorGroup);
    const panel = mesh(rounded(1.05, 2.15, 0.06, 0.03), toonMaterial('#e0574a')); panel.position.y = 1.075; doorGroup.add(panel);
    const knob = mesh(new THREE.SphereGeometry(0.04, 12, 8), toonMaterial('#f2c14e'), 0.006); knob.position.set(0.4, 1.05, 0.06); doorGroup.add(knob);
    place(coatRack(), door.x + 0.85, depth - 0.35, 0.4);
    hang(front, extinguisher(), door.x - width / 2 - 0.75, 0.25, 0);

    // Boards; boards.js draws on their faces. The whiteboard is on the left wall, the clock above the door, the waiting board beside it.
    const board = (w, h, frameColor) => { const g = new THREE.Group(); const frame = mesh(rounded(w + 0.1, h + 0.1, 0.05, 0.02), toonMaterial(frameColor), 0.008); g.add(frame); const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#ffffff' })); face.position.z = 0.03; g.add(face); g.userData.face = face; return g; };
    const whiteboard = hang(left, board(2.4, 1.2, '#c0c4cc'), 0, 1.65, 0.03);
    const clock = new THREE.Group(); const rim = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 32).rotateX(Math.PI / 2), toonMaterial('#2f3542'), 0.008); clock.add(rim);
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), new THREE.MeshBasicMaterial({ color: '#ffffff' })); clockFace.position.z = 0.032; clock.add(clockFace); clock.userData.face = clockFace;
    hang(front, clock, door.x - width / 2, 2.6, 0.04);
    const waiting = hang(front, board(1.1, 0.8, '#3a4352'), door.x - width / 2 - 1.4, 1.5, 0.03);
    room.boards = { whiteboard: whiteboard.userData.face, clock: clockFace, waiting: waiting.userData.face };

    // Left wall: a bookshelf at the back, the coffee corner at the front, pictures where there's room.
    const along = z => depth / 2 - z;
    place(bookshelf(), 0.2, 1.45, Math.PI / 2); shadowUnder(0.25, 1.45, 0.5, 1);
    if (depth / 2 - 1.3 - 1.95 > 1.1) hang(left, picture(1, 0.8, 0.6), along((1.95 + depth / 2 - 1.3) / 2), 1.7);
    place(counter(), 0.32, depth - 1.6, Math.PI / 2); shadowUnder(0.35, depth - 1.6, 0.7, 2.1);
    hang(left, mugShelf(), along(depth - 1.6), 1.75, 0.11);
    if (depth - 3.05 > depth / 2 + 1.35) place(waterCooler(), 0.24, depth - 3.05, Math.PI / 2);
    if (depth - 3.65 > depth / 2 + 1.35) place(plant('bush'), 0.42, depth - 3.65);

    // Right wall: printer and filing cabinet at the back, pictures along it, the lounge in the front corner.
    place(printer(), width - 0.36, 1.25, -Math.PI / 2); place(filingCabinet(), width - 0.32, 2.05, -Math.PI / 2); shadowUnder(width - 0.35, 1.65, 0.65, 1.4);
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
    const ceilingPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: tiles, color: '#dfe2e7', transparent: true }));
    ceilingPlane.rotation.x = Math.PI / 2; ceilingPlane.position.set(width / 2, WALL_H, depth / 2); ceiling.add(ceilingPlane);
    const lampMaterial = new THREE.MeshBasicMaterial({ color: '#fff8e2', transparent: true }), glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let x = 2; x < width - 1; x += 4) for (let z = 2; z < depth - 1; z += 4) {
      const lamp = new THREE.Mesh(once('lamp', () => new THREE.CylinderGeometry(0.35, 0.4, 0.06, 24)), lampMaterial); lamp.position.set(x, WALL_H - 0.03, z); ceiling.add(lamp);
      const glow = new THREE.Mesh(once('glow', () => new THREE.PlaneGeometry(2.4, 2.4).rotateX(Math.PI / 2)), glowMaterial); glow.position.set(x, WALL_H - 0.005, z); ceiling.add(glow);
    }
    room.fadeables.ceiling = ceiling;
    // The lamps' light: a few point lights on a coarse grid (each one costs every lit pixel, so not one per lamp).
    const cols = Math.ceil(width / 8), rows = Math.ceil(depth / 8);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const light = new THREE.PointLight('#ffecd0', 6, 0, 1.5); light.position.set((i + 0.5) * width / cols, WALL_H - 0.35, (j + 0.5) * depth / rows); shell.add(light);
    }
  }

  return room;
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
