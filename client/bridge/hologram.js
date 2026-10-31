// A hologram that opens over a projector on the bridge: a title and rows you can click, on a panel that turns to face you.
import * as THREE from 'three';
import { rectCorners } from './brackets.js';
import { fitText, font } from './displays.js';

const PADDING = 22, TITLE = 70, ROW = 70, GAP = 8, UNFOLD = .22, REACH = 3.2;
export function hologramLayout(count, width, height) {
  const fits = Math.floor((height - TITLE - PADDING + GAP) / (ROW + GAP)), rows = [];
  for (let i = 0; i < Math.min(count, fits); i++) rows.push({ x: PADDING, y: TITLE + i * (ROW + GAP), width: width - 2 * PADDING, height: ROW });
  return { width, height, top: TITLE, rows };
}
// The panel that lists every session: as many rows as there are stations, and all of it in view from the chair.
export const ROSTER = { width: .6, height: 1.015 };
// A highlight stays on its row when the list reorders, and goes with it.
export const carryHover = (before, hovered, after) => hovered < 0 ? -1 : after.findIndex(({ id }) => id === before[hovered]?.id);
// Where a panel opens, in the camera's space, given how far the view reaches each way at its depth, and how big. Where it was put, if
// that's in view; just inside the edge if not; and in the middle where it can't sit to one side of it at all (a narrow window).
// On a phone it's in the middle regardless, square on to you, and grown to fill as much of the view as its shape lets it.
const MARGIN = .04, FILL = .9;
export function fitPanel(x, y, width, height, reachX, reachY, phone = false) {
  if (phone) return { x: 0, y: 0, size: Math.min(FILL * 2 * reachX / width, FILL * 2 * reachY / height) };
  const roomX = reachX - width / 2 - MARGIN, roomY = Math.max(0, reachY - height / 2 - MARGIN);
  return { x: roomX < width / 2 ? 0 : THREE.MathUtils.clamp(x, -roomX, roomX), y: THREE.MathUtils.clamp(y, -roomY, roomY), size: 1 };
}
// The row at a point on the panel (u and v as in a texture, v running up), or -1.
export function rowAt(layout, u, v) {
  const x = u * layout.width, y = (1 - v) * layout.height;
  return layout.rows.findIndex(row => x >= row.x && x <= row.x + row.width && y >= row.y && y <= row.y + row.height);
}

const beamMap = () => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d'), fade = g.createLinearGradient(0, 0, 0, 64); fade.addColorStop(0, '#000'); fade.addColorStop(1, '#777');
  g.fillStyle = fade; g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
};
const rounded = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

// `from` is the projector, `at` the panel's centre, both in `parent`'s space. Rows are { id, label, swatch: [colours], on }.
export function createHologram(parent, { from, at, width = .78, height = .6, phone = () => false, still }) {
  const W = 512, H = Math.round(W * height / width), canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), map = new THREE.CanvasTexture(canvas);
  // Over anything nearer, or the chair's arms would cut into it.
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: .94, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
  const group = new THREE.Group(); group.position.copy(at); group.visible = false; parent.add(group);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material); plane.renderOrder = 6; group.add(plane);
  const glow = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false };
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(width, height * .03), new THREE.MeshBasicMaterial({ ...glow, depthTest: false, opacity: .22 })); sweep.position.z = .002; sweep.renderOrder = 7; sweep.visible = !still; group.add(sweep);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(width * .34, .025, 1, 18, 1, true), new THREE.MeshBasicMaterial({ ...glow, map: beamMap(), side: THREE.DoubleSide }));
  beam.visible = false; beam.renderOrder = 5; parent.add(beam);
  const up = new THREE.Vector3(0, 1, 0), reach = new THREE.Vector3(), spot = new THREE.Vector3();
  const shine = () => { reach.copy(group.position).sub(from); beam.position.copy(from).addScaledVector(reach, .5); beam.scale.y = reach.length(); beam.quaternion.setFromUnitVectors(up, reach.normalize()); };
  shine();
  // Fitted to the view it opens in, and again if that changes shape (a phone turned). It then stays put as you look around.
  function fit(camera) {
    camera.updateWorldMatrix(true, false); camera.worldToLocal(parent.localToWorld(spot.copy(at)));
    const depth = -spot.z, high = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth;
    if (depth > .2) { const { x, y, size: fitSize } = fitPanel(spot.x, spot.y, width, height, high * camera.aspect, high, phone()); spot.x = x; spot.y = y; size = fitSize; }
    group.position.copy(parent.worldToLocal(camera.localToWorld(spot))); beam.scale.x = beam.scale.z = size; shine();
  }

  let open = false, amount = 0, fitted = 0, size = 1, title = '', rows = [], hovered = -1, tint = '#6a8cff', text = '#e4eaff', layout = hologramLayout(0, W, H), drawn = '';
  function draw() {
    const signature = JSON.stringify([title, rows, hovered, tint, text]); if (signature === drawn) return; drawn = signature;
    g.clearRect(0, 0, W, H);
    const bottom = layout.rows.length ? layout.rows.at(-1).y + ROW + PADDING : TITLE + PADDING;
    rounded(g, 3, 3, W - 6, bottom - 6, 10); g.fillStyle = 'rgba(5,9,34,.9)'; g.fill();
    g.strokeStyle = tint; g.lineWidth = 3; g.stroke();
    g.fillStyle = tint; g.font = font(700, 36); g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(fitText(title, W - 2 * PADDING, s => g.measureText(s).width), PADDING, TITLE / 2 + 2);
    layout.rows.forEach((row, i) => {
      const { swatch = [], label, on } = rows[i], lit = on || i === hovered;
      rounded(g, row.x, row.y, row.width, row.height, 6);
      if (lit) { g.globalAlpha = i === hovered ? .42 : .24; g.fillStyle = tint; g.fill(); g.globalAlpha = 1; }
      g.strokeStyle = tint; g.lineWidth = on ? 3 : 1; g.stroke();
      swatch.forEach((colour, n) => { g.fillStyle = colour; g.fillRect(row.x + 12 + n * 30, row.y + 18, 26, row.height - 36); });
      const left = row.x + 16 + swatch.length * 30 + (swatch.length ? 8 : 0), room = row.x + row.width - left - 12;
      g.fillStyle = text; g.font = font(600, 34); g.fillText(fitText(label, room, s => g.measureText(s).width), left, row.y + row.height / 2 + 2);
    });
    // Scan lines cut through it, so it reads as light rather than as a screen.
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.2)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    g.globalCompositeOperation = 'source-over';
    map.needsUpdate = true;
  }
  const point = new THREE.Vector3(), eye = new THREE.Vector3();
  return {
    get open() { return open; },
    show(nextTitle, nextRows) { hovered = carryHover(rows, hovered, nextRows); title = nextTitle; rows = nextRows; layout = hologramLayout(rows.length, W, H); open = true; draw(); },
    hide() { open = false; if (hovered !== -1) { hovered = -1; draw(); } },
    // What's under the ray: null off the panel, otherwise the row (undefined between rows).
    at(ray) {
      if (!open || !group.visible) return null;
      const hit = ray.intersectObject(plane)[0]; if (!hit) return null;
      const index = rowAt(layout, hit.uv.x, hit.uv.y);
      // The panel's unused lower part is empty space.
      if (index < 0 && (1 - hit.uv.y) * H > (layout.rows.length ? layout.rows.at(-1).y + ROW + PADDING : TITLE + PADDING)) return null;
      return { row: rows[index] };
    },
    // Where a row is in the world.
    rowCorners(row) { const { x, y, width: w, height: h } = layout.rows[rows.indexOf(row)]; return rectCorners(plane, { x, y, w, h }, W, H); },
    hover(row) { const next = row ? rows.indexOf(row) : -1; if (next !== hovered) { hovered = next; draw(); } },
    paint(colour, label) { tint = colour; text = label; sweep.material.color.set(colour); beam.material.color.set(colour); draw(); },
    tick(dt, t, camera) {
      if (open && group.getWorldPosition(point).distanceTo(camera.getWorldPosition(eye)) > REACH) open = false;
      if (!open) fitted = 0; else if (fitted !== camera.aspect) { fitted = camera.aspect; fit(camera); }
      amount = still ? +open : THREE.MathUtils.clamp(amount + (open ? dt : -dt) / UNFOLD, 0, 1);
      group.visible = beam.visible = amount > 0; if (!amount) return;
      group.lookAt(camera.getWorldPosition(eye)); group.scale.set(size, size * Math.sin(amount * Math.PI / 2), 1);
      if (still) return;
      sweep.position.y = height * (.5 - (t * .35 % 1));
    },
  };
}
