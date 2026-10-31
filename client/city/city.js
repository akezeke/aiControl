// The City theme: a pixel-art city on a 2D canvas. Every sprite lands on whole art pixels, and art pixels are whole device pixels.
import './city.css';
import { sharedLayout, layoutOffice } from '../office/layout.js';
import { cityPlan, screen, annexAt, LOT, PLOT } from './plan.js';
import { groundCells, paintGround } from './ground.js';
import { buildTower, annex, coolingPlant, stackPlant } from './generator.js';
import { renderSprite, SpriteCache } from './sprite.js';
import { citySignal } from './signals.js';
import { fitCanvas, startCamera, toCanvas } from './view.js';

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
  let raf = 0, timer = 0, dirty = true, lastDrawn = '', failure = null, gone = false, frames = 0, bakeMs = [];

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

  const signalOf = id => {
    const session = sessions.get(id), plant = plan.plants.find(p => p.provider === session?.provider);
    return session ? citySignal(session, { connected: !error && plant?.connected !== false }) : { windows: 'dark', twinkle: false };
  };
  const phaseOf = (id, signal, now) => signal.twinkle && !reducedMotion() ? Math.floor((now + offset(id)) / TWINKLE_MS) % 2 : 0;

  // Everything standing in the city this frame. Nothing here renders: a sprite is only baked if its key isn't cached.
  const standing = now => {
    const items = [], stand = (key, group, x, z, build) => { const [sx, sy] = screen(x, z, view); items.push({ key: `${key}|${view}|false`, group, sx, sy, build }); };
    cells.props.forEach(({ stack, x, z }, i) => stand(`prop:${i}:${x}:${z}`, `prop:${i}`, x, z, () => stack));
    for (const { provider, x, z, connected } of plan.plants) {
      const [make, stripe] = PLANTS[provider], on = connected && !error;
      stand(`plant:${provider}|${on}`, `plant:${provider}`, x, z, () => make(stripe, on));
    }
    for (const building of plan.buildings) {
      const signal = signalOf(building.id), { id, look, storeys } = building, { windows } = signal, phase = phaseOf(id, signal, now);
      stand(`${id}|${storeys}|${windows}|${phase}`, id, building.x, building.z, () => buildTower(look, windows, storeys, phase).stack);
      building.subagents.forEach((kid, i) => {
        const at = annexAt(building, i, view), state = signalOf(kid.id);
        stand(`${id}+${i}|${kid.storeys}|${state.windows}|0`, `${id}+${i}`, at.x, at.z, () => annex(look, i, state.windows, kid.storeys).stack);
      });
    }
    return items.sort((a, b) => a.sy - b.sy);
  };
  const visible = item => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return x > -CULL_X && x < size.width + CULL_X && y > -CULL_UP && y < size.height + CULL_DOWN; };
  const bake = item => {
    const started = performance.now(), sprite = renderSprite(item.build(), view);
    sprite.image = toImage(sprite); sprite.shadowImage = toImage(sprite.shadow);
    sprites.set(item.key, sprite);
    bakeMs.push(performance.now() - started); if (bakeMs.length > 500) bakeMs.shift();
    return sprite;
  };

  const groundImage = () => {
    let ground = grounds.get(view);
    if (!ground) { const painted = paintGround(cells, view); ground = { ...painted, image: toImage(painted) }; grounds.set(view, ground); }
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
    const placed = list.map(({ item, sprite }) => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return { sprite, x, y }; });
    for (const { sprite, x, y } of placed) if (sprite.shadowImage) ctx.drawImage(sprite.shadowImage, x - sprite.shadow.originX, y - sprite.shadow.originY);
    for (const { sprite, x, y } of placed) if (sprite.image) ctx.drawImage(sprite.image, x - sprite.originX, y - sprite.originY);
  };

  // One sprite baked per frame at most; until it's ready a building shows what it last looked like.
  const step = now => {
    if (!plan || !camera) return false;
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
  const moving = () => plan && !reducedMotion() && plan.buildings.some(building => signalOf(building.id).twinkle);
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
  const resize = new ResizeObserver(() => { if (camera) fit(); else place(); if (camera) wake(); });
  resize.observe(box);

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
      if (!camera) place();
      dirty = true; cancel();
      // Drawn here, not left to the next frame, so that a canvas that can't draw is caught by syncScene.
      if (step(performance.now()) || moving()) schedule();
    },
    pick() {},
    panelClosed() {},
    talkTo() {},
    fire() {},
    unmount() {
      gone = true; cancel(); resize.disconnect(); document.removeEventListener('visibilitychange', onVisible);
      sprites.clear(); shown.clear(); grounds.clear(); canvas.remove();
    },
    // For the local harness: no cost unless something calls it.
    inspect: () => ({ camera, size, view, frames, bakeMs: [...bakeMs], cached: sprites.size, plan }),
  };
}
