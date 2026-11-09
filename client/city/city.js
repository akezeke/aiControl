// The City theme: a pixel-art city on a 2D canvas. Every sprite lands on whole art pixels, and art pixels are whole device pixels.
import './city.css';
import { reducedAtmosphere, effectiveAtmosphere, onAtmosphereChange } from '../atmosphere.js';
import { sharedLayout, layoutOffice, VACANT_MS } from '../office/layout.js';
import { isTypingTarget } from '../office/status.js';
import { officeHasKeys, sceneFocused } from '../scene-keys.js';
import { createCard, createMenu } from '../scene-ui.js';
import { hireChoices } from '../hire.js';
import { cityPlan, screen, unproject, annexAt, lotAt, spawnTarget, LOT, PLOT } from './plan.js';
import { bareCells, groundCells, paintGround, paintHood, paintLotShade, timeOfDay, WIRE_SAG } from './ground.js';
import { setSunPlace } from '../sun.js';
import { buildTower, annex, boat, duck, dust, crane, craneSpot, car, siteCrane, JIB_BEATS, coolingPlant, stackPlant, tankPlant, PYLON_ARM, PYLON_REACH } from './generator.js';
import { Bloom, glowPixels, lampOffset, lampSize } from './bloom.js';
import { renderSprite, SpriteCache } from './sprite.js';
import { citySignal, plantTag, Lifecycle } from './signals.js';
import { hop, hum, phaseAt, sparks, STEAM_MS, traffic, BURSTS, burst, momentOf, jibBeat } from './juice.js';
import { birdsAt, boatsAt, cloudBlob, cloudsAt, ducksAt, seaFrame, SEA_FRAMES, SEA_KINDS } from './surroundings.js';
import { powerLines, powerRoutes, pulsesAt, routeDots } from './power.js';
import { BOOT, CityBoot } from './boot.js';
import { takeBootAsk } from './boot-ask.js';
import { createBootCard, createBootShade, drawRising } from './boot-paint.js';
import { ZOOMS, overscanned, fitStep, cityBox, clampCamera, startCamera, focusHood, focusBuildings, toCanvas, fromCanvas, hitSprites, stopRatio, eyeOf, cameraFor, canvasTransform, between, zoomAbout, settleStep, flickOf, keyPan } from './view.js';
import { createControls, createLabels } from './labels.js';
import { paintMap, trackMap, steerMap } from './minimap.js';

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
const BEACON = '#f9c22b', BEACON_INK = '#2e222f', BLINK_MS = 500, CRANE_MAST_MIN = 28, CRANE_MAST_MAX = 52;
// Dust and smoke climb from the roof a step at a time, growing as they go; a building ending goes up in a bigger cloud.
const PLUME = [6, 10, 14, 18], PLUME_LIFT = 3, PUFF = [14, 22, 30, 36];
// A session the server won't let go of comes back rather than leaving a lot that looks empty and isn't.
const FIRED_MS = VACANT_MS + 10_000;
const BOAT_SAILS = ['#e83b3b', '#0eaf9b', '#f9c22b'];
const POWER = { claude: '#e83b3b', codex: '#0eaf9b', opencode: '#9a7bff' }, POWER_HEAD = '#fbff86', POWER_DOTS = 6;
const BIRD_DAY = '#2e222f', BIRD_NIGHT = '#c7dcd0', BIRD_LIFT = 46, CLOUD_INK = 'rgba(46, 34, 47, .16)', cloudSprites = new Map();
const PLANTS = { claude: [coolingPlant, '#e83b3b'], codex: [stackPlant, '#0eaf9b'], opencode: [tankPlant, '#9a7bff'] };
// The intro: how long it may spend baking in one frame while the card hides the city, how soon a crane follows the power, and the trail behind a spark on the wires.
const BOOT_BAKE_MS = 12, BOOT_CRANE_MS = 250, WIRE_SPARK = '#f9c22b';

export function webglAvailable() {
  try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
}

const reducedMotion = reducedAtmosphere;
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
const groundKey = plan => JSON.stringify([plan.plants.map(plant => [plant.key, plant.z]), plan.bounds, plan.roads, plan.parcels, plan.parks, plan.hoods.map(hood => [hood.key, hood.x, hood.z, hood.cols, hood.lots.map(lot => lot.sessionId)])]);

export function mountCity(box, hooks = {}) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('City needs a 2D canvas');
  box.append(canvas);
  ctx.imageSmoothingEnabled = false;
  // The glow lies over the sharp image on a canvas of its own, soft at screen scale. Without one the city is only less pretty.
  const glowCanvas = document.createElement('canvas'), glowCtx = glowCanvas.getContext('2d'), lamps = document.createElement('canvas'), lampsCtx = lamps.getContext('2d'), bloom = glowCtx && lampsCtx ? new Bloom() : null;
  glowCanvas.className = 'city-glow';
  if (bloom) box.append(glowCanvas);

  const sprites = new SpriteCache(CACHE), shown = new Map(), grounds = new Map(), seas = new Map(), litHoods = new Map(), lotShades = new Map(), lots = { hover: null, selected: null, cursor: null, asked: null };
  const lifecycle = new Lifecycle(), fired = new Map(), ghosts = new Map(), hops = new Map(), moods = new Map(), states = new Map(), bursts = new Map(); // ghosts: what has left the plan but is still going up in dust.
  let snapshot = null, error = '', layout = null, plan = null, sessions = new Map(), cells = null, cellsKey = '', hour = timeOfDay(), clock = 0;
  let view = 0, camera = null, eye = null, size = { width: 1, height: 1, scale: 1 }, ratio = 0, boxW = 0, boxH = 0, placed = '', labelsStale = false;
  let raf = 0, timer = 0, dirty = true, lastDrawn = '', glowDrawn = '', seaNow = null, seaFrameDrawn = 0, failure = null, gone = false, frames = 0, bakeMs = [], groundMs = [], paintedAt = 0;
  const keysDown = new Map(); let keysFrom = 0, keysAt = 0, keysGoing = null;
  let boot = null, bootCard = null, bootShade = null, bootReady = false, bareGrounds = new Map();
  let glide = null, coast = null, drawn = [], plantsDrawn = [], routes = [], pulses = [], birds = [], clouds = [], litPlant = null, selectedHood = null, hoveredHood = null, card = null, labels = null, menu = null, animating = false, steaming = false, test = null, slot, dismissed = false;

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
  const dimmedId = id => { const building = plan.buildings.find(b => b.id === id); return !building || dimmed(building); };
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
  const fire = (kind, group, x, z, now) => { const key = `${kind}:${group}`; if (!bursts.has(key)) bursts.set(key, { kind, group, x, z, at: now, seed: `${group}:${Math.floor(now)}` }); };
  // Worth a moment: done, stuck, or a storey up. Only ever for a change, and not for one nobody's looking at.
  const noticed = (id, signal, storeys, x, z, now, dim, reduced) => {
    const next = { twinkle: !!signal.twinkle, beacon: !!signal.beacon, smoke: !!signal.smoke, asleep: !!signal.asleep, offline: !!signal.offline, storeys }, kind = momentOf(states.get(id) ?? null, next);
    states.set(id, next);
    if (kind && !dim && !reduced) fire(kind, id, x, z, now);
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
      const signal = stage.puff ? { windows: 'dark', twinkle: false } : signalOf(id), { windows } = signal, dim = dimmed(building), up = boot?.tower(id), seen = up && !up.lit ? { windows: 'dark', twinkle: false, asleep: signal.asleep } : signal, phase = phaseOf(id, seen, now);
      if (seen.twinkle && !reduced) animating = true;
      hopped(id, `${windows}|${building.storeys}`, now, reduced || stage.puff);
      if (stage.puff) fire('fall', id, x, z, now);
      else { if (stage.rising && !states.has(id)) fire('spawn', id, x, z, now); noticed(id, signal, building.storeys, x, z, now, dim, reduced); }
      if (up?.lands) fire('spawn', id, x, z, now);
      // Baked while the card is up, so that the windows don't have to queue to come on.
      if (seen !== signal && boot.t <= BOOT.CARD) { const later = phaseOf(id, signal, now); stand(`${id}|${stage.storeys}|${windows}|${later}|${!!signal.asleep}`, id, x, z, () => buildTower(look, windows, stage.storeys, later), null, dim, { asleep: signal.asleep, later: true }); }
      stand(`${id}|${stage.storeys}|${seen.windows}|${phase}|${!!signal.asleep}`, id, x, z, () => buildTower(look, seen.windows, stage.storeys, phase), stage.puff ? null : id, dim, { asleep: signal.asleep, beacon: seen.beacon && !dim && blink, named: true, bounce: bounceOf(id, seen, dim, now, reduced), sparks: seen.twinkle && !dim && !reduced ? sparks(now, id) : null, ...(up && { reveal: up.rise, glowOff: !up.lit }) });
      const [craneX, craneZ] = craneSpot(view);
      // While it's working a tower has a crane at it: the plainest thing in the city that says so. It stands still under reduced motion.
      if (seen.twinkle && !stage.crane) {
        const beat = reduced ? 0 : jibBeat(now, id, JIB_BEATS), mast = Math.min(CRANE_MAST_MAX, Math.max(CRANE_MAST_MIN, Math.ceil((stage.storeys * 3 + 12) / 4) * 4));
        stand(`site:${beat}:${mast}`, `site:${id}`, x + craneX, z + craneZ, () => siteCrane(beat, mast, view), null, dim, up && { reveal: Math.min(1, (boot.t - up.litAt) / BOOT_CRANE_MS) });
      }
      if (stage.crane) stand('crane', `crane:${id}`, x + craneX, z + craneZ, () => ({ stack: crane(true) }), null, dim);
      effects(id, x, z, seen, stage, dim);
      return true;
    };
    const annexOf = (building, i, kid) => {
      const stage = { ...lifecycle.stage(kid.id, now, reduced), target: kid.leaving ? 0 : kid.storeys };
      if (stage.gone) return false;
      const at = annexAt(building, i, view), group = `${building.id}+${i}`, signal = stage.puff ? { windows: 'dark', twinkle: false } : signalOf(kid.id), dim = dimmed(building, kid.id), up = boot?.tower(kid.id), seen = up && !up.lit ? { windows: 'dark', twinkle: false, asleep: signal.asleep } : signal, phase = phaseOf(kid.id, seen, now);
      hopped(kid.id, `${signal.windows}|${kid.storeys}`, now, reduced || stage.puff);
      if (stage.puff) fire('fall', group, at.x, at.z, now); else if (stage.rising && !states.has(kid.id)) { states.set(kid.id, true); fire('spawn', group, at.x, at.z, now); }
      stand(`${group}|${stage.storeys}|${seen.windows}|${phase}|${!!signal.asleep}`, group, at.x, at.z, () => annex(building.look, i, seen.windows, stage.storeys, phase), stage.puff ? null : kid.id, dim, { asleep: signal.asleep, beacon: seen.beacon && !dim && blink, bounce: bounceOf(kid.id, seen, dim, now, reduced), ...(up && { reveal: up.rise, glowOff: !up.lit }) });
      effects(group, at.x, at.z, seen, stage, dim);
      return true;
    };
    animating = false; steaming = false;
    const quiet = !!selectedHood;
    cells.props.forEach(({ stack, x, z }, i) => stand(`prop:${stackId(stack)}`, `prop:${i}`, x, z, () => ({ stack }), null, quiet, { baked: true, ...(boot && { reveal: boot.prop(x, z), glowOff: !boot.lit(x, z) }) }));
    for (const { provider, key, x, z, connected } of plan.plants) {
      const [make, stripe] = PLANTS[provider], rising = boot?.plant(key), lit = connected && !error && (!rising || rising.on), on = lit && !reduced, phase = on ? Math.floor(now / STEAM_MS) % 4 : 0;
      if (on) steaming = true;
      stand(`plant:${provider}|${on}|${lit}|${phase}`, `plant:${key}`, x, z, () => ({ stack: make(stripe, on, lit, phase) }), null, quiet, { plant: key, ...(rising && { reveal: rising.rise, glowOff: !rising.on }) });
    }
    for (const building of plan.buildings) if (towerOf(building)) building.subagents.forEach((kid, i) => annexOf(building, i, kid));
    if (!reduced) {
      const busy = plan.buildings.filter(({ id }) => sessions.has(id) && !signalOf(id).asleep);
      for (const { id, x, z, along, colour } of traffic(plan.roads, busy, now)) { if (boot && !boot.lit(x, z)) continue; stand(`car:${colour}:${along}`, `car:${id}`, x, z, () => ({ stack: car(colour, along) }), null, quiet, { moves: true }); }
    }
    if (!reduced) boatsAt(plan.bounds, now).forEach(({ x, z, along, dir }, i) => stand(`boat:${i}:${along}:${dir}`, `boat:${i}`, x, z, () => ({ stack: boat(BOAT_SAILS[i % BOAT_SAILS.length], along, dir) }), null, quiet, { moves: true }));
    if (!reduced) ducksAt(cells.lakes, now).forEach(({ x, z, along, dir, young }, i) => stand(`duck:${along}:${dir}:${young}`, `duck:${i}`, x, z, () => ({ stack: duck(along, dir, young) }), null, quiet, { moves: true }));
    for (const [id, ghost] of ghosts) if (!(ghost.kid ? annexOf(ghost.building, ghost.i, ghost.kid) : towerOf(ghost.building))) ghosts.delete(id);
    return items.sort((a, b) => a.sy - b.sy);
  };
  const visible = item => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return x > -CULL_X && x < size.width + CULL_X && y > -CULL_UP && y < size.height + CULL_DOWN; };
  const bake = item => {
    const started = performance.now(), made = item.build(), sprite = renderSprite(made.stack, view, { dim: item.dim, asleep: item.asleep });
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
  // The ground the intro starts from.
  const bareGround = () => {
    let bare = bareGrounds.get(view);
    if (!bare) { const painted = paintGround(bareCells(cells), view); bare = { ...painted, image: toImage(painted) }; bareGrounds.set(view, bare); }
    return bare;
  };
  // Foam and glints. The ground underneath is never redrawn for them, only painted over, and a frame of them is worked out once per view.
  const seaList = frame => { const key = `${view}:${frame}`; let list = seas.get(key); if (!list) { list = seaFrame(cells.water, frame, view); seas.set(key, list); } return list; };
  const seaShows = list => { const [gx, gy] = toCanvas(camera, size, 0, 0); for (let i = 0; i < list.length; i += 3) { const x = list[i] + gx, y = list[i + 1] + gy; if (x > -8 && y > -1 && x < size.width && y < size.height) return true; } return false; };
  // The ground and the sea are one opaque sheet, as big as the canvas, made again when the sea moves or the camera does. The dashes are a few thousand rectangles and everything else here paints three times as often.
  const sheet = document.createElement('canvas'), sheetCtx = sheet.getContext('2d', { alpha: false });
  let sheetOf = null, sheetKey = '';
  const paintGroundSheet = (ground, gx, gy) => {
    const key = `${seaNow ? seaFrameDrawn : ''}|${gx}|${gy}|${size.width}|${size.height}`;
    if (key !== sheetKey || ground !== sheetOf) {
      sheetKey = key; sheetOf = ground;
      if (sheet.width !== size.width || sheet.height !== size.height) { sheet.width = size.width; sheet.height = size.height; }
      sheetCtx.fillStyle = FLOOR; sheetCtx.fillRect(0, 0, size.width, size.height);
      sheetCtx.drawImage(ground.image, gx - ground.originX, gy - ground.originY);
      if (seaNow) {
        let was = -1;
        for (let i = 0; i < seaNow.length; i += 3) {
          const x = seaNow[i] + gx, y = seaNow[i + 1] + gy, kind = seaNow[i + 2];
          if (x <= -8 || y <= -1 || x >= size.width || y >= size.height) continue;
          if (kind !== was) { sheetCtx.fillStyle = SEA_KINDS[kind].colour; was = kind; }
          sheetCtx.fillRect(x, y, SEA_KINDS[kind].w, 1);
        }
      }
    }
    ctx.drawImage(sheet, 0, 0);
  };
  const litHood = hood => {
    const key = `${hood.key}|${view}`;
    let lit = litHoods.get(key);
    if (!lit) { const painted = paintHood(cells, hood, view); lit = { ...painted, image: toImage(painted), edgeImage: toImage({ width: painted.width, height: painted.height, rgba: painted.edge }) }; litHoods.set(key, lit); }
    return lit;
  };
  const lotShade = () => { let shade = lotShades.get(view); if (!shade) { const painted = paintLotShade(view, hour); shade = { ...painted, image: toImage(painted) }; lotShades.set(view, shade); } return shade; };
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
  // In the air they go from a roof if they have one; on the ground, from where they happened.
  const flash = (target, ground, crown, under, glowing = false) => {
    for (const { kind, group, x, z, at, seed } of bursts.values()) {
      const spec = BURSTS[kind], pixels = !!spec.ground === ground && (!glowing || spec.glow) ? burst(kind, paintedAt - at, seed) : null;
      if (!pixels) continue;
      const parent = spec.crown ? under?.get(group) : null;
      if (spec.crown && !parent) continue;
      const [ax, ay] = parent ? crown(parent) : toCanvas(camera, size, ...screen(x, z, view));
      for (const pixel of pixels) { target.fillStyle = pixel.colour; target.fillRect(ax + pixel.x, ay + pixel.y, pixel.size, pixel.size); }
    }
  };
  // On the road, under everything standing. A plant being looked at shows every tower it feeds; otherwise only those drawing power show, as sparks.
  const paintPower = () => {
    const [gx, gy] = toCanvas(camera, size, 0, 0), at = (x, z) => { const [sx, sy] = screen(x, z, view); return [Math.floor(sx) + gx, Math.floor(sy) + gy]; };
    if (litPlant) {
      const plant = plan.plants.find(({ key }) => key === litPlant);
      if (plant) ctx.fillStyle = POWER[plant.provider];
      if (plant) for (const route of routes) if (route.plant === litPlant) for (const [x, z] of routeDots(route.points, POWER_DOTS)) { const [px, py] = at(x, z); ctx.fillRect(px - 1, py, 3, 2); }
    }
    for (const { x, z, head, provider } of pulses) { const [px, py] = at(x, z); ctx.fillStyle = head ? POWER_HEAD : POWER[provider]; ctx.fillRect(px - 1, py, head ? 3 : 2, head ? 2 : 1); }
  };
  const paint = list => {
    frames++;
    const ground = boot && boot.t < BOOT.POWER_FROM ? bareGround() : groundImage(), [gx, gy] = toCanvas(camera, size, 0, 0);
    paintGroundSheet(ground, gx, gy);
    for (const { sx, sy, sprite } of clouds) ctx.drawImage(sprite, sx + gx, sy + gy);
    const chosen = selectedHood && plan.hoods.find(hood => hood.key === selectedHood), lit = chosen && litHood(chosen);
    if (lit) { ctx.fillStyle = DUSK; ctx.fillRect(0, 0, size.width, size.height); ctx.drawImage(lit.image, gx - lit.originX, gy - lit.originY); }
    // A pointer on a project's sign shows which ground is its, leaving the rest of the city as it was.
    const pointedAt = hoveredHood && hoveredHood !== selectedHood && plan.hoods.find(hood => hood.key === hoveredHood), hinted = pointedAt && litHood(pointedAt);
    if (hinted) ctx.drawImage(hinted.image, gx - hinted.originX, gy - hinted.originY);
    // Sleeping sessions' lots go dark with their towers. Under a lit project's rim, not over it, so its shape stays whole.
    for (const hood of plan.hoods) for (const lot of hood.lots) if (lot.sessionId && signalOf(lot.sessionId).asleep) {
      const shade = lotShade(), [sx, sy] = screen(lot.x, lot.z, view), [px, py] = toCanvas(camera, size, sx, sy);
      ctx.drawImage(shade.image, px - shade.originX, py - shade.originY);
    }
    for (const over of [lit, hinted]) if (over) ctx.drawImage(over.edgeImage, gx - over.originX, gy - over.originY);
    for (const kind of Object.keys(lots)) { const lot = lots[kind] && lotOf(lots[kind]); if (lot) outline(lot, HIGHLIGHT[kind]); }
    flash(ctx, true);
    paintPower();
    const placed = list.filter(({ item }) => !item.over).map(({ item, sprite }) => { const [x, y] = toCanvas(camera, size, item.sx, item.sy); return { sprite, x, y, item, opens: item.opens, left: x - sprite.originX, top: y - sprite.originY }; });
    drawn = placed.filter(item => item.opens); plantsDrawn = placed.filter(({ item }) => item.plant);
    syncLabels(placed);
    for (const { sprite, x, y, item } of placed) if (sprite.shadowImage && !item.baked && !(item.reveal < 1)) ctx.drawImage(sprite.shadowImage, x - sprite.shadow.originX, y - sprite.shadow.originY);
    // A hop lifts and squashes the picture and leaves the shadow on the ground.
    for (const { sprite, x, y, item } of placed) if (sprite.image) { if (item.reveal < 1) drawRising(ctx, sprite, x - sprite.originX, y - sprite.originY, item.reveal); else drawBounced(ctx, sprite.image, sprite, x, y, item.bounce); }
    if (boot) paintBootDark(gx, gy);
    ctx.fillStyle = hour === 'night' ? BIRD_NIGHT : BIRD_DAY;
    for (const { sx, sy, wings } of birds) { const px = sx + gx, py = sy + gy; ctx.fillRect(px - 1, py, 3, 1); ctx.fillRect(px - 2, py - 1 + wings * 2, 1, 1); ctx.fillRect(px + 2, py - 1 + wings * 2, 1, 1); }
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
    flash(ctx, false, crown, under);
    if (boot) paintBootSparks(ctx);
    // Cars and steam don't glow, and this is the dearest part of a paint: it waits until something that does has changed.
    const glowing = bloom && [gx, gy, chosen?.key, size.width, size.height, ...(boot && boot.t >= BOOT.POWER_FROM ? [boot.t] : []), ...placed.filter(({ sprite, item }) => (sprite.glowImage && !item.glowOff) || item.sparks || item.beacon).map(({ sprite, x, y, item }) => `${item.key}:${sprite.glowImage && !item.glowOff ? 1 : 0}:${x},${y}:${item.beacon ? 1 : 0}:${item.bounce?.lift ?? ''},${item.bounce?.squash ?? ''}:${item.sparks?.map(spark => spark.x * 100 + spark.y) ?? ''}`), ...[...bursts.values()].filter(({ kind }) => BURSTS[kind].glow).map(({ group }) => `${group}:${paintedAt}`)].join();
    if (bloom && glowing !== glowDrawn) {
      glowDrawn = glowing;
      const shiftX = lampOffset(gx), shiftY = lampOffset(gy), kx = glowCanvas.width / size.width, ky = glowCanvas.height / size.height;
      lampsCtx.setTransform(1, 0, 0, 1, 0, 0); lampsCtx.clearRect(0, 0, lamps.width, lamps.height); lampsCtx.setTransform(1, 0, 0, 1, shiftX, shiftY);
      if (lit) lampsCtx.drawImage(lit.edgeImage, gx - lit.originX, gy - lit.originY);
      for (const { sprite, x, y, item } of placed) if (sprite.glowImage && !item.glowOff) drawBounced(lampsCtx, sprite.glowImage, sprite, x, y, item.bounce);
      spray(lampsCtx);
      if (boot) paintBootSparks(lampsCtx);
      flash(lampsCtx, false, crown, under, true);
      lampsCtx.fillStyle = BEACON;
      for (const entry of placed) if (entry.item.beacon) { const [x, y] = crown(entry); lampsCtx.fillRect(x - 1, y - 3, 3, 3); }
      bloom.draw(glowCtx, lamps, -shiftX * kx, -shiftY * ky, lamps.width * kx, lamps.height * ky);
    }
    followMenu();
  };

  // Night until the power reaches it. Dust goes on top, or the towers would land in the dark with no one to see.
  const paintBootDark = (gx, gy) => {
    bootShade ??= createBootShade();
    bootShade.paint(ctx, size.width, size.height, boot, (px, py) => unproject(px - gx, py - gy, view));
    flash(ctx, true);
  };
  const paintBootSparks = target => {
    const [gx, gy] = toCanvas(camera, size, 0, 0);
    for (const { x, z, head, provider } of boot.sparks()) { const [sx, sy] = screen(x, z, view), px = Math.floor(sx) + gx, py = Math.floor(sy) + gy; target.fillStyle = head ? POWER_HEAD : POWER[provider]; target.fillRect(px - 1, py, head ? 3 : 2, head ? 2 : 1); }
    for (const { x, z, along, k, head } of boot.wireSparks()) for (const side of [-PYLON_REACH, PYLON_REACH]) {
      const [sx, sy] = screen(x + (along ? 0 : side), z + (along ? side : 0), view), px = Math.round(sx) + gx, py = Math.round(sy - PYLON_ARM + WIRE_SAG * 4 * k * (1 - k)) + gy;
      target.fillStyle = head ? POWER_HEAD : WIRE_SPARK; target.fillRect(px - 1, py - 1, head ? 3 : 2, head ? 3 : 2);
    }
  };

  // The DOM over the city, kept in step with whatever was just drawn. The labels only touch what changed.
  const syncLabels = placed => {
    const at = new Map(placed.map(entry => [entry.item.group, entry])), buildingOf = id => plan.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id));
    labels.sync(drawn.map(({ opens: id, sprite, item }) => {
      const session = sessions.get(id);
      return { id, ax: item.sx, ay: item.sy - sprite.originY, name: item.named ? session?.title : null, bubble: session ? signalOf(id).bubble : null, unread: session && hooks.isUnread?.(session), dim: item.dim, mood: session ? signalOf(id).mood : null };
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
      const spot = at.get(`plant:${plant.key}`);
      if (spot) tags.push({ key: plant.key, plant: plant.key, ...plantTag(plant, snapshot.usage), ax: spot.item.sx, ay: spot.item.sy - spot.sprite.originY - TAG_Y });
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

  // The sidebar's map follows the scene: redrawn when the city or what's picked changes, its box whenever the camera moves.
  let mapEl = null, mapRev = 0, mapDrawn = '', mapOff = null;
  const litNow = () => { const one = selectedHood ?? hoveredHood; return one ?? (test ? new Set(plan.buildings.filter(building => passes(building.id) || building.subagents.some(kid => passes(kid.id))).map(building => building.hoodKey)) : null); };
  const syncMap = () => {
    const el = hooks.mapScreen?.() ?? null;
    if (el !== mapEl) { mapOff?.(); mapEl = el; mapDrawn = ''; mapOff = el && steerMap(el, (cx, cy, dragging) => { if (!plan || !camera) return; if (dragging) jump({ cx, cy }); else glideTo({ cx, cy }); }); }
    if (!el) return;
    const lit = litNow(), key = `${mapRev}|${view}|${lit instanceof Set ? [...lit].join() : lit ?? ''}`;
    if (key !== mapDrawn && paintMap(el, plan, view, { lit, time: hour, asleep: id => !!sessions.get(id) && !!signalOf(id).asleep })) mapDrawn = key;
    trackMap(el, eye, boxW, boxH);
  };

  const powerNow = now => {
    if (effectiveAtmosphere() !== 'full') return [];
    const [gx, gy] = toCanvas(camera, size, 0, 0), wanted = routes.filter(({ id, plant }) => plant === litPlant || (signalOf(id).mood === 'working' && !dimmedId(id)));
    return pulsesAt(wanted, now).filter(({ x, z }) => { const [sx, sy] = screen(x, z, view), px = sx + gx, py = sy + gy; return px > -4 && py > -4 && px < size.width + 4 && py < size.height + 4; });
  };
  // Birds and clouds are in world space, so they turn with the city. Only what's on screen counts: nothing else asks for a paint.
  const birdsNow = now => {
    if (effectiveAtmosphere() !== 'full') return [];
    const [gx, gy] = toCanvas(camera, size, 0, 0);
    return birdsAt(plan.bounds, now).map(({ x, z, wings }) => { const [sx, sy] = screen(x, z, view); return { sx: Math.floor(sx), sy: Math.floor(sy) - BIRD_LIFT, wings }; }).filter(({ sx, sy }) => sx + gx > -4 && sy + gy > -4 && sx + gx < size.width + 4 && sy + gy < size.height + 4);
  };
  const cloudSprite = shape => {
    let sprite = cloudSprites.get(shape);
    if (sprite) return sprite;
    const { w, h, rows } = cloudBlob(shape);
    sprite = document.createElement('canvas'); sprite.width = w; sprite.height = h;
    const c = sprite.getContext('2d'); c.fillStyle = CLOUD_INK; rows.forEach(([from, length], y) => { if (length) c.fillRect(from, y, length, 1); });
    cloudSprites.set(shape, sprite);
    return sprite;
  };
  // A cloud's shadow needs a sun, so only by day. Reduced motion has none either: a shadow that never moves is only a stain.
  const cloudsNow = now => {
    if (effectiveAtmosphere() !== 'full' || hour === 'night') return [];
    const [gx, gy] = toCanvas(camera, size, 0, 0);
    return cloudsAt(plan.bounds, now).map(({ x, z, shape }) => { const sprite = cloudSprite(shape), [sx, sy] = screen(x, z, view); return { sx: Math.floor(sx - sprite.width / 2), sy: Math.floor(sy - sprite.height / 2), sprite }; }).filter(({ sx, sy, sprite }) => sx + gx + sprite.width > 0 && sy + gy + sprite.height > 0 && sx + gx < size.width && sy + gy < size.height);
  };
  // One sprite baked per frame at most; until it's ready a building shows what it last looked like.
  const step = now => {
    if (!plan || !camera) return false;
    syncMap();
    paintedAt = now;
    if (boot) runBoot(now);
    for (const [key, { kind, at }] of bursts) if (now - at >= BURSTS[kind].ms) { bursts.delete(key); dirty = true; }
    if (bursts.size) dirty = true;
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
    pulses = powerNow(now);
    if (pulses.length) animating = true;
    birds = birdsNow(now); clouds = cloudsNow(now);
    if (birds.length) animating = true;
    if (items.some(item => item.moves)) animating = true;
    if (items.length * 6 > sprites.max) sprites.max = items.length * 6;
    let baked = false, waiting = false;
    // Behind the card it can take its time over more of them: nobody is looking, and the clock waits.
    const bakeUntil = boot && boot.t <= BOOT.CARD ? performance.now() + BOOT_BAKE_MS : 0;
    for (const item of items) {
      let sprite = sprites.get(item.key);
      if (!sprite && (!baked || performance.now() < bakeUntil)) { sprite = bake(item); baked = true; } else if (!sprite) waiting = true;
      if (item.later) continue;
      if (sprite) shown.set(item.group, sprite); else sprite = shown.get(item.group);
      if (sprite) ready.push({ item, sprite });
    }
    // Only worth a paint while some of it is on screen.
    const frameOfSea = reducedMotion() ? -1 : Math.floor(now / STEAM_MS) % SEA_FRAMES;
    if (frameOfSea >= 0) steaming = true;
    seaNow = frameOfSea >= 0 ? seaList(frameOfSea) : null; seaFrameDrawn = frameOfSea;
    if (seaNow && !seaShows(seaNow)) seaNow = null;
    const drawing = (seaNow ? `sea${frameOfSea},` : '') + pulses.map(({ x, z }) => `${x},${z}`).join(' ') + birds.map(({ sx, sy, wings }) => `${sx},${sy},${wings}`).join(' ') + clouds.map(({ sx, sy }) => `${sx},${sy}`).join(' ') + ready.map(({ item, sprite }) => `${item.key}:${sprite.width}:${item.lift ?? ''}:${item.moves ? `${item.sx},${item.sy}` : ''}:${item.beacon ? 1 : 0}:${item.bounce ? `${item.bounce.lift},${item.bounce.squash}` : ''}:${item.sparks ? item.sparks.map(spark => spark.x * 100 + spark.y).join('/') : ''}`).join();
    if (dirty || baked || drawing !== lastDrawn) { paint(ready); lastDrawn = drawing; dirty = false; }
    if (labelsStale) { moveLabels(); followMenu(); }
    bootReady = !waiting && !baked;
    return waiting || baked;
  };
  const moving = () => plan && animating;
  const cancel = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = timer = 0; };
  const frame = now => {
    raf = 0; clearTimeout(timer); timer = 0;
    if (gone || document.hidden) return;
    try {
      const more = step(now);
      if (more || dirty || boot || glide || coast || keysDown.size || hops.size || bursts.size) schedule();
      else if (moving()) timer = setTimeout(() => { timer = 0; schedule(); }, STEP_MS);
      else if (steaming) timer = setTimeout(() => { timer = 0; schedule(); }, STEAM_MS - now % STEAM_MS + 1);
    } catch (problem) { failure = problem; } // The next update throws it, and syncScene falls back to the list.
  };
  const schedule = () => { if (!raf && !gone && !document.hidden) raf = requestAnimationFrame(frame); };
  const wake = () => { dirty = true; cancel(); schedule(); };
  const stopAtmosphere = onAtmosphereChange(wake);
  const onVisible = () => { if (document.hidden) boot?.skip(); else wake(); };

  // ---- The intro. Nothing here touches the city's own state: towers go on working out their real signals underneath, so that the end of it isn't a change.
  const skipBoot = () => { if (boot && !boot.over) { boot.skip(); wake(); } };
  const bootListeners = [[document, 'pointerdown'], [window, 'keydown'], [box, 'wheel']];
  // Only on arrival, and never over a chat. Dropped rather than saved for later: the city it would build is already there.
  const startBoot = () => {
    if (!takeBootAsk(document.documentElement, performance.now()) || !camera || hooks.selected?.() || document.hidden || reducedMotion()) return;
    boot = new CityBoot(plan, routes, powerLines(plan)); bootReady = false;
    bootCard = createBootCard(box);
    box.classList.add('city-booting');
    groundImage(); bareGround();
    for (const [target, type] of bootListeners) target.addEventListener(type, skipBoot, { capture: true, passive: true });
  };
  const endBoot = () => {
    const { skipped } = boot;
    boot = null; bootCard?.dispose(); bootCard = null; bootShade = null; bareGrounds.clear(); dirty = true;
    box.classList.remove('city-booting');
    for (const [target, type] of bootListeners) target.removeEventListener(type, skipBoot, { capture: true });
    if (!skipped) labels.pop();
  };
  const runBoot = now => {
    if (hooks.selected?.() || reducedMotion()) boot.skip();
    boot.tick(now, bootReady && (!bootCard || bootCard.ready));
    dirty = true;
    const title = boot.card();
    if (title.gone) { bootCard?.dispose(); bootCard = null; } else bootCard?.draw(title);
    if (boot.over) endBoot();
  };
  document.addEventListener('visibilitychange', onVisible);
  // Dawn and dusk. Twice a day it repaints the ground and everything cut from it, so once a minute is plenty to notice.
  const daylight = () => {
    const now = timeOfDay();
    if (now === hour) return;
    hour = now; grounds.clear(); seas.clear(); litHoods.clear(); lotShades.clear(); mapRev++;
    if (plan) cells = groundCells(plan, hour);
    wake();
  };
  clock = setInterval(daylight, 60000);
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
    // A building whose session has ended opens nothing: a press goes through it to the lot.
    if (sprite && sessions.has(sprite.opens)) return { id: sprite.opens, lot: null };
    const [sx, sy] = fromCanvas(camera, size, px, py), [x, z] = unproject(sx, sy, view), lot = lotAt(plan, x, z);
    return lot ? { id: lot.sessionId, lot } : null;
  };
  const plantAt = event => { const [px, py] = artAt(event); return hitSprites(plantsDrawn, px, py)?.item.plant ?? null; };
  const lightPlant = key => { if (key !== litPlant) { litPlant = key; wake(); } };
  const talkTo = id => {
    const building = id && sessions.has(id) && !fired.has(id) && plan?.buildings.find(b => b.id === id || b.subagents.some(kid => kid.id === id));
    if (!building) return;
    if (!reducedMotion()) hops.set(id, performance.now());
    panToWorld(building.x, building.z); hooks.openPanel?.(id);
  };
  // A press on the ground answers where it landed, as an order does in a strategy game.
  const tapped = event => {
    if (reducedMotion()) return;
    const [sx, sy] = fromCanvas(camera, size, ...artAt(event)), [x, z] = unproject(sx, sy, view), now = performance.now();
    bursts.delete('tap:tap'); fire('tap', 'tap', x, z, now); schedule();
  };
  // A pointer shows a plant's towers by being on it; a finger has to tap it, and tap again or elsewhere to stop.
  const clickAt = event => { const hit = pickAt(event), plant = hit ? null : plantAt(event); if (event.pointerType !== 'mouse') lightPlant(plant === litPlant ? null : plant); if (hit?.lot) tapped(event); if (hit?.id) talkTo(hit.id); else if (hit?.lot && !hit.lot.sessionId) askLot(hit.lot, false); };

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
    const plant = hit ? null : plantAt(event);
    canvas.style.cursor = hit || plant ? 'pointer' : 'grab';
    lightPlant(plant);
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
  const onLeave = () => { if (!pointers.size) { setLot('hover', null); lightPlant(null); card.show(null); } };
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
  labels = createLabels(box, { onSession: talkTo, onHood: selectHood, onHoodHover: key => { if (key !== hoveredHood) { hoveredHood = key; dirty = true; wake(); } }, onPlantHover: key => lightPlant(key), onPlantTap: key => lightPlant(key === litPlant ? null : key), inTheWay: () => controls.rects() });
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
      if (setSunPlace(snapshot.location)) daylight();
      sessions = new Map(snapshot.sessions.map(session => [session.id, session]));
      layout = snapshot.office ? sharedLayout(snapshot.office) : layoutOffice(snapshot.sessions, layout);
      const before = plan, now = performance.now();
      plan = cityPlan(layout, snapshot.towers, plan, snapshot.providers, snapshot.sessions, snapshot.claudeAccounts);
      routes = powerRoutes(plan, snapshot.sessions);
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
      if (key !== cellsKey) { cells = groundCells(plan, hour); cellsKey = key; grounds.clear(); seas.clear(); litHoods.clear(); dirty = true; }
      if (selectedHood && !plan.hoods.some(hood => hood.key === selectedHood)) selectedHood = null;
      if (hoveredHood && !plan.hoods.some(hood => hood.key === hoveredHood)) hoveredHood = null;
      // Someone else may have just taken the lot it was asking about.
      if (lots.asked && menu.open && !menu.asking) { const lot = lotOf(lots.asked); if (!lot || lot.sessionId) menu.close(); }
      if (!camera) place();
      if (!before) startBoot();
      // One agent not being there may just mean it isn't installed; that shows on its plant. Lost means nothing can be reached.
      controls.setLost(!!error || !!snapshot.providers?.length && snapshot.providers.every(provider => !provider.connected));
      controls.setWaiting(snapshot.sessions.filter(session => ['permission', 'question'].includes(session.status)).length);
      mapRev++; dirty = true; cancel();
      // Drawn here, not left to the next frame, so that a canvas that can't draw is caught by syncScene.
      if (step(performance.now()) || moving() || boot || glide || coast) schedule();
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
      if (boot) { boot.skip(); endBoot(); }
      gone = true; cancel(); stopAtmosphere(); clearInterval(clock); mapOff?.(); resize.disconnect(); document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('pointerdown', onPress, true);
      for (const [target, type, listener] of listening) target.removeEventListener(type, listener);
      box.removeEventListener('wheel', onWheel); controls.dispose(); card.dispose(); labels.dispose(); menu.dispose();
      sprites.clear(); shown.clear(); grounds.clear(); ghosts.clear(); fired.clear(); canvas.remove(); glowCanvas.remove(); plan = null;
    },
    // For the local harness: no cost unless something calls it.
    inspect: () => ({ camera, eye, glide: !!glide, coast: !!coast, placed, size, view, frames, bakeMs: [...bakeMs], groundMs: [...groundMs], cached: sprites.size, plan, lots: { ...lots }, drawn, ghosts: ghosts.size, animating, boot: boot?.t ?? null }),
  };
  return scene;
}
