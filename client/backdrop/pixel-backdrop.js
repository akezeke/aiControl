import { coverLayout } from './pixels.js';
import { atmosphereScale, reducedAtmosphere, onAtmosphereChange } from '../atmosphere.js';

// The animated layer over a theme's wallpaper. CSS draws the still picture (and is all that
// reduced-motion users get); a small canvas, one pixel per artwork pixel, scales up unsmoothed on top of it
// and a painter moves the things the picture already shows. It sits behind the interface and takes no input.
const looks = {
  heroes: { src: '/heroes-bg.webp', grid: 4, painter: () => import('./heroes.js') },
  zelda: { src: '/zelda-overworld.webp', grid: 4, painter: () => import('./zelda.js') },
  diablo: { src: '/diablo-bg.webp', grid: 3, painter: () => import('./diablo.js') },
  city: { src: '/city-bg.png', grid: 1, painter: () => import('./city.js') },
};
const FPS = 12;
let root, canvas, ctx, current, running, raf, last = 0, ticket = 0, shown = 0, time = 0;

function mount() {
  if (root) return;
  root = document.createElement('div'); root.id = 'pixel-backdrop'; root.setAttribute('aria-hidden', 'true');
  canvas = document.createElement('canvas'); root.append(canvas); ctx = canvas.getContext('2d');
  document.body.prepend(root);
  addEventListener('resize', () => requestAnimationFrame(layout));
  document.addEventListener('visibilitychange', sync);
  onAtmosphereChange(sync);
}
const loadImage = src => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });

// The wallpaper's focal point comes from the stylesheet, which moves it on small screens.
function layout() {
  if (!current || !root) return;
  const view = root.getBoundingClientRect(); if (!view.width) return;
  const style = getComputedStyle(root), focus = [style.backgroundPositionX, style.backgroundPositionY].map(v => v.endsWith('%') ? parseFloat(v) / 100 : .5);
  const box = coverLayout(view, current.image, focus), unit = box.scale * current.grid;
  Object.assign(canvas.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${canvas.width * unit}px`, height: `${canvas.height * unit}px` });
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (now - last < 1000 / FPS) return;
  // Hidden by its theme (Metropolis while its scene is up): nothing to paint, and laid out again when it shows.
  const width = root.clientWidth; if (width !== shown) { shown = width; layout(); }
  if (!width) return;
  time += Math.min(.2, Math.max(0, (now - last) / 1000)) * atmosphereScale();
  last = now; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1;
  current.frame(ctx, time);
}
function sync() {
  const play = !!current && !reducedAtmosphere() && !document.hidden;
  if (play && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  else if (!play && running) { running = false; cancelAnimationFrame(raf); }
  if (!play && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export async function setBackdrop(theme) {
  const look = looks[theme], mine = ++ticket;
  if (!look) { current = undefined; sync(); return; }
  mount();
  if (current?.id === theme) { layout(); sync(); return; }
  current = undefined; sync();
  try {
    const [{ createPainter }, image] = await Promise.all([look.painter(), loadImage(look.src)]);
    if (mine !== ticket) return;
    canvas.width = Math.ceil(image.naturalWidth / look.grid); canvas.height = Math.ceil(image.naturalHeight / look.grid);
    // A smoothed, reduced copy of the picture: painters read colours from it to find water, blood and sky.
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    const read = copy.getContext('2d', { willReadFrequently: true }); read.imageSmoothingQuality = 'high'; read.drawImage(image, 0, 0, copy.width, copy.height);
    const sample = { w: copy.width, h: copy.height, data: read.getImageData(0, 0, copy.width, copy.height).data };
    current = { id: theme, grid: look.grid, image: { width: image.naturalWidth, height: image.naturalHeight }, frame: createPainter(sample) };
    layout(); sync();
  } catch { /* The still wallpaper is already showing. */ }
}
