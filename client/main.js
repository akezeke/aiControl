import './style.css';
import './themes.css';
import './theme-effects.css';
import { applyTheme, savedTheme, hasSavedTheme, themes, bootSequence } from './themes.js';
import { PanelNavigation } from './navigation.js';
import { HistoryScroll } from './history-scroll.js';
import { fieldLabel, requestPresentation } from './request-presentation.js';
import { SessionActivity, compareSessions, compareProjects } from './session-order.js';
import { messagingUnavailableReason } from './messaging-status.js';
import { ComposerInput } from './composer-input.js';
import { LiveRender } from './live-render.js';
import { renderMessageMarkdown } from './message-markdown.js';
import { renderUsage } from './usage.js';
import { renderThemeConsole } from './theme-console.js';

const app = document.querySelector('#app');
const firstVisit = !hasSavedTheme();
applyTheme(savedTheme());
const idleMs = 10 * 60_000;
const sessionActivity = new SessionActivity();
const messageDrafts = new Map();
const statValues = new Map();
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
function themeMenu() {
  const menu = el('details', 'theme-menu');
  const summary = el('summary', 'quiet-button'); summary.append(icon('theme')); summary.setAttribute('aria-label', 'Change theme'); summary.title = 'Change theme';
  const choices = el('div', 'theme-options'); choices.setAttribute('aria-label', 'Color theme');
  for (const theme of themes) {
    const choice = button(theme.name, 'theme-choice', () => {
      applyTheme(theme.id);
      for (const option of document.querySelectorAll('[data-theme-choice]')) option.setAttribute('aria-pressed', String(option.dataset.themeChoice === theme.id));
      menu.open = false; summary.focus();
    });
    choice.dataset.themeChoice = theme.id; choice.setAttribute('aria-pressed', String(document.documentElement.dataset.themeChoice === theme.id));
    choice.prepend(el('i', `theme-swatch ${theme.id}`)); choices.append(choice);
  }
  // The sidebar scrolls and would clip the list, so open it against the viewport there.
  menu.ontoggle = () => {
    choices.removeAttribute('style');
    if (!menu.open || !menu.closest('.sidebar')) return;
    const r = summary.getBoundingClientRect();
    Object.assign(choices.style, { position: 'fixed', top: 'auto', right: 'auto', left: `${Math.max(8, Math.min(r.left, innerWidth - choices.offsetWidth - 8))}px`, bottom: `${innerHeight - r.top + 6}px` });
  };
  menu.append(summary, choices); return menu;
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
  clearInterval(poll); state.csrf = ''; state.snapshot = null; state.selected = null; panelSignature = ''; document.body.classList.remove('panel-open');
  app.replaceChildren(); document.documentElement.removeAttribute('data-attention');
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
  const topActions = el('div', 'top-actions'); const live = el('span', 'live-label', 'Connecting…'); live.id = 'connection'; const access = button('PIN', 'quiet-button access-button', () => { previousFocus = document.activeElement; navigation.open('access'); }, 'key'); access.title = 'Change PIN / password'; const lockButton = button('Lock', 'quiet-button', () => lock(), 'lock'); lockButton.title = 'Lock now'; topActions.append(live, themeMenu(), access, lockButton); topbar.append(brand()); content.append(topbar);
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
  const searchBox = el('label', 'search'); searchBox.append(icon('search')); const search = el('input'); search.type = 'search'; search.placeholder = 'Find a session…'; search.setAttribute('aria-label', 'Search sessions and projects'); search.oninput = () => { state.search = search.value; liveRender.interact(); liveRender.request(); }; searchBox.append(search); menu.append(tabs); toolbar.append(searchBox, menu); main.append(toolbar);
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
    state.snapshot = snapshot; state.error = ''; liveRender.request();
  } catch (error) {
    if (state.csrf) { state.error = error.message; liveRender.request(); }
  } finally { loading = false; }
}

function renderData() {
  if (!state.snapshot || !document.querySelector('#groups')) {
    const error = document.querySelector('#error'); if (error && state.error) { error.hidden = false; error.textContent = state.error; } return;
  }
  const { sessions, providers } = state.snapshot;
  const count = sessions.filter(needsInput).length;
  setProperty(document, 'title', `${count ? `(${count}) ` : ''}AI Control`);
  document.documentElement.toggleAttribute('data-attention', count > 0);
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
  const ages = new Map();
  for (const [cwd, list] of sorted) {
    const group = [...groups.children].find(node => node.dataset.key === cwd), header = group.firstChild;
    const headerSignature = JSON.stringify([list[0].project, list.length, cwd]);
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
      ages.set(session.id, session.lastActivityAt);
      const lastMessage = session.messages?.at(-1);
      let detail = session.requests[0]?.title || session.detail || (session.status === 'idle' ? 'Waiting for the next task' : session.status === 'working' ? 'Working on the current task' : 'Open for details');
      if (session.provider === 'claude' && !session.control && needsInput(session)) detail = 'Open the original client · Hooks not connected';
      return [session.id, { id: session.id, provider: session.provider, status: session.status, title: session.title, branch: session.branch, parentId: session.parentId, agentKind: session.agentKind, kind: session.parentId ? session.model : '', project: flat && !session.parentId ? session.project : '', needs: needsInput(session), detail, last: lastMessage && [lastMessage.role, plainText(lastMessage.text).slice(0, 400)] }];
    }), renderCard);
  }
  for (const card of groups.querySelectorAll('.session-card')) setProperty(card.querySelector('.session-age'), 'textContent', age(ages.get(card.dataset.key)));
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
function renderCard(session, previous) {
  const card = el('button', `session-card ${session.needs ? 'needs-input' : ''} ${session.parentId ? 'subagent' : ''}`); card.type = 'button'; card.onclick = () => openPanel(session.id); card.dataset.sessionId = session.id; card.dataset.status = session.status; card.setAttribute('aria-label', `${session.title}, ${providerName(session.provider)}, ${(statuses[session.status] || statuses.unknown)[0]}`);
  const mark = el('span', `agent-mark ${session.provider}`, session.provider === 'codex' ? '⌘' : '✳'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', providerName(session.provider)); mark.title = providerName(session.provider);
  const body = el('span', 'session-body'); if (session.branch) { const meta = el('span', 'session-meta'); meta.append(el('span', 'branch', session.branch)); body.append(meta); }
  const title = el('strong', 'session-title'); if (session.project) title.append(el('span', 'project-tag', session.project)); if (session.parentId) { const workflow = session.agentKind === 'workflow', tag = el('span', `subagent-tag${workflow ? ' workflow-tag' : ''}`, workflow ? 'Workflow' : 'Subagent'); tag.title = session.kind || ''; title.append(tag); } title.append(session.title); body.append(title);
  const text = document.createTextNode(session.last ? session.last[1] : session.detail);
  const preview = session.last ? el('span', 'message-preview') : el('span', 'session-description');
  if (session.last?.[0] === 'user') preview.append(el('strong', '', 'You: '));
  preview.append(text); body.append(preview);
  const before = previous?.querySelector('.message-preview, .session-description')?.textContent;
  if (before !== undefined && before !== preview.textContent) typewrite(text);
  const right = el('span', 'session-right'); right.append(badge(session.status), el('span', 'session-age'));
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
function hidePanel() { const closedId = state.selected; state.selected = null; panelSignature = ''; const panel = document.querySelector('#panel'); if (!panel) return; disposeHistory(); disposeComposer(); liveRender.cancel(); panel.dataset.sessionId = ''; panel.hidden = true; document.querySelector('#backdrop').hidden = true; document.querySelector('.shell')?.removeAttribute('inert'); document.body.classList.remove('panel-open'); renderData(); const focus = previousFocus?.isConnected ? previousFocus : [...document.querySelectorAll('.session-card[data-session-id]')].find(b => b.dataset.sessionId === closedId); focus?.focus({ preventScroll: true }); }
function revealPanel() { const panel = document.querySelector('#panel'); panel.hidden = false; document.querySelector('#backdrop').hidden = false; document.querySelector('.shell').setAttribute('inert', ''); document.body.classList.add('panel-open'); return panel; }
function renderPanel() {
  const session = state.snapshot.sessions.find(s => s.id === state.selected);
  const panel = document.querySelector('#panel');
  if (!session) { navigation.reset(); hidePanel(); return; }
  if (panel.dataset.sessionId !== session.id) {
    disposeHistory(); disposeComposer(); panelSignature = '';
    panel.replaceChildren(); panel.dataset.sessionId = session.id; panel.classList.add('chat-panel'); revealPanel();
    const header = el('header', 'chat-header');
    const recent = el('section', 'recent-messages'); recent.id = 'recent-messages';
    const requests = el('div', 'chat-requests'); requests.setAttribute('aria-label', 'Pending questions and permissions');
    const composer = el('section', 'message-composer'); composer.id = 'message-composer';
    panel.append(header, recent, requests, composer);
  }
  const signature = JSON.stringify([session.id, session.status, session.title, session.project, session.cwd, session.model, session.control, !!state.error]);
  if (signature !== panelSignature) {
    panelSignature = signature;
    renderSessionHeader(panel.querySelector('.chat-header'), session);
  }
  const requests = panel.querySelector('.chat-requests');
  const requestSignature = JSON.stringify([session.requests.map(({ sending, ...request }) => request), needsInput(session), !!state.error]);
  if (requests.dataset.signature !== requestSignature) {
    requests.dataset.signature = requestSignature;
    renderSessionRequests(requests, session);
  }
  renderRecentMessages(session);
  renderComposer(session);
}

function renderSessionHeader(header, session) {
  const expanded = !!header.querySelector('.chat-info')?.open;
  header.replaceChildren();
  const head = el('div', 'panel-heading'), actions = el('div', 'panel-heading-actions'); actions.append(themeMenu(), badge(session.status)); const back = button('Back', 'quiet-button back-button', closePanel, 'back'); back.title = 'Back to sessions'; head.append(back, actions); header.append(head);
  const title = el('h2', 'panel-title', session.title); title.title = session.title; header.append(title);
  const metadata = el('details', 'chat-info'); metadata.open = expanded;
  metadata.append(el('summary', '', `${providerName(session.provider)} · ${session.project}`));
  const info = el('dl', 'session-info'); for (const [key, value] of [['Folder', session.cwd], ['Model / version', session.model || 'Not reported'], ['Session', session.nativeId || session.id], ['Connection', session.control ? 'Connected' : 'Status only']]) info.append(el('dt', '', key), el('dd', '', value)); metadata.append(info); if (session.cwd) metadata.append(spawnButtons(session.cwd)); header.append(metadata);
  if (state.error) header.append(el('p', 'connection-error', 'Reconnecting. Actions are temporarily disabled.'));
}

function renderSessionRequests(requests, session) {
  requests.replaceChildren();
  for (const request of session.requests) {
    const box = el('section', 'request-box'); box.append(el('span', 'eyebrow amber-text', request.kind === 'question' ? 'YOUR INPUT' : 'PERMISSION REQUEST'));
    if (request.kind !== 'question' || request.title !== 'A question for you') box.append(el('h3', '', request.title));
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
      for (const action of request.actions) { const b = button(action.label, action.value === 'accept' ? 'primary' : 'secondary', () => respond(request, { decision: action.value }, actions, error)); b.disabled = !!state.error || request.sending; actions.append(b); }
      box.append(error, actions);
    } else box.append(el('p', 'muted', request.note || 'Answer this request in the original client.'));
    requests.append(box);
  }
  if (!session.requests.length && needsInput(session)) {
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
    row.append(cancel); queue.append(row);
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
    const details = el('details', 'request-file'); details.append(el('summary', '', `${fieldLabel(file.kind)} · ${file.path}`));
    if (file.moveTo) details.append(el('p', '', `Move to ${file.moveTo}`));
    if (file.diff) details.append(el('pre', 'request-code', file.diff)); box.append(details);
  }
  if (view.raw) { const details = el('details', 'request-details'); details.append(el('summary', '', 'Technical details'), el('pre', '', view.raw)); box.append(details); }
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
  const signature = JSON.stringify([session.messages, session.messagesState]);
  if (region.dataset.signature === signature) { if (savedPosition) flow.restore(savedPosition); return; }
  const saved = savedPosition || flow.capture();
  const content = region.querySelector('.history-content');
  const existing = new Map([...content.querySelectorAll('[data-message-id]')].map(node => [node.dataset.messageId, node]));
  const children = [];
  region.dataset.signature = signature;
  if (!session.messages?.length) children.push(el('p', 'muted history-empty', session.messagesState === 'loading' ? 'Loading recent messages…' : session.messagesState === 'empty' ? 'No recent text messages.' : 'Recent messages are not available for this session yet.'));
  if (session.messagesState === 'stale') children.push(el('p', 'muted', 'Showing the last messages received.'));
  for (const message of session.messages || []) {
    const previous = existing.get(message.id), messageSignature = JSON.stringify(message);
    if (previous?.dataset.signature === messageSignature) { children.push(previous); continue; }
    const article = el('article', `recent-message ${message.tool ? 'tool' : message.role}`);
    article.dataset.messageId = message.id; article.dataset.signature = messageSignature;
    if (message.tool || message.role === 'notice') { const line = el(message.tool ? 'code' : 'span', message.tool ? 'tool-call' : '', message.text); line.title = [message.detail, message.timestamp && new Date(message.timestamp).toLocaleString()].filter(Boolean).join('\n'); article.append(line); children.push(article); continue; }
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
    children.push(article);
  }
  // Keep unchanged messages mounted so expanded text and keyboard focus survive polling.
  for (const node of [...content.children]) if (!children.includes(node)) node.remove();
  children.forEach((node, index) => { if (content.children[index] !== node) content.insertBefore(node, content.children[index] || null); });
  flow.restore(saved);
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
  for (const provider of ['claude', 'codex']) { const b = button(provider === 'codex' ? 'Codex' : 'Claude', 'quiet-button spawn-button', () => spawnAgent(cwd, provider, b), 'plus'); b.title = `New ${providerName(provider)} in tmux`; actions.append(b); }
  return actions;
}
async function spawnAgent(cwd, provider, control) {
  if (state.error) return;
  control.disabled = true;
  try { toast(`${providerName(provider)} started in tmux ${(await api('spawn', { cwd, provider })).session}`); }
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
  dialog.onclose = () => { applyTheme(document.documentElement.dataset.themeChoice); dialog.remove(); };
  document.body.append(dialog); dialog.showModal();
}
if (firstVisit) showThemePicker();
