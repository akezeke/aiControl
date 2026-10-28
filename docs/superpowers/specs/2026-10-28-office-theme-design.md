# Office theme: 3D toon office of sessions

## Goal

A new "Office" entry in the theme menu that replaces the session list with a colorful, toon-shaded 3D office. Every session is a fruit character at a desk. You walk around as the boss in first person, see each session's status in speech bubbles and poses, and click a character to zoom in and open the existing session panel. It should be fun, but it is still the dashboard: noticing who needs you must stay easy.

Out of scope for now: answering requests in game dialogue (the existing side panel does this), GLB models (the character module is kept swappable for later), sounds beyond the existing alerts.

## Integration

- `client/themes.js`: add `{ id: 'office', name: 'Office', color: … }`.
- `client/main.js`: when the office theme is active, mount the office in place of `#groups` and give it each new snapshot (`state.snapshot`, after `refresh()`), plus `openPanel(id)` for opening a session and `nextWaiting()` for `n`. Unmount when switching away.
- Load the office with `import('./office/office.js')` so three.js only downloads for this theme. Add `three` as a dependency, bundled by Vite (no CDN; the app loads no third-party scripts).
- No server changes.

## Modules (`client/office/`)

| File | Job |
|---|---|
| `office.js` | mount/unmount, render loop, snapshot updates, pause while the tab is hidden, dispose GPU resources |
| `layout.js` | pure: sessions → project pods → desk positions, room size, stable ordering |
| `status.js` | pure: session → pose name + bubble (icon, text, highlighted) |
| `fruit.js` | fruit bodies, eyes, noodle limbs; the only module that knows how characters are built |
| `animation.js` | poses and blending between them |
| `room.js` | floor, walls, ceiling, door, windows, desks, props, signs, whiteboard, clock, waiting board |
| `player.js` | first-person movement, collision, click-to-walk |
| `camera.js` | first person, overview (hold Tab), fly-to-character, fading walls/ceiling that block the view |
| `bubbles.js` | HTML speech bubbles projected above heads |
| `office.css` | bubbles and the few screen overlays |

## Characters

- **Fruit bodies:** apple, pear, banana, lemon, eggplant, strawberry. Each is one smooth mesh (a spun curve, or a tapered tube for the banana) with its stem, leaf or cap. The fruit and a color from that fruit's palette are picked by hashing the session id, so they stay the same across reloads.
- **Noodle limbs:** two arms and two legs. Each is a tube along a curve from a point inside the body to a sphere hand or foot, rebuilt every frame from the pose. No joints, no gaps. Limbs use a darker shade of the body color.
- **Eyes only:** two white spheres sunk into the body with black pupils. They blink at random, look at the boss when nearby and otherwise at the monitor, and close to flat lids when asleep.
- **Look:** `MeshToonMaterial` with a three-step light ramp, black outlines from an inverted, slightly larger copy of each shape, and a dark circle under each character as its shadow (no real shadows).
- **Subagents:** smaller fruits of the parent's kind on the parent's desk with tiny laptops. Up to 3 per desk; more show as "+N". Bubbles only while working.
- **Boss:** in first person you see noodle hands holding a coffee mug. In the overview you are a pineapple wearing a tie.

## Status → pose and bubble

| Status | Pose | Bubble |
|---|---|---|
| working | typing, bobbing, eyes on screen | ⌨️ `detail` or current tool |
| permission | standing, waving both arms, bouncing | ✋ the request, highlighted |
| question | standing, one arm up, head tilted | ❓ first line of the question, highlighted |
| idle | leaning back in the chair, eyes shut, slow breathing | 💤, plus a dot if unread |
| error | slumped on the desk | ⚠️ short error |
| offline / unknown | grey, still | none |

Poses blend over about 0.5 s. Bubbles are HTML elements positioned over the scene each frame (sharp text, clickable), stay visible through walls, and shrink with distance down to a minimum size. Bubble text is truncated to one line.

## Office

- **Room:** closed room with floor, full-height walls, windows with a sky gradient, a door and a tiled ceiling with decorative round lamps. Fixed toon lighting, no per-desk lights.
- **Pods:** one group of desks per project, desks facing in pairs, sized to the session count. The project's sign hangs from the ceiling on cords; its border glows amber when someone there is waiting.
- **Desk:** desk, chair, monitor whose screen color shows status (green working, amber waiting, dark idle), keyboard, and 0–2 props (plant, mug, rubber duck) picked by session id.
- **Floor plan:** pods in a grid around an open start area by the door, with wide walkways. Order by project name, then session start time, so desks never swap between refreshes. The room grows and shrinks with the grid.
- **Arrivals and departures:** a new session walks in from the door and sits down. An ended session stands, waves and walks out; its desk stays for 30 s before the pod shrinks.
- **Size:** designed for about 30 sessions.
- **In-world info:**
  - Whiteboard: Claude and Codex usage bars (5 h and week) in marker style, with a handwritten percent and a red "slow down!" when the pace is over the limit. Drawn to a canvas texture, redrawn only when usage changes. Shows "connection lost" while disconnected.
  - Wall clock with the real time.
  - Waiting board by the door: sticky notes with the names of sessions that need input.

## Camera and controls

| | Desktop | Phone |
|---|---|---|
| Look | mouse with pointer lock (click to grab, Esc to release) | drag |
| Move | WASD / arrows; click floor to walk | tap floor to walk |
| Talk | click a character, or E when facing one | tap a character |
| Overview | hold Tab | hold the eye button |
| Next waiting | `n` | tap ⚠ |

- **First person:** eye height about one fruit and a half. Collision against wall and desk boxes keeps you and the camera inside the room.
- **Overview:** the camera rises to about 45° over the room. The ceiling and the walls between the camera and the room fade to see-through outlines; far walls stay solid; signs stay visible.
- **Talk:** you walk up to the character, they turn to face you, the camera settles on them and their desk (fading anything in between), then `openPanel(id)` runs. Closing the panel returns control where you stood.
- **`n`:** turns you toward the next waiting session and walks you there.
- With pointer lock on, a click acts on whatever is under the center crosshair (floor = walk there, character = talk).
- Keys go to the office only when the panel and inputs don't have focus.
- **Screen overlays (HTML):** ⚠ waiting count (walks you to the next one), a low-usage icon beside it when usage is near the limit, a button back to the list, the phone eye button, and a "Tab: overview" hint that fades after first use.

## Reduced motion

Camera moves cut instead of flying, characters still show status poses but without bobbing and bouncing, no walk-in/walk-out (characters appear and disappear).

## Errors

- No WebGL: Office shows a short notice and the normal list.
- Connection lost: characters freeze, the whiteboard says "connection lost", actions stay disabled as in the list.
- Tab hidden: rendering stops.
- Switching theme: scene removed and all geometries, materials and textures disposed.

## Testing

- `tests/office-layout.test.mjs`: pods per project, stable desk order across snapshots, subagent limit and "+N", room size growth.
- `tests/office-status.test.mjs`: every status maps to a pose and the right bubble.
- Manual: `npm run demo` in desktop and phone sizes, reduced motion on, no-WebGL fallback. Add an Office screenshot to the README.

## Git

Commit locally only. Do not push to the upstream repository.
