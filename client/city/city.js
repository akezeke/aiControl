// The City theme: a pixel-art city on a 2D canvas. Every sprite lands on whole art pixels, and art pixels are whole device pixels.
import './city.css';
import { sharedLayout, layoutOffice, VACANT_MS } from '../office/layout.js';
import { isTypingTarget } from '../office/status.js';
import { officeHasKeys, sceneFocused } from '../scene-keys.js';
import { createCard, createMenu } from '../scene-ui.js';
import { hireChoices } from '../hire.js';
import { cityPlan, screen, unproject, annexAt, lotAt, spawnTarget, LOT, PLOT } from './plan.js';
import { groundCells, paintGround, paintHood } from './ground.js';
import { buildTower, annex, dust, crane, coolingPlant, stackPlant } from './generator.js';
import { Bloom, glowPixels, lampOffset, lampSize } from './bloom.js';
import { renderSprite, SpriteCache } from './sprite.js';
import { citySignal, plantTag, Lifecycle } from './signals.js';
import { hop, hum, phaseAt, sparks, STEAM_MS } from './juice.js';
import { ZOOMS, overscanned, fitStep, cityBox, clampCamera, startCamera, focusHood, focusBuildings, toCanvas, fromCanvas, hitSprites, stopRatio, eyeOf, cameraFor, canvasTransform, between, zoomAbout, settleStep, flickOf, keyPan } from './view.js';
import { createControls, createLabels } from './labels.js';

const TAG_X = 16, TAG_Y = 6;
const DRAG_SLOP = 6, GLIDE_MS = 220, NOTCH = 50, WHEEL_REST = 200;
// A flick carries on: how long it takes to lose most of its speed, and what still counts as moving in CSS pixels per ms.
const COAST_MS = 220, KEY_COAST_MS = 110, COAST_MIN = .03;
const PAN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
const STEP_MS = 125, CACHE = 256, FLOOR = '#0b5e65', HIGHLIGHT = { hover: '#f9c22b', selected: '#fbff86', cursor: '#ffffff', asked: '#f9c22b' };
// Everything but a chosen neighbourhood falls into shadow.
const DUSK = 'rgba(46, 34, 47, .55)';
// A sprite this far off the canvas can't reach it, so it isn't baked until it might.
const CULL_X = 90, CULL_UP = 40, CULL_DOWN = 170;
const BEACON = '#f9c22b', BEACON_INK = '#2e222f', BLINK_MS = 500, CRANE_AT = 20;
// Dust and smoke climb from the roof a step at a time, growing as they go; a building ending goes up in a bigger cloud.
const PLUME = [6, 10, 14, 18], PLUME_LIFT = 3, PUFF = [14, 22, 30, 36];
// A session the server won't let go of comes back rather than leaving a lot that looks empty and isn't.
const FIRED_MS = VACANT_MS + 10_000;
const PLANTS = { claude: [coolingPlant, '#e83b3b'], codex: [stackPlant, '#0eaf9b'] };

export function webglAvailable() {
  try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const drawBounced = (target, image, sprite, x, y, bounce) => {
  const left = x - sprite.originX, top = y - sprite.originY;
  if (bounce) target.drawImage(image, left, top - bounce.lift + bounce.squash, image.width, image.height - bounce.squash);
  else target.drawImage(image, left, top);
};
const toImage = ({ width, height, rgba }) => {
  if (!width || !height) return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
};
// A stack is the same picture wherever it stands, so every tree of a kind shares one sprite.
const stackIds = new WeakMap(); let stacksSeen = 0;
const stackId = stack => { if (!stackIds.has(stack)) stackIds.set(stack, ++stacksSeen); return stackIds.get(stack); };
// What the ground is painted from: anything else in the plan can change without repainting it.
const groundKey = plan => JSON.stringify([plan.bounds, plan.roads, plan.parcels, plan.parks, plan.hoods.map(hood => [hood.key, hood.x, hood.z, hood.cols, hood.lots.map(lot => lot.sessionId)])]);

export function mountCity(box, hooks = {}) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('City needs a 2D canvas');
  box.append(canvas);
  ctx.imageSmoothingEnabled = false;
  // The glow lies over the sharp image on a canvas of its own, soft at screen scale. Without one the city is only less pretty.
  const glowCanvas = document.createElement('canvas'), glowCtx = glowCanvas.getContext('2d'), lamps = document.createElement('canvas'), lampsCtx = lamps.getContext('2d'), bloom = glowCtx && lampsCtx ? new Bloom() : null;
  glowCanvas.className = 'city-glow';
  if (bloom) box.append(glowCanvas);

  const sprites = new SpriteCache(CACHE), shown = new Map(), grounds = new Map(), litHoods = new Map(), lots = { hover: null, selected: null, cursor: null, asked: null };
  const lifecycle = new Lifecycle(), fired = new Map(), ghosts = new Map(), hops = new Map(), moods = new Map(); // ghosts: what has left the plan but is still going up in dust.
  let snapshot = null, error = '', layout = null, plan = null, sessions = new Map(), cells = null, cellsKey = '';
  let view = 0, camera = null, eye = null, size = { width: 1, height: 1, scale: 1 }, ratio = 0, boxW = 0, boxH = 0, placed = '', labelsStale = false;
  let raf = 0, timer = 0, dirty = true, lastDrawn = '', failure = null, gone = false, frames = 0, bakeMs = [], groundMs = [];
  const keysDown = new Map(); let keysFrom = 0, keysAt = 0, keysGoing = null;
  let glide = null, coast = null, drawn = [], selectedHood = null, card = null, labels = null, menu = null, animating = false, steaming = false, test = null, slot, dismissed = false;

  const dpr = () => window.devicePixelRatio || 1;
  const fit = () => {
    if (!camera) return;
    const rect = box.getBoundingClientRect(), next = overscanned(rect.width, rect.height, dpr(), camera.step);
    boxW = rect.width; boxH = rect.height;
    if (next.width === size.width && next.height === size.height && next.scale === size.scale && dpr() === ratio) return;
    size = next; ratio = dpr(); canvas.width = next.width; canvas.height = next.height; canvas.style.width = `${next.cssW}px`; canvas.style.height = `${next.cssH}px`;
    lamps.width = lampSize(next.width); lamps.height = lampSize(next.height); glowCanvas.width = Math.ceil(next.cssW); glowCanvas.height = Math.ceil(next.cssH); glowCanvas.style.width = `${next.cssW}px`; glowCanvas.style.height = `${next.cssH}px`;
    ctx.imageSmoothingEnabled = false; dirty = true;
  };
  const place = () => {
    const { width, height } = box.getBoundingClientRect();
    if (!width || !height || !plan) return;
    const waiting = hooks.nextWaiting?.(), focus = plan.buildings.find(building => building.id === waiting?.id || building.subagents.some(kid => kid.id === waiting?.id))?.hoodKey;
    camera = startCamera(plan, view, width, height, dpr(), focus);
    fit(); eye = eyeOf(camera, boxW, boxH, dpr()); camera = cameraFor(eye, boxW, boxH, dpr()); fit(); placeCanvas();
  };

  const passes = id => { const session = sessions.get(id); return !!session && test(session); };
  const dimmed = (building, id = building.id) => !!selectedHood && building.hoodKey !== selectedHood || !!test && !passes(id);
  const signalOf = id => {
    const session = sessions.get(id), plant = plan.plants.find(p => p.provider === session?.provider);
    return session ? citySignal(session, { connected: !error && plant?.connected !== false }) : { windows: 'dark', twinkle: false };
  };
  const phaseOf = (id, signal, now) => signal.twinkle && !reducedMotion() ? phaseAt(now, id) : 0;
  // A building jumps when something about it changes, or when it's clicked: never just for being seen for the first time.
  const hopped = (id, mood, now, reduced) => {
    if (moods.has(id) && moods.get(id) !== mood && !reduced) hops.set(id, now);
    moods.set(id, mood);
  };
  const bounceOf = (id, signal, dim, now, reduced) => {
    if (reduced) return null;
    const started = hops.get(id), jump = started === undefined ? null : hop(now - started);
    if (started !== undefined && !jump) hops.delete(id);
    if (jump) return jump;
    if (dim) return null;
    if (lots.hover && lots.hover === lotKeyOf(id)) return { lift: 1, squash: 0 };
    return signal.twinkle && hum(now, id) ? { lift: 0, squash: 1 } : null;
  };

  // Everything standing in the city this frame. Nothing here renders: a sprite is only baked if its key isn't cached.
  const standing = now => {
    const reduced = reducedMotion(), items = [], tick = Math.floor(now / STEP_MS), blink = reduced || Math.floor(now / BLINK_MS) % 2 === 0;
    const stand = (key, group, x, z, build, opens, dim = false, more = null) => { const [sx, sy] = screen(x, z, view); items.push({ key: `${key}|${view}|${dim}`, group, sx, sy, build, opens, dim, ...more }); };
    // Over a building, drawn after everything standing: `rise` is how far up it, `lift` pixels above that.
    const plume = (group, over, x, z, w, rise, lift, dim) => stand(`dust:${w}`, group, x, z, () => ({ stack: dust(w) }), null, dim, { over, rise, lift });
    // What every building does for its state, on top of its own sprite.
    const effects = (group, x, z, signal, stage, dim) => {
      if (stage.rising || stage.sinking || stage.puff || stage.storeys !== stage.target) animating = true;
      if (stage.puff) { plume(`puff:${group}`, group, x, z, PUFF[Math.min(PUFF.length - 1, Math.floor(stage.progress * PUFF.length))], .5, 0, false); return; }
      if (dim) return;
      if (!reduced && (signal.dust || signal.smoke)) {
        const i = tick % PLUME.length; animating = true;
        plume(`plume:${group}`, group, x, z, PLUME[i], 1, i * PLUME_LIFT, signal.smoke);
      }
      if (signal.beacon && !reduced) animating = true;
    };
    const towerOf = building => {
      const { id, look, x, z } = building, stage = { ...lifecycle.stage(id, now, reduced), target: building.storeys };
      if (stage.gone) return false;
      const signal = stage.puff ? { windows: 'dark', twinkle: false } : signalOf(id), { windows } = signal, phase = phaseOf(id, signal, now), dim = dimmed(building);
      if (signal.twinkle && !reduced) animating = true;
      hopped(id, `${windows}|${building.storeys}`, now, reduced || stage.puff);
      stand(`${id}|${stage.storeys}|${windows}|${phase}`, id, x, z, () => buildTower(look, windows, stage.storeys, phase), stage.puff ? null : id, dim, { beacon: signal.beacon && !dim && blink, named: true, bounce: bounceOf(id, signal, dim, now, reduced), sparks: signal.twinkle && !dim && !reduced ? sparks(now, id) : null });
      if (stage.crane) stand('crane', `crane:${id}`, x + CRANE_AT, z - CRANE_AT, () => ({ stack: crane(true) }), null, dim);
      effects(id, x, z, signal, stage, dim);
      return true;
    };
    const annexOf = (building, i, kid) => {
      const stage = { ...lifecycle.stage(kid.id, now, reduced), target: kid.leaving ? 0 : kid.storeys };
      if (stage.gone) return false;
      const at = annexAt(building, i, view), group = `${building.id}+${i}`, signal = stage.puff ? { windows: 'dark', twinkle: false } : signalOf(kid.id), dim = dimmed(building, kid.id), phase = phaseOf(kid.id, signal, now);
      hopped(kid.id, `${signal.windows}|${kid.storeys}`, now, reduced || stage.puff);
      stand(`${group}|${stage.storeys}|${signal.windows}|${phase}`, group, at.x, at.z, () => annex(building.look, i, signal.windows, stage.storeys, phase), stage.puff ? null : kid.id, dim, { beacon: signal.beacon && !dim && blink, bounce: bounceOf(kid.id, signal, dim, now, reduced) });
      effects(group, at.x, at.z, signal, stage, dim);
      return true;
    };
    animating = false; steaming = false;
    const quiet = !!selectedHood;
    cells.props.forEach(({ stack, x, z }, i) => stand(`prop:${stackId(stack)}`, `prop:${i}`, x, z, () => ({ stack }), null, quiet));
    for (const { provider, x, z, connected } of plan.plants) {
      const [make, stripe] = PLANTS[provider], lit = connected && !error, on = lit && !reduced, phase = on ? Math.floor(now / STEAM_MS) % 4 : 0;
      if (on) steaming = true;
      stand(`plant:${provider}|${on}|${lit}|${phase}`, `plant:${provider}`, x, z, () => ({ stack: make(stripe, on, lit, phase) }), null, quiet);
    }
    for (const building of plan.buildings) if (towerOf(building)) building.subagents.forEach((kid, i) => annexOf(building, i, kid));
    for (const [id, ghost] of ghosts) if (!(ghost.kid ? annexOf(ghost.building, ghost.i, ghost.kid) : towerOf(ghost.building))) ghosts.delete(id);
    return items.sort((a, b) => a.sy - b.sy);
  };
  const visible = item => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return x > -CULL_X && x < size.width + CULL_X && y > -CULL_UP && y < size.height + CULL_DOWN; };
  const bake = item => {
    const started = performance.now(), made = item.build(), sprite = renderSprite(made.stack, view, { dim: item.dim });
    sprite.top = made.top ?? 0; sprite.cx = made.cx ?? 0; sprite.image = toImage(sprite); sprite.shadowImage = toImage(sprite.shadow);
    sprite.glowImage = bloom && sprite.lit.includes(1) ? toImage({ width: sprite.width, height: sprite.height, rgba: glowPixels(sprite.rgba, sprite.width, sprite.height, sprite.lit) }) : null;
    sprites.set(item.key, sprite);
    bakeMs.push(performance.now() - started); if (bakeMs.length > 500) bakeMs.shift();
    return sprite;
  };

  const groundImage = () => {
    let ground = grounds.get(view);
    if (!ground) { const started = performance.now(), painted = paintGround(cells, view); ground = { ...painted, image: toImage(painted) }; grounds.set(view, ground); groundMs.push(performance.now() - started); }
    return ground;
  };
  const litHood = hood => {
    const key = `${hood.key}|${view}`;
    let lit = litHoods.get(key);
    if (!lit) { const painted = paintHood(cells, hood, view); lit = { ...painted, image: toImage(painted), edgeImage: toImage({ width: painted.width, height: painted.height, rgba: painted.edge }) }; litHoods.set(key, lit); }
    return lit;
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
    const chosen = selectedHood && plan.hoods.find(hood => hood.key === selectedHood), lit = chosen && litHood(chosen);
    if (lit) { ctx.fillStyle = DUSK; ctx.fillRect(0, 0, size.width, size.height); ctx.drawImage(lit.image, gx - lit.originX, gy - lit.originY); }
    for (const kind of Object.keys(lots)) { const lot = lots[kind] && lotOf(lots[kind]); if (lot) outline(lot, HIGHLIGHT[kind]); }
    const placed = list.filter(({ item }) => !item.over).map(({ item, sprite }) => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return { sprite, x, y, item, opens: item.opens, left: x - sprite.originX, top: y - sprite.originY }; });
    drawn = placed.filter(item => item.opens);
    syncLabels(placed);
    for (const { sprite, x, y } of placed) if (sprite.shadowImage) ctx.drawImage(sprite.shadowImage, x - sprite.shadow.originX, y - sprite.shadow.originY);
    // A hop lifts and squashes the picture and leaves the shadow on the ground.
    for (const { sprite, x, y, item } of placed) if (sprite.image) drawBounced(ctx, sprite.image, sprite, x, y, item.bounce);
    // Effects last: they are in the air, in front of whatever stands there.
    const under = new Map(placed.map(entry => [entry.item.group, entry])), crown = ({ sprite, x, y, item }) => { const [ox, oy] = screen(sprite.cx, 0, view), { lift = 0, squash = 0 } = item.bounce ?? {}; return [x + Math.round(ox), y + Math.round(oy) - sprite.top - lift + squash]; };
    for (const entry of placed) {
      if (!entry.item.beacon) continue;
      const [x, y] = crown(entry);
      ctx.fillStyle = BEACON_INK; ctx.fillRect(x - 2, y - 4, 5, 5);
      ctx.fillStyle = BEACON; ctx.fillRect(x - 1, y - 3, 3, 3);
    }
    for (const { item, sprite } of list) {
      const parent = item.over && under.get(item.over);
      if (!parent || !sprite.image) continue;
      const [x, y] = crown(parent), rest = parent.y + Math.round((y - parent.y) * item.rise);
      ctx.drawImage(sprite.image, x - sprite.originX, rest - item.lift - sprite.originY);
    }
    const spray = target => { for (const entry of placed) if (entry.item.sparks) { const [x, y] = crown(entry); for (const spark of entry.item.sparks) { target.fillStyle = spark.colour; target.fillRect(x + spark.x, y + spark.y, 1, 1); } } };
    spray(ctx);
    if (bloom) {
      const shiftX = lampOffset(gx), shiftY = lampOffset(gy), kx = glowCanvas.width / size.width, ky = glowCanvas.height / size.height;
      lampsCtx.setTransform(1, 0, 0, 1, 0, 0); lampsCtx.clearRect(0, 0, lamps.width, lamps.height); lampsCtx.setTransform(1, 0, 0, 1, shiftX, shiftY);
      if (lit) lampsCtx.drawImage(lit.edgeImage, gx - lit.originX, gy - lit.originY);
      for (const { sprite, x, y, item } of placed) if (sprite.glowImage) drawBounced(lampsCtx, sprite.glowImage, sprite, x, y, item.bounce);
      spray(lampsCtx);
      lampsCtx.fillStyle = BEACON;
      for (const entry of placed) if (entry.item.beacon) { const [x, y] = crown(entry); lampsCtx.fillRect(x - 1, y - 3, 3, 3); }
      bloom.draw(glowCtx, lamps, -shiftX * kx, -shiftY * ky, lamps.width * kx, lamps.height * ky);
    }
    followMenu();
  };

  // The DOM over the city, kept in step with whatever was just drawn. The labels only touch what changed.
  const syncLabels = placed => {
    const at = new Map(placed.map(entry => [entry.item.group, entry])), buildingOf = id => plan.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id));
    labels.sync(drawn.map(({ opens: id, sprite, item }) => {
      const session = sessions.get(id);
      return { id, ax: item.sx, ay: item.sy - sprite.originY, name: item.named ? session?.title : null, bubble: session ? signalOf(id).bubble : null, unread: session && hooks.isUnread?.(session), dim: item.dim };
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
      const spot = at.get(`plant:${plant.provider}`);
      if (spot) tags.push({ key: plant.provider, ...plantTag(plant, snapshot.usage), ax: spot.item.sx, ay: spot.item.sy - spot.sprite.originY - TAG_Y });
    }
    labels.tags(tags);
    moveLabels();
  };
  const moveLabels = () => {
    const { x, y, s } = canvasTransform(eye, camera, size, boxW, boxH, dpr()), k = size.scale / dpr() * s;
    labelsStale = false;
    labels.move((sx, sy) => { const [px, py] = toCanvas(camera, size, sx, sy); return [x + px * k, y + py * k]; }, boxW, boxH);
  };
  // The canvas under the eye. A move that stays within an art pixel costs a transform and nothing else.
  const placeCanvas = () => {
    const { x, y, s } = canvasTransform(eye, camera, size, boxW, boxH, dpr()), css = `translate(${x}px, ${y}px) scale(${s})`;
    if (css === placed) return;
    placed = css; canvas.style.transform = css; glowCanvas.style.transform = css; labelsStale = true;
  };
  const look = next => {
    eye = next;
    const at = cameraFor(eye, boxW, boxH, dpr());
    if (at.cx !== camera.cx || at.cy !== camera.cy || at.step !== camera.step) { camera = at; fit(); dirty = true; }
    placeCanvas();
  };

  // One sprite baked per frame at most; until it's ready a building shows what it last looked like.
  const step = now => {
    if (!plan || !camera) return false;
    if (glide) {
      const t = Math.min(1, Math.max(0, now - glide.start) / glide.ms);
      look(between(glide.from, glide.to, 1 - (1 - t) ** 3));
      if (t === 1) glide = null;
    } else if (keysDown.size) {
      const dt = Math.min(50, Math.max(0, now - keysAt));
      keysAt = now; keysGoing = keyPan([...keysDown.values()], now - keysFrom);
      if (keysGoing) look(held({ ...eye, cx: eye.cx + keysGoing.vx * dt / eye.r, cy: eye.cy + keysGoing.vy * dt / eye.r }));
    } else if (coast) {
      const dt = Math.min(50, Math.max(0, now - coast.at)), keep = Math.exp(-dt / (coast.ms ?? COAST_MS)); coast.at = now;
      look(held({ ...eye, cx: eye.cx - coast.vx * dt / eye.r, cy: eye.cy - coast.vy * dt / eye.r }));
      coast.vx *= keep; coast.vy *= keep;
      if (Math.hypot(coast.vx, coast.vy) < COAST_MIN) coast = null;
    }
    const items = standing(now).filter(visible), ready = [];
    if (items.length * 6 > sprites.max) sprites.max = items.length * 6;
    let baked = false, waiting = false;
    for (const item of items) {
      let sprite = sprites.get(item.key);
      if (!sprite && !baked) { sprite = bake(item); baked = true; } else if (!sprite) waiting = true;
      if (sprite) shown.set(item.group, sprite); else sprite = shown.get(item.group);
      if (sprite) ready.push({ item, sprite });
    }
    const drawing = ready.map(({ item, sprite }) => `${item.key}:${sprite.width}:${item.lift ?? ''}:${item.beacon ? 1 : 0}:${item.bounce ? `${item.bounce.lift},${item.bounce.squash}` : ''}:${item.sparks ? item.sparks.map(spark => spark.x * 100 + spark.y).join('/') : ''}`).join();
    if (dirty || baked || drawing !== lastDrawn) { paint(ready); lastDrawn = drawing; dirty = false; }
    if (labelsStale) { moveLabels(); followMenu(); }
    return waiting || baked;
  };
  const moving = () => plan && animating;
  const cancel = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = timer = 0; };
  const frame = now => {
    raf = 0; clearTimeout(timer); timer = 0;
    if (gone || document.hidden) return;
    try {
      const more = step(now);
      if (more || dirty || glide || coast || keysDown.size || hops.size) schedule();
      else if (moving()) timer = setTimeout(() => { timer = 0; schedule(); }, STEP_MS);
      else if (steaming) timer = setTimeout(() => { timer = 0; schedule(); }, STEAM_MS - now % STEAM_MS + 1);
    } catch (problem) { failure = problem; } // The next update throws it, and syncScene falls back to the list.
  };
  const schedule = () => { if (!raf && !gone && !document.hidden) raf = requestAnimationFrame(frame); };
  const wake = () => { dirty = true; cancel(); schedule(); };
  const onVisible = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisible);
  const resize = new ResizeObserver(() => { if (camera) { halt(); fit(); settle(); } else place(); if (camera) wake(); });
  resize.observe(box);

  // ---- The camera. Everything that moves the view goes through here, so that it comes to rest at a whole-pixel zoom, near the city.
  const settle = () => { camera = clampCamera({ ...camera, cx: Math.round(camera.cx), cy: Math.round(camera.cy) }, cityBox(plan, view), size); eye = eyeOf(camera, boxW, boxH, dpr()); camera = cameraFor(eye, boxW, boxH, dpr()); fit(); placeCanvas(); };
  const held = next => clampCamera(next, cityBox(plan, view), { width: boxW / next.r, height: boxH / next.r });
  // A zoom can't stop part way, because art pixels have to land on whole device pixels: stopped, it finishes at once.
  const halt = () => { if (glide && glide.from.r !== glide.to.r) look(glide.to); glide = null; coast = null; };
  const jump = next => { glide = null; coast = null; camera = { ...camera, ...next }; fit(); settle(); wake(); };
  const restAt = next => {
    const step = next.step ?? glide?.to.step ?? camera.step, at = clampCamera({ cx: next.cx ?? eye.cx, cy: next.cy ?? eye.cy, step }, cityBox(plan, view), overscanned(boxW, boxH, dpr(), step));
    return { ...eyeOf({ ...at, cx: Math.round(at.cx), cy: Math.round(at.cy) }, boxW, boxH, dpr()), step };
  };
  const glideTo = next => {
    const to = restAt(next);
    if (reducedMotion()) { jump(cameraFor(to, boxW, boxH, dpr())); return; }
    coast = null; glide = { from: eye, to, start: performance.now(), ms: GLIDE_MS }; schedule();
  };
  const artAt = event => { const rect = canvas.getBoundingClientRect(); return [Math.floor((event.clientX - rect.left) * canvas.width / rect.width), Math.floor((event.clientY - rect.top) * canvas.height / rect.height)]; };
  const boxPoint = event => { const rect = box.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
  const centreOfBox = () => { const rect = box.getBoundingClientRect(); return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }; };
  // One stop, keeping whatever is under the pointer under it. Asked again while gliding, it carries on from the stop it was heading for.
  const zoom = (dir, at = centreOfBox()) => {
    const step = ZOOMS[ZOOMS.indexOf(glide?.to.step ?? camera.step) + dir];
    if (!step) return;
    const [qx, qy] = boxPoint(at);
    glideTo({ ...zoomAbout(eye, stopRatio(step, dpr()), qx, qy, boxW, boxH), step });
  };
  const fitCity = () => { const city = cityBox(plan, view); glideTo({ cx: (city.x0 + city.x1) / 2, cy: (city.y0 + city.y1) / 2, step: fitStep(city, boxW, boxH, dpr()) }); };
  // The same point of the city stays in the middle of the screen.
  const turn = dir => {
    halt();
    const [x, z] = unproject(eye.cx, eye.cy, view);
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
    glideTo(focusHood(plan, hood, view, boxW, boxH, dpr()));
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
    const building = id && sessions.has(id) && !fired.has(id) && plan?.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id));
    if (!building) return;
    if (!reducedMotion()) hops.set(id, performance.now());
    panToWorld(building.x, building.z); hooks.openPanel?.(id);
  };
  const clickAt = event => { const hit = pickAt(event); if (hit?.id) talkTo(hit.id); else if (hit?.lot && !hit.lot.sessionId) askLot(hit.lot, false); };

  // ---- Starting an agent: on an empty lot, or through + wherever the server puts it. The lot stays lit until the menu closes.
  const lotPoint = lot => { const [sx, sy] = screen(lot.x, lot.z, view), [px, py] = toCanvas(camera, size, sx, sy), rect = canvas.getBoundingClientRect(); return { clientX: rect.left + px * rect.width / canvas.width, clientY: rect.top + py * rect.height / canvas.height }; };
  const folders = () => [...new Set((snapshot?.sessions || []).map(session => session.cwd).filter(Boolean))].sort();
  const askLot = (lot, focus) => {
    const target = spawnTarget(plan.hoods.find(hood => hood.lots.includes(lot)), lot);
    slot = target.slot ?? undefined;
    menu.show(target.cwd, lotPoint(lot), focus, hireChoices(snapshot, target.cwd ?? ''), target.cwd === null ? folders() : []);
    lots.asked = lot.key; wake();
  };
  const askAnywhere = button => {
    if (dismissed) { dismissed = false; return; } // That press just closed this same menu.
    if (!snapshot) return;
    const rect = button.getBoundingClientRect();
    slot = undefined; menu.show(null, { clientX: rect.right, clientY: rect.bottom }, true, hireChoices(snapshot, ''), folders());
  };
  // It stays by its lot as the camera moves, and closes once that's off the screen.
  const followMenu = () => {
    const lot = lots.asked && lotOf(lots.asked);
    if (!lot || !menu.open || menu.asking) return;
    const [sx, sy] = screen(lot.x, lot.z, view), [px, py] = toCanvas(camera, size, sx, sy);
    if (px < 0 || py < 0 || px > size.width || py > size.height) menu.close(); else menu.move(lotPoint(lot));
  };
  const onPress = event => { dismissed = !!menu.open && !menu.contains(event.target); if (dismissed) menu.close(); };
  const onClick = () => { dismissed = false; };
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
  const fingers = () => { const [a, b] = [...pointers.values()]; return { apart: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }; };
  // The art under the fingers stays under them, whatever they do, until they let go.
  const followFingers = () => {
    const now = fingers(), [qx, qy] = boxPoint(now), r = Math.min(stopRatio(ZOOMS.at(-1), dpr()), Math.max(stopRatio(ZOOMS[0], dpr()), pinch.r * now.apart / pinch.apart));
    pinch.qx = qx; pinch.qy = qy;
    look(held({ cx: pinch.ax - (qx - boxW / 2) / r, cy: pinch.ay - (qy - boxH / 2) / r, r })); schedule();
  };
  const onDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, event); card.show(null);
    if (eye) halt();
    if (pointers.size === 1) press = { x: event.clientX, y: event.clientY, cx: eye?.cx, cy: eye?.cy, dragged: false, trail: [] };
    if (pointers.size === 2 && eye) {
      const now = fingers(), [qx, qy] = boxPoint(now);
      pinch = { apart: now.apart, r: eye.r, qx, qy, ax: eye.cx + (qx - boxW / 2) / eye.r, ay: eye.cy + (qy - boxH / 2) / eye.r };
      press = null;
    }
  };
  const onMove = event => {
    if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse' && camera) hover(event); return; }
    pointers.set(event.pointerId, event);
    if (pointers.size >= 2 && pinch) { followFingers(); return; }
    if (!press || !camera) return;
    if (!press.dragged && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_SLOP) return;
    // Taken up from here, so that the slop isn't a jump as the drag starts.
    if (!press.dragged) { press.x = event.clientX; press.y = event.clientY; press.dragged = true; canvas.style.cursor = 'grabbing'; }
    press.trail.push([event.timeStamp, event.clientX, event.clientY]);
    if (press.trail.length > 8) press.trail.shift();
    look(held({ ...eye, cx: press.cx - (event.clientX - press.x) / eye.r, cy: press.cy - (event.clientY - press.y) / eye.r })); schedule();
  };
  const onUp = event => {
    if (!pointers.delete(event.pointerId)) return;
    if (pinch && pointers.size < 2) {
      // On to the stop it was heading for. Whichever finger is left does nothing until it lifts too: a pan starting here would feel like a slip.
      const step = settleStep(eye.r, pinch.r, dpr()), { qx, qy } = pinch;
      pinch = null; press = null;
      glideTo({ ...zoomAbout(eye, stopRatio(step, dpr()), qx, qy, boxW, boxH), step });
    }
    if (pointers.size) return;
    const clicked = press && !press.dragged && event.type === 'pointerup' && !dismissed;
    if (press?.dragged && event.type === 'pointerup' && !reducedMotion()) { const speed = flickOf(press.trail, event.timeStamp); if (speed) { coast = { ...speed, at: performance.now() }; schedule(); } }
    press = null; canvas.style.cursor = 'grab';
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
  // A pan key moves the view for as long as it's down. Waiting on keydown would stop after the first step, for as long as the keyboard takes to start repeating.
  const holdKey = (key, pan) => {
    if (keysDown.has(key)) return;
    const at = performance.now();
    if (!keysDown.size) { keysFrom = at; keysAt = at - 16; coast = null; }
    // A zoom on its way finishes first; a pan on its way gives way to this one.
    if (glide && glide.from.r === glide.to.r) glide = null;
    keysDown.set(key, pan); schedule();
  };
  const dropKeys = key => {
    if (key === undefined) keysDown.clear(); else if (!keysDown.delete(key)) return;
    if (keysDown.size) return;
    if (keysGoing && !reducedMotion()) { coast = { vx: -keysGoing.vx, vy: -keysGoing.vy, at: performance.now(), ms: KEY_COAST_MS }; schedule(); }
    keysGoing = null;
  };
  const onKeyUp = event => dropKeys(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  const onBlur = () => dropKeys();
  const onKey = event => {
    if (!plan || !camera || !officeHasKeys(event)) return;
    if (event.key === 'Tab') { if (sceneFocused(canvas) && moveCursor(event.shiftKey ? -1 : 1)) event.preventDefault(); return; }
    if (event.key === 'Enter') {
      const lot = sceneFocused(canvas) && lots.cursor && lotsHere().find(l => l.key === lots.cursor);
      if (lot) { event.preventDefault(); if (lot.sessionId) hooks.openPanel?.(lot.sessionId); else askLot(lot, true); }
      return;
    }
    if (isTypingTarget(event.target)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key, pan = PAN_KEYS[key];
    if (pan) holdKey(key, pan);
    else if (key === '+' || key === '=') zoom(1);
    else if (key === '-' || key === '_') zoom(-1);
    else if (key === 'q') turn(-1);
    else if (key === 'e') turn(1);
    else if (key === 'f') { clearHood(); fitCity(); }
    // By place as well as by character: on many layouts, Swedish for one, [ and ] need AltGr, which reads as Ctrl+Alt.
    else if (key === '[' || event.code === 'BracketLeft') stepHood(-1);
    else if (key === ']' || event.code === 'BracketRight') stepHood(1);
    else if (key === 'Escape') { if (menu.open) menu.close(); else if (selectedHood || lots.cursor) clearHood(); else return; }
    else if (key === 'n') talkTo(hooks.nextWaiting?.()?.id);
    else return;
    event.preventDefault();
  };

  card = createCard(box);
  menu = createMenu(box, (cwd, choice, item) => hooks.spawn?.(cwd, choice, item, slot), () => { if (lots.asked) { lots.asked = null; wake(); } });
  labels = createLabels(box, { onSession: talkTo, onHood: selectHood });
  const controls = createControls(box, { onFit: () => { if (camera) { clearHood(); fitCity(); } }, onNext: () => talkTo(hooks.nextWaiting?.()?.id), onList: () => hooks.showList?.(), onNew: askAnywhere });
  const listening = [[canvas, 'pointerdown', onDown], [canvas, 'pointermove', onMove], [canvas, 'pointerup', onUp], [canvas, 'pointercancel', onUp], [canvas, 'pointerleave', onLeave], [window, 'keydown', onKey], [window, 'keyup', onKeyUp], [window, 'blur', onBlur], [document, 'click', onClick]];
  for (const [target, type, listener] of listening) target.addEventListener(type, listener);
  box.addEventListener('wheel', onWheel, { passive: false }); // On the box: over a bubble it should still zoom.
  document.addEventListener('pointerdown', onPress, true); // Before anything under the press can act on it.

  const scene = {
    update(next, { error: problem = '' } = {}) {
      if (gone) return;
      if (failure) throw failure;
      if (ctx.isContextLost?.()) throw new Error('City lost its canvas');
      snapshot = next; error = problem;
      sessions = new Map(snapshot.sessions.map(session => [session.id, session]));
      layout = snapshot.office ? sharedLayout(snapshot.office) : layoutOffice(snapshot.sessions, layout);
      const before = plan, now = performance.now();
      plan = cityPlan(layout, snapshot.towers, plan, snapshot.providers);
      const here = new Set(plan.buildings.flatMap(building => [building.id, ...building.subagents.map(kid => kid.id)]));
      // Still fired while it stands: a vacant lot keeps its building a while, and clearing early would bring it back.
      for (const [id, at] of fired) if (!here.has(id) && !sessions.has(id) || now - at > FIRED_MS) fired.delete(id);
      for (const id of here) ghosts.delete(id);
      for (const building of before?.buildings || []) {
        if (!here.has(building.id)) ghosts.set(building.id, { building });
        // One that was leaving has already sunk into the ground.
        building.subagents.forEach((kid, i) => { if (!here.has(kid.id) && !kid.leaving) ghosts.set(kid.id, { building, i, kid }); });
      }
      lifecycle.update(plan, fired, now);
      const key = groundKey(plan);
      if (key !== cellsKey) { cells = groundCells(plan); cellsKey = key; grounds.clear(); litHoods.clear(); dirty = true; }
      if (selectedHood && !plan.hoods.some(hood => hood.key === selectedHood)) selectedHood = null;
      // Someone else may have just taken the lot it was asking about.
      if (lots.asked && menu.open && !menu.asking) { const lot = lotOf(lots.asked); if (!lot || lot.sessionId) menu.close(); }
      if (!camera) place();
      // One agent not being there may just mean it isn't installed; that shows on its plant. Lost means nothing can be reached.
      controls.setLost(!!error || !!snapshot.providers?.length && snapshot.providers.every(provider => !provider.connected));
      controls.setWaiting(snapshot.sessions.filter(session => ['permission', 'question'].includes(session.status)).length);
      dirty = true; cancel();
      // Drawn here, not left to the next frame, so that a canvas that can't draw is caught by syncScene.
      if (step(performance.now()) || moving() || glide || coast) schedule();
    },
    pick(next, open) {
      if (gone) return;
      test = next; dirty = true;
      if (open) menu.close();
      const hits = open && test && plan && camera ? plan.buildings.filter(building => passes(building.id) || building.subagents.some(kid => passes(kid.id))) : [];
      if (hits.length) glideTo(focusBuildings(hits, view, boxW, boxH, dpr()));
      wake();
    },
    panelClosed() {},
    talkTo,
    fire(id) { if (gone) return; fired.set(id, performance.now()); if (snapshot) scene.update(snapshot, { error }); },
    unmount() {
      gone = true; cancel(); resize.disconnect(); document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('pointerdown', onPress, true);
      for (const [target, type, listener] of listening) target.removeEventListener(type, listener);
      box.removeEventListener('wheel', onWheel); controls.dispose(); card.dispose(); labels.dispose(); menu.dispose();
      sprites.clear(); shown.clear(); grounds.clear(); ghosts.clear(); fired.clear(); canvas.remove(); glowCanvas.remove(); plan = null;
    },
    // For the local harness: no cost unless something calls it.
    inspect: () => ({ camera, eye, glide: !!glide, coast: !!coast, placed, size, view, frames, bakeMs: [...bakeMs], groundMs: [...groundMs], cached: sprites.size, plan, lots: { ...lots }, drawn, ghosts: ghosts.size, animating }),
  };
  return scene;
}
