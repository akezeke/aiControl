# Office Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Office" theme that replaces the session list with a first-person, toon-shaded 3D office where each session is a fruit character at a desk.

**Architecture:** A lazily imported module tree in `client/office/` mounted by `client/main.js` in place of `#groups` while the office theme is active. Pure logic (`layout.js`, `status.js`) is unit-tested with `node --test`; the three.js scene modules are verified by hand against `npm run demo`. The existing session panel is reused through `openPanel(id)`.

**Tech Stack:** three.js (npm, bundled by Vite), plain ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-office-theme-design.md`

## Global Constraints

- Never `git push`. Commit locally on `main` only (overrides `AGENTS.md`).
- No third-party scripts, fonts or CDNs at runtime: `three` is an npm dependency bundled by Vite, loaded with `import()` only when the office theme is active.
- Node 22.12+, Linux; tests run with `npm test` (`node --test --test-isolation=none tests/*.test.mjs`).
- Match the existing code style: dense ES modules, no framework, short comments only where intent isn't obvious.
- Respect `prefers-reduced-motion: reduce` (spec "Reduced motion").
- Designed for about 30 sessions; up to 3 subagents per desk, more as "+N".
- Session id → fruit, color, accessory and props must be deterministic (hash of `session.id`).
- Every geometry, material and texture created by the office is disposed on unmount.

## Review Focus

- A new session in a project must not move existing characters to other desks → `layout` keeps previous seat assignments (Task 2 test `keeps seats when a session joins`).
- A session whose project is missing or empty still gets a desk → pod key falls back to `'Unknown'` (Task 2 test `missing project goes to Unknown`).
- Subagents whose parent is not in the snapshot do not crash or float → they are dropped from the layout (Task 2 test `orphan subagents are dropped`).
- Very long or multi-line bubble text (permission commands, questions) stays one short line → `status` truncates to 48 chars with "…" (Task 3 test `bubble text is one line, max 48 chars`).
- Typing in the panel composer or search box must not move the player → key handler ignores events from inputs/textareas/contenteditable and while the panel is open (Task 8 manual check, plus `isTypingTarget` test in Task 3).

---

### Task 1: Office theme entry, lazy mount, empty scene

**Files:**
- Modify: `package.json` (add `"three"` to `dependencies`, exact current version from `npm view three version`)
- Modify: `client/themes.js` (add `{ id: 'office', name: 'Office', color: '#f6e7c8' }`; include `'office'` nowhere in `bootSequence`)
- Modify: `client/main.js` (mount/unmount + snapshot hand-off)
- Create: `client/office/office.js`, `client/office/office.css`

**Interfaces:**
- Produces: `mountOffice(container: HTMLElement, hooks: { openPanel(id), nextWaiting(): session|undefined }): Office`
- Produces: `Office.update(snapshot, { error: string })`, `Office.unmount()`, `Office.scene`, `Office.renderer`, `Office.onFrame(fn(dt, now))` (register per-frame callbacks; used by later tasks)
- Produces: `webglAvailable(): boolean` exported from `office.js`

- [ ] **Step 1:** `npm install three@<version> --save-exact`; confirm `package.json` and `package-lock.json` changed.
- [ ] **Step 2:** Add the theme entry. In `main.js`, after `renderData` updates the list: if `document.documentElement.dataset.theme === 'office'` and `webglAvailable()`, hide `#groups` and the toolbar, lazily `import('./office/office.js')`, mount once into a new `#office` element inside `.main-content`, and call `office.update(state.snapshot, { error: state.error })` on every render. On theme change away from office, call `office.unmount()` and show `#groups` again. Without WebGL, show the list plus a one-line notice "Office needs WebGL".
- [ ] **Step 3:** `office.js`: full-size `WebGLRenderer` (antialias, `setPixelRatio(Math.min(devicePixelRatio, 2))`), `ResizeObserver` on the container, a `PerspectiveCamera` (fov 70), a light floor plane, render loop with `requestAnimationFrame` that stops while `document.hidden` and resumes on `visibilitychange`. `unmount()` cancels the loop, removes listeners, traverses the scene and disposes geometries/materials/textures, and calls `renderer.dispose()`.
- [ ] **Step 4:** Verify: `npm run demo`, open http://127.0.0.1:47842 (PIN 1234), pick Office in the theme menu → floor visible, list hidden; switch back to Orbit → list returns, no console errors. `npm test` still passes.
- [ ] **Step 5:** `git add -A && git commit -m "Office theme: lazy three.js mount"`

### Task 2: Layout (pure)

**Files:**
- Create: `client/office/layout.js`
- Test: `tests/office-layout.test.mjs`

**Interfaces:**
- Produces: `layoutOffice(sessions: Session[], previous?: Layout): Layout` where
  `Layout = { pods: Pod[], desks: Map<sessionId, Desk>, room: { width, depth }, door: { x, z } }`,
  `Pod = { key, name, x, z, width, depth, deskIds: string[] }`,
  `Desk = { sessionId, podKey, x, z, rotation, subagents: string[], overflow: number }`.
- Constants exported: `DESK_W = 1.6`, `DESK_D = 0.9`, `AISLE = 2.4`, `MAX_SUBAGENTS = 3`.

Rules: pods keyed by `session.cwd || session.project || 'Unknown'`, named by `session.project || 'Unknown'`, sorted by name; top-level sessions only (no `parentId`) get desks; desks in pairs facing each other (rotation `0` / `Math.PI`), pod holds `ceil(n/2)` pairs; pods laid out on a grid with `ceil(sqrt(podCount))` columns, `AISLE` between pods and an open start area of 4 m in front of the door; desks from `previous` keep their slot index within the pod, new sessions take the first free slot; room size = grid bounds + `AISLE` margin; subagents listed on the parent's desk, first `MAX_SUBAGENTS` in `subagents`, the rest counted in `overflow`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice, MAX_SUBAGENTS } from '../client/office/layout.js';

const s = (id, project, extra = {}) => ({ id, project, cwd: `/p/${project}`, status: 'idle', ...extra });

test('one pod per project, sorted by name', () => {
  const l = layoutOffice([s('a', 'zeta'), s('b', 'alpha'), s('c', 'alpha')]);
  assert.deepEqual(l.pods.map(p => p.name), ['alpha', 'zeta']);
  assert.equal(l.pods[0].deskIds.length, 2);
});
test('keeps seats when a session joins', () => {
  const first = layoutOffice([s('b', 'x'), s('c', 'x')]);
  const next = layoutOffice([s('a', 'x'), s('b', 'x'), s('c', 'x')], first);
  for (const id of ['b', 'c']) assert.deepEqual([next.desks.get(id).x, next.desks.get(id).z], [first.desks.get(id).x, first.desks.get(id).z]);
});
test('missing project goes to Unknown', () => {
  const l = layoutOffice([{ id: 'a', status: 'idle' }]);
  assert.equal(l.pods[0].name, 'Unknown');
});
test('subagents sit on the parent desk with overflow', () => {
  const kids = Array.from({ length: MAX_SUBAGENTS + 2 }, (_, i) => s(`k${i}`, 'x', { parentId: 'p' }));
  const desk = layoutOffice([s('p', 'x'), ...kids]).desks.get('p');
  assert.equal(desk.subagents.length, MAX_SUBAGENTS);
  assert.equal(desk.overflow, 2);
  assert.equal(layoutOffice([s('p', 'x'), ...kids]).desks.size, 1);
});
test('orphan subagents are dropped', () => {
  assert.equal(layoutOffice([s('k', 'x', { parentId: 'gone' })]).desks.size, 0);
});
test('room grows with pods and desks never overlap', () => {
  const many = Array.from({ length: 30 }, (_, i) => s(`s${i}`, `p${i % 7}`));
  const l = layoutOffice(many), small = layoutOffice(many.slice(0, 2));
  assert.ok(l.room.width * l.room.depth > small.room.width * small.room.depth);
  const spots = [...l.desks.values()].map(d => `${d.x.toFixed(2)},${d.z.toFixed(2)}`);
  assert.equal(new Set(spots).size, spots.length);
});
```

- [ ] **Step 2:** `node --test tests/office-layout.test.mjs` → FAIL (module not found).
- [ ] **Step 3:** Implement `layoutOffice` per the rules above.
- [ ] **Step 4:** `node --test tests/office-layout.test.mjs` → PASS; `npm test` → PASS.
- [ ] **Step 5:** `git add client/office/layout.js tests/office-layout.test.mjs && git commit -m "Office: desk layout"`

### Task 3: Status, bubbles and identity (pure)

**Files:**
- Create: `client/office/status.js`
- Test: `tests/office-status.test.mjs`

**Interfaces:**
- Produces: `officeStatus(session): { pose, expression, bubble: { icon, text, highlight } | null, screen }`
  - `pose` ∈ `'typing' | 'waving' | 'raising' | 'sleeping' | 'slumped' | 'still'`
  - `expression` ∈ `'smile' | 'worried' | 'curious' | 'asleep' | 'frown' | 'neutral'`
  - `screen` ∈ `'green' | 'amber' | 'dark' | 'red' | 'off'`
- Produces: `identity(id: string): { fruit, color, accessory, props: string[] }` — `fruit` from `FRUITS = ['apple','pear','banana','orange','lemon','eggplant','strawberry']`, `accessory` ∈ `'glasses' | 'tie' | 'none'`, `props` 0–2 of `['plant','mug','duck']`. Uses a 32-bit FNV-1a hash of `id`.
- Produces: `isTypingTarget(element): boolean` — true for `input`, `textarea`, `select`, `[contenteditable]`, or anything inside `#panel`.

Mapping (spec table): working → typing/smile/⌨️ `session.detail || 'Working'`/green; permission → waving/worried/✋ `requests[0].title || 'Needs permission'`/amber, highlight; question → raising/curious/❓ first line of `requests[0].title || 'Has a question'`/amber, highlight; idle → sleeping/asleep/💤 `''`/dark; error → slumped/frown/⚠️ `session.detail || 'Error'`/red; offline and unknown → still/neutral/`null`/off. Subagents (`parentId`) get a bubble only when working.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { officeStatus, identity, isTypingTarget, FRUITS } from '../client/office/status.js';

test('every status maps to a pose', () => {
  const want = { working: 'typing', permission: 'waving', question: 'raising', idle: 'sleeping', error: 'slumped', offline: 'still', unknown: 'still' };
  for (const [status, pose] of Object.entries(want)) assert.equal(officeStatus({ status, requests: [] }).pose, pose);
});
test('waiting sessions get highlighted bubbles from their request', () => {
  const b = officeStatus({ status: 'permission', requests: [{ title: 'Run npm test' }] }).bubble;
  assert.deepEqual(b, { icon: '✋', text: 'Run npm test', highlight: true });
});
test('bubble text is one line, max 48 chars', () => {
  const b = officeStatus({ status: 'question', requests: [{ title: `${'x'.repeat(60)}\nsecond line` }] }).bubble;
  assert.equal(b.text.length, 48);
  assert.ok(b.text.endsWith('…') && !b.text.includes('\n'));
});
test('subagents only talk while working', () => {
  assert.equal(officeStatus({ status: 'idle', parentId: 'p', requests: [] }).bubble, null);
  assert.ok(officeStatus({ status: 'working', parentId: 'p', requests: [] }).bubble);
});
test('identity is deterministic and varied', () => {
  assert.deepEqual(identity('claude:abc'), identity('claude:abc'));
  const fruits = new Set(Array.from({ length: 50 }, (_, i) => identity(`s${i}`).fruit));
  assert.ok(fruits.size >= 5 && [...fruits].every(f => FRUITS.includes(f)));
});
test('typing targets are recognized', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA', closest: () => null }), true);
  assert.equal(isTypingTarget({ tagName: 'CANVAS', isContentEditable: false, closest: () => null }), false);
});
```

- [ ] **Step 2:** `node --test tests/office-status.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. `identity` colors: per-fruit palettes (apple `['#d62828','#7cb518','#f2c14e']`, pear `['#b5c934','#e0b73f']`, banana `['#f7d23e']`, orange `['#f28c28']`, lemon `['#f9e04b']`, eggplant `['#5b2a86','#7a3ea8']`, strawberry `['#e63946']`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git add client/office/status.js tests/office-status.test.mjs && git commit -m "Office: status mapping and identity"`

### Task 4: Fruit characters

**Files:**
- Create: `client/office/fruit.js`, `client/office/toon.js`

**Interfaces:**
- Consumes: `identity()` from Task 3.
- Produces (`toon.js`): `toonMaterial(color): MeshToonMaterial` (shared 3-band gradient `DataTexture`, `NearestFilter`), `withOutline(mesh, thickness = 0.02): Group` (back-face black copy scaled by `1 + thickness`, cached materials).
- Produces (`fruit.js`): `createFruit(identity, { scale = 1 }): Fruit` where `Fruit = { group, setLimbs(targets), setExpression(name), setBlink(0..1), lookAt(worldVec3|null), dispose() }`; `targets = { leftHand, rightHand, leftFoot, rightFoot }` as `Vector3` in the fruit's local space.

Build notes (match the concept art): bodies via `LatheGeometry` from a few `Vector2` profile points (apple with top dip, pear, orange with a bump `CanvasTexture`, lemon, eggplant, strawberry with seed-dot texture); banana via `TubeGeometry` on a bent `CatmullRomCurve3` with a radius taper function, capped. Limbs: black `TubeGeometry` (radius 0.035, 12 radial, 16 tubular segments) along a `QuadraticBezierCurve3` from an anchor 0.1 inside the body surface to the target, with a sag control point; rebuild geometry only when targets moved > 1 mm (reuse buffers by updating `position` attribute from a fresh `TubeGeometry` of the same segment counts). Hands: one merged mesh (palm sphere + 3 finger capsules + thumb); shoes: squashed spheres. Face: eyes as small black ellipsoids slightly protruding, eyebrows and mouth as thin black `TubeGeometry` arcs whose curves change per expression; blink scales eye Y to 0.1; `asleep` uses closed-arc eyes and an "o" mouth. Accessories: glasses (two `TorusGeometry` rims + bridge, slightly transparent lenses), tie (flattened extrusions with a striped `CanvasTexture`).

- [ ] **Step 1:** Implement. Add a temporary `?fruits` dev hook in `office.js` that lines up all 7 fruits × 3 accessories in a row with a debug orbit (remove in Step 4).
- [ ] **Step 2:** Verify by eye in the demo against the concept art: no gaps where limbs meet body/hands/feet from any angle, outlines thin and continuous, faces readable at 3 m.
- [ ] **Step 3:** Check performance: 30 fruits with animated limbs keep ≥ 55 fps on desktop (Chrome devtools performance overlay) and the frame budget is spent mostly outside limb rebuilding; if limbs dominate, drop tubular segments to 10.
- [ ] **Step 4:** Remove the `?fruits` hook. Commit: `git add client/office && git commit -m "Office: fruit characters"`

### Task 5: Room and desks

**Files:**
- Create: `client/office/room.js`

**Interfaces:**
- Consumes: `Layout` (Task 2), `toonMaterial`/`withOutline` (Task 4), `identity().props`.
- Produces: `createRoom(scene): Room` with `Room.sync(layout, statuses: Map<id, officeStatus>)`, `Room.colliders: Box3[]` (walls + desks), `Room.fadeables: { ceiling: Object3D, walls: { mesh, normal: Vector3 }[] }`, `Room.deskAnchor(id): { seat: Vector3, facing: number, monitor: Vector3 }`, `Room.boards: { whiteboard: Mesh, clock: Mesh, waiting: Mesh }`, `Room.dispose()`.

Content: floor (warm wood toon), 4 full-height walls (3 m) with window cutouts showing a sky-gradient plane, a door on the front wall at `layout.door`, tiled ceiling with round lamp discs, desk (top + legs), chair, monitor whose screen material color follows `status.screen`, keyboard, props per identity; per pod a hanging sign on two cords with the project name on a `CanvasTexture`, border amber when any desk in the pod has a highlighted bubble. Whiteboard on the back wall, clock and cork waiting board next to the door. `sync` adds/removes desks to match the layout and resizes walls/floor when `layout.room` changes; it reuses meshes for unchanged desks.

- [ ] **Step 1:** Implement; wire `room.sync(layoutOffice(sessions, previous), statuses)` in `office.update`.
- [ ] **Step 2:** Verify in the demo with a temporary high debug camera: one pod per demo project with its sign, monitors colored by status, walls enclose everything, door and windows present.
- [ ] **Step 3:** Commit `"Office: room, desks and signs"`.

### Task 6: Characters at desks, poses and blending

**Files:**
- Create: `client/office/animation.js`
- Modify: `client/office/office.js`

**Interfaces:**
- Consumes: `createFruit` (Task 4), `officeStatus` (Task 3), `Room.deskAnchor` (Task 5).
- Produces: `poseTargets(pose, t: seconds, seed: number): { body: { y, tilt, lean }, limbs: targets, lookAtMonitor: boolean }` and `blendPose(a, b, k)`; `class Cast { sync(layout, sessions, room), update(dt, now, playerPos), characterAt(id): Fruit, dispose() }`.

Poses per spec table: `typing` (seated, hands alternating on keyboard, slight bob), `waving` (standing beside the chair, both arms up alternating, bounce), `raising` (standing, one arm up, body tilt), `sleeping` (seated, lean back 20°, slow breathing scale, legs out, "Zz" sprite), `slumped` (seated, body forward onto desk), `still` (seated, no motion, desaturated material). Blend over 0.5 s on change. Eyes look at the player within 4 m, else at the monitor. Subagents: `scale 0.45`, sitting on the parent's desk with a tiny laptop, always `typing` while working else `still`; overflow shows a "+N" sprite. Reduced motion: no bob/bounce/breathing, pose changes are instant.

- [ ] **Step 1:** Implement and wire into `office.update` and `onFrame`.
- [ ] **Step 2:** Verify in the demo: each demo status shows its pose; switching a session's status (edit demo data or wait for live change) blends smoothly; reduced motion (devtools rendering → emulate) stops idle motion.
- [ ] **Step 3:** Commit `"Office: character poses"`.

### Task 7: Speech bubbles and screen overlays

**Files:**
- Create: `client/office/bubbles.js`
- Modify: `client/office/office.css`, `client/office/office.js`

**Interfaces:**
- Consumes: `officeStatus().bubble`, `Cast.characterAt`, camera.
- Produces: `class Bubbles { constructor(container, onClick(id)); sync(entries: { id, bubble, unread }[]); update(camera, positions: Map<id, Vector3>); dispose() }`; `createOverlays(container, { onNext(), onList(), onOverviewHold(bool) }): { setWaiting(n), setUsageLow(bool), dispose() }`.

Bubbles: absolutely positioned `div`s projected each frame to 0.5 m above the head, scaled `clamp(1.4 / distance, 0.6, 1)`, hidden behind the camera, shown through walls; highlighted bubbles amber with a gentle pulse (no pulse with reduced motion); unread idle sessions show a dot; clicking calls `onClick(id)`. Overlays: ⚠ count button (hidden at 0), low-usage icon, "List" button (switches the theme back to the user's previous theme via `applyTheme`), phone-only eye button (hold = overview), "Tab: overview" hint that fades after first use (remembered in `localStorage` key `ai-control-office-hint`, wrapped in try/catch).

- [ ] **Step 1:** Implement and wire.
- [ ] **Step 2:** Verify in the demo at desktop and 390×844: bubbles stay attached while the camera moves, text stays one line, overlays don't cover the panel close button.
- [ ] **Step 3:** Commit `"Office: speech bubbles and overlays"`.

### Task 8: Player and camera

**Files:**
- Create: `client/office/player.js`, `client/office/camera.js`

**Interfaces:**
- Consumes: `Room.colliders`, `Room.fadeables`, `isTypingTarget`, `Cast`.
- Produces: `class Player { position, yaw, pitch; update(dt); walkTo(point: Vector3, then?: () => void); face(point); dispose() }`; `class OfficeCamera { mode: 'first' | 'overview' | 'focus'; setOverview(on: boolean); focus(id, onArrive()); update(dt) }`; `pick(event|center, camera): { kind: 'floor', point } | { kind: 'character', id } | null`.

Behavior: eye height 1.5 m; WASD/arrows move at 3 m/s; mouse-look with pointer lock on canvas click (Esc releases); with pointer lock, click picks at the screen center, without it at the cursor; floor click → `walkTo` along a straight line with collider sliding (circle radius 0.3 vs `Box3`s, resolve on X then Z); touch: drag looks, tap picks. Keys are ignored when `isTypingTarget(document.activeElement)` or the panel is open. Overview (hold Tab / eye button): camera eases to a point above the room center at 45° pitch, framing `layout.room`; the ceiling fades to opacity 0 and any wall whose normal faces the camera fades to outline only; first-person view hides the pineapple boss and shows the black hands + mug model attached to the camera; overview shows the pineapple (with tie) at the player position. Reduced motion: camera mode changes cut.

- [ ] **Step 1:** Implement; render hands+mug and the pineapple boss using `createFruit`-style pieces from `fruit.js` (add `'pineapple'` as a boss-only fruit there).
- [ ] **Step 2:** Verify: cannot walk through walls or desks; Tab overview shows every bubble and fades ceiling and near walls; typing in the panel message box does not move the player.
- [ ] **Step 3:** Commit `"Office: first-person player and overview camera"`.

### Task 9: Talking and next-waiting

**Files:**
- Modify: `client/office/office.js`, `client/main.js`

**Interfaces:**
- Consumes: `hooks.openPanel(id)`, `hooks.nextWaiting()`, `Player.walkTo`, `OfficeCamera.focus`, `Bubbles` click, `pick`.
- Produces: `Office.talkTo(id)`.

`talkTo(id)`: walk to 1.2 m in front of the character's desk, the character turns to face the player (pose override for 1 s), `camera.focus(id)` frames character + desk and fades occluders, then `hooks.openPanel(id)`. `E` talks to the character within 2 m and ±30° of the view direction. `n` and the ⚠ overlay call `talkTo(hooks.nextWaiting()?.id)`. In `main.js`, make the existing `n` shortcut call `office.talkTo` instead of `openNext` while the office is mounted. When the panel closes, return the camera to first person where the player stands.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify in the demo: clicking a character, E, `n` and ⚠ all walk, zoom and open the right session's panel; approving a permission from the panel turns that character back to typing on the next snapshot.
- [ ] **Step 3:** Commit `"Office: talk to characters"`.

### Task 10: In-world boards

**Files:**
- Create: `client/office/boards.js`

**Interfaces:**
- Consumes: `Room.boards`, `snapshot.usage` (array of `{ provider, name, windows: [{ label, usedPercent, resetsAt }], status }`), `usageWindowView` from `client/usage-presentation.js`, waiting sessions.
- Produces: `createBoards(room): { sync(snapshot, { error }), tick(now), dispose() }`.

Whiteboard: 1024×512 `CanvasTexture` redrawn only when `JSON.stringify([usage, error])` changes: per account a row with the account name, a hand-drawn-looking bar per window (`shortLabel`, `percentText`, bar filled to `barPercent`, red when `tone` is set), and "slow down!" in red marker when `pace > 100`; when `error` is set, "connection lost" across the board. Clock: 256×256 canvas, redrawn once per minute. Waiting board: sticky notes (yellow squares) with each waiting session's title, max 6, redrawn when the list changes. Use a rounded hand-written-looking system font stack (`'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', cursive`); no web fonts.

- [ ] **Step 1:** Implement and wire `boards.sync` into `office.update`, `boards.tick` into `onFrame`; `createOverlays().setUsageLow(any window usedPercent >= 80)`.
- [ ] **Step 2:** Verify in the demo: whiteboard matches the numbers in the Orbit usage panel; waiting board lists the demo's waiting sessions; clock shows local time.
- [ ] **Step 3:** Commit `"Office: whiteboard, clock and waiting board"`.

### Task 11: Arrivals, departures and failure states

**Files:**
- Modify: `client/office/animation.js` (`Cast.sync`), `client/office/layout.js`, `client/office/office.js`
- Test: `tests/office-layout.test.mjs`

**Interfaces:**
- Produces: `layoutOffice(sessions, previous, now)` keeps a departed session's desk for `VACANT_MS = 30_000` (`desk.vacantSince`), then frees it.

- [ ] **Step 1: Failing test**

```js
test('departed desks stay 30 s, then free up', () => {
  const first = layoutOffice([s('a', 'x'), s('b', 'x')], undefined, 0);
  const gone = layoutOffice([s('b', 'x')], first, 1000);
  assert.ok(gone.desks.get('a').vacantSince === 1000);
  assert.equal(layoutOffice([s('b', 'x')], gone, 31_001).desks.has('a'), false);
});
```

- [ ] **Step 2:** Run → FAIL. Implement. Run `npm test` → PASS.
- [ ] **Step 3:** In `Cast.sync`: new sessions spawn at the door and walk to their seat (straight path, 2 m/s) before taking their pose; departed sessions stand, wave, walk to the door and are removed; with reduced motion they appear/disappear in place. When `error` is set, freeze characters (skip pose updates) and keep the last snapshot.
- [ ] **Step 4:** Verify in the demo by temporarily removing/adding a session in `scripts/demo.mjs` data (revert after); verify the no-WebGL path with `chrome --disable-webgl` shows the list and the notice.
- [ ] **Step 5:** Commit `"Office: arrivals, departures, failure states"`.

### Task 12: Final check and README

**Files:**
- Modify: `README.md` (one Office row in the screenshots table, one line under Features)
- Create: `docs/screenshots/office-overview.webp`, `docs/screenshots/office-first-person.webp`

- [ ] **Step 1:** `npm test` → all pass; `npm run build` → succeeds and `three` lands in a separate chunk (check `dist/assets/` for a second JS file loaded only by the office).
- [ ] **Step 2:** Walk through the demo on desktop and at phone size with reduced motion on and off; check the five Review Focus items by hand.
- [ ] **Step 3:** Take the two screenshots from the demo, convert to webp, add to README.
- [ ] **Step 4:** Commit `"Office: README and screenshots"`. Do not push.
