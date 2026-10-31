// The overview (Tab): every station's screen at once, as big as they fit, over the dimmed room. The screens are the stations' own canvases,
// so they show what the room shows, up to date. Fastened to the camera and laid out in pixels; a screen is framed in its session's signal.
import * as THREE from 'three';
import { DISPLAY } from './deck.js';
import { font } from './displays.js';
import { SIGNALS } from './palettes.js';

// The top is left to the buttons over the scene.
export const BOARD_TOP = 56;
const EDGE = 8, GAP = 8, FRAME = 3, SHAPE = DISPLAY.width / DISPLAY.height, DEPTH = .6, FADE = .16, DIM = .72;

// Each screen's size and middle, in pixels from the middle of the view with y up, in the order given: whichever number of columns makes them biggest.
export function boardLayout(count, W, H) {
  if (!count) return [];
  const tall = H - BOARD_TOP - EDGE;
  let best = { height: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols), height = Math.min((tall - (rows - 1) * GAP) / rows, ((W - 2 * EDGE - (cols - 1) * GAP) / cols) / SHAPE);
    if (height > best.height) best = { cols, rows, height };
  }
  const { cols, rows, height } = best, width = height * SHAPE, top = H / 2 - BOARD_TOP - (tall - rows * height - (rows - 1) * GAP) / 2;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols), inRow = row < rows - 1 ? cols : count - row * cols, column = i - row * cols;
    return { x: (column - (inRow - 1) / 2) * (width + GAP), y: top - height / 2 - row * (height + GAP), width, height };
  });
}

export function createBoard(camera, stations, still) {
  const group = new THREE.Group(); group.position.z = -DEPTH; group.visible = false; camera.add(group);
  const unit = new THREE.PlaneGeometry(1, 1), plain = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false };
  const mesh = (material, order) => { const out = new THREE.Mesh(unit, material); out.renderOrder = order; out.visible = false; group.add(out); return out; };
  const backdrop = mesh(new THREE.MeshBasicMaterial({ ...plain, color: '#03050f' }), 12); backdrop.visible = true;
  const cards = stations.map(({ mesh: screen }) => ({ frame: mesh(new THREE.MeshBasicMaterial({ ...plain }), 13), screen: mesh(new THREE.MeshBasicMaterial({ ...plain, map: screen.material.map }), 14) }));

  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const empty = mesh(new THREE.MeshBasicMaterial({ ...plain, map: new THREE.CanvasTexture(canvas) }), 14);
  function drawEmpty() {
    const g = canvas.getContext('2d'); g.clearRect(0, 0, 512, 96); g.fillStyle = SIGNALS.idle; g.font = font(700, 56); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NO SESSIONS', 256, 50);
    empty.material.map.needsUpdate = true;
  }

  let on = false, amount = 0, shown = [], key = '';
  function lay(W, H, px) {
    group.scale.setScalar(px); backdrop.scale.set(W + 2, H + 2, 1);
    const places = boardLayout(shown.length, W, H);
    cards.forEach(({ frame, screen }) => { frame.visible = screen.visible = false; });
    shown.forEach(({ index, status }, i) => {
      const { x, y, width, height } = places[i], { frame, screen } = cards[index];
      screen.position.set(x, y, 0); screen.scale.set(width, height, 1); screen.visible = true;
      frame.position.set(x, y, 0); frame.scale.set(width + 2 * FRAME, height + 2 * FRAME, 1); frame.visible = true; frame.material.color.set(SIGNALS[status] || SIGNALS.idle);
    });
    empty.visible = !shown.length; if (empty.visible) { drawEmpty(); empty.scale.set(Math.min(W - 2 * EDGE, 320), Math.min(W - 2 * EDGE, 320) * 96 / 512, 1); }
  }
  return {
    get open() { return on; },
    show(next) { on = next; },
    // Who's on it: { index, id, status } in station order.
    fill(next) { const nextKey = JSON.stringify(next); if (nextKey !== JSON.stringify(shown)) { shown = next; key = ''; } },
    // The session under the ray, as its screen, or null.
    at(ray) {
      if (!on) return null;
      const hit = ray.intersectObjects(shown.map(({ index }) => cards[index].screen), false)[0];
      return hit ? { object: hit.object, id: shown.find(({ index }) => cards[index].screen === hit.object).id } : null;
    },
    tick(dt, W, H) {
      amount = still ? +on : THREE.MathUtils.clamp(amount + (on ? dt : -dt) / FADE, 0, 1);
      group.visible = amount > 0; if (!amount) return;
      const nextKey = `${W},${H},${camera.fov}`;
      if (nextKey !== key) { key = nextKey; lay(W, H, 2 * DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / H); }
      backdrop.material.opacity = amount * DIM;
      for (const { frame, screen } of cards) { frame.material.opacity = screen.material.opacity = amount; }
      empty.material.opacity = amount;
    },
  };
}
