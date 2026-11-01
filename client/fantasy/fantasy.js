// Fantasy: each project is a fight, each session a party member, each subagent a minion. One canvas draws every fight in view, each in its tile's rectangle, and a tapped tile grows to fill it.
import * as THREE from 'three';
import './fantasy.css';
import { VACANT_MS } from '../office/layout.js';
import { officeHasKeys } from '../scene-keys.js';
import { hireChoices } from '../hire.js';
import { createMenu, frameTime } from '../scene-ui.js';
import { Fight, createProps } from './fight.js';
import { clearLabels } from './fx.js';
import { createHud } from './hud.js';
import { PlatePainter } from './places.js';
import { createSay } from './say.js';
import { clamp, mix } from './rig.js';
import { buildFights } from './roster.js';
import { lookFrom } from './worldmap.js';

const NIGHT = 0x0e0b08, LOOK_KEY = 'fantasy-look', BUSY_MS = 1000 / 60, RESTING_MS = 1000 / 30, MOST_PIXELS = 2560 * 1600;
// The canvas reaches past the screen, so a scroll that outruns the drawing still finds fights there: all of it during a scroll, and at rest just enough for one's first frames.
const OVERSCAN = 240, RESTING_OVERSCAN = 64, SCROLLING_MS = 300;
const smooth = t => t * t * (3 - 2 * t);
const stored = () => { try { return localStorage.getItem(LOOK_KEY) === 'ps1'; } catch { return false; } };
const store = low => { try { localStorage.setItem(LOOK_KEY, low ? 'ps1' : 'hd'); } catch { /* the look just won't be remembered */ } };

export function webglAvailable() {
  try { const gl = document.createElement('canvas').getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
}

const within = (node, x, y) => { const r = node.getBoundingClientRect(); return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };

export function mountFantasy(container, hooks = {}) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches, look = { value: stored() ? 0 : 1 }, low = () => look.value < .5;
  const wrap = document.createElement('div'); wrap.className = 'fy-stage'; container.append(wrap);
  const paint = document.createElement('div'); paint.className = 'fy-paint'; wrap.append(paint);
  // The old look's words: the fights are drawn small and blown up, but what people say is drawn sharp on a layer above them.
  const sharp = document.createElement('canvas'), words = sharp.getContext('2d'); sharp.className = 'fy-sharp'; sharp.hidden = true; paint.append(sharp);
  const painter = new PlatePainter(), props = createProps(), fights = new Map(), fired = new Map(), pointers = new Map();
  let renderer = null, raf = 0, broken = false, last = null, latest = null, W = 1, H = 1, scale = 1, zoomed = null, shown = null, zoomT = 0, lastFrame = performance.now(), touched = 0, sinceRefresh = 0, side = 0, sideShown = 0, frozen = false, filter = null, gesture = null, covers = { bottom: 0, top: 0 }, lone = false, scrolled = -Infinity;
  const paintH = () => H + OVERSCAN * 2;

  const announce = (fight, member, ability) => { if (zoomed === fight) hud.banner(ability.name, ability.line, ability.dur + .4, ability.big || ability.summon, ability.final); };
  const stage = { plates: painter, props, look, calm, low, announce, words: null, selected: () => hooks.selected?.(), isZoomed: fight => zoomed === fight, phone: () => Math.min(W, H) < 640 };

  const lost = event => { event.preventDefault(); broken = true; stop(); };
  function makeRenderer() {
    const next = new THREE.WebGLRenderer({ antialias: !low() && (devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
    next.outputColorSpace = THREE.LinearSRGBColorSpace; next.setClearColor(NIGHT, 1); next.autoClear = true;
    next.domElement.classList.toggle('fy-low', low()); next.domElement.addEventListener('webglcontextlost', lost);
    if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.remove(); renderer.dispose(); renderer.forceContextLoss(); }
    paint.prepend(next.domElement); renderer = next;
  }
  function resize() {
    const box = container.getBoundingClientRect(); W = Math.max(1, box.width); H = Math.max(1, box.height);
    // The old look is drawn small, about what a console put on a good screen, and at whole multiples so every pixel comes out the same size.
    scale = low() ? 1 / Math.max(1, Math.round(Math.max(W, H * 1.2) / 720)) : Math.min(devicePixelRatio || 1, 2, Math.sqrt(MOST_PIXELS / (W * H)));
    renderer.setPixelRatio(1); renderer.setSize(Math.round(W * scale), Math.round(paintH() * scale), false);
    paint.style.width = `${W}px`; paint.style.height = `${paintH()}px`;
    measure();
  }
  // The sharp layer only exists at size in the old look; the new one draws its words with everything else.
  function prepareWords() {
    const on = low(), fine = Math.min(devicePixelRatio || 1, 2), wide = on ? Math.round(W * fine) : 1, tall = on ? Math.round(paintH() * fine) : 1;
    sharp.hidden = !on;
    if (sharp.width !== wide || sharp.height !== tall) { sharp.width = wide; sharp.height = tall; } else if (on) words.clearRect(0, 0, wide, tall);
    stage.words = on ? { context: words, fine: wide / renderer.domElement.width, height: renderer.domElement.height } : null;
  }
  // An open panel takes the right of the screen, so the fights and their windows make do with what's left. One that leaves too little just covers them.
  function panelSide() {
    const panel = document.getElementById('panel');
    if (!panel || panel.hidden) return 0;
    const over = panel.offsetWidth - (document.documentElement.clientWidth - container.getBoundingClientRect().right);
    return over > 0 && W - over >= 320 ? over : 0;
  }
  // Windows move only when their contents do, so the fights don't ask for layout every frame.
  function measure() {
    const open = panelSide();
    if (open !== side) { side = open; hud.ui.style.right = side ? `${side}px` : ''; }
    hud.layout(hud.body.clientWidth, hud.body.clientHeight);
    covers = { bottom: hud.wins.offsetHeight ? (hud.wins.offsetHeight + 8) / H : 0, top: hud.top.offsetHeight ? (hud.top.offsetHeight + 8) / H : 0 };
    for (const fight of fights.values()) { const tile = hud.tile(fight.project); fight.lowH = tile?.querySelector('.fy-t-low')?.offsetHeight ?? 0; }
  }

  function zoom(fight, flash = true) {
    if (zoomed === fight) return;
    if (zoomed) zoomed.resetView();
    zoomed = fight; shown = fight; seat();
    if (flash) fight.fx.flash(0xffffff, .55);
    hud.focus(fight.data, lone); hud.refresh(fight.data); measure(); setHover(null);
  }
  // A lone fight has nothing to choose between, so it opens by itself and gives way when a second one arrives.
  function settle() {
    const all = [...fights.values()], only = all.length === 1 && !(filter && !matches(all[0].data, filter)) ? all[0] : null;
    if (only) { lone = true; if (zoomed === only) hud.setLone(true); else zoom(only, false); }
    else if (lone) { lone = false; if (zoomed) unzoom(); }
  }
  function unzoom() {
    if (!zoomed) return;
    zoomed.resetView(); zoomed.hoverId = null; zoomed = null;
    hud.focus(null); sayTo(null); wrap.style.cursor = '';
  }
  const peopleAt = (project, fight, event) => { const box = hud.tile(project).getBoundingClientRect(); return fight.hit(event.clientX - box.left, event.clientY - box.top, box.width, box.height, true); };
  // Hovering a tile's people, as hovering a zoomed fight's does.
  let peeked = null;
  function peek(project, event, row) {
    const fight = project ? fights.get(project) : null, id = fight && !zoomed ? row || peopleAt(project, fight, event) : null;
    if (peeked && peeked !== fight) peeked.hoverId = null;
    peeked = fight; if (fight) fight.hoverId = id;
    if (!zoomed) sayTo(id ? fight : null, id);
  }
  function setHover(id, at) {
    if (!zoomed) return;
    zoomed.hoverId = id;
    wrap.style.cursor = id ? 'pointer' : '';
    sayTo(id && at ? zoomed : null, id);
  }
  // Whoever's hovered says more, in the bubble they already had.
  function sayTo(fight, id) {
    const next = fight || null, who = next ? id : null;
    if (next === sayFight && who === sayId) return; // The mouse moving over the same person changes nothing.
    sayFight = next; sayId = who; say.show(null); saying();
  }
  const rectOfFight = fight => zoomed === fight ? { left: 0, top: 0, right: W, bottom: H } : (() => { const tile = hud.tile(fight.project); return tile ? rectOf(tile, container.getBoundingClientRect()) : null; })();
  function saying() {
    if (!sayId) return;
    const session = last?.sessions?.find(s => s.id === sayId), anchor = sayFight.anchorOf(sayId), rect = rectOfFight(sayFight);
    if (!session || !anchor || !rect) { say.show(null); return; }
    const member = sayFight.members.get(sayId), height = rect.bottom - rect.top, width = rect.right - rect.left;
    say.show(sayId, { words: member?.words, facts: hooks.describe?.(session), session, minions: member?.data.minions.length ?? 0 }, { wide: anchor.wide * width, tall: anchor.tall * height });
    say.place(rect.left + anchor.x * width, rect.top + anchor.y * height, W - side, zoomed ? covers.top * H : 8);
  }

  const hud = createHud(container, {
    zoom: project => { const fight = fights.get(project); if (fight) zoom(fight); },
    // From the overview: a person opens, the rest of the tile takes you into the fight.
    pick: (project, event, id) => {
      const fight = fights.get(project); if (!fight) return;
      const hit = id || (event.detail ? peopleAt(project, fight, event) : null);
      peek(null);
      if (hit) hooks.openPanel?.(hit); else zoom(fight);
    },
    peek,
    back: unzoom,
    open: id => hooks.openPanel?.(id),
    hover: id => { if (zoomed) { zoomed.hoverId = id; sayTo(id ? zoomed : null, id); } },
    next: () => { const session = hooks.nextWaiting?.(); if (session) scene.talkTo(session.id); },
    list: () => hooks.showList?.(),
    // A new agent: in the fight you're in, or wherever you name, suggesting the folders sessions run in.
    spawn: control => {
      if (dismissed) { dismissed = false; return; } // That press just closed this same menu.
      const box = control.getBoundingClientRect(), sessions = latest?.sessions || [], cwd = zoomed?.data.members.find(member => member.session?.cwd)?.session.cwd ?? null;
      menu.show(cwd, { clientX: box.left - 18, clientY: box.bottom - 10 }, true, hireChoices(last, cwd ?? ''), cwd === null ? [...new Set(sessions.map(session => session.cwd).filter(Boolean))].sort() : []);
    },
    look: setLook,
    reset: () => zoomed?.resetView(),
  });
  hud.setLook(low());
  hud.focus(null);
  const say = createSay(container, calm);
  let sayFight = null, sayId = null;

  function setLook(on) {
    if (on === low()) return;
    look.value = on ? 0 : 1; store(on); makeRenderer(); resize(); hud.setLook(on);
    for (const fight of fights.values()) fight.setLook(on);
  }

  const rectOf = (node, box) => { const r = node.getBoundingClientRect(); return { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top }; };
  const toBuf = r => ({ x: Math.round(r.left * scale), y: Math.round((paintH() - r.bottom) * scale), w: Math.max(1, Math.round((r.right - r.left) * scale)), h: Math.max(1, Math.round((r.bottom - r.top) * scale)) });
  const blend = (a, b, k) => ({ left: mix(a.left, b.left, k), top: mix(a.top, b.top, k), right: mix(a.right, b.right, k), bottom: mix(a.bottom, b.bottom, k) });
  const clipTo = (r, clip) => ({ left: Math.max(r.left, clip.left), top: Math.max(r.top, clip.top), right: Math.min(r.right, clip.right), bottom: Math.min(r.bottom, clip.bottom) });

  // Over the tiles the canvas lives in their scroller, so the browser carries each drawn fight with its frame however late the next drawing is. A fight growing to fill the screen needs the whole stage. Either way it's placed on its own pixels, so a fight scrolling by keeps its place in them. Returns where its corner is.
  function seat() {
    const home = shown ? wrap : hud.under, box = container.getBoundingClientRect(), from = home.getBoundingClientRect(), snap = value => Math.round(value * scale) / scale;
    if (paint.parentNode !== home) home.append(paint);
    const x = snap(box.left - from.left), y = snap(box.top - OVERSCAN - from.top), move = `translate(${x}px, ${y}px)`;
    if (paint.style.transform !== move) paint.style.transform = move;
    return { left: from.left + x, top: from.top + y };
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // Left open all day, a fight nobody's fighting doesn't need every refresh of the screen.
    const still = zoomT % 1 === 0 && now - touched > 1500 && [...fights.values()].every(fight => fight.quiet);
    if (now - lastFrame < (still ? RESTING_MS : BUSY_MS) - 1.5) return;
    try {
      const real = frameTime(now, lastFrame, .1); lastFrame = now;
      zoomT = clamp(zoomT + (zoomed ? real / .26 : -real / .2));
      if (calm) zoomT = zoomed ? 1 : 0;
      if (zoomT <= 0 && !zoomed) shown = null;
      sinceRefresh += real; if (sinceRefresh > .5) { sinceRefresh = 0; refresh(); }
      sideShown = calm ? side / W : mix(sideShown, side / W, 1 - Math.exp(-real * 14));
      hud.tick(real);
      renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
      prepareWords();
      const box = seat(), full = rectOf(container, box), k = smooth(zoomT), scroller = rectOf(hud.tiles, box), reach = shown ? 0 : now - scrolled < SCROLLING_MS ? OVERSCAN : RESTING_OVERSCAN, inView = { ...scroller, top: scroller.top - reach, bottom: scroller.bottom + reach };
      if (k < 1) for (const fight of fights.values()) {
        if (fight === shown) continue;
        const tile = hud.tile(fight.project);
        if (!tile || tile.hidden) continue;
        const rect = rectOf(tile, box), clip = clipTo(rect, inView);
        if (clip.bottom <= clip.top || clip.right <= clip.left) continue;
        fight.tick(real, frozen);
        fight.render(renderer, toBuf(rect), toBuf(clip), scale, { bottom: (fight.lowH || 0) / (rect.bottom - rect.top), top: 0 }, real);
      }
      if (shown) {
        const tile = hud.tile(shown.project), from = tile ? rectOf(tile, box) : full, rect = blend(from, full, k), clip = blend(clipTo(from, inView), full, k), height = rect.bottom - rect.top;
        shown.tick(real, frozen);
        shown.render(renderer, toBuf(rect), toBuf(clip), scale, { bottom: mix((shown.lowH || 0) / Math.max(1, height), covers.bottom, k), top: mix(0, covers.top, k), right: mix(0, sideShown, k) }, real);
      }
      saying();
      // The sidebar map's camera mark stands behind the open fight's party, looking the way its camera does.
      lookFrom(hooks.mapScreen?.(), zoomed?.project ?? null, zoomed?.view?.yaw ?? 0);
    } catch (error) { console.error(error); broken = true; stop(); }
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function refresh() {
    const data = zoomed && [...fights.values()].includes(zoomed) ? zoomed.data : null;
    hud.refresh(data); measure();
    const waiting = latest ? latest.sessions.filter(session => ['permission', 'question'].includes(session.status)).length : 0;
    hud.status({ error: frozen, waiting, usage: last?.usage });
  }
  const matches = (data, test) => data.members.some(member => test(member.session) || member.minions.some(minion => test(minion.session)));
  function apply() {
    if (!latest) return;
    const now = Date.now();
    for (const [id, at] of fired) if (now - at > VACANT_MS + 10_000) fired.delete(id);
    const datas = buildFights(latest.sessions.filter(session => !fired.has(session.id)), session => hooks.isUnread?.(session) ?? false, latest.battlefields), projects = new Set(datas.map(data => data.project));
    for (const [project, fight] of fights) if (!projects.has(project)) { if (zoomed === fight) unzoom(); if (shown === fight) { shown = null; zoomT = 0; } fight.dispose(); fights.delete(project); }
    for (const data of datas) { const fight = fights.get(data.project); if (fight) fight.sync(data); else fights.set(data.project, new Fight(data, stage)); }
    hud.setFights(datas, data => filter ? !matches(data, filter) : false);
    settle();
    measure();
  }

  // Dragging orbits the fight in focus, a tap asks whoever's under it, and two fingers zoom.
  const local = event => { const box = container.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
  function down(event) {
    if (!zoomed) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    wrap.setPointerCapture?.(event.pointerId);
    gesture = pointers.size === 1 ? { x: event.clientX, y: event.clientY, moved: false } : { pinch: spread(), moved: true };
  }
  function spread() { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0; }
  function move(event) {
    if (!zoomed) return;
    if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse') { const [x, y] = local(event); setHover(zoomed.hit(x, y, W, H), event); } return; }
    const was = pointers.get(event.pointerId); pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size >= 2 && gesture?.pinch) { const now = spread(); if (now > 0) { zoomed.zoomBy(gesture.pinch / now); gesture.pinch = now; } return; }
    if (!gesture) return;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) { gesture.moved = true; setHover(null); }
    if (gesture.moved) zoomed.orbit(event.clientX - was[0], event.clientY - was[1]);
  }
  function up(event) {
    const had = pointers.delete(event.pointerId), tap = had && gesture && !gesture.moved && pointers.size === 0;
    if (pointers.size === 0) gesture = null;
    if (tap && zoomed) { const [x, y] = local(event), id = zoomed.hit(x, y, W, H); if (id) hooks.openPanel?.(id); }
  }
  const cancel = event => { pointers.delete(event.pointerId); if (pointers.size === 0) gesture = null; };
  const wheel = event => { if (!zoomed) return; event.preventDefault(); zoomed.zoomBy(Math.exp(event.deltaY * .001)); };
  const leave = () => { if (zoomed && !pointers.size) setHover(null); };
  const reset = () => zoomed?.resetView();
  const key = event => { if (event.key === 'Escape' && zoomed && !lone && officeHasKeys(event)) { event.preventDefault(); unzoom(); } };
  const touch = () => { touched = performance.now(); };
  hud.tiles.addEventListener('scroll', () => { touched = scrolled = performance.now(); }, { passive: true });
  for (const type of ['pointerdown', 'pointermove', 'wheel']) container.addEventListener(type, touch, { passive: true, capture: true });
  wrap.addEventListener('pointerdown', down); wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', cancel); wrap.addEventListener('pointerleave', leave); wrap.addEventListener('wheel', wheel, { passive: false }); wrap.addEventListener('dblclick', reset);
  addEventListener('keydown', key);
  // The new-agent menu closes on a press anywhere else, before what's under it acts.
  const menu = createMenu(container, (cwd, choice, item) => hooks.spawn?.(cwd, choice, item));
  let dismissed = false;
  const press = event => { dismissed = menu.open && !menu.contains(event.target); if (dismissed) menu.close(); };
  document.addEventListener('pointerdown', press, true);

  makeRenderer();
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const panelWatch = new ResizeObserver(() => measure()), panelNode = document.getElementById('panel');
  if (panelNode) panelWatch.observe(panelNode);
  raf = requestAnimationFrame(frame);
  document.fonts?.ready.then(() => { if (!broken && renderer) { clearLabels(); for (const fight of fights.values()) fight.relabel(); } });

  const scene = {
    update(snapshot, { error } = {}) {
      if (broken) throw new Error('WebGL context lost');
      last = snapshot; frozen = !!error;
      // A lost connection holds everyone where they stand; nobody leaves because we stopped hearing.
      if (!frozen) { latest = { sessions: snapshot.sessions || [], battlefields: snapshot.battlefields }; apply(); if (zoomed) hud.refresh(zoomed.data); }
      refresh();
    },
    pick(test, open) {
      filter = test; if (latest) apply();
      if (!open) return;
      const hits = test ? [...fights.values()].filter(fight => matches(fight.data, test)) : [];
      if (hits.length === 1) zoom(hits[0]); else if (!lone) unzoom();
    },
    panelClosed() { scene.hover(null); },
    // The session under a point of the screen. An open panel's backdrop asks, so the fights beside the panel still open their people.
    at(x, y) {
      const inside = node => within(node, x, y), point = { clientX: x, clientY: y };
      const named = [...(zoomed ? hud.hud : hud.tiles).querySelectorAll('[data-id]')].find(inside);
      if (named) return named.dataset.id;
      if (zoomed) { if ([hud.top, ...hud.hud.querySelectorAll('.win')].some(inside)) return null; const [lx, ly] = local(point); return zoomed.hit(lx, ly, W, H); }
      const tile = [...hud.tiles.querySelectorAll('.fy-tile:not([hidden])')].find(inside), fight = tile && fights.get(tile.dataset.project);
      return fight ? peopleAt(fight.project, fight, point) : null;
    },
    // The backdrop's pointer, as it would be with the panel shut: what's under it lights up and whoever's there speaks. Null when it leaves.
    hover(x, y) {
      const point = { clientX: x, clientY: y }, inside = node => x != null && within(node, x, y);
      const lit = x == null ? [] : [...hud.ui.querySelectorAll(zoomed ? '.fy-top button, .fy-empty button, .fy-hud [data-id]' : '.fy-top button, .fy-empty button, .fy-tile:not([hidden]), .fy-chip')].filter(inside);
      for (const node of hud.ui.querySelectorAll('[data-under]')) if (!lit.includes(node)) node.removeAttribute('data-under');
      for (const node of lit) node.setAttribute('data-under', '');
      if (zoomed) { const id = x == null ? null : scene.at(x, y); zoomed.hoverId = id; sayTo(id ? zoomed : null, id); return; }
      const tile = lit.find(node => node.matches('.fy-tile'));
      peek(tile?.dataset.project ?? null, point, lit.find(node => node.matches('.fy-chip'))?.dataset.id ?? null);
    },
    // A command of the bar, or the empty window's, under a point: the backdrop presses it too.
    control: (x, y) => [...hud.ui.querySelectorAll('.fy-top button, .fy-empty button')].find(node => within(node, x, y)) ?? null,
    // A wheel the backdrop caught scrolls the fights, or brings a zoomed one's camera in and out, as it would with the panel shut. False when it's not over them.
    scroll(x, y, dy) {
      if (zoomed) { if (!within(wrap, x, y) || [hud.top, ...hud.hud.querySelectorAll('.win')].some(node => within(node, x, y))) return false; zoomed.zoomBy(Math.exp(dy * .001)); return true; }
      if (!within(hud.tiles, x, y)) return false;
      hud.tiles.scrollBy(0, dy); return true;
    },
    talkTo(id) {
      if (!id) return;
      const owner = latest?.sessions.find(session => session.id === id)?.parentId, want = owner && latest.sessions.some(session => session.id === owner) ? owner : id;
      for (const fight of fights.values()) if (fight.data.members.some(member => member.id === want)) { zoom(fight); break; }
      hooks.openPanel?.(id);
    },
    fire(id) { fired.set(id, Date.now()); apply(); },
    unmount() {
      stop(); lookFrom(hooks.mapScreen?.(), null); observer.disconnect(); panelWatch.disconnect(); removeEventListener('keydown', key); document.removeEventListener('pointerdown', press, true); menu.dispose();
      for (const fight of fights.values()) fight.dispose();
      fights.clear(); say.dispose(); hud.dispose(); painter.dispose(); props.dispose(); clearLabels();
      renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.dispose(); wrap.remove();
    },
  };
  return scene;
}
