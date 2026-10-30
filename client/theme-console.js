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

// One line per theme; CSS shows the active theme's wording.
function summary(sessions) {
  const working = sessions.filter(s => s.status === 'working').length, waiting = sessions.filter(s => needsInput(s.status)).length;
  return {
    modern: waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you · ${working} working` : working ? `${working} working` : 'All quiet',
    alien: `CREW ${sessions.length} · ACTIVE ${working} · AWAITING INPUT ${waiting}`,
    command: waiting ? `${waiting} awaiting orders · ${working} units active` : working ? `${working} units active` : 'All units standing by',
    simpsons: waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you · ${working} working` : working ? `${working} working · Doughnuts later` : 'All quiet in Springfield',
    diablo: waiting ? `${waiting} need your counsel · ${working} questing` : working ? `${working} questing` : 'A moment of peace',
    heroes: waiting ? `${waiting} awaiting orders · ${working} on a quest` : working ? `${working} on a quest` : 'The realm is at peace',
  };
}
const flashes = {
  ready: title => ({ modern: `Done · ${title}`, alien: `TASK COMPLETE · ${title}`, command: `Unit ready · ${title}`, simpsons: `Woo-hoo! Done · ${title}`, heroes: `Quest complete · ${title}`, diablo: `Quest complete · ${title}` }),
  input: title => ({ modern: `Needs you · ${title}`, alien: `INPUT REQUIRED · ${title}`, command: `Orders required · ${title}`, simpsons: `Needs you · ${title}`, heroes: `Orders required · ${title}`, diablo: `Your counsel is needed · ${title}` }),
};
function setLine(line, texts, flash) {
  const key = JSON.stringify(texts);
  if (line.dataset.key === key) return;
  line.dataset.key = key;
  line.replaceChildren(...Object.entries(texts).map(([id, text]) => element('span', `status-text ${id}`, text)));
  line.classList.remove('flash'); if (flash) { void line.offsetWidth; line.classList.add('flash'); }
}

// Inspecting a contact never changes selection or steals focus. The persistent footer makes
// tiny radar targets identifiable before opening them, with the same feedback for keyboard users.
function inspectContact(console, id) {
  console.inspected = id;
  const session = console.sessions.find(session => session.id === id);
  for (const [key, button] of console.buttons) button.toggleAttribute('data-tracked', key === session?.id);
  console.readout.dataset.status = console.disconnected ? 'offline' : session?.status || '';
  console.trackLabel.textContent = console.disconnected ? 'LINK LOST' : session ? labels[session.status] || 'Unknown' : 'CONTACTS';
  console.trackName.textContent = console.disconnected ? 'Reconnecting…' : session ? session.title || session.id : `${console.sessions.length} tracked`;
  console.trackName.title = session?.title || '';
}

export function renderThemeConsole(container, sessions, { disconnected = false, onSelect } = {}) {
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
    screen.append(vector, sweep, contacts, empty); container.append(lamps, heading, power, screen, readout);
    console = { count, contacts, empty, readout, trackLabel, trackName, sessions: [], buttons: new Map(), flashUntil: 0 }; consoles.set(container, console);
    renderPower();
  }
  container.dataset.disconnected = String(disconnected);
  console.sessions = sessions; console.disconnected = disconnected;
  container.toggleAttribute('data-active', !disconnected && sessions.some(session => session.status === 'working'));
  console.count.textContent = String(sessions.length).padStart(3, '0');
  console.empty.textContent = disconnected ? 'NO SIGNAL' : sessions.length ? '' : 'NO SESSIONS';
  console.empty.hidden = !disconnected && sessions.length > 0;
  const ids = new Set(sessions.map(session => session.id));
  for (const [id, button] of console.buttons) {
    if (!ids.has(id)) { button.remove(); console.buttons.delete(id); }
  }
  let flash;
  for (const { session, x, y } of sessionMapPoints(sessions)) {
    let button = console.buttons.get(session.id);
    if (!button) {
      button = element('button', 'console-contact'); button.type = 'button';
      console.buttons.set(session.id, button); console.contacts.append(button);
      button.onpointerenter = button.onfocus = () => inspectContact(console, session.id);
      button.onpointerleave = () => { if (container.ownerDocument.activeElement !== button) inspectContact(console, null); };
      button.onblur = () => inspectContact(console, null);
    }
    const label = `${session.title || session.id} · ${labels[session.status] || 'Unknown'}`;
    button.title = label; button.setAttribute('aria-label', label);
    const previous = button.dataset.status;
    // Blip the contact when its session changes status (restart the animation by re-adding the class).
    if (previous && previous !== session.status) {
      button.classList.remove('blip'); void button.offsetWidth; button.classList.add('blip');
      if (previous === 'working' && session.status === 'idle') flash = flashes.ready(session.title);
      else if (needsInput(session.status) && !needsInput(previous)) flash = flashes.input(session.title);
    }
    button.dataset.status = session.status;
    button.disabled = disconnected;
    button.style.left = `${x}%`; button.style.top = `${y}%`;
    button.onclick = () => onSelect?.(session.id);
  }
  inspectContact(console, console.inspected);
  const line = container.ownerDocument.getElementById('status-line');
  if (!line) return;
  if (flash) { console.flashUntil = Date.now() + 6000; setLine(line, flash, true); }
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
