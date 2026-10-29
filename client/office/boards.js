// What's written on the walls: usage limits and any agent the server can't reach on the whiteboard, the real time on the clock,
// a sticky note per waiting session, the machine's name on the door, and a sign on the coffee machine while usage is used up.
// Each is a canvas texture redrawn only when what it shows changes.
import * as THREE from 'three';
import { usageWindowView } from '../usage-presentation.js';

const MARKER = "'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', cursive";
const INK = { black: '#23262e', blue: '#2b59c3', red: '#d7263d', green: '#1f9d55' };

function paint(face, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  face.material.map = texture; face.material.color.set('#ffffff'); face.material.needsUpdate = true;
  return { g: canvas.getContext('2d'), width, height, texture };
}
// A slightly wobbly hand-drawn line.
function scribble(g, x1, y1, x2, y2, seed = 1) {
  g.beginPath(); g.moveTo(x1, y1);
  for (let i = 1; i <= 6; i++) { const t = i / 6; g.lineTo(x1 + (x2 - x1) * t + Math.sin(seed * 9.1 + i) * 1.5, y1 + (y2 - y1) * t + Math.cos(seed * 7.3 + i) * 1.5); }
  g.stroke();
}

// Cut `text` with an ellipsis to fit `width` in the current font.
function fit(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  while (text && g.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}

function drawWhiteboard({ g, width: w, height: h }, usage, providers, error, now) {
  g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = INK.blue; g.font = `bold 52px ${MARKER}`; g.fillText('Usage', 40, 70);
  g.strokeStyle = INK.blue; g.lineWidth = 4; scribble(g, 40, 84, 200, 86);
  if (error) {
    g.fillStyle = INK.red; g.font = `bold 64px ${MARKER}`; g.save(); g.translate(w / 2, h / 2 + 20); g.rotate(-0.08); g.textAlign = 'center'; g.fillText('connection lost', 0, 0); g.restore();
    return;
  }
  // Agents the server can't reach, at the foot of the board: who in red, why underneath (the server's detail, less its "X disconnected:").
  const offline = (providers || []).filter(provider => !provider.connected).slice(0, 2);
  offline.forEach((provider, i) => {
    const y = h - 30 - (offline.length - 1 - i) * 76;
    g.fillStyle = INK.red; g.font = `bold 36px ${MARKER}`; g.fillText(`${provider.name} offline`, 40, y - 34);
    g.fillStyle = INK.black; g.font = `26px ${MARKER}`; g.fillText(fit(g, String(provider.detail || '').replace(/^[^:]*disconnected:\s*/i, ''), w - 80), 40, y);
  });
  const accounts = (usage || []).filter(account => account.windows?.length), space = h - 120 - offline.length * 76;
  if (!accounts.length) { g.fillStyle = INK.black; g.font = `36px ${MARKER}`; g.fillText('no usage data yet', 40, 160); return; }
  // Two accounts fill the board; more (e.g. several Claude accounts) write smaller.
  const k = Math.min(1, space / (accounts.length * 182));
  let y = 110 + 40 * k, slow = false;
  accounts.forEach((account, a) => {
    g.fillStyle = INK.black; g.font = `bold ${46 * k}px ${MARKER}`; g.fillText(account.name || account.provider, 40, y);
    y += 58 * k;
    for (const window of account.windows.slice(0, 2)) {
      const view = usageWindowView(window, now), x = 120, barW = w - x - 210, filled = barW * view.barPercent / 100;
      g.fillStyle = INK.black; g.font = `${36 * k}px ${MARKER}`; g.fillText(view.shortLabel, x - 66, y);
      // Bar: an outline with a hatched fill, red once it's high.
      const color = view.tone ? INK.red : INK.green;
      g.strokeStyle = INK.black; g.lineWidth = 4; g.strokeRect(x, y - 30 * k, barW, 36 * k);
      g.save(); g.beginPath(); g.rect(x, y - 30 * k, filled, 36 * k); g.clip(); g.strokeStyle = color; g.lineWidth = 6;
      for (let i = -36; i < filled + 36; i += 13) scribble(g, x + i, y + 6 * k, x + i + 28, y - 30 * k, i + a);
      g.restore();
      g.fillStyle = color; g.font = `bold ${40 * k}px ${MARKER}`; g.fillText(view.percentText, x + barW + 18, y + 4 * k);
      if (view.pace > 100) slow = true;
      y += 52 * k;
    }
    y += 20 * k;
  });
  if (slow) { g.save(); g.translate(w - 230, 70); g.rotate(-0.12); g.fillStyle = INK.red; g.font = `bold 46px ${MARKER}`; g.fillText('slow down!', 0, 0); g.restore(); }
}

// Accounts with a usage window used up, each with when it's back (the last of its full windows to reset).
export function usedUp(usage, now = Date.now()) {
  return (usage || []).flatMap(account => {
    const full = (account.windows || []).filter(window => window.usedPercent >= 100 && !usageWindowView(window, now).expired);
    if (!full.length) return [];
    const last = full.reduce((a, b) => (b.resetsAt || 0) > (a.resetsAt || 0) ? b : a), short = usageWindowView(last, now).resetShortText;
    return [{ provider: account.provider, back: short === '—' ? 'back soon' : short.includes(':') ? `back ${short}` : `back in ${short}` }];
  });
}

// The coffee machine's sign: EMPTY, then the agent's mark and when it's back, one line each.
function drawSign({ g, width: w, height: h }, empty) {
  g.fillStyle = '#fffdf5'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8e2c8bb'; g.fillRect(-10, 6, 70, 22); g.fillRect(w - 60, 6, 70, 22);
  g.lineCap = 'round'; g.fillStyle = INK.red; g.strokeStyle = INK.red; g.lineWidth = 5; g.textAlign = 'center';
  g.font = `bold 62px ${MARKER}`; g.fillText('EMPTY', w / 2, 86); scribble(g, 34, 98, w - 34, 96);
  empty.slice(0, 2).forEach(({ provider, back }, i) => {
    const y = 140 + i * 44 - (empty.length > 1 ? 10 : 0);
    g.textAlign = 'left'; g.font = `bold 34px ${MARKER}`;
    g.fillStyle = provider === 'claude' ? '#d97757' : INK.black; g.fillText(provider === 'claude' ? '✳' : provider === 'codex' ? '⌘' : '•', 24, y);
    g.fillStyle = INK.black; g.font = `32px ${MARKER}`; g.fillText(back, 66, y);
  });
  g.textAlign = 'left';
}

// The door's name plate: the machine the office is on, as large as fits.
function drawPlate({ g, width: w, height: h }, machine) {
  g.fillStyle = '#f4efe3'; g.fillRect(0, 0, w, h);
  g.fillStyle = INK.black; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let size = 64; ; size -= 4) { g.font = `bold ${size}px system-ui, sans-serif`; if (size <= 24 || g.measureText(machine).width <= w - 40) break; }
  g.fillText(fit(g, machine, w - 40), w / 2, h / 2 + 2);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

function drawClock({ g, width: w, height: h }, now) {
  const r = w / 2, date = new Date(now), hours = date.getHours() % 12 + date.getMinutes() / 60, minutes = date.getMinutes();
  g.fillStyle = '#fffdf7'; g.fillRect(0, 0, w, h);
  g.translate(r, r);
  g.strokeStyle = '#2f3542'; g.lineCap = 'round';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.lineWidth = i % 3 ? 4 : 8; g.beginPath(); g.moveTo(Math.sin(a) * r * 0.78, -Math.cos(a) * r * 0.78); g.lineTo(Math.sin(a) * r * 0.9, -Math.cos(a) * r * 0.9); g.stroke(); }
  const hand = (turns, length, width, color) => { const a = turns * Math.PI * 2; g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * length, -Math.cos(a) * length); g.stroke(); };
  hand(hours / 12, r * 0.5, 12, '#2f3542'); hand(minutes / 60, r * 0.72, 8, '#2f3542');
  g.fillStyle = '#e8574a'; g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill();
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function drawWaiting({ g, width: w, height: h }, titles) {
  g.fillStyle = '#c4935f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = i % 2 ? '#b07f4c' : '#d3a774'; g.fillRect((i * 97) % w, (i * 57) % h, 3, 3); }
  if (!titles.length) { g.fillStyle = '#fff8e1'; g.font = `bold 34px ${MARKER}`; g.textAlign = 'center'; g.fillText('nobody waiting ☺', w / 2, h / 2); g.textAlign = 'left'; return; }
  titles.slice(0, 6).forEach((title, i) => {
    const col = i % 3, row = Math.floor(i / 3), x = 24 + col * 168, y = 24 + row * 176, tilt = ((i * 37) % 7 - 3) / 60;
    g.save(); g.translate(x + 74, y + 74); g.rotate(tilt);
    g.fillStyle = '#00000022'; g.fillRect(-70, -66, 148, 148);
    g.fillStyle = '#ffe066'; g.fillRect(-74, -74, 148, 148);
    g.fillStyle = '#e8574a'; g.beginPath(); g.arc(0, -62, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#23262e'; g.font = `bold 22px ${MARKER}`;
    // Up to four wrapped lines.
    const words = String(title).split(/\s+/), lines = []; let line = '';
    for (const word of words) { const next = line ? `${line} ${word}` : word; if (g.measureText(next).width > 128 && line) { lines.push(line); line = word; } else line = next; }
    lines.push(line);
    lines.slice(0, 4).forEach((text, n) => g.fillText(n === 3 && lines.length > 4 ? `${text.slice(0, 8)}…` : text, -64, -30 + n * 26));
    g.restore();
  });
}

export function createBoards(room) {
  let boards = null, faces = null, usageKey = '', waitingKey = '', plateKey = null, minute = -1;
  const ensure = () => {
    // The room rebuilds its walls (and so its boards) when it resizes; repaint onto the new faces.
    if (faces === room.boards.whiteboard) return;
    faces = room.boards.whiteboard;
    boards = { whiteboard: paint(room.boards.whiteboard, 1024, 512), clock: paint(room.boards.clock, 256, 256), waiting: paint(room.boards.waiting, 528, 384), plate: paint(room.boards.plate, 512, 112), sign: paint(room.coffeeSign.userData.face, 256, 192) };
    usageKey = waitingKey = ''; plateKey = null; minute = -1;
  };
  return {
    sync(snapshot, { error = '', waiting = [] } = {}) {
      ensure();
      const now = Date.now(), nextUsage = JSON.stringify([snapshot.usage, snapshot.providers, !!error, Math.floor(now / 60_000)]);
      if (nextUsage !== usageKey) {
        usageKey = nextUsage; drawWhiteboard(boards.whiteboard, snapshot.usage, snapshot.providers, error, now); boards.whiteboard.texture.needsUpdate = true;
        const empty = usedUp(snapshot.usage, now); room.coffeeSign.visible = empty.length > 0;
        if (empty.length) { drawSign(boards.sign, empty); boards.sign.texture.needsUpdate = true; }
      }
      const machine = snapshot.machine || '';
      if (machine !== plateKey) { plateKey = machine; drawPlate(boards.plate, machine); boards.plate.texture.needsUpdate = true; }
      const nextWaiting = JSON.stringify(waiting);
      if (nextWaiting !== waitingKey) { waitingKey = nextWaiting; drawWaiting(boards.waiting, waiting); boards.waiting.texture.needsUpdate = true; }
    },
    tick(now = Date.now()) {
      if (!boards) return;
      const m = Math.floor(now / 60_000);
      if (m !== minute) { minute = m; drawClock(boards.clock, now); boards.clock.texture.needsUpdate = true; }
    },
    dispose() { if (boards) for (const board of Object.values(boards)) board.texture.dispose(); },
  };
}
