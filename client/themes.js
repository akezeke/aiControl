import { setAlienAmbienceEnabled } from './alien-ambience.js';
import { sceneFor } from './scenes.js';
import { setBackdrop } from './backdrop/pixel-backdrop.js';
import { askForBoot } from './city/boot-ask.js';
import { setBrickSky } from './backdrop/brick-sky.js';
import { setBrickUi } from './bricks3d/mount.js';
import { effectiveAtmosphere, selectThemeAtmosphere } from './atmosphere.js';

// `look` picks the CSS theme; Orbit's `scheme` is fixed, or follows the system when absent.
export const themes = [
  { id: 'modern', name: 'Orbit auto', color: '#f4f5f8', dark: '#0b0d12' },
  { id: 'modern-light', look: 'modern', scheme: 'light', name: 'Orbit light', color: '#f4f5f8' },
  { id: 'modern-dark', look: 'modern', scheme: 'dark', name: 'Orbit dark', color: '#0b0d12' },
  { id: 'parchment', look: 'paper', scheme: 'light', name: 'Parchment', color: '#e9e5db' },
  { id: 'graphite', look: 'paper', scheme: 'dark', name: 'Graphite', color: '#242722' },
  { id: 'alien', name: 'MU/TH/UR', color: '#030703' },
  { id: 'command', name: 'EVA', color: '#62685a' },
  { id: 'simpsons', scheme: 'light', name: 'Springfield', color: '#86cbed' },
  { id: 'diablo', scheme: 'dark', name: 'Sanctuary', color: '#100d0b' },
  { id: 'heroes', scheme: 'dark', name: 'Heroes', color: '#172749' },
  { id: 'zelda', scheme: 'dark', name: 'Zelda', color: '#183a29' },
  // The office replaces the list with a 3D scene; the chrome around it is paper pinned to a corkboard.
  { id: 'office', scheme: 'light', name: 'Office', color: '#dcc6a3' },
  // The bridge is a 3D scene too; its colours are chosen on the bridge itself.
  { id: 'bridge', scheme: 'dark', name: 'Bridge', color: '#150f33' },
  // A pixel-art city, drawn on a 2D canvas in the Resurrect 64 palette; its list is the site office, in building materials.
  { id: 'city', scheme: 'dark', name: 'Metropolis', color: '#4d4a44' },
  // Each project a battle, each session a party member: polygons on painted backgrounds, windows in canopy green.
  { id: 'fantasy', scheme: 'dark', name: 'Fantasy Battle', color: '#123b33' },
  // Glossy toy bricks under a bright sky: the sidebar is a wall, each session a brick, each status a colour.
  { id: 'bricks', scheme: 'light', name: 'Brick Knights', color: '#2f8fe4' },
  // Every session a node round You, in one of five looks (`node`). They share one scene, so switching looks keeps it; the menu lists them under Nodes.
  { id: 'nodes', scheme: 'light', name: 'Nodes', node: 'Clean', color: '#eceef2' },
  { id: 'nodes-clean-dark', look: 'nodes', scheme: 'dark', name: 'Nodes · Clean dark', node: 'Clean dark', color: '#15171c' },
  { id: 'nodes-neurons', look: 'nodes', scheme: 'dark', name: 'Nodes · Neurons', node: 'Neurons', color: '#07060d' },
  { id: 'nodes-synthetic', look: 'nodes', scheme: 'dark', name: 'Nodes · Synthetic', node: 'Synthetic', color: '#05090c' },
  { id: 'nodes-steampunk', look: 'nodes', scheme: 'dark', name: 'Nodes · Steampunk', node: 'Steampunk', color: '#1a120b' },
  { id: 'nodes-mycelium', look: 'nodes', scheme: 'dark', name: 'Nodes · Mycelium', node: 'Mycelium', color: '#0e0f0a' },
];
const storageKey = 'ai-control-theme';
export function hasSavedTheme() { try { return themes.some(theme => theme.id === localStorage.getItem(storageKey)); } catch { return true; } }
export function savedTheme() {
  try { return themes.find(theme => theme.id === localStorage.getItem(storageKey))?.id || 'alien'; }
  catch { return 'alien'; }
}
export function applyTheme(id) {
  const theme = themes.find(theme => theme.id === id) || themes.find(theme => theme.id === 'alien');
  const root = document.documentElement, previous = root.dataset.theme, look = theme.look || theme.id;
  root.dataset.theme = look; root.dataset.themeChoice = theme.id;
  selectThemeAtmosphere(theme.id);
  // Stop any movement already in flight when entering a still theme.
  if (look === 'paper') document.getAnimations().forEach(animation => animation.cancel());
  root.toggleAttribute('data-scene', !!sceneFor(look));
  setAlienAmbienceEnabled(look === 'alien');
  setBackdrop(look);
  setBrickSky(look === 'bricks');
  setBrickUi(look === 'bricks');
  const scheme = () => {
    const dark = theme.scheme ? theme.scheme === 'dark' : !!theme.dark && !!systemDark?.matches;
    root.dataset.scheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? theme.dark || theme.color : theme.color);
  };
  scheme();
  if (systemDark) systemDark.onchange = scheme;
  try { localStorage.setItem(storageKey, theme.id); } catch { /* Private browsing can disable storage. */ }
  if (previous && previous !== look) bootSequence(true);
}
const systemDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

// MU/TH/UR's start-up text, once per tab and on switching to Alien. Click skips; CSS removes it.
const bootLines = ['INTERFACE 2037 ............ READY', 'MU/TH/UR 6000 MAINFRAME ..... ONLINE', 'TAILSCALE UPLINK ............ SECURE', 'SCANNING CREW SESSIONS ...... OK', 'PRIORITY ONE: KEEP THE CREW MOVING'];
// EVA's start: riveted blast doors with the emblem split across the seam slide apart.
export function bootSequence(force = false) {
  const theme = document.documentElement.dataset.theme;
  const previousOverlays = document.querySelectorAll('.boot, .eva-boot, .heroes-boot, .fy-boot, .lb-boot');
  // Metropolis has no overlay: it builds the real city, once the scene has one to build.
  if (theme === 'city') {
    previousOverlays.forEach(overlay => overlay.remove());
    if (effectiveAtmosphere() !== 'full') return;
    try { if (!force && sessionStorage.getItem('ai-control-boot')) return; sessionStorage.setItem('ai-control-boot', '1'); } catch { /* storage may be disabled */ }
    askForBoot(document.documentElement, performance.now());
    return;
  }
  if (!['alien', 'command', 'heroes', 'fantasy', 'bricks'].includes(theme) || effectiveAtmosphere() !== 'full') { previousOverlays.forEach(overlay => overlay.remove()); return; }
  try { if (!force && sessionStorage.getItem('ai-control-boot')) return; sessionStorage.setItem('ai-control-boot', '1'); } catch { /* storage may be disabled */ }
  previousOverlays.forEach(overlay => overlay.remove());
  const overlay = document.createElement('div'); overlay.className = { alien: 'boot', command: 'eva-boot', heroes: 'heroes-boot', fantasy: 'fy-boot', bricks: 'lb-boot' }[theme]; overlay.setAttribute('aria-hidden', 'true');
  if (theme === 'alien') bootLines.forEach((line, i) => { const p = document.createElement('p'); p.textContent = line; p.style.setProperty('--i', i); overlay.append(p); });
  else if (theme === 'command') {
    for (const side of ['left', 'right']) { const door = document.createElement('div'); door.className = `eva-door ${side}`; overlay.append(door); }
    const status = document.createElement('p'); status.textContent = 'EVA ▸ COMMAND LINK ONLINE'; overlay.append(status);
  }
  // Fantasy's console start: four facets lock into a gem on black, the name comes up, and any key or tap gets past it without losing the key.
  else if (theme === 'fantasy') {
    const gem = document.createElement('div'); gem.className = 'fy-gem'; for (let i = 0; i < 4; i++) gem.append(document.createElement('i'));
    const name = document.createElement('p'); name.textContent = 'AI Control'; overlay.append(gem, name);
    document.addEventListener('keydown', () => overlay.remove(), { once: true });
  }
  // The castle gate: two doors close the screen, then swing open on their hinges. CSS times it.
  else if (theme === 'bricks') for (const side of ['left', 'right']) { const door = document.createElement('div'); door.className = `lb-door ${side}`; overlay.append(door); }
  else { const crest = document.createElement('div'); crest.className = 'heroes-seal'; overlay.append(crest); }
  overlay.onclick = () => overlay.remove();
  // Pseudo-element animations (EVA's seam flash) also report the overlay as target; wait for its own exit.
  overlay.addEventListener('animationend', event => { if (event.target === overlay && !event.pseudoElement) overlay.remove(); });
  document.body.append(overlay);
  // Also clean up if reduced motion is enabled while an entrance is playing.
  setTimeout(() => overlay.remove(), 6000);
}
