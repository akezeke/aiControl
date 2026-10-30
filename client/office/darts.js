// Darts in the secret room: a board on the back wall, a chalkboard beside it keeping score and a strip of tape for the oche.
// Click the board (or E on it) to step up to the tape: the view is the oche's, a dart in hand, and the mouse aims; click, tap
// or E throws. The hand sways, so a ring on the board shows where it would land right now: let go when it's on what you
// want. Esc, ✕ or a walking key steps back (office.js runs that).
// The game is 301 with any finish: from 301 down to exactly 0, three darts a turn; going under 0 is a bust and the turn
// counts for nothing. Your best is the fewest darts to check out, kept per browser.
// With reduced motion the hand is steady and a dart lands at once.
import * as THREE from 'three';
import { mesh, once, canvasTexture, glowTexture, paint, painted } from './furniture.js';
import { SECRET } from './secret.js';
import { toonMaterial } from './toon.js';

// Clockwise from the top, and the rings' outer radii in metres (a regulation board).
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const RINGS = { bull: 0.00635, outer: 0.0159, trebleIn: 0.099, trebleOut: 0.107, doubleIn: 0.162, doubleOut: 0.17, board: 0.225 };
// What a dart scores `x` right of and `y` above the bull, in metres.
export function score(x, y) {
  const r = Math.hypot(x, y);
  if (r <= RINGS.bull) return { points: 50, label: 'Bull' };
  if (r <= RINGS.outer) return { points: 25, label: '25' };
  if (r > RINGS.doubleOut) return { points: 0, label: 'Miss' };
  const n = ORDER[Math.floor(((Math.atan2(x, y) * 180 / Math.PI + 369) % 360) / 18)];
  if (r >= RINGS.trebleIn && r <= RINGS.trebleOut) return { points: 3 * n, label: `T${n}` };
  if (r >= RINGS.doubleIn) return { points: 2 * n, label: `D${n}` };
  return { points: n, label: `${n}` };
}
// 301: `left` to go, `from` what it was when the turn began, `turn` its darts so far. A dart after a finished turn starts the
// next; after a win, a new game.
export const newGame = () => ({ left: 301, from: 301, turn: [], darts: 0, over: false, bust: false, won: false });
export function play(game, hit) {
  const g = game.won ? newGame() : game.over ? { ...game, from: game.left, turn: [], over: false, bust: false } : { ...game };
  g.darts++; g.turn = [...g.turn, hit];
  const left = g.left - hit.points;
  if (left < 0) return { ...g, left: g.from, over: true, bust: true };
  if (left === 0) return { ...g, left: 0, over: true, won: true };
  return { ...g, left, over: g.turn.length === 3 };
}

// In the secret room's frame. The board is a regulation one made SIZE times bigger, so it reads from the oche.
const BOARD = { x: 2.3, y: 1.73 }, SIZE = 1.3, FACE = -SECRET.back + 0.06, OCHE = FACE + 2.37;
const SWAY = 0.03, SPEED = 12, PULL = 1.6, BEST = 'ai-control-darts-best';
const FLIGHTS = ['#ff4fd8', '#38f2ff', '#ffe14f'];
export const CHALK = "'Comic Neue', 'Comic Sans MS', cursive";

const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// A dart along +z with its tip at the origin: point, barrel, shaft and two crossed flights.
const dartParts = color => [
  [new THREE.ConeGeometry(0.0016, 0.022, 6).rotateX(-Math.PI / 2).translate(0, 0, 0.011), '#c9ced8'],
  [new THREE.CylinderGeometry(0.0038, 0.0034, 0.045, 10).rotateX(Math.PI / 2).translate(0, 0, 0.044), '#8a8f99'],
  [new THREE.CylinderGeometry(0.0018, 0.0018, 0.05, 6).rotateX(Math.PI / 2).translate(0, 0, 0.09), '#2f3542'],
  [B(0.03, 0.0012, 0.04, 0, 0, 0.12), color], [B(0.0012, 0.03, 0.04, 0, 0, 0.12), color],
];
const dart = i => mesh(once(`dart${i}`, () => paint(dartParts(FLIGHTS[i]))), painted(), 0.002);

// The board: black and cream singles, red and green doubles and trebles, the numbers round the outside.
function drawBoard(g, size) {
  const c = size / 2, k = c / RINGS.board, wedge = (r0, r1, i, color) => {
    const a0 = (i * 18 - 9 - 90) * Math.PI / 180, a1 = a0 + Math.PI / 10;
    g.beginPath(); g.arc(c, c, r1 * k, a0, a1); g.arc(c, c, r0 * k, a1, a0, true); g.closePath(); g.fillStyle = color; g.fill();
  };
  g.fillStyle = '#1b1a1f'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
  ORDER.forEach((n, i) => {
    const [single, ring] = i % 2 ? ['#f1e3c4', '#2e9c5a'] : ['#1b1a1f', '#d63a3a'];
    wedge(RINGS.outer, RINGS.doubleOut, i, single); wedge(RINGS.trebleIn, RINGS.trebleOut, i, ring); wedge(RINGS.doubleIn, RINGS.doubleOut, i, ring);
    const a = (i * 18 - 90) * Math.PI / 180, r = (RINGS.doubleOut + RINGS.board) / 2 * k;
    g.fillStyle = '#f4f2ec'; g.font = `bold ${Math.round(size * 0.052)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, c + Math.cos(a) * r, c + Math.sin(a) * r);
  });
  g.fillStyle = '#2e9c5a'; g.beginPath(); g.arc(c, c, RINGS.outer * k, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d63a3a'; g.beginPath(); g.arc(c, c, RINGS.bull * k, 0, Math.PI * 2); g.fill();
  // The wire.
  g.strokeStyle = '#c9ced8'; g.lineWidth = size / 700;
  for (const r of [RINGS.outer, RINGS.trebleIn, RINGS.trebleOut, RINGS.doubleIn, RINGS.doubleOut]) { g.beginPath(); g.arc(c, c, r * k, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 20; i++) { const a = (i * 18 - 9 - 90) * Math.PI / 180; g.beginPath(); g.moveTo(c + Math.cos(a) * RINGS.outer * k, c + Math.sin(a) * RINGS.outer * k); g.lineTo(c + Math.cos(a) * RINGS.doubleOut * k, c + Math.sin(a) * RINGS.doubleOut * k); g.stroke(); }
}
// The chalkboard: what's left big, this turn's darts, a word on how it went, darts thrown and the best.
function drawScore(g, w, h, game, best, active) {
  g.fillStyle = '#24302b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2f2ea'; g.textBaseline = 'alphabetic';
  g.font = `bold 40px ${CHALK}`; g.textAlign = 'left'; g.fillText('301', 26, 52);
  g.textAlign = 'right'; g.font = `bold 30px ${CHALK}`; g.fillText(best ? `best ${best} darts` : 'any finish', w - 24, 50);
  g.textAlign = 'center'; g.font = `bold 150px ${CHALK}`; g.fillText(game.left, w / 2, 205);
  g.font = `bold 44px ${CHALK}`;
  const darts = [0, 1, 2].map(i => game.turn[i]?.label ?? '·');
  darts.forEach((label, i) => { g.fillStyle = game.turn[i] ? FLIGHTS[i] : '#8c968f'; g.fillText(label, w * (0.2 + i * 0.2), 275); });
  g.fillStyle = '#f2f2ea'; g.textAlign = 'right'; g.fillText(game.bust ? '' : `= ${game.turn.reduce((sum, hit) => sum + hit.points, 0)}`, w - 24, 275);
  g.textAlign = 'center'; g.font = `bold 40px ${CHALK}`;
  const word = game.won ? [`Checkout! ${game.darts} darts`, '#ffe14f'] : game.bust ? ['Bust!', '#ff6b6b'] : game.darts ? [`${game.darts} darts thrown`, '#b8c2bb'] : [active ? 'Aim and click' : 'Click the board to play', '#b8c2bb'];
  g.fillStyle = word[1]; g.fillText(word[0], w / 2, 345);
}
// What a dart just scored, floating up off the board (golf.js calls its holes with it too).
export function drawCall(g, w, h, text, color) { g.clearRect(0, 0, w, h); if (!text) return; g.font = `bold 84px ${CHALK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 12; g.strokeStyle = '#1b1a1f'; g.strokeText(text, w / 2, h / 2); g.fillStyle = color; g.fillText(text, w / 2, h / 2); }

// `hands`: the camera's hands (camera.js), where the next dart is held; `aim()`: where you're pointing, as a direction;
// `onPlay(darts)`: the board was clicked.
export function createDarts({ hands, camera, aim, onPlay }) {
  let game = newGame(), best = null, room = null, active = false, flight = null, pullAt = 0, time = 0, still = false;
  try { best = Number(localStorage.getItem(BEST)) || null; } catch {}
  const held = dart(0); held.position.set(-0.11, -0.11, -0.4); held.rotation.set(0.12, 0.08, 0); held.visible = false; hands.add(held);
  let board, stuck, sight, chalk, call;
  const local = new THREE.Vector3(), sway = new THREE.Vector2(), onBoard = p => Math.hypot(p.x - BOARD.x, p.y - BOARD.y) <= RINGS.board * SIZE;
  // Where a throw along `direction` from the camera would land, in the room's frame, hand sway and all; null if not at the wall.
  const landing = direction => {
    const o = room.worldToLocal(local.copy(camera.position)), d = direction;
    if (d.z > -0.05) return null;
    const t = (FACE - o.z) / d.z, p = o.clone().addScaledVector(d, t).add(new THREE.Vector3(sway.x, sway.y, 0));
    return p.x > 0.1 && p.x < SECRET.w - 0.1 && p.y > 0.1 && p.y < 2.9 ? p : null;
  };
  const darts = {
    // Holding a dart: playing, nothing in the air, the last turn's darts pulled out.
    get ready() { return active && !flight && !(game.over && time < pullAt); },
    // Playing: office.js steps you up to the oche and back.
    enter() { active = true; chalk.redraw(); },
    leave() { active = false; chalk.redraw(); },
    // Where you stand to play (on the floor, in world space) and which way you face; the view while playing.
    stand() { const p = room.localToWorld(new THREE.Vector3(BOARD.x, 0, OCHE + 0.35)); return { x: p.x, z: p.z, yaw: Math.PI }; },
    pose() { return { from: room.localToWorld(new THREE.Vector3(BOARD.x, 1.6, OCHE + 0.25)), look: room.localToWorld(new THREE.Vector3(BOARD.x, BOARD.y, FACE)), fov: 38, hands: true }; },
    click(direction) { return darts.throw(direction); },
    // The secret room's group: board, chalkboard and tape go in it (secret.js calls this when it builds the room).
    build(group) {
      room = group;
      // The board and its chalkboard: click either to play (outlined under the pointer).
      const set = new THREE.Group(); set.userData.toggle = () => onPlay(darts); group.add(set); group = set;
      const backing = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 40).rotateX(Math.PI / 2), toonMaterial('#2b2730'), 0.006);
      backing.position.set(BOARD.x, BOARD.y, -SECRET.back + 0.015); group.add(backing);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.set(BOARD.x, BOARD.y, -SECRET.back + 0.004); group.add(glow);
      board = new THREE.Mesh(new THREE.CircleGeometry(RINGS.board * SIZE, 64), new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 1024, drawBoard) }));
      board.position.set(BOARD.x, BOARD.y, FACE); group.add(board);
      // The board's body, behind its face (stopping short of it, or the two would fight over the same depth).
      const body = new THREE.Mesh(new THREE.CylinderGeometry(RINGS.board * SIZE + 0.005, RINGS.board * SIZE + 0.005, 0.026, 48).rotateX(Math.PI / 2), toonMaterial('#1b1a1f'));
      body.position.set(BOARD.x, BOARD.y, FACE - 0.016); group.add(body);
      const frame = mesh(B(0.86, 0.66, 0.03, 0, 0, 0), toonMaterial('#7a4e2d'), 0.006); frame.position.set(BOARD.x + 1.1, 1.62, -SECRET.back + 0.015); group.add(frame);
      chalk = canvasTexture(512, 384, (g, w, h) => drawScore(g, w, h, game, best, active));
      const slate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ map: chalk })); slate.position.set(BOARD.x + 1.1, 1.62, -SECRET.back + 0.032); group.add(slate);
      document.fonts?.load(`bold 40px 'Comic Neue'`).then(() => chalk.redraw()).catch(() => {});
      const tape = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.05).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23f' })); tape.position.set(BOARD.x, 0.014, OCHE); room.add(tape);
      stuck = FLIGHTS.map((_, i) => { const m = dart(i); m.visible = false; room.add(m); return m; });
      // Where it would land: a white ring with a dark edge, so it shows on cream and black alike.
      sight = new THREE.Mesh(new THREE.RingGeometry(0.011, 0.017, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false })); sight.renderOrder = 2; sight.visible = false; room.add(sight);
      const edge = new THREE.Mesh(new THREE.RingGeometry(0.017, 0.021, 24), new THREE.MeshBasicMaterial({ color: '#1b1a1f', depthTest: false })); edge.renderOrder = 2; sight.add(edge);
      call = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(256, 128, drawCall), transparent: true, depthTest: false })); call.scale.set(0.36, 0.18, 1); call.renderOrder = 3; call.visible = false; room.add(call);
    },
    // Throws the dart in hand along `direction` (where you aim if not given). False if it wouldn't reach the back wall.
    throw(direction = aim()) {
      if (!darts.ready) return false;
      const to = landing(direction); if (!to) return false;
      const hit = onBoard(to) ? score((to.x - BOARD.x) / SIZE, (to.y - BOARD.y) / SIZE) : { points: 0, label: 'Miss', wall: true };
      if (hit.wall) to.z = -SECRET.back + 0.004;
      if (game.over) for (const m of stuck) m.visible = false;
      const i = game.over || game.won ? 0 : game.turn.length, m = stuck[i];
      held.updateWorldMatrix(true, false);
      const from = room.worldToLocal(held.getWorldPosition(new THREE.Vector3()));
      flight = { m, i, from, to, hit, t: 0, time: Math.max(0.12, from.distanceTo(to) / SPEED) };
      m.visible = true; if (still) land();
      return true;
    },
    update(dt, at, reduced) {
      time += dt; still = reduced;
      if (!room) return;
      if (game.over && time >= pullAt && stuck.some(m => m.visible) && !flight) for (const m of stuck) m.visible = false; // pulled out
      if (still) sway.set(0, 0); else sway.set(SWAY * (Math.sin(time * 1.1) + 0.5 * Math.sin(time * 2.9 + 1)) / 1.5, SWAY * (Math.sin(time * 1.5 + 2) + 0.5 * Math.sin(time * 2.3)) / 1.5);
      const ready = darts.ready;
      held.visible = ready;
      if (ready) { const next = game.over || game.won ? 0 : game.turn.length; if (held.userData.i !== next) { held.userData.i = next; held.geometry = stuck[next].geometry; } }
      const spot = ready && landing(aim());
      sight.visible = !!spot; if (spot) sight.position.set(spot.x, spot.y, (onBoard(spot) ? FACE : -SECRET.back) + 0.004);
      if (flight) {
        // A shallow arc, the tail trailing (its +z) back along the way it's going.
        const f = flight, h = 0.05 * f.from.distanceTo(f.to); f.t = Math.min(1, f.t + dt / f.time);
        const pos = f.from.clone().lerp(f.to, f.t), v = f.to.clone().sub(f.from); pos.y += 4 * h * f.t * (1 - f.t); v.y += 4 * h * (1 - 2 * f.t);
        f.m.position.copy(pos); f.m.lookAt(room.localToWorld(pos.clone().sub(v)));
        if (f.t === 1) land();
      }
      if (call.visible) { const age = time - call.userData.at; call.position.y = call.userData.y + age * 0.25; call.material.opacity = Math.max(0, 1 - age / 1.1); if (age > 1.1) call.visible = false; }
    },
  };
  // The dart in the air lands: stuck where it hit, nose in, tail up a touch; then the score.
  function land() {
    const f = flight; flight = null;
    f.m.position.copy(f.to); f.m.lookAt(room.localToWorld(f.to.clone().add(new THREE.Vector3(0.02, 0.06, 1))));
    game = play(game, f.hit);
    if (game.over) pullAt = time + PULL;
    if (game.won && (!best || game.darts < best)) { best = game.darts; try { localStorage.setItem(BEST, String(best)); } catch {} }
    chalk.redraw();
    const word = game.won ? 'Checkout!' : game.bust ? 'Bust!' : f.hit.points === 0 ? 'Miss' : f.hit.label === 'Bull' || f.hit.label === '25' ? f.hit.label : `${f.hit.label} · ${f.hit.points}`;
    call.material.map.redraw(word, game.won ? '#ffe14f' : game.bust ? '#ff6b6b' : FLIGHTS[f.i]);
    call.userData = { at: time, y: f.to.y + 0.16 }; call.position.set(f.to.x, f.to.y + 0.16, f.to.z + 0.1); call.material.opacity = 1; call.visible = true;
  }
  return darts;
}
