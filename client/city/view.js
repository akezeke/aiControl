// The camera, and getting between world, art pixels and the canvas. Art pixels are always whole device pixels. Pure.
import { screen, LOT } from './plan.js';

export const ZOOMS = [1, 2, 3, 4];
const PHONE = 700, HEIGHT = 40, PHONE_STEP = 2, KEEP = 40;

export function fitCanvas(cssW, cssH, dpr, step) {
  const ratio = dpr > 0 ? dpr : 1, scale = Math.max(1, Math.ceil(step * ratio - .5)), art = css => Math.max(1, Math.floor((css || 0) * ratio / scale)), width = art(cssW), height = art(cssH);
  return { scale, width, height, cssW: width * scale / ratio, cssH: height * scale / ratio };
}

const boxOf = (points, view, heights) => {
  const at = points.map(([x, z]) => screen(x, z, view)), xs = at.map(p => p[0]), ys = at.map(p => p[1]);
  return { x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)) - heights, x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)) };
};
export function cityBox(plan, view, heights = HEIGHT) {
  const { w, d } = plan.bounds;
  return boxOf([[0, 0], [w, 0], [0, d], [w, d], ...plan.plants.map(plant => [plant.x, plant.z])], view, heights);
}
export function fitStep(box, cssW, cssH, dpr) {
  const needW = box.x1 - box.x0, needH = box.y1 - box.y0;
  // Not fitCanvas's width: a box with no size yet holds nothing, though its canvas is at least a pixel.
  for (const step of [...ZOOMS].reverse()) { const { scale } = fitCanvas(cssW, cssH, dpr, step), ratio = dpr > 0 ? dpr : 1; if ((cssW || 0) * ratio / scale >= needW && (cssH || 0) * ratio / scale >= needH) return step; }
  return ZOOMS[0];
}
const centre = box => ({ cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 });
const hoodMiddle = (hood, view) => { const [cx, cy] = screen(hood.x + hood.cols * LOT / 2, hood.z + LOT, view); return { cx, cy }; };

export function startCamera(plan, view, cssW, cssH, dpr, focusKey) {
  const box = cityBox(plan, view);
  if (cssW < PHONE) {
    const hood = plan.hoods.find(h => h.key === focusKey) || plan.hoods[0];
    return { ...hood ? hoodMiddle(hood, view) : centre(box), step: PHONE_STEP };
  }
  return { ...centre(box), step: fitStep(box, cssW, cssH, dpr) };
}
export function focusHood(plan, hood, view, cssW, cssH, dpr) {
  const w = hood.cols * LOT, box = boxOf([[hood.x, hood.z], [hood.x + w, hood.z], [hood.x, hood.z + 2 * LOT], [hood.x + w, hood.z + 2 * LOT]], view, HEIGHT);
  return { ...hoodMiddle(hood, view), step: fitStep(box, cssW, cssH, dpr) };
}

// Whatever's standing on these spots, each with its lot's room around it.
export function focusBuildings(buildings, view, cssW, cssH, dpr) {
  const box = boxOf(buildings.flatMap(({ x, z }) => [[x - LOT / 2, z - LOT / 2], [x + LOT / 2, z - LOT / 2], [x - LOT / 2, z + LOT / 2], [x + LOT / 2, z + LOT / 2]]), view, HEIGHT);
  return { ...centre(box), step: fitStep(box, cssW, cssH, dpr) };
}

// The offset is whole, so every sprite moves by the same whole pixels as the camera pans.
const offset = (camera, size) => [Math.round(size.width / 2 - camera.cx), Math.round(size.height / 2 - camera.cy)];
export function toCanvas(camera, size, sx, sy) { const [ox, oy] = offset(camera, size); return [Math.round(sx) + ox, Math.round(sy) + oy]; }
export function fromCanvas(camera, size, px, py) { const [ox, oy] = offset(camera, size); return [px - ox, py - oy]; }
export function clampCamera(camera, box, size) {
  const keepX = Math.min(KEEP, (box.x1 - box.x0) / 2), keepY = Math.min(KEEP, (box.y1 - box.y0) / 2);
  return {
    ...camera,
    cx: Math.min(box.x1 - keepX + size.width / 2, Math.max(box.x0 + keepX - size.width / 2, camera.cx)),
    cy: Math.min(box.y1 - keepY + size.height / 2, Math.max(box.y0 + keepY - size.height / 2, camera.cy)),
  };
}

export function hitSprites(drawn, px, py) {
  for (let i = drawn.length - 1; i >= 0; i--) {
    const item = drawn[i], x = px - item.left, y = py - item.top, { width, height, mask } = item.sprite;
    if (x >= 0 && y >= 0 && x < width && y < height && mask[x + y * width]) return item;
  }
  return null;
}

export function placeBubble(ax, ay, w, h, boxW, boxH, margin = 4) {
  const x = Math.max(margin, Math.min(boxW - w - margin, ax - w / 2)), y = Math.max(margin, Math.min(boxH - h - margin, ay - h));
  return { x, y, tail: Math.max(0, Math.min(w, ax - x)) };
}
