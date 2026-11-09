// What's written on the walls: usage limits and any agent the server can't reach on the whiteboard, the real time on the clock,
// a sticky note per waiting session, the machine's name on the door, and a sign on the coffee machine while usage is used up.
// Each is a canvas texture redrawn only when what it shows changes. And the kitchen's: Trickshot's clipboard and score board.
import * as THREE from 'three';
import { usageWindowView, spendView } from '../usage-presentation.js';
import { PLACES, aimAt, bestText, capital, challenges, dayKey, itemName, num, randomShot } from './daily.js';
import { SPOTS, ZONES } from './kitchen-plan.js';
import { MONDAY } from './levels.js';
import { dims } from './lights.js';

const MARKER = "'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', cursive";
const SHARPIE = "'Permanent Marker', 'Marker Felt', 'Comic Neue', cursive";
const INK = { black: '#23262e', blue: '#2b59c3', red: '#d7263d', green: '#1f9d55' };

// `scale`: texture pixels per drawing unit.
function paint(face, width, height, scale = 1) {
  const canvas = document.createElement('canvas'); canvas.width = width * scale; canvas.height = height * scale;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  face.material.map = texture; face.material.color.set('#ffffff'); face.material.needsUpdate = true;
  const g = canvas.getContext('2d'); g.scale(scale, scale);
  return { g, width, height, texture };
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

// What an account writes on the board: a row per limit window, or for OpenCode one row for its spend against the budget (no bar without one).
function boardRows(account, now) {
  const spend = spendView(account, now);
  if (spend) {
    const word = spend.unit === 'month' ? 'mo' : 'wk', tone = spend.over ? 'usage-full' : spend.near ? 'usage-high' : '';
    return [{ bare: spend.limit == null, view: { shortLabel: word, barPercent: Math.min(100, spend.usedPercent ?? 0), tone, pace: null, percentText: spend.limit ? `${Math.round(spend.usedPercent)}%` : spend.money(spend.spent) },
      note: spend.limit ? spend.over ? 'over budget' : `${spend.money(spend.left)} left` : `this ${spend.unit}` }];
  }
  return account.windows.slice(0, 2).map(window => { const view = usageWindowView(window, now); return { view, note: view.expired ? 'reset due' : view.resetIn === '—' ? '' : `resets ${view.resetIn}` }; });
}

export function drawWhiteboard({ g, width: w, height: h }, usage, providers, error, now) {
  g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = INK.blue; g.font = `52px ${SHARPIE}`; g.fillText('Usage', 40, 70);
  g.strokeStyle = INK.blue; g.lineWidth = 4; scribble(g, 40, 84, 40 + g.measureText('Usage').width, 86);
  if (error) {
    g.fillStyle = INK.red; g.font = `64px ${SHARPIE}`; g.save(); g.translate(w / 2, h / 2 + 20); g.rotate(-0.08); g.textAlign = 'center'; g.fillText('connection lost', 0, 0); g.restore();
    return;
  }
  // Agents the server can't reach, at the foot of the board: who in red, why underneath (the server's detail, less its "X disconnected:").
  const offline = (providers || []).filter(provider => !provider.connected).slice(0, 2);
  offline.forEach((provider, i) => {
    const y = h - 30 - (offline.length - 1 - i) * 76;
    g.fillStyle = INK.red; g.font = `36px ${SHARPIE}`; g.fillText(`${provider.name} offline`, 40, y - 34);
    g.fillStyle = INK.black; g.font = `26px ${SHARPIE}`; g.fillText(fit(g, String(provider.detail || '').replace(/^[^:]*disconnected:\s*/i, ''), w - 80), 40, y);
  });
  const accounts = (usage || []).filter(account => account.windows?.length || spendView(account, now)), space = h - 120 - offline.length * 76;
  if (!accounts.length) { g.fillStyle = INK.black; g.font = `36px ${SHARPIE}`; g.fillText('no usage data yet', 40, 160); return; }
  // Two accounts fill the board; more (e.g. several Claude accounts) write smaller.
  const k = Math.min(1, space / (accounts.length * 182));
  let y = 110 + 40 * k, slow = false;
  accounts.forEach((account, a) => {
    g.fillStyle = INK.black; g.font = `${46 * k}px ${SHARPIE}`; g.fillText(account.name || account.provider, 40, y);
    y += 58 * k;
    for (const { view, note, bare } of boardRows(account, now)) {
      const x = 120, barW = w - x - 400, filled = barW * view.barPercent / 100;
      g.fillStyle = INK.black; g.font = `${36 * k}px ${SHARPIE}`; g.fillText(view.shortLabel, x - 66, y);
      // Bar: an outline with a hatched fill, red once it's high. OpenCode with no budget has nothing to fill, so it only writes its spend.
      const color = view.tone ? INK.red : INK.green;
      if (!bare) {
        g.strokeStyle = INK.black; g.lineWidth = 4; g.strokeRect(x, y - 30 * k, barW, 36 * k);
        g.save(); g.beginPath(); g.rect(x, y - 30 * k, filled, 36 * k); g.clip(); g.strokeStyle = color; g.lineWidth = 6;
        for (let i = -36; i < filled + 36; i += 13) scribble(g, x + i, y + 6 * k, x + i + 28, y - 30 * k, i + a);
        g.restore();
      }
      g.fillStyle = color; g.font = `${40 * k}px ${SHARPIE}`; g.fillText(view.percentText, bare ? x : x + barW + 14, y + 4 * k);
      // How long until this window resets, when that's known.
      g.fillStyle = INK.blue; g.font = `${30 * k}px ${SHARPIE}`; g.fillText(note, bare ? x + 190 : x + barW + 136, y + 2 * k);
      if (view.pace > 100) slow = true;
      y += 52 * k;
    }
    y += 20 * k;
  });
  if (slow) { g.save(); g.translate(w - 40, 66); g.rotate(-0.08); g.textAlign = 'right'; g.fillStyle = INK.red; g.font = `46px ${SHARPIE}`; g.fillText('slow down!', 0, 0); g.restore(); }
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

// Monday's page: each item, and under it its three lines. All three done, the item's crossed off too.
export const clipboardLines = progress => MONDAY.flatMap(({ id, item, target, trick, set }) => {
  const { away = false, trick: tricked = false, score = false } = progress.lines[id] ?? {};
  return [{ text: itemName(item), done: away && tricked && score, indent: 0 }, { text: ZONES[target].surface ? capital(aimAt(target)) : 'Put it away', done: away, indent: 1 }, { text: capital(trick.name), done: tricked, indent: 1 }, { text: `Score ${num(set)}`, done: score, indent: 1 }];
});
// Today's page: the three challenges and your best at each (null: not played).
export const dailyLines = (key, progress) => challenges(key).map(({ item, start, target }, i) => ({ text: `${itemName(item)}: ${PLACES[start]}${ZONES[target].surface ? ', ' : ' to '}${aimAt(target)}`, best: progress.daily[key]?.[i] ?? null }));

// `size` as far down as `text` needs to fit `width`.
function sized(g, text, size, width) { do g.font = `${size}px ${SHARPIE}`; while (g.measureText(text).width > width && (size -= 2) > 14); }

// Where the clipboard's pages are written, in the sheet's own units: its clip covers the top 46.
const SHEET = { w: 600, h: 808, left: 30 }, TODAY = { top: 130, tall: 200 };
export function drawClipboard({ g, width: w, height: h }, page, lines) {
  const { left } = SHEET, today = page === 'today', title = today ? 'Today' : 'Monday';
  g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = INK.blue; g.font = `46px ${SHARPIE}`; g.fillText(title, left, 94);
  g.strokeStyle = INK.blue; g.lineWidth = 3; scribble(g, left, 104, left + g.measureText(title).width, 106);
  if (today) {
    lines.forEach(({ text, best }, i) => {
      const y = TODAY.top + i * TODAY.tall, right = w - left;
      g.strokeStyle = INK.black; g.lineWidth = 3; g.strokeRect(left - 8, y + 8, right - left + 16, TODAY.tall - 22);
      g.fillStyle = INK.black; sized(g, text, 36, right - left - 12); g.fillText(text, left + 6, y + 68);
      g.fillStyle = best > 0 ? INK.green : INK.black; g.font = `44px ${SHARPIE}`; g.fillText(`Best ${bestText(best)}`, left + 6, y + 138);
    });
    return;
  }
  let y = 134;
  lines.forEach(({ text, done, indent }, i) => {
    if (!indent && i) y += 5;
    const x = left + indent * 26;
    g.fillStyle = done ? '#8b8f98' : indent ? INK.black : INK.blue; g.font = `${indent ? 23 : 29}px ${SHARPIE}`; g.fillText(text, x, y);
    if (done) { g.strokeStyle = INK.red; g.lineWidth = 2; scribble(g, x - 4, y - 8, x + g.measureText(text).width + 4, y - 7, i); }
    y += indent ? 26 : 29;
  });
}

// The score board: each item's best down the left, today's three down the right; under each, Office online's leader
// (`tops`, online.js's top('trickshot')[0] and top('trickshotToday')[0]).
export function drawScores({ g, width: w, height: h }, progress, key, tops = {}) {
  const mid = 440, heading = (text, x) => { g.fillStyle = INK.blue; g.font = `52px ${SHARPIE}`; g.fillText(text, x, 72); g.strokeStyle = INK.blue; g.lineWidth = 4; scribble(g, x, 84, x + g.measureText(text).width, 86); };
  g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  heading('Best', 36); heading('Today', mid + 40);
  g.strokeStyle = '#c0c4cc'; g.lineWidth = 3; scribble(g, mid, 30, mid, h - 30);
  const best = (score, right, y) => { g.fillStyle = score > 0 ? INK.green : INK.black; g.textAlign = 'right'; g.font = `38px ${SHARPIE}`; g.fillText(bestText(score), right, y); g.textAlign = 'left'; };
  MONDAY.forEach(({ id, item }, i) => { const y = 148 + i * 70; g.fillStyle = INK.black; g.font = `38px ${SHARPIE}`; g.fillText(itemName(item), 36, y); best(progress.best[id], mid - 28, y); });
  dailyLines(key, progress).forEach(({ text, best: score }, i) => { const y = 148 + i * 140; g.fillStyle = INK.black; sized(g, text, 34, w - 36 - mid - 40); g.fillText(text, mid + 40, y); best(score, w - 36, y + 52); });
  const top = (leader, x, width) => { if (!leader) return; const text = `Top: ${leader.name} ${leader.text}`; g.fillStyle = INK.blue; sized(g, text, 30, width); g.fillText(text, x, h - 24); };
  top(tops.trickshot, 36, mid - 72); top(tops.trickshotToday, mid + 40, w - 76 - mid);
}

// The visitors' clipboard by the door (Office online): who's signed in to the hub, you first, then whoever was in last.
// `closed`: what to write across it when the hub can't be reached or its code was replaced.
export function visitorLines(state) {
  if (!state?.joined) return { title: 'Visitors', lines: ['Sign in here'], closed: null };
  const host = /^\d+(\.\d+){3}$/.test(state.host) ? state.host : state.host.split('.')[0], me = state.name.toLowerCase(), players = state.board?.players ?? [];
  const mine = players.find(p => p.name.toLowerCase() === me)?.name ?? state.name;
  const others = players.filter(p => p.name.toLowerCase() !== me).sort((a, b) => b.seen - a.seen).map(p => p.name);
  return { title: `Visitors · ${host}`, lines: [mine, ...others].slice(0, 6), closed: state.error === 'code' ? 'Code replaced' : state.offline ? 'Hub closed' : null };
}
export function drawVisitors({ g, width: w, height: h }, { title, lines, closed }) {
  g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h); g.lineCap = 'round'; g.lineJoin = 'round'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  // Big enough to read from a step away: it's a clipboard, not a board.
  g.fillStyle = INK.blue; sized(g, title, 76, w - 60); g.fillText(title, 30, 96);
  g.strokeStyle = INK.blue; g.lineWidth = 5; scribble(g, 30, 114, 30 + g.measureText(title).width, 116);
  g.strokeStyle = '#c9d6ea'; g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { const y = 216 + i * 76; g.beginPath(); g.moveTo(24, y); g.lineTo(w - 24, y); g.stroke(); }
  g.fillStyle = closed ? '#8a8f99' : INK.black;
  lines.forEach((line, i) => { sized(g, line, 60, w - 70); g.fillText(line, 36, 202 + i * 76); });
  if (!closed) return;
  g.save(); g.translate(w / 2, h - 110); g.rotate(-0.14); g.textAlign = 'center'; g.fillStyle = INK.red; sized(g, closed, 84, w - 50); g.fillText(closed, 0, 0); g.restore();
}

// The controls beside the clipboard, on one small sheet: name, colour. A page's tab is yellow when it's that page.
const TABS = [['Monday', '#e6e0cc'], ['Today', '#e6e0cc'], ['Random shot', '#bfe3c0'], ['Copy', '#cfe0ff']], TAB = { w: 0.15, h: 0.05, cell: [256, 85] };
function drawTabs({ g, width: w }, page) {
  const tall = TAB.cell[1];
  g.textBaseline = 'middle';
  TABS.forEach(([text, color], i) => {
    g.fillStyle = text.toLowerCase() === page ? '#ffe066' : color; g.fillRect(0, i * tall, w, tall);
    g.strokeStyle = INK.black; g.lineWidth = 4; g.strokeRect(2, i * tall + 2, w - 4, tall - 4);
    g.fillStyle = INK.black; sized(g, text, 40, w - 24); g.textAlign = 'center'; g.fillText(text, w / 2, i * tall + tall / 2 + 2);
  });
}

// To the clipboard, or `refused` where it can't go: plain HTTP has no clipboard, and a browser may say no.
export const copyText = (text, done, refused, clipboard = globalThis.navigator?.clipboard) => clipboard?.writeText ? clipboard.writeText(text).then(done, () => refused(text)) : refused(text);

// The kitchen's two boards, built with the kitchen (kitchen.add, games' way): their pictures are drawn in that slice, and go up ahead of the doors with its other textures.
// Hidden they do nothing; shown, a frame only compares two numbers. Read like the office's boards, close enough up for the clipboard's hand.
const DAY_MS = 86400000, DIMMED_TO = 0.5, today = () => Math.floor(Date.now() / DAY_MS), PAPER = { w: 0.26, h: 0.35, y: -0.005, z: 0.0165 };
const hung = ({ x, y, z }, turn) => { const board = new THREE.Group(); board.position.set(x, y, z); board.rotation.y = turn; board.userData.board = true; return board; };
const surface = (w, h, x, y, z, material = dims(new THREE.MeshBasicMaterial({ color: '#ffffff' }), DIMMED_TO)) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material); mesh.position.set(x, y, z); return mesh; };
// `inReach`: a hit's point is close enough to start a level; from further off a click `read`s the clipboard, as one on the rest of it does.
export function createKitchenBoards(game, { inReach = () => true, read = () => {}, online } = {}) {
  let page = 'monday', sheet = null, scores = null, tabs = null, saved = 0, day = 0;
  const onToday = [];
  const writePage = () => { const key = dayKey(new Date()); drawClipboard(sheet, page, page === 'today' ? dailyLines(key, game.progress) : clipboardLines(game.progress)); sheet.texture.needsUpdate = true; };
  const writeTabs = () => { drawTabs(tabs, page); tabs.texture.needsUpdate = true; };
  const write = () => { saved = game.saved; day = today(); writePage(); drawScores(scores, game.progress, dayKey(new Date()), { trickshot: online?.top('trickshot')[0], trickshotToday: online?.top('trickshotToday')[0] }); scores.texture.needsUpdate = true; };
  online?.watch(() => { if (scores) write(); });
  const turnTo = next => { page = next; for (const node of onToday) node.visible = page === 'today'; writePage(); writeTabs(); };
  return {
    build(room) {
      const { w, h, x, y, z } = SPOTS.clipboard, clip = hung({ x, y, z }, -Math.PI / 2), hidden = new THREE.MeshBasicMaterial({ visible: false });
      const paper = surface(PAPER.w, PAPER.h, 0, PAPER.y, PAPER.z), wall = hung(SPOTS.scores, Math.PI), face = surface(SPOTS.scores.w, SPOTS.scores.h, 0, 0, 0.002);
      sheet = paint(paper, SHEET.w, SHEET.h); scores = paint(face, 1024, 585);
      // A control: a small mesh, clicked or E'd, never thrown at. `name`d for what it does.
      const control = (name, mesh, act) => { mesh.name = name; mesh.userData.toggle = act; mesh.userData.dropsHeld = true; clip.add(mesh); return mesh; };
      const starts = entry => point => { if (inReach(point)) game.start(entry()); else read(clip); };
      // Over the whole clipboard, clip and all, so nothing of it stops a click from reading it.
      clip.add(paper, surface(w, h, 0, 0, 0.026, hidden));
      const tabFace = dims(new THREE.MeshBasicMaterial({ color: '#ffffff' }), DIMMED_TO);
      tabs = paint({ material: tabFace }, TAB.cell[0], TAB.cell[1] * TABS.length);
      const acts = [() => turnTo('monday'), () => turnTo('today'), starts(() => randomShot(Math.random())), () => game.copy()], heights = [0.15, 0.09, -0.03, -0.09];
      TABS.forEach(([name], i) => {
        const tab = surface(TAB.w, TAB.h, w / 2 + 0.015 + TAB.w / 2, heights[i], 0.012, tabFace), uv = tab.geometry.attributes.uv;
        for (let n = 0; n < uv.count; n++) uv.setY(n, 1 - (i + 1 - uv.getY(n)) / TABS.length);
        control(name, tab, acts[i]); if (i > 1) { onToday.push(tab); tab.visible = false; }
      });
      // Today's challenges: over each one's box on the sheet.
      [0, 1, 2].forEach(i => {
        const entry = control(`daily-${i}`, surface(PAPER.w, TODAY.tall / SHEET.h * PAPER.h, 0, PAPER.y + (0.5 - (TODAY.top + (i + 0.5) * TODAY.tall) / SHEET.h) * PAPER.h, 0.027, hidden), starts(() => game.entry(`daily-${i}`)));
        onToday.push(entry); entry.visible = false;
      });
      clip.userData.near = 0.45; // it's small
      wall.add(face); room.add(clip, wall);
      write(); writeTabs();
      // In a fallback hand until the font's in.
      const font = "40px 'Permanent Marker'";
      if (document.fonts?.check?.(font) === false) document.fonts.load(font).then(() => { write(); writeTabs(); }).catch(() => {});
    },
    update(dt, at, still, shown) { if (shown && (game.saved !== saved || today() !== day)) write(); },
  };
}

export function createBoards(room) {
  let boards = null, faces = null, usageKey = '', waitingKey = '', plateKey = null, minute = -1, written = null, visitors = null, visitorsKey = '';
  const writeUsage = () => { drawWhiteboard(boards.whiteboard, ...written); boards.whiteboard.texture.needsUpdate = true; };
  // A canvas draws in a fallback until the font is in, so write the board again once it is.
  // Only when what it says changes: a sync that brings the same board back redraws nothing.
  const writeVisitors = () => {
    const page = visitorLines(visitors), key = JSON.stringify(page);
    if (!boards?.visitors || key === visitorsKey) return;
    visitorsKey = key; drawVisitors(boards.visitors, page); boards.visitors.texture.needsUpdate = true;
  };
  document.fonts?.load(`40px 'Permanent Marker'`).then(() => { if (written) writeUsage(); visitorsKey = ''; writeVisitors(); }).catch(() => {});
  const ensure = () => {
    // The room rebuilds its walls (and so its boards) when it resizes; repaint onto the new faces.
    if (faces === room.boards.whiteboard) return;
    faces = room.boards.whiteboard;
    boards = { whiteboard: paint(room.boards.whiteboard, 1024, 512, 1.5), clock: paint(room.boards.clock, 256, 256), waiting: paint(room.boards.waiting, 528, 384), plate: paint(room.boards.plate, 512, 112), visitors: room.visitors && paint(room.visitors.face, 512, 640), sign: paint(room.coffeeSign.userData.face, 256, 192) };
    usageKey = waitingKey = visitorsKey = ''; plateKey = null; minute = -1;
  };
  return {
    sync(snapshot, { error = '', waiting = [] } = {}) {
      ensure();
      const now = Date.now(), nextUsage = JSON.stringify([snapshot.usage, snapshot.providers, !!error, Math.floor(now / 60_000)]);
      if (nextUsage !== usageKey) {
        usageKey = nextUsage; written = [snapshot.usage, snapshot.providers, error, now]; writeUsage();
        const empty = usedUp(snapshot.usage, now); room.coffeeSign.visible = empty.length > 0;
        if (empty.length) { drawSign(boards.sign, empty); boards.sign.texture.needsUpdate = true; }
      }
      const machine = snapshot.machine || '';
      if (machine !== plateKey) { plateKey = machine; drawPlate(boards.plate, machine); boards.plate.texture.needsUpdate = true; }
      const nextWaiting = JSON.stringify(waiting);
      if (nextWaiting !== waitingKey) { waitingKey = nextWaiting; drawWaiting(boards.waiting, waiting); boards.waiting.texture.needsUpdate = true; }
      writeVisitors();
    },
    // Office online's state (online.js), for the visitors' clipboard.
    visitors(state) { visitors = state; if (room.boards) { ensure(); writeVisitors(); } }, // before the walls are up, sync paints it
    tick(now = Date.now()) {
      if (!boards) return;
      const m = Math.floor(now / 60_000);
      if (m !== minute) { minute = m; drawClock(boards.clock, now); boards.clock.texture.needsUpdate = true; }
    },
    dispose() { if (boards) for (const board of Object.values(boards)) board?.texture.dispose(); },
  };
}
