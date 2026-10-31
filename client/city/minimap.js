// The sidebar's site plan: the real island, roads and lots from the camera's angle, each session's tower on its own lot, and a box round what the camera sees.
import { screen, annexAt, lotAt, unproject, LOT, ROAD, WALK } from './plan.js';
import { hex } from './palette.js';
import { LAND, LAND_EAST, LAND_FAR, lotLook, reachOf, soilOf } from './ground.js';

export const MAP_PX = 2;
const SEA = hex('#0b5e65'), RIPPLE = hex('#0b8a8f'), SAND = hex('#c9a98e'), TARMAC = hex('#2e222f'), POND = hex('#0b8a8f'), PAVED = hex('#7f5f5a'), PLANT = hex('#9babb2'), INK = hex('#2e222f');
const SHORE = 12, KERB = 7, DIM = .5, ASLEEP = .72, ANNEX_H = 2, ANNEX_W = 2, TOWER_W = 4, MIN_H = 2, MAX_H = 7, PLANT_W = 3;
const blend = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const riseOf = storeys => Math.max(MIN_H, Math.min(MAX_H, Math.round(storeys * .6) + 1));

export function mapFit(plan, view, width, height) {
  const { w, d } = plan.bounds, at = [[-LAND, -LAND], [w + LAND_EAST, -LAND], [-LAND, d + LAND_FAR], [w + LAND_EAST, d + LAND_FAR]].map(([x, z]) => screen(x, z, view));
  const xs = at.map(p => p[0]), ys = at.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const scale = Math.min(width / (x1 - x0), height / (y1 - y0));
  return { scale, ox: (width - (x0 + x1) * scale) / 2, oy: (height - (y0 + y1) * scale) / 2 };
}
const toMap = (fit, x, z, view) => { const [sx, sy] = screen(x, z, view); return [Math.round(sx * fit.scale + fit.ox), Math.round(sy * fit.scale + fit.oy)]; };

// Where each session stands, in map pixels: the foot of its tower.
export function mapSites(plan, view, fit) {
  const sites = new Map();
  for (const building of plan.buildings) {
    sites.set(building.id, toMap(fit, building.x, building.z, view));
    building.subagents.forEach((kid, i) => { const { x, z } = annexAt(building, i, view); sites.set(kid.id, toMap(fit, x, z, view)); });
  }
  return sites;
}

const litTest = lit => lit == null ? null : typeof lit === 'string' ? key => key === lit : key => lit.has(key);

// Pure: lit is a neighbourhood's key or a set of them, and everything else dims as it does on the map itself.
export function mapPicture(plan, view, width, height, fit, { asleep = () => false, lit = null, time = 'day' } = {}) {
  const rgba = new Uint8ClampedArray(width * height * 4), { w: W, d: D } = plan.bounds, reach = reachOf(W, D), isLit = litTest(lit), { land: GRASS, tuft: VACANT } = soilOf(time);
  const inRoad = (v, list) => list.some(r => v >= r - WALK && v < r + ROAD + WALK);
  const ownerOf = new Map(plan.buildings.map(building => [`${building.hoodKey}:${building.slot}`, building.id]));
  const groundAt = (x, z) => {
    const past = reach(x, z);
    if (past >= SHORE) return Math.floor(past) % 11 === 0 && Math.floor(x + z) % 37 < 12 ? RIPPLE : SEA;
    if (past >= 0) return SAND;
    if (x < 0 || z < 0 || x >= W || z >= D) return GRASS;
    if (inRoad(x, plan.roads.xs) || inRoad(z, plan.roads.zs)) return TARMAC;
    const lot = lotAt(plan, x, z);
    if (lot) {
      const owner = ownerOf.get(lot.key);
      if (!owner) return VACANT;
      const look = lotLook(owner);
      return Math.max(Math.abs(x - lot.x), Math.abs(z - lot.z)) > LOT / 2 - KERB ? look.kerb : look.a;
    }
    const parcel = plan.parcels.find(p => x >= p.x && z >= p.z && x < p.x + p.w && z < p.z + p.d);
    return !parcel || parcel.kind === 'park' ? GRASS : parcel.kind === 'pond' ? POND : PAVED;
  };
  const hoodAt = (x, z) => plan.hoods.find(hood => x >= hood.x && z >= hood.z && x < hood.x + hood.cols * LOT && z < hood.z + 2 * LOT);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const i = (y * width + x) * 4; rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; };
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const [x, z] = unproject((px + .5 - fit.ox) / fit.scale, (py + .5 - fit.oy) / fit.scale, view), c = groundAt(x, z);
    put(px, py, isLit && !isLit(hoodAt(x, z)?.key) ? blend(c, INK, DIM) : c);
  }
  // Nearest last, so that a tower stands in front of the one behind it.
  const pieces = [];
  for (const plant of plan.plants) { const [x, y] = toMap(fit, plant.x, plant.z, view); pieces.push({ y, draw: () => { for (let a = 0; a < PLANT_W; a++) for (let b = 0; b < PLANT_W; b++) put(x - 1 + a, y - b, plant.connected ? PLANT : TARMAC); } }); }
  const column = (cx, foot, w, h, colour, dim) => {
    let face = colour;
    if (dim) face = blend(face, INK, DIM);
    const shade = blend(face, INK, .3), roof = blend(face, [255, 255, 255], .4), left = cx - w / 2;
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) put(left + a, foot - 1 - b, b === h - 1 ? roof : a < w / 2 ? face : shade);
  };
  for (const building of plan.buildings) {
    const colour = hex(building.look.colour), dim = isLit && !isLit(building.hoodKey), tone = id => asleep(id) ? blend(colour, INK, ASLEEP) : colour, [x, y] = toMap(fit, building.x, building.z, view);
    pieces.push({ y, draw: () => column(x, y, TOWER_W, riseOf(building.storeys), tone(building.id), dim) });
    building.subagents.forEach((kid, i) => { const spot = annexAt(building, i, view), [kx, ky] = toMap(fit, spot.x, spot.z, view); pieces.push({ y: ky, draw: () => column(kx, ky, ANNEX_W, ANNEX_H, tone(kid.id), dim) }); });
  }
  pieces.sort((a, b) => a.y - b.y).forEach(piece => piece.draw());
  return rgba;
}

// What the camera sees, in CSS pixels on the map, stepped like everything else on it.
export function mapView(fit, eye, boxW, boxH) {
  const whole = v => Math.round(v / MAP_PX) * MAP_PX, across = boxW / eye.r, down = boxH / eye.r;
  return { x: whole(((eye.cx - across / 2) * fit.scale + fit.ox) * MAP_PX), y: whole(((eye.cy - down / 2) * fit.scale + fit.oy) * MAP_PX), w: whole(across * fit.scale * MAP_PX), h: whole(down * fit.scale * MAP_PX) };
}
export const mapToScreen = (fit, x, y) => [(x / MAP_PX - fit.ox) / fit.scale, (y / MAP_PX - fit.oy) / fit.scale];

// ---- On the page.
const maps = new WeakMap();
const mapOf = el => {
  let map = maps.get(el);
  if (map) return map;
  const canvas = document.createElement('canvas'), box = document.createElement('span');
  canvas.className = 'city-map'; canvas.setAttribute('aria-hidden', 'true');
  box.className = 'city-view'; box.setAttribute('aria-hidden', 'true');
  el.prepend(canvas); el.append(box);
  map = { canvas, box, ctx: canvas.getContext('2d'), key: '', fit: null, sites: new Map(), view: '' };
  maps.set(el, map);
  return map;
};

// A contact is the map's button for a session: on its building, and gone if nothing's standing for it.
export function placeContacts(el) {
  const map = maps.get(el);
  if (!map) return;
  for (const contact of el.querySelectorAll('.console-contact')) {
    const site = map.sites.get(contact.dataset.sessionId);
    contact.toggleAttribute('data-unsited', !site);
    if (!site) continue;
    contact.style.setProperty('--site-x', `${site[0] * MAP_PX}px`); contact.style.setProperty('--site-y', `${site[1] * MAP_PX}px`);
  }
}

// False while the map isn't on the page: there's nothing to fit it to.
export function paintMap(el, plan, view, options = {}) {
  const width = Math.floor(el.clientWidth / MAP_PX), height = Math.floor(el.clientHeight / MAP_PX);
  if (!width || !height) return false;
  const map = mapOf(el), { asleep = () => false, lit = null, time = 'day' } = options, isLit = litTest(lit);
  const key = JSON.stringify([view, time, width, height, plan.bounds, plan.hoods.map(hood => [hood.key, hood.name, isLit ? isLit(hood.key) : 0]), plan.plants.map(plant => [plant.key, plant.connected]), plan.buildings.map(building => [building.id, building.slot, building.x, building.z, building.storeys, building.look.colour, asleep(building.id), building.subagents.map(kid => [kid.id, asleep(kid.id)])])]);
  if (key !== map.key) {
    map.key = key; map.fit = mapFit(plan, view, width, height); map.sites = mapSites(plan, view, map.fit);
    map.canvas.width = width; map.canvas.height = height;
    map.ctx.putImageData(new ImageData(mapPicture(plan, view, width, height, map.fit, options), width, height), 0, 0);
    el.setAttribute('data-mapped', '');
  }
  placeContacts(el);
  return true;
}

export function trackMap(el, eye, boxW, boxH) {
  const map = maps.get(el);
  if (!map?.fit) return;
  const { x, y, w, h } = mapView(map.fit, eye, boxW, boxH), view = `${x},${y},${w},${h}`;
  if (view === map.view) return;
  map.view = view;
  map.box.style.transform = `translate(${x}px, ${y}px)`; map.box.style.width = `${w}px`; map.box.style.height = `${h}px`;
}

// Press to go there, drag to keep going. A press on a building's contact is for opening it, so it stays a press.
export function steerMap(el, onLook) {
  let held = null;
  const spot = event => { const rect = el.getBoundingClientRect(), fit = maps.get(el)?.fit; return fit && mapToScreen(fit, event.clientX - rect.left - el.clientLeft, event.clientY - rect.top - el.clientTop); };
  const down = event => {
    if (event.button !== 0 || event.target.closest?.('.console-contact')) return;
    const at = spot(event);
    if (!at) return;
    held = event.pointerId; el.setPointerCapture?.(held); onLook(at[0], at[1], false);
  };
  const move = event => { if (event.pointerId !== held) return; const at = spot(event); if (at) onLook(at[0], at[1], true); };
  const up = event => { if (event.pointerId === held) held = null; };
  el.toggleAttribute('data-live', true);
  el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  return () => {
    el.removeAttribute('data-live'); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    const map = maps.get(el); if (map) map.view = '';
  };
}
