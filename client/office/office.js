// The Office theme: a 3D office where each session is a fruit at a desk. main.js mounts it in place of the list.
import * as THREE from 'three';
import './office.css';
import { layoutOffice, VACANT_MS } from './layout.js';
import { officeStatus, identity, monitorLines } from './status.js';
import { createRoom } from './room.js';
import { Cast } from './animation.js';
import { Player, pick, rayAt, officeHasKeys, menuOpen, sceneFocused, standNear, standBefore, EYE } from './player.js';
import { OfficeCamera } from './camera.js';
import { Bubbles, createCard, createMenu, createOverlays } from './bubbles.js';
import { createBoards } from './boards.js';
import { highlight } from './toon.js';
import { shared } from './furniture.js';
import { PITCH } from './overview.js';
import { createProps, REACH } from './props.js';
import { createScreenshots } from './screenshots.js';
import { createDarts } from './darts.js';
import { createGolf } from './golf.js';
import { createGoose, GOOSE } from './goose.js';
import { walkGrid, gridKey, findPath } from './path.js';
import { hireChoices } from '../hire.js';

const FIRED = { pose: 'slumped', expression: 'sad', bubble: { icon: '📦', text: 'Fired', highlight: false } };

export function webglAvailable() {
  // three.js needs WebGL 2; the probe's context is released straight away.
  try { const gl = document.createElement('canvas').getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
}

export function mountOffice(container, hooks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6e7c8');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.userData.canvas = renderer.domElement;
  const room = createRoom(scene, renderer);
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  // Ways round the furniture (path.js) for whoever walks: fruit coming and going, and the goose. The grid is worked out again
  // only when the boxes really change (room.sync hands over a new list of them with every snapshot).
  let grid = null;
  const walkable = () => { const key = gridKey(room.colliders, layout.room); return grid?.key === key ? grid : grid = walkGrid(room.colliders, layout.room); };
  const route = (from, to) => layout ? findPath(walkable(), from, to) : null;
  const cast = new Cast(scene, { reducedMotion: () => !!reducedMotion?.matches, route });
  let layout;
  const fired = new Map(); // session id → when it was fired from the panel
  // Seats outlive a reload: the first layout starts from the last one's desks and pods' cells (anyone gone since is dropped at
  // once, not left to walk out; layout.js closes up what they leave empty), or pods would line up by name and everyone sit in
  // whatever order the snapshot lists them. A desk still walking out is kept, in case they're back (a server restart lists
  // nobody for a moment).
  const seatsKey = 'ai-control-office-seats';
  let seats = '';
  const savedSeats = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(seatsKey) || '{}'), { desks = [], pods = [] } = Array.isArray(saved) ? { desks: saved } : saved; // an array: desks only, as saved before
      return { saved: true, desks: new Map(desks.map(([id, podKey, slot]) => [id, { podKey, slot, vacantSince: -Infinity }])), pods: pods.map(([key, col, row]) => ({ key, col, row })), room: { width: 0, depth: 0 } };
    } catch { return undefined; }
  };
  const saveSeats = () => {
    const now = JSON.stringify({ desks: [...layout.desks.values()].map(desk => [desk.sessionId, desk.podKey, desk.slot]), pods: layout.pods.map(pod => [pod.key, pod.col, pod.row]) });
    if (now !== seats) { seats = now; try { localStorage.setItem(seatsKey, now); } catch { /* per tab only */ } }
  };

  const frames = new Set(), listeners = [];
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
  // What a click at a screen point gets: a speech bubble there counts as its character.
  const under = at => { const id = bubbles.at(at.clientX, at.clientY); return id ? { kind: 'character', id } : pick(at, renderer.domElement, camera, scene); };
  const player = new Player(renderer.domElement, {
    colliders: () => room.colliders,
    room: () => layout && room.secret.bounds(layout.room), // the secret room's beside the office
    // In first person, a mouse click that isn't on someone (or a board, a pod's sign or a ball) captures the mouse; captured, a
    // click on the floor walks there. With a ball in hand a click throws it that way; playing a game, the game has the click.
    // A press that closes the sign's menu does nothing else.
    onPick: (at, mouse) => {
      if (dismissed) return;
      if (playing) { playing.click(rayAt(at, renderer.domElement, camera)); return; }
      if (props.holding && !view.overview) { props.throw(rayAt(at, renderer.domElement, camera)); return; }
      const hit = under(at);
      if (hit?.kind === 'character') office.talkTo(hit.id);
      else if (hit?.kind === 'monitor') office.readScreen(hit.id, hit.node, hit.point);
      else if (hit?.kind === 'board') office.readBoard(hit.node);
      else if (hit?.kind === 'hire') office.offerHire(hit, at);
      else if (hit?.kind === 'toggle') hit.node.userData.toggle();
      else if (hit?.kind === 'prop' && !view.overview) pickUp(hit.body);
      else if (mouse && !player.locked && !view.overview) player.lock();
      else if (hit?.kind === 'floor' && !view.overview) player.walkTo(hit.point);
    },
  });
  const view = new OfficeCamera(camera, scene, player, room, { reducedMotion: () => !!reducedMotion?.matches, container });
  // Whoever gets hit, or whose things do, jumps, glares and says so; the goose comes for you.
  const onHit = (id, line) => { if (id === GOOSE) { goose.hit(); return; } cast.startle(id); bubbles.say(id, '💢', line); };
  const props = createProps(scene, { room, cast, camera, player, view, bounds: () => layout?.room, reducedMotion: () => !!reducedMotion?.matches, onHit, others: () => [goose.column] });
  // A thing out of reach: walk over (as near as the furniture lets you) and pick it up.
  const pickUp = body => { if (body.pos.distanceTo(player.position) <= REACH) props.grab(body); else player.walkTo(body.pos.clone().setY(0), () => props.grab(body), 0.7, true); };
  // The coffee machine: fills the mug if you're by it, else you walk over first.
  room.onCoffee = () => { if (!props.fill()) player.walkTo(props.machineSpot, () => props.fill(), 0.3, true); };
  // The secret shelf's right book: pressed from where you stand if you can reach it, else you walk over first.
  room.onSecret = () => { const spot = room.secret.spot; if (player.position.clone().setY(0).distanceTo(spot) < 1.6) room.secret.toggle(); else player.walkTo(spot, () => room.secret.toggle(), 0.3, true); };
  // Darts and the putting green in the secret room. Clicking either (from near enough, else you walk over first) puts you in
  // its game: it has the view and the clicks, aimed where the mouse is, until Esc, ✕, a walking key or the overview; then you
  // stand where it says, facing it.
  const aim = () => rayAt(dot ? player.centre : mouse || player.centre, renderer.domElement, camera);
  let playing = null;
  const play = game => {
    if (game === playing) return;
    if (playing) { playing.leave(); const { x, z, yaw } = playing.stand(); player.place(x, z, yaw); player.pitch = -0.15; }
    playing = game; player.unlock(); player.setOverview(!!game); view.play(game && (() => game.pose())); overlays.setPlaying(!!game); menu.close(); card.show(null);
    if (game) game.enter();
  };
  const onPlay = game => {
    if (view.overview) return;
    const { x, z, yaw } = game.stand(), spot = new THREE.Vector3(x, 0, z);
    if (player.position.clone().setY(0).distanceTo(spot) < 1.4) { player.place(player.position.x, player.position.z, yaw); play(game); }
    else player.walkTo(spot, () => { player.place(player.position.x, player.position.z, yaw); play(game); }, 0.3, true);
  };
  const darts = createDarts({ hands: view.hands, camera, aim, onPlay }), golf = createGolf({ camera, aim, onPlay });
  room.secret.add(darts); room.secret.add(golf);
  const boards = createBoards(room);
  const bubbles = new Bubbles(container, id => office.talkTo(id));
  // It lets you be in the overview and on your way to someone.
  const goose = createGoose(scene, { props, player, walkable, bounds: () => layout?.room, busy: () => view.overview || !!player.flight || !!office.talking,
    reducedMotion: () => !!reducedMotion?.matches, say: (icon, text) => bubbles.say(GOOSE, icon, text) });
  const card = createCard(container);
  const menu = createMenu(container, (cwd, choice, item) => hooks.spawn?.(cwd, choice, item));
  const shots = createScreenshots(container, { room, onClose: () => office.panelClosed(), onSession: id => hooks.openPanel(id) });
  // It stays by the spot on the desk you picked as the view moves, and closes once that's off the screen.
  let dismissed = false; const menuAt = new THREE.Vector3(), onScreen = new THREE.Vector3();
  const follow = () => {
    if (!menu.open || menu.asking) return;
    onScreen.copy(menuAt).project(camera);
    if (onScreen.z > 1 || Math.abs(onScreen.x) > 1 || Math.abs(onScreen.y) > 1) { menu.close(); return; }
    const r = renderer.domElement.getBoundingClientRect();
    menu.move({ clientX: r.left + (onScreen.x + 1) / 2 * r.width, clientY: r.top + (1 - onScreen.y) / 2 * r.height });
  };
  // The screenshots close the same way.
  listen(document, 'pointerdown', event => {
    const outside = [menu, shots].filter(open => open.open && !open.contains(event.target));
    dismissed = outside.length > 0; for (const open of outside) open.close();
  }, true);
  // The overview frees the mouse to click around; leaving it captures the mouse again if it was (see `free`).
  const overview = on => {
    if (on === view.overview) return;
    menu.close();
    if (on) { play(null); player.unlock(); overlays.overviewUsed(); }
    view.setOverview(on); player.setOverview(on); overlays.setOverview(on);
  };
  // Nothing else wants the mouse: no panel, menu or dialog up, not on the way to someone, not in the overview or a game, the window focused.
  const free = () => !document.body.classList.contains('panel-open') && !menuOpen() && !menu.open && !view.overview && !office.talking && !playing && document.hasFocus();
  let wasFree = true;
  const overlays = createOverlays(container, { onNext: () => office.talkTo(hooks.nextWaiting()?.id), onList: () => hooks.showList(), onOverview: () => overview(!view.overview), onLeave: () => play(null),
    onNew: anchor => {
      const r = anchor.getBoundingClientRect();
      const known = [...new Set((office.snapshot?.sessions || []).map(s => s.cwd).filter(Boolean))].sort();
      player.unlock(); menu.show(null, { clientX: r.right, clientY: r.bottom }, true, hireChoices(office.snapshot, ''), known);
    } });
  // Tab toggles the overview and Esc closes the menu or leaves the overview (Tab only from the scene itself: on a button or
  // link it keeps moving focus). E throws what you hold or picks up the outlined thing, else talks to whoever is outlined (or
  // looks at their screen, goes to the board, flips a toggle, or opens a pod sign's menu), else to whoever is in front of you.
  // F, held, pours. Moving takes the mouse back if the browser wouldn't hand it back by itself (see `free`). Playing a game,
  // E plays (where the mouse is), and Esc or a walking key steps back.
  listen(document, 'keydown', event => {
    if (!officeHasKeys(event)) return;
    if (playing && event.key !== 'Tab') {
      if (event.key === 'Escape' || /^(Key[WASD]|Arrow\w+|Space)$/.test(event.code)) { event.preventDefault(); play(null); }
      else if (event.code === 'KeyE') { event.preventDefault(); playing.click(aim()); }
      return;
    }
    if (!player.locked && player.wanted && /^(Key[WASD]|Arrow\w+|Space)$/.test(event.code) && free()) player.lock();
    if (event.key === 'Tab' && sceneFocused(renderer.domElement)) { event.preventDefault(); if (!event.repeat) overview(!view.overview); }
    else if (event.key === 'Escape' && menu.open) menu.close();
    else if (event.key === 'Escape' && view.overview) overview(false);
    else if (event.code === 'KeyE' && !menu.contains(event.target)) {
      event.preventDefault();
      if (props.holding) props.throw(); else if (prop) pickUp(prop); else if (monitor) office.readScreen(monitor.id, monitor.node, monitor.point); else if (board) office.readBoard(board); else if (toggle) toggle.userData.toggle(); else if (hire) office.offerHire(hire, dot ? player.centre : mouse, true); else office.talkTo(aimed || office.nearest());
    }
    else if (event.code === 'KeyF' && !view.overview && !office.talking) { event.preventDefault(); if (!event.repeat) props.pour(true); }
  });
  listen(document, 'keyup', event => { if (event.code === 'KeyF') props.pour(false); });
  listen(window, 'blur', () => props.pour(false));
  // Outline whatever a click (or E) would get, with its card: under the dot when aiming with it, else under the mouse
  // (the scene or a bubble, not the buttons). Ten times a second is plenty.
  let mouse = null, hovered = null, aimed = null, monitor = null, board = null, hire = null, toggle = null, prop = null, dot = false, hoverIn = 0;
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
    if (menu.open) return; // the sign keeps its outline while its menu is up
    // Playing, nothing else is outlined: the pointer aims.
    if (playing) { highlight(hovered, false); hovered = aimed = monitor = board = hire = toggle = prop = null; props.aim(null); card.show(null); overlays.setAim(false); renderer.domElement.style.cursor = 'crosshair'; return; }
    const at = office.talking ? null : aiming ? player.centre : mouse, hit = at && under(at);
    aimed = hit?.kind === 'character' ? hit.id : null; monitor = hit?.kind === 'monitor' ? hit : null; board = hit?.kind === 'board' ? hit.node : null; hire = hit?.kind === 'hire' ? hit : null; toggle = hit?.kind === 'toggle' ? hit.node : null;
    prop = hit?.kind === 'prop' && !props.holding ? hit.body : null; props.aim(prop);
    const whose = aimed || monitor?.id, session = whose && office.snapshot?.sessions.find(session => session.id === whose), facts = session && hooks.describe?.(session);
    const count = monitor && room.glass(monitor.node, monitor.point).side && shots.count(monitor.id); // the second monitor: the screenshots
    card.show(facts && count ? { ...facts, detail: `${count} screenshot${count === 1 ? '' : 's'}` } : facts || hire && { title: 'Hire', project: hire.cwd.replace(/^\/home\/[^/]+/, '~') } || null); card.move(aiming ? player.centre : mouse);
    const node = aimed && cast.characters.get(aimed)?.root || monitor?.node || board || hire?.node || (toggle?.userData.quiet ? null : toggle); // a quiet one gives nothing away
    renderer.domElement.style.cursor = (node || prop) && !aiming ? 'pointer' : view.overview ? view.overhead.dragging ? 'grabbing' : 'grab' : '';
    overlays.setAim(!!(node || prop));
    if (node === hovered) return;
    highlight(hovered, false); highlight(node, true); hovered = node;
  };
  // The pods' name signs hang edge-on to the overview: it tips them up to face it, and a bit bigger (room.js shares their
  // geometry as shared.sign; office.update finds them).
  let signs = [];
  const tiltSigns = () => { for (const sign of signs) { sign.rotation.x = -PITCH * view.amount; sign.scale.setScalar(1 + 0.4 * view.amount); } };
  frames.add(dt => {
    if (player.locked && document.body.classList.contains('panel-open')) player.unlock();
    // Whatever took the mouse is done with it.
    const now = free(); if (now && !wasFree) player.resume(); wasFree = now;
    // The overview has the keys and drags while it's up: you stay where you were.
    if (!view.overview && !playing) player.update(dt);
    // What you hold drops at the secret room's door (things in hand only know the office).
    if (props.holding && room.secret.inside(player.position)) props.throw(null, true);
    // In the secret room the office's bubbles don't show through its walls.
    const away = room.secret.inside(player.position);
    view.update(dt); room.update(dt, camera.position, !!reducedMotion?.matches); room.secret.update(dt, player.position, !!reducedMotion?.matches, view.amount); cast.update(dt, player.position); goose.update(dt); props.update(dt); bubbles.update(camera, id => away ? null : id === GOOSE ? goose.top() : cast.positionOf(id), view.amount); boards.tick(); follow(); hover(dt);
    tiltSigns();
  });
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  // ponytail: a fixed 30 fps budget (60–144 Hz is wasted on a dashboard left open all day); throttle further when idle if it still costs too much.
  const frameMs = 1000 / 30, phone = globalThis.matchMedia?.('(max-width: 640px)');
  let raf = 0, last = performance.now();
  const loop = now => {
    raf = requestAnimationFrame(loop);
    // On a phone the open panel covers the whole office.
    if (now - last < frameMs - 1 || (phone?.matches && document.body.classList.contains('panel-open'))) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const fn of frames) fn(dt, now);
    renderer.render(scene, office.camera);
  };
  // Nothing renders while the tab is hidden; polling stops then too.
  const visibility = () => { cancelAnimationFrame(raf); raf = 0; if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', visibility); visibility();

  const office = {
    scene, renderer, camera, hooks, container, props,
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    update(snapshot, { error = '' } = {}) {
      office.snapshot = snapshot; office.error = error;
      layout = layoutOffice(snapshot.sessions, layout || savedSeats()); view.setLayout(layout); saveSeats();
      cast.frozen = !!error;
      office.statuses = new Map(snapshot.sessions.map(session => [session.id, { ...officeStatus(session), identity: identity(session.id), monitor: monitorLines(session) }]));
      // The fired slump at their desks, then trudge out carrying a box.
      for (const [id, at] of fired) if (Date.now() - at > VACANT_MS + 10_000) fired.delete(id); else office.statuses.set(id, { ...office.statuses.get(id), ...FIRED });
      room.sync(layout, office.statuses);
      shots.sync(snapshot.sessions.filter(session => !session.parentId && layout.desks.has(session.id)));
      for (const face of Object.values(room.boards)) face.parent.userData.board = true; // clicking one takes you to it
      signs = []; scene.traverse(node => { if (node.geometry && node.geometry === shared.sign) signs.push(node); });
      cast.sync(layout, snapshot.sessions, room, office.statuses);
      bubbles.sync([...snapshot.sessions.filter(session => layout.desks.has(session.id) || session.parentId).map(session => ({ id: session.id, bubble: office.statuses.get(session.id).bubble, unread: hooks.isUnread?.(session) })),
        ...[...fired.keys()].filter(id => layout.desks.get(id)?.vacantSince !== undefined).map(id => ({ id, bubble: FIRED.bubble }))]);
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
    // Their session was just ended from the panel.
    fire(id) { fired.set(id, Date.now()); if (office.snapshot) office.update(office.snapshot, { error: office.error }); },
    // Fly over, they turn to you, the view settles on their face, then their session opens beside the scene.
    talkTo(id) {
      play(null);
      const parent = office.snapshot?.sessions.find(session => session.id === id)?.parentId;
      const head = id && (cast.positionOf(id) || cast.positionOf(parent)); if (!head) return;
      const token = office.talking = {};
      overview(false); player.unlock(); menu.close();
      const arrive = () => {
        if (office.talking !== token) return;
        cast.greet(id); view.focus(head.clone().setY(head.y - 0.25));
        setTimeout(() => { if (office.talking === token) hooks.openPanel(id); }, reducedMotion?.matches ? 0 : 400);
      };
      const spot = standNear(head, player.position, room.colliders, layout?.room);
      if (spot) player.flyTo(spot, head, arrive, !!reducedMotion?.matches); else player.walkTo(head.clone().setY(0), arrive, 1.1, true);
    },
    // Look over their shoulder at their screen, then their session opens beside the scene; unlike a talk, they keep working.
    // The second monitor (`point` on it) opens the screenshots instead.
    readScreen(id, node, point) {
      play(null);
      const token = office.talking = {};
      overview(false); player.unlock(); menu.close();
      const { anchor: glass, side } = room.glass(node, point), scale = glass.getWorldScale(new THREE.Vector3()).x; // helpers' desks are small
      const centre = glass.getWorldPosition(new THREE.Vector3()), normal = new THREE.Vector3(0, 0, 1).transformDirection(glass.matrixWorld).setY(0).normalize();
      const shoulder = centre.clone().addScaledVector(new THREE.Vector3(-normal.z, 0, normal.x), 0.45 * scale), rise = centre.y - EYE;
      const arrive = () => {
        if (office.talking !== token) return;
        view.focus(centre);
        setTimeout(() => { if (office.talking === token) { if (side) shots.show(id); else hooks.openPanel(id); } }, reducedMotion?.matches ? 0 : 400);
      };
      const spot = standBefore(shoulder, normal, Math.max(0.8, 1.9 * scale), room.colliders, layout?.room);
      if (spot) player.flyTo(spot, centre, arrive, !!reducedMotion?.matches, Math.atan2(rise, Math.hypot(centre.x - spot.x, centre.z - spot.z))); else arrive();
    },
    // Fly over to a board on the wall and face it, back far enough to take it all in (and not crane up at the clock).
    readBoard(node) {
      play(null);
      office.talking = null; overview(false); menu.close();
      const box = new THREE.Box3().setFromObject(node), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld).setY(0).normalize(), tan = Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
      const fit = Math.max(size.y / 2 / tan, Math.max(size.x, size.z) / 2 / (tan * camera.aspect)) * 1.25, rise = centre.y - EYE;
      const spot = standBefore(centre, normal, THREE.MathUtils.clamp(Math.max(fit, Math.abs(rise) * 1.7), 1, 3.5), room.colliders, layout?.room);
      if (spot) player.flyTo(spot, centre, null, !!reducedMotion?.matches, Math.atan2(rise, Math.hypot(centre.x - spot.x, centre.z - spot.z)));
    },
    // A pod's sign: let go of the mouse and offer Claude (per account) or Codex, started in the pod's folder.
    offerHire({ cwd, node, point }, at, focus = false) {
      player.unlock(); card.show(null);
      highlight(hovered, false); highlight(node, true); hovered = node;
      menuAt.copy(point); menu.show(cwd, at, focus, hireChoices(office.snapshot, cwd));
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
    disposers: [() => boards.dispose(), () => bubbles.dispose(), () => card.dispose(), () => menu.dispose(), () => overlays.dispose(), () => cast.dispose(), () => player.dispose(), () => view.dispose(), () => props.dispose(), () => shots.dispose(), () => goose.dispose(), () => { for (const fn of listeners) fn(); }],
  };
  return office;
}
