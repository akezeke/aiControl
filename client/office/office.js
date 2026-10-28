// The Office theme: a 3D office where each session is a fruit at a desk. main.js mounts it in place of the list.
import * as THREE from 'three';
import './office.css';
import { layoutOffice } from './layout.js';
import { officeStatus, identity, monitorLines } from './status.js';
import { createRoom } from './room.js';
import { Cast } from './animation.js';
import { Player, pick, officeHasKeys } from './player.js';
import { OfficeCamera } from './camera.js';
import { Bubbles, createOverlays } from './bubbles.js';
import { createBoards } from './boards.js';

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
  scene.add(new THREE.HemisphereLight('#fff6e0', '#b8a68a', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(4, 8, 3); scene.add(sun);
  const room = createRoom(scene);
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const cast = new Cast(scene, { reducedMotion: () => !!reducedMotion?.matches });
  let layout;

  const frames = new Set();
  const player = new Player(renderer.domElement, {
    colliders: () => room.colliders,
    room: () => layout?.room,
    onPick: event => {
      const hit = pick(event, renderer.domElement, camera, scene);
      if (hit?.kind === 'floor') player.walkTo(hit.point);
      else if (hit?.kind === 'character') office.talkTo(hit.id);
    },
  });
  const view = new OfficeCamera(camera, scene, player, room, { reducedMotion: () => !!reducedMotion?.matches });
  const boards = createBoards(room);
  const bubbles = new Bubbles(container, id => office.talkTo(id));
  const overview = on => { view.setOverview(on); if (on) overlays.overviewUsed(); };
  const overlays = createOverlays(container, { onNext: () => office.talkTo(hooks.nextWaiting()?.id), onList: () => hooks.showList(), onOverviewHold: overview });
  // Hold Tab for the overview.
  // Only from the scene itself: Tab on a button or link keeps moving focus as usual.
  const sceneFocused = () => [document.body, renderer.domElement, null].includes(document.activeElement);
  const tab = on => event => { if (event.key !== 'Tab' || (on && (!officeHasKeys(event) || !sceneFocused()))) return; event.preventDefault(); overview(on); };
  const tabDown = tab(true), tabUp = tab(false);
  const talkKey = event => { if (event.code === 'KeyE' && officeHasKeys(event)) { event.preventDefault(); office.talkTo(office.nearest()); } };
  document.addEventListener('keydown', talkKey);
  document.addEventListener('keydown', tabDown); document.addEventListener('keyup', tabUp);
  frames.add(dt => { player.update(dt); view.update(dt); cast.update(dt, player.position); bubbles.update(camera, id => cast.positionOf(id), view.amount); boards.tick(); });
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
      layout = layoutOffice(snapshot.sessions, layout);
      cast.frozen = !!error;
      office.statuses = new Map(snapshot.sessions.map(session => [session.id, { ...officeStatus(session), identity: identity(session.id), monitor: monitorLines(session) }]));
      room.sync(layout, office.statuses);
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
    // Walk up, they turn to you, the view settles on their face, then their session opens beside the scene.
    talkTo(id) {
      const parent = office.snapshot?.sessions.find(session => session.id === id)?.parentId;
      const head = id && (cast.positionOf(id) || cast.positionOf(parent)); if (!head) return;
      const token = office.talking = {};
      player.walkTo(head.clone().setY(0), () => {
        if (office.talking !== token) return;
        cast.greet(id); view.focus(head.clone().setY(head.y - 0.25));
        setTimeout(() => { if (office.talking === token) hooks.openPanel(id); }, reducedMotion?.matches ? 0 : 550);
      }, 1.1, true);
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
    disposers: [() => boards.dispose(), () => bubbles.dispose(), () => overlays.dispose(), () => cast.dispose(), () => player.dispose(), () => view.dispose(), () => { document.removeEventListener('keydown', tabDown); document.removeEventListener('keyup', tabUp); document.removeEventListener('keydown', talkKey); }],
  };
  if (import.meta.env?.DEV) globalThis.__office = office; // poke at it from devtools
  return office;
}
