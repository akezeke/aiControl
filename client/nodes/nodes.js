// Nodes: every session as a node on one board, You in the middle. The board is shared; a look (looks/*.js) draws it, and the
// theme's choice picks which: nodes (Clean), nodes-clean-dark, nodes-neurons, nodes-synthetic, nodes-steampunk, nodes-mycelium.
// A '-dark' choice builds the same look with ctx.dark set, and the board carries data-dark for its css.
// A look is { id, css?, create(ctx) → { update(dt, time), event(type, node, data), dispose? } } and adds everything to ctx.root.
// Looks build their meshes for the nodes there are, so the look is built again when sessions come or go (world.structure).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './nodes.css';
import { createWorld } from './world.js';
import * as kit from './kit.js';
import { createMenu, frameTime } from '../scene-ui.js';
import { hireChoices } from '../hire.js';
import { createScreenshots } from '../office/screenshots.js';

const LOOKS = {
  clean: () => import('./looks/clean.js'),
  'clean-dark': () => import('./looks/clean.js'),
  neurons: () => import('./looks/neurons.js'),
  synthetic: () => import('./looks/synthetic.js'),
  steampunk: () => import('./looks/steampunk.js'),
  mycelium: () => import('./looks/mycelium.js'),
};
// The look the theme's choice asks for: 'nodes-steampunk' → 'steampunk', plain 'nodes' → Clean.
export const lookFor = choice => LOOKS[String(choice || '').replace(/^nodes-?/, '')] ? String(choice).replace(/^nodes-?/, '') : 'clean';

export function webglAvailable() {
  try { const gl = document.createElement('canvas').getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const PROVIDER = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };
const STATUS_VAR = { working: 'var(--work)', thinking: 'var(--work)', compacting: 'var(--work)', permission: 'var(--need)', question: 'var(--need)', waiting: 'var(--wait)', idle: 'var(--muted)', error: 'var(--err)', offline: 'var(--muted)' };
const needs = n => n.status === 'permission' || n.status === 'question';
const statusLine = n => needs(n) ? `${n.text} · ${kit.fmtWait(n.waitSec)}` : n.text;

export function mountNodes(container, hooks = {}) {
  const osReduced = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = osReduced.matches;
  const world = createWorld(); world.reduced = reduced;
  container.classList.add('nodes-scene');
  const canvas = document.createElement('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Sessions board');
  const labelsEl = document.createElement('div'); labelsEl.className = 'nodes-labels';
  const tipEl = document.createElement('div'); tipEl.className = 'nodes-tip'; tipEl.hidden = true;
  const fadeEl = document.createElement('div'); fadeEl.className = 'nodes-fade';
  container.append(canvas, labelsEl, tipEl, fadeEl);

  // ── Renderer and post ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .5, 600);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .6, .4, .85), output = new OutputPass();
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(output);
  let extraPasses = [];

  // Looks may rewrite n.rest / n.offset (their own layout) and the pick sizes; both go back to the world's layout on every build.
  let sizes = { ...kit.SIZE }, frameExtra = null, labelAnchor = null, labelAbove = null, labelRule = null, customLayout = null, shapeOf = null;
  const size = { w: 1, h: 1 }, resizeHooks = new Set();
  // The world's ring, spread to the screen's shape so wide and tall screens both get used. Clusters keep their own shape.
  function baseLayout() {
    const aspect = size.w / size.h, tall = aspect < .8;
    const sx = aspect > 1.2 ? Math.min(1.4, aspect / 1.15) : tall ? .82 : 1, sz = tall ? Math.min(1.7, .95 / aspect) : 1;
    for (const n of world.projects) { n.rest.x *= sx; n.rest.z *= sz; }
    for (const n of world.nodes) if (n.kind === 'session' || n.kind === 'sub') n.rest.copy(n.parent.rest).add(n.offset);
  }
  function relayout() {
    world.layout();
    if (customLayout) { for (const n of world.nodes) customLayout(n); for (const n of world.nodes) if (n.kind === 'session' || n.kind === 'sub') n.rest.copy(n.parent.rest).add(n.offset); }
    else baseLayout();
  }
  function resize() {
    size.w = container.clientWidth || 1; size.h = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, size.w < 700 ? 1.5 : 2));
    renderer.setSize(size.w, size.h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(size.w, size.h);
    bloom.resolution.set(size.w / 2, size.h / 2);
    camera.aspect = size.w / size.h; camera.updateProjectionMatrix();
    // A look with its own layout redoes it in its onResize hook. Shapes baked at build time follow once the resizing stops.
    if (!customLayout) { world.layout(); baseLayout(); }
    refit(); resizeHooks.forEach(fn => fn(size));
    clearTimeout(settle); if (look) settle = setTimeout(() => { built = ''; }, 400);
  }
  let settle = 0;

  // ── Camera: a tilted view of the XZ board; drag to pan, wheel or pinch to zoom ──
  const home = new THREE.Vector3(0, 0, 1.5);
  const view = { target: new THREE.Vector3(0, 0, 1.5), goal: new THREE.Vector3(0, 0, 1.5), dist: 70, goalDist: 70, tilt: .6, yaw: 0, par: new THREE.Vector2(), parGoal: new THREE.Vector2(), vel: new THREE.Vector3() };
  let fitDist = 70, homed = true, focused = false; // focused: the view moved to show a node, and goes home when its panel closes
  // The far plane reaches past the farthest zoom-out (1.5 fits) and the board behind the target: a long lens on a big board stands
  // the camera hundreds of units off.
  function refit() {
    fitDist = fit(); if (homed) { view.goal.copy(home); view.goalDist = fitDist; }
    const far = Math.max(600, fitDist * 2.2); if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
  }
  function fit() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x, z, r) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r + .8); };
    for (const n of world.nodes) add(n.rest.x, n.rest.z, sizes[n.kind] + 1.6);
    frameExtra?.(add);
    home.set((x0 + x1) / 2, 0, (z0 + z1) / 2 + 1);
    const half = THREE.MathUtils.degToRad(camera.fov / 2), aspect = size.w / size.h;
    const vert = (z1 - z0) / 2 * Math.cos(view.tilt) * 1.1 + 2.5, horiz = (x1 - x0) / 2;
    return Math.max(vert / Math.tan(half), horiz / (Math.tan(half) * aspect)) * 1.04;
  }
  function place() {
    const tilt = view.tilt + view.par.y * .03, yaw = view.yaw + view.par.x * .035;
    const back = view.dist * Math.sin(tilt), up = view.dist * Math.cos(tilt);
    camera.position.set(view.target.x + Math.sin(yaw) * back, up, view.target.z + Math.cos(yaw) * back);
    camera.lookAt(view.target); camera.updateMatrixWorld();
  }
  const still = new THREE.Vector2();
  function cameraStep(dt) {
    if (!dragging && !pinch && view.vel.lengthSq() > 1e-4) { view.goal.addScaledVector(view.vel, dt); view.vel.multiplyScalar(Math.exp(-dt * 5)); }
    view.target.x = kit.damp(view.target.x, view.goal.x, 9, dt); view.target.z = kit.damp(view.target.z, view.goal.z, 9, dt);
    view.dist = kit.damp(view.dist, view.goalDist, 8, dt);
    view.par.lerp(reduced ? still : view.parGoal, 1 - Math.exp(-dt * 3));
    place();
  }
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  function ground(x, y, out = new THREE.Vector3()) {
    ndc.set(x / size.w * 2 - 1, -(y / size.h) * 2 + 1); ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, out) || out.copy(view.target);
  }
  const proj = new THREE.Vector3(), camRight = new THREE.Vector3(), pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  function toScreen(v, out = { x: 0, y: 0, z: 0 }) { proj.copy(v).project(camera); out.x = (proj.x + 1) / 2 * size.w; out.y = (1 - proj.y) / 2 * size.h; out.z = proj.z; return out; }
  // Screen pixels to a world unit across the view at p.
  function pxPer(p) { camRight.setFromMatrixColumn(camera.matrixWorld, 0).add(p); toScreen(p, pa); toScreen(camRight, pb); return Math.hypot(pb.x - pa.x, pb.y - pa.y); }
  const pxRadius = n => pxPer(n.pos) * sizes[n.kind];
  // A footprint, from ctx.setShape: { hx, hz, y } half extents round its centre on the plane at height y. Rect tests on that plane:
  // how far (x, y) on screen is into it (under 1 is inside, `pad` world units of slack round it), and its box on screen.
  const lift = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), corner = new THREE.Vector3();
  // A raised footprint is its top face and its base both, and the sides between: the nearer of the two planes counts.
  function intoRect(x, y, c, f) {
    ndc.set(x / size.w * 2 - 1, -(y / size.h) * 2 + 1); ray.setFromCamera(ndc, camera);
    const pad = Math.max(.12, 6 / Math.max(1e-3, pxPer(c)));
    let best = Infinity;
    for (let j = f.y > .05 ? 2 : 1; j--;) {
      lift.constant = j ? -(f.y || 0) : 0;
      if (ray.ray.intersectPlane(lift, hit)) best = Math.min(best, Math.max(Math.abs(hit.x - c.x) / (f.hx + pad), Math.abs(hit.z - c.z) / (f.hz + pad)));
    }
    return best;
  }
  function rectBox(c, f, out) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const top = f.y || 0, n = top > .05 ? 8 : 4;
    for (let i = 0; i < n; i++) {
      toScreen(corner.set(c.x + (i & 1 ? f.hx : -f.hx), i & 4 ? 0 : top, c.z + (i & 2 ? f.hz : -f.hz)), pa);
      x0 = Math.min(x0, pa.x); x1 = Math.max(x1, pa.x); y0 = Math.min(y0, pa.y); y1 = Math.max(y1, pa.y);
    }
    out[0] = x0; out[1] = y0; out[2] = x1; out[3] = y1; return out;
  }
  // The part of the board the panel leaves free, in board pixels: left of it on wide screens, above it on phones.
  function freeArea() {
    const panel = document.querySelector('#panel'), box = container.getBoundingClientRect();
    if (!panel || panel.hidden) return { dx: 0, dy: 0 };
    const r = panel.getBoundingClientRect();
    return r.left > box.left + box.width / 3 ? { dx: Math.max(0, box.right - r.left) / 2, dy: 0 } : { dx: 0, dy: Math.max(0, box.bottom - r.top) / 2 };
  }
  // Centre a node in the free part of the board.
  function focus(n, zoom = true) {
    homed = false; focused = true;
    if (zoom) view.goalDist = Math.min(view.goalDist, fitDist * .55);
    const upp = 2 * view.goalDist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / size.h, { dx, dy } = freeArea();
    view.goal.set(n.pos.x + dx * upp, 0, n.pos.z + 1 + dy * upp / Math.cos(view.tilt)); view.vel.set(0, 0, 0);
  }
  function resetView() { homed = true; focused = false; view.goal.copy(home); view.goalDist = fitDist; view.vel.set(0, 0, 0); }

  // ── Picking: a look's footprint (setShape) when it gives one, else a circle the node's size ──
  const pp = { x: 0, y: 0, z: 0 }, flat = { hx: 0, hz: 0, y: 0 };
  // A shown label is its node too, and it's drawn over everything, so it comes first.
  function labelAt(x, y) {
    for (const [n, el] of labels) if (el._mode && n.s.alive >= .5 && x > el._x0 - 2 && x < el._x1 + 2 && y > el._y0 - 2 && y < el._y1 + 2) return n;
    return null;
  }
  function pick(x, y) {
    const l = labelAt(x, y); if (l) return l;
    let best = null, score = Infinity;
    for (const n of world.nodes) {
      if (n.s.alive < .5) continue;
      const f = shapeOf?.(n);
      let d;
      if (f) d = intoRect(x, y, n.pos, f);
      else { const r = Math.max(10, pxRadius(n) * 1.15); toScreen(n.pos, pp); d = Math.hypot(pp.x - x, pp.y - y) / r; }
      if (d < 1 && d < score) { score = d; best = n; }
    }
    for (const t of targets) if (t.action === 'node' && t.node.s.alive >= .5) { const d = intoTarget(x, y, t); if (d < 1 && d < score) { score = d; best = t.node; } }
    return best;
  }
  // Things a look attached to a node (ctx.addTarget): ones that do something else when clicked, like a screen of its screenshots,
  // and ones that are more of the node itself (action 'node'), like a display of its name set off to one side.
  let targets = [];
  function intoTarget(x, y, t) {
    if (t.hx) { flat.hx = t.hx; flat.hz = t.hz; flat.y = t.pos.y; return intoRect(x, y, t.pos, flat); }
    const r = Math.max(10, pxPer(t.pos) * t.radius); toScreen(t.pos, pp); return Math.hypot(pp.x - x, pp.y - y) / r;
  }
  function target(x, y) {
    if (labelAt(x, y)) return null;
    let best = null, score = Infinity;
    for (const t of targets) {
      if (t.action === 'node' || t.node.s.alive < .5 || (t.action === 'shots' && !shots.count(t.node.id))) continue;
      const d = intoTarget(x, y, t);
      if (d < 1 && d < score) { score = d; best = t; }
    }
    return best;
  }
  const act = t => { if (t.action === 'shots') hooks.showShots?.(t.node.id, shots.images(t.node.id), () => nodes.panelClosed()); };
  const local = e => { const box = canvas.getBoundingClientRect(); return { x: e.clientX - box.left, y: e.clientY - box.top }; };

  // ── Pointer: click a node to open it, drag anywhere to pan. Nodes stay where the layout puts them: there's nothing to arrange. ──
  const pointers = new Map();
  let down = null, dragging = false, pinch = null, hovered = null, lastMove = { t: 0 };
  const panFrom = new THREE.Vector3(), tmpV = new THREE.Vector3();
  const onDown = e => {
    const at = local(e);
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, at);
    if (pointers.size === 2) { startPinch(); down = null; return; }
    const t = target(at.x, at.y), n = t ? null : pick(at.x, at.y);
    down = { ...at, node: n, target: t, dismissed }; dismissed = false; dragging = false; view.vel.set(0, 0, 0);
    if (n) n.pressed = true;
    ground(at.x, at.y, panFrom);
  };
  const onMove = e => {
    const at = local(e), p = pointers.get(e.pointerId);
    if (p) Object.assign(p, at);
    view.parGoal.set(at.x / size.w * 2 - 1, at.y / size.h * 2 - 1);
    if (pinch && pointers.size === 2) return movePinch();
    if (!down) return hover(at.x, at.y);
    if (!dragging && Math.hypot(at.x - down.x, at.y - down.y) > 5) { dragging = true; if (down.node) down.node.pressed = false; tipEl.hidden = true; }
    if (!dragging) return;
    place(); ground(at.x, at.y, tmpV);
    const dx = panFrom.x - tmpV.x, dz = panFrom.z - tmpV.z, now = performance.now(), dtm = Math.max(1, now - lastMove.t);
    view.target.x += dx; view.target.z += dz; view.goal.copy(view.target); place(); homed = focused = false;
    view.vel.set(dx / dtm * 1000, 0, dz / dtm * 1000).multiplyScalar(.5); lastMove.t = now;
    canvas.style.cursor = 'grabbing';
  };
  const release = e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!down) return;
    const n = down.node;
    if (n) n.pressed = false;
    if (!dragging) { view.vel.set(0, 0, 0); if (down.dismissed) { /* that press only closed the menu */ } else if (down.target) act(down.target); else if (n) click(n); }
    else if (performance.now() - lastMove.t > 80) view.vel.set(0, 0, 0);
    down = null; dragging = false; canvas.style.cursor = '';
    const at = local(e); hover(at.x, at.y);
  };
  const onLeave = () => { if (!down) setHover(null); };
  // Double-click the board: a step closer at the pointer; from as close as it goes, back home.
  const onDouble = e => { const at = local(e); if (pick(at.x, at.y) || target(at.x, at.y)) return; if (view.goalDist <= fitDist * .3) resetView(); else zoomBy(at.x, at.y, .55); };
  const onWheel = e => { e.preventDefault(); const at = local(e); zoomAt(at.x, at.y, e.deltaY, e.ctrlKey); };
  const zoomAt = (x, y, deltaY, fine) => zoomBy(x, y, Math.exp(deltaY * (fine ? .01 : .0012)));
  // Scale the distance by k, keeping the board point under (x, y) where it is.
  function zoomBy(x, y, k) {
    homed = focused = false;
    const before = ground(x, y, new THREE.Vector3()), old = view.goalDist;
    view.goalDist = kit.clamp(view.goalDist * k, fitDist * .28, fitDist * 1.5);
    view.goal.lerp(before.setY(0), 1 - view.goalDist / old);
  }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    homed = false; pinch = { span: Math.hypot(a.x - b.x, a.y - b.y), dist: view.goalDist, mid: ground((a.x + b.x) / 2, (a.y + b.y) / 2, new THREE.Vector3()) };
    if (down?.node) down.node.pressed = false;
  }
  function movePinch() {
    const [a, b] = [...pointers.values()], span = Math.hypot(a.x - b.x, a.y - b.y);
    view.goalDist = view.dist = kit.clamp(pinch.dist * pinch.span / Math.max(span, 1), fitDist * .28, fitDist * 1.5); place();
    ground((a.x + b.x) / 2, (a.y + b.y) / 2, tmpV);
    view.target.x += pinch.mid.x - tmpV.x; view.target.z += pinch.mid.z - tmpV.z; view.goal.copy(view.target); place();
  }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release); canvas.addEventListener('pointerleave', onLeave); canvas.addEventListener('dblclick', onDouble);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function hover(x, y) {
    const t = x == null ? null : target(x, y);
    for (const other of targets) other.hovered = other === t;
    if (t) {
      setHover(null); canvas.style.cursor = 'pointer'; tipEl.hidden = false;
      const count = shots.count(t.node.id), html = `<b>${count} screenshot${count === 1 ? '' : 's'}</b><div class="meta">${esc(t.node.name)}</div>`;
      if (tipEl._html !== html) tipEl.innerHTML = tipEl._html = html;
      placeTip(x, y); return;
    }
    const n = x == null || menu.open ? null : pick(x, y);
    setHover(n);
    if (n) n.magnet = ground(x, y, new THREE.Vector3());
    canvas.style.cursor = n ? 'pointer' : '';
    if (n && n.kind !== 'you') { tipEl.hidden = false; tip(n); placeTip(x, y); } else tipEl.hidden = true;
  }
  function setHover(n) {
    if (hovered === n) return;
    if (hovered) { hovered.hovered = false; hovered.magnet = null; }
    hovered = n; if (n) n.hovered = true;
    if (!n) tipEl.hidden = true;
  }
  function placeTip(x, y) {
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.transform = `translate(${Math.max(8, Math.min(size.w - w - 8, x + 16))}px, ${Math.max(8, Math.min(size.h - h - 8, y + 16))}px)`;
  }
  function tip(n) {
    if (n.kind === 'project') {
      const html = `<b>${esc(n.name)}</b><div class="meta">+ New session</div>`;
      if (tipEl._html !== html) tipEl.innerHTML = tipEl._html = html;
      return;
    }
    const meta = [n.project.name, PROVIDER[n.provider], n.ctx ? `ctx ${Math.round(n.ctx * 100)}%` : '', n.plan && `plan ${n.plan.done}/${n.plan.total}`, n.mode].filter(Boolean).join(' · ');
    const html = `<b>${esc(n.name)}</b><div class="row"><i class="dot" style="--c:${STATUS_VAR[n.status]}"></i><span>${esc(statusLine(n))}</span></div><div class="meta">${esc(meta)}</div>`;
    if (tipEl._html !== html) tipEl.innerHTML = tipEl._html = html;
  }
  function click(n) {
    n.vel.y -= 5 * world.motion.kick;
    if (n.kind === 'you') { const next = hooks.nextWaiting?.(); if (next) nodes.talkTo(next.id); return; }
    if (n.kind === 'project') { offerNew(n); return; }
    show(n, false);
  }

  // ── A project is the way to start a session in its folder: click it for the new-agent menu, which stays by it as the view moves ──
  const menu = createMenu(container, (cwd, choice, item) => hooks.spawn?.(cwd, choice, item), () => { menuNode = null; });
  let menuNode = null, dismissed = false, snapshot = null;
  const menuAt = { clientX: 0, clientY: 0 };
  // Beside the node, up and to the right; the menu flips to fit.
  function menuPoint(n) {
    const box = canvas.getBoundingClientRect(), p = toScreen(n.pos), r = pxRadius(n) * .7;
    menuAt.clientX = box.left + p.x + r; menuAt.clientY = box.top + p.y - r - 18; return menuAt;
  }
  function offerNew(n) {
    const cwd = n.sessions.map(s => s.session?.cwd).find(Boolean) ?? null;
    const known = [...new Set((snapshot?.sessions || []).map(s => s.cwd).filter(Boolean))].sort();
    setHover(null);
    menu.show(cwd, menuPoint(n), false, hireChoices(snapshot, cwd ?? ''), cwd === null ? known : []);
    menuNode = n;
  }
  let menuX = 0, menuY = 0;
  function followMenu() {
    if (!menuNode || !menu.open) return;
    if (!menuNode.present || menuNode.s.alive < .5) { menu.close(); return; }
    const p = toScreen(menuNode.pos, sp);
    if (p.z > 1 || p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) { menu.close(); return; }
    if (Math.abs(p.x - menuX) < .5 && Math.abs(p.y - menuY) < .5) return;
    menuX = p.x; menuY = p.y; menu.move(menuPoint(menuNode));
  }
  // A press anywhere else closes it, before what's under it acts.
  const press = e => { dismissed = menu.open && !menu.contains(e.target); if (dismissed) menu.close(); };
  document.addEventListener('pointerdown', press, true);
  // The panel opens first, so the node can be moved clear of it.
  function show(n, zoom) { hooks.openPanel?.(n.id); requestAnimationFrame(() => { if (!broken && n.present) focus(n, zoom); }); }

  // ── The scene's own buttons: the next one waiting on you, and the list ──
  const bar = document.createElement('div'); bar.className = 'nodes-overlay'; container.append(bar);
  const button = (text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; bar.append(b); return b; };
  const next = button('', 'Next waiting (n)', () => nodes.talkTo(hooks.nextWaiting?.()?.id)); next.className = 'nodes-next'; next.hidden = true;
  button('☰', 'Show the list', () => hooks.showList?.());

  // ── Labels: every session's name and what it's doing, always; projects by name; subagents while they work ──
  const labels = new Map();
  function remeasure() { for (const el of labels.values()) el._html = null; }
  document.fonts?.addEventListener?.('loadingdone', remeasure);
  function labelFor(n) {
    let el = labels.get(n);
    // Hidden until the placer finds it a spot: one it never finds room for mustn't show at the board's corner.
    if (!el) { el = document.createElement('div'); el.className = `lbl ${n.kind} hide`; labelsEl.append(el); labels.set(n, el); el._mode = 0; }
    return el;
  }
  function dropLabels() { for (const [n, el] of labels) if (!world.nodes.includes(n)) { el.remove(); labels.delete(n); } }
  // A label's size in full, and brief: the name alone, cut to BRIEF px (as .lbl.brief b in nodes.css).
  const BRIEF = 150;
  function measure(el) {
    const cls = el.classList, brief = cls.contains('brief'), on = cls.contains('on'), mw = el.style.maxWidth;
    if (brief) cls.remove('brief'); if (on) cls.remove('on'); if (mw) el.style.maxWidth = '';
    const b = el.firstElementChild, s = b?.nextElementSibling;
    el._w = el.offsetWidth; el._h = el.offsetHeight;
    if (b) { const bw = b.offsetWidth; el._bw = el._w - Math.max(bw, s?.offsetWidth || 0) + Math.min(bw, BRIEF); el._bh = s ? Math.max(b.offsetHeight, el._h - s.offsetHeight) : el._h; }
    else { el._bw = el._w; el._bh = el._h; }
    if (brief) cls.add('brief'); if (on) cls.add('on'); if (mw) el.style.maxWidth = mw;
  }
  const sp = { x: 0, y: 0, z: 0 }, at = { x: 0, y: 0, z: 0 }, below = new THREE.Vector3(), cand = [], pool = [], placed = [], bodies = [], tall = [], rects = [], foot = [0, 0, 0, 0];
  let rectN = 0;
  function rect(x0, y0, x1, y1) { const r = rects[rectN] || (rects[rectN] = [0, 0, 0, 0]); rectN++; r[0] = x0; r[1] = y0; r[2] = x1; r[3] = y1; return r; }
  function clear(list, x0, y0, x1, y1) { for (const r of list) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false; return true; }
  const labelRank = (n, need) => n.selected ? 9 : n.hovered ? 8 : need ? 7 : n.kind === 'you' ? 6 : n.status === 'error' ? 5 : n.kind === 'session' ? 4 : n.kind === 'project' ? 3 : 1;
  const busy = n => n.status === 'working' || n.status === 'thinking' || n.status === 'compacting';
  // Where a label of w × h may go round its node, as top-centre points: 8 beside it, then 6 a step further out.
  const spot = new Float64Array(28);
  function spotsFor(c, w, h) {
    const up = (c.ay ?? 2 * c.ny - c.y) - h, slide = w / 2 + c.gap * .4, mid = c.ny - h / 2, rx = c.rx + w / 2, lx = c.lx - w / 2;
    spot.set([c.x, c.y, c.x, up, rx, mid, lx, mid, c.x + slide, c.y, c.x - slide, c.y, c.x + slide, up, c.x - slide, up,
      c.x, c.y + h + 3, c.x, up - h - 3, rx, mid + h + 3, lx, mid + h + 3, rx, mid - h - 3, lx, mid - h - 3]);
  }
  let measureTick = 0;
  function renderLabels() {
    const near = view.dist < fitDist * .72, zoom = fitDist / view.dist, q = world.queue().length; // near, zoom: for looks' label rules
    let cn = 0; cand.length = 0; rectN = 0; placed.length = bodies.length = tall.length = 0;
    if (++measureTick % 30 === 0) for (const el of labels.values()) if (el._mode === 1) measure(el);
    for (const n of world.nodes) {
      const el = labelFor(n), need = needs(n), alive = n.s.alive > .5, f = alive ? shapeOf?.(n) : null;
      // Nodes are in the way of other labels: a footprint whole, else the middle of a body; for projects and subagents also the rest of
      // a tall body (up to the look's above anchor). Session labels matter more than that.
      let top = null;
      if (alive) {
        if (labelAbove) { labelAbove(n, below.copy(n.pos)); top = toScreen(below, at).y; }
        if (f) rectBox(n.pos, f, foot);
        else { toScreen(n.pos, at); const r = pxRadius(n) * .5; foot[0] = at.x - r; foot[1] = at.y - r; foot[2] = at.x + r; foot[3] = at.y + r; }
        bodies.push(rect(foot[0], foot[1], foot[2], foot[3])); tall.push(rect(foot[0], Math.min(foot[1], top ?? Infinity), foot[2], foot[3]));
      }

      let show = alive, on = false;
      if (n.kind === 'sub') show &&= n.hovered || n.selected || need || busy(n) || view.dist < fitDist * .45;
      if (labelRule) { const r = labelRule(n, { near, zoom }); if (r === 'on') on = show = alive; else if (typeof r === 'boolean') show = r && alive; }
      if (labelAnchor) labelAnchor(n, below.copy(n.pos), on); else { below.copy(n.pos); below.z += sizes[n.kind] * 1.25 + (n.kind === 'project' ? .4 : .15); below.y = 0; }
      toScreen(below, sp);
      if (sp.z > 1 || sp.x < -200 || sp.x > size.w + 200 || sp.y < -100 || sp.y > size.h + 100) show = false;
      if (!show) { if (el._mode) { el.classList.add('hide'); el._mode = 0; } continue; }
      let html;
      if (n.kind === 'you') html = `<b>You</b><span>${q ? `${q} waiting` : 'all clear'}</span>`;
      // A subagent's name alone, quieter (nodes.css), so it doesn't read as its session's status; what it's doing is in the tooltip.
      else if (n.kind === 'project' || n.kind === 'sub') html = `<b>${esc(n.name)}</b>`;
      else html = `<b>${esc(n.name)}</b><span>${esc(statusLine(n))}</span>`;
      if (el._html !== html) { el.innerHTML = el._html = html; measure(el); }
      el.classList.toggle('need', need); el.classList.toggle('error', n.status === 'error');
      const c = pool[cn] || (pool[cn] = {}); cn++;
      c.el = el; c.on = on; c.x = sp.x; c.y = sp.y; c.z = sp.z; c.rank = labelRank(n, need); c.sub = n.kind === 'sub';
      // 'on': the name on the node itself, as wide as the look allows. Else beside the node: the box round a footprint, or the circle.
      if (on) { c.tw = (f?.tw ?? sizes[n.kind] * 1.6) * pxPer(below); cand.push(c); continue; }
      if (f) { c.nx = (foot[0] + foot[2]) / 2; c.ny = (foot[1] + foot[3]) / 2; c.gap = 6; c.rx = foot[2] + 6; c.lx = foot[0] - 6; c.ay = Math.min(foot[1], top ?? Infinity) - 3; }
      else { toScreen(n.pos, at); const r = pxRadius(n); c.nx = at.x; c.ny = at.y; c.gap = r * .9 + 6; c.rx = at.x + c.gap; c.lx = at.x - c.gap; c.ay = top; }
      cand.push(c);
    }
    // Greedy: names on their nodes first, then the most important label claims its spot: in full beside its node; else brief (the name
    // alone), beside it or a step further out; else, for sessions and up, brief over other nodes, minding only other labels. A label
    // keeps its spot while it fits, and needs a little extra room to come back or grow, so none of them flicker.
    cand.sort((a, b) => b.on - a.on || b.rank - a.rank || a.z - b.z);
    for (const c of cand) {
      const { el } = c;
      if (c.on) {
        const w = Math.min(el._bw, c.tw), h = el._bh, mw = `${Math.max(0, c.tw).toFixed(0)}px`;
        if (el.style.maxWidth !== mw) el.style.maxWidth = mw;
        showLabel(el, 3, 0);
        placed.push(rect(el._x0 = c.x - w / 2, el._y0 = c.y - h / 2, el._x1 = c.x + w / 2, el._y1 = c.y + h / 2));
        el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        continue;
      }
      let mode = 0, side = 0, x = 0, y = 0;
      for (let stage = 1; stage <= 3 && !mode; stage++) {
        if (stage === 3 && c.rank < 4) break;
        // A subagent's label stays beside it: further out it would pass for its session's.
        const brief = stage > 1, w = brief ? el._bw : el._w, h = brief ? el._bh : el._h, count = stage === 1 || c.sub ? 8 : 14;
        const was = el._mode === stage + (stage === 3 ? 1 : 0), pad = was ? 1 : 6, first = was ? el._side : 0;
        spotsFor(c, w, h);
        for (let k = -1; k < count; k++) {
          const i = k < 0 ? first : k; if (k >= 0 && i === first) continue;
          x = Math.min(Math.max(spot[i * 2], w / 2 + 8), size.w - w / 2 - 8); y = spot[i * 2 + 1];
          const x0 = x - w / 2 - pad, y0 = y - pad, x1 = x + w / 2 + pad, y1 = y + h + pad;
          if (!clear(placed, x0, y0, x1, y1)) continue;
          if (stage < 3 && c.rank < 7 && !clear(c.rank >= 4 ? bodies : tall, x0, y0, x1, y1)) continue;
          mode = stage === 3 ? 4 : stage; side = i; placed.push(rect(el._x0 = x - w / 2, el._y0 = y, el._x1 = x + w / 2, el._y1 = y + h)); break;
        }
      }
      if (!mode) { if (el._mode) { el.classList.add('hide'); el._mode = 0; } continue; }
      showLabel(el, mode, side);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`;
    }
  }
  // Modes: 1 in full, 2 brief, 3 on its node, 4 brief over other nodes.
  function showLabel(el, mode, side) {
    if (el._mode !== mode) {
      const cls = el.classList;
      cls.remove('hide'); cls.toggle('brief', mode > 1); cls.toggle('on', mode === 3);
      if (mode !== 3 && el.style.maxWidth) el.style.maxWidth = '';
      el._mode = mode;
    }
    el._side = side;
  }

  // ── Shared juice: hops and nudges from events, before the look sees them ──
  function juice(events) {
    const j = world.motion.kick; if (!j) return;
    for (const { type, node: n, data } of events) {
      if (type === 'finish') n.vel.y += 7 * j;
      else if (type === 'need') { n.vel.y += 6 * j; for (const s of n.parent.sessions || []) if (s !== n) s.vel.addScaledVector(tmpV.subVectors(s.pos, n.pos).setY(0).normalize(), 3 * j); }
      else if (type === 'answer') n.vel.y += 4 * j;
      else if (type === 'spawn') n.vel.y += 3 * j;
      else if (type === 'state' && data.to === 'error') n.vel.x += 6 * j;
    }
  }

  // ── Screenshots: kept here, not in a look, so they outlast rebuilds ──
  const shotOf = new Map();
  const shots = createScreenshots({ room: { setShot: (id, shot) => { if (shot) shotOf.set(id, shot); else shotOf.delete(id); } }, width: 512, height: 320 });

  // ── Looks ──
  let look = null, lookId = null, wantedId = null, mod = null, root = null, styleEl = null, built = '', loading = null, broken = false;
  function disposeTree(obj) {
    obj.traverse(o => {
      o.geometry?.dispose?.();
      for (const m of [o.material].flat()) { if (!m) continue; for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) u.value.dispose(); m.dispose(); }
    });
  }
  function resetRenderer() {
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 1);
    scene.background = null; scene.environment = null; scene.fog = null; scene.environmentIntensity = 1; scene.backgroundIntensity = 1;
    bloom.enabled = true; bloom.strength = .6; bloom.radius = .4; bloom.threshold = .85;
    for (const p of extraPasses) { composer.removePass(p); p.dispose?.(); }
    extraPasses = []; resizeHooks.clear();
    view.tilt = .6; camera.fov = 34; camera.near = .5; camera.updateProjectionMatrix();
    customLayout = shapeOf = null; sizes = { ...kit.SIZE }; labelAnchor = labelAbove = labelRule = frameExtra = null; targets = [];
    world.motion = { zeta: .42, k: 46, drift: 1, kick: 1 };
  }
  function teardown() {
    if (look) { try { look.dispose?.(); } catch (e) { console.error(e); } }
    if (root) { scene.remove(root); disposeTree(root); }
    scene.clear(); look = null; root = null;
  }
  // Build the look for the nodes there are now. Positions, signals and the camera carry over; the look's own effects start afresh.
  function build() {
    teardown(); resetRenderer();
    built = world.structure;
    world.layout(); baseLayout();
    root = new THREE.Group(); scene.add(root);
    const ctx = {
      THREE, kit, scene, root, camera, renderer, composer, world, size, dark: lookId.endsWith('-dark'),
      get reduced() { return reduced; },
      setPost({ bloom: b, exposure, toneMapping } = {}) {
        if (b === false) bloom.enabled = false;
        else if (b) { bloom.enabled = true; bloom.strength = b.strength ?? bloom.strength; bloom.radius = b.radius ?? bloom.radius; bloom.threshold = b.threshold ?? bloom.threshold; }
        if (exposure !== undefined) renderer.toneMappingExposure = exposure;
        if (toneMapping !== undefined) renderer.toneMapping = toneMapping;
      },
      addPass(pass) { composer.insertPass(pass, composer.passes.indexOf(output)); extraPasses.push(pass); return pass; },
      setView({ tilt, fov } = {}) { if (tilt !== undefined) view.tilt = tilt; if (fov !== undefined) { camera.fov = fov; camera.updateProjectionMatrix(); } refit(); },
      onResize(fn) { resizeHooks.add(fn); },
      setSizes(next) { Object.assign(sizes, next); },
      // More to keep in the home view than the nodes, like things a look hangs off them: fn(add) calls add(x, z, radius).
      setFrame(fn) { frameExtra = fn; refit(); },
      setMotion(next) { Object.assign(world.motion, next); },
      // Where a label goes: below(n, out) moves out (= n.pos) to the spot under the node; above(n, out), optional, to the top of a tall
      // body, for when the spot below is taken. Without it, above mirrors below round the node's foot.
      setLabelAnchor(below, above) { labelAnchor = below; labelAbove = above || null; },
      setLabelRule(fn) { labelRule = fn; },
      // The newest screenshot a session looked at, { bitmap: ImageBitmap (fitted to 512×320), count }, or null. The same object
      // until it changes, so a look can compare it each frame and redraw only then.
      shot: n => shotOf.get(n.id) || null,
      // A node's footprint, for picking and for keeping labels off it: fn(n) returns { hx, hz, y, tw? }, half extents round n.pos on
      // the plane at height y (tw: the width a name on it may take, for 'on' labels), or null for the circle of its size.
      setShape(fn) { shapeOf = fn; },
      // Make something on a node clickable: { node, pos (a Vector3 the look keeps up to date), radius (world units), action: 'shots' };
      // hx and hz instead of radius make it a rectangle round pos, at pos.y.
      // The board sets its `hovered` while the pointer is on it.
      // 'shots' opens the image viewer on that session's screenshots, and is only clickable while it has some.
      addTarget(t) { targets.push(t); return t; },
      setLayout(fn) { customLayout = fn; relayout(); refit(); },
    };
    try { look = mod.create(ctx); look.update(0, world.time); } catch (e) { console.error(e); look = null; }
    refit(); resizeHooks.forEach(fn => fn(size));
    remeasure(); dropLabels();
  }
  // The theme's choice changed, or the first snapshot came: load the look, fade, build.
  async function setLook(id) {
    wantedId = id;
    if (loading || id === lookId) return;
    loading = LOOKS[id]().then(m => m.default);
    let next;
    try { next = await loading; } catch (e) { console.error(e); } finally { loading = null; }
    if (broken || !next) return;
    if (look && !reduced) { fadeEl.classList.remove('out'); await new Promise(r => setTimeout(r, 300)); }
    if (broken) return;
    mod = next; lookId = id;
    styleEl?.remove(); styleEl = null;
    container.dataset.look = mod.id; container.toggleAttribute('data-dark', id.endsWith('-dark'));
    if (mod.css) { styleEl = document.createElement('style'); styleEl.textContent = mod.css.replaceAll('body[data-look=', '.nodes-scene[data-look='); document.head.append(styleEl); }
    const first = !look;
    build(); homed = true; refit(); view.dist = view.goalDist; view.target.copy(view.goal); place();
    if (first) for (const n of world.nodes) n.pos.copy(n.rest);
    fadeEl.classList.add('out');
    if (wantedId !== lookId) setLook(wantedId);
  }

  // ── Loop ──
  let raf = 0, lastFrame = performance.now();
  const stop = () => { broken = true; cancelAnimationFrame(raf); };
  const onLost = e => { e.preventDefault(); stop(); };
  canvas.addEventListener('webglcontextlost', onLost);
  const onReduced = e => { reduced = world.reduced = e.matches; };
  osReduced.addEventListener?.('change', onReduced);
  const observer = new ResizeObserver(() => resize()); observer.observe(container); resize();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { lastFrame = now; return; }
    const dt = frameTime(now, lastFrame, .05); lastFrame = now;
    try {
      if (mod && built !== world.structure) build();
      const selectedId = hooks.selected?.();
      for (const n of world.nodes) n.selected = !!selectedId && n.id === selectedId;
      const events = world.update(dt);
      juice(events);
      if (look) {
        try { for (const e of events) look.event?.(e.type, e.node, e.data); look.update(dt, world.time); }
        catch (e) { console.error(e); look = null; }
      }
      cameraStep(dt);
      renderLabels();
      followMenu();
      if (hovered && !tipEl.hidden) tip(hovered);
      for (const p of extraPasses) if (p.uniforms?.time) p.uniforms.time.value = world.time;
      composer.render(dt);
    } catch (error) { console.error(error); stop(); }
  }
  raf = requestAnimationFrame(frame);

  // For the console and headless checks: board.world.sync({ sessions: [...] }) plays any snapshot.
  container.board = { world, setLook };
  const nodes = {
    // syncScene turns this throw into the fallback to the list.
    update(next, { error } = {}) {
      if (broken) throw new Error('Nodes lost its graphics context');
      snapshot = next; world.sync(next, { error: !!error });
      if (!error) shots.sync((next.sessions || []).filter(session => !session.parentId));
      container.classList.toggle('offline', !!error);
      const waiting = world.queue().length; next.hidden = !waiting; next.textContent = `⚠ ${waiting}`;
      setLook(lookFor(document.documentElement.dataset.themeChoice));
    },
    unmount() {
      stop(); clearTimeout(settle); shots.dispose(); observer.disconnect(); osReduced.removeEventListener?.('change', onReduced);
      document.removeEventListener('pointerdown', press, true); menu.dispose();
      document.fonts?.removeEventListener?.('loadingdone', remeasure);
      teardown(); styleEl?.remove();
      for (const p of extraPasses) p.dispose?.();
      composer.dispose?.(); bloom.dispose?.(); renderer.dispose();
      canvas.remove(); labelsEl.remove(); tipEl.remove(); fadeEl.remove(); bar.remove();
      container.classList.remove('nodes-scene', 'offline'); container.removeAttribute('data-dark'); delete container.dataset.look; delete container.board;
    },
    // A filter or project picked in the sidebar: from a click, frame who it takes in.
    pick(test, open) {
      if (!test || !open) { if (open) resetView(); return; }
      const taken = world.nodes.filter(n => n.present && n.session && test(n.session));
      if (!taken.length) return;
      const centre = new THREE.Vector3(); for (const n of taken) centre.add(n.pos); centre.divideScalar(taken.length);
      homed = false; view.goal.set(centre.x, 0, centre.z + 1); view.goalDist = taken.length === 1 ? fitDist * .5 : fitDist * .7;
    },
    panelClosed() { if (focused) resetView(); },
    talkTo(id) {
      const n = id && world.byId(id);
      if (n) show(n, true); else if (id) hooks.openPanel?.(id);
    },
    fire(id) { world.remove(id); },
    // With the panel open, what's under a point: a session's id, to open it in the panel's place.
    at(x, y) { const box = canvas.getBoundingClientRect(), n = pick(x - box.left, y - box.top); return n && (n.kind === 'session' || n.kind === 'sub') ? n.id : null; },
    hover(x, y) { if (x == null) return hover(null); const box = canvas.getBoundingClientRect(); hover(x - box.left, y - box.top); },
    scroll(x, y, dy) { const box = canvas.getBoundingClientRect(); zoomAt(x - box.left, y - box.top, dy, false); return true; },
  };
  return nodes;
}
