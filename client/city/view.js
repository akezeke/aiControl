// The camera, and getting between world, art pixels and the canvas. Art pixels are always whole device pixels. Pure.
import { screen, LOT } from './plan.js';

export const ZOOMS = [1, 2, 3, 4];
const START_STEP = 2, START_WIDTH = 450, HEIGHT = 40, KEEP = 40;

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

// Toward the middle of the city only as far as it takes to fill the screen. What it was aimed at stays on the screen, since the box holds it.
const fill = (at, lo, hi, size) => hi - lo <= size ? (lo + hi) / 2 : Math.min(hi - size / 2, Math.max(lo + size / 2, at));
// Close enough to know the buildings, whatever the screen: the whole city is one button away.
export function startCamera(plan, view, cssW, cssH, dpr, focusKey) {
  const box = cityBox(plan, view), hood = plan.hoods.find(h => h.key === focusKey) || plan.hoods[0], at = hood ? hoodMiddle(hood, view) : centre(box);
  const step = Math.min(ZOOMS.at(-1), Math.max(START_STEP, Math.floor(cssW / START_WIDTH))), { width, height } = fitCanvas(cssW, cssH, dpr, step);
  return { cx: fill(at.cx, box.x0, box.x1, width), cy: fill(at.cy, box.y0, box.y1, height), step };
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

// ---- The eye: the point of the city at the middle of the box, and CSS pixels per art pixel. It moves freely; the canvas is painted at the
// nearest whole camera and a transform covers the rest, so a pan is smooth, and at a stop the art still sits on whole device pixels.
const ratioOf = dpr => dpr > 0 ? dpr : 1;
export const stopRatio = (step, dpr) => fitCanvas(1, 1, dpr, step).scale / ratioOf(dpr);
// Art pixels past each edge of the box, so that the part-pixel a pan adds never shows the floor.
export const OVERSCAN = 2;
export function overscanned(cssW, cssH, dpr, step) { const r = stopRatio(step, dpr), pad = 2 * OVERSCAN * r; return fitCanvas((cssW || 0) + pad, (cssH || 0) + pad, dpr, step); }
export function baseStep(r, dpr) { return [...ZOOMS].reverse().find(step => stopRatio(step, dpr) <= r) ?? ZOOMS[0]; }
export function eyeOf(camera, cssW, cssH, dpr) {
  const r = stopRatio(camera.step, dpr), size = overscanned(cssW, cssH, dpr, camera.step), [ox, oy] = offset(camera, size);
  return { cx: cssW / 2 / r + OVERSCAN - ox, cy: cssH / 2 / r + OVERSCAN - oy, r };
}
export function cameraFor(eye, cssW, cssH, dpr) {
  const step = baseStep(eye.r, dpr), r = stopRatio(step, dpr), { width, height } = overscanned(cssW, cssH, dpr, step);
  return { cx: Math.round(width / 2) - Math.round(cssW / 2 / r + OVERSCAN - eye.cx), cy: Math.round(height / 2) - Math.round(cssH / 2 / r + OVERSCAN - eye.cy), step };
}
export function canvasTransform(eye, camera, size, cssW, cssH, dpr) {
  const [ox, oy] = offset(camera, size), device = ratioOf(dpr), whole = v => Math.round(v * device) / device;
  return { x: whole(cssW / 2 - (eye.cx + ox) * eye.r), y: whole(cssH / 2 - (eye.cy + oy) * eye.r), s: eye.r / stopRatio(camera.step, dpr) };
}
// Size goes by ratio and position by 1/size, which is what holds a zoom's still point still, even when clamping moved where it ends.
export function between(from, to, t) {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const r = from.r === to.r ? from.r : from.r * (to.r / from.r) ** t, k = from.r === to.r ? t : (1 / r - 1 / from.r) / (1 / to.r - 1 / from.r);
  return { cx: from.cx + (to.cx - from.cx) * k, cy: from.cy + (to.cy - from.cy) * k, r };
}
export function zoomAbout(eye, r, qx, qy, cssW, cssH) {
  const dx = qx - cssW / 2, dy = qy - cssH / 2;
  return { cx: eye.cx + dx / eye.r - dx / r, cy: eye.cy + dy / eye.r - dy / r, r };
}
// Where a pinch comes to rest: ten percent past a stop, in the direction it was going, is enough to mean the next one.
const LEAN = 1.1;
export function settleStep(r, start, dpr) {
  const stops = ZOOMS.map(step => [step, stopRatio(step, dpr)]);
  if (r > start) return (stops.find(([, stop]) => stop >= r / LEAN) ?? stops.at(-1))[0];
  if (r < start) return ([...stops].reverse().find(([, stop]) => stop <= r * LEAN) ?? stops[0])[0];
  return stops.reduce((a, b) => Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a)[0];
}
// How fast a drag was going as it let go, in CSS pixels per ms: nothing if it had stopped first, or was hardly moving.
const FLICK_WINDOW = 90, FLICK_MIN = .12;
export function flickOf(trail, at) {
  const last = trail.at(-1);
  if (!last || at - last[0] >= FLICK_WINDOW) return null;
  const inside = trail.findIndex(([time]) => at - time < FLICK_WINDOW), first = trail[inside === trail.length - 1 ? Math.max(0, inside - 1) : inside];
  if (last[0] === first[0]) return null;
  const vx = (last[1] - first[1]) / (last[0] - first[0]), vy = (last[2] - first[2]) / (last[0] - first[0]);
  return Math.hypot(vx, vy) < FLICK_MIN ? null : { vx, vy };
}
// Where held keys take the eye, in CSS pixels per ms. It goes as soon as a key is down, however long the keyboard waits to repeat, and builds up
// so that a tap is a nudge.
const KEY_SPEED = .6, KEY_START = .3, KEY_BUILD = 220;
export function keyPan(held, heldFor) {
  const x = held.reduce((sum, key) => sum + key[0], 0), y = held.reduce((sum, key) => sum + key[1], 0), length = Math.hypot(x, y);
  if (!length) return null;
  const speed = KEY_SPEED * Math.min(1, KEY_START + (1 - KEY_START) * Math.max(0, heldFor) / KEY_BUILD);
  return { vx: x / length * speed, vy: y / length * speed };
}
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

// The nearest spot for a sign that touches nothing in `taken`, or where it is if there is none. Only a side of something it would touch can be nearest.
export function clearOf(rect, taken, boxW, boxH, gap = 2) {
  const { x, y, w, h } = rect, solid = taken.filter(a => a.w > 0 && a.h > 0);
  const hits = (px, py) => solid.some(a => px < a.x + a.w && px + w > a.x && py < a.y + a.h && py + h > a.y);
  if (!hits(x, y)) return { x, y };
  let best = { x, y }, near = Infinity;
  for (const a of solid) for (const [px, py] of [[x, a.y + a.h + gap], [x, a.y - h - gap], [a.x - w - gap, y], [a.x + a.w + gap, y]]) {
    const cost = Math.abs(px - x) + Math.abs(py - y);
    if (cost < near && px >= 0 && py >= 0 && px + w <= boxW && py + h <= boxH && !hits(px, py)) { best = { x: px, y: py }; near = cost; }
  }
  return best;
}
