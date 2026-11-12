// The PICO-8 window's client area: Lexaloffle's own BBS widget in a frame, one cart at a time. Stopped (after standing up or a
// reload) it shows the cart's thumbnail with ▶ Play, and never autoplays. Nothing here runs on its own: no timers, polling or rAF.
import { ICONS, paint } from './pc-icons.js';
import { thumbName, widgetUrl } from './carts.js';

export const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
const W = 526, H = 522;

export function createPlayer({ doc = document, online = () => navigator.onLine, thumbUrl = name => '/api/office/bbs/thumb/' + name } = {}) {
  const make = (tag, className, text) => { const n = doc.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const node = make('div', 'pc-client pc-player');
  Object.assign(node.style, { width: `${W}px`, height: `${H}px`, position: 'relative', overflow: 'hidden', background: '#000', color: '#fff' });
  let cart = null, frame = null, hidden = false, playHandler = null;

  // Taking the frame out of the page stops the cart and its sound.
  const drop = () => { frame?.remove(); frame = null; };
  const fill = (...kids) => node.replaceChildren(...kids);
  const note = text => { const n = make('p', 'pc-player-note', text); Object.assign(n.style, { position: 'absolute', inset: '0', margin: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }); return n; };

  function play(next) {
    drop(); cart = next;
    if (!online()) { fill(note('Offline: carts load from lexaloffle.com')); return; }
    const f = frame = make('iframe');
    for (const [name, value] of Object.entries({ src: widgetUrl(next.pid), title: next.title, width: String(W), height: String(H), scrolling: 'no', referrerpolicy: 'no-referrer', allow: 'fullscreen; gamepad; autoplay', sandbox: SANDBOX })) f.setAttribute(name, value);
    f.style.display = hidden ? 'none' : '';
    f.style.position = 'absolute'; f.style.left = f.style.top = '0'; f.style.border = '0';
    f.addEventListener('load', () => f.focus());
    // Behind the frame till the widget paints over it.
    fill(note('Needs internet'), f);
  }
  function show(next) {
    drop(); cart = next;
    if (!next) { fill(); return; }
    const img = make('img'); img.setAttribute('src', thumbUrl(thumbName(next.pid))); img.setAttribute('alt', '');
    Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', imageRendering: 'pixelated' });
    const button = make('button', 'pc-button', '▶ Play'); button.type = 'button';
    Object.assign(button.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' });
    button.addEventListener('click', () => playHandler?.(cart));
    fill(img, button);
  }

  show(null);
  return {
    node, play, show,
    stop: () => show(cart),
    // display: none on the frame itself is what pauses the game (visibility: hidden doesn't); the node stays, so it resumes in place.
    pause(value) { hidden = value; if (frame) frame.style.display = value ? 'none' : ''; },
    title: () => cart ? `${cart.title} - PICO-8` : 'PICO-8',
    cart: () => cart, playing: () => frame !== null, frame: () => frame,
    onPlay(fn) { playHandler = fn; },
  };
}

// The monitor's picture of the window: the cart's loaded thumbnail scaled into `box`, else black with the console. `image(name)`
// looks up a loaded thumbnail, as in every module's draw.
export function draw(g, box, { cart, image }) {
  const { x, y, w, h } = box;
  g.fillStyle = '#000'; g.fillRect(x, y, w, h);
  const img = cart ? image(thumbName(cart.pid)) : null;
  if (img) { g.imageSmoothingEnabled = false; g.drawImage(img, x, y, w, h); return; }
  const icon = ICONS.console, scale = Math.max(1, Math.floor(Math.min(w, h) * 0.4 / icon.h));
  paint(g, icon, Math.round(x + (w - icon.w * scale) / 2), Math.round(y + (h - icon.h * scale) / 2), scale);
}
