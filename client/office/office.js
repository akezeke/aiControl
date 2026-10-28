// The Office theme: a 3D office where each session is a fruit at a desk. main.js mounts it in place of the list.
import * as THREE from 'three';
import './office.css';
import { layoutOffice } from './layout.js';
import { officeStatus, identity, monitorLines } from './status.js';
import { createRoom } from './room.js';
import { Cast } from './animation.js';
import { Player, pick, officeHasKeys, sceneFocused, standNear, standBefore, EYE } from './player.js';
import { OfficeCamera } from './camera.js';
import { Bubbles, createCard, createOverlays } from './bubbles.js';
import { createBoards } from './boards.js';
import { highlight } from './toon.js';

export function webglAvailable() {
  // three.js needs WebGL 2; the probe's context is released straight away.
  try { const gl = document.createElement('canvas').getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
}

export function mountOffice(container, hooks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6e7c8');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.userData.canvas = renderer.domElement;
  const room = createRoom(scene);
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const cast = new Cast(scene, { reducedMotion: () => !!reducedMotion?.matches });
  let layout;

  const frames = new Set(), listeners = [];
  const listen = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };
  // What a click at a screen point gets: a speech bubble there counts as its character.
  const under = at => { const id = bubbles.at(at.clientX, at.clientY); return id ? { kind: 'character', id } : pick(at, renderer.domElement, camera, scene); };
  const player = new Player(renderer.domElement, {
    colliders: () => room.colliders,
    room: () => layout?.room,
    // In first person, a mouse click that isn't on someone (or a board) captures the mouse; captured, a click on the floor walks there.
    onPick: (at, mouse) => {
      const hit = under(at);
      if (hit?.kind === 'character') office.talkTo(hit.id);
      else if (hit?.kind === 'board') office.readBoard(hit.node);
      else if (mouse && !player.locked && !view.overview) player.lock();
      else if (hit?.kind === 'floor' && !view.overview) player.walkTo(hit.point);
    },
  });
  const view = new OfficeCamera(camera, scene, player, room, { reducedMotion: () => !!reducedMotion?.matches, container });
  const boards = createBoards(room);
  const bubbles = new Bubbles(container, id => office.talkTo(id));
  const card = createCard(container);
  // The overview frees the mouse to click around; leaving it with Tab captures the mouse again if it was.
  let relock = false;
  const overview = on => {
    if (on === view.overview) return;
    if (on) { relock = player.locked; player.unlock(); overlays.overviewUsed(); } else if (relock) { relock = false; player.lock(); }
    view.setOverview(on); player.setOverview(on); overlays.setOverview(on);
  };
  const overlays = createOverlays(container, { onNext: () => office.talkTo(hooks.nextWaiting()?.id), onList: () => hooks.showList(), onOverview: () => overview(!view.overview) });
  // Tab toggles the overview and Esc leaves it (Tab only from the scene itself: on a button or link it keeps moving focus).
  // E talks to whoever is outlined (or goes to the board), else to whoever is in front of you.
  listen(document, 'keydown', event => {
    if (!officeHasKeys(event)) return;
    if (event.key === 'Tab' && sceneFocused(renderer.domElement)) { event.preventDefault(); if (!event.repeat) overview(!view.overview); }
    else if (event.key === 'Escape' && view.overview) overview(false);
    else if (event.code === 'KeyE') { event.preventDefault(); if (board) office.readBoard(board); else office.talkTo(aimed || office.nearest()); }
  });
  // Outline whatever a click (or E) would get, with its card: under the dot when aiming with it, else under the mouse
  // (the scene or a bubble, not the buttons). Ten times a second is plenty.
  let mouse = null, hovered = null, aimed = null, board = null, dot = false, hoverIn = 0;
  listen(container, 'pointermove', event => {
    mouse = event.pointerType === 'mouse' && (event.target === renderer.domElement || event.target.closest?.('.office-bubble')) ? event : null;
    if (!dot) card.move(mouse);
  });
  listen(container, 'pointerleave', () => { mouse = null; });
  const hover = dt => {
    const aiming = player.aiming && !view.overview && !office.talking;
    if (aiming !== dot) { dot = aiming; overlays.showDot(aiming); hoverIn = 0; }
    if ((hoverIn -= dt) > 0) return;
    hoverIn = 0.1;
    const at = office.talking ? null : aiming ? player.centre : mouse, hit = at && under(at);
    aimed = hit?.kind === 'character' ? hit.id : null; board = hit?.kind === 'board' ? hit.node : null;
    const session = aimed && office.snapshot?.sessions.find(session => session.id === aimed);
    card.show(session && hooks.describe?.(session) || null); card.move(aiming ? player.centre : mouse);
    const node = aimed && cast.characters.get(aimed)?.root || board;
    renderer.domElement.style.cursor = node && !aiming ? 'pointer' : view.overview ? view.overhead.dragging ? 'grabbing' : 'grab' : '';
    if (node === hovered) return;
    highlight(hovered, false); highlight(node, true); hovered = node; overlays.setAim(!!node);
  };
  frames.add(dt => {
    if (player.locked && document.body.classList.contains('panel-open')) player.unlock();
    // The overview has the keys and drags while it's up: you stay where you were.
    if (!view.overview) player.update(dt);
    view.update(dt); cast.update(dt, player.position); bubbles.update(camera, id => cast.positionOf(id), view.amount); boards.tick(); hover(dt);
  });
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  let raf = 0, last = performance.now();
  const loop = now => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const fn of frames) fn(dt, now);
    renderer.render(scene, office.camera);
  };
  // Nothing renders while the tab is hidden; polling stops then too.
  const visibility = () => { cancelAnimationFrame(raf); raf = 0; if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', visibility); visibility();

  const office = {
    scene, renderer, camera, hooks, container,
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    update(snapshot, { error = '' } = {}) {
      office.snapshot = snapshot; office.error = error;
      layout = layoutOffice(snapshot.sessions, layout); view.setLayout(layout);
      cast.frozen = !!error;
      office.statuses = new Map(snapshot.sessions.map(session => [session.id, { ...officeStatus(session), identity: identity(session.id), monitor: monitorLines(session) }]));
      room.sync(layout, office.statuses);
      for (const face of Object.values(room.boards)) face.parent.userData.board = true; // clicking one takes you to it
      cast.sync(layout, snapshot.sessions, room, office.statuses);
      bubbles.sync(snapshot.sessions.filter(session => layout.desks.has(session.id) || session.parentId).map(session => ({ id: session.id, bubble: office.statuses.get(session.id).bubble, unread: hooks.isUnread?.(session) })));
      const waiting = snapshot.sessions.filter(session => office.statuses.get(session.id).bubble?.highlight);
      overlays.setWaiting(waiting.length);
      overlays.setUsageLow((snapshot.usage || []).some(account => account.windows?.some(window => window.usedPercent >= 80)));
      boards.sync(snapshot, { error, waiting: waiting.map(session => session.title || session.project) });
      office.layout = layout;
      // First snapshot: stand just inside the door, looking into the room.
      if (!office.placed) { office.placed = true; const { width, depth } = layout.room; player.place(layout.door.x, depth - 1.2, Math.atan2(width / 2 - layout.door.x, -(depth / 2))); }
    },
    unmount() {
      cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
      for (const fn of office.disposers) fn();
      scene.traverse(object => {
        object.geometry?.dispose();
        for (const material of [object.material].flat().filter(Boolean)) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); }
      });
      renderer.dispose(); renderer.domElement.remove();
    },
    room, cast, player, view,
    // Fly over, they turn to you, the view settles on their face, then their session opens beside the scene.
    talkTo(id) {
      const parent = office.snapshot?.sessions.find(session => session.id === id)?.parentId;
      const head = id && (cast.positionOf(id) || cast.positionOf(parent)); if (!head) return;
      const token = office.talking = {};
      relock = false; overview(false); player.unlock();
      const arrive = () => {
        if (office.talking !== token) return;
        cast.greet(id); view.focus(head.clone().setY(head.y - 0.25));
        setTimeout(() => { if (office.talking === token) hooks.openPanel(id); }, reducedMotion?.matches ? 0 : 400);
      };
      const spot = standNear(head, player.position, room.colliders, layout?.room);
      if (spot) player.flyTo(spot, head, arrive, !!reducedMotion?.matches); else player.walkTo(head.clone().setY(0), arrive, 1.1, true);
    },
    // Fly over to a board on the wall and face it, back far enough to take it all in (and not crane up at the clock).
    readBoard(node) {
      office.talking = null; relock = false; overview(false);
      const box = new THREE.Box3().setFromObject(node), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld).setY(0).normalize(), tan = Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
      const fit = Math.max(size.y / 2 / tan, Math.max(size.x, size.z) / 2 / (tan * camera.aspect)) * 1.25, rise = centre.y - EYE;
      const spot = standBefore(centre, normal, THREE.MathUtils.clamp(Math.max(fit, Math.abs(rise) * 1.7), 1, 3.5), room.colliders, layout?.room);
      if (spot) player.flyTo(spot, centre, null, !!reducedMotion?.matches, Math.atan2(rise, Math.hypot(centre.x - spot.x, centre.z - spot.z)));
    },
    // main.js calls this when the session panel closes.
    panelClosed() { office.talking = null; cast.greet(null); view.focus(null); },
    // E: whoever is within 2 m and roughly in front of you.
    nearest() {
      let best = null, bestDistance = 2;
      for (const id of cast.characters.keys()) {
        const at = cast.positionOf(id); if (!at) continue;
        const to = at.clone().sub(player.position).setY(0), distance = to.length();
        if (distance < bestDistance && to.normalize().dot(player.forward) > Math.cos(Math.PI / 6)) { best = id; bestDistance = distance; }
      }
      return best;
    },
    disposers: [() => boards.dispose(), () => bubbles.dispose(), () => card.dispose(), () => overlays.dispose(), () => cast.dispose(), () => player.dispose(), () => view.dispose(), () => { for (const fn of listeners) fn(); }],
  };
  if (import.meta.env?.DEV) globalThis.__office = office; // poke at it from devtools
  return office;
}
