import { setAlienAmbienceEnabled } from './alien-ambience.js';

// `look` picks the CSS theme; Orbit's `scheme` is fixed, or follows the system when absent.
export const themes = [
  { id: 'modern', name: 'Orbit auto', color: '#f4f5f8', dark: '#0b0d12' },
  { id: 'modern-light', look: 'modern', scheme: 'light', name: 'Orbit light', color: '#f4f5f8' },
  { id: 'modern-dark', look: 'modern', scheme: 'dark', name: 'Orbit dark', color: '#0b0d12' },
  { id: 'alien', name: 'MU/TH/UR', color: '#030703' },
  { id: 'command', name: 'EVA', color: '#62685a' },
  { id: 'simpsons', scheme: 'light', name: 'Springfield', color: '#86cbed' },
  { id: 'heroes', scheme: 'dark', name: 'Heroes', color: '#172749' },
  // The office replaces the list with a 3D scene; the chrome around it is paper pinned to a corkboard.
  { id: 'office', scheme: 'light', name: 'Office', color: '#dcc6a3' },
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
  setAlienAmbienceEnabled(look === 'alien');
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
  const previousOverlays = document.querySelectorAll('.boot, .eva-boot, .heroes-boot');
  if (!['alien', 'command', 'heroes'].includes(theme) || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { previousOverlays.forEach(overlay => overlay.remove()); return; }
  try { if (!force && sessionStorage.getItem('ai-control-boot')) return; sessionStorage.setItem('ai-control-boot', '1'); } catch { /* storage may be disabled */ }
  previousOverlays.forEach(overlay => overlay.remove());
  const overlay = document.createElement('div'); overlay.className = { alien: 'boot', command: 'eva-boot', heroes: 'heroes-boot' }[theme]; overlay.setAttribute('aria-hidden', 'true');
  if (theme === 'alien') bootLines.forEach((line, i) => { const p = document.createElement('p'); p.textContent = line; p.style.setProperty('--i', i); overlay.append(p); });
  else if (theme === 'command') {
    for (const side of ['left', 'right']) { const door = document.createElement('div'); door.className = `eva-door ${side}`; overlay.append(door); }
    const status = document.createElement('p'); status.textContent = 'EVA ▸ COMMAND LINK ONLINE'; overlay.append(status);
  }
  else { const crest = document.createElement('div'); crest.className = 'heroes-seal'; overlay.append(crest); }
  overlay.onclick = () => overlay.remove();
  // Pseudo-element animations (EVA's seam flash) also report the overlay as target; wait for its own exit.
  overlay.addEventListener('animationend', event => { if (event.target === overlay && !event.pseudoElement) overlay.remove(); });
  document.body.append(overlay);
  // Also clean up if reduced motion is enabled while an entrance is playing.
  setTimeout(() => overlay.remove(), 6000);
}
