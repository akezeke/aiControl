// Slacking off, now and then: someone at a working or idle desk leans back while their monitor plays something silly (a cat
// video, a won game of solitaire, a fish tank, a little runner game). When the boss comes close, or around behind them where
// the screen shows, it's back to the terminal and they type away, sitting up straight. With reduced motion the show is a still.
// Drawn on the desk's own screen canvas, so there are no video files to decode or license.
// While someone's at the boss's computer (boss.js) the whole floor slacks: every idle desk within a few seconds, the working
// ones with their feet up. When the boss gets up, whoever faces the boss's chair is caught at once; the rest carry on a while.
import * as THREE from 'three';
import { CHAIR } from './boss-plan.js';

const W = 432, H = 256; // the screen canvas, as drawScreen in room.js sees it
const FIRST = [15, 30], GAP = [20, 40], LENGTH = [20, 40], CALM = 120, BUSTED = 3; // seconds; CALM: a caught desk behaves this long
const HEARD = 1.5, SEEN = 3.5, FPS = 12; // metres: anywhere this near, or this near on the side the screen faces
const NOTICE = 2; // seconds the boss can watch before they notice (wary halfway, it shows on their face)
const ALL_IN = 4, MAX_DRAWS = 3; // seconds: the floor's all at it this soon after the boss sits; screens redrawn a frame, at most
const SLACKERS = new Set(['dark']); // the screen tones (status.js) of desks that may slack: idle only, so a working desk always shows its output
const SUITS = ['♥', '♠', '♦', '♣'], INK = '#1b1a1f';
const FISH = [[70, 60, 22, '#ff8c42'], [118, 45, 15, '#ffd23f'], [160, 75, 26, '#ff5d73'], [196, 35, 13, '#9b5de5']]; // y, speed, size, colour
const WEED = [[60, 110], [86, 78], [340, 124], [372, 88]]; // x, height
const rand = ([a, b]) => a + Math.random() * (b - a);

// Each show draws one frame at time t (seconds into the episode); s is the episode's own state.
const shows = [
  // A cat video: the cat bats at a ball of yarn on a string while the progress bar creeps along.
  (g, t, s) => {
    s.from ??= 20 + Math.random() * 120;
    const swing = Math.sin(t * 2.4), a = swing * 0.6, bx = 320 + Math.sin(a) * 110, by = 10 + Math.cos(a) * 110, swat = Math.max(0, -swing) ** 3;
    g.fillStyle = '#101114'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2e6d0'; g.fillRect(14, 10, W - 28, 190); g.fillStyle = '#d4b48a'; g.fillRect(14, 168, W - 28, 32);
    g.strokeStyle = '#555a66'; g.lineWidth = 2; g.beginPath(); g.moveTo(320, 10); g.lineTo(bx, by); g.stroke();
    g.fillStyle = '#e04f5f'; g.beginPath(); g.arc(bx, by, 14, 0, 7); g.fill();
    g.strokeStyle = '#b8323f'; g.beginPath(); g.arc(bx - 4, by, 10, -1, 1.2); g.stroke();
    g.strokeStyle = g.fillStyle = '#e8964a'; g.lineCap = 'round';
    g.lineWidth = 9; g.beginPath(); g.moveTo(150, 178); g.quadraticCurveTo(108, 160 + Math.sin(t * 3) * 14, 118, 122 + Math.sin(t * 3 + 1) * 10); g.stroke();
    g.beginPath(); g.ellipse(185, 158, 42, 34, 0, 0, 7); g.fill();
    g.lineWidth = 12; g.beginPath(); g.moveTo(222, 145); g.lineTo(226 + swat * 28, 142 - swat * 40); g.stroke();
    g.beginPath(); g.arc(212, 108, 28, 0, 7); g.fill();
    for (const x of [-1, 1]) { g.beginPath(); g.moveTo(212 + x * 24, 96); g.lineTo(212 + x * 20, 70); g.lineTo(212 + x * 6, 84); g.fill(); }
    const look = Math.atan2(by - 104, bx - 212); g.fillStyle = INK;
    for (const x of [-10, 10]) { g.beginPath(); g.arc(212 + x + Math.cos(look) * 3, 104 + Math.sin(look) * 3, 4, 0, 7); g.fill(); }
    const done = (s.from + t) / 187 % 1, sec = Math.floor(done * 187);
    g.fillStyle = '#3a3d46'; g.fillRect(14, 222, W - 28, 5); g.fillStyle = '#ff3b3b'; g.fillRect(14, 222, (W - 28) * done, 5);
    g.beginPath(); g.arc(14 + (W - 28) * done, 224.5, 7, 0, 7); g.fill();
    g.fillStyle = '#c9cfdb'; g.font = '15px ui-monospace, monospace'; g.textBaseline = 'alphabetic'; g.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} / 3:07`, 14, 250);
  },
  // Solitaire, won: cards leap off the piles and bounce along the felt, leaving trails (the felt is only cleared for a new round).
  (g, t, s, dt) => {
    if (!s.card || s.dealt > 28) { g.fillStyle = '#1f7a3e'; g.fillRect(0, 0, W, H); for (let i = 0; i < 4; i++) card(g, 196 + i * 56, 12, i); s.dealt = 0; s.card = null; }
    if (!s.card || s.card.x < -40 || s.card.x > W) {
      const pile = s.dealt++ % 4;
      s.card = { x: 196 + pile * 56, y: 12, vx: (Math.random() < 0.7 ? -1 : 1) * (70 + Math.random() * 110), vy: -Math.random() * 120, suit: pile };
    }
    const c = s.card;
    for (let left = dt; left > 0; left -= 1 / 60) {
      const step = Math.min(left, 1 / 60); c.vy += 900 * step; c.x += c.vx * step; c.y += c.vy * step;
      if (c.y > H - 50) { c.y = H - 50; c.vy *= -0.78; }
    }
    card(g, c.x, c.y, c.suit);
  },
  // A fish tank: fish drift by, the weed sways, bubbles rise.
  (g, t) => {
    const water = g.createLinearGradient(0, 0, 0, H); water.addColorStop(0, '#3fa7e0'); water.addColorStop(1, '#0f4c81');
    g.fillStyle = water; g.fillRect(0, 0, W, H); g.fillStyle = '#e3c88f'; g.fillRect(0, H - 26, W, 26);
    g.strokeStyle = '#3d9c4a'; g.lineWidth = 6; g.lineCap = 'round';
    for (const [x, h] of WEED) { g.beginPath(); g.moveTo(x, H - 22); g.quadraticCurveTo(x + Math.sin(t * 1.3 + x) * 18, H - 22 - h * 0.6, x + Math.sin(t * 1.3 + x + 1) * 10, H - 22 - h); g.stroke(); }
    FISH.forEach(([y, speed, size, color], i) => {
      const dir = i % 2 ? -1 : 1, run = (t * speed + i * 97) % (W + 120), x = dir > 0 ? run - 60 : W + 60 - run, at = y + Math.sin(t * 1.7 + i) * 8;
      g.fillStyle = color; g.beginPath(); g.ellipse(x, at, size, size * 0.6, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(x - dir * size * 0.8, at); g.lineTo(x - dir * size * 1.6, at - size * 0.55); g.lineTo(x - dir * size * 1.6, at + size * 0.55); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(x + dir * size * 0.5, at - size * 0.12, size * 0.12, 0, 7); g.fill();
    });
    g.strokeStyle = '#d8f1ff'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(120 + i * 40 + Math.sin(t * 3 + i) * 5, H - 30 - (t * 45 + i * 41) % (H - 30), 3 + i % 3, 0, 7); g.stroke(); }
  },
  // A little runner game: the runner hops each crate as it comes, the score ticking up.
  (g, t) => {
    const speed = 160, gap = 200, first = Math.max(0, Math.ceil((t * speed - W - 30) / gap));
    g.fillStyle = '#9ad7f5'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(W + 60 - (t * 20 + i * 170) % (W + 120), 40 + i * 22, 30, 10, 0, 0, 7); g.fill(); }
    g.fillStyle = '#5cb85c'; g.fillRect(0, 200, W, 8); g.fillStyle = '#7a5530'; g.fillRect(0, 208, W, H - 208);
    g.fillStyle = '#b5651d'; for (let i = first; i < first + 4; i++) g.fillRect(W + i * gap - t * speed, 172, 24, 28);
    // Mid-hop as the nearest crate passes under (a crate is level with the runner when it is at x = 72).
    const next = Math.round((t * speed - W + 72) / gap), u = (t - (W + next * gap - 72) / speed) / 0.6 + 0.5, hop = next >= 0 && u > 0 && u < 1 ? 256 * u * (1 - u) : 0;
    g.fillStyle = '#e63946'; g.fillRect(70, 172 - hop, 28, 28); g.fillStyle = '#ffffff'; g.fillRect(86, 178 - hop, 8, 8); g.fillStyle = INK; g.fillRect(90, 180 - hop, 4, 4);
    g.font = 'bold 18px ui-monospace, monospace'; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(String(Math.floor(t * 12)).padStart(5, '0'), W - 14, 12);
  },
];

function card(g, x, y, suit) {
  g.fillStyle = '#ffffff'; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x, y, 36, 50, 4); g.fill(); g.stroke();
  g.fillStyle = suit % 2 ? INK : '#d62828'; g.font = 'bold 22px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(SUITS[suit], x + 18, y + 26);
}

// Whether a desk's sitter faces `at` ({ x, z }, world): their facing (the desk's +z) within about 70° of the way from the chair to it.
const chairAt = new THREE.Vector3(), facing = new THREE.Vector3();
export function facesToward(desk, at) {
  desk.chair.getWorldPosition(chairAt); desk.group.getWorldDirection(facing);
  const dx = at.x - chairAt.x, dz = at.z - chairAt.z, d = Math.hypot(dx, dz);
  return d > 0 && (facing.x * dx + facing.z * dz) > d * 0.3;
}

// Each desk carries `slack`: { show (playing), wary (they sense the boss), busted (seconds of eager typing left), calm (seconds
// before it can slack again), feet (up on the desk: a working sitter while the boss is away) }; animation.js reads it for the
// sitter. `terminal(desk)` puts the session's own screen back.
// An episode is one desk's show: `delay` before it starts (the boss just sat down), `t` into it, `left` to run, `noticed`
// (0..1, caught at 1). One at a time with the boss about; any number while they're away, the screens shared out MAX_DRAWS a
// frame from where the last frame left off, and only those `seen`.
export function createSlacking(terminal) {
  let wait = rand(FIRST), away = null, start = 0;
  const episodes = new Map(), at = new THREE.Vector3(), to = new THREE.Vector3();
  // Near enough to hear, or around behind them, on the side the screen faces (back toward the chair: -z in the desk's frame).
  const spotted = (desk, eye, margin = 1) => {
    desk.screen.getWorldPosition(at); to.copy(eye).sub(at);
    const distance = to.length(), r = desk.group.rotation.y;
    return distance < HEARD * margin || (distance < SEEN * margin && -(to.x * Math.sin(r) + to.z * Math.cos(r)) > distance * 0.3);
  };
  const begin = (desk, delay) => {
    const episode = { desk, t: 3, drawn: 0, frameIn: 0, noticed: 0, left: rand(LENGTH), state: {}, delay, show: shows[Math.floor(Math.random() * shows.length)] }; // a few seconds in, everything is on screen
    episodes.set(desk, episode); if (delay <= 0) desk.slack.show = episode.show;
  };
  const stop = (episode, caught) => {
    const { desk } = episode; episodes.delete(desk); desk.slack.show = null; desk.slack.wary = false;
    if (caught) { desk.slack.busted = BUSTED; desk.slack.calm = CALM; }
    terminal(desk);
  };
  const draw = (episode, still, seen) => {
    const { desk } = episode;
    if (episode.delay > 0 || episode.frameIn > 0 || (still && episode.drawn) || !seen(desk)) return false;
    const g = desk.screenTexture.image.getContext('2d');
    g.save(); g.setTransform(g.canvas.width / W, 0, 0, g.canvas.height / H, 0, 0);
    desk.slack.show(g, episode.t, episode.state, episode.t - episode.drawn); g.restore();
    desk.screenTexture.needsUpdate = true; episode.drawn = episode.t; episode.frameIn = 1 / FPS;
    return true;
  };
  return {
    // `boss`: 'you' or 'friend' while someone's at the boss's computer, else null. Seated yourself you can't catch anyone.
    update(dt, eye, still, desks, boss = null, seen = () => true) {
      dt = Math.max(0, dt); // the first frame's dt can be negative (its timestamp predates the loop starting)
      for (const desk of desks) { const { slack } = desk; slack.busted = Math.max(0, slack.busted - dt); slack.calm = Math.max(0, slack.calm - dt); slack.feet = !!boss && desk.glow === 'green'; }
      if (boss) {
        // Everyone at it, a few seconds apart; with a friend in the chair, not right under your nose.
        for (const desk of desks) if (SLACKERS.has(desk.glow) && !desk.slack.calm && desk.group.parent && !episodes.has(desk) && (boss === 'you' || !spotted(desk, eye, 1.6))) begin(desk, Math.random() * ALL_IN);
      } else if (away) {
        // The boss is up: whoever faces their chair is caught; the rest have a while yet, and those yet to start never do.
        for (const episode of episodes.values()) {
          if (episode.delay > 0) stop(episode, false);
          else if (facesToward(episode.desk, CHAIR)) stop(episode, true);
          else episode.left = rand(LENGTH);
        }
      }
      away = boss;
      for (const episode of episodes.values()) {
        const { desk } = episode;
        if (!SLACKERS.has(desk.glow) || !desk.group.parent) { stop(episode, false); continue; }
        if (episode.delay > 0) { if ((episode.delay -= dt) > 0) continue; desk.slack.show = episode.show; }
        if (!boss && (episode.left -= dt) <= 0) { stop(episode, false); continue; }
        episode.noticed = boss === 'you' ? 0 : Math.max(0, episode.noticed + (spotted(desk, eye) ? dt : -dt) / NOTICE);
        if (episode.noticed >= 1) { stop(episode, true); continue; }
        desk.slack.wary = episode.noticed > 0.5; episode.frameIn -= dt;
      }
      if (!boss && !episodes.size && (wait -= dt) <= 0) {
        wait = rand(GAP);
        // Not under the boss's nose: that would be over before it started.
        const ready = desks.filter(desk => SLACKERS.has(desk.glow) && !desk.slack.calm && desk.group.parent && !spotted(desk, eye, 1.6));
        const desk = ready[Math.floor(Math.random() * ready.length)]; if (desk) begin(desk, 0);
      }
      // Redraws, at most MAX_DRAWS, starting after the last one drawn last frame so every screen gets its turn.
      let drawn = 0, k = 0, next = start;
      for (const episode of episodes.values()) { if (k >= start && drawn < MAX_DRAWS && draw(episode, still, seen)) { drawn++; next = k + 1; } k++; }
      k = 0; for (const episode of episodes.values()) { if (k >= start || drawn >= MAX_DRAWS) break; if (draw(episode, still, seen)) { drawn++; next = k + 1; } k++; }
      start = episodes.size ? next % episodes.size : 0;
      if (!still) for (const episode of episodes.values()) if (episode.delay <= 0) episode.t += dt;
    },
  };
}
