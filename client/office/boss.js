// The boss's office (its plan is boss-plan.js): the office floor's back-left corner, glassed off from the floor, with a glass
// door at the front glass's right end that swings in for anyone near it as the kitchen's do. Its back and left walls are the
// office's own (room.js keeps a window behind the desk); the boss's vanity hangs on them (vanity.js). Built once in world
// metres, the same for every room; room.js hands it the desk (its desks are room.js's) and adds what it returns.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOSS, CHAIR, DESK, DOOR_X, STAND, bossBoxes, bossInside } from './boss-plan.js';
import { LAYOUT, clockOf, drawDesktop, drawGeneric, fakeCart } from './desktop.js';
import { WALL_H, canvasTexture, piece, rounded, rug } from './furniture.js';
import { DOOR_FAR, DOOR_NEAR } from './kitchen.js';
import { dims } from './lights.js';
import { SCREEN_H, SCREEN_W, viewTest } from './screens.js';
import { toonMaterial } from './toon.js';
import { createVanity } from './vanity.js';

const MOVE = 0.45, SWUNG = 1.62; // as the kitchen's doors: seconds to swing, radians, a little past square
const HINGE = BOSS.w - BOSS.post, OPEN = HINGE - BOSS.door; // the doorway's sides
const GLASS = BOSS.d + BOSS.glass / 2, SIDE = BOSS.w + BOSS.glass / 2, FRONT = BOSS.d + BOSS.glass, OUTER = BOSS.w + BOSS.glass; // the glass's planes; its outside faces
const FRAME = 0.04, RAIL = 0.08, BAND = [0.9, 1.2], MIDDLE = BOSS.d / 2, METAL = '#2f3542'; // the dark frames; the frosted band across the glass, so it reads as glass; the side's upright
// A box from corner to corner.
const span = (xa, ya, za, xb, yb, zb) => new THREE.BoxGeometry(xb - xa, yb - ya, zb - za).translate((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
const glass = () => toonMaterial('#cfe8f4', { transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
const frosted = () => toonMaterial('#ffffff', { transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
// Panes [from, to, bottom, top] along the front glass (x) or the side glass (z), as one mesh.
const sheet = (front, side, material) => new THREE.Mesh(mergeGeometries([
  ...front.map(([a, b, y0, y1]) => new THREE.PlaneGeometry(b - a, y1 - y0).translate((a + b) / 2, (y0 + y1) / 2, GLASS)),
  ...side.map(([a, b, y0, y1]) => new THREE.PlaneGeometry(b - a, y1 - y0).rotateY(-Math.PI / 2).translate(SIDE, (y0 + y1) / 2, (a + b) / 2)),
]), material);
// Each pane's glass above and below the band, and the band.
const clear = panes => panes.flatMap(([a, b, top = WALL_H - FRAME]) => [[a, b, RAIL, BAND[0]], [a, b, BAND[1], top]]);
const banded = panes => panes.map(([a, b]) => [a, b, ...BAND]);

// The brass plate on the post, its letters stacked down it: the post is narrower than the word.
function plate() {
  const texture = canvasTexture(64, 232, g => {
    g.fillStyle = '#c9a227'; g.fillRect(0, 0, 64, 232); g.strokeStyle = '#8a6d12'; g.lineWidth = 4; g.strokeRect(4, 4, 56, 224);
    g.fillStyle = '#3a2a08'; g.font = '40px Silkscreen, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...'BOSS'].forEach((letter, i) => g.fillText(letter, 32, 36 + i * 53));
  });
  document.fonts?.load('40px Silkscreen').then(() => texture.redraw(), () => {});
  const group = new THREE.Group(), face = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.36), dims(new THREE.MeshBasicMaterial({ map: texture })));
  face.position.z = 0.0065; group.add(piece('bossPlate', () => [[rounded(0.11, 0.37, 0.012, 0.004), '#c9a227']], 0), face);
  return group;
}

// `desk`: room.js's desk, its monitor already scaled up; clicking the monitor or the chair calls onSit. `onMove`: the door
// went from shut to moving or back, so what's thrown meets something else.
export function createBossOffice({ desk, onSit, onMove }) {
  const group = new THREE.Group(), boxes = bossBoxes();

  // The frames: uprights at the left wall, between the panes and at the doorway, rails top and bottom, a head over the door
  // and the post it hangs on; the side's the same along the walkway.
  group.add(piece('bossFrames', () => [
    ...[0, OPEN / 2 - FRAME / 2, OPEN - FRAME].map(x => span(x, 0, GLASS - 0.03, x + FRAME, WALL_H, GLASS + 0.03)),
    span(0, 0, GLASS - 0.03, OPEN, RAIL, GLASS + 0.03), span(0, WALL_H - FRAME, GLASS - 0.03, HINGE, WALL_H, GLASS + 0.03),
    span(OPEN, BOSS.doorH, GLASS - 0.03, HINGE, BOSS.doorH + 0.05, GLASS + 0.03), span(HINGE, 0, BOSS.d, OUTER, WALL_H, FRONT),
    ...[0, MIDDLE - FRAME / 2].map(z => span(SIDE - 0.03, 0, z, SIDE + 0.03, WALL_H, z + FRAME)),
    span(SIDE - 0.03, 0, 0, SIDE + 0.03, RAIL, BOSS.d), span(SIDE - 0.03, WALL_H - FRAME, 0, SIDE + 0.03, WALL_H, BOSS.d),
  ].map(geometry => [geometry, METAL]), 0.004));
  const front = [[FRAME, OPEN / 2 - FRAME / 2], [OPEN / 2 + FRAME / 2, OPEN - FRAME]], side = [[FRAME, MIDDLE - FRAME / 2], [MIDDLE + FRAME / 2, BOSS.d]];
  group.add(sheet([...clear(front), [OPEN, HINGE, BOSS.doorH + 0.05, WALL_H - FRAME]], clear(side), glass()), sheet(banded(front), banded(side), frosted()));

  // Carpet, the boss's own: blue-grey squares.
  const carpet = canvasTexture(64, 64, g => { g.fillStyle = '#5d6c88'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#54627d'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64); });
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.repeat.set(BOSS.w / 0.5, BOSS.d / 0.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(BOSS.w, BOSS.d).rotateX(-Math.PI / 2), toonMaterial('#ffffff', { map: carpet }));
  floor.position.set(BOSS.w / 2, 0.004, BOSS.d / 2); floor.userData.floor = true; group.add(floor);

  // The door: one glass leaf hung on the post, swinging in.
  const leaf = new THREE.Group(); leaf.position.set(HINGE, 0, GLASS); leaf.userData.leaf = true; group.add(leaf);
  const W = BOSS.door - 0.02, H = BOSS.doorH - 0.02, edge = -0.01 - W; // its far side, from the hinge
  leaf.add(piece('bossDoor', () => [
    [span(edge, 0.01, -0.025, edge + 0.05, H, 0.025), METAL], [span(-0.06, 0.01, -0.025, -0.01, H, 0.025), METAL],
    [span(edge, 0.01, -0.025, -0.01, 0.12, 0.025), METAL], [span(edge, H - 0.05, -0.025, -0.01, H, 0.025), METAL],
    ...[-1, 1].map(side => [span(edge + 0.09, 0.85, side * 0.045 - 0.012, edge + 0.115, 1.35, side * 0.045 + 0.012), '#c0c6cf']),
  ], 0.005));
  const pane = [edge + 0.05, -0.06], inLeaf = (parts, material) => new THREE.Mesh(mergeGeometries(parts.map(([y0, y1]) => new THREE.PlaneGeometry(pane[1] - pane[0], y1 - y0).translate((pane[0] + pane[1]) / 2, (y0 + y1) / 2, 0))), material);
  leaf.add(inLeaf([[0.12, BAND[0]], [BAND[1], H - 0.05]], glass()), inLeaf([BAND], frosted()));

  // The desk, the boss's back to the window, and what sits you at it.
  desk.group.position.set(DESK.x, 0, DESK.z); desk.group.rotation.y = DESK.rotation; group.add(desk.group);
  desk.monitor.userData.toggle = onSit;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.3, 0.62).translate(0, 0.65, 0), new THREE.MeshBasicMaterial({ visible: false }));
  seat.position.set(CHAIR.x, 0, CHAIR.z); seat.userData.toggle = onSit; group.add(seat);
  const under = rug(2.8, 2.2, '#7a2e3b', '#d9b26a'); under.position.set(DESK.x, 0.007, DESK.z - 0.35); group.add(under);
  const sign = plate(); sign.position.set((HINGE + OUTER) / 2, 1.5, FRONT + 0.006); group.add(sign);
  const vanity = createVanity({ top: desk.solids[0].max.y }); group.add(vanity.group);
  group.updateMatrixWorld(true);

  const texture = canvasTexture(SCREEN_W, SCREEN_H, (g, w, h) => { g.fillStyle = '#0d0e12'; g.fillRect(0, 0, w, h); });
  // The glass shows its own texture, not a cell of the shared page (screens.js): sitting down brings the camera right up to it,
  // so createBossDesk draws your desktop far sharper than a cell's SCREEN_W. The bezel just behind takes the clicks.
  const face = new THREE.Mesh(new THREE.PlaneGeometry(GLASS_W, GLASS_H), new THREE.MeshBasicMaterial({ map: texture }));
  face.raycast = () => {}; desk.screen.add(face);
  const colliders = [...boxes.walls, ...desk.solids.map(box => box.clone().applyMatrix4(desk.group.matrixWorld)), ...vanity.colliders];

  let t = 0;
  const swing = open => { leaf.rotation.y = -open * open * (3 - 2 * open) * SWUNG; };
  const refresh = () => { office.flight = t > 0 ? [] : [boxes.door]; onMove?.(); };
  const office = {
    group, inside: bossInside, colliders, lintels: [boxes.lintel], flight: [boxes.door],
    screen: desk.screen, texture, chair: desk.chair, monitor: desk.monitor, desk,
    statue: vanity.statue, vanity: vanity.texture, dress: vanity.dress,
    // Each frame, with where you stand and where the others at a meeting are: open for anyone near or inside, at once when
    // `still`; drawn shut in the overview, which looks down on it.
    update(dt, at, still, overview, others = []) {
      const near = p => bossInside(p) || Math.hypot(p.x - DOOR_X, p.z - GLASS) < (t > 0 ? DOOR_FAR : DOOR_NEAR);
      const goal = near(at) || others.some(near) ? 1 : 0, was = t;
      if (t !== goal) t = still ? goal : THREE.MathUtils.clamp(t + (goal ? dt : -dt) / MOVE, 0, 1);
      if ((was === 0) !== (t === 0)) refresh();
      swing(overview < 0.01 ? t : 0);
    },
  };
  return office;
}

// The monitor's glass in its anchor's frame (room.js shows every monitor's at 0.54 × 0.32); the boss's is DESK.monitor times that.
const GLASS_W = 0.54, GLASS_H = 0.32, DISTANCE = 0.75, FILL = 0.92;
// The vertical fov that shows a w × h screen from `distance` filling FILL of the view across or down, whichever's tighter.
export const fitFov = (aspect, distance, w = GLASS_W * DESK.monitor, h = GLASS_H * DESK.monitor) => 2 * THREE.MathUtils.radToDeg(Math.atan(Math.max(h, w / aspect) / FILL / 2 / distance));
const seedOf = id => { let h = 0x811c9dc5; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193); return h >>> 0; };

// Sitting at the boss desk (office.js): the camera comes in square to the monitor, and once it's there the desktop (desktop.js)
// is laid over the monitor's glass on screen, so its buttons and the cart's frame take the clicks and keys. Every key's the
// desk's but Esc; no blur, for the cart's frame taking focus blurs the window. The rest of the time the monitor shows the same
// desktop drawn (desktop.view()) as you left it, or v1's generic one with a friend's made-up game (fakeCart) while they sit there.
// It's drawn only when it can be seen: never under the laid-over desktop, once as that's taken down or you stand up, and
// otherwise on a change (version(), or a font loading) or the minute's turn while it's in view. `now`: Date.now, for the clock.
export function createBossDesk({ annex, desktop, camera, fonts = document.fonts, now = () => Date.now() }) {
  const canvas = annex.texture.image, g = canvas.getContext('2d'), pose = { from: new THREE.Vector3(), look: new THREE.Vector3(), fov: camera.fov, hands: false };
  const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => ({ local: new THREE.Vector3(x * GLASS_W / 2, y * GLASS_H / 2, 0), at: new THREE.Vector3(), css: { x: 0, y: 0 } }));
  let seated = false, shown = false, t = 0, look = 0, mode = null, minute = -1;
  // `paint(clock)` draws one picture, `scale` times LAYOUT. A new size is a new texture on the GPU, so the old one's let go.
  const draw = (paint, scale) => {
    const w = Math.round(LAYOUT.w * scale), h = Math.round(LAYOUT.h * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; annex.texture.dispose(); }
    g.save(); g.setTransform(scale, 0, 0, scale, 0, 0); paint(clockOf(new Date(now()))); g.restore();
    annex.texture.needsUpdate = true;
  };
  // Your desktop gets as many pixels as the glass covers once you're seated (FILL of the view across or down, in the renderer's
  // own pixels), at most twice LAYOUT, so the camera coming in shows it sharp. A friend's game, drawn ten times a second, is
  // SCREEN_W wide like every other monitor.
  const SMALL = SCREEN_W / LAYOUT.w;
  const sharp = () => { const { width = 0, height = 0 } = camera.userData.canvas; return Math.min(2, Math.max(SMALL, FILL * Math.min(width, height * LAYOUT.w / LAYOUT.h) / LAYOUT.w)); };
  const mine = clock => drawDesktop(g, desktop.view(), { clock, image: desktop.image });
  const theirs = (friend, at) => clock => drawGeneric(g, { window: 'pico', cart: friend, start: false }, { clock, game: fakeCart(seedOf(friend), at) });
  // The desktop as it is now, and what it was drawn at.
  const drawMine = () => { draw(mine, sharp()); mode = `mine ${desktop.version()}`; minute = Math.floor(now() / 60_000); };
  // Silkscreen (the generic desktop's font) loading only makes the picture stale: the next update that can see it draws it again.
  fonts?.load('16px Silkscreen').then(() => { mode = null; }, () => {});
  const place = () => {
    const { clientWidth: w, clientHeight: h } = camera.userData.canvas;
    annex.screen.updateWorldMatrix(true, false); camera.updateMatrixWorld();
    for (const c of corners) { c.at.copy(c.local).applyMatrix4(annex.screen.matrixWorld).project(camera); c.css.x = (c.at.x + 1) / 2 * w; c.css.y = (1 - c.at.y) / 2 * h; }
    desktop.place(corners.map(c => c.css));
  };

  return {
    exact: true, // you sit at the stand spot itself, where friends at a meeting look for you (seatedAtBoss)
    stand: () => STAND,
    pose() {
      annex.screen.updateWorldMatrix(true, false);
      const m = annex.screen.matrixWorld;
      pose.look.setFromMatrixPosition(m); pose.from.setFromMatrixColumn(m, 2).normalize().multiplyScalar(DISTANCE).add(pose.look);
      pose.fov = fitFov(camera.aspect, DISTANCE); // read each time, so a resize refits
      return pose;
    },
    enter() { seated = true; },
    // Taking the desktop down takes the cart's frame out of the page, which stops it and its sound.
    leave() { seated = shown = false; desktop.hide(); drawMine(); },
    // The keys that would stand you up or click (player.js's gameKey) are kept, so they don't; Esc stands you up, and the browser's own keys are the browser's.
    key: code => /^(Key[WASDE]|Arrow\w+|Space)$/.test(code),
    click: () => false,
    // Each frame, once the camera's placed. `arrived`: the camera's all the way in (not the overview, not on its way in or out).
    // `friend`: who's sitting here at a meeting, or null. `still`: reduced motion, so a friend's game stands still.
    update(dt, { still, friend, arrived }) {
      t += dt;
      // Seated with the camera in, the desktop's laid over the monitor: nothing's drawn under it. Taken down, it's drawn as left.
      if (seated && arrived) { place(); shown = true; return; }
      if (shown) { shown = false; desktop.hide(); drawMine(); return; }
      const visitor = !seated && friend, turned = Math.floor(now() / 60_000);
      const next = visitor ? `${friend} ${still ? 0 : Math.floor(t * 10)}` : `mine ${desktop.version()}`;
      if (next === mode && turned === minute) return;
      // A look ten times a second at most.
      if (t < look) return;
      look = t + 0.1; camera.updateMatrixWorld(); if (!viewTest(camera)(annex.screen)) return;
      if (!visitor) { drawMine(); return; }
      draw(theirs(friend, still ? 0 : t), SMALL); mode = next; minute = turned;
    },
  };
}
