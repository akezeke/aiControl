import { providerIcon } from './provider-icons.js';

const consoles = new WeakMap();
const labels = { working: 'Working', idle: 'Idle', question: 'Question', permission: 'Permission needed', offline: 'Offline', error: 'Error' };
const needsInput = status => status === 'question' || status === 'permission';
const element = (tag, className, text) => {
  const node = document.createElement(tag); node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// A deterministic session map, independent of the overview's activity ordering. A contact waiting
// for you closes in on the centre over ten minutes, so the longest wait sits nearest.
export function sessionMapPoints(sessions, now = Date.now()) {
  const sorted = [...sessions].sort((a, b) => a.id.localeCompare(b.id));
  const columns = Math.max(3, Math.ceil(Math.sqrt(sorted.length * 1.6)));
  const rows = Math.max(1, Math.ceil(sorted.length / columns));
  return sorted.map((session, index) => {
    const x = 10 + (index % columns + .5) * 80 / columns, y = 12 + (Math.floor(index / columns) + .5) * 76 / rows;
    const since = session.requests?.[0]?.createdAt, pull = needsInput(session.status) && since ? Math.min(1, Math.max(0, now - since) / 600_000) * .8 : 0;
    return { session, x: x + (50 - x) * pull, y: y + (50 - y) * pull };
  });
}

// Project and member slots survive activity-order changes. Vacated slots can be reused without
// moving any retained contact; only unusually large projects expand their row for readable targets.
function projectRadar(console, sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = session.cwd || session.project || 'unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  for (const key of console.projects.keys()) if (!groups.has(key)) console.projects.delete(key);
  const vacant = slots => { let slot = 0; while (slots.has(slot)) slot++; return slot; };
  const used = new Set([...console.projects.values()].map(project => project.slot));
  for (const key of [...groups.keys()].sort()) {
    if (!console.projects.has(key)) {
      const slot = vacant(used); used.add(slot);
      console.projects.set(key, { slot, members: new Map() });
    }
  }
  const rows = [];
  for (const [key, project] of console.projects) {
    const members = groups.get(key), ids = new Set(members.map(session => session.id));
    for (const id of project.members.keys()) if (!ids.has(id)) project.members.delete(id);
    const occupied = new Set(project.members.values());
    for (const id of [...ids].sort()) if (!project.members.has(id)) {
      const slot = vacant(occupied); occupied.add(slot); project.members.set(id, slot);
    }
    const row = Math.floor(project.slot / 2), height = 20 + Math.max(2, Math.ceil((Math.max(...occupied) + 1) / 3)) * 26;
    rows[row] = Math.max(rows[row] || 72, height);
  }
  const points = new Map(), sectors = [];
  for (const [key, project] of console.projects) {
    const members = groups.get(key), column = project.slot % 2, row = Math.floor(project.slot / 2);
    let top = 0; for (let i = 0; i < row; i++) top += rows[i] || 72;
    sectors.push({ key, label: members[0].project || 'Other', count: members.length, left: column * 50, top, height: rows[row] });
    for (const session of members) {
      const slot = project.members.get(session.id);
      points.set(session.id, { x: column * 50 + (slot % 3 + .5) * 50 / 3, y: top + 20 + (Math.floor(slot / 3) + .5) * 26 });
    }
  }
  return { points, sectors, height: Math.max(144, Array.from({ length: rows.length }, (_, i) => rows[i] || 72).reduce((sum, height) => sum + height, 0)) };
}

// One line per theme; CSS shows the active theme's wording.
export function summary(sessions) {
  const working = sessions.filter(s => s.status === 'working').length, waiting = sessions.filter(s => needsInput(s.status)).length;
  return {
    modern: waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you · ${working} working` : working ? `${working} working` : 'All quiet',
    alien: `CREW ${sessions.length} · ACTIVE ${working} · AWAITING INPUT ${waiting}`,
    bridge: waiting ? `${waiting} WAITING · WARP ${working}` : working ? `WARP ${working}` : 'ORBIT',
    city: waiting ? `${waiting} WAITING · ${working} BUILDING` : working ? `${working} BUILDING` : 'ALL QUIET',
    fantasy: waiting ? `${waiting} ready · ${working} fighting` : working ? `${working} fighting` : 'At rest',
    command: waiting ? `${waiting} awaiting orders · ${working} units active` : working ? `${working} units active` : 'All units standing by',
    simpsons: waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you · ${working} working` : working ? `${working} working · Doughnuts later` : 'All quiet in Springfield',
    diablo: waiting ? `${waiting} need your counsel · ${working} questing` : working ? `${working} questing` : 'A moment of peace',
    heroes: waiting ? `${waiting} awaiting orders · ${working} on a quest` : working ? `${working} on a quest` : 'The realm is at peace',
    zelda: waiting ? `${waiting} need you · ${working} exploring` : working ? `${working} exploring` : 'All is peaceful',
    bricks: waiting ? `${waiting} await${waiting === 1 ? 's' : ''} your orders · ${working} on a quest` : working ? `${working} on a quest` : 'The keep is quiet',
  };
}
const flashes = {
  ready: title => ({ modern: `Done · ${title}`, bridge: `DONE · ${title}`, city: `DONE · ${title}`, fantasy: `VICTORY · ${title}`, alien: `TASK COMPLETE · ${title}`, command: `Unit ready · ${title}`, simpsons: `Woo-hoo! Done · ${title}`, heroes: `Quest complete · ${title}`, zelda: `Quest complete · ${title}`, diablo: `Quest complete · ${title}`, bricks: `Quest complete · ${title}` }),
  input: title => ({ modern: `Needs you · ${title}`, bridge: `WAITING · ${title}`, city: `WAITING · ${title}`, fantasy: `READY · ${title}`, alien: `INPUT REQUIRED · ${title}`, command: `Orders required · ${title}`, simpsons: `Needs you · ${title}`, heroes: `Orders required · ${title}`, zelda: `Needs you · ${title}`, diablo: `Your counsel is needed · ${title}`, bricks: `Orders, my lord · ${title}` }),
};
function setLine(line, texts, signal = '') {
  const key = JSON.stringify(texts);
  if (line.dataset.key === key) return;
  line.dataset.key = key; line.dataset.signal = signal;
  line.replaceChildren(...Object.entries(texts).map(([id, text]) => element('span', `status-text ${id}`, text)));
  line.classList.remove('flash'); if (signal) { void line.offsetWidth; line.classList.add('flash'); }
}

// Hover previews never open a session or steal focus. A selected contact remains tracked after
// the pointer leaves, and EVA's explicit Open action uses the current snapshot, never a stale closure.
function inspectContact(console, id) {
  console.inspected = id;
  const session = console.sessions.find(session => session.id === (id || console.selected));
  for (const [key, button] of console.buttons) {
    button.toggleAttribute('data-tracked', key === session?.id);
    button.setAttribute('aria-pressed', String(key === console.selected));
  }
  console.readout.dataset.status = console.disconnected ? 'offline' : session?.status || '';
  console.trackLabel.textContent = console.disconnected ? 'LINK LOST' : session ? labels[session.status] || 'Unknown' : 'CONTACTS';
  console.trackName.textContent = console.disconnected ? 'Reconnecting…' : session ? session.title || session.id : `${console.sessions.length} tracked`;
  console.trackName.title = session?.title || '';
}

function renderCommand(console) {
  const session = console.sessions.find(session => session.id === console.selected);
  const { command, commandTitle, commandStatus, commandMeta, progress, open, next } = console;
  command.dataset.status = console.disconnected ? 'offline' : session?.status || '';
  commandTitle.textContent = session?.title || session?.id || 'Select unit';
  commandTitle.title = session?.title || '';
  commandStatus.textContent = console.disconnected ? 'LINK LOST' : session ? labels[session.status] || 'Unknown' : 'STANDING BY';
  const plan = session?.plan, total = plan?.length || 0, done = total ? plan.filter(step => step.status === 'done').length : 0;
  progress.hidden = !total;
  progress.max = total || 1; progress.value = done;
  progress.setAttribute('aria-label', `Plan: ${done} of ${total} steps complete`);
  const context = session?.context, knownContext = Number.isFinite(context?.used) && Number.isFinite(context?.window) && context.window > 0;
  commandMeta.textContent = [session?.project, total && `${done}/${total} steps`, knownContext && `ctx ${Math.min(100, Math.max(0, Math.round(context.used / context.window * 100)))}%`].filter(Boolean).join(' · ');
  commandMeta.title = [session?.branch, session?.requests?.[0]?.title || session?.detail].filter(Boolean).join(' · ');
  open.disabled = console.disconnected || !session || session.status === 'offline' || !console.onSelect;
  const waiting = console.sessions.filter(session => needsInput(session.status) && session.id !== console.selected);
  next.disabled = console.disconnected || !waiting.length || !console.onNext;
  next.title = waiting.length ? `${waiting.length} waiting for input` : 'No sessions waiting';
}

export function renderThemeConsole(container, sessions, { disconnected = false, onSelect, selectedId, onInspect, onNext } = {}) {
  if (!container) return;
  let console = consoles.get(container);
  if (!console) {
    const lamps = element('div', 'console-lamps'); lamps.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 12; i++) lamps.append(element('i'));
    const heading = element('div', 'console-heading');
    const count = element('span', 'console-count'); heading.append(element('span', 'console-label', 'Sessions'), count);
    const screen = element('div', 'console-screen');
    screen.setAttribute('role', 'group'); screen.setAttribute('aria-label', 'Session map');
    const vector = element('div', 'console-vector'); vector.setAttribute('aria-hidden', 'true');
    // Decorative terrain only; every interactive marker still corresponds to a real session.
    vector.innerHTML = '<svg viewBox="0 0 200 140" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width=".7"><path d="M0 14L30 9 48 24 38 43 59 66 42 80 45 104 20 120 0 116Z M200 24L180 32 162 26 139 46 147 67 127 91 141 117 168 125 174 140H200Z"/><path d="M0 24L27 19 35 28 28 44 47 64 32 80 34 100 15 108 0 106 M200 38L181 44 165 37 151 49 158 70 139 92 150 107 178 114 186 140 M0 36L17 29 21 46 35 63 22 79 23 94 0 99 M200 53L177 56 169 72 153 94 181 102 199 126"/></g><g stroke="currentColor" stroke-opacity=".35" stroke-width="1"><path d="M60 0V24L80 43V72L105 96V140 M65 0V22L85 41V70L110 94V140"/><path d="M0 88H60L88 62H138L160 83H200" stroke-dasharray="3 3"/><path d="M14 8H6V16 M186 8H194V16 M6 124V132H14 M186 132H194V124"/></g><g stroke="currentColor" stroke-width="1"><path d="M83 52H116V87H83Z M78 47H88 M78 47V57 M111 47H121V57 M78 82V92H88 M111 92H121V82"/></g></svg>';
    const sweep = element('div', 'console-sweep'); sweep.setAttribute('aria-hidden', 'true');
    const field = element('div', 'console-field'), sectors = element('div', 'console-sectors'); sectors.setAttribute('aria-hidden', 'true');
    const contacts = element('div', 'console-contacts');
    const empty = element('span', 'console-empty');
    // Command's power bar: the five-hour usage of each account, filled by renderPower().
    const power = element('div', 'console-power'); power.setAttribute('aria-hidden', 'true');
    power.append(element('span', 'power-label', 'PWR'));
    for (const provider of ['codex', 'claude']) { const bar = element('span', 'power-bar'); bar.dataset.provider = provider; const mark = element('b'); mark.append(providerIcon(provider)); bar.append(element('i'), mark); power.append(bar); }
    const readout = element('div', 'console-readout');
    const signal = element('span', 'console-signal'); signal.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 9; i++) { const bar = element('i'); bar.style.setProperty('--signal-height', `${[3, 7, 12, 5, 17, 9, 14, 6, 3][i]}px`); bar.style.setProperty('--signal-delay', `${i * -140}ms`); signal.append(bar); }
    const trackLabel = element('span', 'console-track-label'), trackName = element('span', 'console-track-name');
    readout.append(signal, trackLabel, trackName);
    const command = element('div', 'console-command'), commandTitle = element('strong', 'console-command-title');
    const commandStatus = element('span', 'console-command-status'), commandMeta = element('span', 'console-command-meta');
    const progress = element('progress', 'console-progress'), actions = element('div', 'console-command-actions');
    const open = element('button', 'console-open quiet-button', 'Open'), next = element('button', 'console-next quiet-button', 'Next waiting');
    open.type = next.type = 'button'; actions.append(open, next);
    command.append(commandStatus, commandTitle, commandMeta, progress, actions);
    field.append(sectors, contacts); screen.append(vector, sweep, field, empty); container.append(lamps, heading, power, screen, readout, command);
    console = { count, field, sectors, contacts, empty, readout, trackLabel, trackName, command, commandTitle, commandStatus, commandMeta, progress, open, next,
      sessions: [], buttons: new Map(), projects: new Map(), sectorNodes: new Map(), flashUntil: 0 }; consoles.set(container, console);
    open.onclick = () => { if (!open.disabled) console.onSelect?.(console.selected); };
    next.onclick = () => { if (!next.disabled) console.onNext?.(console.selected); };
    renderPower();
  }
  container.dataset.disconnected = String(disconnected);
  console.sessions = sessions; console.disconnected = disconnected;
  console.onSelect = onSelect; console.onInspect = onInspect; console.onNext = onNext;
  if (selectedId !== undefined) console.selected = selectedId;
  if (!sessions.some(session => session.id === console.selected)) console.selected = null;
  container.toggleAttribute('data-waiting', !disconnected && sessions.some(session => needsInput(session.status)));
  const radar = projectRadar(console, sessions);
  console.field.style.setProperty('--radar-height', `${radar.height}px`);
  const projectIds = new Set(radar.sectors.map(sector => sector.key));
  for (const [key, node] of console.sectorNodes) if (!projectIds.has(key)) { node.remove(); console.sectorNodes.delete(key); }
  for (const sector of radar.sectors) {
    let node = console.sectorNodes.get(sector.key);
    if (!node) { node = element('div', 'console-sector'); node.append(element('span')); console.sectorNodes.set(sector.key, node); console.sectors.append(node); }
    node.style.left = `${sector.left}%`; node.style.top = `${sector.top}px`; node.style.height = `${sector.height}px`;
    node.children[0].textContent = `${sector.label} · ${sector.count}`;
  }
  container.toggleAttribute('data-active', !disconnected && sessions.some(session => session.status === 'working'));
  console.count.textContent = String(sessions.length).padStart(3, '0');
  console.empty.textContent = disconnected ? 'NO SIGNAL' : sessions.length ? '' : 'NO SESSIONS';
  console.empty.hidden = !disconnected && sessions.length > 0;
  const ids = new Set(sessions.map(session => session.id));
  for (const [id, button] of console.buttons) {
    if (!ids.has(id)) { button.remove(); console.buttons.delete(id); }
  }
  let flash, signal;
  for (const { session, x, y } of sessionMapPoints(sessions)) {
    let button = console.buttons.get(session.id);
    if (!button) {
      button = element('button', 'console-contact'); button.type = 'button'; button.dataset.sessionId = session.id;
      console.buttons.set(session.id, button); console.contacts.append(button);
      const inspect = id => { if (!console.disconnected) { inspectContact(console, id); console.onInspect?.(id); } };
      button.onpointerenter = button.onfocus = () => inspect(session.id);
      button.onpointerleave = () => { if (container.ownerDocument.activeElement !== button) inspect(null); };
      button.onblur = () => inspect(null);
    }
    const label = [session.title || session.id, session.project, labels[session.status] || 'Unknown'].filter(Boolean).join(' · ');
    button.title = label; button.setAttribute('aria-label', label);
    const previous = button.dataset.status;
    // Blip the contact when its session changes status (restart the animation by re-adding the class).
    if (previous && previous !== session.status) {
      button.classList.remove('blip'); void button.offsetWidth; button.classList.add('blip');
      if (!disconnected && previous === 'working' && session.status === 'idle') { flash = flashes.ready(session.title || session.id); signal = 'complete'; }
      else if (!disconnected && needsInput(session.status) && !needsInput(previous)) { flash = flashes.input(session.title || session.id); signal = 'input'; }
    }
    button.dataset.status = session.status;
    button.disabled = disconnected || session.status === 'offline';
    button.style.left = `${x}%`; button.style.top = `${y}%`;
    const point = radar.points.get(session.id);
    button.style.setProperty('--radar-x', `${point.x}%`); button.style.setProperty('--radar-y', `${point.y}px`);
    button.onclick = () => {
      if (button.disabled) return;
      if (container.ownerDocument.documentElement.dataset.theme === 'command') {
        console.selected = session.id; inspectContact(console, session.id); renderCommand(console); console.onInspect?.(session.id, { selected: true });
      } else console.onSelect?.(session.id);
    };
  }
  inspectContact(console, console.inspected);
  renderCommand(console);
  const line = container.ownerDocument.getElementById('status-line');
  if (!line) return;
  if (flash) { console.flashUntil = Date.now() + 6000; setLine(line, flash, signal); }
  else if (Date.now() > console.flashUntil) setLine(line, summary(sessions));
}

// Called by renderUsage with the shared usage snapshot; remembered for a console built after it.
// A spent five-hour window is EVA's low power: the radar drops to static.
let powerAccounts = [];
export function renderPower(accounts = powerAccounts) {
  powerAccounts = accounts;
  document.documentElement.toggleAttribute('data-low-power', accounts.some(account => account.windows?.some(w => w.label === '5-hour' && w.usedPercent >= 100)));
  for (const bar of document.querySelectorAll('.power-bar')) {
    // With several accounts of one provider, the fullest one sets the bar.
    const levels = accounts.filter(account => account.provider === bar.dataset.provider).map(account => account.windows?.find(w => w.label === '5-hour')?.usedPercent).filter(Number.isFinite);
    const used = levels.length ? Math.max(...levels) : null;
    bar.style.setProperty('--level', used == null ? 0 : Math.min(1, used / 100));
    bar.dataset.tone = used == null ? 'off' : used >= 100 ? 'full' : used >= 80 ? 'high' : '';
    bar.title = `${bar.dataset.provider === 'codex' ? 'Codex' : 'Claude'} 5h · ${used == null ? 'no data' : `${Math.round(used)}%`}`;
  }
}
