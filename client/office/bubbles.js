// Speech bubbles are HTML over the canvas: sharp text, real buttons, and always visible, even through walls.
// Plus the few controls that stay on screen: who's waiting, low usage, back to the list, the phone overview button, the aiming dot and the hint,
// and the card beside whoever is outlined.
import * as THREE from 'three';

const hintKey = 'ai-control-office-hint-3';

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

// What the list shows and the scene doesn't: branch, plan steps, permission mode, context, how long in this state.
const span = (className, text) => { const node = document.createElement('span'); node.className = className; node.textContent = text; return node; };
// Below and right of a screen point, flipped to stay in the scene.
function placeNear(container, node, at) {
  const box = container.getBoundingClientRect(), x = at.clientX - box.left, y = at.clientY - box.top, w = node.offsetWidth, h = node.offsetHeight;
  const left = x + 18 + w > box.width - 8 ? x - 18 - w : x + 18, top = y + 18 + h > box.height - 8 ? y - 18 - h : y + 18;
  node.style.transform = `translate(${Math.max(8, left).toFixed(0)}px, ${Math.max(8, top).toFixed(0)}px)`;
}

export function createCard(container) {
  const card = document.createElement('div'); card.className = 'office-card'; card.hidden = true; card.setAttribute('aria-hidden', 'true'); container.append(card);
  const line = (className, ...parts) => { const div = document.createElement('div'); div.className = className; div.append(...parts.filter(part => part || part === 0)); return div; };
  let shown = '';
  return {
    // `facts` from main.js's sessionFacts (or just a title and project, for a pod's sign), or null to hide.
    show(facts) {
      card.hidden = !facts;
      const signature = facts ? JSON.stringify(facts) : '';
      if (!facts || signature === shown) return;
      shown = signature;
      const where = [facts.agent, facts.project, facts.branch && span('branch', facts.branch)].filter(Boolean).flatMap((part, i) => i ? [' · ', part] : [part]);
      const chips = line('chips', facts.plan && span('chip', `${facts.plan[0]}/${facts.plan[1]} steps`), facts.mode && span(`chip ${facts.mode}`, `${facts.mode} mode`),
        facts.context != null && span(`chip${facts.context >= 80 ? ' full' : ''}`, `ctx ${facts.context}%`), facts.state && span('state', facts.state));
      card.replaceChildren(...[
        line('title', facts.provider && span(`mark ${facts.provider}`, facts.provider === 'codex' ? '⌘' : '✳'), facts.title || facts.providerName),
        where.length && line('where', ...where),
        chips.childElementCount && chips,
        facts.detail && line('detail', facts.detail),
      ].filter(Boolean));
    },
    move(at) { if (!card.hidden && at) placeNear(container, card, at); },
    dispose() { card.remove(); },
  };
}

// A pod sign's menu: Claude (once per account, see hire.js) or Codex, started in the pod's folder. It closes on a pick, Esc or a press anywhere else.
export function createMenu(container, onChoose) {
  const menu = document.createElement('div'); menu.className = 'office-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true; container.append(menu);
  let cwd = null, items = [];
  // Without a folder (the + button) the menu asks for one, suggesting the folders sessions run in.
  const folder = document.createElement('input'); folder.className = 'office-folder'; folder.placeholder = '~/folder'; folder.setAttribute('aria-label', 'Folder'); folder.setAttribute('list', 'office-folders'); folder.autocomplete = 'off'; folder.spellcheck = false;
  const folders = document.createElement('datalist'); folders.id = 'office-folders';
  folder.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); items[0]?.click(); } });
  const build = (choices, known) => {
    items = choices.map(choice => {
      const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.title = `New ${choice.name} in tmux${choice.last ? ' · last used here' : ''}`;
      item.append(span(`mark ${choice.provider}`, choice.provider === 'codex' ? '⌘' : '✳'), choice.label);
      if (choice.last) item.append(span('last', 'last'));
      item.onclick = () => { const at = cwd ?? folder.value.trim(); if (!at) { folder.focus(); return; } result.close(); onChoose(at, choice, item); };
      return item;
    });
    folders.replaceChildren(...known.map(path => Object.assign(document.createElement('option'), { value: path })));
    menu.replaceChildren(...(cwd === null ? [folder, folders] : []), ...items);
  };
  // Keys stay in the menu: the arrows and WASD would otherwise walk or pan the camera behind it.
  menu.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') result.close();
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      items[(items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  const result = {
    get open() { return !menu.hidden; },
    contains: node => menu.contains(node),
    get asking() { return !menu.hidden && cwd === null; },
    // At a screen point; `focus` for the keyboard. A null folder asks for one; `known` are the suggestions.
    show(where, at, focus, choices, known = []) {
      cwd = where; build(choices, known); menu.setAttribute('aria-label', where === null ? 'New agent' : `New agent in ${where}`); menu.hidden = false; if (at) placeNear(container, menu, at);
      if (where === null) { folder.value = ''; folder.focus(); } else if (focus) items[0].focus();
    },
    move(at) { if (!menu.hidden) placeNear(container, menu, at); },
    close() { if (menu.hidden) return; if (menu.contains(document.activeElement)) document.activeElement.blur(); menu.hidden = true; cwd = null; },
    dispose() { menu.remove(); },
  };
  return result;
}

export function createOverlays(container, { onNext, onList, onOverview, onNew }) {
  const bar = document.createElement('div'); bar.className = 'office-overlay'; container.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); if (onclick) b.onclick = onclick; bar.append(b); return b; };
  const waiting = button('office-waiting', '', 'Walk to the next one waiting (n)', onNext); waiting.hidden = true;
  const usage = button('office-usage', '⚡', 'Usage is near its limit; see the whiteboard'); usage.hidden = true;
  button('office-new', '+', 'New agent in a folder', event => onNew(event.currentTarget));
  button('office-list', '☰', 'Show the list', onList);
  // Phones have no Tab.
  const eye = button('office-eye', '👁', 'Overview', () => onOverview()); eye.setAttribute('aria-pressed', 'false');
  const dot = document.createElement('div'); dot.className = 'office-dot'; dot.hidden = true; container.append(dot);
  let seen = false; try { seen = !!localStorage.getItem(hintKey); } catch { /* storage may be off */ }
  const hint = document.createElement('div'); hint.className = 'office-hint'; hint.textContent = 'Click or arrows to look · WASD · Shift run · Space jump · E grab · F pour · Tab overview'; hint.hidden = seen; container.append(hint);
  return {
    setWaiting(n) { waiting.hidden = !n; waiting.textContent = `⚠ ${n}`; },
    setUsageLow(on) { usage.hidden = !on; },
    setOverview(on) { eye.setAttribute('aria-pressed', String(on)); },
    showDot(on) { dot.hidden = !on; },
    setAim(on) { dot.classList.toggle('aim', on); },
    // The hint goes once you've used the overview.
    overviewUsed() { if (hint.hidden) return; hint.classList.add('gone'); setTimeout(() => { hint.hidden = true; }, 600); try { localStorage.setItem(hintKey, '1'); } catch { /* per tab only */ } },
    dispose() { bar.remove(); dot.remove(); hint.remove(); },
  };
}
