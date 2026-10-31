// The City theme: a pixel-art city on a 2D canvas. Every sprite lands on whole art pixels, and art pixels are whole device pixels.
import './city.css';
import { sharedLayout, layoutOffice } from '../office/layout.js';
import { isTypingTarget } from '../office/status.js';
import { officeHasKeys, sceneFocused } from '../scene-keys.js';
import { createCard } from '../scene-ui.js';
import { cityPlan, screen, unproject, annexAt, lotAt, LOT, PLOT } from './plan.js';
import { groundCells, paintGround } from './ground.js';
import { buildTower, annex, coolingPlant, stackPlant } from './generator.js';
import { renderSprite, SpriteCache } from './sprite.js';
import { citySignal } from './signals.js';
import { ZOOMS, fitCanvas, fitStep, cityBox, clampCamera, startCamera, focusHood, toCanvas, fromCanvas, hitSprites } from './view.js';
import { createControls, createLabels } from './labels.js';

const USAGE_LOW = 80, TAG_X = 16, TAG_Y = 6;
const DRAG_SLOP = 6, PAN_KEY = 8, GLIDE_MS = 200, NOTCH = 50, WHEEL_REST = 200, PINCH_IN = 1.4, PINCH_OUT = .7;
const PAN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
const STEP_MS = 125, TWINKLE_MS = 1500, CACHE = 256, FLOOR = '#323353', HIGHLIGHT = { hover: '#f9c22b', selected: '#fbff86', cursor: '#4d9be6' };
// A sprite this far off the canvas can't reach it, so it isn't baked until it might.
const CULL_X = 90, CULL_UP = 40, CULL_DOWN = 170;
const PLANTS = { claude: [coolingPlant, '#e83b3b'], codex: [stackPlant, '#0eaf9b'] };

export function webglAvailable() {
  try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const offset = id => { let hash = 0; for (const c of id) hash = hash * 31 + c.charCodeAt(0) | 0; return Math.abs(hash) % TWINKLE_MS; };
const toImage = ({ width, height, rgba }) => {
  if (!width || !height) return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
};
// What the ground is painted from: anything else in the plan can change without repainting it.
const groundKey = plan => JSON.stringify([plan.bounds, plan.roads, plan.parcels, plan.parks, plan.hoods.map(hood => [hood.key, hood.x, hood.z, hood.cols, hood.lots.map(lot => lot.sessionId ? 1 : 0)])]);

export function mountCity(box, hooks = {}) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('City needs a 2D canvas');
  box.append(canvas);
  ctx.imageSmoothingEnabled = false;

  const sprites = new SpriteCache(CACHE), shown = new Map(), grounds = new Map(), lots = { hover: null, selected: null, cursor: null };
  let snapshot = null, error = '', layout = null, plan = null, sessions = new Map(), cells = null, cellsKey = '';
  let view = 0, camera = null, size = { width: 1, height: 1, scale: 1 }, ratio = 0;
  let raf = 0, timer = 0, dirty = true, lastDrawn = '', failure = null, gone = false, frames = 0, bakeMs = [], groundMs = [];
  let glide = null, drawn = [], selectedHood = null, card = null, labels = null;

  const dpr = () => window.devicePixelRatio || 1;
  const fit = () => {
    if (!camera) return;
    const rect = box.getBoundingClientRect(), next = fitCanvas(rect.width, rect.height, dpr(), camera.step);
    if (next.width === size.width && next.height === size.height && next.scale === size.scale && dpr() === ratio) return;
    size = next; ratio = dpr(); canvas.width = next.width; canvas.height = next.height; canvas.style.width = `${next.cssW}px`; canvas.style.height = `${next.cssH}px`;
    ctx.imageSmoothingEnabled = false; dirty = true;
  };
  const place = () => {
    const { width, height } = box.getBoundingClientRect();
    if (!width || !height || !plan) return;
    const waiting = hooks.nextWaiting?.(), focus = plan.buildings.find(building => building.id === waiting?.id || building.subagents.some(kid => kid.id === waiting?.id))?.hoodKey;
    camera = startCamera(plan, view, width, height, dpr(), focus);
    fit();
  };

  const dimmed = building => !!selectedHood && building.hoodKey !== selectedHood;
  const signalOf = id => {
    const session = sessions.get(id), plant = plan.plants.find(p => p.provider === session?.provider);
    return session ? citySignal(session, { connected: !error && plant?.connected !== false }) : { windows: 'dark', twinkle: false };
  };
  const phaseOf = (id, signal, now) => signal.twinkle && !reducedMotion() ? Math.floor((now + offset(id)) / TWINKLE_MS) % 2 : 0;

  // Everything standing in the city this frame. Nothing here renders: a sprite is only baked if its key isn't cached.
  const standing = now => {
    const items = [], stand = (key, group, x, z, build, opens, dim = false) => { const [sx, sy] = screen(x, z, view); items.push({ key: `${key}|${view}|${dim}`, group, sx, sy, build, opens, dim }); };
    cells.props.forEach(({ stack, x, z }, i) => stand(`prop:${i}:${x}:${z}`, `prop:${i}`, x, z, () => stack));
    for (const { provider, x, z, connected } of plan.plants) {
      const [make, stripe] = PLANTS[provider], on = connected && !error;
      stand(`plant:${provider}|${on}`, `plant:${provider}`, x, z, () => make(stripe, on));
    }
    for (const building of plan.buildings) {
      const signal = signalOf(building.id), { id, look, storeys } = building, { windows } = signal, phase = phaseOf(id, signal, now), dim = dimmed(building);
      stand(`${id}|${storeys}|${windows}|${phase}`, id, building.x, building.z, () => buildTower(look, windows, storeys, phase).stack, id, dim);
      building.subagents.forEach((kid, i) => {
        const at = annexAt(building, i, view), state = signalOf(kid.id);
        stand(`${id}+${i}|${kid.storeys}|${state.windows}|0`, `${id}+${i}`, at.x, at.z, () => annex(look, i, state.windows, kid.storeys).stack, kid.id, dim);
      });
    }
    return items.sort((a, b) => a.sy - b.sy);
  };
  const visible = item => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return x > -CULL_X && x < size.width + CULL_X && y > -CULL_UP && y < size.height + CULL_DOWN; };
  const bake = item => {
    const started = performance.now(), sprite = renderSprite(item.build(), view, { dim: item.dim });
    sprite.image = toImage(sprite); sprite.shadowImage = toImage(sprite.shadow);
    sprites.set(item.key, sprite);
    bakeMs.push(performance.now() - started); if (bakeMs.length > 500) bakeMs.shift();
    return sprite;
  };

  const groundImage = () => {
    let ground = grounds.get(view);
    if (!ground) { const started = performance.now(), painted = paintGround(cells, view); ground = { ...painted, image: toImage(painted) }; grounds.set(view, ground); groundMs.push(performance.now() - started); }
    return ground;
  };
  // A lot's outline, walked on the ground so that it's the same shape in every view.
  const outline = (lot, colour) => {
    const half = LOT / 2 - PLOT;
    ctx.fillStyle = colour;
    for (let i = -half; i <= half; i++) for (const [x, z] of [[lot.x + i, lot.z - half], [lot.x + i, lot.z + half], [lot.x - half, lot.z + i], [lot.x + half, lot.z + i]]) {
      const [sx, sy] = screen(x, z, view), [px, py] = toCanvas(camera, size, sx, sy);
      ctx.fillRect(px, py, 2, 1);
    }
  };
  const lotOf = key => { for (const hood of plan.hoods) for (const lot of hood.lots) if (lot.key === key) return lot; return null; };
  const paint = list => {
    frames++;
    const ground = groundImage(), [gx, gy] = toCanvas(camera, size, 0, 0);
    ctx.fillStyle = FLOOR; ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(ground.image, gx - ground.originX, gy - ground.originY);
    for (const kind of Object.keys(lots)) { const lot = lots[kind] && lotOf(lots[kind]); if (lot) outline(lot, HIGHLIGHT[kind]); }
    const placed = list.map(({ item, sprite }) => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return { sprite, x, y, item, opens: item.opens, left: x - sprite.originX, top: y - sprite.originY }; });
    drawn = placed.filter(item => item.opens);
    syncLabels(placed);
    for (const { sprite, x, y } of placed) if (sprite.shadowImage) ctx.drawImage(sprite.shadowImage, x - sprite.shadow.originX, y - sprite.shadow.originY);
    for (const { sprite, x, y } of placed) if (sprite.image) ctx.drawImage(sprite.image, x - sprite.originX, y - sprite.originY);
  };

  // The DOM over the city, kept in step with whatever was just drawn. The labels only touch what changed.
  const syncLabels = placed => {
    const at = new Map(placed.map(entry => [entry.item.group, entry])), buildingOf = id => plan.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id));
    labels.sync(drawn.map(({ opens: id, sprite, item }) => {
      const session = sessions.get(id);
      return { id, ax: item.sx, ay: item.sy - sprite.originY, bubble: session ? signalOf(id).bubble : null, unread: session && hooks.isUnread?.(session), dim: item.dim };
    }), camera.step);
    // On the project's left-hand corner in this view: its towers and their bubbles rise from the middle of the lots, so a corner stays clear.
    labels.signs(plan.hoods.map(hood => {
      const far = hood.cols * LOT, [ax, ay] = [[hood.x, hood.z], [hood.x + far, hood.z], [hood.x, hood.z + 2 * LOT], [hood.x + far, hood.z + 2 * LOT]].map(([x, z]) => screen(x, z, view)).reduce((a, b) => b[0] < a[0] ? b : a);
      return { key: hood.key, name: hood.name, ax, ay, selected: hood.key === selectedHood };
    }));
    const tags = [];
    for (const building of plan.buildings) {
      if (!building.overflow || !at.has(building.id)) continue;
      const spot = annexAt(building, 2, view), [ax, ay] = screen(spot.x, spot.z, view);
      tags.push({ key: building.id, text: `+${building.overflow}`, title: `${building.overflow} more subagents`, ax: ax + TAG_X, ay: ay - TAG_Y });
    }
    for (const plant of plan.plants) {
      const percent = Math.max(0, ...(snapshot.usage || []).filter(account => account.provider === plant.provider).flatMap(account => (account.windows || []).map(window => window.usedPercent))), spot = at.get(`plant:${plant.provider}`);
      if (percent >= USAGE_LOW && spot) tags.push({ key: plant.provider, text: `${Math.round(percent)}%`, title: `${plant.name} usage near its limit`, ax: spot.item.sx, ay: spot.item.sy - spot.sprite.originY - TAG_Y });
    }
    labels.tags(tags);
    const ratioNow = size.scale / dpr();
    labels.move((sx, sy) => { const [px, py] = toCanvas(camera, size, sx, sy); return [px * ratioNow, py * ratioNow]; }, box.clientWidth, box.clientHeight);
  };

  // One sprite baked per frame at most; until it's ready a building shows what it last looked like.
  const step = now => {
    if (!plan || !camera) return false;
    if (glide) {
      const t = Math.min(1, (now - glide.start) / GLIDE_MS);
      camera = { ...camera, cx: Math.round(glide.from.cx + (glide.to.cx - glide.from.cx) * t), cy: Math.round(glide.from.cy + (glide.to.cy - glide.from.cy) * t) }; dirty = true;
      if (t === 1) glide = null;
    }
    const items = standing(now).filter(visible), ready = [];
    if (items.length * 4 > sprites.max) sprites.max = items.length * 4;
    let baked = false, waiting = false;
    for (const item of items) {
      let sprite = sprites.get(item.key);
      if (!sprite && !baked) { sprite = bake(item); baked = true; } else if (!sprite) waiting = true;
      if (sprite) shown.set(item.group, sprite); else sprite = shown.get(item.group);
      if (sprite) ready.push({ item, sprite });
    }
    const drawing = ready.map(({ item, sprite }) => `${item.key}:${sprite.width}`).join();
    if (dirty || baked || drawing !== lastDrawn) { paint(ready); lastDrawn = drawing; dirty = false; }
    return waiting || baked;
  };
  const moving = () => plan && (glide || !reducedMotion() && plan.buildings.some(building => signalOf(building.id).twinkle));
  const cancel = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = timer = 0; };
  const frame = now => {
    raf = 0;
    if (gone || document.hidden) return;
    try {
      const more = step(now);
      if (more || dirty) schedule(); else if (moving()) timer = setTimeout(() => { timer = 0; schedule(); }, STEP_MS);
    } catch (problem) { failure = problem; } // The next update throws it, and syncScene falls back to the list.
  };
  const schedule = () => { if (!raf && !gone && !document.hidden) raf = requestAnimationFrame(frame); };
  const wake = () => { dirty = true; cancel(); schedule(); };
  const onVisible = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisible);
  const resize = new ResizeObserver(() => { if (camera) { fit(); settle(); } else place(); if (camera) wake(); });
  resize.observe(box);

  // ---- The camera. Everything that moves it goes through here, so it stays in whole art pixels and near the city.
  const settle = () => { camera = clampCamera({ ...camera, cx: Math.round(camera.cx), cy: Math.round(camera.cy) }, cityBox(plan, view), size); };
  const jump = next => { glide = null; camera = { ...camera, ...next }; fit(); settle(); wake(); };
  const glideTo = next => {
    const target = clampCamera({ ...camera, ...next }, cityBox(plan, view), size);
    if (reducedMotion()) { jump(target); return; }
    glide = { from: { cx: camera.cx, cy: camera.cy }, to: target, start: performance.now() }; wake();
  };
  const panBy = (dx, dy) => jump({ cx: camera.cx + dx, cy: camera.cy + dy });
  const artAt = event => { const rect = canvas.getBoundingClientRect(), r = dpr() / size.scale; return [Math.floor((event.clientX - rect.left) * r), Math.floor((event.clientY - rect.top) * r)]; };
  const centreOfBox = () => { const rect = box.getBoundingClientRect(); return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }; };
  // One step, keeping whatever is under the pointer under it.
  const zoom = (dir, at = centreOfBox()) => {
    const step = ZOOMS[ZOOMS.indexOf(camera.step) + dir];
    if (!step) return;
    const [px, py] = artAt(at), [sx, sy] = fromCanvas(camera, size, px, py);
    glide = null; camera = { ...camera, step }; fit();
    const [nx, ny] = artAt(at);
    camera = { ...camera, cx: sx - nx + size.width / 2, cy: sy - ny + size.height / 2 }; settle(); wake();
  };
  const fitCity = () => { const city = cityBox(plan, view), rect = box.getBoundingClientRect(); jump({ cx: (city.x0 + city.x1) / 2, cy: (city.y0 + city.y1) / 2, step: fitStep(city, rect.width, rect.height, dpr()) }); };
  // The same point of the city stays in the middle of the screen.
  const turn = dir => {
    glide = null;
    const [x, z] = unproject(camera.cx, camera.cy, view);
    view = (view + dir + 4) % 4; shown.clear();
    const [cx, cy] = screen(x, z, view); jump({ cx, cy });
  };
  const inView = (x, z) => { const [sx, sy] = screen(x, z, view), [px, py] = toCanvas(camera, size, sx, sy); return px > LOT / 2 && py > LOT && px < size.width - LOT / 2 && py < size.height - LOT / 2; };
  const panToWorld = (x, z) => { const [cx, cy] = screen(x, z, view); glideTo({ cx, cy }); };

  // ---- A chosen project: the rest of the city dims, the camera fits it, and the cursor starts on its first lot.
  const selectHood = key => {
    const hood = plan.hoods.find(h => h.key === key);
    if (!hood || key === selectedHood) { clearHood(); return; }
    selectedHood = key; lots.cursor = hood.lots[0]?.key ?? null;
    const rect = box.getBoundingClientRect(), next = focusHood(plan, hood, view, rect.width, rect.height, dpr());
    if (next.step === camera.step) glideTo(next); else jump(next);
    wake();
  };
  const clearHood = () => { if (selectedHood || lots.cursor) { selectedHood = null; lots.cursor = null; wake(); } };
  const stepHood = dir => {
    const at = plan.hoods.findIndex(h => h.key === selectedHood), count = plan.hoods.length;
    if (count) selectHood(plan.hoods[at < 0 ? (dir > 0 ? 0 : count - 1) : (at + dir + count) % count].key);
  };

  // ---- Picking: sprites front to back, then the ground.
  const pickAt = event => {
    if (!plan || !camera) return null;
    const [px, py] = artAt(event), sprite = hitSprites(drawn, px, py);
    if (sprite) return { id: sprite.opens, lot: null };
    const [sx, sy] = fromCanvas(camera, size, px, py), [x, z] = unproject(sx, sy, view), lot = lotAt(plan, x, z);
    return lot ? { id: lot.sessionId, lot } : null;
  };
  const talkTo = id => {
    const building = id && plan?.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id));
    if (!building) return;
    panToWorld(building.x, building.z); hooks.openPanel?.(id);
  };
  const clickAt = event => { const hit = pickAt(event); if (hit?.id) talkTo(hit.id); };
  const setLot = (kind, key) => { if (lots[kind] !== key) { lots[kind] = key; wake(); } };
  const lotKeyOf = id => { const building = plan.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id)); return building ? plan.hoods.find(h => h.key === building.hoodKey)?.lots[building.slot]?.key : null; };
  const hover = event => {
    const hit = pickAt(event), session = hit?.id ? sessions.get(hit.id) : null;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    setLot('hover', hit?.lot?.key ?? (hit?.id ? lotKeyOf(hit.id) : null));
    card.show(session ? hooks.describe?.(session) ?? null : null); card.move(event);
  };

  // ---- Mouse and touch. A press that doesn't move DRAG_SLOP is a click.
  const pointers = new Map();
  let press = null, pinch = null;
  const onDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, event); glide = null; card.show(null);
    if (pointers.size === 1) press = { x: event.clientX, y: event.clientY, cx: camera?.cx, cy: camera?.cy, dragged: false };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { apart: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }; if (press) press.dragged = true; }
  };
  const onMove = event => {
    if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse' && camera) hover(event); return; }
    pointers.set(event.pointerId, event);
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()], apart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ratio = apart / pinch.apart;
      if (ratio >= PINCH_IN || ratio <= PINCH_OUT) { zoom(ratio > 1 ? 1 : -1, { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }); pinch.apart = apart; }
      return;
    }
    if (!press || !camera) return;
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    if (!press.dragged && Math.hypot(dx, dy) < DRAG_SLOP) return;
    press.dragged = true; canvas.style.cursor = 'grabbing';
    const r = dpr() / size.scale; jump({ cx: press.cx - Math.round(dx * r), cy: press.cy - Math.round(dy * r) });
  };
  const onUp = event => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size) { const [rest] = pointers.values(); press = { x: rest.clientX, y: rest.clientY, cx: camera?.cx, cy: camera?.cy, dragged: true }; return; }
    const clicked = press && !press.dragged && event.type === 'pointerup'; press = null; canvas.style.cursor = 'grab';
    if (clicked) clickAt(event);
  };
  const onLeave = () => { if (!pointers.size) { setLot('hover', null); card.show(null); } };
  let wheelTotal = 0, wheelAt = 0;
  const onWheel = event => {
    event.preventDefault();
    if (!camera) return;
    if (event.timeStamp - wheelAt > WHEEL_REST || Math.sign(wheelTotal) !== Math.sign(event.deltaY)) wheelTotal = 0;
    wheelAt = event.timeStamp; wheelTotal += event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    if (Math.abs(wheelTotal) < NOTCH) return;
    zoom(wheelTotal < 0 ? 1 : -1, event); wheelTotal = 0;
  };

  // ---- Keys, only when nothing else wants them.
  const lotsHere = () => (plan.hoods.find(h => h.key === selectedHood) || plan.hoods[0])?.lots || [];
  const moveCursor = dir => {
    const here = lotsHere(), at = here.findIndex(lot => lot.key === lots.cursor), next = at < 0 ? (dir > 0 ? 0 : here.length - 1) : at + dir;
    // Off either end the cursor lets go, so Tab can still leave the scene for the rest of the page.
    if (next < 0 || next >= here.length) { setLot('cursor', null); return false; }
    setLot('cursor', here[next].key);
    if (!inView(here[next].x, here[next].z)) panToWorld(here[next].x, here[next].z);
    return true;
  };
  const onKey = event => {
    if (!plan || !camera || !officeHasKeys(event)) return;
    if (event.key === 'Tab') { if (sceneFocused(canvas) && moveCursor(event.shiftKey ? -1 : 1)) event.preventDefault(); return; }
    if (event.key === 'Enter') {
      const lot = sceneFocused(canvas) && lots.cursor && lotsHere().find(l => l.key === lots.cursor);
      if (lot?.sessionId) { event.preventDefault(); hooks.openPanel?.(lot.sessionId); }
      return;
    }
    if (isTypingTarget(event.target)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key, pan = PAN_KEYS[key];
    if (pan) panBy(pan[0] * PAN_KEY, pan[1] * PAN_KEY);
    else if (key === '+' || key === '=') zoom(1);
    else if (key === '-' || key === '_') zoom(-1);
    else if (key === 'q') turn(-1);
    else if (key === 'e') turn(1);
    else if (key === 'f') { clearHood(); fitCity(); }
    // By place as well as by character: on many layouts, Swedish for one, [ and ] need AltGr, which reads as Ctrl+Alt.
    else if (key === '[' || event.code === 'BracketLeft') stepHood(-1);
    else if (key === ']' || event.code === 'BracketRight') stepHood(1);
    else if (key === 'Escape') { if (!selectedHood && !lots.cursor) return; clearHood(); }
    else if (key === 'n') talkTo(hooks.nextWaiting?.()?.id);
    else return;
    event.preventDefault();
  };

  card = createCard(box);
  labels = createLabels(box, { onSession: talkTo, onHood: selectHood });
  const controls = createControls(box, { onRotate: dir => camera && turn(dir), onFit: () => { if (camera) { clearHood(); fitCity(); } }, onNext: () => talkTo(hooks.nextWaiting?.()?.id), onList: () => hooks.showList?.(), onNew: () => {} });
  const listening = [[canvas, 'pointerdown', onDown], [canvas, 'pointermove', onMove], [canvas, 'pointerup', onUp], [canvas, 'pointercancel', onUp], [canvas, 'pointerleave', onLeave], [window, 'keydown', onKey]];
  for (const [target, type, listener] of listening) target.addEventListener(type, listener);
  box.addEventListener('wheel', onWheel, { passive: false }); // On the box: over a bubble it should still zoom.

  return {
    update(next, { error: problem = '' } = {}) {
      if (gone) return;
      if (failure) throw failure;
      if (ctx.isContextLost?.()) throw new Error('City lost its canvas');
      snapshot = next; error = problem;
      sessions = new Map(snapshot.sessions.map(session => [session.id, session]));
      layout = snapshot.office ? sharedLayout(snapshot.office) : layoutOffice(snapshot.sessions, layout);
      plan = cityPlan(layout, snapshot.towers, plan, snapshot.providers);
      const key = groundKey(plan);
      if (key !== cellsKey) { cells = groundCells(plan); cellsKey = key; grounds.clear(); dirty = true; }
      if (selectedHood && !plan.hoods.some(hood => hood.key === selectedHood)) selectedHood = null;
      if (!camera) place();
      // One agent not being there may just mean it isn't installed; that shows on its plant. Lost means nothing can be reached.
      controls.setLost(!!error || !!snapshot.providers?.length && snapshot.providers.every(provider => !provider.connected));
      controls.setWaiting(snapshot.sessions.filter(session => ['permission', 'question'].includes(session.status)).length);
      dirty = true; cancel();
      // Drawn here, not left to the next frame, so that a canvas that can't draw is caught by syncScene.
      if (step(performance.now()) || moving()) schedule();
    },
    pick() {},
    panelClosed() {},
    talkTo,
    fire() {},
    unmount() {
      gone = true; cancel(); resize.disconnect(); document.removeEventListener('visibilitychange', onVisible);
      for (const [target, type, listener] of listening) target.removeEventListener(type, listener);
      box.removeEventListener('wheel', onWheel); controls.dispose(); card.dispose(); labels.dispose();
      sprites.clear(); shown.clear(); grounds.clear(); canvas.remove();
    },
    // For the local harness: no cost unless something calls it.
    inspect: () => ({ camera, size, view, frames, bakeMs: [...bakeMs], groundMs: [...groundMs], cached: sprites.size, plan, lots: { ...lots }, drawn }),
  };
}
