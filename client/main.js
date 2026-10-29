import './style.css';
import './themes.css';
import './theme-effects.css';
import { applyTheme, savedTheme, hasSavedTheme, themes, bootSequence } from './themes.js';
import { PanelNavigation } from './navigation.js';
import { HistoryScroll } from './history-scroll.js';
import { fieldLabel, requestPresentation } from './request-presentation.js';
import { SessionActivity, compareSessions, compareProjects } from './session-order.js';
import { messagingUnavailableReason } from './messaging-status.js';
import { ComposerInput, followKeyboard } from './composer-input.js';
import { LiveRender } from './live-render.js';
import { renderMessageMarkdown } from './message-markdown.js';
import { renderUsage } from './usage.js';
import { renderThemeConsole } from './theme-console.js';
import { hireChoices } from './hire.js';
import { alertSettings, saveAlerts, canNotify, statusEvents, signal, playSound, enableNotifications, listenForOpen, faviconBadge } from './alerts.js';

const app = document.querySelector('#app');
const firstVisit = !hasSavedTheme();
applyTheme(savedTheme());
const idleMs = 10 * 60_000;
const sessionActivity = new SessionActivity();
const messageDrafts = new Map();
const statValues = new Map();
const previousStatuses = new Map();
// Older history fetched for an open panel: session id → { limit, messages, more }.
const older = new Map();
// Effort chosen here for Claude, shown until its transcript reports it.
const pendingEffort = new Map();
// When each session was last opened, so finished work you haven't looked at gets a dot.
const seenKey = 'ai-control-seen';
const seen = (() => { try { return new Map(JSON.parse(localStorage.getItem(seenKey) || '[]')); } catch { return new Map(); } })();
if (!seen.has('*')) seen.set('*', Date.now());
function markSeen(id) {
  if (!id || id === 'access') return;
  seen.set(id, Date.now());
  try { localStorage.setItem(seenKey, JSON.stringify([...seen].sort((a, b) => b[1] - a[1]).slice(0, 300))); } catch { /* per tab only */ }
}
const unread = session => session.status === 'idle' && !session.parentId && (session.statusSince || 0) > (seen.get(session.id) || seen.get('*'));
const liveRender = new LiveRender(() => renderData());
const groupingKey = 'ai-control-grouping';
const savedGrouping = () => { try { return localStorage.getItem(groupingKey) === 'flat' ? 'flat' : 'project'; } catch { return 'project'; } };
const state = { csrf: '', snapshot: null, filter: 'all', project: '', provider: 'all', grouping: savedGrouping(), search: '', selected: null, error: '', lastActivity: Date.now() };
const navigation = new PanelNavigation(window, id => {
  if (!state.csrf) return;
  if (!id) { hidePanel(); return; }
  state.selected = id; panelSignature = '';
  if (id === 'access') renderAccessPanel(); else if (state.snapshot) renderPanel();
});
let poll, touching = 0, activityTimer, panelSignature = '', loading = false;
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
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11"/>',
  next: '<path d="m6 5 7 7-7 7m7-14 7 7-7 7"/>',
  exit: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m5-12 4 4-4 4m4-4H9"/>',
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
  for (const option of document.querySelectorAll('.theme-choice[data-theme-choice]')) option.setAttribute('aria-pressed', String(option.dataset.themeChoice === id));
  syncOffice();
}
function themeMenu() {
  const menu = el('details', 'theme-menu');
  const summary = el('summary', 'quiet-button'); summary.append(icon('theme')); summary.setAttribute('aria-label', 'Change theme'); summary.title = 'Change theme';
  const choices = el('div', 'theme-options'); choices.setAttribute('aria-label', 'Color theme');
  for (const theme of themes) {
    const choice = button(theme.name, 'theme-choice', () => { chooseTheme(theme.id); menu.open = false; summary.focus(); });
    choice.dataset.themeChoice = theme.id; choice.setAttribute('aria-pressed', String(document.documentElement.dataset.themeChoice === theme.id));
    choice.prepend(el('i', `theme-swatch ${theme.id}`)); choices.append(choice);
  }
  menu.append(summary, choices); placeMenu(menu, summary, choices); return menu;
}
// The sidebar scrolls and would clip the list, so open it against the viewport there.
function placeMenu(menu, summary, choices) {
  menu.ontoggle = () => {
    choices.removeAttribute('style');
    if (!menu.open || !menu.closest('.sidebar')) return;
    const r = summary.getBoundingClientRect();
    Object.assign(choices.style, { position: 'fixed', top: 'auto', right: 'auto', left: `${Math.max(8, Math.min(r.left, innerWidth - choices.offsetWidth - 8))}px`, bottom: `${innerHeight - r.top + 6}px` });
  };
}
// Opt-in notifications and the theme's sound; turning sound on plays it once.
function alertsMenu() {
  const menu = el('details', 'theme-menu alerts-menu');
  const summary = el('summary', 'quiet-button'); summary.append(icon('bell')); summary.setAttribute('aria-label', 'Alerts'); summary.title = 'Alerts';
  const choices = el('div', 'theme-options'); choices.setAttribute('aria-label', 'Alerts');
  const sync = () => { for (const option of choices.children) option.setAttribute('aria-pressed', String(!!alertSettings[option.dataset.alert])); menu.classList.toggle('alerts-on', alertSettings.notify || alertSettings.sound); };
  const notify = button('Notifications', 'theme-choice', async () => {
    alertSettings.notify = !alertSettings.notify && await enableNotifications();
    if (!alertSettings.notify && globalThis.Notification?.permission === 'denied') toast('Notifications are blocked for this site');
    saveAlerts(); sync();
  }, 'bell');
  notify.dataset.alert = 'notify';
  if (!canNotify()) { notify.disabled = true; notify.title = 'Needs HTTPS'; }
  const sound = button('Sound', 'theme-choice', () => { alertSettings.sound = !alertSettings.sound; saveAlerts(); sync(); if (alertSettings.sound) playSound('on'); }, 'sound');
  sound.dataset.alert = 'sound';
  choices.append(notify, sound); menu.append(summary, choices); placeMenu(menu, summary, choices); sync();
  return menu;
}
// Each theme names the control room after its own computer; CSS shows the active one.
const brandNames = { modern: 'AI Control', alien: 'MU/TH/UR', command: 'EVA' };
function brand() {
  const logo = el('div', 'brand'); logo.setAttribute('role', 'img'); logo.setAttribute('aria-label', 'AI Control');
  for (const [id, name] of Object.entries(brandNames)) {
    const variant = el('span', `brand-variant ${id}`), mark = el('span', 'brand-mark');
    if (id === 'modern') for (let i = 0; i < 3; i++) mark.append(el('i'));
    variant.append(mark, el('span', 'brand-name', name)); logo.append(variant);
  }
  return logo;
}
function badge(status) { const [label, color] = statuses[status] || statuses.unknown; const node = el('span', `badge ${color}`); node.append(el('i', 'dot'), el('span', '', label)); return node; }
const needsInput = session => ['permission', 'question'].includes(session.status);
const providerName = provider => provider === 'codex' ? 'Codex' : 'Claude Code';
function age(time) { if (!time) return 'No activity time'; const seconds = Math.max(0, (Date.now() - time) / 1000); return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`; }

async function api(path, body, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') showLogin();
    throw new Error(data.error || 'Could not connect to AI Control.');
  }
  return data;
}

function showLogin(message = '') {
  disposeHistory();
  disposeComposer(); liveRender.cancel();
  messageDrafts.clear();
  clearTimeout(activityTimer); activityTimer = null;
  clearInterval(poll); office?.unmount(); office = null; state.csrf = ''; state.snapshot = null; state.selected = null; panelSignature = ''; document.body.classList.remove('panel-open');
  app.replaceChildren(); document.documentElement.removeAttribute('data-attention'); document.documentElement.removeAttribute('data-working');
  const screen = el('main', 'login-screen');
  screen.append(themeMenu());
  const card = el('section', 'login-card');
  const symbol = el('div', 'login-symbol'); symbol.append(icon('lock'));
  card.append(brand(), symbol);
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
  api('auth').then(data => {
    if (!input.isConnected) return;
    const pin = data.kind === 'pin'; input.setAttribute('aria-label', pin ? 'PIN' : 'Password');
    input.inputMode = pin ? 'numeric' : 'text'; input.placeholder = pin ? 'Enter your PIN' : 'Enter your password';
    input.maxLength = pin ? 8 : 1024;
  }).catch(() => {});
}

function showWorkspace() {
  app.innerHTML = '';
  const shell = el('div', 'shell');
  const aside = el('aside', 'sidebar'); aside.append(brand());
  const console = el('div', 'theme-console'); console.id = 'theme-console'; aside.append(console, el('div', 'sidebar-label', 'WORKSPACE'));
  const nav = el('nav', 'main-nav'); nav.setAttribute('aria-label', 'Workspace'); nav.id = 'navigation'; aside.append(nav);
  aside.append(el('div', 'sidebar-label project-label', 'PROJECTS'), el('nav', 'project-nav')); aside.lastChild.id = 'projects'; aside.lastChild.setAttribute('aria-label', 'Projects');
  shell.append(aside);
  const content = el('div', 'workspace');
  const topbar = el('header', 'topbar');
  const topActions = el('div', 'top-actions'); const live = el('span', 'live-label', 'Connecting…'); live.id = 'connection'; const access = button('PIN', 'quiet-button access-button', () => { previousFocus = document.activeElement; navigation.open('access'); }, 'key'); access.title = 'Change PIN / password'; const lockButton = button('Lock', 'quiet-button', () => lock(), 'lock'); lockButton.title = 'Lock now'; topActions.append(live, alertsMenu(), themeMenu(), access, lockButton); topbar.append(brand()); content.append(topbar);
  // Desktop has no top bar: its controls sit at the bottom of the sidebar.
  const wide = matchMedia('(min-width: 641px)'), placeActions = () => (wide.matches ? aside : topbar).append(topActions);
  wide.onchange = placeActions; placeActions();
  const main = el('main', 'main-content');
  const heading = el('div', 'page-heading'); const headingText = el('div'); headingText.append(el('h1', '', 'Sessions')); heading.append(headingText);
  const machineLabel = el('span', 'machine-label'); machineLabel.id = 'machine'; heading.append(machineLabel); const statusLine = el('div', 'status-line'); statusLine.id = 'status-line'; main.append(statusLine, heading);
  const notice = el('div', 'connection-error'); notice.id = 'error'; notice.setAttribute('role', 'status'); notice.hidden = true; main.append(notice);
  const stats = el('div', 'stats'); stats.id = 'stats'; main.append(stats);
  const usage = el('section', 'usage'); usage.id = 'usage'; usage.setAttribute('aria-label', 'Usage limits'); main.append(usage);
  const toolbar = el('div', 'toolbar'); const menu = el('details', 'filter-menu'); menu.id = 'agent-filter-menu';
  const summary = el('summary', 'quiet-button', '…'); summary.setAttribute('aria-label', 'Filter sessions by agent'); summary.title = 'Agent filter'; menu.append(summary);
  const tabs = el('div', 'filter-options'); tabs.setAttribute('aria-label', 'Agent provider'); tabs.append(el('span', 'sidebar-label', 'SHOW AGENTS'));
  for (const [value, label] of [['all', 'All agents'], ['codex', 'Codex'], ['claude', 'Claude Code']]) { const tab = button(label, 'tab', () => { state.provider = value; menu.open = false; renderData(); }); tab.dataset.provider = value; tabs.append(tab); }
  tabs.append(el('span', 'sidebar-label', 'GROUP'));
  for (const [value, label] of [['project', 'By project'], ['flat', 'Flat list']]) { const tab = button(label, 'tab', () => { state.grouping = value; try { localStorage.setItem(groupingKey, value); } catch { /* per-tab only */ } menu.open = false; renderData(); }); tab.dataset.grouping = value; tabs.append(tab); }
  const searchBox = el('label', 'search'); searchBox.append(icon('search')); const search = el('input'); search.type = 'search'; search.placeholder = 'Find a session…'; search.title = '/ search · j k move · n next waiting'; search.setAttribute('aria-label', 'Search sessions and projects'); search.oninput = () => { state.search = search.value; liveRender.interact(); liveRender.request(); }; searchBox.append(search); menu.append(tabs); toolbar.append(searchBox, menu); main.append(toolbar);
  const groups = el('div', 'groups'); groups.id = 'groups'; groups.append(el('div', 'empty', 'Connecting to your local agents…')); main.append(groups);
  const integrations = el('section', 'integrations'); integrations.id = 'integrations'; main.append(integrations);
  content.append(main); shell.append(content); app.append(shell);
  const backdrop = el('div', 'panel-backdrop'); backdrop.id = 'backdrop'; backdrop.hidden = true; backdrop.onclick = closePanel;
  const panel = el('section', 'detail-panel'); panel.id = 'panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Session details');
  app.append(backdrop, panel);
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
    snapshot.sessions = sessionActivity.observe(snapshot.sessions);
    signal(statusEvents(previousStatuses, snapshot.sessions));
    state.snapshot = snapshot; state.error = ''; liveRender.request();
  } catch (error) {
    if (state.csrf) { state.error = error.message; liveRender.request(); }
  } finally { loading = false; }
}

// The Office theme swaps the list for a 3D scene, downloaded only once it is chosen.
let office = null, officeModule = null, listTheme = savedTheme() === 'office' ? 'modern-light' : savedTheme();
function syncOffice() {
  const root = document.documentElement, main = document.querySelector('.main-content');
  if (root.dataset.themeChoice !== 'office' || !main) {
    if (root.dataset.themeChoice && root.dataset.themeChoice !== 'office') listTheme = root.dataset.themeChoice;
    office?.unmount(); office = null; document.querySelector('#office')?.remove(); root.removeAttribute('data-office-fallback'); return;
  }
  // Any failure (download, no WebGL2, renderer refused) shows the list once and stays that way for this theme choice.
  const fallBack = message => { root.setAttribute('data-office-fallback', ''); document.querySelector('#office')?.remove(); toast(message); };
  // An office bug must not take the session list down with it.
  if (office) { if (state.snapshot) try { office.update(state.snapshot, { error: state.error }); } catch (error) { console.error(error); office.unmount(); office = null; fallBack('Office stopped; showing the list'); } return; }
  if (root.hasAttribute('data-office-fallback')) return;
  if (!officeModule) { officeModule = import('./office/office.js').then(module => { officeModule = module; syncOffice(); }, () => { officeModule = null; fallBack('Office failed to load; showing the list'); }); return; }
  if (officeModule instanceof Promise) return;
  if (!officeModule.webglAvailable()) { fallBack('Office needs WebGL 2; showing the list'); return; }
  const box = el('div'); box.id = 'office'; main.append(box);
  try {
    office = officeModule.mountOffice(box, { openPanel, nextWaiting: () => nextWaiting(), showList: () => chooseTheme(listTheme), isUnread: unread, describe: sessionFacts, spawn: spawnAgent });
    if (state.snapshot) office.update(state.snapshot, { error: state.error });
  } catch (error) { console.error(error); office?.unmount(); office = null; fallBack('Office could not start; showing the list'); }
}

function renderData() {
  if (!state.snapshot || !document.querySelector('#groups')) {
    const error = document.querySelector('#error'); if (error && state.error) { error.hidden = false; error.textContent = state.error; } return;
  }
  syncOffice();
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
    if (state.selected !== 'access') renderPanel();
    return;
  }
  const connection = document.querySelector('#connection'); connection.className = `live-label ${state.error ? 'disconnected' : ''}`; connection.textContent = state.error ? 'Connection lost' : 'Live updates'; connection.title = connection.textContent;
  const error = document.querySelector('#error'); error.hidden = !state.error; error.textContent = state.error ? `${state.error} Showing the last received status. Actions are disabled until reconnected.` : '';
  document.querySelector('#machine').textContent = state.snapshot.machine;
  const usage = document.querySelector('#usage'), usageSignature = JSON.stringify([state.snapshot.usage, !!state.error, Math.floor(Date.now() / 60_000)]);
  if (usage.dataset.sig !== usageSignature) { usage.dataset.sig = usageSignature; renderUsage(usage, state.snapshot.usage, { disconnected: !!state.error }); }
  renderThemeConsole(document.querySelector('#theme-console'), sessions, { disconnected: !!state.error, onSelect: openPanel });
  const working = sessions.filter(s => s.status === 'working').length, idle = sessions.filter(s => s.status === 'idle').length;
  const setFilter = value => () => { state.filter = value; state.project = ''; renderData(); };
  // Desktop filters live here; the stat row below replaces them on phones.
  syncList(document.querySelector('#navigation'), [['all', 'All sessions', 'grid', sessions.length], ['attention', 'Needs you', 'bell', count], ['working', 'Working', 'activity', working], ['idle', 'Idle', 'moon', idle]]
    .map(([value, label, glyph, number]) => [value, [value, label, glyph, number, state.filter === value && !state.project]]),
    ([value, label, glyph, number, active]) => { const b = button(label, `nav-item ${active ? 'active' : ''}`, setFilter(value), glyph); b.append(el('span', 'nav-count', number)); return b; });
  const projects = new Map(); for (const session of sessions) { const key = session.cwd || session.project; if (!projects.has(key)) projects.set(key, { name: session.project, sessions: [] }); projects.get(key).sessions.push(session); }
  syncList(document.querySelector('#projects'), projects.size ? [...projects].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([key, project]) => [key, [key, project.name, state.project === key, project.sessions.filter(needsInput).length]]) : [['none', null]],
    data => {
      if (!data) return el('span', 'no-projects', 'Projects appear with sessions');
      const [key, name, active, waiting] = data;
      const b = button(name, `nav-item ${active ? 'active' : ''}`, () => { state.project = state.project === key ? '' : key; state.filter = 'all'; renderData(); }, 'folder'); b.title = key; b.append(el('span', 'project-dot', waiting || '')); return b;
    });
  syncList(document.querySelector('#stats'), [
    ['all', 'All', sessions.length, `${projects.size} projects on this computer`, ''],
    ['attention', 'Needs you', count, count ? 'A quick decision keeps things moving' : 'You’re all caught up', 'amber'],
    ['working', 'Working', working, 'Agents making progress', 'green'],
    ['idle', 'Idle', idle, 'Ready for the next task', 'gray'],
  ].map(([value, ...rest]) => [value, [value, ...rest, state.filter === value]]), ([value, title, number, detail, color, selected]) => {
    const b = button('', `stat ${color} ${selected ? 'selected' : ''}`, setFilter(value));
    const digits = el('strong', `stat-number${statValues.has(value) && statValues.get(value) !== number ? ' tick' : ''}`, number); statValues.set(value, number);
    b.replaceChildren(el('span', 'stat-title', title), digits, el('span', 'stat-detail', detail)); return b;
  });
  for (const tab of document.querySelectorAll('[data-provider]')) { tab.classList.toggle('active', tab.dataset.provider === state.provider); tab.setAttribute('aria-pressed', String(tab.dataset.provider === state.provider)); }
  for (const tab of document.querySelectorAll('[data-grouping]')) { tab.classList.toggle('active', tab.dataset.grouping === state.grouping); tab.setAttribute('aria-pressed', String(tab.dataset.grouping === state.grouping)); }
  const filterMenu = document.querySelector('#agent-filter-menu'); filterMenu.classList.toggle('filtered', state.provider !== 'all'); filterMenu.querySelector('summary').setAttribute('aria-label', `Agent filter: ${state.provider === 'all' ? 'All agents' : providerName(state.provider)}`);
  const focusedSession = document.activeElement?.classList.contains('session-card') ? document.activeElement.dataset.sessionId : null;
  const groups = document.querySelector('#groups');
  const visible = sessions.filter(s => (!state.project || (s.cwd || s.project) === state.project) && (state.provider === 'all' || s.provider === state.provider) && (state.filter === 'all' || (state.filter === 'attention' ? needsInput(s) : s.status === state.filter)) && `${s.title} ${s.project} ${s.cwd} ${s.model}`.toLowerCase().includes(state.search.toLowerCase()));
  const visibleGroups = new Map(); for (const session of visible) { const key = session.cwd || session.project; if (!visibleGroups.has(key)) visibleGroups.set(key, []); visibleGroups.get(key).push(session); }
  // Flat: one list in status order, with a project label on each card.
  const flat = state.grouping === 'flat';
  const sorted = flat ? (visible.length ? [['', visible]] : []) : [...visibleGroups].sort(compareProjects);
  const before = flipPositions(groups);
  syncList(groups, visible.length ? sorted.map(([cwd]) => [cwd, null]) : [['empty', [state.filter === 'attention', sessions.length]]], data => {
    if (!data) { const group = el('section', 'project-group'); group.append(el('div', 'group-heading'), el('div', 'session-list')); return group; }
    const [attention, total] = data, empty = el('div', 'empty');
    empty.append(icon(attention ? 'check' : 'terminal'), el('h2', '', attention ? 'Nothing needs your attention.' : total ? 'No sessions match.' : 'Your control room is ready.'), el('p', 'muted', total ? 'Sessions update automatically as your agents work.' : 'Open Codex or Claude Code on this computer. Live sessions will appear here, grouped by project.'));
    return empty;
  });
  const sessionsById = new Map();
  for (const [cwd, list] of sorted) {
    const group = [...groups.children].find(node => node.dataset.key === cwd), header = group.firstChild;
    const headerSignature = JSON.stringify([list[0].project, list.length, cwd, hireChoices(state.snapshot, cwd).map(choice => choice.label)]);
    header.hidden = flat;
    if (!flat && header.dataset.sig !== headerSignature) {
      header.dataset.sig = headerSignature;
      const title = el('div', 'group-title'); title.append(icon('folder'), el('h2', '', list[0].project), el('span', 'group-count', list.length));
      header.replaceChildren(title, el('span', 'project-path', cwd.replace(/^\/home\/[^/]+/, '~')), spawnButtons(cwd));
    }
    // Subagents sit directly under their parent; orphans keep their own place.
    const ordered = list.sort(compareSessions), ids = new Set(ordered.map(s => s.id));
    const withChildren = s => [s, ...ordered.filter(child => child.parentId === s.id).flatMap(withChildren)];
    syncList(group.lastChild, ordered.filter(s => !ids.has(s.parentId)).flatMap(withChildren).map(session => {
      sessionsById.set(session.id, session);
      const lastMessage = session.messages?.at(-1);
      return [session.id, { id: session.id, provider: session.provider, status: session.status, title: session.title, branch: session.branch, parentId: session.parentId, agentKind: session.agentKind, kind: session.parentId ? session.model : '', project: flat && !session.parentId ? session.project : '', needs: needsInput(session), detail: cardDetail(session), last: lastMessage && [lastMessage.role, plainText(lastMessage.text).slice(0, 400)],
        plan: planProgress(session), mode: modeLabels[session.permissionMode] ? session.permissionMode : '', context: contextPercent(session.context), compacting: compacting(session), unread: unread(session) }];
    }), renderCard);
  }
  for (const card of groups.querySelectorAll('.session-card')) setProperty(card.querySelector('.session-age'), 'textContent', stateAge(sessionsById.get(card.dataset.key)));
  flipFrom(groups, before);
  if (focusedSession && document.activeElement?.dataset.sessionId !== focusedSession) [...groups.querySelectorAll('[data-session-id]')].find(card => card.dataset.sessionId === focusedSession)?.focus({ preventScroll: true });
  const integrations = document.querySelector('#integrations'), integrationSignature = JSON.stringify(providers);
  if (integrations.dataset.sig !== integrationSignature) {
    integrations.dataset.sig = integrationSignature; integrations.replaceChildren(el('h2', '', 'Agent connections'));
    for (const provider of providers) {
      const row = el('div', 'integration'); const status = el('span', `connection-dot ${provider.connected ? 'online' : ''}`); row.title = provider.detail; row.append(status, el('strong', '', provider.name), el('span', 'muted', provider.detail)); integrations.append(row);
    }
  }
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
  return session.requests[0]?.title || session.asks || session.detail || (session.status === 'idle' ? 'Waiting for the next task' : session.status === 'working' ? 'Working on the current task' : 'Open for details');
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
  const card = el('button', `session-card ${session.needs ? 'needs-input' : ''} ${session.parentId ? 'subagent' : ''}`); card.type = 'button'; card.onclick = () => openPanel(session.id);
  // Long card loops run on a page-wide clock, so a rebuilt card continues them instead of restarting.
  card.style.setProperty('--since-load', `${-Math.round(performance.now())}ms`); card.dataset.sessionId = session.id; card.dataset.status = session.status; card.setAttribute('aria-label', `${session.title}, ${providerName(session.provider)}, ${(statuses[session.status] || statuses.unknown)[0]}`);
  const mark = el('span', `agent-mark ${session.provider}`, session.provider === 'codex' ? '⌘' : '✳'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', providerName(session.provider)); mark.title = providerName(session.provider);
  if (session.unread) card.classList.add('unread');
  if (session.plan) { card.dataset.plan = ''; card.style.setProperty('--plan', session.plan[0] / session.plan[1]); }
  const body = el('span', 'session-body');
  const chips = [session.branch && el('span', 'branch', session.branch), session.plan && chip(`${session.plan[0]}/${session.plan[1]}`, 'plan-chip', 'Plan steps done'),
    session.mode && chip(modeLabels[session.mode], `mode-chip ${session.mode}`, 'Permission mode'), session.compacting ? chip('compacting', 'compact-chip', 'Compacting context') : session.context >= 80 && chip(`ctx ${session.context}%`, 'ctx-chip', 'Context window used')].filter(Boolean);
  if (chips.length) { const meta = el('span', 'session-meta'); meta.append(...chips); body.append(meta); }
  const title = el('strong', 'session-title'); if (session.project) title.append(el('span', 'project-tag', session.project)); if (session.parentId) { const workflow = session.agentKind === 'workflow', tag = el('span', `subagent-tag${workflow ? ' workflow-tag' : ''}`, workflow ? 'Workflow' : 'Subagent'); tag.title = session.kind || ''; title.append(tag); } title.append(session.title); body.append(title);
  const text = document.createTextNode(session.last ? session.last[1] : session.detail);
  const preview = session.last ? el('span', 'message-preview') : el('span', 'session-description');
  if (session.last?.[0] === 'user') preview.append(el('strong', '', 'You: '));
  preview.append(text); body.append(preview);
  const before = previous?.querySelector('.message-preview, .session-description')?.textContent;
  if (before !== undefined && before !== preview.textContent) typewrite(text);
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
  if (reducedMotion.matches || !full) return;
  const step = Math.max(1, Math.ceil(full.length / 45));
  let shown = 0; node.textContent = ''; parent.classList.add('typing');
  const tick = () => {
    if (!node.isConnected) return;
    shown = Math.min(full.length, shown + step); node.textContent = full.slice(0, shown);
    if (shown < full.length) requestAnimationFrame(tick); else parent.classList.remove('typing');
  };
  requestAnimationFrame(tick);
}

// FLIP: moved cards and headers slide from their old spot; new ones fade in.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const flipKey = node => node.classList.contains('group-heading') ? `#${node.parentElement.dataset.key}` : node.dataset.key;
function flipPositions(root) { return new Map([...root.querySelectorAll('.session-card, .group-heading')].map(node => [flipKey(node), node.getBoundingClientRect().top])); }
function flipFrom(root, before) {
  if (reducedMotion.matches || !before.size) return;
  for (const node of root.querySelectorAll('.session-card, .group-heading')) {
    const from = before.get(flipKey(node));
    if (from === undefined) { node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); continue; }
    const dy = from - node.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
}

let previousFocus;
function openPanel(id) { previousFocus = document.activeElement; navigation.open(id); document.querySelector('#panel button')?.focus(); }
function closePanel() { navigation.close(); }
function hidePanel() { office?.panelClosed(); const closedId = state.selected; markSeen(closedId); older.delete(closedId); state.selected = null; panelSignature = ''; const panel = document.querySelector('#panel'); if (!panel) return; disposeHistory(); disposeComposer(); liveRender.cancel(); panel.dataset.sessionId = ''; panel.hidden = true; document.querySelector('#backdrop').hidden = true; document.querySelector('.shell')?.removeAttribute('inert'); document.body.classList.remove('panel-open'); renderData(); const focus = previousFocus?.isConnected ? previousFocus : [...document.querySelectorAll('.session-card[data-session-id]')].find(b => b.dataset.sessionId === closedId); focus?.focus({ preventScroll: true }); }
function revealPanel() { const panel = document.querySelector('#panel'); panel.hidden = false; document.querySelector('#backdrop').hidden = false; document.querySelector('.shell').setAttribute('inert', ''); document.body.classList.add('panel-open'); return panel; }
function renderPanel() {
  const session = state.snapshot.sessions.find(s => s.id === state.selected);
  const panel = document.querySelector('#panel');
  if (!session) { navigation.reset(); hidePanel(); return; }
  if (panel.dataset.sessionId !== session.id) {
    disposeHistory(); disposeComposer(); panelSignature = '';
    if (panel.dataset.sessionId) { markSeen(panel.dataset.sessionId); older.delete(panel.dataset.sessionId); }
    markSeen(session.id);
    panel.replaceChildren(); panel.dataset.sessionId = session.id; panel.classList.add('chat-panel'); revealPanel();
    const header = el('header', 'chat-header');
    const recent = el('section', 'recent-messages'); recent.id = 'recent-messages';
    const requests = el('div', 'chat-requests'); requests.setAttribute('aria-label', 'Pending questions and permissions');
    const composer = el('section', 'message-composer'); composer.id = 'message-composer';
    panel.append(header, recent, requests, composer);
  }
  if (pendingEffort.get(session.id) === session.effort) pendingEffort.delete(session.id);
  const signature = JSON.stringify([session.id, session.status, session.title, session.project, session.cwd, session.model, session.control, !!state.error, session.effort, session.effortPending, pendingEffort.get(session.id), session.efforts, session.messaging,
    session.permissionMode, session.context, compacting(session), session.branch, session.lastTurnMs, session.cost, session.goal, session.plan, nextWaiting(session.id)?.id, hireChoices(state.snapshot, session.cwd).map(choice => choice.label)]);
  if (signature !== panelSignature) {
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
}

// Triage: the next session waiting for you, in overview order.
function nextWaiting(currentId) { return (state.snapshot?.sessions || []).filter(s => needsInput(s) && s.id !== currentId).sort(compareSessions)[0]; }
function openNext() { const next = nextWaiting(state.selected); if (!next) return; if (state.selected) navigation.open(next.id, { replace: true }); else openPanel(next.id); }
function renderSessionHeader(header, session) {
  const expanded = !!header.querySelector('.chat-info')?.open, planOpen = !!header.querySelector('.plan-info')?.open;
  header.replaceChildren();
  const head = el('div', 'panel-heading'), actions = el('div', 'panel-heading-actions');
  const next = nextWaiting(session.id);
  if (next) { const b = button('Next', 'quiet-button next-button', openNext, 'next'); b.title = `Next waiting (n): ${next.title}`; actions.append(b); }
  if (session.status === 'working' && session.messaging?.interrupt) { const stop = button('Stop', 'quiet-button stop-button', () => interrupt(session, stop), 'stop'); stop.title = 'Interrupt the current turn'; stop.disabled = !!state.error; actions.append(stop); }
  if ((session.status === 'idle' || session.asks) && !session.parentId && session.messaging?.fire) { const fire = button('Fire', 'quiet-button stop-button fire-button', () => fireSession(session, fire), 'exit'); fire.title = `End this session with ${session.messaging.via === 'tmux' ? '/exit' : 'SIGTERM'} (refused while anything is still running)`; fire.disabled = !!state.error; actions.append(fire); }
  if (session.messaging?.effort && session.efforts?.length) actions.append(effortPicker(session));
  actions.append(themeMenu(), badge(session.status)); const back = button('Back', 'quiet-button back-button', closePanel, 'back'); back.title = 'Back to sessions'; head.append(back, actions); header.append(head);
  const title = el('h2', 'panel-title', session.title); title.title = session.title; header.append(title);
  const metadata = el('details', 'chat-info'); metadata.open = expanded;
  const effort = pendingEffort.get(session.id) || session.effort, percent = contextPercent(session.context);
  const summary = el('summary', '', [providerName(session.provider), session.account, session.project, session.model?.replace(/^claude-/, ''), effort].filter(Boolean).join(' · '));
  if (modeLabels[session.permissionMode]) summary.append(chip(modeLabels[session.permissionMode], `mode-chip ${session.permissionMode}`, 'Permission mode'));
  if (compacting(session)) summary.append(chip('compacting', 'compact-chip', 'Compacting context'));
  if (session.context?.used) summary.append(chip(percent != null ? `${percent}%` : tokens(session.context.used), `ctx-chip${percent >= 80 ? ' high' : ''}`, 'Context used'));
  metadata.append(summary);
  const goal = session.goal, cost = session.cost;
  const rows = [['Folder', session.cwd], ['Account', session.account], ['Model', session.model || 'Not reported'], ['Effort', effort && `${effort}${session.effortPending ? ' · from your next message' : ''}`], ['Mode', session.permissionMode],
    ['Context', session.context?.used && `${tokens(session.context.used)}${session.context.window ? ` of ${tokens(session.context.window)} (${percent}%)` : ''}`], ['Branch', session.branch],
    ['Last turn', session.lastTurnMs && duration(session.lastTurnMs)], ['Cost', cost && `$${cost.usd.toFixed(2)} · +${cost.added} −${cost.removed} lines`],
    ['Goal', goal && `${goal.objective} · ${goal.status}${goal.tokenBudget ? ` · ${tokens(goal.tokensUsed)} of ${tokens(goal.tokenBudget)} tokens` : ''}`],
    ['Version', session.version && `Claude Code ${session.version}`], ['Session', session.nativeId || session.id], ['Connection', session.control ? 'Connected' : 'Status only']];
  const info = el('dl', 'session-info'); for (const [key, value] of rows) if (value) info.append(el('dt', '', key), el('dd', '', value)); metadata.append(info); if (session.cwd) metadata.append(spawnButtons(session.cwd)); header.append(metadata);
  if (session.plan?.length) {
    const plan = el('details', 'plan-info'); plan.open = planOpen;
    const done = session.plan.filter(step => step.status === 'done').length, current = session.plan.find(step => step.status === 'active') || session.plan.find(step => step.status === 'pending');
    const meter = el('progress', 'plan-meter'); meter.max = session.plan.length; meter.value = done;
    const line = el('summary'); line.append(el('strong', '', `${done}/${session.plan.length}`), meter, el('span', '', current?.step || 'All steps done'));
    const list = el('ol', 'plan-steps'); for (const step of session.plan) list.append(el('li', step.status, step.step));
    plan.append(line, list); header.append(plan);
  }
  if (state.error) header.append(el('p', 'connection-error', 'Reconnecting. Actions are temporarily disabled.'));
}
function effortPicker(session) {
  const select = el('select', 'quiet-button effort-select'); select.setAttribute('aria-label', 'Reasoning effort');
  select.title = session.provider === 'codex' ? 'Effort · Codex applies it from your next message sent here' : 'Effort';
  const current = pendingEffort.get(session.id) || session.effort;
  if (!session.efforts.includes(current)) { const blank = el('option', '', 'effort'); blank.value = ''; blank.disabled = true; select.append(blank); }
  for (const level of session.efforts) { const option = el('option', '', level); option.value = level; select.append(option); }
  select.value = session.efforts.includes(current) ? current : ''; select.disabled = !!state.error;
  select.onchange = async () => {
    const effort = select.value; select.disabled = true;
    try {
      const result = await api(`sessions/${encodeURIComponent(session.id)}/effort`, { effort });
      if (session.provider === 'claude') pendingEffort.set(session.id, effort);
      toast(result.pending ? `Effort ${effort} from your next message` : `Effort ${effort}`); panelSignature = ''; await refresh();
    } catch (error) { toast(error.message); select.value = session.efforts.includes(current) ? current : ''; select.disabled = false; }
  };
  return select;
}
// The first click arms it for a few seconds; the second ends the session. The server refuses if anything is still running.
async function fireSession(session, control) {
  if (state.error) return;
  const label = control.querySelector('span:not(.icon)');
  if (!control.classList.contains('armed')) {
    control.classList.add('armed'); label.textContent = 'Sure?'; control.setAttribute('aria-label', 'Click again to fire');
    setTimeout(() => { control.classList.remove('armed'); label.textContent = 'Fire'; control.removeAttribute('aria-label'); }, 3000);
    return;
  }
  control.disabled = true;
  try { await api(`sessions/${encodeURIComponent(session.id)}/fire`, {}); toast('Fired'); office?.fire(session.id); closePanel(); await refresh(); }
  catch (error) { toast(error.message); control.disabled = false; }
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
      for (const action of request.actions) { const b = button(action.label, action.value === 'accept' ? 'primary' : 'secondary', () => decide(action.value)); b.title = action.label; b.disabled = !!state.error || request.sending; actions.append(b); }
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
}

function renderComposer(session) {
  const region = document.querySelector('#message-composer'); if (!region) return;
  region.currentSession = session;
  let draft = messageDrafts.get(session.id);
  if (!draft) { draft = { text: '', busy: false, error: '' }; messageDrafts.set(session.id, draft); }
  if (!region.querySelector('form')) {
    const queue = el('div', 'message-queue');
    const form = el('form', 'message-form');
    const input = el('textarea'); input.rows = 2; input.maxLength = 12_000; input.setAttribute('aria-label', `Message ${providerName(session.provider)}`); input.placeholder = `Message ${providerName(session.provider)}…`;
    const row = el('div', 'composer-row');
    const submit = el('button', 'primary', 'Send'); submit.type = 'submit'; row.append(input, submit);
    const feedback = el('p', 'composer-feedback'); feedback.setAttribute('role', 'status');
    const draftInput = region.draftInput = new ComposerInput(input, draft, () => update());
    input.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = async event => {
      event.preventDefault();
      if (draftInput.composing) return;
      draftInput.flush();
      const current = state.snapshot?.sessions.find(item => item.id === session.id);
      if (!current || draft.busy || !draft.text.trim() || state.error) return;
      const mode = 'send';
      if (!current.messaging?.send || messagingUnavailableReason(current, state.snapshot)) return;
      if (!draft.submission || draft.submission.text !== draft.text || draft.submission.mode !== mode) draft.submission = { text: draft.text, mode, clientMessageId: uuid() };
      draft.busy = true; draft.error = ''; update();
      try {
        const result = await api(`sessions/${encodeURIComponent(session.id)}/messages`, draft.submission);
        draft.text = ''; draft.revision = (draft.revision || 0) + 1; draft.submission = null;
        toast(result.status === 'submitted' ? 'Sent via inbox (not tmux)' : result.status === 'steered' ? 'Sent into the current work' : 'Sent');
        if (state.selected === session.id) document.querySelector('#recent-messages')?.historyScroll?.jumpToLatest();
        await refresh();
      } catch (error) { draft.error = error.message; }
      finally { draft.busy = false; update(); if (state.selected === session.id) document.querySelector('#message-composer')?.updateComposer?.(); }
    };
    form.append(row, feedback); region.append(queue, form);
    function update() {
      const current = region.currentSession;
      const unavailable = messagingUnavailableReason(current, state.snapshot);
      const available = current.messaging?.send && !unavailable;
      draftInput.syncReset();
      region.messagingSeen ||= !!current.messaging?.send;
      const visible = region.messagingSeen || draftInput.hasText;
      setProperty(row, 'hidden', !visible);
      // Connection changes affect Send, not the user's ability to keep drafting.
      setProperty(input, 'readOnly', draft.busy);
      setProperty(submit, 'disabled', draft.busy || !draftInput.hasText || !available || !!state.error);
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
          draft.text = message.text; draft.revision = (draft.revision || 0) + 1; draft.submission = null;
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
  const extra = older.get(session.id), messages = mergeHistory(extra?.messages, session.messages || []);
  const moreAvailable = extra ? extra.more : (session.messages || []).filter(m => !m.tool).length >= 20;
  const signature = JSON.stringify([messages, session.messagesState, moreAvailable, !!extra?.loading]);
  if (region.dataset.signature === signature) { if (savedPosition) flow.restore(savedPosition); return; }
  const saved = savedPosition || flow.capture();
  const content = region.querySelector('.history-content');
  const existing = new Map([...content.querySelectorAll('[data-message-id]')].map(node => [node.dataset.messageId, node]));
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
  for (const entry of entries.flatMap(item => Array.isArray(item) && (item.length < 3 || session.parentId) ? item : [item])) {
    const id = Array.isArray(entry) ? `run:${entry[0].id}` : entry.id, previous = existing.get(id), entrySignature = JSON.stringify(entry);
    if (previous?.dataset.signature === entrySignature) { children.push(previous); continue; }
    const node = Array.isArray(entry) ? toolRun(entry, !!previous?.open) : messageNode(entry, session, previous);
    node.dataset.messageId = id; node.dataset.signature = entrySignature; children.push(node);
  }
  // Keep unchanged messages mounted so expanded text and keyboard focus survive polling.
  for (const node of [...content.children]) if (!children.includes(node)) node.remove();
  children.forEach((node, index) => { if (content.children[index] !== node) content.insertBefore(node, content.children[index] || null); });
  flow.restore(saved);
}
// Older pages end where the live window starts, so polling keeps the newest part current.
function mergeHistory(earlier = [], recent) {
  if (!earlier.length) return recent;
  const cut = earlier.findIndex(message => message.id === recent[0]?.id), ids = new Set(recent.map(message => message.id));
  return [...(cut >= 0 ? earlier.slice(0, cut) : earlier.filter(message => !ids.has(message.id))), ...recent];
}
async function loadOlder(id) {
  const current = older.get(id), limit = Math.min(200, (current?.limit || 20) + 40);
  older.set(id, { messages: [], more: true, ...current, loading: true }); renderPanel();
  try { const result = await api(`sessions/${encodeURIComponent(id)}/history?limit=${limit}`); older.set(id, { limit, messages: result.messages, more: result.more && limit < 200 }); }
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
  summary.append(el('code', 'tool-call', run.at(-1).text)); details.append(summary, ...run.map(toolLine));
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
    const rest = el('div', 'message-text'); rest.innerHTML = rendered.more;
    more.append(el('summary', '', 'Read more'), rest); article.append(more);
  }
  if (message.truncated) article.append(el('span', 'muted', 'Long message shortened.'));
  return article;
}

function renderAccessPanel() {
  disposeHistory();
  disposeComposer();
  const panel = revealPanel(); panel.replaceChildren();
  panel.classList.remove('chat-panel');
  panel.dataset.sessionId = '';
  const head = el('div', 'panel-heading'); head.append(button('Back to sessions', 'quiet-button', closePanel, 'back'), el('span', 'eyebrow', 'WORKSPACE ACCESS')); panel.append(head);
  panel.append(el('h2', 'panel-title', 'Choose a PIN or password'), el('p', 'muted access-copy', 'Use a 4–8 digit PIN or a password with at least 12 characters.'));
  const form = el('form', 'access-form');
  const fields = {};
  for (const [name, title, autocomplete] of [['current', 'Current PIN or password', 'current-password'], ['next', 'New PIN or password', 'new-password'], ['repeat', 'Repeat new PIN or password', 'new-password']]) {
    const label = el('label', '', title), input = el('input'); input.name = name; input.type = 'password'; input.required = true; input.maxLength = 1024; input.autocomplete = autocomplete;
    if (name !== 'current') input.inputMode = 'numeric'; label.append(input); form.append(label); fields[name] = input;
  }
  const keyboard = el('label', 'keyboard-choice'); const pinMode = el('input'); pinMode.type = 'checkbox'; pinMode.checked = true; pinMode.onchange = () => { fields.next.inputMode = fields.repeat.inputMode = pinMode.checked ? 'numeric' : 'text'; }; keyboard.append(pinMode, document.createTextNode('Use the PIN number keyboard')); form.append(keyboard);
  const error = el('p', 'form-error'); error.setAttribute('role', 'alert');
  const save = el('button', 'primary', 'Save and lock'); save.type = 'submit'; form.append(error, save);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = '';
    if (fields.next.value !== fields.repeat.value) { error.textContent = 'The new entries do not match.'; return; }
    save.disabled = true;
    try { await api('password', { current: fields.current.value, next: fields.next.value }); navigation.reset(); showLogin(); }
    catch (e) { error.textContent = e.message; save.disabled = false; }
  };
  panel.append(form); fields.current.focus();
  api('auth').then(data => { if (fields.current.isConnected) fields.current.inputMode = data.kind === 'pin' ? 'numeric' : 'text'; }).catch(() => {});
}

async function respond(request, payload, container, error) {
  if (state.error) return;
  const controls = [...container.querySelectorAll('button, input')]; controls.forEach(b => b.disabled = true); error.textContent = '';
  try {
    await api(`requests/${request.id}/respond`, payload);
    toast('Response delivered'); panelSignature = ''; await refresh();
  } catch (e) { error.textContent = e.message; controls.forEach(b => b.disabled = false); }
}

function toast(text) { const node = el('div', 'toast', text); node.setAttribute('role', 'status'); app.append(node); setTimeout(() => node.remove(), 3500); }
function spawnButtons(cwd) {
  const actions = el('span', 'group-actions');
  for (const choice of hireChoices(state.snapshot, cwd)) { const b = button(choice.label, 'quiet-button spawn-button', () => spawnAgent(cwd, choice, b), 'plus'); b.title = `New ${choice.name} in tmux${choice.last ? ' · last used here' : ''}`; actions.append(b); }
  return actions;
}
async function spawnAgent(cwd, choice, control) {
  if (state.error) return;
  control.disabled = true;
  try { const result = await api('spawn', { cwd, provider: choice.provider, account: choice.account }); toast(`${choice.name} started in tmux ${result.session}${result.window ? `:${result.window}` : ''}`); }
  catch (e) { toast(e.message); }
  finally { control.disabled = false; }
}

async function lock() {
  const logout = api('logout', {}, { keepalive: true });
  navigation.reset();
  showLogin(); document.title = 'AI Control';
  try { await logout; } catch { /* local display still locks if offline */ }
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' && event.key !== 'Tab') return;
  const openTheme = document.querySelector('.theme-menu[open]');
  if (event.key === 'Escape' && openTheme) { openTheme.open = false; openTheme.querySelector('summary').focus(); return; }
  const menu = document.querySelector('#agent-filter-menu');
  if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary').focus(); return; }
  if (event.key === 'Escape' && state.selected) closePanel();
  if (event.key === 'Tab' && state.selected) {
    const controls = [...document.querySelector('#panel').querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
// Single-key shortcuts outside text fields: / search, j k move between cards, n next waiting session.
document.addEventListener('keydown', event => {
  if (!state.csrf || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open], details[open].theme-menu, #agent-filter-menu[open]')) return;
  if (event.key === 'n' && nextWaiting(state.selected)) { event.preventDefault(); if (office && !state.selected) office.talkTo(nextWaiting().id); else openNext(); return; }
  if (state.selected) return;
  if (event.key === '/') { event.preventDefault(); document.querySelector('.search input')?.focus(); return; }
  if (event.key !== 'j' && event.key !== 'k') return;
  const cards = [...document.querySelectorAll('#groups .session-card')], index = cards.indexOf(document.activeElement);
  cards[index < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, index + (event.key === 'j' ? 1 : -1)))]?.focus();
  event.preventDefault();
});
listenForOpen(id => { if (state.csrf) openPanel(id); });
document.addEventListener('pointerdown', event => { for (const menu of document.querySelectorAll('#agent-filter-menu, .theme-menu')) if (menu.open && !menu.contains(event.target)) menu.open = false; });
function sendActivity() {
  clearTimeout(activityTimer); activityTimer = null;
  if (!state.csrf) return;
  touching = Date.now(); api('activity', {}, { keepalive: true }).catch(() => {});
}
for (const name of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchmove']) document.addEventListener(name, event => {
  if (!event.isTrusted || !state.csrf) return;
  if (Date.now() - state.lastActivity >= idleMs) { lock(); return; }
  state.lastActivity = Date.now();
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

// First visit: pick a theme. Closing keeps the default.
function showThemePicker() {
  const dialog = el('dialog', 'theme-picker'); dialog.setAttribute('aria-label', 'Pick a theme');
  const grid = el('div', 'theme-picker-grid');
  for (const theme of themes) {
    const choice = button(theme.name, 'theme-picker-choice', () => { applyTheme(theme.id); dialog.close(); bootSequence(); });
    choice.prepend(el('span', `theme-preview ${theme.id}`)); grid.append(choice);
  }
  dialog.append(el('h2', '', 'Pick a theme'), grid);
  dialog.onclose = () => { applyTheme(document.documentElement.dataset.themeChoice); dialog.remove(); syncOffice(); };
  document.body.append(dialog); dialog.showModal();
}
if (firstVisit) showThemePicker();
