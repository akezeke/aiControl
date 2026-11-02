// What's drawn on the ship's displays: tiles, signs, alcoves. Canvases come from the room.
// Signals: red needs you, teal is working, pale blue is idle, orange is near a limit. Decoration uses the palette's other hues.
import { monitorLines } from '../office/status.js';
import { usageWindowView, spendView } from '../usage-presentation.js';
import { rectCorners } from './brackets.js';
import { SIGNALS } from './palettes.js';
import { signalOf, stationSignals } from './ship.js';

const INK = '#f2f4ff', DIM = '#aeb4c6', Y = '#eef0f6', O = '#c4cad8', BACK = '#0c1630', OFF = '#262c33', { need: RED, working: TEAL, idle: BLUE, near: ORANGE } = SIGNALS;
const SIGNAL_COLOUR = { need: RED, working: TEAL, idle: BLUE };
const LABELS = { question: 'HAILING', permission: 'AUTHORIZE', working: 'ON DUTY', idle: 'STANDBY', error: 'FAULT', offline: 'OFFLINE' };
const GLYPHS = { claude: '✳', codex: '⌘' };
const MAX_LIMIT_ROWS = 5, MAX_SPENDERS = 4, MAX_FEED = 7;
export const font = (weight, size) => `${weight} ${size}px Antonio, 'Arial Narrow', 'Liberation Sans Narrow', sans-serif`;
const graphemes = text => [...new Intl.Segmenter().segment(text)].map(part => part.segment);

// One line that fits `width`, cut on whole characters so an emoji is never split.
export function fitText(text, width, measure) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (measure(line) <= width) return line;
  if (measure('…') > width) return '';
  const parts = graphemes(line);
  let low = 0, high = parts.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (measure(`${parts.slice(0, mid).join('')}…`) <= width) low = mid; else high = mid - 1; }
  return `${parts.slice(0, low).join('').trimEnd()}…`;
}
export const stationName = session => session.title?.trim() || session.project || 'Session';
const glyph = provider => GLYPHS[provider] || '◆';
const dollars = usd => `$${usd.toFixed(2)}`;
const clock = now => new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fit = (g, text, width) => fitText(text, width, part => g.measureText(part).width);
// A word too long for a line carries on to the next, and the last line that's allowed takes all that's left, cut to fit.
export function wrapLines(text, width, max, measure) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' '), lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= width) { line = next; continue; }
    if (lines.length === max - 1) return [...lines, fitText([line, ...words.slice(i)].filter(Boolean).join(' '), width, measure)];
    if (line) { lines.push(line); line = ''; i--; continue; }
    const parts = graphemes(words[i]); let n = 1;
    while (n < parts.length && measure(parts.slice(0, n + 1).join('')) <= width) n++;
    lines.push(parts.slice(0, n).join('')); words[i] = parts.slice(n).join(''); i--;
  }
  return line || !lines.length ? [...lines, line] : lines;
}
function wrap(g, text, x, y, width, lineH, max) {
  for (const line of wrapLines(text, width, max, part => g.measureText(part).width)) { g.fillText(line, x, y); y += lineH; }
  return y;
}
function cells(g, x, y, w, h, level, color) {
  const n = 24, gap = 3, cw = (w - gap * (n - 1)) / n, on = Math.round(Math.min(1, Math.max(0, level)) * n);
  for (let i = 0; i < n; i++) { g.fillStyle = i < on ? color : OFF; g.fillRect(x + i * (cw + gap), y, cw, h); }
}
// What a waiting session is actually asking; a question's title is only ever "A question for you".
const requestText = session => { const request = session.requests?.[0]; return request?.questions?.[0]?.question || request?.title || session.asks; };

// The plain facts a station's display shows, so it's redrawn only when one of them changes.
export function agentFacts(session, unread, offline, helpers = 0, shot = null) {
  const signal = offline ? 'idle' : signalOf(session), used = session.context?.used || 0, lines = monitorLines(session, MAX_FEED).lines.filter(({ text }) => text);
  const steps = session.plan?.length ? session.plan : null, current = steps && (steps.find(step => step.status === 'active') || steps.find(step => step.status === 'pending'));
  return {
    id: session.id, signal, unread, label: offline ? 'NO SIGNAL' : LABELS[session.status] || 'STANDBY', glyph: glyph(session.provider), project: session.project || '', title: stationName(session),
    request: signal === 'need' ? requestText(session) || 'Waiting for you' : null,
    feed: lines.length ? lines : session.detail ? [{ kind: 'assistant', text: session.detail }] : [],
    progress: steps && { done: steps.filter(step => step.status === 'done').length, total: steps.length, statuses: steps.map(step => step.status), current: current?.step || 'All steps done' },
    used, usd: session.cost?.usd ?? null, model: [session.model?.replace(/^claude-/, ''), session.effort].filter(Boolean).join(' · '), helpers, shot,
  };
}
// Sizes on the 1024 × 1054 canvas, big enough that the title and feed read from the chair; the strip is for when you've flown in.
const PAD = 32, BAND = 110, TITLE = [600, 116, 128], REQUEST = [600, 76, 88], FEED = [400, 76, 88], PROGRESS = 130, STRIP = 70, SHOT_FEED = 2, SHOT_GAP = 12;
// The picture's own canvas size: the most a display ever shows of one.
export const SHOT_SIZE = { width: 960, height: 540 };
// The newest screenshot, fitted into the room left between the text and the progress.
function shotLayout(shot, W, top, bottom) {
  const box = { x: PAD, y: top + SHOT_GAP, w: W - 2 * PAD, h: Math.max(0, bottom - top - 2 * SHOT_GAP) }, k = shot.width > 0 && shot.height > 0 ? Math.min(box.w / shot.width, box.h / shot.height) : 0;
  const w = shot.width * k, h = shot.height * k;
  return { box, rect: { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }, key: shot.key, count: shot.count };
}
// Whether a point on a display (its texture's u and v, v upwards) is on the picture.
export function shotUnder(rect, u, v, W, H) {
  if (!rect) return false;
  const x = u * W, y = (1 - v) * H;
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
// `measure(text, weight, size)` gives a line's width in that font.
export function agentLayout(facts, W, H, measure) {
  const width = W - 2 * PAD, sized = ([weight, size]) => text => measure(text, weight, size);
  const dot = !!facts.unread, shot = facts.shot, title = wrapLines(facts.title, width - (dot ? 44 : 0), shot ? 1 : 2, sized(TITLE));
  const request = facts.request ? fitText(facts.request, width, sized(REQUEST)) : null, strip = [facts.used ? `${Math.round(facts.used / 1000)}K` : '—'];
  if (facts.usd != null) strip.push(dollars(facts.usd));
  if (facts.model) strip.push(facts.model);
  if (facts.helpers) strip.push(`${facts.helpers} HELPER${facts.helpers > 1 ? 'S' : ''}`);
  const room = H - BAND - PAD / 2 - title.length * TITLE[2] - (request ? REQUEST[2] : 0) - (facts.progress ? PROGRESS : 0) - STRIP;
  const fits = Math.max(0, Math.min(shot ? SHOT_FEED : Infinity, Math.floor(room / FEED[2]))), feed = (fits ? facts.feed.slice(-fits) : []).map(({ kind, text }) => ({ kind, text: fitText(text, width, sized(FEED)) }));
  const textEnd = BAND + PAD / 2 + title.length * TITLE[2] + (request ? REQUEST[2] : 0) + feed.length * FEED[2];
  return { band: { height: BAND, colour: SIGNAL_COLOUR[facts.signal] }, label: `${facts.glyph} ${facts.label}`, project: facts.project, title, request, feed, progress: facts.progress, strip, dot, shot: shot ? shotLayout(shot, W, textEnd, H - STRIP - (facts.progress ? PROGRESS : 0)) : null };
}
const FEED_TONE = { tool: DIM, assistant: INK, user: O };
const measureOn = g => (text, weight, size) => { g.font = font(weight, size); return g.measureText(text).width; };
// What the session itself is doing, as an Office monitor shows it. An empty bay is dark but for its number.
function drawAgent(g, W, H, facts, index, bitmap) {
  g.fillStyle = facts === 'dark' ? '#000' : facts ? BACK : '#1a2750'; g.fillRect(0, 0, W, H);
  if (facts === 'dark') return;
  if (!facts) { g.fillStyle = '#8391c0'; g.font = font(600, 120); g.textAlign = 'center'; g.fillText(`BAY ${index + 1}`, W / 2, H / 2 + 40); g.textAlign = 'left'; return; }
  const out = agentLayout(facts, W, H, measureOn(g)), right = W - PAD;
  g.fillStyle = out.band.colour; g.fillRect(0, 0, W, BAND);
  g.fillStyle = '#0b0506'; g.font = font(700, 82); g.fillText(out.label, PAD, 82); const taken = g.measureText(out.label).width;
  g.font = font(600, 64); g.textAlign = 'right'; g.fillText(fit(g, out.project.toUpperCase(), right - PAD - taken - 40), right, 80); g.textAlign = 'left';
  let y = BAND + PAD / 2;
  g.fillStyle = INK; g.font = font(TITLE[0], TITLE[1]);
  if (out.dot) { g.beginPath(); g.arc(PAD + 14, y + 72, 14, 0, 7); g.fill(); }
  for (const line of out.title) { y += TITLE[2]; g.fillText(line, PAD + (out.dot ? 44 : 0), y - 22); }
  if (out.request) { y += REQUEST[2]; g.fillStyle = '#ffc4b6'; g.font = font(REQUEST[0], REQUEST[1]); g.fillText(out.request, PAD, y - 16); }
  g.font = font(FEED[0], FEED[1]);
  for (const { kind, text } of out.feed) { y += FEED[2]; g.fillStyle = FEED_TONE[kind]; g.fillText(text, PAD, y - 16); }
  if (out.shot && bitmap) {
    const { rect, count } = out.shot;
    // Held below full white, so a bright page glows with the rest of the room rather than flooding it.
    g.globalAlpha = .88; g.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h); g.globalAlpha = 1;
    if (count > 1) { g.font = font(700, 52); const label = String(count), pill = g.measureText(label).width + 36, x = rect.x + rect.w - pill - 12, y = rect.y + rect.h - 76; g.fillStyle = '#0a1226e0'; g.beginPath(); g.roundRect(x, y, pill, 64, 32); g.fill(); g.fillStyle = INK; g.textAlign = 'center'; g.fillText(label, x + pill / 2, y + 50); g.textAlign = 'left'; }
  }
  if (out.progress) {
    const { done, total, statuses, current } = out.progress, top = H - STRIP - PROGRESS, count = `${done}/${total}`, gap = 6, each = (W - 2 * PAD - gap * (total - 1)) / total;
    g.fillStyle = Y; g.font = font(700, 62); g.fillText(count, PAD, top + 58); const used = g.measureText(count).width + 24;
    g.fillStyle = O; g.font = font(400, 58); g.fillText(fit(g, current, W - 2 * PAD - used), PAD + used, top + 58);
    statuses.forEach((status, i) => { g.fillStyle = status === 'done' ? Y : status === 'active' ? out.band.colour : OFF; g.fillRect(PAD + i * (each + gap), top + 78, each, 28); });
  }
  g.fillStyle = DIM; g.font = font(400, 46); g.fillText(fit(g, out.strip.join('   '), W - 2 * PAD), PAD, H - 18);
}
// Text that fills `width`, up to a size.
function big(g, weight, size, text, width) {
  g.font = font(weight, size); const wide = g.measureText(text).width;
  if (wide > width) g.font = font(weight, Math.floor(size * width / wide));
}
// All of them if they fit; the fullest if they don't.
// OpenCode's spend, as a row under the limits: what's been spent, and against a budget if one is set. It reads like a limit but isn't one,
// so it never trips the ship's limit alert or the crystals, and its colour only warns.
export function spendRows(usage = [], now = Date.now()) {
  return usage.flatMap(account => {
    const view = spendView(account, now);
    if (!view) return [];
    const dollar = usd => dollars(usd).toUpperCase();
    return [{
      name: `${glyph(account.provider)} OPENCODE`, window: view.label.toUpperCase(), spend: true, used: view.usedPercent ?? 0, bar: view.limit != null, near: view.near || view.over, full: view.over, label: 'spend',
      percent: view.limit ? `${Math.round(view.usedPercent)}%` : dollar(view.spent),
      left: view.limit ? view.over ? `OVER BY ${dollar(view.spent - view.limit)}` : `${dollar(view.left)} LEFT · ${view.resetShort.toUpperCase()}` : view.today != null ? `TODAY ${dollar(view.today)}` : '',
    }];
  });
}
export const visibleLimits = (rows, max) => rows.length > max ? [...rows].sort((a, b) => b.used - a.used).slice(0, max) : rows;
// Each account once, with its windows under it. A window it already has means another account of the same name.
export function limitGroups(rows) {
  const groups = [];
  for (const row of rows) {
    const group = groups.find(({ name, rows: own }) => name === row.name && !own.some(({ window }) => window === row.window));
    if (group) group.rows.push(row); else groups.push({ name: row.name, rows: [row] });
  }
  return groups;
}
// The two tall columns either side of the window, big enough to read from the chair. Left: the engines and every limit.
function drawShipLeft(g, w, h, d) {
  const limit = d.mode === 'limit', top = 280, pad = 24;
  g.fillStyle = BACK; g.fillRect(0, 0, w, h);
  g.fillStyle = limit ? '#e01f12' : '#0c0e16'; g.fillRect(0, 0, w, top);
  g.textAlign = 'center'; g.fillStyle = limit ? '#2a0300' : d.warp ? TEAL : d.offline ? DIM : Y; big(g, 700, 132, d.left, w - 2 * pad); g.fillText(d.left, w / 2, top / 2 + 16);
  g.fillStyle = limit ? '#2a0300' : DIM; big(g, 600, 54, d.engineLine, w - 2 * pad); g.fillText(fit(g, d.engineLine, w - 2 * pad), w / 2, top / 2 + 92); g.textAlign = 'left';
  // As big as the column allows: a few limits read from the chair, and five accounts still fit.
  const groups = limitGroups(d.limitRows), tall = groups.reduce((sum, group) => sum + 70 + group.rows.length * 92, 0);
  const s = Math.min(1.45, (h - top - 32) / Math.max(1, tall));
  let y = top + 24;
  for (const group of groups) {
    g.fillStyle = INK; g.font = font(700, 54 * s); g.fillText(fit(g, group.name, w - 2 * pad), pad, y + 44 * s); y += 62 * s;
    for (const row of group.rows) {
      const color = row.full ? RED : row.near ? ORANGE : O;
      g.fillStyle = INK; g.font = font(600, 50 * s); g.fillText(row.window, pad, y + 42 * s);
      const after = pad + g.measureText(row.window).width + 18;
      g.fillStyle = color; g.textAlign = 'right'; g.fillText(row.percent, w - pad, y + 42 * s); const room = w - pad - g.measureText(row.percent).width - 18 - after; g.textAlign = 'left';
      g.fillStyle = DIM; g.font = font(400, 38 * s); g.fillText(fit(g, row.left, room), after, y + 42 * s);
      if (row.bar !== false) cells(g, pad, y + 54 * s, w - 2 * pad, 22 * s, row.used / 100, color);
      y += 92 * s;
    }
    y += 8 * s;
  }
}
// Right: who's waiting, and what the crew has spent.
function drawShipRight(g, w, h, d) {
  const waiting = d.waiting && !d.offline, top = 400, pad = 24;
  g.fillStyle = BACK; g.fillRect(0, 0, w, h);
  g.fillStyle = waiting ? '#e01f12' : '#0c0e16'; g.fillRect(0, 0, w, top);
  g.textAlign = 'center';
  if (waiting) {
    g.fillStyle = '#fff5f2'; g.font = font(700, 190); g.fillText(String(d.waiting), w / 2, 180);
    g.font = font(600, 66); g.fillText('WAITING', w / 2, 262);
    g.font = font(600, 54); g.fillText(fit(g, `NEXT ▸ ${d.rightName.toUpperCase()}`, w - 2 * pad), w / 2, 350);
  } else {
    const line = d.offline ? 'NO SIGNAL' : 'NO HAILS';
    g.fillStyle = d.offline ? DIM : Y; big(g, 700, 132, line, w - 2 * pad); g.fillText(line, w / 2, top / 2 + 40);
  }
  g.textAlign = 'left'; let y = top + 66;
  if (d.overflow) { g.fillStyle = O; g.font = font(600, 50); g.fillText(`+${d.overflow} UNSEATED`, pad, y); y += 76; }
  g.fillStyle = DIM; g.font = font(600, 50); g.fillText('CREDITS', pad, y);
  g.fillStyle = Y; g.font = font(700, 62); g.textAlign = 'right'; g.fillText(dollars(d.total), w - pad, y + 4); g.textAlign = 'left'; y += 28;
  d.credits.forEach(([name, usd]) => {
    y += 76; const cost = dollars(usd);
    g.font = font(400, 46); g.textAlign = 'right'; g.fillStyle = Y; g.fillText(cost, w - pad, y); const room = w - 2 * pad - g.measureText(cost).width - 20;
    g.textAlign = 'left'; g.fillStyle = INK; g.fillText(fit(g, name, room), pad, y);
  });
}
function drawArm(g, w, h, d) {
  g.fillStyle = BACK; g.fillRect(0, 0, w, h);
  const quiet = !d.waiting || d.offline;
  g.fillStyle = quiet ? d.warp ? TEAL : O : RED; g.font = font(700, 120); g.fillText(d.offline ? '–' : String(d.waiting), 18, 118);
  g.font = font(600, 42); g.fillStyle = INK; g.fillText(d.offline ? 'NO SIGNAL' : d.waiting ? 'WAITING' : 'ALL QUIET', 110, 62);
  g.fillStyle = DIM; g.font = font(400, 34); g.fillText(fit(g, d.offline ? '' : d.waiting ? `▸ ${d.rightName}` : d.warp ? `${d.warp} ON DUTY` : 'COASTING', w - 124), 110, 108);
}
function drawDial(g, w, h, d, pal) {
  const c = w / 2, r = w / 2 - 6;
  g.clearRect(0, 0, w, h);
  const grad = g.createRadialGradient(c, c, 0, c, c, r); grad.addColorStop(0, pal.trim); grad.addColorStop(.35, pal.console); grad.addColorStop(.72, pal.mount); grad.addColorStop(1, '#0a0c1c');
  g.fillStyle = grad; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill();
  g.strokeStyle = '#111820'; g.lineWidth = 3; [.3, .55, .8, .98].forEach(k => { g.beginPath(); g.arc(c, c, r * k, 0, 7); g.stroke(); });
  for (let i = 0; i < 48; i++) { const a = i / 48 * 6.283, k = i % 4 ? .92 : .84; g.beginPath(); g.moveTo(c + Math.cos(a) * r * k, c + Math.sin(a) * r * k); g.lineTo(c + Math.cos(a) * r * .98, c + Math.sin(a) * r * .98); g.stroke(); }
  d.signals.forEach((signal, i) => { if (!signal) return; const a = i / d.signals.length * 6.283 + .4, k = signal === 'need' ? .28 : signal === 'working' ? .55 : .78; g.fillStyle = SIGNAL_COLOUR[signal]; g.beginPath(); g.arc(c + Math.cos(a) * r * k, c + Math.sin(a) * r * k, signal === 'need' ? 15 : 11, 0, 7); g.fill(); });
}
function drawHelmPlate(g, w, h, text, color) {
  g.fillStyle = BACK; g.fillRect(0, 0, w, h);
  g.fillStyle = color; g.font = font(700, 56); g.fillText(fit(g, text, w - 36), 20, 72);
}
function drawPlate(g, w, h, text) {
  g.fillStyle = BACK; g.fillRect(0, 0, w, h);
  g.fillStyle = O; g.font = font(600, h * .62); g.textAlign = 'center'; g.fillText(fit(g, text, w - 20), w / 2, h * .74); g.textAlign = 'left';
}
function drawComm(g, w, h, d) {
  g.fillStyle = '#100403'; g.fillRect(0, 0, w, h);
  if (d.mode === 'limit') {
    g.fillStyle = RED; g.textAlign = 'center'; g.font = font(700, 130); g.fillText('ALL STOP', w / 2, h / 2 - 12);
    g.fillStyle = INK; g.font = font(400, 50); g.fillText(fit(g, d.limitLine, w - 60), w / 2, h / 2 + 70); g.textAlign = 'left'; return;
  }
  if (!d.comm) return;
  g.fillStyle = RED; g.fillRect(0, 0, w, 84);
  g.fillStyle = '#140403'; g.font = font(700, 58); g.fillText(fit(g, `INCOMING HAIL · ${d.comm.project.toUpperCase()}`, w - 68), 34, 64);
  g.fillStyle = INK; g.font = font(600, 70); wrap(g, d.comm.ask, 34, 170, w - 68, 78, 2);
  g.font = font(400, 40); g.fillStyle = DIM; g.fillText(fit(g, d.comm.title, w - 68), 34, 316);
  if (d.waiting > 1) { g.fillStyle = '#ffb8a6'; g.font = font(400, 40); g.fillText(`+ ${d.waiting - 1} MORE WAITING`, 34, 368); }
}

// A display redraws only when what it shows has changed.
export function createDisplays(room) {
  const { panels } = room, drawn = new Map();
  let palette = null, facts = null, fresh = 0, again = null;
  const shots = new Map(); // session id → { bitmap, count, key }: key changes with the picture, as a bitmap can't go in a signature
  const paint = (name, data, draw) => {
    const signature = JSON.stringify(data), panel = panels[name];
    if (drawn.get(name) === signature) return;
    drawn.set(name, signature); const { g, el, texture } = panel, { width, height } = el;
    g.save(); g.textAlign = 'left'; g.globalAlpha = 1; draw(g, width, height); g.restore(); texture.needsUpdate = true;
  };
  function draw() {
    if (!facts) return;
    const d = facts, pal = palette, helmColor = d.warp ? TEAL : O;
    room.stations.forEach((_, i) => paint(`row${i}`, d.rows[i], (g, w, h) => drawAgent(g, w, h, d.rows[i], i, shots.get(d.rows[i]?.id)?.bitmap)));
    paint('shipLeft', [d.mode, d.warp, d.left, d.engineLine, d.offline, d.limitRows], (g, w, h) => drawShipLeft(g, w, h, d));
    paint('shipRight', [d.waiting, d.rightName, d.offline, d.overflow, d.total, d.credits], (g, w, h) => drawShipRight(g, w, h, d));
    paint('arm', [d.waiting, d.warp, d.offline, d.rightName], (g, w, h) => drawArm(g, w, h, d));
    paint('dial', d.signals, (g, w, h) => drawDial(g, w, h, d, pal));
    paint('helmLeft', [d.warp], (g, w, h) => drawHelmPlate(g, w, h, d.warp ? `WARP ${d.warp}` : 'COASTING', helmColor));
    paint('helmRight', [d.offline, d.rightName, d.waiting], (g, w, h) => drawHelmPlate(g, w, h, d.offline ? 'NO SIGNAL' : d.waiting ? `▸ ${d.rightName.toUpperCase()}` : 'COURSE CLEAR', d.waiting && !d.offline ? RED : O));
    paint('door', d.machine, (g, w, h) => drawPlate(g, w, h, d.machine.toUpperCase()));
    paint('clock', d.clock, (g, w, h) => drawPlate(g, w, h, `SHIP TIME ${d.clock}`));
    paint('comm', [d.mode, d.limitLine, d.comm, d.waiting], (g, w, h) => drawComm(g, w, h, d));
    room.crystals.forEach((crystal, i) => {
      const row = d.crystals[i];
      crystal.material.color.copy(row ? (row.full ? crystal.full : row.near ? crystal.near : crystal.color) : crystal.off);
      crystal.mesh.scale.z = row ? .25 + .75 * Math.min(1, row.used / 100) : .25;
    });
  }
  return {
    // A session's newest screenshot ({ bitmap, count }), or null for none.
    setShot(id, shot) {
      if (shot) { const had = shots.get(id); shots.set(id, { ...shot, key: had?.bitmap === shot.bitmap ? had.key : ++fresh }); } else shots.delete(id);
      again?.();
    },
    // The picture on a station's display, if a point on it (u, v) is on the picture.
    shotAt(index, u, v) {
      const row = facts?.rows[index], { g, el } = room.panels[`row${index}`];
      if (!row?.shot) return false;
      return shotUnder(agentLayout(row, el.width, el.height, measureOn(g)).shot.rect, u, v, el.width, el.height);
    },
    // Where the picture on a station's display is in the world.
    shotCorners(index) {
      const row = facts.rows[index], { g, el } = room.panels[`row${index}`], mesh = room.stations[index].mesh;
      return rectCorners(mesh, agentLayout(row, el.width, el.height, measureOn(g)).shot.rect, el.width, el.height);
    },
    update(args) {
      again = () => this.update(args);
      const { state, stations, overflow = 0, sessions, usage, machine, unread = () => false, now = Date.now() } = args;
      const shotFacts = id => { const shot = shots.get(id); return shot ? { key: shot.key, width: shot.bitmap.width, height: shot.bitmap.height, count: shot.count } : null; };
      const byId = new Map(sessions.map(session => [session.id, session])), main = sessions.filter(session => !session.parentId), helpers = new Map();
      for (const { parentId } of sessions) if (parentId) helpers.set(parentId, (helpers.get(parentId) || 0) + 1);
      const limitRows = state.limits.map(limit => {
        const view = usageWindowView({ label: limit.window, usedPercent: limit.usedPercent, resetsAt: limit.resetsAt }, now);
        return { name: `${glyph(limit.provider)} ${(limit.label || limit.provider || '').toUpperCase()}`, window: view.shortLabel.toUpperCase(), percent: `${Math.round(limit.usedPercent)}%`, used: view.expired ? 0 : limit.usedPercent, left: view.resetIn.toUpperCase(), near: limit.near, full: limit.full, label: limit.window };
      });
      const spend = spendRows(usage, now);
      const worst = [...limitRows].sort((a, b) => b.used - a.used), full = worst.find(row => row.full);
      // Subagents share their parent's bill, so only main sessions count.
      const spent = main.filter(session => session.cost?.usd != null).sort((a, b) => b.cost.usd - a.cost.usd);
      const comm = state.next && !state.offline ? { project: state.next.project || '', ask: requestText(state.next) || 'Waiting for you', title: stationName(state.next) } : null;
      facts = {
        mode: state.mode, warp: state.warp, waiting: state.waiting, offline: state.offline, left: state.left, right: state.right, rightName: state.rightName, machine: machine || '', clock: clock(now),
        engineLine: state.offline ? 'RECONNECTING' : state.mode === 'limit' ? full ? `RESETS IN ${full.left}` : '' : state.warp ? `${state.warp} ON DUTY` : `SHIP TIME ${clock(now)}`,
        limitLine: full ? `${full.name} ${full.label.toUpperCase()} LIMIT REACHED · RESETS IN ${full.left}` : '',
        limitRows: [...visibleLimits(limitRows, MAX_LIMIT_ROWS), ...spend], overflow,
        total: spent.reduce((sum, session) => sum + session.cost.usd, 0), credits: spent.slice(0, MAX_SPENDERS).map(session => [stationName(session), session.cost.usd]),
        comm, crystals: worst.slice(0, room.crystals.length),
        signals: stationSignals(stations, sessions, state.offline),
        rows: stations.map(seat => { if (!seat) return null; const session = seat.goneAt == null && byId.get(seat.id); return session ? agentFacts(session, unread(session), state.offline, helpers.get(session.id) || 0, shotFacts(session.id)) : 'dark'; }),
      };
      draw();
    },
    // Same canvases, redrawn in the new colours.
    repaint(next) { palette = next; drawn.clear(); draw(); },
  };
}
