import { reducedAtmosphere } from '../atmosphere.js';
import * as THREE from 'three';
import { STUD, BRICK, PLATE, masonry, runOf, stackOf, buttonStuds, buttonHover, buttonDepth, stickerPlacement, meterCells, surfaceBase, rng } from './bond.js';
import { COLOURS } from './parts.js';
import { paint } from './paint.js';
import { observesChange, observesFocus } from './watch.js';

// Brick Knights' interface, built live in one three.js scene: every framed element of the page is measured, snapped to whole bricks (stud pitch 20 px,
// courses of 24, plates of 8) and to the wall behind it, rebuilt as real brick geometry, and its text, icons and portraits are painted as a sticker on
// its face (paint.js), so a brick and its label are one object that scrolls, presses and arrives together. The DOM keeps layout, focus and clicks: it is
// invisible, and moved to where its face appears (the camera is above the screen, so things standing out of the wall seem lower than their layout).
const BLOCKS = '.primary, .secondary, .quiet-button, .stat, .shot-button, .effort-select, .nav-item, .history-latest';
const SHARED = { blocks: BLOCKS, meters: 'progress.usage-meter, .spend-reserve', stacks: '.spend-bar', rails: '.spend-token-rail', ground: '.console-screen' };
export const PAGE = {
  ...SHARED, blocks: `${BLOCKS}, .machine-label, .live-label`, badges: '.badge, .lost-state', name: 'page', fixed: '.sidebar, .topbar', scrollers: ['.sidebar'], windowScroll: true,
  walls: '.sidebar, .topbar', plains: '.main-content', strips: '',
  trays: '.session-card, .group-heading, .usage-accounts, .spend-panel, .status-line, .search, .empty, .integrations, .theme-console, .login-card, .request-box, .lost > details',
  free: '.brand, .sidebar-label, .page-heading, .connection-error, .no-projects, .toast',
  skip: el => !!el.closest('.detail-panel, dialog'),
};
export const PANEL = {
  ...SHARED, fields: '.message-form textarea', badges: '.badge', name: 'panel', fixed: '', scrollers: ['.history-viewport', '.chat-requests'], windowScroll: false,
  walls: '', plains: '.history-viewport', strips: '.recent-message.tool, .tool-run > summary',
  trays: '.chat-header, .feed-now, .recent-message:not(.tool, .notice), .message-composer, .request-box, .setting-field, .history-shot',
  blocks: `${BLOCKS}, .feed-now-item, .feed-head, .doc-chip, .composer-image-remove`,
  free: '.recent-message.notice, .history-empty, .chat-idle',
  skip: () => false,
};
const roots = config => [config.trays, config.blocks, config.badges, config.strips, config.free].filter(Boolean).join(', ');
const SHIFTED = config => [config.trays, config.blocks, config.badges, config.strips, config.fields].filter(Boolean).join(', ');
const KEEP = '.console-contact';
// Inside a closed <details> (other than its summary) nothing is shown, whatever the browser says about boxes.
const shut = el => { const d = el.closest('details:not([open])'); return !!d && d !== el && !el.closest('summary') ; };

const PROJECTS = ['navy', 'crimson', 'timber', 'forest'];
const RIM = 20, FACE_Z = 12, RIM_FRONT = 16, BLOCK_DEPTH = 20;
// A button's brick is a stud deep and is built fully out; at rest it sits half a stud out of its wall (REST is how far back it is pushed), hover brings it out
// slightly forward, and a press pushes it flush against the back.
const REST = -10;
// The top bar stands this far in front of the page (the page scrolls behind it, bricks and text alike).
const LIFT = 80;
const hex = name => COLOURS[name] || name;

// Slight variation from brick to brick, as moulded plastic has.
function shade(base, random, amount = .06) {
  const n = parseInt(hex(base).slice(1), 16), k = 1 + (random() - .5) * amount * 2, channel = shift => Math.max(0, Math.min(255, Math.round((n >> shift & 255) * k)));
  return `#${(channel(16) << 16 | channel(8) << 8 | channel(0)).toString(16).padStart(6, '0')}`;
}

function look(el) {
  if (el.matches('.session-card')) {
    const state = el.dataset.status, need = el.classList.contains('needs-input');
    return { rim: need ? 'gold' : state === 'working' ? 'forest' : state === 'error' || state === 'offline' ? 'crimson' : 'ashlar', face: need ? 'sand' : 'cream' };
  }
  if (el.matches('.group-heading')) { const group = el.closest('.project-group'), index = group ? [...group.parentElement.children].filter(c => c.matches('.project-group')).indexOf(group) : 0; const rim = PROJECTS[Math.max(0, index) % PROJECTS.length]; return { rim, face: rim, dark: true }; }
  if (el.matches('.lost > details')) return { rim: 'gold', face: 'cream' };
  if (el.matches('.usage-accounts, .login-card')) return { rim: 'navy', face: 'cream' };
  if (el.matches('.spend-panel, .theme-console')) return { rim: 'gold', face: 'cream' };
  if (el.matches('.status-line')) return { rim: el.classList.contains('flash') ? 'gold' : 'crimson', face: 'cream' };
  if (el.matches('.request-box')) return { rim: 'crimson', face: 'sand' };
  if (el.matches('.history-shot')) return { rim: 'gold', face: 'timber' };
  if (el.matches('.chat-header')) return { rim: 'gold', face: 'navy' };
  if (el.matches('.recent-message.user')) return { rim: 'navy', face: 'navy' };
  if (el.matches('.recent-message')) return { rim: 'stone', face: 'cream' };
  if (el.matches('.message-composer')) return { rim: 'ashlar', face: 'sand' };
  if (el.matches('.setting-field')) return { rim: 'ashlar', face: 'cream' };
  if (el.matches('.search')) return { rim: 'ashlar', face: 'cream' };
  return { rim: 'stone', face: 'cream' };
}
function blockColour(el) {
  if (el.matches('.live-label')) return el.classList.contains('disconnected') ? 'crimson' : 'forest';
  if (el.matches('.machine-label')) return 'tan';
  if (el.matches('.nav-item.active, .primary, .stat.selected')) return 'tan';
  if (el.matches('.fire-button.armed, [data-decision=decline], [data-decision=cancel]')) return 'crimson';
  return 'ashlar';
}

export class BrickUi {
  // `scope` is the element the build lives in (the body, or the chat panel, whose own size and position the canvas takes).
  constructor(layer, config = PAGE, scope = document.body) {
    this.layer = layer; this.config = config; this.scope = scope; this.entries = []; this.sig = ''; this.arrivals = new Map(); this.byEl = new WeakMap(); this.byKey = new Map(); this.dzByKey = new Map(); this.queued = 0;
    this.textures = new Map(); this.nextTextureId = 0; this.attribute = `data-stickers-${config.name}`; this.items = []; this.settle = 0;
    this.watch = [config.trays, config.blocks, config.badges, config.fields, config.ground, config.meters, config.stacks, config.rails, config.walls, config.plains, config.strips, config.free, config.fixed].filter(Boolean).join(', ');
    this.hide = document.createElement('style'); const all = roots(config);
    // Once their stickers are up, the elements stop drawing themselves (they keep layout, focus and clicks); fields and the map's figures stay live.
    const within = config.name === 'panel' ? '.detail-panel ' : '', outside = config.name === 'panel' ? '' : ':not(.detail-panel *, dialog *)', live = `input, textarea, select, option, ${KEEP}, ${KEEP} *`;
    this.hide.textContent = `:root[${this.attribute}] ${within}:is(${all})${outside}, :root[${this.attribute}] ${within}:is(${all}) *:not(${live})${outside} { color: transparent !important; background-color: transparent !important; background-image: none !important; border-color: transparent !important; box-shadow: none !important; text-shadow: none !important; outline-color: transparent !important; filter: none !important; text-decoration-color: transparent !important; }
:root[${this.attribute}] ${within}:is(${all}) :is(svg, img)${outside} { visibility: hidden !important; }`;
    document.head.append(this.hide);
    const again = () => this.schedule();
    this.resizeObserver = new ResizeObserver(() => { if (config.name === 'panel' && (scope.offsetWidth !== layer.size.width || scope.offsetHeight !== layer.size.height)) this.size(); again(); }); if (config.name === 'panel') this.resizeObserver.observe(scope);
    this.mutations = new MutationObserver(records => { if (records.some(r => observesChange(r, scope, this.watch, config.skip))) again(); });
    this.mutations.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-status', 'value', 'hidden', 'open', 'aria-pressed', 'data-tracked'] });
    this.listeners = [];
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); this.listeners.push([target, type, fn, options]); };
    listen(window, 'load', again); listen(window, 'resize', () => { this.size(); again(); });
    if (config.windowScroll) listen(window, 'scroll', () => this.scrolled(), { passive: true });
    if (config.scrollers.length) listen(scope, 'scroll', () => this.scrolled(), true);
    listen(document, 'pointerdown', event => this.press(event), true); listen(document, 'pointerup', () => this.release(), true); listen(document, 'pointercancel', () => this.release(), true);
    listen(document, 'pointerover', event => this.hover(event, true), true); listen(document, 'pointerout', event => this.hover(event, false), true);
    const focus = event => { if (observesFocus(event.target, scope, config.skip)) again(); };
    listen(document, 'focusin', focus); listen(document, 'focusout', focus);
    document.fonts?.ready.then(again);
    this.size(); this.schedule();
  }
  size() {
    const { layer, config, scope } = this;
    if (config.windowScroll) layer.resize(innerWidth, innerHeight);
    else { const r = scope.getBoundingClientRect(); layer.resize(Math.max(1, scope.offsetWidth), Math.max(1, scope.offsetHeight), { x: innerWidth / 2 - r.left, y: -LIFT_PX() - r.top }); }
    this.scrolled(true);
  }
  // A region that scrolls moves its bricks and stickers with it (clipped to its box); the DOM catches up when it stops.
  scrolled(now) {
    const { config, layer, scope } = this;
    if (config.windowScroll) layer.scrollGroup('page', scrollY);
    for (const selector of config.scrollers) { const el = scope.querySelector(selector); if (el && el.getClientRects().length) { const r = this.box(el); layer.scrollGroup(selector, el.scrollTop, { x: r.left, y: r.top, w: el.clientWidth, h: el.clientHeight }); } }
    // Keep the live hit targets aligned with the moving brick faces throughout scrolling.
    this.follow();
    clearTimeout(this.settle); this.settle = setTimeout(() => this.follow(), now ? 0 : 140);
  }
  offsetOf(group) { return group === 'page' ? scrollY : group === 'fixed' ? 0 : this.layer.groups[group]?.position.y || 0; }
  groupOf(el) {
    const { config } = this;
    const scrolling = config.scrollers.find(selector => el.closest(selector));
    if (scrolling) return scrolling;
    return config.windowScroll && !el.closest(config.fixed) ? 'page' : 'fixed';
  }

  // Every element that is part of the build, in document order, with the kind of piece it becomes.
  collect() {
    const { config, scope } = this, found = [], seen = new Set();
    const take = (selector, kind) => { if (selector) for (const el of scope.querySelectorAll(selector)) if (!seen.has(el) && !config.skip(el) && !shut(el) && el.getClientRects().length) { seen.add(el); found.push({ el, kind }); } };
    if (config.name === 'panel' && scope.getClientRects().length) found.push({ el: scope, kind: 'wall' });
    take(config.walls, 'wall'); take(config.plains, 'plain'); take(config.ground, 'ground'); take(config.trays, 'tray'); take(config.fields, 'field'); take(config.badges, 'badge'); take(config.strips, 'strip'); take(config.blocks, 'block'); take(config.meters, 'meter'); take(config.stacks, 'stack'); take(config.rails, 'rail');
    return found.sort((a, b) => a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  collectRoots() {
    const { config, scope } = this; return [...scope.querySelectorAll(roots(config))].filter(el => !config.skip(el) && !shut(el) && el.getClientRects().length);
  }

  // Whole bricks: first the DOM is asked for its natural size, then given the next size up that bricks can make.
  snapSizes(found) {
    // Clearing the snapped sizes to measure shrinks the content for a moment, and the browser would clamp every scroll position to that: keep them.
    const scrolls = [[null, scrollX, scrollY], ...this.config.scrollers.map(selector => { const el = this.scope.querySelector(selector); return el && [el, el.scrollLeft, el.scrollTop]; }).filter(Boolean)];
    this.snapSizesNow(found);
    for (const [el, x, y] of scrolls) { if (el) { if (el.scrollTop !== y) el.scrollTop = y; if (el.scrollLeft !== x) el.scrollLeft = x; } else if (scrollY !== y || scrollX !== x) scrollTo(x, y); }
  }
  snapSizesNow(found) {
    const sized = ({ kind }) => kind === 'block' || kind === 'badge' || kind === 'tray' || kind === 'field' || kind === 'strip';
    for (const f of found) if (sized(f)) { f.el.style.minWidth = ''; f.el.style.minHeight = ''; }
    const natural = found.map(f => sized(f) ? { width: f.el.offsetWidth, height: f.el.offsetHeight } : null);
    found.forEach(({ el, kind }, i) => {
      const r = natural[i]; if (!r) return;
      if (kind === 'badge') { el.style.minWidth = `${Math.ceil(r.width / STUD) * STUD}px`; el.style.minHeight = `${BRICK}px`; return; }
      if (kind === 'block') { el.style.minWidth = `${buttonStuds(r.width) * STUD}px`; el.style.minHeight = `${Math.max(PLATE * 4, Math.ceil(r.height / PLATE) * PLATE)}px`; return; }
      if (kind === 'tray' || kind === 'field') el.style.minHeight = `${Math.max(BRICK * 2, Math.ceil(r.height / BRICK) * BRICK)}px`; else el.style.minHeight = `${Math.max(PLATE * 2, Math.ceil(r.height / PLATE) * PLATE)}px`;
      if (!el.matches('.session-card, .group-heading, .usage-accounts, .spend-panel, .status-line, .search, .empty, .integrations, .theme-console, .login-card, .lost > details')) el.style.minWidth = `${Math.ceil(r.width / STUD) * STUD}px`;
    });
  }

  // Where an element sits in layout, ignoring any transform or translate: sums offsets up to the scope.
  box(el) {
    let x = 0, y = 0;
    if (el !== this.scope) for (let n = el; n && n !== this.scope; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; if (n !== el) { x += n.clientLeft; y += n.clientTop; } }
    return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
  }

  // Layout boxes, then where bricks go: on the stud columns and, against the wall, on its course lines (a button's brick ends on a course; a tray's rims on
  // one). `snap` is how far the element had to be moved to get there, inherited by what is inside it.
  measure(found) {
    const config = this.config, shifted = SHIFTED(config), byEl = new Map();
    return found.map(({ el, kind }) => {
      const group = this.groupOf(el), r = this.box(el), parent = el.parentElement?.closest(shifted), up = parent && byEl.get(parent), nested = !!up && up.kind === 'tray';
      const scrollSurface = (kind === 'plain' && el.matches('.history-viewport')) || (kind === 'wall' && el.matches('.sidebar'));
      const wide = scrollSurface ? el.clientWidth : r.width, tall = scrollSurface ? Math.max(el.scrollHeight, el.clientHeight) : r.height;
      const px = up ? up.snap.x : 0, py = up ? up.snap.y : 0, wx = r.left + px, wy = r.top + py;
      let x = Math.round(wx / STUD) * STUD, y = wy;
      const w = Math.max(STUD, Math.round(wide / STUD) * STUD), h = Math.max(PLATE, Math.round(tall / PLATE) * PLATE);
      // Keep an attached status plate on the face of its tray, clear of the side rim.
      if (kind === 'badge' && nested && up.w >= w + 2 * RIM) x = Math.max(up.x + RIM, Math.min(x, up.x + up.w - RIM - w));
      if ((kind === 'tray' || kind === 'field') && !nested) y = Math.round(wy / BRICK) * BRICK; else if (kind === 'block' && !nested) y = Math.round((wy + h) / BRICK) * BRICK - h; else y = Math.round(wy / PLATE) * PLATE;
      if (kind === 'wall' || kind === 'plain') { x = Math.round(wx); y = Math.round(wy); }
      const item = { el, kind, group, x, y, w, h, nested, lx: r.left, ly: r.top, snap: { x: x - r.left, y: y - r.top }, up, key: el.dataset.sessionId || '', fill: 0, shares: null, z: 0, shift: { x: 0, y: 0 } };
      if (kind === 'meter') { const fillEl = el.matches('.spend-reserve') ? el.querySelector('.spend-reserve-fill') : null; item.fill = el.matches('progress') ? el.value / (el.max || 100) : fillEl ? fillEl.getBoundingClientRect().width / Math.max(1, el.getBoundingClientRect().width) : 0; }
      if (kind === 'rail') item.shares = [...el.children].map(c => [c.className, c.getBoundingClientRect().width]);
      const lift = el.closest('.topbar') ? LIFT : 0, base = surfaceBase(lift, nested ? up.z : undefined); item.lift = lift; item.base = base; item.z = kind === 'tray' || kind === 'field' ? base + FACE_Z : kind === 'block' || kind === 'badge' ? base + BLOCK_DEPTH : kind === 'strip' ? lift + 8 : lift;
      byEl.set(el, item); return item;
    });
  }

  // The DOM follows its bricks: each element is moved by how far its face is displaced (snap to the grid, then perspective) relative to the element it sits in.
  follow() {
    const L = this.layer;
    for (const item of this.items) {
      if (!['tray', 'field', 'block', 'badge', 'strip'].includes(item.kind)) continue;
      const up = item.up, visible = { x: item.x + item.w / 2, y: item.y + item.h / 2 - this.offsetOf(item.group) };
      item.shift = L.shiftOf(visible.x, visible.y, item.z + (item.kind === 'block' ? REST : 0));
      const tx = item.snap.x + item.shift.x - (up ? up.snap.x + up.shift.x : 0), ty = item.snap.y + item.shift.y - (up ? up.snap.y + up.shift.y : 0);
      item.el.style.translate = Math.abs(tx) + Math.abs(ty) < .05 ? '' : `${tx.toFixed(2)}px ${ty.toFixed(2)}px`;
    }
  }

  schedule() { if (!this.queued) this.queued = requestAnimationFrame(() => { this.queued = 0; this.rebuild(); }); }

  // A sticker's picture, from cache when the element looks exactly as before. Painted with the elements drawn normally (their text is hidden afterwards).
  stickerFor(el, w, h) {
    const focused = el.matches(':focus-visible') || !!el.querySelector(':focus-visible'), key = `${el.outerHTML}|${w}x${h}|${focused}|${this.layer.renderer.getPixelRatio()}`;
    let hit = this.textures.get(key);
    if (!hit || hit.dirty) {
      const scale = Math.min(this.layer.renderer.getPixelRatio(), 4096 / Math.max(w, h));
      const { canvas } = paint(el, { scale, sticker: el.matches(this.config.blocks), own: node => node !== el && node.matches(roots(this.config)), onLoad: () => {
        if (this.textures.get(key) !== hit) return;
        hit.dirty = true; this.schedule();
      } });
      if (hit) { hit.texture.image = canvas; hit.texture.needsUpdate = true; hit.dirty = false; this.layer.invalidate(); }
      else {
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.anisotropy = 4;
        hit = { texture, key, id: ++this.nextTextureId }; this.textures.set(key, hit);
      }
    }
    this.textures.delete(key); this.textures.set(key, hit); return hit;
  }

  rebuild() {
    const { layer: L, config } = this, root = document.documentElement, attr = this.attribute;
    const found = this.collect(); this.snapSizes(found); const items = this.measure(found); this.items = items;
    for (const { el } of items) this.resizeObserver.observe(el);
    this.follow();
    // Stickers: one per root element. Paint with the elements as they naturally draw, then hide them again.
    const had = root.hasAttribute(attr); root.removeAttribute(attr);
    const itemOf = new Map(items.map(i => [i.el, i])), stickers = [];
    for (const el of this.collectRoots()) {
      const item = itemOf.get(el), r = item ? { left: item.lx + item.snap.x, top: item.ly + item.snap.y } : this.box(el), w = el.offsetWidth, h = el.offsetHeight;
      if (w < 1 || h < 1) continue;
      const hit = this.stickerFor(el, w, h);
      stickers.push({ el, hit, x: r.left, y: r.top, w, h, z: item ? item.z : el.closest('.topbar') ? LIFT : 0, group: item ? item.group : this.groupOf(el) });
    }
    root.setAttribute(attr, '');
    const sig = items.map(i => `${i.kind}${i.group}${i.x},${i.y},${i.w},${i.h}${i.nested}${i.fill.toFixed(2)}${i.shares ? i.shares.map(x => Math.round(x[1])) : ''}${look(i.el).rim}${blockColour(i.el)}`).join('|')
      + `|${stickers.map(s => `${s.hit.id}:${s.x},${s.y}`).join(';')}|${L.size.width}x${L.size.height}`;
    // Same build, new DOM nodes (the lists are rebuilt on every poll): the entries just follow their elements.
    if (sig === this.sig) { items.forEach((item, i) => { const e = this.entries[i]; if (e) { e.el = item.el; this.byEl.set(item.el, e); if (item.key) this.byKey.set(item.key, e); } }); return; }
    // Animation state lives on the element (or the session it shows), not on the bricks, so it survives a rebuild; running tweens find the new entries.
    this.sig = sig; L.begin(); this.entries = []; this.scrolled();
    // Only cut openings for controls attached to this surface and moving with it.
    // A nested button belongs to its tray, not to the wall behind that tray.
    for (const surface of items.filter(i => i.kind === 'wall' || i.kind === 'tray' || i.kind === 'field')) {
      surface.openings = items.filter(i => (i.kind === 'block' || i.kind === 'meter') && i.group === surface.group &&
        (surface.kind === 'tray' || surface.kind === 'field' ? i.up === surface : !i.nested && surface.el.contains(i.el)))
        .map(i => ({ x: i.x - surface.x, y: i.y - surface.y, w: i.w, h: i.h }));
      if (surface.el.matches('.detail-panel')) for (const i of items.filter(i => i.kind === 'plain' && i.el.matches('.history-viewport')))
        surface.openings.push({ x: i.x - surface.x, y: i.y - surface.y, w: i.el.clientWidth, h: i.el.clientHeight });
    }
    const fresh = [];
    items.forEach((item, index) => {
      const known = this.byEl.get(item.el)?.dz || (item.key && this.dzByKey.get(item.key)), dz = known || { arrive: 0, hover: 0, press: 0 };
      if (item.key) this.dzByKey.set(item.key, dz);
      const handles = [], entry = { el: item.el, handles, item, dz }; this.entries.push(entry); this.byEl.set(item.el, entry); if (item.key) this.byKey.set(item.key, entry);
      ({ wall, plain, ground, tray, field: tray, block, badge, meter, stack, rail, strip }[item.kind])(L, item, handles, index);
    });
    for (const s of stickers) {
      const entry = this.byEl.get(s.el), placement = entry && ['block', 'badge', 'tray'].includes(entry.item.kind) ? stickerPlacement(Math.round(s.x * 7 + s.y * 13 + s.w), s.w, s.h) : undefined;
      const handle = L.sticker(s.group, s.hit.texture, s.x, s.y, s.w, s.h, s.z + .01, placement);
      if (entry) entry.handles.push(handle); if (entry?.item.key) fresh.push(entry);
    }
    for (const entry of this.entries) if (entry.item.kind === 'block' || entry.dz.arrive || entry.dz.hover || entry.dz.press) this.apply(entry);
    L.end(); this.prune(new Set(stickers.map(s => s.hit.key)));
    if (fresh.length && !reducedAtmosphere()) this.arrive(fresh);
  }
  // Textures nobody asked for in this build go, except the most recent few (cards come and go as polls change their text).
  prune(used) {
    let spare = 60;
    for (const [key, hit] of [...this.textures].reverse()) { if (used.has(key)) continue; if (spare-- > 0) continue; hit.texture.dispose(); this.textures.delete(key); }
  }

  // What an element is lifted by: arriving, hovered, pressed: summed, applied to its bricks and its sticker alike.
  apply(entry) { const dz = entry.dz.arrive + (entry.item.kind === 'block' ? buttonDepth(entry.dz.hover, entry.dz.press) : entry.dz.hover); for (const h of entry.handles) this.layer.nudge(h, 0, 0, dz); }
  // A running change looks its element up each frame: a rebuild in the middle gives it new bricks, and it carries on.
  live(entry) { const key = entry.item.key; return () => (key && this.byKey.get(key)) || this.byEl.get(entry.el); }
  // New cards are built on: bricks drop onto the wall one card after another. Started once per card, by absolute time.
  arrive(entries) {
    const L = this.layer, now = performance.now(); let n = 0;
    for (const entry of entries) {
      const key = entry.item.key; if (!this.arrivals.has(key)) this.arrivals.set(key, now + Math.min(n++, 24) * 70);
      const start = this.arrivals.get(key); if (now > start + 520) continue;
      const find = this.live(entry); entry.dz.arrive = 90; this.apply(entry);
      L.tween(520, t => { const e = find(); if (!e) return; e.dz.arrive = Math.pow(1 - t, 3) * 90; this.apply(e); }, undefined, start);
    }
  }
  entryAt(event, selector) { const el = event.target.closest?.(selector); return el && !el.disabled ? this.byEl.get(el) : null; }
  press(event) {
    const entry = this.entryAt(event, this.config.blocks); if (!entry || entry.el.matches('.machine-label, .live-label')) return;
    const find = this.live(entry); this.pressed = find;
    const from = entry.dz.press, version = entry.dz.pressVersion = (entry.dz.pressVersion || 0) + 1;
    this.layer.tween(80, t => { const e = find(); if (e && e.dz.pressVersion === version) { e.dz.press = from + (1 - from) * t; this.apply(e); } });
  }
  release() {
    const find = this.pressed; if (!find) return; this.pressed = null;
    const entry = find(); if (!entry) return;
    const from = entry.dz.press, version = entry.dz.pressVersion = (entry.dz.pressVersion || 0) + 1;
    this.layer.tween(180, t => { const e = find(); if (e && e.dz.pressVersion === version) { e.dz.press = from * (1 - t); this.apply(e); } });
  }
  hover(event, over) {
    const entry = this.entryAt(event, `${this.config.blocks}, .session-card`); if (!entry || entry.el.matches('.machine-label, .live-label') || (event.relatedTarget && entry.el.contains(event.relatedTarget))) return;
    const find = this.live(entry), from = entry.dz.hover, to = over ? (entry.item.kind === 'block' ? buttonHover : 6) : 0;
    this.layer.tween(130, t => { const e = find(); if (e) { e.dz.hover = from + (to - from) * t; this.apply(e); } });
  }
  dispose() {
    cancelAnimationFrame(this.queued); clearTimeout(this.settle); this.resizeObserver.disconnect(); this.mutations.disconnect();
    for (const [target, type, fn, options] of this.listeners) target.removeEventListener(type, fn, options);
    document.documentElement.removeAttribute(this.attribute); this.hide.remove();
    for (const { el } of this.items) if (el.style) { el.style.translate = ''; el.style.minWidth = ''; el.style.minHeight = ''; }
    for (const hit of this.textures.values()) hit.texture.dispose(); this.textures.clear();
    this.layer.dispose();
  }
}
const LIFT_PX = () => .35 * innerHeight;

// ---- builders. (x, y, w, h) is the element's box in DOM pixels; handles collects what to move when it animates. ----
const put = (L, handles, g, key, x, y, front, colour) => { handles.push(L.add(g, key, x, y, front, hex(colour))); };

// Walls break around controls; split partial courses into plates at an opening.
function wall(L, { group, x, y, w, h, el, lift, openings }, handles, seed) {
  const random = rng(7 + seed), base = el.matches('.topbar, .detail-panel') ? 'navy' : 'stone';
  for (const p of masonry(Math.ceil(w / STUD) * STUD, Math.ceil(h / PLATE) * PLATE, openings, 3 + seed))
    put(L, handles, group, `${p.length}:${p.height}:${STUD}:${p.y === 0 ? 's' : 't'}`, x + p.x, y + p.y, lift, shade(base, random, .05));
  // projecting corner stones and sloped corbels make the sidebar a castle tower
  if (el.matches('.sidebar')) for (let row = 0; row * BRICK < h; row++) {
    const top = y + row * BRICK, mode = row % 6 === 2 ? 'slope' : row % 6 === 5 ? 'side' : 't';
    for (const sx of [x, x + (Math.ceil(w / STUD) - 1) * STUD]) {
      put(L, handles, group, `1:${BRICK}:8:${mode}`, sx, top, lift + 8, shade('stone', random, .04));
      if (row % 12 === 5 && sx !== x) { // a shield boss, attached to the corner stone
        put(L, handles, group, '1:20:4:round', sx, top + 2, lift + 16, 'iron');
      }
    }
  }
}
// The center is an open timber frame, leaving the castle scenery visible between its posts.
export function plain(L, { group, x, y, w, h, el }, handles, seed) {
  const history = el.matches('.history-viewport'), top = group === 'page' ? 0 : y, cols = Math.ceil(w / STUD), rows = Math.ceil((history ? h : Math.max(h, L.size.height)) / BRICK) + 1, random = rng(91 + seed);
  if (!el.matches('.main-content')) {
    for (const p of masonry(cols * STUD, Math.ceil(h / PLATE) * PLATE, [], 11 + seed)) put(L, handles, group, `${p.length}:${p.height}:${STUD}:t`, x + p.x, top + p.y, 0, shade('sand', random, .03));
    return;
  }
  const posts = new Set([0, cols - 1]);
  for (let c = 12; c < cols - 1; c += 12) posts.add(c);
  const uprights = [...posts].sort((a, b) => a - b), front = -8;
  for (let r = 0; r < rows; r++) {
    const beam = r % 6 === 0;
    if (beam) {
      let start = 0;
      for (const c of uprights) {
        let at = start; for (const n of runOf(c - start)) { put(L, handles, group, `${n}:${BRICK}:${STUD}:t`, x + at * STUD, top + r * BRICK, front, shade('timber', random, .08)); at += n; }
        start = c + 1;
      }
    }
    for (const c of uprights) {
      put(L, handles, group, `1:${BRICK}:${STUD}:${beam ? 'side' : 't'}`, x + c * STUD, top + r * BRICK, front, shade('timber', random, .08));
      if (beam) put(L, handles, group, '1:20:4:round', x + c * STUD, top + r * BRICK + 2, 0, (r / 6 + c) % 3 === 0 ? 'gold' : 'iron');
    }
    // Wedge braces touch both post and beam; their recessed fronts leave every control clear.
    if (r % 6 === 1 && r + 1 < rows) for (let i = 1; i < uprights.length; i++) {
      const a = uprights[i - 1], b = uprights[i]; if (b - a < 5) continue;
      put(L, handles, group, `2:${BRICK * 2}:${STUD}:wedge-left`, x + (a + 1) * STUD, top + r * BRICK, front, shade('timber', random, .05));
      put(L, handles, group, `2:${BRICK * 2}:${STUD}:wedge-right`, x + (b - 2) * STUD, top + r * BRICK, front, shade('timber', random, .05));
    }
  }
}

// A baseplate: 1 x 1 plates with studs, green, for the session map.
function ground(L, { group, x, y, w, h, base }, handles) {
  const random = rng(5);
  for (let r = 0; r < Math.ceil(h / STUD); r++) for (let c = 0; c < w / STUD; c++) put(L, handles, group, `1:${PLATE}:${STUD}:s`, x + c * STUD, y + r * STUD, base + PLATE, shade('forest', random, .04));
}

// A tray: a rim of bricks (plates top and bottom, a column of bricks either side) around a smooth recessed face you read the text on.
function tray(L, { el, group, x, y, w, h, base, openings }, handles) {
  const { rim, face } = look(el), random = rng(x * 7 + y * 13 + w), cols = w / STUD;
  const front = base + RIM_FRONT, rimColour = () => shade(rim, random, .04);
  // The rim can also meet a control, so each side uses the same cutout rules.
  const rimSection = (dx, dy, width, height, studs = false) => {
    for (const p of masonry(width, height, openings.map(o => ({ ...o, x: o.x - dx, y: o.y - dy })), x + y + dx + dy))
      put(L, handles, group, `${p.length}:${p.height}:16:${studs ? 's' : 't'}`, x + dx + p.x, y + dy + p.y, front, rimColour());
  };
  rimSection(0, 0, w, PLATE, true); rimSection(0, h - PLATE, w, PLATE);
  rimSection(0, PLATE, RIM, h - 2 * PLATE); rimSection(w - RIM, PLATE, RIM, h - 2 * PLATE);
  // The recessed face is made from real bricks and plates, with space for its buttons.
  if (cols > 2) for (const p of masonry((cols - 2) * STUD, h - 2 * PLATE,
    openings.map(o => ({ ...o, x: o.x - RIM, y: o.y - PLATE })), x + y))
    put(L, handles, group, `${p.length}:${p.height}:8:t`, x + RIM + p.x, y + PLATE + p.y, base + FACE_Z, shade(face, random, .01));
}

// A button: one real brick n studs wide (1, 2, 3, 4, 6 or 8), the label on its front, the top course a smooth tile. It sticks out of its wall.
function block(L, { el, group, x, y, w, h, base }, handles) {
  const front = base + BLOCK_DEPTH, n = w / STUD, colourName = blockColour(el), random = rng(x + y), stack = stackOf(h);
  const colour = () => shade(colourName, random, .025);
  if (el.matches('.live-label') && !el.classList.contains('disconnected')) {
    if (h > BRICK) put(L, handles, group, `1:${PLATE}:${BLOCK_DEPTH}:t`, x, y + h - BRICK - PLATE, front, 'stone');
    put(L, handles, group, `1:${BRICK}:${BLOCK_DEPTH}:side`, x, y + h - BRICK, front, 'stone');
    put(L, handles, group, '1:20:4:round', x, y + h - BRICK + 2, front + 8, 'forest');
    return;
  }
  // Buttons are one brick (up to 8 studs); anything wider is a run of real bricks side by side.
  let at = 0; for (const length of runOf(n)) {
    let top = y;
    for (let i = 0; i < stack.plates; i++, top += PLATE) put(L, handles, group, `${length}:${PLATE}:${BLOCK_DEPTH}:t`, x + at * STUD, top, front, colour());
    for (let i = 0; i < stack.bricks; i++, top += BRICK) put(L, handles, group, `${length}:${BRICK}:${BLOCK_DEPTH}:${!stack.plates && i === 0 ? 's' : 't'}`, x + at * STUD, top, front, colour());
    at += length;
  }
}

// A status tile clipped to the outward studs of a slim bracket.
function badge(L, { el, group, x, y, w, base }, handles) {
  const tile = el.matches('.red, .amber') ? 'crimson' : el.matches('.green') ? 'forest' : 'tan';
  let at = 0;
  for (const n of runOf(w / STUD)) {
    put(L, handles, group, `${n}:${BRICK}:${PLATE}:side`, x + at * STUD, y, base + PLATE, 'stone');
    put(L, handles, group, `${n}:${STUD}:${PLATE}:t`, x + at * STUD, y + 2, base + PLATE * 2 + 4, tile);
    at += n;
  }
}

// A meter: side-studded brackets sit flush in the wall; gold round plates mark the used cells.
function meter(L, { el, group, x, y, w, base, fill }, handles) {
  const front = base, cells = meterCells(w, fill);
  const random = rng(cells.length);
  cells.forEach((used, i) => {
    const left = x + i * 2 * STUD;
    put(L, handles, group, `2:${BRICK}:${PLATE}:side`, left, y, front, shade('stone', random, .03));
    for (let c = 0; c < 2; c++) {
      if (used) put(L, handles, group, '1:20:4:round', left + c * STUD, y + 2, front + 8, 'gold');
    }
  });
}

// A day's spend: a stack of gold 1 x 2 bricks, one per 24 px of the bar.
function stack(L, { group, x, y, w, h, base }, handles) {
  const front = base + BLOCK_DEPTH, count = Math.round(h / BRICK), random = rng(h + x), n = Math.max(1, Math.round(w / STUD));
  for (let i = 0; i < count; i++) put(L, handles, group, `${Math.min(n, 2)}:${BRICK}:${BLOCK_DEPTH}:${i === count - 1 ? 's' : 't'}`, x, y + h - (i + 1) * BRICK, front, shade('gold', random, .03));
}

// The token rail: 1 x 1 plates along it, shared between input, output and cache.
function rail(L, { group, x, y, w, shares, base }, handles) {
  const front = base + PLATE, cells = Math.floor(w / STUD), total = shares.reduce((a, [, v]) => a + v, 0) || 1; let at = 0, c = 0;
  for (const [name, value] of shares) { const to = at + value / total * cells, colour = /cache/.test(name) ? 'forest' : /output/.test(name) ? 'tan' : 'gold'; for (; c < Math.round(to) && c < cells; c++) put(L, handles, group, `1:${PLATE}:${STUD}:s`, x + c * STUD, y, front, hex(colour)); at = to; }
}

// A tool line: a smooth strip on a column of bricks, as wide as the text needs.
function strip(L, { group, x, y, w, h, lift }, handles) {
  const front = lift + FACE_Z + 8, random = rng(x + y), rows = stackOf(h);
  let top = y; for (let i = 0; i < rows.bricks; i++, top += BRICK) put(L, handles, group, `1:${BRICK}:${STUD}:t`, x, top, lift + 20, shade('gold', random, .03));
  for (let i = 0; i < rows.plates; i++, top += PLATE) put(L, handles, group, `1:${PLATE}:${STUD}:t`, x, top, lift + 20, shade('gold', random, .03));
  if (w > STUD) put(L, handles, group, `${w / STUD - 1}:${h}:8:t`, x + STUD, y, lift + 8, shade('cream', random, .01));
}
