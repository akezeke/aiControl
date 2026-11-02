import * as THREE from 'three';
import './bridge.css';
import { Player, menuOpen, officeHasKeys, sceneFocused } from '../office/player.js';
import { walkGrid, findPath } from '../office/path.js';
import { VACANT_MS } from '../office/layout.js';
import { createScreenshots } from '../office/screenshots.js';
import { createBoard } from './board.js';
import { createBrackets } from './brackets.js';
import { BridgeCamera } from './camera.js';
import { CENTER, CHAIR_Z, ROOM, SEAT, deckColliders, stationAt } from './deck.js';
import { createCrew, crewArrival, crewLook } from './crew.js';
import { SHOT_SIZE, createDisplays, stationName } from './displays.js';
import { ROSTER, createHologram, listHeight } from './hologram.js';
import { createLights } from './lights.js';
import { PALETTES, SIGNALS, paletteFor, saveColour, savedColour, wearColours } from './palettes.js';
import { createPost } from './post.js';
import { createReticle } from './reticle.js';
import { buildRoom } from './room.js';
import { aimPoint, clickAction, keyAction, screenPose, tapUsesAim } from './seat.js';
import { assignStations, displayState, shipState, signalOf, stationSignals } from './ship.js';
import { createSpace } from './space.js';
import { frameTime } from '../scene-ui.js';

export function webglAvailable() {
  // three.js needs WebGL 2; the probe's context is released straight away.
  try { const gl = document.createElement('canvas').getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
}

// Where you start: in the captain's chair, facing the window. Everything here can be reached from it; walking about is optional.
const PROJECTORS = { colour: 'Colours', crew: 'Sessions' };
const WALK = /^Key[WASD]$/;
const shown = node => { for (let n = node; n; n = n.parent) if (!n.visible) return false; return true; };

export function mountBridge(container, hooks = {}, options = {}) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.autoClear = false; renderer.setClearColor(0, 1);
  const el = renderer.domElement; container.append(el);
  const world = new THREE.Scene(), camera = new THREE.PerspectiveCamera(68, 1, .2, 34); camera.rotation.order = 'YXZ';
  const room = buildRoom(world, still), lights = createLights(world, room.glow, still), space = createSpace(still), post = createPost(renderer);
  room.stations.forEach((station, i) => station.lamps.push({ material: space.arcs[i], gain: 2.4, vacant: new THREE.Color(0) }));
  let broken = false, seats = null, last = null, latest = null, picked = null, seated = true, zoomed = null, backKey = null;
  const fired = new Map(); // session id → when it was fired from the panel
  const view = { ...SEAT, ...options.view };
  const place = () => { camera.position.set(view.x, view.y, view.z); camera.rotation.set(view.pitch, view.yaw, 0); camera.updateMatrixWorld(); };

  // The arms' projectors: colours on the right, everyone on board on the left.
  const projected = (x) => ({ from: new THREE.Vector3(x * .5, 1.12, CHAIR_Z - .83), at: new THREE.Vector3(x * .72, 1.72, CHAIR_Z - 1.4), still });
  const phone = () => Math.min(container.clientWidth, container.clientHeight) <= 640;
  const holograms = { colour: createHologram(room.group, { ...projected(1), width: ROSTER.width, height: listHeight(Object.keys(PALETTES).length, ROSTER.width), phone }), crew: createHologram(room.group, { ...projected(-1), ...ROSTER, phone, at: new THREE.Vector3(-.72, 1.66, CHAIR_Z - 1.4) }) };
  let colour = savedColour(), crew = [];
  const showColours = () => holograms.colour.show('COLOURS', Object.entries(PALETTES).map(([id, palette]) => ({ id, label: palette.name, swatch: [palette.wall, palette.trim, palette.neon], on: id === colour })));
  const showCrew = () => holograms.crew.show(crew.length ? `${crew.length} SESSIONS` : 'NO SESSIONS', crew.map(session => ({ id: session.id, label: stationName(session), swatch: [SIGNALS[signalOf(session)]] })));
  const showHologram = { colour: showColours, crew: showCrew };
  const closeHolograms = () => { for (const hologram of Object.values(holograms)) hologram.hide(); };
  const chosen = { colour: ({ id }) => { colour = id; saveColour(id); repaint(paletteFor(id)); wearColours(paletteFor(id)); showColours(); }, crew: ({ id }) => bridge.talkTo(id) };
  const toggleHologram = button => { const wasOpen = holograms[button].open; closeHolograms(); if (!wasOpen) showHologram[button](); };
  // A click belongs to an open hologram first, then to a projector's button; anywhere else it just closes what's open.
  function clickHologram(at) {
    aim(at);
    for (const [name, hologram] of Object.entries(holograms)) {
      const hit = hologram.at(ray); if (hit) { if (hit.row) chosen[name](hit.row); return true; }
    }
    const button = room.hologramAt(ray), anyOpen = Object.values(holograms).some(hologram => hologram.open);
    if (button) toggleHologram(button); else closeHolograms();
    return !!button || anyOpen;
  }

  // Walking: the way round the deck is worked out once, as it never changes.
  const colliders = deckColliders(), grid = walkGrid(colliders, ROOM);
  const player = new Player(el, { colliders: () => colliders, room: () => ROOM, route: (from, to) => findPath(grid, from, to), onPick: (at, mouse) => {
    const aimed = mouse ? null : aimedAt();
    if (tapUsesAim({ mouse, zoomed: !!zoomed, panelOpen: Object.values(holograms).some(({ open }) => open), seated, aimed, tapped: under(at) })) return useTarget(aimed);
    if (!zoomed && !look.overview && clickHologram(at)) return;
    const hit = under(at); act(clickAction(hit, { seated, zoomed: !!zoomed, overview: look.overview, locked: player.locked, mouse }), hit);
  },
  // Esc while captured reaches us only as this. The window losing focus also calls it, and that shouldn't lose your place.
  onCancel: () => { if (!zoomed || !document.hasFocus()) return false; back(); return true; } });
  player.place(SEAT.x, SEAT.z, Math.PI); player.pitch = SEAT.pitch;
  const look = new BridgeCamera(camera, player, { reducedMotion: still });

  function act(action, hit) {
    if (action === 'back') back();
    else if (action === 'close') setOverview(false);
    else if (action === 'talk') bridge.talkTo(hit.id);
    else if (action === 'zoom') zoom(hit.mesh);
    else if (action === 'sit') sit();
    else if (action === 'capture') player.lock();
    else if (action === 'walk') player.walkTo(hit.point);
    else if (action === 'shots') { player.unlock(); hooks.showShots?.(hit.id, shots.images(hit.id), () => bridge.panelClosed()); }
  }
  // Close up on a screen: you stay where you are, and only the view flies over.
  function zoom(mesh) { closeHolograms(); zoomed = { mesh, yaw: player.yaw, pitch: player.pitch }; player.setOverview(true); look.closing = true; }
  function back() { if (!zoomed) return; zoomed = null; player.setOverview(false); look.closing = false; }
  function sit() { closeHolograms(); player.flyTo(new THREE.Vector3(SEAT.x, 0, SEAT.z), new THREE.Vector3(CENTER, 0, 0), () => { seated = true; }, still, SEAT.pitch); }
  const leaveChair = () => { seated = false; player.walkTo(new THREE.Vector3(CENTER, 0, SEAT.z - .95)); };

  const reticle = createReticle(camera, still), brackets = createBrackets(camera), board = createBoard(camera, room.stations, still); world.add(camera);
  const displays = createDisplays(room), shots = createScreenshots({ room: displays, ...SHOT_SIZE }), figures = room.stations.map(station => { const figure = createCrew(station, { still }); station.crew = figure; return figure; }), seatedAt = [], looks = new Map();
  let crewStarted = false, wasOffline = false;
  function repaint(palette) { room.repaint(palette); figures.forEach(figure => figure.paint(palette)); lights.repaint(palette); space.repaint(palette); displays.repaint(palette); container.style.setProperty('--bridge-accent', palette.trim); for (const painted of [...Object.values(holograms), reticle]) painted.paint(palette.tones[2], palette.tones[0]); }
  repaint(paletteFor(savedColour()));
  const setMode = state => { room.setMode(state); lights.setMode(state); space.setMode(state); };
  setMode({ mode: 'orbit', warp: 0, offline: false });
  // The canvases are drawn before the bundled font has loaded, and text drawn in a fallback stays that way.
  document.fonts?.load?.("700 40px Antonio").then(() => { if (!broken) repaint(paletteFor(savedColour())); }).catch(() => {});

  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, w < 700 ? 1.25 : 1.5)); renderer.setSize(w, h, false);
    const drawn = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.resize(drawn.x, drawn.y); space.resize(drawn.x, drawn.y);
    camera.aspect = w / h; camera.fov = h > w ? 90 : 68; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const aim = event => {
    const box = el.getBoundingClientRect(); ndc.set((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  // What's under a screen point: a screenshot on a display, a screen, the session at a station, the chair, the floor, or nothing. In the overview only
  // its screens are there. Hidden things (an empty station's chair) and glass and glow are looked past. Office's `pick` stops at anything inside something hidden.
  function under(event) {
    aim(event);
    if (look.overview) { const card = board.at(ray); return card && { kind: 'character', id: card.id, object: card.object }; }
    for (const { object, point, uv } of ray.intersectObject(room.group, true)) {
      if (!shown(object)) continue;
      if (object.userData.station != null && object.userData.screen && displays.shotAt(object.userData.station, uv.x, uv.y)) return { kind: 'shot', id: seats[object.userData.station].id, corners: displays.shotCorners(object.userData.station) };
      if (object.userData.screen) return { kind: 'screen', mesh: object, label: object.userData.screen, object };
      if (object.material.transparent || !object.material.visible) continue;
      for (let node = object; node; node = node.parent) {
        if (node.userData.sessionId) return { kind: 'character', id: node.userData.sessionId, object: node.userData.bracket || node };
        if (node.userData.chair) return { kind: 'chair', object: node };
      }
      return object.userData.floor ? { kind: 'floor', point } : null;
    }
    return null;
  }
  // What a point on the view can use, named as it's shown: a hologram's row, a projector's button, or what `under` finds. Null if nothing,
  // so what's named and what E acts on can't differ.
  function targetAt(at) {
    aim(at);
    if (!zoomed) for (const [hologram, panel] of Object.entries(holograms)) {
      const hit = panel.at(ray); if (hit) return hit.row ? { kind: 'row', hologram, row: hit.row, name: hit.row.label, object: panel.rowCorners(hit.row) } : null;
    }
    const button = zoomed || look.overview ? null : room.hologramAt(ray);
    if (button) return { kind: 'button', button, name: PROJECTORS[button], object: room.hologramButton(button) };
    // Close up, only a screenshot can be used, and only by pointing at it: the sight is the screen's middle, and E there comes back.
    const found = zoomed && player.aiming ? null : under(at), hit = zoomed && found?.kind !== 'shot' ? null : found, session = hit?.kind === 'character' && last?.sessions?.find(({ id }) => id === hit.id);
    const name = session ? hooks.describe?.(session)?.title || stationName(session) : look.overview ? null : hit?.kind === 'shot' ? `${shots.count(hit.id)} screenshot${shots.count(hit.id) === 1 ? '' : 's'}` : hit?.kind === 'screen' ? hit.label : hit?.kind === 'chair' && !seated ? 'Sit' : null;
    return name ? { kind: 'hit', hit, name, object: hit.corners || hit.object } : null;
  }
  // Under the pointer or the sight, a few times a second. A touch makes this a touch screen until a mouse moves.
  let hoverIn = 0, mouseAt = null, touch = matchMedia('(pointer: coarse)').matches;
  const onMove = event => { if (event.pointerType === 'mouse') { touch = false; mouseAt = event.buttons ? null : { clientX: event.clientX, clientY: event.clientY }; } };
  const onLeave = () => { mouseAt = null; };
  const onDown = event => { if (event.pointerType !== 'mouse') { touch = true; mouseAt = null; } };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave); el.addEventListener('pointerdown', onDown);
  const aimedAt = () => { const at = aimPoint({ aiming: player.aiming, touch, overview: look.overview }, player.centre, mouseAt); return at && targetAt(at); };
  function hover(dt) {
    hoverIn -= dt; if (hoverIn > 0) return; hoverIn = .1;
    // By touch there's no E to offer, and a row already shows its name, where the tag would only cover the next one.
    const target = aimedAt(), name = target && (!touch ? `E ${target.name}` : target.kind === 'row' ? null : target.name);
    for (const [hologram, panel] of Object.entries(holograms)) panel.hover(target?.hologram === hologram ? target.row : null);
    reticle.aim(name); brackets.aim(target?.object ?? null); el.title = player.aiming ? '' : name || ''; el.style.cursor = name && !player.aiming ? 'pointer' : '';
  }
  // E does what a click does on what's named, and nothing anywhere else: an open hologram stays open.
  function pressE() {
    const target = aimedAt();
    if (zoomed && !target) return back();
    useTarget(target);
  }
  function useTarget(target) {
    if (target?.kind === 'row') chosen[target.hologram](target.row);
    else if (target?.kind === 'button') toggleHologram(target.button);
    else if (target) act(keyAction(target.hit, { seated, zoomed: false, overview: look.overview, locked: player.locked }), target.hit);
  }

  const bar = document.createElement('div'); bar.className = 'bridge-overlay'; container.append(bar);
  const button = (text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; bar.append(b); return b; };
  const next = button('', 'Next waiting (n)', () => bridge.talkTo(hooks.nextWaiting?.()?.id)); next.className = 'bridge-next'; next.hidden = true;
  button('☰', 'Show the list', () => hooks.showList?.());
  const eye = button('👁', 'Overview (Tab)', () => setOverview(!look.overview)); eye.setAttribute('aria-pressed', 'false');
  // One button for getting out of whatever you're in: the close-up, then the chair; out of the chair it takes you back.
  const leave = button('', '', () => { if (zoomed) back(); else if (seated) leaveChair(); else sit(); leave.blur(); });
  const LEAVE = { back: ['✕ Back', 'Back (Esc)'], seated: ['⏏ Leave', 'Leave the chair (WASD)'], standing: ['Sit', 'Back to the chair'] };
  let leaveShows = null;
  function showLeave() {
    const state = zoomed ? 'back' : seated ? 'seated' : 'standing'; leave.hidden = look.overview;
    if (state === leaveShows) return; leaveShows = state;
    leave.textContent = LEAVE[state][0]; leave.title = LEAVE[state][1]; leave.setAttribute('aria-label', LEAVE[state][1]);
  }
  function setOverview(on) { if (on) { closeHolograms(); back(); player.unlock(); } look.setOverview(on); board.show(on); eye.setAttribute('aria-pressed', String(on)); }
  // The mouse is yours to take back when nothing else needs it (office.js does the same).
  const free = () => !document.body.classList.contains('panel-open') && !menuOpen() && !look.overview && document.hasFocus();
  let wasFree = true;
  const onKey = event => {
    if (!officeHasKeys(event)) return;
    if (event.code === 'KeyE') { if (!event.repeat) pressE(); return; }
    if (!player.locked && player.wanted && /^(Key[WASD]|Arrow\w+|Space)$/.test(event.code) && free()) player.lock();
    if (zoomed && WALK.test(event.code)) { back(); backKey = event.code; } // this press only comes back; held on, it doesn't also walk you off
    else if (event.key === 'Tab' && sceneFocused(el)) { event.preventDefault(); if (!event.repeat) setOverview(!look.overview); }
    else if (event.key === 'Escape' && zoomed) back();
    else if (event.key === 'Escape' && Object.values(holograms).some(hologram => hologram.open)) closeHolograms();
    else if (event.key === 'Escape' && look.overview) setOverview(false);
  };
  const onKeyUp = event => { if (event.code === backKey) backKey = null; };
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);

  // Stations the sidebar's filter takes in stand out, and the others step back.
  const mark = () => {
    const taken = picked && new Set((last?.sessions || []).filter(picked).map(session => session.parentId || session.id));
    room.stations.forEach((station, i) => { const marked = !taken ? null : taken.has(seats?.[i]?.id); room.setMarked(i, marked); figures[i].setMarked(marked); });
    // The overview shows who's left in: everyone, or those the filter takes in.
    board.fill(room.stations.flatMap(({ group, status }, index) => { const id = group.userData.sessionId; return id && (!taken || taken.has(id)) ? [{ index, id, status }] : []; }));
  };

  let raf = 0, lastFrame = performance.now(), T = 0;
  const stop = () => { broken = true; cancelAnimationFrame(raf); };
  const onLost = event => { event.preventDefault(); stop(); };
  el.addEventListener('webglcontextlost', onLost);
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { lastFrame = now; return; }
    const dt = frameTime(now, lastFrame, .05); lastFrame = now; if (!still) T += dt;
    try {
      if (player.locked && document.body.classList.contains('panel-open')) player.unlock();
      const nowFree = free(); if (nowFree && !wasFree) player.resume(); wasFree = nowFree;
      player.held.delete(backKey);
      if (seated && !player.flight && [...player.held].some(code => WALK.test(code))) seated = false;
      if (zoomed) {
        // The captured mouse still turns you, and you should come back facing as you were. A screen that moves or goes is followed.
        player.yaw = zoomed.yaw; player.pitch = zoomed.pitch;
        if (shown(zoomed.mesh)) look.focus = screenPose(zoomed.mesh, camera.fov, camera.aspect); else back();
      }
      if (!look.overview && !zoomed) player.update(dt);
      look.update(dt);
      if (options.view) place();
      showLeave(); hover(dt);
      reticle.show((player.aiming || touch) && !zoomed && !look.overview); reticle.tick(dt, container.clientHeight || 1); board.tick(dt, container.clientWidth || 1, container.clientHeight || 1); brackets.tick(container.clientHeight || 1);
      for (const hologram of Object.values(holograms)) hologram.tick(dt, T, camera);
      space.tick(dt); lights.tick(dt, T, space); room.tick(dt, T, camera); figures.forEach(figure => figure.tick(dt, T));
      post.render(world, space.scene, camera);
    } catch (error) { console.error(error); stop(); }
  }
  raf = requestAnimationFrame(frame);

  const bridge = {
    // syncScene turns this throw into the fallback to the list.
    update(snapshot, { error } = {}) {
      if (broken) throw new Error('The bridge lost its graphics context');
      const now = Date.now();
      for (const [id, at] of fired) if (now - at > VACANT_MS + 10_000) fired.delete(id);
      // A session just fired leaves its station straight away, before the server has caught up.
      const sessions = (snapshot.sessions || []).filter(session => !fired.has(session.id)), live = { ...snapshot, sessions };
      const state = displayState(shipState(live, now), error), { stations, overflow } = assignStations(sessions, seats, now);
      seats = stations; last = live; latest = { snapshot, error };
      setMode(state);
      // Looks are kept while a session lasts, so an agent is the same crew member after a lost connection.
      for (const id of looks.keys()) if (!state.offline && !sessions.some(session => session.id === id)) looks.delete(id);
      stationSignals(stations, sessions, state.offline).forEach((signal, i) => {
        room.setStation(i, signal);
        const seat = stations[i], station = room.stations[i], figure = figures[i], live = seat && seat.goneAt == null ? seat.id : null;
        station.group.userData.sessionId = live; station.group.userData.bracket = live ? figure.body : null;
        const session = live && sessions.find(({ id }) => id === live); station.mesh.userData.screen = session ? stationName(session) : undefined;
        // While offline nobody's known to have left: the figure's hidden, and its seat kept.
        const id = state.offline ? seatedAt[i] ?? null : live && signal ? live : null;
        const how = crewArrival({ was: seatedAt[i] ?? null, id, offline: state.offline, wasOffline, started: crewStarted, still });
        if (id && !looks.has(id)) looks.set(id, crewLook(id, new Set(seatedAt.flatMap((other, n) => n !== i && other && looks.has(other) ? [looks.get(other).key] : []))));
        if (id) { figure.setLook(looks.get(id)); figure.setSignal(signal); }
        figure.present(!!id && !state.offline, how === 'none' ? 'cut' : how);
        seatedAt[i] = id;
      });
      crewStarted = true; wasOffline = state.offline;
      shots.sync(sessions.filter(({ id }) => stations.some(seat => seat?.id === id && seat.goneAt == null)));
      displays.update({ state, stations, overflow, sessions, usage: snapshot.usage, machine: snapshot.machine, unread: hooks.isUnread, now });
      next.hidden = !state.waiting; next.textContent = `⚠ ${state.waiting}`;
      crew = state.roster; if (holograms.crew.open) showCrew();
      mark();
    },
    unmount() {
      stop(); shots.dispose(); observer.disconnect(); el.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); el.removeEventListener('pointerdown', onDown);
      player.dispose(); bar.remove();
      for (const scene of [world, space.scene]) scene.traverse(object => {
        object.geometry?.dispose();
        for (const material of [object.material].flat()) { if (!material) continue; for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); }
      });
      post.dispose(); renderer.dispose(); el.remove();
    },
    // main.js: a filter or project was picked in the sidebar (null: all sessions); from a click, bring up their screens.
    pick(test, open) { picked = test; mark(); if (open) setOverview(true); },
    // main.js calls this when the session panel closes.
    panelClosed() { look.turnTo(null); },
    // Turn to their station, then their session opens beside the scene. Without a station (a crowded bridge), just the panel.
    talkTo(id) {
      if (!id) return;
      const parent = last?.sessions?.find(session => session.id === id)?.parentId;
      const index = seats?.findIndex(seat => seat && seat.goneAt == null && (seat.id === id || seat.id === parent)) ?? -1;
      closeHolograms(); back();
      if (index >= 0) { const { x, z } = stationAt(index); setOverview(false); player.target = null; look.turnTo(x, z); }
      hooks.openPanel?.(id);
    },
    // Their session was just ended from the panel.
    fire(id) { fired.set(id, Date.now()); if (latest) bridge.update(latest.snapshot, { error: latest.error }); },
  };
  return bridge;
}
