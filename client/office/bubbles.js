// Speech bubbles are HTML over the canvas: sharp text, real buttons, and always visible, even through walls.
// Plus the few controls that stay on screen: who's waiting, low usage, back to the list, the phone overview button, the aiming dot and the hint,
// and the card beside whoever is outlined.
import * as THREE from 'three';
import { GAUGE_SIZE, gaugeAt, gaugeColour } from './throwing.js';

const hintKey = 'ai-control-office-hint-3';

// The power gauge's arc, going clockwise from the left over the top to the bottom: its opening faces the lower left, where the hand and the dots come from.
const gaugeArc = () => {
  const c = GAUGE_SIZE / 2, r = 27;
  return `M ${c - r} ${c} A ${r} ${r} 0 1 1 ${c} ${c + r}`;
};

// Emoji sit at different heights in their fonts (on Windows the keyboard sits low and the zzz high), so the icon is
// drawn on a canvas with the drawing itself centred instead of set as text.
function drawIcon(canvas, icon) {
  const g = canvas.getContext('2d'), size = canvas.width, measure = scale => { g.font = `${size * scale}px system-ui, sans-serif`; return g.measureText(icon); };
  let m = measure(0.82);
  const fit = Math.min(1, size * 0.96 / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight || 1), size * 0.96 / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || 1));
  if (fit < 1) m = measure(0.82 * fit);
  g.clearRect(0, 0, size, size);
  g.fillText(icon, (size - m.actualBoundingBoxRight + m.actualBoundingBoxLeft) / 2, (size + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

export class Bubbles {
  constructor(container, onClick) {
    this.layer = document.createElement('div'); this.layer.className = 'office-bubbles'; container.append(this.layer);
    this.nodes = new Map(); this.onClick = onClick; this.entries = []; this.said = new Map();
  }

  // entries: [{ id, bubble: { icon, text, highlight } | null, unread }]; something just said (say) shows instead for a moment.
  sync(entries = this.entries) {
    this.entries = entries;
    const all = new Map(entries.map(entry => [entry.id, entry])), now = performance.now(), keep = new Set();
    for (const [id, said] of this.said) if (said.until < now) this.said.delete(id); else all.set(id, { ...all.get(id), id, bubble: said.bubble });
    for (const { id, bubble, unread } of all.values()) {
      if (!bubble) continue;
      keep.add(id);
      let node = this.nodes.get(id);
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.className = 'office-bubble';
        const icon = document.createElement('canvas'); icon.width = icon.height = 64; icon.className = 'icon'; icon.setAttribute('role', 'img');
        node.append(icon, document.createElement('span'), document.createElement('i'));
        node.children[1].className = 'text'; node.children[2].className = 'dot';
        node.dataset.id = id; node.onclick = () => { node.blur(); this.onClick(id); }; // left focused, the next Space (jump) would click it again
        this.layer.append(node); this.nodes.set(id, node);
      }
      const label = bubble.text ? `${bubble.icon} ${bubble.text}` : bubble.icon;
      if (node.dataset.label !== label) { node.dataset.label = label; drawIcon(node.children[0], bubble.icon); node.children[0].setAttribute('aria-label', bubble.icon); node.children[1].textContent = bubble.text; node.children[1].hidden = !bubble.text; node.width = 0; }
      node.classList.toggle('highlight', bubble.highlight);
      node.classList.toggle('unread', !!unread);
    }
    for (const [id, node] of this.nodes) if (!keep.has(id)) { node.remove(); this.nodes.delete(id); }
  }

  // Projects every bubble to the screen each frame; nearer ones are bigger and drawn on top.
  // `zoomOut` (0..1) shrinks them a little as the overview rises, so a whole room of them still fits but stays readable.
  // One by the side of the screen slides back in, its tail still pointing at whoever it belongs to.
  update(camera, positionOf, zoomOut = 0) {
    for (const said of this.said.values()) if (said.until < performance.now()) { this.sync(); break; }
    const { clientWidth: w, clientHeight: h } = this.layer, p = new THREE.Vector3();
    if (this.width !== w) { this.width = w; for (const node of this.nodes.values()) node.width = 0; } // widths change with the media queries
    for (const [id, node] of this.nodes) {
      const at = positionOf(id);
      if (!at) { node.hidden = true; continue; }
      const distance = at.distanceTo(camera.position);
      p.copy(at).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) { node.hidden = true; continue; }
      node.hidden = false;
      const scale = THREE.MathUtils.clamp(4 / distance, 0.8, 1) * (1 - 0.15 * zoomOut), x = (p.x + 1) / 2 * w;
      const half = (node.width ||= node.offsetWidth) / 2, shift = THREE.MathUtils.clamp(x, half * scale + 4, Math.max(half * scale + 4, w - half * scale - 4)) - x;
      node.style.transform = `translate(${(x + shift).toFixed(1)}px, ${((1 - p.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      const tail = Math.round(THREE.MathUtils.clamp(-shift / scale, 22 - half, half - 22));
      if (node.tail !== tail) { node.tail = tail; node.style.setProperty('--tail', `${tail}px`); }
      node.style.zIndex = String(1000 - Math.round(distance * 10));
    }
  }

  // A quick word from someone (hit by a ball, say), over their own bubble for a couple of seconds.
  say(id, icon, text, seconds = 2.5) { this.said.set(id, { bubble: { icon, text, highlight: false }, until: performance.now() + seconds * 1000 }); this.sync(); }

  // The session whose bubble is at a screen point (under the dot when aiming with it).
  at(x, y) { return document.elementFromPoint(x, y)?.closest('.office-bubble')?.dataset.id || null; }

  dispose() { this.layer.remove(); }
}

export { createCard, createMenu } from '../scene-ui.js';

export function createOverlays(container, { onNext, onList, onOverview, onNew, onLeave, onCopy }) {
  const bar = document.createElement('div'); bar.className = 'office-overlay'; container.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); if (onclick) b.onclick = onclick; bar.append(b); return b; };
  const leave = button('office-leave', '✕ Quit game', 'Stop playing and stand up (Esc)', onLeave); leave.hidden = true;
  const copy = button('office-copy', 'Copy', 'Copy today\'s scores (C)', event => { event.currentTarget.blur(); onCopy(); }); copy.hidden = true;
  const waiting = button('office-waiting', '', 'Walk to the next one waiting (n)', onNext); waiting.hidden = true;
  const usage = button('office-usage', '⚡', 'Usage is near its limit; see the whiteboard'); usage.hidden = true;
  button('office-new', '+', 'New agent in a folder', event => onNew(event.currentTarget));
  button('office-list', '☰', 'Show the list', onList);
  const eye = button('office-eye', '👁', 'Overview (Tab)', () => onOverview()); eye.setAttribute('aria-pressed', 'false');
  const dot = document.createElement('div'); dot.className = 'office-dot'; dot.hidden = true; container.append(dot);
  const meter = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); meter.setAttribute('class', 'office-charge'); meter.setAttribute('viewBox', `0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`); meter.setAttribute('aria-hidden', 'true');
  meter.innerHTML = `<g>${['ink', 'track', 'fill', 'shine'].map(name => `<path class="${name}" d="${gaugeArc()}" pathLength="1"/>`).join('')}</g>`; container.append(meter);
  const fill = meter.querySelector('.fill');
  const score = document.createElement('div'); score.className = 'office-score'; score.hidden = true; container.append(score);
  const copied = document.createElement('div'); copied.className = 'office-copied'; copied.textContent = 'Copied'; copied.hidden = true; container.append(copied);
  // Where the clipboard can't be written: the line selected, to copy by hand. Esc, its ✕ or a click anywhere else closes it; while it's up the keys are the input's.
  const line = document.createElement('div'); line.className = 'office-copyline'; line.hidden = true; container.append(line);
  const field = line.appendChild(document.createElement('input')); field.readOnly = true; field.setAttribute('aria-label', 'Today\'s scores');
  const closeLine = () => { if (line.hidden) return false; line.hidden = true; field.blur(); return true; };
  const close = line.appendChild(document.createElement('button')); close.type = 'button'; close.textContent = '✕'; close.title = 'Close (Esc)'; close.setAttribute('aria-label', 'Close'); close.onclick = closeLine;
  line.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); closeLine(); } });
  let copiedFor = 0, charged = null, box = null, gaugeX = null, gaugeY = null;
  let seen = false; try { seen = !!localStorage.getItem(hintKey); } catch { /* storage may be off */ }
  const hint = document.createElement('div'); hint.className = 'office-hint'; hint.textContent = 'Click or arrows to look · WASD · Shift run · Space jump · E grab · F pour · Tab overview'; hint.hidden = seen; container.append(hint);
  return {
    setWaiting(n) { waiting.hidden = !n; waiting.textContent = `⚠ ${n}`; },
    setUsageLow(on) { usage.hidden = !on; },
    setOverview(on) { eye.setAttribute('aria-pressed', String(on)); },
    setPlaying(on) { leave.hidden = !on; },
    showDot(on) { dot.hidden = !on; },
    setAim(on) { dot.classList.toggle('aim', on); },
    // How far a throw's charged, 0 to 1, and the screen point it aims at; null hides it. Once a frame while it's up: it only writes
    // when the level or the point moved, and only reads the container's place when it comes up.
    setCharge(level, at) {
      if (level === null) { if (charged !== null) { charged = gaugeX = gaugeY = null; meter.classList.remove('shown', 'full'); } return; }
      if (charged === null) { box = container.getBoundingClientRect(); meter.classList.add('shown'); }
      const step = Math.round(level * 100);
      if (step !== charged) { charged = step; fill.setAttribute('stroke-dasharray', `${step / 100} 2`); fill.style.stroke = gaugeColour(step / 100); meter.classList.toggle('full', step === 100); }
      if (at.clientX === gaugeX && at.clientY === gaugeY) return;
      gaugeX = at.clientX; gaugeY = at.clientY;
      const { x, y } = gaugeAt(gaugeX - box.left, gaugeY - box.top, box.width, box.height);
      meter.style.transform = `translate(${x}px, ${y}px)`;
    },
    // What a shot asks (goalOf's list, a ticked line struck through) and, beside it, how it went; a null goal hides it.
    setScore(goal, verdict, canCopy) {
      score.hidden = !goal; score.replaceChildren(); copy.hidden = !canCopy;
      if (!goal) return;
      const asks = score.appendChild(document.createElement('span'));
      goal.forEach(({ text, done }, i) => { if (i) asks.append(' · '); asks.appendChild(document.createElement(done ? 's' : 'span')).textContent = text; });
      if (verdict) { const said = score.appendChild(document.createElement('b')); said.textContent = verdict; }
    },
    showCopy(text) { field.value = text; line.hidden = false; field.focus(); field.select(); },
    showCopied() { copied.hidden = false; clearTimeout(copiedFor); copiedFor = setTimeout(() => { copied.hidden = true; }, 1200); },
    get copying() { return !line.hidden; },
    // Closes it unless `target`'s part of it; says whether it did.
    closeCopy(target) { return !line.contains(target) && closeLine(); },
    // The hint goes once you've used the overview.
    overviewUsed() { if (hint.hidden) return; hint.classList.add('gone'); setTimeout(() => { hint.hidden = true; }, 600); try { localStorage.setItem(hintKey, '1'); } catch { /* per tab only */ } },
    dispose() { clearTimeout(copiedFor); bar.remove(); dot.remove(); mark.remove(); meter.remove(); score.remove(); copied.remove(); line.remove(); hint.remove(); },
  };
}
