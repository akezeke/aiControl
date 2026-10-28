// Speech bubbles are HTML over the canvas: sharp text, real buttons, and always visible, even through walls.
// Plus the few controls that stay on screen: who's waiting, low usage, back to the list, the phone overview button and the Tab hint.
import * as THREE from 'three';

const hintKey = 'ai-control-office-hint';

export class Bubbles {
  constructor(container, onClick) {
    this.layer = document.createElement('div'); this.layer.className = 'office-bubbles'; container.append(this.layer);
    this.nodes = new Map(); this.onClick = onClick;
  }

  // entries: [{ id, bubble: { icon, text, highlight } | null, unread }]
  sync(entries) {
    const keep = new Set();
    for (const { id, bubble, unread } of entries) {
      if (!bubble) continue;
      keep.add(id);
      let node = this.nodes.get(id);
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.className = 'office-bubble';
        node.append(document.createElement('span'), document.createElement('span'), document.createElement('i'));
        node.children[0].className = 'icon'; node.children[1].className = 'text'; node.children[2].className = 'dot';
        node.onclick = () => this.onClick(id);
        this.layer.append(node); this.nodes.set(id, node);
      }
      const label = bubble.text ? `${bubble.icon} ${bubble.text}` : bubble.icon;
      if (node.dataset.label !== label) { node.dataset.label = label; node.children[0].textContent = bubble.icon; node.children[1].textContent = bubble.text; node.children[1].hidden = !bubble.text; node.title = bubble.text || ''; }
      node.classList.toggle('highlight', bubble.highlight);
      node.classList.toggle('unread', !!unread);
    }
    for (const [id, node] of this.nodes) if (!keep.has(id)) { node.remove(); this.nodes.delete(id); }
  }

  // Projects every bubble to the screen each frame; nearer ones are bigger and drawn on top.
  update(camera, positionOf) {
    const { clientWidth: w, clientHeight: h } = this.layer, p = new THREE.Vector3();
    for (const [id, node] of this.nodes) {
      const at = positionOf(id);
      if (!at) { node.hidden = true; continue; }
      const distance = at.distanceTo(camera.position);
      p.copy(at).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) { node.hidden = true; continue; }
      node.hidden = false;
      const scale = THREE.MathUtils.clamp(2.2 / distance, 0.55, 1);
      node.style.transform = `translate(${((p.x + 1) / 2 * w).toFixed(1)}px, ${((1 - p.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      node.style.zIndex = String(1000 - Math.round(distance * 10));
    }
  }

  dispose() { this.layer.remove(); }
}

export function createOverlays(container, { onNext, onList, onOverviewHold }) {
  const bar = document.createElement('div'); bar.className = 'office-overlay'; container.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); if (onclick) b.onclick = onclick; bar.append(b); return b; };
  const waiting = button('office-waiting', '', 'Walk to the next one waiting (n)', onNext); waiting.hidden = true;
  const usage = button('office-usage', '⚡', 'Usage is near its limit; see the whiteboard'); usage.hidden = true;
  button('office-list', '☰', 'Show the list', onList);
  // Phones have no Tab: hold this for the overview.
  const eye = button('office-eye', '👁', 'Hold for the overview');
  const hold = on => event => { event.preventDefault(); onOverviewHold(on); };
  eye.addEventListener('pointerdown', hold(true)); for (const type of ['pointerup', 'pointercancel', 'pointerleave']) eye.addEventListener(type, hold(false));
  let seen = false; try { seen = !!localStorage.getItem(hintKey); } catch { /* storage may be off */ }
  const hint = document.createElement('div'); hint.className = 'office-hint'; hint.textContent = 'WASD to walk · drag to look · hold Tab for the overview'; hint.hidden = seen; container.append(hint);
  return {
    setWaiting(n) { waiting.hidden = !n; waiting.textContent = `⚠ ${n}`; },
    setUsageLow(on) { usage.hidden = !on; },
    // The hint goes once you've used the overview.
    overviewUsed() { if (hint.hidden) return; hint.classList.add('gone'); setTimeout(() => { hint.hidden = true; }, 600); try { localStorage.setItem(hintKey, '1'); } catch { /* per tab only */ } },
    dispose() { bar.remove(); hint.remove(); },
  };
}
