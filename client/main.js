import './style.css';
import './themes.css';
import './theme-effects.css';
import './alien-visitor.css';
import './theme-access.css';
import './simpsons.css';
import './diablo.css';
import './heroes.css';
import './zelda.css';
import './bricks.css';
import './backdrop.css';
import './city-list.css';
import './fantasy-list.css';
import './bridge-list.css';
import './nodes-list.css';
import './provider-icons.css';
import './agent-header.css';
import './lost.css';
import './feed.css';
import './paper.css';
import { providerIcon } from './provider-icons.js';
import { applyTheme, savedTheme, hasSavedTheme, themes, bootSequence } from './themes.js';
import { PanelNavigation } from './navigation.js';
import { HistoryScroll } from './history-scroll.js';
import { populateOnOpen } from './lazy-details.js';
import { placeShots } from './history-shots.js';
import { shotStrip, shotUrl, takeShotContainer } from './shot-strip.js';
import { ImagePanZoom } from './image-pan-zoom.js';
import { imageWindowUrl } from './image-window.js';
import { fieldLabel, requestPresentation } from './request-presentation.js';
import { SessionActivity, compareSessions, compareProjects, sessionPriority, recentlyActive, activeSessionGroups } from './session-order.js';
import { feedGroups, feedNow } from './feed.js';
import { messagingUnavailableReason } from './messaging-status.js';
import { ComposerInput, followKeyboard } from './composer-input.js';
import { attachment, imageFiles, maxImages, releaseImages } from './composer-images.js';
import { LiveRender } from './live-render.js';
import { renderMessageMarkdown, renderDocument } from './message-markdown.js';
import { copyText } from './copy-text.js';
import { documentSegments, matchDocument } from './document-links.js';
import { renderUsage } from './usage.js';
import { renderThemeConsole } from './theme-console.js';
import { paletteFor, savedColour, wearColours } from './bridge/palettes.js';
import { sceneFor, sceneAction } from './scenes.js';
import { hireChoices } from './hire.js';
import { agentSettings } from './agent-settings.js';
import { budgetDialog } from './spend.js';
import { createFolderField, hireCaret, hireRows } from './scene-ui.js';
import { alertSettings, saveAlerts, canNotify, statusEvents, signal, playSound, enableNotifications, disableNotifications, restoreNotifications, listenForOpen, faviconBadge } from './alerts.js';
import { reviewQueue } from './workspace-navigation.js';
import { showCommandPalette } from './command-palette.js';
import { showThemeGallery } from './theme-gallery.js';
import { reducedAtmosphere } from './atmosphere.js';
import './workspace-controls.css';
import './theme-signals.css';
import './ui-refinements.css';
import './workflow.css';
import { Workflow } from './workflow.js';
import { filterFeed, quietSession, lastObservedActivity } from './workflow-data.js';

const app = document.querySelector('#app');
const firstVisit = !hasSavedTheme();
applyTheme(savedTheme());
const idleMs = 10 * 60_000;
const sessionActivity = new SessionActivity();
const statValues = new Map();
const previousStatuses = new Map();
// Older history fetched for an open panel: session id → { limit, messages, more }.
const older = new Map();
// What an open panel lists from the server, listed again while its session changes.
function sessionList(cache, session, kind) {
  let entry = cache.get(session.id);
  if (!entry) cache.set(session.id, entry = { items: [], changed: null, fetched: 0 });
  if ((entry.changed !== session.updatedAt || (kind === 'images' && !entry.items.length)) && Date.now() - entry.fetched > 10_000) {
    entry.changed = session.updatedAt; entry.fetched = Date.now();
    api(`sessions/${encodeURIComponent(session.id)}/${kind}`).then(result => {
      const items = result[kind] || [];
      if (JSON.stringify(items) === JSON.stringify(entry.items)) return;
      entry.items = items;
      if (state.snapshot && state.selected === session.id) renderPanel(); else if (state.snapshot && state.selected === 'feed') renderFeed();
    }, () => {});
  }
  return entry.items;
}
// Screenshots a session looked at (server/images.mjs for Claude and its subagents, server/codex-images.mjs for Codex).
const shots = new Map(); // session id → { items, changed, fetched }
const sessionShots = session => sessionList(shots, session, 'images');
// Markdown files a session wrote or named (server/documents.mjs).
const docs = new Map(); // session id → { items, changed, fetched }
const sessionDocs = session => sessionList(docs, session, 'documents');
// Effort chosen here for Claude, shown until its transcript reports it.
const pendingEffort = new Map();
// When each session was last opened, so finished work you haven't looked at gets a dot.
const seenKey = 'ai-control-seen';
const seen = (() => { try { return new Map(JSON.parse(localStorage.getItem(seenKey) || '[]')); } catch { return new Map(); } })();
if (!seen.has('*')) seen.set('*', Date.now());
function markSeen(id) {
  if (!id || id === 'access' || id === 'feed') return;
  seen.set(id, Date.now());
  try { localStorage.setItem(seenKey, JSON.stringify([...seen].sort((a, b) => b[1] - a[1]).slice(0, 300))); } catch { /* per tab only */ }
}
const unread = session => workflow.review(session);
const liveRender = new LiveRender(() => renderData());
const groupingKey = 'ai-control-grouping';
const savedGrouping = () => { try { return localStorage.getItem(groupingKey) === 'flat' ? 'flat' : 'project'; } catch { return 'project'; } };
const filterKey = 'ai-control-filter';
const savedFilter = () => { try { const value = localStorage.getItem(filterKey); return ['all', 'active', 'attention', 'working', 'idle'].includes(value) ? value : 'all'; } catch { return 'all'; } };
function selectFilter(value) {
  state.filter = value;
  try { localStorage.setItem(filterKey, value); } catch { /* per tab only */ }
}
// The office's own option, under the themes: outlines on everything, or only on what's pointed at or picked.
const outlinesKey = 'ai-control-office-outlines';
let outlined = (() => { try { return localStorage.getItem(outlinesKey) !== 'off'; } catch { return true; } })();
const state = { csrf: '', snapshot: null, filter: savedFilter(), project: '', provider: 'all', grouping: savedGrouping(), search: '', selected: null, error: '', lastActivity: Date.now() };
const workflow = new Workflow({ api, getState: () => state, toast, openSession: openPanel, openFeed, renderRequests: renderSessionRequests, refresh,
  onPaneActivity: () => { if (state.csrf) state.lastActivity = Date.now(); },
  changed: () => { panelSignature = ''; liveRender.request(); },
  setView: view => { if (state.selected) { navigation.reset(); hidePanel(); } Object.assign(state, { project: view.project || '', provider: view.provider || 'all', search: view.search || '' }); selectFilter(view.filter || 'all'); const search = document.querySelector('.toolbar input[type=search]'); if (search) search.value = state.search; if (scene) setSceneList(true); else renderData(); },
});
const messageDrafts = workflow.drafts.entries;
document.documentElement.toggleAttribute('data-workflow-pane', new URLSearchParams(location.search).has('pane'));
const navigation = new PanelNavigation(window, id => {
  if (!state.csrf) return;
  if (!id) { hidePanel(); return; }
  state.selected = id; panelSignature = '';
  if (id === 'access') renderAccessPanel(); else if (id === 'feed') renderFeed(); else if (state.snapshot) renderPanel();
  syncMobileNavigation();
});
let poll, touching = 0, activityTimer, panelSignature = '', loading = false, clearing = false;
let palette = null, radarSelection = null;
const statuses = { working: ['Working', 'green'], idle: ['Idle', 'gray'], permission: ['Permission', 'amber'], question: ['Question', 'amber'], offline: ['Offline', 'gray'], error: ['Error', 'red'], unknown: ['Unknown', 'gray'] };
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-12 9h12m-8 4h4"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  restore: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8m0-5v5h5"/><path d="M12 7v5l3 2"/>',
  spinner: '<path d="M21 12a9 9 0 1 1-6.2-8.56"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11"/>',
  next: '<path d="m6 5 7 7-7 7m7-14 7 7-7 7"/>',
  exit: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m5-12 4 4-4 4m4-4H9"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21m9 0H7M5 11l9 9"/>',
  bridge: '<path d="M12 2c1.500 1.800 2.300 4.200 2.600 7l.4 2.500 5 4V12m0 3.500.9 5-6.400-1.500-.5 2.500h-4l-.5-2.500-6.400 1.500.9-5V12m0 3.500 5-4 .4-2.500c.3-2.800 1.100-5.200 2.600-7M12 6.500v2.500"/>',
  city: '<path d="M3 21h18M7 21V3M3 6h17M7 3 3 6m4-3 13 3M17 6v3m-2 0h4v3h-4zM12 21v-6h8v6"/>',
  fantasy: '<path d="M14.500 17.500 3 6V3h3l11.500 11.500M13 19l6-6m-3 3 4 4m-1 1 2-2M9.500 17.500 21 6V3h-3L6.500 14.500M11 19l-6-6m3 3-4 4m1 1-2-2"/>',
  agents: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10m0-5h10"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7m7 0a5 5 0 0 0 0-7M5.6 5.6a9 9 0 0 0 0 12.8m12.8 0a9 9 0 0 0 0-12.8"/>',
  nodes: '<path d="M15.600 4.860A8 8 0 0 1 19.990 12.450m-3.600 6.240a8 8 0 0 1-8.780 0M4.010 12.450A8 8 0 0 1 8.400 4.860" stroke-width="1.500"/><g fill="currentColor" stroke="none"><circle cx="12" cy="12" r="3.300"/><circle cx="12" cy="4" r="2.400"/><circle cx="18.930" cy="16" r="2.400"/><circle cx="5.070" cy="16" r="2.400"/></g>',
  office: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16m0-11h3a2 2 0 0 1 2 2v9M2 21h20M8 7h3m-3 4h3m-3 4h3"/>',
};
function icon(name) {
  const span = document.createElement('span'); span.className = 'icon'; span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.grid}</svg>`;
  return span;
}
function el(tag, className = '', text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function button(label, className, action, iconName) { const b = el('button', className); b.type = 'button'; if (iconName) b.append(icon(iconName)); b.append(el('span', '', label)); b.onclick = action; return b; }
function setProperty(node, key, value) { if (node[key] !== value) node[key] = value; }
// crypto.randomUUID needs HTTPS or localhost; plain HTTP over Tailscale has neither.
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function chooseTheme(id) {
  applyTheme(id);
  for (const card of document.querySelectorAll('#groups .session-card')) delete card.dataset.sig; // A look may draw its cards differently.
  // Keep the list/panel choice while changing looks; the scene button is an explicit way in.
  syncScene();
  dressTheme();
  renderData();
}
function themeMenu() {
  const control = el('div', 'theme-menu');
  const open = button('', 'quiet-button', () => showThemePicker(open), 'theme');
  open.setAttribute('aria-label', 'Change theme'); open.setAttribute('aria-haspopup', 'dialog'); open.title = 'Change theme';
  control.append(open); return control;
}
// Keep menus in the top layer, clear of scrolling parents, viewport edges and the phone tabs.
function placeMenu(menu, summary, choices) {
  choices.popover = 'manual';
  let listening;
  const position = () => {
    if (!menu.isConnected) { listening?.abort(); return; }
    const viewport = window.visualViewport, x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const nav = document.querySelector('.mobile-nav'), floor = Math.min(y + height, nav?.getClientRects().length ? nav.getBoundingClientRect().top : y + height);
    const r = summary.getBoundingClientRect(), above = Math.max(0, r.top - y - 14), below = Math.max(0, floor - r.bottom - 14);
    Object.assign(choices.style, { position: 'fixed', margin: '0', inset: 'auto', maxWidth: `${width - 16}px`, overflowY: 'auto', overscrollBehavior: 'contain' });
    const up = (menu.closest('.sidebar') || choices.scrollHeight > below) && above > below;
    choices.style.maxHeight = `${Math.max(0, Math.min(up ? above : below, floor - y - 16))}px`;
    choices.style.left = `${Math.max(x + 8, Math.min(r.right - choices.offsetWidth, x + width - choices.offsetWidth - 8))}px`;
    choices.style.top = `${Math.max(y + 8, Math.min(up ? r.top - choices.offsetHeight - 6 : r.bottom + 6, floor - choices.offsetHeight - 8))}px`;
  };
  menu.addEventListener('toggle', () => {
    listening?.abort();
    if (!menu.isConnected) return;
    choices.removeAttribute('style');
    if (!menu.open) { choices.hidePopover(); return; }
    choices.showPopover(); position();
    listening = new AbortController();
    const options = { signal: listening.signal };
    window.addEventListener('resize', position, options);
    window.visualViewport?.addEventListener('resize', position, options);
    window.visualViewport?.addEventListener('scroll', position, options);
    document.addEventListener('scroll', event => { if (!choices.contains(event.target)) position(); }, { ...options, capture: true });
    choices.querySelector('input')?.focus({ preventScroll: true });
    const current = choices.querySelector('[aria-pressed=true]');
    if (current && choices.scrollHeight > choices.clientHeight) choices.scrollTop = current.offsetTop - 6;
  });
}
// Opt-in notifications and the theme's sound; turning sound on plays it once.
function alertsMenu() {
  const menu = el('details', 'theme-menu alerts-menu');
  const summary = el('summary', 'quiet-button'); summary.append(icon('bell')); summary.setAttribute('aria-label', 'Alerts'); summary.title = 'Alerts';
  const choices = el('div', 'theme-options'); choices.setAttribute('aria-label', 'Alerts');
  const sync = () => { for (const option of choices.children) option.setAttribute('aria-pressed', String(!!alertSettings[option.dataset.alert])); menu.classList.toggle('alerts-on', alertSettings.notify || alertSettings.sound); };
  const notify = button('Notifications', 'theme-choice', async () => {
    notify.disabled = true;
    try {
      if (alertSettings.notify) { await disableNotifications(api); alertSettings.notify = false; }
      else alertSettings.notify = await enableNotifications(api);
      saveAlerts(); sync();
    } catch (error) { toast(error.message || 'Could not update notifications'); }
    finally { notify.disabled = false; }
  }, 'bell');
  notify.dataset.alert = 'notify';
  if (!canNotify()) notify.title = globalThis.isSecureContext ? 'Add to Home Screen to enable notifications' : 'Needs HTTPS';
  const sound = button('Sound', 'theme-choice', () => { alertSettings.sound = !alertSettings.sound; saveAlerts(); sync(); if (alertSettings.sound) playSound('on'); }, 'sound');
  sound.dataset.alert = 'sound';
  choices.append(notify, sound); menu.append(summary, choices); placeMenu(menu, summary, choices); sync();
  return menu;
}
// Each theme names the control room after its own computer; CSS shows the active one.
wearColours(paletteFor(savedColour()));
const brandNames = { modern: 'AI Control', bridge: 'Bridge', alien: 'MU/TH/UR', command: 'EVA', simpsons: 'Springfield', heroes: 'Heroes', zelda: 'Zelda', diablo: 'Sanctuary', city: 'Metropolis', fantasy: 'Fantasy Battle', bricks: 'Brick Knights', nodes: 'Nodes' };
function brand(openMenu) {
  const logo = el(openMenu ? 'button' : 'div', 'brand');
  if (openMenu) {
    logo.type = 'button'; logo.title = 'Open menu'; logo.setAttribute('aria-label', 'Open menu'); logo.setAttribute('aria-haspopup', 'dialog');
    logo.onclick = () => openMenu(logo);
  } else { logo.setAttribute('role', 'img'); logo.setAttribute('aria-label', 'AI Control'); }
  for (const [id, name] of Object.entries(brandNames)) {
    const variant = el('span', `brand-variant ${id}`), mark = el('span', 'brand-mark');
    if (id === 'modern') for (let i = 0; i < 3; i++) mark.append(el('i'));
    variant.append(mark, el('span', 'brand-name', name)); logo.append(variant);
  }
  return logo;
}
function badge(status) { const [label, color] = statuses[status] || statuses.unknown; const node = el('span', `badge ${color}`); node.append(el('i', 'dot'), el('span', '', label)); return node; }
const needsInput = session => ['permission', 'question'].includes(session.status);
// The sidebar's filter and project as a test on a session; null while it's all of them. The list shows who passes, the
// office outlines them.
const picked = () => state.filter === 'all' && !state.project ? null
  : s => (!state.project || (s.cwd || s.project) === state.project) && (state.filter === 'all' || (state.filter === 'active' ? sessionPriority(s) < 2 || recentlyActive(s) : state.filter === 'attention' ? needsInput(s) : s.status === state.filter));
const providerName = provider => ({ codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' })[provider] || provider;
function age(time) { if (!time) return 'No activity time'; const seconds = Math.max(0, (Date.now() - time) / 1000); return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`; }

async function api(path, body, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') showLogin();
    throw Object.assign(new Error(data.error || 'Could not connect to AI Control.'), { code: data.code, taken: data.taken });
  }
  return data;
}

function showLogin(message = '') {
  workflow.reset();
  palette?.close(); closeAccountMenu?.();
  disposeHistory();
  disposeComposer(); liveRender.cancel();
  messageDrafts.clear(); shots.clear(); docs.clear();
  clearTimeout(activityTimer); activityTimer = null;
  clearInterval(poll); closeScene(); state.csrf = ''; state.snapshot = null; state.selected = null; panelSignature = ''; document.body.classList.remove('panel-open');
  app.replaceChildren(); document.documentElement.removeAttribute('data-attention'); document.documentElement.removeAttribute('data-working');
  const screen = el('main', 'login-screen');
  screen.append(themeMenu());
  const card = el('section', 'login-card');
  const symbol = el('div', 'login-symbol'); symbol.append(icon('lock'));
  const display = el('div', 'login-display'); display.append(brand(), symbol); card.append(display);
  const form = el('form', 'login-form');
  const input = el('input'); input.id = 'password'; input.type = 'password'; input.autocomplete = 'current-password'; input.required = true; input.placeholder = 'Enter your password'; input.maxLength = 1024; input.setAttribute('aria-label', 'PIN or password');
  const error = el('p', 'form-error', message); error.setAttribute('role', 'alert');
  const submit = el('button', 'primary', 'Unlock'); submit.type = 'submit';
  form.append(input, error, submit);
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true; submit.textContent = 'Unlocking…'; error.textContent = '';
    try { const result = await api('login', { password: input.value }); input.value = ''; state.csrf = result.csrf; state.lastActivity = Date.now(); showWorkspace(); await refresh(); }
    catch (e) { error.textContent = e.message; submit.disabled = false; submit.textContent = 'Unlock'; }
  };
  card.append(form); screen.append(card);
  app.append(screen);
  // Fantasy starts like a console: the boot logo comes before the title screen, not after it.
  if (document.documentElement.dataset.theme === 'fantasy') { bootSequence(); if (globalThis.matchMedia?.('(hover: hover)').matches) input.focus(); }
  api('auth').then(data => {
    if (!input.isConnected) return;
    const pin = data.kind === 'pin'; input.setAttribute('aria-label', pin ? 'PIN' : 'Password');
    input.inputMode = pin ? 'numeric' : 'text'; input.placeholder = pin ? 'Enter your PIN' : 'Enter your password';
    input.maxLength = pin ? 8 : 1024;
  }).catch(() => {});
}

function highlightRadarSession(id) {
  for (const card of document.querySelectorAll('.session-card')) card.toggleAttribute('data-radar-selected', document.documentElement.dataset.theme === 'command' && card.dataset.sessionId === id);
}
function syncThemeConsole() {
  if (!state.snapshot) return;
  if (!state.snapshot.sessions.some(s => s.id === radarSelection)) radarSelection = null;
  renderThemeConsole(document.querySelector('#theme-console'), state.snapshot.sessions, {
    disconnected: !!state.error, selectedId: radarSelection, onSelect: openPanel,
    onInspect: (id, { selected = false } = {}) => { if (selected) radarSelection = id; highlightRadarSession(id || radarSelection); },
    onNext: id => { const next = nextWaiting(id); if (next) openPanel(next.id); },
  });
}
function mobileNavigation() {
  const nav = el('nav', 'mobile-nav'); nav.setAttribute('aria-label', 'Workspace tabs');
  for (const [view, label, glyph] of [['all', 'Sessions', 'grid'], ['active', 'Active', 'play'], ['attention', 'Needs you', 'bell'], ['feed', 'Feed', 'live']]) {
    const item = button(label, 'mobile-nav-button', () => view === 'feed' ? openFeed() : showSessionList(view), glyph);
    item.dataset.mobileView = view; item.append(el('span', 'mobile-nav-count')); nav.append(item);
  }
  return nav;
}
function syncMobileNavigation() {
  const count = (state.snapshot?.sessions || []).filter(needsInput).length;
  const mobileFeed = state.selected === 'feed' && !!document.querySelector('.mobile-nav')?.getClientRects().length;
  document.querySelector('#panel')?.setAttribute('aria-modal', String(!mobileFeed && !document.body.classList.contains('wf-split-open')));
  for (const item of document.querySelectorAll('[data-mobile-view]')) {
    const view = item.dataset.mobileView, current = state.selected === 'feed' ? 'feed' : ['active', 'attention'].includes(state.filter) ? state.filter : 'all';
    if (view === current) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    const badge = item.querySelector('.mobile-nav-count'); badge.textContent = view === 'attention' && count ? count : '';
  }
}
function showSessionList(filter = 'all') {
  if (state.selected) { navigation.reset(); hidePanel(); }
  selectFilter(filter); state.project = ''; state.provider = 'all'; state.search = '';
  const search = document.querySelector('.toolbar input[type=search]'); if (search) search.value = '';
  if (sceneFor(document.documentElement.dataset.theme)) setSceneList(true); else renderData();
}
function workspaceCommands() {
  const sessions = state.snapshot?.sessions || [];
  return [
    ...workflow.commands(),
    { id: 'needs', label: 'Needs you', detail: 'Waiting questions and permissions', shortcut: 'n', run: () => nextWaiting(state.selected) ? openNext() : showSessionList('attention') },
    { id: 'sessions', label: 'All sessions', detail: 'Open the session list', run: () => showSessionList('all') },
    { id: 'feed', label: 'Live feed', detail: 'Every session on one timeline', shortcut: 'f', run: openFeed },
    { id: 'search', label: 'Find a session', detail: 'Search sessions and projects', shortcut: '/', run: () => { showSessionList('all'); document.querySelector('.toolbar input[type=search]')?.focus(); } },
    { id: 'new', label: 'New agent', detail: 'Choose a folder and provider', disabled: !!state.error, run: () => { showSessionList('all'); const menu = document.querySelector('#new-agent-menu'); if (menu) menu.open = true; } },
    { id: 'themes', label: 'Themes', detail: 'Gallery, favourites and atmosphere', run: () => showThemePicker(document.activeElement) },
    ...sessions.toSorted(compareSessions).map(session => ({ id: `session:${session.id}`, label: session.title || 'Untitled session', detail: [session.project, providerName(session.provider), (statuses[session.status] || statuses.unknown)[0]].join(' · '), keywords: `${session.cwd || ''} ${session.model || ''} ${session.branch || ''}`, run: () => { if (state.snapshot?.sessions.some(s => s.id === session.id)) openPanel(session.id); } })),
    ...themes.map(theme => ({ id: `theme:${theme.id}`, label: theme.name, detail: 'Theme', keywords: `appearance ${theme.id} ${theme.look || ''}`, run: () => chooseTheme(theme.id) })),
  ];
}
function openCommands(trigger = document.activeElement) {
  if (!state.csrf || document.querySelector('dialog[open]')) return;
  closeAccountMenu?.();
  palette = showCommandPalette({ trigger, commands: workspaceCommands(), onClose: () => { palette = null; } });
}
function renderReviewQueue(header, session) {
  const queue = reviewQueue(state.snapshot.sessions, session.id);
  let row = header.querySelector('.review-queue');
  if (!queue.total) { row?.remove(); return; }
  if (!row) {
    row = el('div', 'review-queue');
    const next = button('', 'review-next', openNext); next.title = 'Next waiting (n)';
    row.append(el('strong', 'review-position'), el('span', 'review-age'), next); header.append(row);
  }
  setProperty(row.querySelector('.review-position'), 'textContent', queue.position ? `${queue.position} of ${queue.total}` : `${queue.total} waiting`);
  setProperty(row.querySelector('.review-age'), 'textContent', queue.waitMs == null ? '' : `Waiting ${duration(queue.waitMs)}`);
  const next = row.querySelector('.review-next'); next.hidden = !queue.next;
  setProperty(next.lastElementChild, 'textContent', queue.next ? `Next: ${queue.next.title}` : '');
  next.title = queue.next ? `Next waiting (n): ${queue.next.project} · ${queue.next.title}` : '';
}

function showWorkspace() {
  app.innerHTML = '';
  const shell = el('div', 'shell');
  const aside = el('aside', 'sidebar'); aside.append(brand());
  const console = el('div', 'theme-console'); console.id = 'theme-console'; aside.append(console, el('div', 'sidebar-label', 'WORKSPACE'));
  const nav = el('nav', 'main-nav'); nav.setAttribute('aria-label', 'Workspace'); nav.id = 'navigation'; aside.append(nav);
  const feed = button('Live feed', 'nav-item feed-nav', openFeed, 'live'); feed.title = 'Every session on one timeline (f)'; feed.append(el('span', 'nav-count')); aside.append(feed);
  aside.append(el('div', 'sidebar-label project-label', 'PROJECTS'), el('nav', 'project-nav')); aside.lastChild.id = 'projects'; aside.lastChild.setAttribute('aria-label', 'Projects');
  shell.append(aside);
  const content = el('div', 'workspace');
  const topbar = el('header', 'topbar');
  const topActions = el('div', 'top-actions'); const live = el('span', 'live-label', 'Connecting…'); live.id = 'connection'; const access = button('PIN', 'quiet-button access-button', () => { previousFocus = document.activeElement; navigation.open('access'); }, 'key'); access.title = 'Change PIN / password'; const lockButton = button('Lock', 'quiet-button', () => lock(), 'lock'); lockButton.title = 'Lock now'; const feedButton = button('Feed', 'quiet-button feed-button', openFeed, 'live'); feedButton.title = 'Live feed (f)'; const officeButton = button('Office', 'quiet-button office-button', () => setSceneList(false), 'office'); officeButton.title = 'Back to the office'; topActions.append(live, officeButton, feedButton, alertsMenu(), themeMenu(), access, lockButton); topbar.append(brand(openCommands)); content.append(topbar);
  // Desktop has no top bar: its controls sit at the bottom of the sidebar.
  const wide = matchMedia('(min-width: 641px)'), placeActions = () => (wide.matches ? aside : topbar).append(topActions);
  wide.onchange = () => { placeActions(); syncMobileNavigation(); }; placeActions();
  const main = el('main', 'main-content');
  const heading = el('div', 'page-heading'); const headingText = el('div'); headingText.append(el('h1', '', 'Sessions')); heading.append(headingText);
  const machineLabel = el('span', 'machine-label'); machineLabel.id = 'machine'; heading.append(machineLabel); const statusLine = el('div', 'status-line'); statusLine.id = 'status-line'; main.append(statusLine, heading);
  const notice = el('div', 'connection-error'); notice.id = 'error'; notice.setAttribute('role', 'status'); notice.hidden = true; main.append(notice);
  const stats = el('div', 'stats'); stats.id = 'stats'; main.append(stats);
  const usage = el('section', 'usage'); usage.id = 'usage'; usage.setAttribute('aria-label', 'Usage limits'); main.append(usage);
  const toolbar = el('div', 'toolbar'); const menu = el('details', 'filter-menu'); menu.id = 'agent-filter-menu';
  const summary = el('summary', 'quiet-button', '…'); summary.setAttribute('aria-label', 'Session options'); summary.title = 'Session options'; menu.append(summary);
  const tabs = el('div', 'filter-options'); tabs.setAttribute('aria-label', 'Agent provider'); tabs.append(el('span', 'sidebar-label', 'SHOW AGENTS'));
  for (const [value, label] of [['all', 'All agents'], ['codex', 'Codex'], ['claude', 'Claude Code'], ['opencode', 'OpenCode']]) { const tab = button(label, 'tab', () => { state.provider = value; menu.open = false; renderData(); }); tab.dataset.provider = value; tabs.append(tab); }
  tabs.append(el('span', 'sidebar-label', 'GROUP'));
  for (const [value, label] of [['project', 'By project'], ['flat', 'Flat list']]) { const tab = button(label, 'tab', () => { state.grouping = value; try { localStorage.setItem(groupingKey, value); } catch { /* per-tab only */ } menu.open = false; renderData(); }); tab.dataset.grouping = value; tabs.append(tab); }
  tabs.append(el('span', 'sidebar-label', 'VIEW'));
  for (const [value, label] of [['all', 'All sessions'], ['active', 'Active'], ['attention', 'Needs you'], ['working', 'Working'], ['idle', 'Idle']]) {
    const tab = button(label, 'tab', () => { selectFilter(value); state.project = ''; menu.open = false; renderData(); scene?.pick(picked(), true); }); tab.dataset.sessionFilter = value; tabs.append(tab);
  }
  const searchBox = el('label', 'search'); searchBox.append(icon('search')); const search = el('input'); search.type = 'search'; search.placeholder = 'Find a session…'; search.title = '/ search · j k move · n next waiting · f live feed'; search.setAttribute('aria-label', 'Search sessions and projects'); search.oninput = () => { state.search = search.value; liveRender.interact(); liveRender.request(); }; searchBox.append(search);
  // Folded to an icon button until used, styled as one by every theme; the label still focuses the input, so a click or / opens it.
  const fold = () => { const folded = !search.value && document.activeElement !== search; searchBox.classList.toggle('folded', folded); searchBox.classList.toggle('search', !folded); searchBox.classList.toggle('quiet-button', folded); }; search.onfocus = search.onblur = fold; fold(); searchBox.title = 'Find a session (/)'; menu.append(tabs); // The scene themes' way back, where the eye is while looking for a session; the small one in the sidebar footer is easy to miss.
  const sceneSwitch = button('Scene', 'quiet-button scene-switch', () => setSceneList(false), 'office'); sceneSwitch.title = 'Back to the scene';
  const commands = button('', 'quiet-button command-trigger', () => openCommands(commands), 'terminal'); commands.title = 'Commands (Ctrl / ⌘ K)'; commands.setAttribute('aria-label', 'Commands'); commands.setAttribute('aria-haspopup', 'dialog');
  toolbar.append(sceneSwitch, searchBox, commands, menu, newAgentMenu()); workflow.mount(toolbar); main.append(toolbar);
  const create = button('New OpenCode session', 'tab new-session-button', () => { menu.open = false; newOpenCodeSession(); }, 'plus');
  tabs.append(create);
  placeMenu(menu, summary, tabs);
  const lost = el('section', 'lost'); lost.id = 'lost'; lost.hidden = true; lost.setAttribute('aria-label', 'Lost sessions'); main.append(lost);
  const groups = el('div', 'groups'); groups.id = 'groups'; groups.append(el('div', 'empty', 'Connecting to your local agents…')); main.append(groups);
  const integrations = el('section', 'integrations'); integrations.id = 'integrations'; main.append(integrations);
  const screen = el('div', 'main-screen'); screen.append(main); content.append(screen); shell.append(content); app.append(shell);
  // A scene showing beside the panel stays in reach: a session clicked through the backdrop takes the panel's place, and the wheel still scrolls it.
  const backdrop = el('div', 'panel-backdrop'); backdrop.id = 'backdrop'; backdrop.hidden = true;
  const through = event => scene?.at?.(event.clientX, event.clientY) ?? null;
  // The scene's own commands too: most take the panel's place, those marked `beside` work with it still open.
  const command = event => scene?.control?.(event.clientX, event.clientY) ?? null;
  backdrop.onclick = event => {
    const control = command(event);
    if (control) { if (!('beside' in control.dataset)) closePanel(); control.click(); return; }
    const id = through(event); if (!id) closePanel(); else if (id !== state.selected) navigation.open(id, { replace: true });
  };
  backdrop.onwheel = event => { if (scene?.scroll?.(event.clientX, event.clientY, event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1))) event.preventDefault(); };
  backdrop.onpointermove = event => { if (event.pointerType !== 'mouse' || !scene?.at) return; backdrop.style.cursor = through(event) || command(event) ? 'pointer' : ''; scene.hover?.(event.clientX, event.clientY); };
  backdrop.onpointerleave = () => scene?.hover?.(null);
  const panel = el('section', 'detail-panel'); panel.id = 'panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Session details');
  app.append(backdrop, panel, mobileNavigation());
  restoreNotifications(api);
  workflow.load();
  poll = setInterval(refresh, 3000);
  navigation.sync();
  if (!document.querySelector('.theme-picker')) bootSequence();
}

async function refresh() {
  if (loading || !state.csrf || document.hidden) return;
  loading = true;
  try {
    const snapshot = await api('snapshot');
    if (!state.csrf) return;
    workflow.adopt(snapshot.workspace);
    snapshot.sessions = sessionActivity.observe(snapshot.sessions).map(session => ({ ...session, originalTitle: session.title, title: workflow.title(session) }));
    signal(statusEvents(previousStatuses, snapshot.sessions));
    state.snapshot = snapshot; state.error = ''; liveRender.request();
  } catch (error) {
    if (state.csrf) { state.error = error.message; liveRender.request(); }
  } finally { loading = false; }
}

// Scene themes swap the list for a 3D scene, downloaded only once it is chosen.
// Its ☰ shows the list in the same look (the scene is unmounted meanwhile) and a button goes back; the choice is remembered.
const sceneViewKey = 'ai-control-office-view';
// Phones open on the list until the scene is picked: it's the quicker check on a small screen.
const phone = () => !!globalThis.matchMedia?.('(max-width: 640px) and (pointer: coarse)').matches;
const sceneModules = {};
let scene = null, sceneLook = null, failedLook = null, sceneList = (() => { try { return (localStorage.getItem(sceneViewKey) ?? (phone() ? 'list' : 'scene')) === 'list'; } catch { return phone(); } })();
function setSceneList(list) {
  sceneList = list; try { localStorage.setItem(sceneViewKey, list ? 'list' : 'scene'); } catch { /* per-tab only */ }
  syncScene(); renderData();
  if (list) document.querySelector('.office-button')?.focus();
}
// City's list and panel show each session's own tower, baked by the scene's generator; Fantasy's sidebar map puts each party on its land. Each loaded only for its theme.
let portraits = null, portraitsLoading = false, worldMap = null, worldMapLoading = false;
function dressTheme() {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'fantasy') {
    if (worldMap) { worldMap.dressMap(document.querySelector('#theme-console .console-screen'), state.snapshot); return; }
    if (worldMapLoading) return;
    worldMapLoading = true;
    import('./fantasy/worldmap.js').then(module => { worldMap = module; dressTheme(); }).catch(() => { /* The map only lacks its dots. */ }).finally(() => { worldMapLoading = false; });
    return;
  }
  if (theme !== 'city') return;
  if (portraits) { portraits.dressList(document, state.snapshot, { error: !!state.error, reduced: reducedMotion.matches, selected: state.selected }); return; }
  if (portraitsLoading) return;
  portraitsLoading = true;
  import('./city/portrait.js').then(module => { portraits = module; dressTheme(); }).catch(() => { /* The list is complete without them. */ }).finally(() => { portraitsLoading = false; });
}
// A scene that throws while unmounting has already stopped drawing: its box goes anyway, or its last frame stays up, frozen.
function closeScene() { try { scene?.unmount(); } catch (error) { console.error(error); } scene = null; sceneLook = null; document.querySelector('.main-content > .scene')?.remove(); }
function syncScene() {
  const root = document.documentElement, main = document.querySelector('.main-content'), look = root.dataset.theme, entry = sceneFor(look);
  root.toggleAttribute('data-scene-list', !!entry && sceneList);
  if (failedLook !== look) { failedLook = null; root.removeAttribute('data-scene-fallback'); }
  for (const back of document.querySelectorAll('.office-button, .scene-switch')) {
    if (!entry || back.dataset.look === look) continue;
    back.dataset.look = look; back.title = `Back to the ${entry.name.toLowerCase()}`; back.firstElementChild.replaceWith(icon(look));
    if (back.classList.contains('office-button')) back.lastElementChild.textContent = entry.name;
  }
  const action = sceneAction(sceneLook, main && entry ? look : null, sceneList);
  if (action === 'unmount' || action === 'swap') closeScene();
  if (action === 'unmount' || action === 'none') { document.querySelector('.main-content > .scene')?.remove(); return; }
  // Any failure (download, no WebGL2, renderer refused) shows the list once and stays that way for this look.
  const fallBack = message => { failedLook = look; root.setAttribute('data-scene-fallback', ''); document.querySelector('.main-content > .scene')?.remove(); toast(message); };
  // A scene bug must not take the session list down with it.
  if (action === 'keep') { if (state.snapshot) try { scene.update(state.snapshot, { error: state.error }); } catch (error) { console.error(error); closeScene(); fallBack(`${entry.name} stopped; showing the list`); } return; }
  if (root.hasAttribute('data-scene-fallback')) return;
  const module = sceneModules[look];
  if (!module) { sceneModules[look] = entry.load().then(loaded => { sceneModules[look] = loaded; syncScene(); }, () => { delete sceneModules[look]; if (document.documentElement.dataset.theme === look) fallBack(`${entry.name} failed to load; showing the list`); }); return; }
  if (module instanceof Promise) return;
  if (!module.webglAvailable()) { fallBack(`${entry.name} needs ${entry.needs || 'WebGL 2'}; showing the list`); return; }
  const box = el('div', 'scene'); box.id = look; main.append(box);
  try {
    sceneLook = look;
    scene = module.mount(box, { mapScreen: () => document.querySelector('#theme-console .console-screen'), openPanel, nextWaiting: () => nextWaiting(), showList: () => setSceneList(true), isUnread: unread, selected: () => state.selected, describe: sessionFacts, spawn: spawnAgent, editBudget, api: (path, body) => api(path, body), showShots: (id, images, closed) => images.length ? showShot(id, images.at(-1).id, images, closed) : closed() });
    if (state.snapshot) scene.update(state.snapshot, { error: state.error });
    scene.pick(picked(), false); scene.outlines?.(outlined);
  } catch (error) { console.error(error); closeScene(); fallBack(`${entry.name} could not start; showing the list`); }
}

const editBudget = account => budgetDialog(account, async budget => { await api('usage/opencode/budget', budget); toast('Budget saved'); await refresh(); });
function renderData() {
  workflow.update();
  palette?.update(workspaceCommands());
  syncMobileNavigation();
  document.querySelector('.new-session-dialog')?.updateConnection?.();
  if (!state.snapshot || !document.querySelector('#groups')) {
    const error = document.querySelector('#error'); if (error && state.error) { error.hidden = false; error.textContent = state.error; } return;
  }
  syncScene();
  const { sessions, providers } = state.snapshot;
  const count = sessions.filter(needsInput).length;
  setProperty(document, 'title', `${count ? `(${count}) ` : ''}AI Control`);
  document.documentElement.toggleAttribute('data-attention', count > 0);
  faviconBadge(count);
  // Orbit's logo gets a satellite per working session, up to three.
  document.documentElement.dataset.working = String(Math.min(3, sessions.filter(s => s.status === 'working').length));
  // The overview is covered and inert while a panel is open. Render it once
  // when returning, instead of rebuilding every card behind the chat.
  if (state.selected) {
    if (state.selected === 'feed') renderFeed(); else if (state.selected !== 'access') renderPanel();
    return;
  }
  const connection = document.querySelector('#connection'); connection.className = `live-label ${state.error ? 'disconnected' : ''}`; connection.textContent = state.error ? 'Connection lost' : 'Live updates'; connection.title = connection.textContent;
  const error = document.querySelector('#error'); error.hidden = !state.error; error.textContent = state.error ? `${state.error} Showing the last received status. Actions are disabled until reconnected.` : '';
  document.querySelector('#machine').textContent = state.snapshot.machine;
  const usage = document.querySelector('#usage'), usageSignature = JSON.stringify([state.snapshot.usage, !!state.error, Math.floor(Date.now() / 60_000)]);
  if (usage.dataset.sig !== usageSignature) { usage.dataset.sig = usageSignature; renderUsage(usage, state.snapshot.usage, { disconnected: !!state.error, editBudget }); }
  renderLost(document.querySelector('#lost'), state.snapshot.lost || [], state.snapshot.lostChecking || 0);
  syncThemeConsole();
  const working = sessions.filter(s => s.status === 'working').length, idle = sessions.filter(s => s.status === 'idle').length;
  const active = state.filter === 'active', flat = active || state.grouping === 'flat';
  const setFilter = value => () => { selectFilter(value); state.project = ''; renderData(); scene?.pick(picked(), true); };
  // Desktop filters live here; phones use the bottom tabs and Session options.
  syncList(document.querySelector('#navigation'), [['all', 'All sessions', 'grid', sessions.length], ['active', 'Active', 'play', count + working], ['attention', 'Needs you', 'bell', count], ['working', 'Working', 'activity', working], ['idle', 'Idle', 'moon', idle]]
    .map(([value, label, glyph, number]) => [value, [value, label, glyph, number, state.filter === value && !state.project]]),
    ([value, label, glyph, number, active]) => { const b = button(label, `nav-item ${active ? 'active' : ''}`, setFilter(value), glyph); b.append(el('span', 'nav-count', number)); return b; });
  setProperty(document.querySelector('.feed-nav .nav-count'), 'textContent', working || '');
  const projects = new Map(); for (const session of sessions) { const key = session.cwd || session.project; if (!projects.has(key)) projects.set(key, { name: session.project, sessions: [] }); projects.get(key).sessions.push(session); }
  syncList(document.querySelector('#projects'), projects.size ? [...projects].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([key, project]) => [key, [key, project.name, state.project === key, project.sessions.filter(needsInput).length]]) : [['none', null]],
    data => {
      if (!data) return el('span', 'no-projects', 'Projects appear with sessions');
      const [key, name, active, waiting] = data;
      const b = button(name, `nav-item ${active ? 'active' : ''}`, () => { state.project = state.project === key ? '' : key; selectFilter('all'); renderData(); scene?.pick(picked(), !!state.project); }, 'folder'); b.title = key; b.append(el('span', 'project-dot', waiting || '')); return b;
    });
  syncList(document.querySelector('#stats'), [
    ['all', 'All', sessions.length, `${projects.size} projects on this computer`, ''],
    ['active', 'Active', count + working, 'Needs you and working', ''],
    ['attention', 'Needs you', count, count ? 'A quick decision keeps things moving' : 'You’re all caught up', 'amber'],
    ['working', 'Working', working, 'Agents making progress', 'green'],
    ['idle', 'Idle', idle, 'Ready for the next task', 'gray'],
  ].map(([value, ...rest]) => [value, [value, ...rest, state.filter === value]]), ([value, title, number, detail, color, selected]) => {
    const b = button('', `stat ${color} ${selected ? 'selected' : ''}`, setFilter(value));
    const digits = el('strong', `stat-number${statValues.has(value) && statValues.get(value) !== number ? ' tick' : ''}`, number); statValues.set(value, number);
    b.replaceChildren(el('span', 'stat-title', title), digits, el('span', 'stat-detail', detail)); return b;
  });
  for (const tab of document.querySelectorAll('[data-provider]')) { tab.classList.toggle('active', tab.dataset.provider === state.provider); tab.setAttribute('aria-pressed', String(tab.dataset.provider === state.provider)); }
  for (const tab of document.querySelectorAll('[data-grouping]')) {
    const selected = tab.dataset.grouping === (flat ? 'flat' : 'project');
    tab.classList.toggle('active', selected); tab.setAttribute('aria-pressed', String(selected));
    tab.disabled = active; tab.title = active ? 'Active sessions are ordered by status' : '';
  }
  for (const tab of document.querySelectorAll('[data-session-filter]')) tab.setAttribute('aria-pressed', String(tab.dataset.sessionFilter === state.filter));
  const filterMenu = document.querySelector('#agent-filter-menu'); filterMenu.classList.toggle('filtered', state.provider !== 'all'); filterMenu.querySelector('summary').setAttribute('aria-label', `Session options: ${state.provider === 'all' ? 'All agents' : providerName(state.provider)}`);
  const focusedSession = document.activeElement?.classList.contains('session-card') ? document.activeElement.dataset.sessionId : null;
  const groups = document.querySelector('#groups');
  const pick = picked(), visible = sessions.filter(s => (!pick || pick(s)) && (state.provider === 'all' || s.provider === state.provider) && `${s.title} ${s.project} ${s.cwd} ${s.model}`.toLowerCase().includes(state.search.toLowerCase()));
  const visibleGroups = new Map(); for (const session of visible) { const key = session.cwd || session.project; if (!visibleGroups.has(key)) visibleGroups.set(key, []); visibleGroups.get(key).push(session); }
  // Current sessions stay in status order; recent ones follow below their own divider.
  const sorted = active ? activeSessionGroups(sessions, visible)
    : flat ? (visible.length ? [['', visible]] : []) : [...visibleGroups].sort(compareProjects);
  const before = flipPositions(groups);
  syncList(groups, visible.length ? sorted.map(([cwd]) => [cwd, null]) : [['empty', [state.filter === 'attention', sessions.length]]], data => {
    if (!data) { const group = el('section', 'project-group'); group.append(el('div', 'group-heading'), el('div', 'session-list')); return group; }
    const [attention, total] = data, empty = el('div', 'empty');
    empty.append(icon(attention ? 'check' : 'terminal'), el('h2', '', attention ? 'Nothing needs your attention.' : total ? 'No sessions match.' : 'No sessions yet.'));
    return empty;
  });
  const sessionsById = new Map();
  for (const [cwd, list] of sorted) {
    const group = [...groups.children].find(node => node.dataset.key === cwd), header = group.firstChild;
    const recent = active && cwd === 'recent';
    group.classList.toggle('recent-group', recent);
    const headerSignature = JSON.stringify([list[0].project, list.length, cwd, recent, hireSignature(cwd)]);
    header.hidden = flat && !recent;
    if (recent && header.dataset.sig !== headerSignature) {
      header.dataset.sig = headerSignature;
      const title = el('div', 'group-title'); title.append(el('h2', '', 'Recently active'), el('span', 'group-count', list.length));
      const retention = el('span', 'project-path', '1h'); retention.title = 'Kept for one hour after activity stops';
      header.replaceChildren(title, retention);
    } else if (!flat && header.dataset.sig !== headerSignature) {
      header.dataset.sig = headerSignature;
      const title = el('div', 'group-title'); title.append(el('h2', '', list[0].project), el('span', 'group-count', list.length));
      header.replaceChildren(title, el('span', 'project-path', cwd.replace(/^\/home\/[^/]+/, '~')), projectSpawn(cwd));
    }
    // Outside Active, subagents sit directly under their parent; orphans keep their own place.
    const ordered = active ? list : list.sort((a, b) => Number(!!workflow.meta(b).pinned) - Number(!!workflow.meta(a).pinned) || compareSessions(a, b)), ids = new Set(ordered.map(s => s.id));
    const withChildren = s => [s, ...ordered.filter(child => child.parentId === s.id).flatMap(withChildren)];
    const cards = active ? ordered : ordered.filter(s => !ids.has(s.parentId)).flatMap(withChildren);
    syncList(group.lastChild, cards.map(session => {
      sessionsById.set(session.id, session);
      const lastMessage = session.messages?.at(-1);
      return [session.id, { id: session.id, provider: session.provider, status: session.status, title: `${workflow.meta(session).pinned ? '★ ' : ''}${workflow.title(session)}`, branch: session.branch, parentId: session.parentId, nested: !!session.parentId && ids.has(session.parentId), agentKind: session.agentKind, kind: session.parentId ? session.model : '', project: flat && !session.parentId ? session.project : '', needs: needsInput(session), waitingOn: session.waitingOn, detail: cardDetail(session), last: lastMessage && [lastMessage.role, plainText(lastMessage.text).slice(0, 400)],
        plan: planProgress(session), mode: modeLabels[session.permissionMode] ? session.permissionMode : '', context: contextPercent(session.context), compacting: compacting(session), unread: unread(session) }];
    }), renderCard);
  }
  for (const card of groups.querySelectorAll('.session-card')) {
    const session = sessionsById.get(card.dataset.key);
    card.classList.toggle('wf-no-activity', quietSession(session, workflow.saved.preferences.quietMinutes ?? 15));
    let quietBadge = card.querySelector('.wf-quiet-badge');
    if (card.classList.contains('wf-no-activity')) {
      if (!quietBadge) { quietBadge = el('span', 'wf-quiet-badge'); card.querySelector('.session-body').append(quietBadge); }
      quietBadge.textContent = `No activity · ${Math.floor((Date.now() - lastObservedActivity(session)) / 60000)}m`;
      quietBadge.title = `Last observed event: ${new Date(lastObservedActivity(session)).toLocaleString()}`;
    } else quietBadge?.remove();
    setProperty(card.querySelector('.session-age'), 'textContent', active && sessionPriority(session) > 1 ? age(session.inactiveSince) : stateAge(session));
    card.toggleAttribute('data-radar-selected', document.documentElement.dataset.theme === 'command' && session.id === radarSelection);
  }
  flipFrom(groups, before);
  if (focusedSession && document.activeElement?.dataset.sessionId !== focusedSession) [...groups.querySelectorAll('[data-session-id]')].find(card => card.dataset.sessionId === focusedSession)?.focus({ preventScroll: true });
  const integrations = document.querySelector('#integrations'), integrationSignature = JSON.stringify(providers);
  if (integrations.dataset.sig !== integrationSignature) {
    integrations.dataset.sig = integrationSignature; integrations.replaceChildren(el('h2', '', 'Agent connections'));
    for (const provider of providers) {
      const row = el('div', 'integration'); const status = el('span', `connection-dot ${provider.connected ? 'online' : ''}`); row.title = provider.detail; row.append(status, el('strong', '', provider.name), el('span', 'muted', provider.detail)); integrations.append(row);
    }
  }
  dressTheme();
}

// One-line previews: drop code blocks and Markdown markers (keep snake_case underscores).
const plainText = text => text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
// Working and waiting cards count time in that state; others show their last activity.
const duration = ms => { const m = Math.floor(ms / 60_000); return m < 1 ? '<1m' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`; };
function stateAge(session) {
  if (!session) return '';
  const since = (needsInput(session) && session.requests?.[0]?.createdAt) || session.statusSince;
  return ['working', 'question', 'permission'].includes(session.status) && since ? `for ${duration(Date.now() - since)}` : age(session.lastActivityAt);
}
const modeLabels = { plan: 'plan', acceptEdits: 'auto-edit', auto: 'auto', bypassPermissions: 'bypass' };
const contextPercent = context => context?.window ? Math.min(100, Math.round(context.used / context.window * 100)) : null;
const compacting = session => session.status === 'working' && session.activity === 'compacting';
const planProgress = session => session.plan?.length ? [session.plan.filter(step => step.status === 'done').length, session.plan.length] : null;
function cardDetail(session) {
  if (session.provider === 'claude' && !session.control && needsInput(session) && !session.asks) return 'Open the original client · Hooks not connected';
  return session.requests[0]?.title || session.asks || (session.waitingOn && `Waiting · ${session.waitingOn}`) || session.detail || (session.status === 'idle' ? 'Waiting for the next task' : session.status === 'working' ? 'Working on the current task' : 'Open for details');
}
// What the office's card shows for whoever is outlined: the details a list card has.
function sessionFacts(session) {
  const age = stateAge(session);
  return { provider: session.provider, providerName: providerName(session.provider), title: session.title, project: session.project, branch: session.branch,
    agent: session.parentId ? session.agentKind === 'workflow' ? 'Workflow' : 'Subagent' : '', plan: planProgress(session), mode: modeLabels[session.permissionMode] || '', context: contextPercent(session.context),
    state: `${(statuses[session.status] || statuses.unknown)[0]}${age.startsWith('for ') ? ' ' : ' · '}${age}`, detail: cardDetail(session) };
}
const tokens = n => n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1000)}k`;
function chip(text, className, title) { const node = el('span', `chip ${className}`, text); if (title) node.title = title; return node; }
function renderCard(session, previous) {
  const card = el('button', `session-card ${session.needs ? 'needs-input' : ''} ${session.nested ? 'subagent' : ''}`); card.type = 'button'; card.onclick = () => openPanel(session.id);
  card.onfocus = card.onpointerenter = () => { if (document.documentElement.dataset.theme === 'command') { radarSelection = session.id; syncThemeConsole(); highlightRadarSession(session.id); } };
  // Long card loops run on a page-wide clock, so a rebuilt card continues them instead of restarting.
  card.style.setProperty('--since-load', `${-Math.round(performance.now())}ms`); card.dataset.sessionId = session.id; card.dataset.status = session.status; card.setAttribute('aria-label', `${session.title}, ${providerName(session.provider)}, ${(statuses[session.status] || statuses.unknown)[0]}`);
  card.toggleAttribute('data-status-changed', !!previous && previous.dataset.status !== session.status);
  const mark = el('span', `agent-mark ${session.provider}`); mark.append(providerIcon(session.provider)); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', providerName(session.provider)); mark.title = providerName(session.provider);
  if (document.documentElement.dataset.theme === 'fantasy') import('./fantasy/portraits.js').then(({ paintPortrait }) => paintPortrait(mark, session)).catch(() => {});
  if (session.unread) card.classList.add('unread');
  if (session.plan) { card.dataset.plan = ''; card.style.setProperty('--plan', session.plan[0] / session.plan[1]); }
  const body = el('span', 'session-body');
  const chips = [session.branch && el('span', 'branch', session.branch), session.plan && chip(`${session.plan[0]}/${session.plan[1]}`, 'plan-chip', 'Plan steps done'), session.waitingOn && chip(`Waiting · ${session.waitingOn}`, 'plan-chip', 'Still running'),
    session.mode && chip(modeLabels[session.mode], `mode-chip ${session.mode}`, 'Permission mode'), session.compacting ? chip('compacting', 'compact-chip', 'Compacting context') : session.context >= 80 && chip(`ctx ${session.context}%`, 'ctx-chip', 'Context window used')].filter(Boolean);
  const meta = el('span', 'session-meta'); if (chips.length) meta.append(...chips);
  const title = el('strong', 'session-title'); if (session.project) title.append(el('span', 'project-tag', session.project)); if (session.parentId) { const workflow = session.agentKind === 'workflow', tag = el('span', `subagent-tag${workflow ? ' workflow-tag' : ''}`, workflow ? 'Workflow' : 'Subagent'); tag.title = session.kind || ''; title.append(tag); } title.append(session.title); body.append(title);
  const text = document.createTextNode(session.last ? session.last[1] : session.detail);
  const preview = session.last ? el('span', 'message-preview') : el('span', 'session-description');
  if (session.last?.[0] === 'user') preview.append(el('strong', '', 'You: '));
  preview.append(text); body.append(preview); if (chips.length) body.append(meta);
  const before = previous?.querySelector('.message-preview, .session-description')?.textContent;
  if (before !== undefined && before !== preview.textContent && document.documentElement.dataset.theme !== 'alien') typewrite(text);
  const right = el('span', 'session-right'); right.append(badge(session.status), el('span', 'session-age'));
  if (session.unread) { const dot = el('i', 'unread-dot'); dot.title = 'New since you last looked'; mark.append(dot); }
  card.append(mark, body, right); return card;
}

// Keyed reuse: polling replaces only nodes whose data changed and moves the rest,
// so animations, hover and focus survive updates.
function syncList(container, items, render) {
  const old = new Map([...container.children].map(node => [node.dataset.key, node]));
  const nodes = items.map(([key, data]) => {
    const signature = JSON.stringify(data); let node = old.get(key);
    if (node?.dataset.sig !== signature) { const fresh = render(data, node); fresh.dataset.key = key; fresh.dataset.sig = signature; node?.replaceWith(fresh); node = fresh; }
    return node;
  });
  for (const node of [...container.children]) if (!nodes.includes(node)) node.remove();
  nodes.forEach((node, index) => { if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); });
}

// Typewriter for a card whose preview text changed: one text node per frame, at most ~0.75 s.
function typewrite(node) {
  const full = node.textContent, parent = node.parentElement;
  if (stillInterface() || !full) return;
  const step = Math.max(1, Math.ceil(full.length / 45));
  let shown = 0; node.textContent = ''; parent.classList.add('typing');
  const tick = () => {
    if (!node.isConnected) return;
    shown = stillInterface() ? full.length : Math.min(full.length, shown + step); node.textContent = full.slice(0, shown);
    if (shown < full.length) requestAnimationFrame(tick); else parent.classList.remove('typing');
  };
  requestAnimationFrame(tick);
}

// FLIP: moved cards and headers slide from their old spot; new ones fade in.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stillInterface = () => reducedMotion.matches || reducedAtmosphere() || document.documentElement.dataset.theme === 'paper';
const flipKey = node => node.classList.contains('group-heading') ? `#${node.parentElement.dataset.key}` : node.dataset.key;
function flipPositions(root) { return new Map([...root.querySelectorAll('.session-card, .group-heading')].map(node => [flipKey(node), node.getBoundingClientRect().top])); }
function flipFrom(root, before) {
  if (stillInterface() || !before.size) return;
  for (const node of root.querySelectorAll('.session-card, .group-heading')) {
    const from = before.get(flipKey(node));
    if (from === undefined) { node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); continue; }
    const dy = from - node.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
}

let previousFocus;
function openPanel(id) { previousFocus = document.activeElement; radarSelection = id; syncThemeConsole(); navigation.open(id); syncMobileNavigation(); document.querySelector('#panel button')?.focus(); }
function closePanel() { if (new URLSearchParams(location.search).has('pane') && window.parent !== window) { window.parent.postMessage({ type: 'ai-control-close-pane' }, location.origin); return; } workflow.closeSplit(); navigation.close(); }
function hidePanel() { scene?.panelClosed(); const closedId = state.selected; markSeen(closedId); older.delete(closedId); state.selected = null; panelSignature = ''; const panel = document.querySelector('#panel'); if (!panel) return; const open = !panel.hidden; disposeHistory(); disposeComposer(); liveRender.cancel(); panel.dataset.sessionId = ''; delete panel.dataset.view; panel.hidden = true; document.querySelector('#backdrop').hidden = true; document.querySelector('.shell')?.removeAttribute('inert'); document.body.classList.remove('panel-open'); renderData();
  // Closing twice (the call, then the history step it takes) mustn't pull focus back from whatever the first close handed it to.
  if (!open) return;
  const focus = previousFocus?.isConnected ? previousFocus : [...document.querySelectorAll('.session-card[data-session-id]')].find(b => b.dataset.sessionId === closedId); focus?.focus({ preventScroll: true }); }
function revealPanel() { const panel = document.querySelector('#panel'); panel.hidden = false; document.querySelector('#backdrop').hidden = false; document.querySelector('.shell').setAttribute('inert', ''); document.body.classList.add('panel-open'); return panel; }
function renderPanel() {
  const session = state.snapshot.sessions.find(s => s.id === state.selected);
  const panel = document.querySelector('#panel');
  if (!session) { if (clearing) return; navigation.reset(); hidePanel(); return; }
  if (panel.dataset.sessionId !== session.id) {
    disposeHistory(); disposeComposer(); panelSignature = '';
    if (panel.dataset.sessionId) { markSeen(panel.dataset.sessionId); older.delete(panel.dataset.sessionId); }
    markSeen(session.id);
    panel.replaceChildren(); panel.dataset.sessionId = session.id; delete panel.dataset.view; panel.classList.remove('feed-panel'); panel.classList.add('chat-panel'); revealPanel();
    const header = el('header', 'chat-header');
    const recent = el('section', 'recent-messages'); recent.id = 'recent-messages';
    const requests = el('div', 'chat-requests'); requests.setAttribute('aria-label', 'Pending questions and permissions');
    const composer = el('section', 'message-composer'); composer.id = 'message-composer';
    panel.append(header, recent, requests, composer);
  }
  if (pendingEffort.get(session.id) === session.effort) pendingEffort.delete(session.id);
  const signature = JSON.stringify([session.id, session.status, session.title, session.project, session.cwd, session.model, session.control, !!state.error, session.effort, session.effortPending, pendingEffort.get(session.id), session.efforts, session.messaging,
    session.permissionMode, session.context, compacting(session), session.branch, session.lastTurnMs, session.cost, session.goal, session.plan, nextWaiting(session.id)?.id, hireSignature(session.cwd),
    lastObservedActivity(session), Math.floor(Date.now() / 60000), workflow.saved.preferences.quietMinutes, workflow.meta(session), state.snapshot.overlaps]);
  const settingsActive = panel.querySelector('.agent-settings:focus-within, .agent-settings[data-busy]');
  if (signature !== panelSignature && (!settingsActive || state.error)) {
    panelSignature = signature;
    renderSessionHeader(panel.querySelector('.chat-header'), session);
  }
  const requests = panel.querySelector('.chat-requests');
  const requestSignature = JSON.stringify([session.requests.map(({ sending, ...request }) => request), needsInput(session), !!session.asks, !!state.error]);
  if (requests.dataset.signature !== requestSignature) {
    requests.dataset.signature = requestSignature;
    renderSessionRequests(requests, session);
  }
  renderRecentMessages(session);
  renderComposer(session);
  renderReviewQueue(panel.querySelector('.chat-header'), session);
  dressTheme();
}

// Triage: the next session waiting for you, in overview order.
function nextWaiting(currentId) { return reviewQueue(state.snapshot?.sessions || [], currentId).next; }
function openNext() { const next = nextWaiting(state.selected); if (!next) return; if (state.selected && state.selected !== 'feed') navigation.open(next.id, { replace: true }); else openPanel(next.id); }
function renderSessionHeader(header, session) {
  const expanded = !!header.querySelector('.chat-info')?.open, planOpen = !!header.querySelector('.plan-info')?.open;
  header.replaceChildren();
  const head = el('div', 'panel-heading'), actions = el('div', 'panel-heading-actions');
  const next = nextWaiting(session.id);
  if (next) { const b = button('Next', 'quiet-button next-button', openNext, 'next'); b.title = `Next waiting (n): ${next.title}`; actions.append(b); }
  if (session.status === 'working' && session.messaging?.interrupt) { const stop = button('Stop', 'quiet-button stop-button', () => interrupt(session, stop), 'stop'); stop.title = 'Interrupt the current turn'; stop.disabled = !!state.error; actions.append(stop); }
  if ((session.status === 'idle' || session.asks) && !session.parentId && session.messaging?.fire) { const fire = button('Fire', 'quiet-button stop-button fire-button', () => fireSession(session, fire), 'exit'); fire.title = session.provider === 'codex' ? 'End and archive this session and its subagents; history remains resumable (refused while work is running or queued)' : session.provider === 'opencode' ? 'Archive this idle session and its subagents; keep history and the terminal open (refused while work is running or queued)' : `End this session with ${session.messaging.via === 'tmux' ? '/exit' : 'SIGTERM'} (refused while anything is still running)`; fire.disabled = !!state.error; actions.append(fire); }
  if ((session.status === 'idle' || session.asks) && !session.parentId && session.messaging?.clear) { const clear = button('Clear', 'quiet-button clear-button', () => clearSession(session, clear), 'eraser'); clear.title = 'Start over with /clear'; clear.disabled = !!state.error; actions.append(clear); }
  actions.append(themeMenu(), badge(session.status)); const back = button('Back', 'quiet-button back-button', closePanel, 'back'); back.title = 'Back to sessions'; head.append(back, actions); header.append(head);
  const identity = el('div', 'agent-identity'), portrait = el('span', `agent-mark ${session.provider}`);
  portrait.append(providerIcon(session.provider)); portrait.setAttribute('aria-hidden', 'true');
  const heading = el('div', 'agent-heading'), title = el('h2', 'panel-title', workflow.title(session)); title.title = session.originalTitle || session.title;
  const byline = el('div', 'agent-byline'); byline.append(el('span', 'agent-provider', providerName(session.provider)), el('span', 'agent-project', [session.account, session.project].filter(Boolean).join(' · '))); byline.title = [providerName(session.provider), session.account, session.cwd].filter(Boolean).join(' · ');
  heading.append(title, byline); identity.append(portrait, heading); header.append(identity);
  const metadata = el('details', 'chat-info'); metadata.open = expanded;
  const effort = pendingEffort.get(session.id) || session.effort, percent = contextPercent(session.context);
  const summary = el('summary'); summary.append(el('span', 'details-label', 'Details'));
  if (session.branch) summary.append(el('span', 'header-branch', session.branch));
  if (session.cost) summary.append(chip(`$${session.cost.usd.toFixed(2)}`, 'header-cost', session.cost.estimated ? 'Estimated session cost' : 'Session cost'));
  if (modeLabels[session.permissionMode]) summary.append(chip(modeLabels[session.permissionMode], `mode-chip ${session.permissionMode}`, 'Permission mode'));
  if (compacting(session)) summary.append(chip('compacting', 'compact-chip', 'Compacting context'));
  if (session.context?.used) summary.append(chip(percent != null ? `${percent}%` : tokens(session.context.used), `ctx-chip${percent >= 80 ? ' high' : ''}`, 'Context used'));
  metadata.append(summary);
  if (session.messaging?.model || session.messaging?.effort) metadata.append(agentSettings(session, { api, disabled: !!state.error,
    changed: (result, kind) => { if (!state.csrf) return; pendingEffort.delete(session.id); toast(result.warning || `${kind === 'model' ? 'Model' : 'Effort'} saved${result.pending ? ' · from your next message here' : ''}`); panelSignature = ''; refresh(); },
    failed: error => toast(error.message),
  }));
  const goal = session.goal, cost = session.cost;
  const rows = [['Folder', session.cwd], ['Account', session.account], ['Model', session.model || 'Not reported'], ['Effort', effort && `${effort}${session.effortPending ? ' · from your next message' : ''}`], ['Mode', session.permissionMode],
    ['Context', session.context?.used && `${tokens(session.context.used)}${session.context.window ? ` of ${tokens(session.context.window)} (${percent}%)` : ''}`], ['Branch', session.branch],
    ['Last turn', session.lastTurnMs && duration(session.lastTurnMs)], [cost?.estimated ? 'Est. cost' : 'Cost', cost && `$${cost.usd.toFixed(2)} · +${cost.added} −${cost.removed} lines`],
    ['Tokens', session.tokens && `${session.tokens.input.toLocaleString()} in · ${session.tokens.output.toLocaleString()} out · ${session.tokens.cacheRead.toLocaleString()} cache read · ${session.tokens.cacheWrite.toLocaleString()} cache write`],
    ['Goal', goal && `${goal.objective} · ${goal.status}${goal.tokenBudget ? ` · ${tokens(goal.tokensUsed)} of ${tokens(goal.tokenBudget)} tokens` : ''}`],
    ['Version', session.version && `${providerName(session.provider)} ${session.version}`], ['Session', session.nativeId || session.id], ['Connection', session.control ? 'Connected' : 'Status only']];
  const info = el('dl', 'session-info'); for (const [key, value] of rows) if (value) info.append(el('dt', '', key), el('dd', '', value)); metadata.append(info); if (session.cwd) metadata.append(spawnButtons(session.cwd)); header.append(metadata);
  if (session.plan?.length) {
    const plan = el('details', 'plan-info'); plan.open = planOpen;
    const done = session.plan.filter(step => step.status === 'done').length, current = session.plan.find(step => step.status === 'active') || session.plan.find(step => step.status === 'pending');
    const meter = el('progress', 'plan-meter'); meter.max = session.plan.length; meter.value = done;
    const line = el('summary'); line.append(el('strong', '', `${done}/${session.plan.length}`), meter, el('span', '', current?.step || 'All steps done'));
    const list = el('ol', 'plan-steps'); for (const step of session.plan) list.append(el('li', step.status, step.step));
    plan.append(line, list); header.append(plan);
  }
  workflow.header(header, session);
  if (state.error) header.append(el('p', 'connection-error', 'Reconnecting. Actions are temporarily disabled.'));
}
// The first click arms it for a few seconds; the second goes ahead. The server refuses if anything is still running.
function armed(control) {
  if (control.classList.contains('armed')) return true;
  const label = control.querySelector('span:not(.icon)'), name = label.textContent;
  control.classList.add('armed'); label.textContent = 'Sure?'; control.setAttribute('aria-label', `Click again to ${name.toLowerCase()}`);
  setTimeout(() => { control.classList.remove('armed'); label.textContent = name; control.removeAttribute('aria-label'); }, 3000);
  return false;
}
async function fireSession(session, control) {
  if (state.error || !armed(control)) return;
  control.disabled = true;
  try {
    const path = `sessions/${encodeURIComponent(session.id)}/fire`;
    try { await api(path, {}); }
    catch (error) {
      if (error.code !== 'force_available') throw error;
      if (!window.confirm(`${error.message}\n\nForce close this session? Active work may be interrupted, and background processes may keep running.`)) { control.disabled = false; return; }
      await api(path, { force: true });
    }
    toast('Fired'); scene?.fire(session.id); closePanel(); await refresh();
  }
  catch (error) { toast(error.message); control.disabled = false; }
}
// /clear gives the session a new id, so the panel moves to it. Until a snapshot has it, a missing session doesn't close the panel.
async function clearSession(session, control) {
  if (state.error || !armed(control)) return;
  control.disabled = true; clearing = true;
  try {
    const { id } = await api(`sessions/${encodeURIComponent(session.id)}/clear`, {});
    toast('Cleared'); if (state.selected === session.id) navigation.open(id, { replace: true }); await refresh();
    setTimeout(() => { clearing = false; }, 4000);
  } catch (error) { clearing = false; toast(error.message); control.disabled = false; }
}
async function interrupt(session, control) {
  if (state.error) return;
  control.disabled = true;
  try { await api(`sessions/${encodeURIComponent(session.id)}/interrupt`, {}); toast('Stopped'); panelSignature = ''; await refresh(); }
  catch (error) { toast(error.message); control.disabled = false; }
}

function renderSessionRequests(requests, session) {
  requests.replaceChildren();
  for (const request of session.requests) {
    const box = el('section', 'request-box'); box.append(el('span', 'eyebrow amber-text', request.kind === 'question' ? 'YOUR INPUT' : 'PERMISSION REQUEST'));
    if (request.kind !== 'question' || request.title !== 'A question for you') box.append(el('h3', '', request.title));
    if (request.plan) { const rendered = renderMessageMarkdown(request.plan, Infinity), plan = el('div', 'message-text request-plan'); plan.innerHTML = rendered.html + (rendered.more || ''); box.append(plan); }
    if (request.kind !== 'question') renderRequestDetails(box, request);
    const error = el('p', 'form-error'); error.setAttribute('role', 'alert');
    if (request.unsupported) { box.append(el('p', 'muted', request.unsupported)); requests.append(box); continue; }
    if (request.kind === 'question') {
      const form = el('form', 'question-form');
      for (const [index, q] of request.questions.entries()) {
        const field = el('fieldset'); field.append(el('legend', '', q.question)); if (q.description) field.append(el('p', 'muted', q.description));
        const name = `q${index}`;
        for (const option of q.options || []) {
          const label = el('label', 'answer-option'); const input = el('input'); input.type = q.multiSelect ? 'checkbox' : 'radio'; input.name = name; input.value = option.label;
          const copy = el('span'); copy.append(el('strong', '', option.label)); if (option.description) copy.append(el('span', '', option.description)); label.append(input, copy); field.append(label);
        }
        if (q.allowOther !== false || !q.options?.length) {
          const label = el('label', 'custom-answer', q.options?.length ? 'Or write your own answer' : 'Your answer'); const input = el('input'); input.name = `${name}-custom`; input.type = q.isSecret ? 'password' : 'text'; input.maxLength = 10_000; input.autocomplete = 'off'; input.placeholder = 'Type an answer…'; label.append(input); field.append(label);
          input.oninput = () => { if (input.value && !q.multiSelect) for (const radio of field.querySelectorAll('input[type=radio]')) radio.checked = false; };
          for (const radio of field.querySelectorAll('input[type=radio]')) radio.onchange = () => { input.value = ''; };
        }
        form.append(field);
      }
      const submit = el('button', 'primary', 'Send answer'); submit.type = 'submit'; submit.disabled = !!state.error || request.sending;
      form.append(error, submit);
      form.onsubmit = async event => {
        event.preventDefault();
        const data = new FormData(form), answers = Object.create(null);
        for (const [index, q] of request.questions.entries()) {
          const custom = String(data.get(`q${index}-custom`) || '').trim(), selected = data.getAll(`q${index}`);
          answers[q.id] = custom ? (q.multiSelect ? [...selected, custom] : [custom]) : selected;
        }
        await respond(request, { answers }, form, error);
      };
      box.append(form);
    } else if (request.actions?.length) {
      const actions = el('div', 'decision-actions');
      // Claude takes a reason with a denial; Enter in the field denies with it.
      const reason = request.denyMessage && el('input', 'deny-reason');
      const decide = value => respond(request, { decision: value, ...(value === 'decline' && reason?.value.trim() ? { message: reason.value.trim() } : {}) }, box, error);
      for (const action of request.actions) { const b = button(action.label, action.value === 'accept' || action.primary ? 'primary' : 'secondary', () => decide(action.value)); b.title = action.label; b.dataset.decision = action.value; b.disabled = !!state.error || request.sending; actions.append(b); }
      box.append(error, actions);
      if (reason) { reason.type = 'text'; reason.maxLength = 2000; reason.placeholder = 'Deny with a reason…'; reason.setAttribute('aria-label', 'Reason for denying'); reason.disabled = !!state.error || request.sending; reason.onkeydown = event => { if (event.key === 'Enter' && reason.value.trim()) { event.preventDefault(); decide('decline'); } }; box.append(reason); }
    } else box.append(el('p', 'muted', request.note || 'Answer this request in the original client.'));
    requests.append(box);
  }
  if (!session.requests.length && needsInput(session) && !session.asks) {
    const note = el('div', 'chat-idle'); note.append(icon(needsInput(session) ? 'bell' : 'check'), el('p', '', needsInput(session) ? 'Waiting for input in the original client. This prompt is not connected here.' : 'No questions or permissions waiting.')); requests.append(note);
  }
  requests.hidden = !requests.children.length;
}

function disposeComposer() {
  const region = document.querySelector('#message-composer');
  region?.draftInput?.destroy();
  if (region?.currentSession) workflow.drafts.flush(region.currentSession.id);
}

function renderComposer(session) {
  const region = document.querySelector('#message-composer'); if (!region) return;
  region.currentSession = session;
  const draft = workflow.draft(session.id);
  if (!region.querySelector('form')) {
    const queue = el('div', 'message-queue');
    const form = el('form', 'message-form');
    const input = el('textarea'); input.rows = 2; input.maxLength = 12_000; input.setAttribute('aria-label', `Message ${providerName(session.provider)}`); input.placeholder = `Message ${providerName(session.provider)}…`;
    const row = el('div', 'composer-row');
    const submit = el('button', 'primary', 'Send'); submit.type = 'submit';
    const attach = button('', 'quiet-button composer-attach', () => files.click(), 'image'); attach.title = 'Attach images'; attach.setAttribute('aria-label', 'Attach images');
    const files = el('input'); files.type = 'file'; files.accept = 'image/*'; files.multiple = true; files.hidden = true;
    const previews = el('div', 'composer-images');
    const suggestion = el('button', 'composer-suggestion'); suggestion.type = 'button';
    row.append(input, attach, submit);
    // Pasted, picked or dropped; large images are shrunk first, and each one shows above the input until sent.
    const add = async list => {
      const picked = imageFiles(list); if (!picked.length || draft.busy) return;
      if (!region.currentSession.messaging?.images) { draft.error = `This session cannot take images.${region.currentSession.provider === 'claude' ? ' Run Claude in tmux to send them.' : ''}`; update(); return; }
      const room = maxImages - draft.images.length; draft.error = '';
      try { for (const file of picked.slice(0, room)) { const image = await attachment(file); if (draft.images.length < maxImages) draft.images.push(image); else releaseImages([image]); } }
      catch (error) { draft.error = error.message; }
      if (picked.length > room) draft.error ||= `Up to ${maxImages} images.`;
      update();
    };
    files.onchange = () => { add(files.files); files.value = ''; };
    input.addEventListener('paste', event => { const pasted = imageFiles(event.clipboardData?.files); if (pasted.length) { event.preventDefault(); add(pasted); } });
    form.addEventListener('dragover', event => { if ([...event.dataTransfer?.types || []].includes('Files')) event.preventDefault(); });
    form.addEventListener('drop', event => { if (imageFiles(event.dataTransfer?.files).length) { event.preventDefault(); add(event.dataTransfer.files); } });
    const feedback = el('p', 'composer-feedback'); feedback.setAttribute('role', 'status');
    const draftInput = region.draftInput = new ComposerInput(input, draft, () => update());
    input.addEventListener('input', () => workflow.editDraft(session.id, input.value));
    const acceptSuggestion = () => {
      const text = region.currentSession.suggestion;
      if (suggestion.hidden || draft.busy || !draftInput.acceptSuggestion(text)) return false;
      workflow.editDraft(session.id, input.value); draft.acceptedSuggestion = text; update(); input.focus(); return true;
    };
    suggestion.onclick = acceptSuggestion;
    input.onkeydown = event => {
      if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && acceptSuggestion()) event.preventDefault();
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (draftInput.composing) return;
      draftInput.flush();
      const current = state.snapshot?.sessions.find(item => item.id === session.id);
      if (!current || draft.busy || !(draft.text.trim() || draft.images.length) || state.error) return;
      const mode = 'send';
      if (!current.messaging?.send || messagingUnavailableReason(current, state.snapshot)) return;
      const images = draft.images.map(({ name, data }) => ({ name, data }));
      if (!draft.submission || draft.submission.text !== draft.text || draft.submission.mode !== mode || draft.submission.images.length !== images.length || draft.submission.images.some((image, i) => image.data !== images[i].data)) draft.submission = { text: draft.text, mode, clientMessageId: uuid(), images };
      draft.busy = true; draft.error = ''; update();
      try {
        const result = await api(`sessions/${encodeURIComponent(session.id)}/messages`, draft.submission);
        await workflow.clearDraft(session.id); draft.revision = (draft.revision || 0) + 1; draft.submission = null; releaseImages(draft.images); draft.images = [];
        if (result.status === 'cleared' && result.session && state.snapshot) {
          state.snapshot.sessions = [...state.snapshot.sessions.filter(item => item.id !== result.session.id), result.session];
          if (state.selected === session.id) navigation.open(result.sessionId, { replace: true });
        }
        toast(result.status === 'cleared' ? 'New Codex chat' : result.status === 'submitted' ? 'Sent via inbox (not tmux)' : result.status === 'steered' ? 'Sent into the current work' : 'Sent');
        if (state.selected === session.id) document.querySelector('#recent-messages')?.historyScroll?.jumpToLatest();
        await refresh();
      } catch (error) { draft.error = error.message; }
      finally { draft.busy = false; update(); if (state.selected === session.id) document.querySelector('#message-composer')?.updateComposer?.(); }
    };
    form.append(previews, suggestion, row, files, feedback); region.append(queue, form);
    const draftTools = workflow.composer(region, session, text => {
      const next = `${input.value}${input.value ? '\n\n' : ''}${text}`;
      if (next.length > 12000) { toast('Draft exceeds 12,000 characters. Shorten it before inserting.'); return false; }
      input.value = next; input.dispatchEvent(new Event('input')); input.focus(); return true;
    });
    function update() {
      const current = region.currentSession;
      const unavailable = messagingUnavailableReason(current, state.snapshot);
      const available = current.messaging?.send && !unavailable;
      draftInput.syncReset(); draftTools.sync();
      if (current.suggestion && current.suggestion !== draft.acceptedSuggestion) draft.acceptedSuggestion = '';
      const suggested = available && !draft.busy && !draftInput.hasText && !draft.images.length && current.suggestion && current.suggestion !== draft.acceptedSuggestion ? current.suggestion : '';
      setProperty(suggestion, 'hidden', !suggested);
      setProperty(suggestion, 'textContent', suggested || '');
      suggestion.title = 'Use suggestion · Tab';
      region.messagingSeen ||= !!current.messaging?.send;
      const visible = region.messagingSeen || draftInput.hasText;
      setProperty(row, 'hidden', !visible);
      // Connection changes affect Send, not the user's ability to keep drafting.
      setProperty(input, 'readOnly', draft.busy);
      setProperty(submit, 'disabled', draft.busy || !(draftInput.hasText || draft.images.length) || !available || !!state.error);
      setProperty(attach, 'hidden', !current.messaging?.images);
      setProperty(attach, 'disabled', draft.busy || draft.images.length >= maxImages);
      const shown = draft.images.map(image => image.id).join();
      if (previews.dataset.shown !== shown) {
        previews.dataset.shown = shown; previews.replaceChildren();
        for (const image of draft.images) {
          const item = el('figure', 'composer-image'), thumb = el('img'), remove = el('button', 'composer-image-remove'); thumb.src = image.url; thumb.alt = image.name; item.title = `${image.name} · ${Math.max(1, Math.round(image.size / 1024))} KB`;
          remove.type = 'button'; remove.title = 'Remove'; remove.setAttribute('aria-label', `Remove ${image.name}`); remove.append(icon('close'));
          remove.onclick = () => { if (draft.busy) return; draft.images = draft.images.filter(item => item !== image); releaseImages([image]); draft.error = ''; update(); input.focus(); };
          item.append(thumb, remove); previews.append(item);
        }
      }
      setProperty(previews, 'hidden', !draft.images.length);
      for (const remove of previews.querySelectorAll('button')) setProperty(remove, 'disabled', draft.busy);
      setProperty(submit, 'textContent', draft.busy ? 'Sending…' : 'Send');
      setProperty(feedback, 'className', `composer-feedback ${draft.error ? 'form-error' : ''}`);
      setProperty(feedback, 'textContent', draft.error || unavailable);
      for (const edit of queue.querySelectorAll('[data-edit-queued]')) setProperty(edit, 'disabled', draft.busy || draftInput.hasText || !available || !!state.error);
    }
    region.updateComposer = update;
  }
  region.updateComposer();
  const queue = region.querySelector('.message-queue');
  const signature = JSON.stringify([session.queuedMessages, session.queueError, !!state.error]);
  if (queue.dataset.signature === signature) return;
  queue.dataset.signature = signature; queue.replaceChildren();
  if (session.queuedMessages?.length) queue.append(el('strong', 'queue-heading', `Queued · ${session.queuedMessages.length}`));
  for (const message of session.queuedMessages || []) {
    const row = el('div', 'queued-message');
    const text = el('p', '', message.text || 'Message with attachments'); text.title = message.text;
    const cancel = button('Remove', 'quiet-button', async () => {
      cancel.disabled = true; draft.error = '';
      try { await api(`sessions/${encodeURIComponent(session.id)}/queue/${encodeURIComponent(message.id)}/cancel`, {}); await refresh(); }
      catch (error) { draft.error = error.message; cancel.disabled = false; region.updateComposer(); }
    }); cancel.disabled = !!state.error || !session.messaging?.queue;
    row.append(text);
    if (message.clientMessageId?.startsWith('ai-control:') && !message.hasAttachments) {
      const edit = button('Edit & send', 'quiet-button', async () => {
        if (draft.busy || region.draftInput.hasText) return;
        draft.busy = true; draft.error = ''; region.updateComposer();
        try {
          // Remove the queued copy before offering it for immediate delivery.
          // A message that already started must never become another draft.
          await api(`sessions/${encodeURIComponent(session.id)}/queue/${encodeURIComponent(message.id)}/cancel`, {});
          workflow.editDraft(session.id, message.text); draft.revision = (draft.revision || 0) + 1; draft.submission = null;
          toast('Removed from the queue');
          await refresh();
        } catch (error) { draft.error = error.message; }
        finally { draft.busy = false; region.updateComposer(); region.querySelector('textarea')?.focus(); }
      });
      edit.dataset.editQueued = message.id;
      edit.disabled = draft.busy || region.draftInput.hasText || !!state.error || !!messagingUnavailableReason(session, state.snapshot);
      row.append(edit);
    }
    if (session.provider === 'codex') row.append(cancel);
    queue.append(row);
  }
  if (session.queueError) queue.append(el('p', 'form-error', session.queueError));
}

function requestValue(value, depth = 0) {
  if (value === null) return el('span', '', 'Not specified');
  if (typeof value !== 'object') return el('span', '', typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value));
  if (depth > 6) return el('pre', 'request-code', JSON.stringify(value, null, 2));
  if (Array.isArray(value)) {
    if (!value.length) return el('span', '', 'None');
    const list = el('ul', 'request-values'); for (const entry of value) { const li = el('li'); li.append(requestValue(entry, depth + 1)); list.append(li); } return list;
  }
  const list = el('dl', 'request-fields');
  for (const [key, entry] of Object.entries(value)) if (entry != null) { const dd = el('dd'); dd.append(requestValue(entry, depth + 1)); list.append(el('dt', '', fieldLabel(key)), dd); }
  return list;
}

function renderRequestDetails(box, request) {
  if (!request.details) return;
  const view = requestPresentation(request);
  if (view.reason && view.reason !== request.title) box.append(el('p', 'request-reason', view.reason));
  if (view.command) { const pre = el('pre', 'request-code'); pre.append(el('code', '', view.command)); box.append(pre); }
  if (view.fields.length) {
    const fields = el('dl', 'request-fields');
    for (const field of view.fields) { const dd = el('dd'); dd.append(requestValue(field.value)); fields.append(el('dt', '', field.label), dd); }
    box.append(fields);
  }
  for (const file of view.files) {
    const details = el('details', 'request-file'); details.append(el('summary', '', `${fieldLabel(file.kind)} · ${file.path}`)); details.open = view.files.length === 1;
    if (file.moveTo) details.append(el('p', '', `Move to ${file.moveTo}`));
    if (file.diff) details.append(diffBlock(file.diff)); box.append(details);
  }
  if (view.raw) { const details = el('details', 'request-details'); details.append(el('summary', '', 'Technical details'), el('pre', '', view.raw)); box.append(details); }
}

function diffBlock(diff) {
  const pre = el('pre', 'request-code diff');
  for (const line of diff.split('\n')) pre.append(el('span', /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : line.startsWith('@@') ? 'hunk' : '', `${line}\n`));
  return pre;
}

function disposeHistory() {
  const region = document.querySelector('#recent-messages');
  if (region?.historyScroll) { region.historyScroll.destroy(); delete region.historyScroll; }
}

function renderRecentMessages(session, savedPosition) {
  const region = document.querySelector('#recent-messages'); if (!region) return;
  if (!region.historyScroll) {
    const viewport = el('div', 'history-viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Message history');
    viewport.append(el('div', 'history-content'));
    const latest = button('Latest messages', 'history-latest quiet-button', null, 'down'); latest.hidden = true;
    region.replaceChildren(viewport, latest);
    region.historyScroll = new HistoryScroll(viewport, latest);
    delete region.dataset.signature;
  }
  const flow = region.historyScroll;
  const extra = older.get(session.id), messages = mergeHistory(extra?.messages, session.messages || []), images = sessionShots(session), documents = sessionDocs(session);
  const moreAvailable = extra ? extra.more : session.historyMore || (session.messages || []).filter(m => !m.tool).length >= 40;
  const signature = JSON.stringify([messages, images, documents, session.messagesState, moreAvailable, !!extra?.loading]);
  if (region.dataset.signature === signature) { if (savedPosition) flow.restore(savedPosition); return; }
  const saved = savedPosition || flow.capture();
  const content = region.querySelector('.history-content');
  const existing = new Map([...content.querySelectorAll('[data-message-id]')].map(node => [node.dataset.messageId, node]));
  const shotContainers = new Set(content.querySelectorAll('.history-shots'));
  const children = [];
  region.dataset.signature = signature;
  if (moreAvailable && messages.length) {
    const load = existing.get('older') || button('Older messages', 'quiet-button history-older', () => loadOlder(session.id), 'back');
    load.dataset.messageId = 'older'; load.disabled = !!extra?.loading; children.push(load);
  }
  if (!messages.length) children.push(el('p', 'muted history-empty', session.messagesState === 'loading' ? 'Loading recent messages…' : session.messagesState === 'empty' ? 'No recent text messages.' : 'Recent messages are not available for this session yet.'));
  if (session.messagesState === 'stale') children.push(el('p', 'muted', 'Showing the last messages received.'));
  // A main session folds three or more tool calls in a row into one line; a subagent shows each.
  const entries = [];
  for (const message of messages) {
    const run = entries.at(-1);
    if (message.tool && Array.isArray(run) && run[0].tool) run.push(message); else entries.push(message.tool ? [message] : message);
  }
  for (const entry of placeShots(entries.flatMap(item => Array.isArray(item) && (item.length < 3 || session.parentId) ? item : [item]), images, documents.filter(document => document.written))) {
    const id = entry.docs ? `docs:${entry.docs[0].id}` : entry.shots ? `shots:${entry.shots[0].id}` : Array.isArray(entry) ? `run:${entry[0].id}` : entry.id;
    const previous = entry.shots ? takeShotContainer(shotContainers, entry.shots, undefined, existing.get(id)) : existing.get(id), entrySignature = JSON.stringify(entry);
    if (previous?.dataset.signature === entrySignature) { children.push(previous); continue; }
    const node = entry.docs ? docStrip(session, entry.docs) : entry.shots ? shotStrip(session.id, entry, previous, showShot) : Array.isArray(entry) ? toolRun(entry, !!previous?.open) : messageNode(entry, session, previous);
    node.dataset.messageId = id; node.dataset.signature = entrySignature; children.push(node);
  }
  // Keep unchanged messages mounted so expanded text and keyboard focus survive polling.
  for (const node of [...content.children]) if (!children.includes(node)) node.remove();
  children.forEach((node, index) => { if (content.children[index] !== node) content.insertBefore(node, content.children[index] || null); });
  linkDocuments(content, documents, session.cwd, doc => showDocument(session, doc.id));
  flow.restore(saved);
}
// The live feed (feed.js) in the panel, beside the list or scene: who's busy or waiting along the top, then every
// session's latest work on one timeline that follows the newest. A session's name opens it; Back returns here.
const feedKey = 'ai-control-feed';
const feedPrefs = (() => { const fallback = { subagents: true, tools: true }; try { return { ...fallback, ...JSON.parse(localStorage.getItem(feedKey) || '{}') }; } catch { return fallback; } })();
// Screenshot lists are fetched only for sessions active lately; the rest show what was already fetched.
const feedShots = session => session.status === 'working' || needsInput(session) || Date.now() - (session.lastActivityAt || 0) < 3 * 3600_000 ? sessionShots(session) : shots.get(session.id)?.items || [];
function openFeed() {
  if (state.selected === 'feed') { closePanel(); return; }
  if (state.selected) navigation.open('feed', { replace: true }); else { previousFocus = document.activeElement; navigation.open('feed'); }
}
function renderFeed() {
  const panel = document.querySelector('#panel'); if (!panel || !state.snapshot) return;
  if (panel.dataset.view !== 'feed') {
    disposeHistory(); disposeComposer(); panelSignature = '';
    if (panel.dataset.sessionId) { markSeen(panel.dataset.sessionId); older.delete(panel.dataset.sessionId); }
    panel.replaceChildren(); panel.dataset.sessionId = ''; panel.dataset.view = 'feed'; panel.classList.add('chat-panel', 'feed-panel'); revealPanel();
    const header = el('header', 'chat-header feed-header'), head = el('div', 'panel-heading'), actions = el('div', 'panel-heading-actions');
    for (const [key, label, title, glyph] of [['subagents', 'Subagents', 'Show subagents', 'agents'], ['tools', 'Tools', 'Show tool calls', 'terminal']]) {
      const toggle = button(label, 'quiet-button feed-toggle', () => {
        feedPrefs[key] = !feedPrefs[key]; toggle.setAttribute('aria-pressed', String(feedPrefs[key]));
        try { localStorage.setItem(feedKey, JSON.stringify(feedPrefs)); } catch { /* per tab only */ }
        renderFeed();
      }, glyph);
      toggle.title = title; toggle.setAttribute('aria-pressed', String(feedPrefs[key])); actions.append(toggle);
    }
    actions.append(themeMenu());
    const back = button('Back', 'quiet-button back-button', closePanel, 'back'); back.title = 'Back to sessions';
    head.append(back, actions);
    const title = el('h2', 'panel-title'); title.append(icon('live'), el('span', '', 'Live feed'));
    header.append(head, title, el('div', 'wf-feed-filters'));
    const now = el('nav', 'feed-now'); now.setAttribute('aria-label', 'Busy and waiting');
    const recent = el('section', 'recent-messages'); recent.id = 'recent-messages';
    panel.append(header, now, recent);
    back.focus({ preventScroll: true });
  }
  syncFeedFilters(panel.querySelector('.wf-feed-filters'));
  const sessions = filterFeed(state.snapshot.sessions, feedPrefs), now = panel.querySelector('.feed-now');
  const busy = feedNow(sessions, { subagents: feedPrefs.subagents, unread });
  syncList(now, busy.map(session => [session.id, { id: session.id, provider: session.provider, status: session.status, title: session.title, project: session.project, detail: cardDetail(session), plan: planProgress(session), sub: !!session.parentId, unread: unread(session) }]), feedNowItem);
  now.hidden = !busy.length;
  for (const item of now.children) item.title = `${item.dataset.label} · ${stateAge(sessions.find(s => s.id === item.dataset.key))}`;
  renderFeedTimeline(panel.querySelector('#recent-messages'), feedGroups(sessions, feedPrefs.kind && feedPrefs.kind !== 'all' ? () => [] : feedShots, feedPrefs));
  dressTheme();
}
function syncFeedFilters(region) {
  const sessions = state.snapshot.sessions;
  const choices = {
    project: [['', 'All projects'], ...[...new Set(sessions.map(s => s.cwd).filter(Boolean))].map(cwd => [cwd, sessions.find(s => s.cwd === cwd).project])],
    provider: [['', 'All agents'], ['codex', 'Codex'], ['claude', 'Claude'], ['opencode', 'OpenCode']],
    session: [['', 'All sessions'], ...sessions.map(s => [s.id, workflow.title(s)])],
    kind: [['all', 'All activity'], ['replies', 'Final replies'], ['errors', 'Failures']],
  };
  for (const [key, entries] of Object.entries(choices)) {
    let select = region.querySelector(`[data-feed-filter="${key}"]`);
    if (!select) { select = el('select'); select.dataset.feedFilter = key; select.setAttribute('aria-label', `Feed ${key}`); select.onchange = () => { feedPrefs[key] = select.value; try { localStorage.setItem(feedKey, JSON.stringify(feedPrefs)); } catch {} renderFeed(); }; region.append(select); }
    const signature = JSON.stringify(entries);
    if (select.dataset.signature !== signature && document.activeElement !== select) { select.dataset.signature = signature; select.replaceChildren(...entries.map(([value, label]) => { const option = el('option', '', label); option.value = value; return option; })); }
    select.value = feedPrefs[key] || (key === 'kind' ? 'all' : '');
  }
}
function feedNowItem(session) {
  const item = el('button', `feed-now-item${session.unread ? ' unread' : ''}`); item.type = 'button'; item.dataset.status = session.status;
  item.dataset.label = [session.title, session.project, session.detail].join(' · '); item.onclick = () => openPanel(session.id);
  const mark = el('span', `agent-mark ${session.provider}`); mark.append(providerIcon(session.provider));
  const text = el('span', 'feed-now-text'), title = el('strong', '', session.title);
  if (session.sub) title.prepend(el('span', 'subagent-tag', 'Sub'));
  text.append(title, el('span', 'feed-now-detail', session.detail));
  item.append(el('i', 'dot'), mark, text);
  if (session.plan) item.append(chip(`${session.plan[0]}/${session.plan[1]}`, 'plan-chip', 'Plan steps done'));
  return item;
}
function renderFeedTimeline(region, groups) {
  if (!region.historyScroll) {
    const viewport = el('div', 'history-viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Live feed');
    viewport.append(el('div', 'history-content'));
    const latest = button('Latest', 'history-latest quiet-button', null, 'down'); latest.hidden = true;
    region.replaceChildren(viewport, latest); region.historyScroll = new HistoryScroll(viewport, latest);
  }
  const flow = region.historyScroll, content = region.querySelector('.history-content');
  const signature = JSON.stringify([groups.map(group => [group.key, group.session.title, group.session.status, group.entries]), feedPrefs]);
  if (region.dataset.signature !== signature) {
    region.dataset.signature = signature;
    const saved = flow.capture(), existing = new Map([...content.children].map(node => [node.dataset.messageId, node]));
    const containers = new Set(existing.values());
    const empty = () => { const note = el('p', 'muted history-empty', 'Nothing yet.'); note.dataset.messageId = 'empty'; return note; };
    const nodes = groups.length ? groups.map(group => feedGroup(group, takeShotContainer(containers, group.entries.flatMap(entry => entry.shots || []), group.session.id, existing.get(group.key)))) : [existing.get('empty') || empty()];
    for (const node of [...content.children]) if (!nodes.includes(node)) node.remove();
    nodes.forEach((node, index) => { if (content.children[index] !== node) content.insertBefore(node, content.children[index] || null); });
    flow.restore(saved);
  }
  for (const group of groups) {
    const time = [...content.children].find(node => node.dataset.messageId === group.key)?.querySelector('.feed-head time');
    if (time) setProperty(time, 'textContent', age(group.at));
  }
}
// One session's run of items: its name, then its messages, tool calls and screenshots as in its own panel. Unchanged ones stay mounted.
function feedGroup({ session, key, entries, at }, node) {
  const headSignature = JSON.stringify([session.title, session.project, session.status, session.provider, session.parentId, session.model]);
  if (!node) {
    node = el('section', 'feed-group');
    node.append(el('button', 'feed-head'), el('div', 'feed-entries'));
  }
  node.dataset.messageId = key; node.dataset.sessionId = session.id;
  const head = node.firstChild;
  if (head.dataset.signature !== headSignature) {
    head.dataset.signature = headSignature; head.type = 'button'; head.onclick = () => openPanel(session.id); head.title = `Open ${session.title}`;
    const mark = el('span', `agent-mark ${session.provider}`); mark.append(providerIcon(session.provider)); mark.title = providerName(session.provider);
    const name = el('strong', 'feed-name', session.title);
    if (session.parentId) name.prepend(el('span', `subagent-tag${session.agentKind === 'workflow' ? ' workflow-tag' : ''}`, session.agentKind === 'workflow' ? 'Workflow' : 'Subagent'));
    const time = el('time'); time.dateTime = new Date(at).toISOString();
    head.replaceChildren(mark, name, el('span', 'feed-project', session.project), badge(session.status), time, icon('arrow'));
    node.dataset.status = session.status;
  }
  const box = node.lastChild, existing = new Map([...box.children].map(child => [child.dataset.entryId, child])), children = [];
  const shotContainers = new Set(box.querySelectorAll('.history-shots'));
  for (const entry of entries) {
    const id = entry.shots ? `shots:${entry.shots[0].id}` : Array.isArray(entry) ? `run:${entry[0].id}` : entry.id;
    const previous = entry.shots ? takeShotContainer(shotContainers, entry.shots, undefined, existing.get(id)) : existing.get(id), signature = JSON.stringify(entry);
    if (previous?.dataset.signature === signature) { children.push(previous); continue; }
    const child = entry.shots ? shotStrip(session.id, entry, previous, showShot) : Array.isArray(entry) ? entry.length > 1 ? toolRun(entry, !!previous?.open) : toolLine(entry[0]) : messageNode(entry, session, previous);
    child.dataset.entryId = id; child.dataset.signature = signature; children.push(child);
  }
  for (const child of [...box.children]) if (!children.includes(child)) child.remove();
  children.forEach((child, index) => { if (box.children[index] !== child) box.insertBefore(child, box.children[index] || null); });
  return node;
}
function docStrip(session, group) {
  const strip = el('div', 'history-docs');
  for (const doc of group) {
    const chip = el('button', 'doc-chip'); chip.type = 'button';
    chip.title = [doc.path, doc.agent, doc.at && new Date(doc.at).toLocaleString()].filter(Boolean).join(' · ');
    chip.append(icon('file'), el('span', '', doc.name)); chip.onclick = () => showDocument(session, doc.id); strip.append(chip);
  }
  return strip;
}
// The names of a session's documents in rendered text open them. Text already linked is left alone, so this can run again as documents turn up.
function linkDocuments(root, documents, cwd, open) {
  if (!documents.length) return;
  const link = (doc, content) => { const b = el('button', 'doc-link'); b.type = 'button'; b.title = doc.path; b.append(...content); b.onclick = () => open(doc); return b; };
  for (const span of root.querySelectorAll('[data-doc-path]')) { const doc = matchDocument(span.dataset.docPath, documents, cwd); if (doc) span.replaceWith(link(doc, [...span.childNodes])); }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), texts = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('.md') && walker.currentNode.parentElement.closest('.message-text') && !walker.currentNode.parentElement.closest('a, button, pre')) texts.push(walker.currentNode);
  for (const text of texts) {
    const segments = documentSegments(text.nodeValue, documents, cwd);
    if (segments.some(segment => segment.document)) text.replaceWith(...segments.map(segment => segment.document ? link(segment.document, [segment.text]) : segment.text));
  }
}
const viewerButton = (content, label, action) => { const b = el('button', 'shot-button'); b.type = 'button'; b.append(content); b.setAttribute('aria-label', label); b.title = label; b.onclick = action; return b; };
// One document, as it is on disk now. A document it links to opens over it. Esc or the backdrop closes.
function showDocument(session, documentId) {
  const listed = () => docs.get(session.id)?.items || [], known = listed().find(doc => doc.id === documentId);
  const dialog = el('dialog', 'shot-viewer doc-viewer'); dialog.setAttribute('aria-label', 'Document');
  const bar = el('div', 'shot-bar'), meta = el('span', 'shot-meta', known?.name || 'Document'), body = el('div', 'doc-body message-text', 'Loading…');
  meta.title = known?.path || '';
  bar.append(meta, viewerButton('✕', 'Close (Esc)', () => dialog.close()));
  dialog.append(bar, body);
  // Only a press on the backdrop: dragging a text selection off the page ends with a click here too.
  let pressed = null;
  dialog.addEventListener('pointerdown', event => { pressed = event.target; });
  dialog.addEventListener('click', event => { if (event.target === dialog && pressed === dialog) dialog.close(); });
  dialog.onclose = () => dialog.remove();
  app.append(dialog); dialog.showModal();
  api(`sessions/${encodeURIComponent(session.id)}/documents/${encodeURIComponent(documentId)}`).then(({ name, path, text }) => {
    meta.textContent = name; meta.title = path; body.innerHTML = renderDocument(text); body.scrollTop = 0;
    linkDocuments(body, listed(), session.cwd, doc => showDocument(session, doc.id));
  }, error => { body.textContent = error.message; });
}
// One screenshot big over a strip of them all: pinch/scroll to zoom, drag to pan; a thumbnail, ‹ ›, ←/→ or a swipe at fit size steps; Esc or the backdrop closes.
function showShot(id, imageId, images = shots.get(id)?.items || [], closed) {
  let at = Math.max(0, images.findIndex(image => image.id === imageId));
  if (!images.length) return;
  const dialog = el('dialog', 'shot-viewer'); dialog.setAttribute('aria-label', 'Screenshot');
  const viewport = el('div', 'shot-full'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Image preview');
  viewport.title = 'Pinch or scroll to zoom · Drag to pan · Double-click to zoom/reset · + / − / 0';
  const picture = el('img'); picture.alt = ''; picture.draggable = false; viewport.append(picture);
  const link = el('a', 'shot-button', '↗'); link.target = '_blank'; link.rel = 'noopener'; link.title = 'Full size'; link.setAttribute('aria-label', 'Open full-size image');
  const bar = el('div', 'shot-bar'), meta = el('span', 'shot-meta');
  const step = by => { const next = Math.max(0, Math.min(images.length - 1, at + by)); if (next !== at) { at = next; show(); } };
  const prev = viewerButton('‹', 'Previous (←)', () => step(-1)), next = viewerButton('›', 'Next (→)', () => step(1));
  bar.append(prev, meta, next, link, viewerButton('✕', 'Close (Esc)', () => dialog.close()));
  const panZoom = new ImagePanZoom(viewport, picture, step);
  const thumbs = images.map((image, n) => {
    const thumb = el('button', 'shot-thumb'); thumb.type = 'button'; thumb.setAttribute('aria-label', `Screenshot ${n + 1}`);
    thumb.title = [image.agent, image.at && age(image.at)].filter(Boolean).join(' · ');
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = shotUrl(id, image.id);
    thumb.append(img); thumb.onclick = () => { if (at !== n) { at = n; show(); } }; return thumb;
  });
  const strip = el('div', 'shot-strip'); strip.append(...thumbs);
  const show = () => {
    panZoom.reset();
    const image = images[at]; picture.src = shotUrl(id, image.id); link.href = imageWindowUrl(id, image.id);
    thumbs.forEach((thumb, n) => thumb.classList.toggle('current', n === at)); thumbs[at].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    meta.textContent = [`${at + 1}/${images.length}`, image.agent, image.at && age(image.at)].filter(Boolean).join(' · ');
    const focused = document.activeElement;
    prev.disabled = at === 0; next.disabled = at === images.length - 1;
    if ((focused === prev && prev.disabled) || (focused === next && next.disabled)) viewport.focus({ preventScroll: true });
  };
  dialog.append(...(images.length > 1 ? [viewport, strip, bar] : [viewport, bar]));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    else if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') panZoom.reset(); else panZoom.zoom(panZoom.scale * (event.key === '-' ? 1 / 1.5 : 1.5));
    }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.onclose = () => { panZoom.destroy(); dialog.remove(); closed?.(); };
  app.append(dialog); show(); dialog.showModal();
}
// Older pages end where the live window starts, so polling keeps the newest part current.
function mergeHistory(earlier = [], recent) {
  if (!earlier.length) return recent;
  const cut = earlier.findIndex(message => message.id === recent[0]?.id), ids = new Set(recent.map(message => message.id));
  return [...(cut >= 0 ? earlier.slice(0, cut) : earlier.filter(message => !ids.has(message.id))), ...recent];
}
async function loadOlder(id) {
  const current = older.get(id), limit = Math.min(1000, (current?.limit || 40) + 40);
  older.set(id, { messages: [], more: true, ...current, loading: true }); renderPanel();
  try {
    const result = await api(`sessions/${encodeURIComponent(id)}/history?limit=${limit}`);
    older.set(id, { limit, messages: result.messages, more: result.more && limit < 1000 });
    // Codex discovers images as history pages load, even when the session itself has not changed.
    const images = shots.get(id); if (images) { images.changed = null; images.fetched = 0; }
  }
  catch (error) { toast(error.message); if (current) older.set(id, current); else older.delete(id); }
  if (state.selected === id && state.snapshot) renderPanel();
}
function toolLine(message) {
  const article = el('article', `recent-message tool${message.failed ? ' failed' : ''}`);
  const line = el('code', 'tool-call', message.text); line.title = [message.detail, message.failed && 'Failed', message.timestamp && new Date(message.timestamp).toLocaleString()].filter(Boolean).join('\n');
  article.append(line); return article;
}
function toolRun(run, open) {
  const details = el('details', 'tool-run'); details.open = open;
  const failed = run.filter(message => message.failed).length;
  const summary = el('summary'); summary.append(el('strong', '', `${run.length} tool calls`)); if (failed) summary.append(el('span', 'tool-run-failed', `${failed} failed`));
  summary.append(el('code', 'tool-call', run.at(-1).text)); details.append(summary);
  populateOnOpen(details, () => run.map(toolLine));
  return details;
}
function messageNode(message, session, previous) {
  if (message.tool) return toolLine(message);
  const article = el('article', `recent-message ${message.role}${message.error ? ' error' : ''}`);
  if (message.role === 'notice') { const line = el('span', '', message.text); line.title = message.timestamp ? new Date(message.timestamp).toLocaleString() : ''; article.append(line); return article; }
  // A subagent's "user" turn is the task its parent gave it.
  const meta = el('div', 'message-meta'); meta.append(el('strong', '', message.role === 'user' ? session.parentId ? 'Task' : 'You' : session.parentId ? session.model || 'Subagent' : providerName(session.provider)));
  if (message.timestamp) { const time = el('time', '', age(message.timestamp)); time.dateTime = new Date(message.timestamp).toISOString(); time.title = new Date(message.timestamp).toLocaleString(); meta.append(time); }
  const rendered = renderMessageMarkdown(message.text);
  const body = el('div', 'message-text'); body.innerHTML = rendered.html;
  article.append(meta, body);
  if (rendered.more) {
    const more = el('details', 'message-more'); more.dataset.id = message.id; more.open = !!previous?.querySelector('details[open]');
    const toggle = el('summary', 'quiet-button', more.open ? 'Read less' : 'Read more');
    more.ontoggle = () => { toggle.textContent = more.open ? 'Read less' : 'Read more'; };
    const rest = el('div', 'message-text'); rest.innerHTML = rendered.more;
    more.append(toggle, rest); article.append(more);
  }
  if (message.truncated) article.append(el('span', 'muted', 'Long message shortened.'));
  const actions = el('div', 'message-actions'), copy = el('button', 'message-copy');
  const label = message.truncated ? 'Copy available text (message shortened)' : 'Copy message';
  copy.type = 'button'; copy.title = label; copy.setAttribute('aria-label', label); copy.append(icon('copy'));
  let reset, copying = false;
  copy.onclick = async () => {
    if (copying) return;
    clearTimeout(reset); copying = true;
    try {
      // Copy the source, including blocks hidden behind Read more, without rendered HTML or metadata.
      await copyText(message.text);
      copy.replaceChildren(icon('check')); copy.title = 'Copied'; copy.setAttribute('aria-label', 'Copied');
      toast(message.truncated ? 'Copied available text (message shortened)' : 'Copied');
    } catch { toast('Copy failed. Select the message and copy it manually.'); }
    finally {
      copying = false;
      reset = setTimeout(() => { copy.replaceChildren(icon('copy')); copy.title = label; copy.setAttribute('aria-label', label); }, 1500);
    }
  };
  actions.append(copy); article.append(actions);
  return article;
}

function renderAccessPanel() {
  disposeHistory();
  disposeComposer();
  const panel = revealPanel(); panel.replaceChildren();
  panel.classList.remove('chat-panel', 'feed-panel');
  panel.dataset.sessionId = ''; delete panel.dataset.view;
  const head = el('div', 'panel-heading'); head.append(button('Back to sessions', 'quiet-button', closePanel, 'back'), el('span', 'eyebrow', 'WORKSPACE ACCESS')); panel.append(head);
  const access = el('div', 'access-console');
  access.append(el('h2', 'panel-title', 'Choose a PIN or password'), el('p', 'muted access-copy', 'Use a 4–8 digit PIN or a password with at least 8 characters.')); panel.append(access);
  const form = el('form', 'access-form');
  const fields = {};
  for (const [name, title, autocomplete] of [['current', 'Current PIN or password', 'current-password'], ['next', 'New PIN or password', 'new-password'], ['repeat', 'Repeat new PIN or password', 'new-password']]) {
    const label = el('label', '', title), input = el('input'); input.name = name; input.type = 'password'; input.required = true; input.maxLength = 1024; input.autocomplete = autocomplete;
    label.append(input); form.append(label); fields[name] = input;
  }
  // The number keyboard is opt-in: on a phone it has no letters, so a password couldn't be typed.
  const keyboard = el('label', 'keyboard-choice'); const pinMode = el('input'); pinMode.type = 'checkbox'; pinMode.onchange = () => { fields.next.inputMode = fields.repeat.inputMode = pinMode.checked ? 'numeric' : 'text'; }; keyboard.append(pinMode, document.createTextNode('Use the PIN number keyboard')); form.append(keyboard);
  const error = el('p', 'form-error'); error.setAttribute('role', 'alert');
  const save = el('button', 'primary', 'Save and lock'); save.type = 'submit'; form.append(error, save);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = '';
    if (fields.next.value !== fields.repeat.value) { error.textContent = 'The new entries do not match.'; return; }
    save.disabled = true;
    try { await api('password', { current: fields.current.value, next: fields.next.value }); navigation.reset(); showLogin(); }
    catch (e) { error.textContent = e.message; save.disabled = false; }
  };
  access.append(form); fields.current.focus();
  api('auth').then(data => { if (fields.current.isConnected) fields.current.inputMode = data.kind === 'pin' ? 'numeric' : 'text'; }).catch(() => {});
}

async function respond(request, payload, container, error) {
  if (state.error) return;
  if (container.dataset.busy) return;
  container.dataset.busy = 'true';
  const controls = [...container.querySelectorAll('button, input')]; controls.forEach(b => b.disabled = true); error.textContent = '';
  try {
    await api(`requests/${request.id}/respond`, payload);
    toast('Response delivered'); panelSignature = ''; await refresh();
  } catch (e) { error.textContent = e.message; controls.forEach(b => b.disabled = false); }
  finally { delete container.dataset.busy; }
}

function toast(text) { const node = el('div', 'toast', text); node.setAttribute('role', 'status'); app.append(node); setTimeout(() => node.remove(), 3500); }
function newOpenCodeSession() {
  if (document.querySelector('.new-session-dialog')) return;
  const dialog = el('dialog', 'new-session-dialog'), form = el('form', 'new-session-form');
  const title = el('h2', '', 'New OpenCode session'); title.id = 'new-session-title'; dialog.setAttribute('aria-labelledby', title.id);
  const label = el('label', '', 'Folder'), folder = el('input'); folder.required = true; folder.autocomplete = 'off'; folder.spellcheck = false; folder.placeholder = '~/project'; folder.maxLength = 4096;
  folder.setAttribute('list', 'new-session-folders'); folder.value = state.project || ''; label.append(folder);
  const known = el('datalist'); known.id = 'new-session-folders';
  for (const cwd of new Set((state.snapshot?.sessions || []).map(session => session.cwd).filter(Boolean))) { const option = el('option'); option.value = cwd; known.append(option); }
  const connection = el('p', 'form-error'); connection.setAttribute('role', 'status');
  const error = el('p', 'form-error'); error.setAttribute('role', 'alert');
  const actions = el('div', 'new-session-actions');
  const cancel = button('Cancel', 'secondary', () => dialog.close());
  const submit = button('Create', 'primary', undefined, 'plus'); submit.type = 'submit'; actions.append(cancel, submit);
  let sending = false;
  dialog.updateConnection = () => {
    const provider = state.snapshot?.providers?.find(provider => provider.name === 'OpenCode');
    connection.textContent = state.error || (!state.snapshot ? 'Connecting…' : !state.snapshot.features?.opencode ? 'Connect OpenCode: npm run setup -- --opencode auto, then npm restart.' : !provider?.connected ? provider?.detail || 'OpenCode is disconnected. Start OpenCode to reconnect.' : '');
    connection.hidden = !connection.textContent; submit.disabled = sending || !!connection.textContent;
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (sending || submit.disabled) return;
    const cwd = folder.value.trim(); if (!cwd) { folder.focus(); return; }
    sending = true; error.textContent = ''; folder.disabled = cancel.disabled = true; dialog.updateConnection();
    try {
      const result = await api('spawn', { provider: 'opencode', cwd });
      if (!dialog.isConnected) return;
      dialog.close(); await refresh(); if (state.csrf) { openPanel(result.sessionId); toast(result.warning || 'OpenCode session created'); }
    } catch (e) { error.textContent = e.message; }
    finally { sending = false; folder.disabled = cancel.disabled = false; dialog.updateConnection(); }
  };
  dialog.oncancel = event => { if (sending) event.preventDefault(); };
  dialog.onclose = () => { dialog.remove(); if (!state.selected) document.querySelector('#agent-filter-menu summary')?.focus(); };
  dialog.onclick = event => { if (event.target === dialog && !sending) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } };
  form.append(title, label, known, connection, error, actions); dialog.append(form); app.append(dialog); dialog.updateConnection(); dialog.showModal(); folder.focus();
}
const hireSignature = cwd => hireChoices(state.snapshot, cwd).flatMap(choice => [choice.label, ...(choice.accounts || []).map(account => account.label)]);
function spawnButtons(cwd) {
  const actions = el('span', 'group-actions');
  for (const choice of hireChoices(state.snapshot, cwd)) {
    const b = button(choice.label, 'quiet-button spawn-button', () => choice.accounts ? toggleAccountMenu(b, cwd, choice.accounts) : spawnAgent(cwd, choice, b), 'plus');
    b.insertBefore(providerIcon(choice.provider), b.lastChild);
    if (choice.accounts) { b.append(hireCaret()); b.title = 'Claude account'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); }
    else b.title = `New ${choice.name}${choice.provider === 'opencode' ? ' session' : ' in tmux'}`;
    actions.append(b);
  }
  return actions;
}
function projectSpawn(cwd) {
  const control = button('', 'quiet-button spawn-button project-spawn', () => {
    const choices = hireChoices(state.snapshot, cwd).flatMap(choice => choice.accounts ? choice.accounts.map(account => ({ ...account, label: `Claude · ${account.label}` })) : [choice]);
    toggleAccountMenu(control, cwd, choices, 'New agent');
  }, 'plus');
  control.title = 'New agent in this project'; control.setAttribute('aria-label', 'New agent in this project'); control.setAttribute('aria-haspopup', 'menu'); control.setAttribute('aria-expanded', 'false');
  return control;
}
// In the top layer and outside the list: no scrolling parent clips it, and a panel or header redraw can't close it mid-pick.
let closeAccountMenu = null;
function toggleAccountMenu(control, cwd, accounts, label = 'Claude account') {
  const reopen = closeAccountMenu?.control !== control;
  closeAccountMenu?.();
  if (!reopen) return;
  const menu = el('div', 'filter-options account-options'); menu.popover = 'manual'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
  const items = accounts.map(account => {
    const item = button(account.label, 'tab', () => { close(); spawnAgent(cwd, account, control); });
    item.setAttribute('role', 'menuitem'); item.title = `New ${account.name}${account.provider === 'opencode' ? ' session' : ' in tmux'}${account.last ? ' · last used here' : ''}`;
    item.disabled = !!state.error;
    if (label === 'New agent') item.prepend(providerIcon(account.provider));
    if (account.last) item.append(el('span', 'last', 'last'));
    return item;
  });
  const listening = new AbortController();
  function close(returnFocus) {
    listening.abort(); menu.remove(); closeAccountMenu = null; control.setAttribute('aria-expanded', 'false');
    if (returnFocus && control.isConnected) control.focus();
  }
  close.control = control; closeAccountMenu = close;
  // Keys stay in the menu: Esc would close the panel behind it, and j, k and n act on the list.
  menu.onkeydown = event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  };
  for (const [type, target] of [['scroll', document], ['resize', window]]) target.addEventListener(type, () => close(), { capture: true, signal: listening.signal });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !control.contains(event.target)) close(); }, { capture: true, signal: listening.signal });
  menu.append(...items); app.append(menu); menu.showPopover(); control.setAttribute('aria-expanded', 'true');
  const at = control.getBoundingClientRect(), { offsetWidth: w, offsetHeight: h } = menu;
  menu.style.left = `${Math.max(8, Math.min(at.right, innerWidth - 8) - w)}px`;
  menu.style.top = `${at.bottom + 4 + h > innerHeight - 8 ? Math.max(8, at.top - 4 - h) : at.bottom + 4}px`;
  items[0].focus();
}
// Sessions that went without a goodbye (server/recovery.mjs): what each was last asked, said and doing, to resume in tmux or let go.
const lostStates = { working: 'was working', permission: 'needed approval', question: 'asked you', idle: 'idle', error: 'error' };
let lostOpen = true;
// After a restart, sessions from before get a moment to show up before they count as lost: `checking` says how many are
// still awaited, so an empty list right after a reboot doesn't look like nothing is coming.
function renderLost(section, lost, checking = 0) {
  const signature = JSON.stringify([lost, checking, !!state.error, Math.floor(Date.now() / 60_000)]);
  if (section.dataset.sig === signature) return;
  section.dataset.sig = signature; section.hidden = !lost.length && !checking;
  if (section.hidden) { section.replaceChildren(); return; }
  const looking = el('span', 'lost-checking');
  looking.append(icon('spinner'), el('span', '', lost.length ? `checking ${checking}` : `Checking ${checking} earlier session${checking > 1 ? 's' : ''}…`));
  looking.title = 'Open before the restart; any that don’t come back can be resumed here';
  const details = el('details');
  if (!lost.length) {
    const summary = el('summary', 'lost-summary waiting'); summary.onclick = event => event.preventDefault(); summary.append(looking);
    details.append(summary); section.replaceChildren(details); return;
  }
  details.open = lostOpen; details.ontoggle = () => { lostOpen = details.open; };
  const ready = lost.filter(entry => !entry.resuming).map(entry => entry.id);
  const summary = el('summary', 'lost-summary'); summary.title = 'Ended without exiting: a crash, a killed tmux or a shutdown';
  const actions = el('span', 'lost-actions');
  if (ready.length > 1) actions.append(lostButton('Resume all', 'play', ready, 'resume', `Resume ${ready.length} in tmux`));
  actions.append(lostButton('', 'close', lost.map(entry => entry.id), 'dismiss', 'Dismiss all'));
  summary.append(icon('restore'), el('strong', '', `${lost.length} lost`), el('span', 'lost-when', age(lost[0].seenAt)), ...checking ? [looking] : [], actions);
  const list = el('ul', 'lost-list');
  for (const entry of lost) {
    const row = el('li', `lost-row${entry.resuming ? ' resuming' : ''}`), main = el('div', 'lost-main'), head = el('div', 'lost-head');
    const mark = el('span', `lost-mark ${entry.provider}`); mark.append(providerIcon(entry.provider)); mark.title = providerName(entry.provider);
    head.append(el('strong', 'lost-title', entry.title || 'Untitled'), el('span', 'lost-project', entry.project));
    head.lastChild.title = entry.cwd;
    if (entry.account) head.append(chip(entry.account, 'account-chip', 'Claude account'));
    if (lostStates[entry.status]) head.append(chip(lostStates[entry.status], `lost-state ${entry.status}`, `Last seen ${age(entry.seenAt).toLowerCase()}`));
    if (entry.detail) head.append(el('span', 'lost-detail', entry.detail));
    main.append(head);
    for (const [key, text] of [['said', entry.prompt], ['reply', entry.reply]]) if (text) { const line = el('div', `lost-${key}`, text); line.title = text; main.append(line); }
    const buttons = el('div', 'lost-actions');
    buttons.append(lostButton(entry.resuming ? 'Starting' : 'Resume', 'play', [entry.id], 'resume', `${entry.provider === 'codex' ? 'codex resume' : 'claude --resume'} in tmux${entry.mode ? ` · ${entry.mode} mode` : ''}`, entry.resuming), lostButton('', 'close', [entry.id], 'dismiss', 'Dismiss'));
    row.append(mark, main, buttons); list.append(row);
  }
  details.append(summary, list); section.replaceChildren(details);
}
function lostButton(label, iconName, ids, action, title, busy = false) {
  const b = button(label, `quiet-button lost-${action}`, async event => {
    event.preventDefault(); event.stopPropagation(); // In the summary, a press would fold the list too.
    b.disabled = true;
    try {
      const { resumed = [], failed = [] } = await api(`lost/${action}`, { ids });
      const names = new Map((state.snapshot.lost || []).map(entry => [entry.id, entry.title]));
      if (failed.length) toast(failed.map(({ id, error }) => `${names.get(id) || 'Session'}: ${error}`).join(' · '));
      else if (resumed.length) toast(resumed.length > 1 ? `Resuming ${resumed.length} in tmux` : 'Resuming in tmux');
    } catch (error) { toast(error.message); }
    refresh();
  }, iconName);
  b.title = title; if (!label) b.setAttribute('aria-label', title);
  b.disabled = busy || !!state.error;
  return b;
}

// The toolbar's +: an agent in any folder, a new one included, like a scene's + (scene-ui.js).
function newAgentMenu() {
  const menu = el('details', 'filter-menu new-agent-menu'); menu.id = 'new-agent-menu';
  const summary = el('summary', 'quiet-button'); summary.append(icon('plus')); summary.setAttribute('aria-label', 'New agent'); summary.title = 'New agent';
  const options = el('div', 'filter-options new-agent-options'); options.setAttribute('role', 'group'); options.setAttribute('aria-label', 'New agent');
  const field = createFolderField(() => options.querySelector('.tab')?.click());
  menu.append(summary, options);
  menu.ontoggle = () => {
    if (!menu.open) return;
    field.reset([...new Set((state.snapshot?.sessions || []).map(s => s.cwd).filter(Boolean))].sort());
    options.replaceChildren(...field.nodes, ...hireRows(hireChoices(state.snapshot, ''), choice => {
      const b = button(choice.label, 'tab', () => {
        if (!field.value || field.refused) { field.input.focus(); return; }
        menu.open = false; spawnAgent(field.value, { ...choice, create: true }, b);
      });
      if (choice.account === undefined) b.insertBefore(providerIcon(choice.provider), b.lastChild);
      b.title = `New ${choice.name}${choice.provider === 'opencode' ? ' session' : ' in tmux'}`; return b;
    }));
  };
  placeMenu(menu, summary, options);
  return menu;
}
// `choice.create`: a typed folder (a scene's + or the toolbar's), made first if it isn't there yet.
async function spawnAgent(cwd, choice, control, slot) {
  if (state.error) return;
  control.disabled = true;
  try {
    const result = await api('spawn', { cwd, provider: choice.provider, account: choice.account, ...typeof slot === 'number' ? { slot } : {}, ...choice.create ? { create: true } : {} });
    if (result.sessionId) { await refresh(); openPanel(result.sessionId); toast(result.warning || `${choice.name} session created`); }
    else toast(`${choice.name} started in tmux ${result.session}${result.window ? `:${result.window}` : ''}`);
  }
  catch (e) { toast(e.message); }
  finally { control.disabled = false; }
}

async function lock() {
  disposeComposer(); await workflow.flushDrafts();
  const logout = api('logout', {}, { keepalive: true });
  navigation.reset();
  showLogin(); document.title = 'AI Control';
  try { await logout; } catch { /* local display still locks if offline */ }
}
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    if (!state.csrf || document.querySelector('dialog[open]:not(.command-palette)')) return;
    event.preventDefault(); if (palette) palette.close(); else openCommands(); return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (event.key !== 'Escape' && event.key !== 'Tab') return;
  const openTheme = document.querySelector('.theme-menu[open]');
  if (event.key === 'Escape' && openTheme) { openTheme.open = false; openTheme.querySelector('summary').focus(); return; }
  const menu = document.querySelector('#agent-filter-menu[open], #new-agent-menu[open]');
  if (event.key === 'Escape' && menu) { menu.open = false; menu.querySelector('summary').focus(); return; }
  // Esc in a dialog closes that dialog, not the panel behind it.
  if (event.key === 'Escape' && state.selected && !event.target.closest?.('dialog')) closePanel();
  if (event.key === 'Tab' && state.selected && !workflow.splitFrame) {
    const regions = [document.querySelector('#panel'), ...(state.selected === 'feed' ? [document.querySelector('.mobile-nav')] : [])].filter(Boolean);
    const controls = regions.flatMap(region => [...region.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])')]).filter(node => node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
// Single-key shortcuts outside text fields: / search, j k move between cards, n next waiting session.
document.addEventListener('keydown', event => {
  if (!workflow.shortcuts || !state.csrf || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open], details[open].theme-menu, #agent-filter-menu[open], #new-agent-menu[open]')) return;
  if (event.key === 'n' && nextWaiting(state.selected)) { event.preventDefault(); if (scene && !state.selected) scene.talkTo(nextWaiting().id); else openNext(); return; }
  if (event.key === 'f') { event.preventDefault(); openFeed(); return; }
  if (state.selected) return;
  if (event.key === '/') { event.preventDefault(); document.querySelector('.toolbar input[type=search]')?.focus(); return; }
  if (event.key !== 'j' && event.key !== 'k') return;
  const cards = [...document.querySelectorAll('#groups .session-card')], index = cards.indexOf(document.activeElement);
  cards[index < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, index + (event.key === 'j' ? 1 : -1)))]?.focus();
  event.preventDefault();
});
listenForOpen(id => { if (state.csrf) openPanel(id); else location.hash = new URLSearchParams({ session: id }).toString(); });
document.addEventListener('pointerdown', event => { for (const menu of document.querySelectorAll('#agent-filter-menu, #new-agent-menu, .theme-menu')) if (menu.open && !menu.contains(event.target)) menu.open = false; });
function sendActivity() {
  clearTimeout(activityTimer); activityTimer = null;
  if (!state.csrf) return;
  touching = Date.now(); api('activity', {}, { keepalive: true }).catch(() => {});
}
for (const name of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchmove']) document.addEventListener(name, event => {
  if (!event.isTrusted || !state.csrf) return;
  if (Date.now() - state.lastActivity >= idleMs) { lock(); return; }
  state.lastActivity = Date.now();
  workflow.activity();
  if (name === 'input') liveRender.interact();
  if (Date.now() - touching >= 10_000) sendActivity();
  else if (!activityTimer) activityTimer = setTimeout(sendActivity, 10_000 - (Date.now() - touching));
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (activityTimer) sendActivity(); return; }
  if (state.csrf && Date.now() - state.lastActivity >= idleMs) lock();
  else if (state.csrf) refresh();
});
window.addEventListener('pagehide', () => { if (activityTimer) sendActivity(); });
followKeyboard();
setInterval(() => { if (state.csrf && Date.now() - state.lastActivity >= idleMs) lock(); }, 1000);

// Reuse an unexpired login without treating page loads or polling as activity.
async function restoreLogin() {
  app.append(el('p', 'restoring-login muted', 'Opening workspace…'));
  try {
    const auth = await api('auth');
    if (!auth.authenticated) { showLogin(); return; }
    state.csrf = auth.csrf; state.lastActivity = Date.now() - idleMs + Math.min(idleMs, auth.idleRemainingMs ?? idleMs);
    showWorkspace(); await refresh();
  } catch { showLogin(); }
}
restoreLogin();

// One preview picker for first visits and every theme control. Closing without a choice keeps the current look.
function showThemePicker(trigger, welcome = false) {
  showThemeGallery({
    trigger, current: document.documentElement.dataset.themeChoice, onChoose: chooseTheme, outlined,
    onOutlinesChange: value => { outlined = value; try { localStorage.setItem(outlinesKey, value ? 'on' : 'off'); } catch { /* per tab only */ } scene?.outlines?.(value); },
    onClose: () => { if (welcome) bootSequence(); },
  });
}
if (firstVisit) showThemePicker(undefined, true);
