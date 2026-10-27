const consoles = new WeakMap();
const labels = { working: 'Working', idle: 'Idle', question: 'Question', permission: 'Permission needed', offline: 'Offline', error: 'Error' };
const element = (tag, className, text) => {
  const node = document.createElement(tag); node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// A deterministic session map, independent of the overview's activity ordering.
export function sessionMapPoints(sessions) {
  const sorted = [...sessions].sort((a, b) => a.id.localeCompare(b.id));
  const columns = Math.max(3, Math.ceil(Math.sqrt(sorted.length * 1.6)));
  const rows = Math.max(1, Math.ceil(sorted.length / columns));
  return sorted.map((session, index) => ({ session,
    x: 10 + (index % columns + .5) * 80 / columns,
    y: 12 + (Math.floor(index / columns) + .5) * 76 / rows,
  }));
}

export function renderThemeConsole(container, sessions, { disconnected = false, onSelect } = {}) {
  if (!container) return;
  let console = consoles.get(container);
  if (!console) {
    const lamps = element('div', 'console-lamps'); lamps.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 12; i++) lamps.append(element('i'));
    const heading = element('div', 'console-heading');
    const count = element('span', 'console-count'); heading.append(element('span', '', 'Sessions'), count);
    const screen = element('div', 'console-screen');
    screen.setAttribute('role', 'group'); screen.setAttribute('aria-label', 'Session map');
    const vector = element('div', 'console-vector'); vector.setAttribute('aria-hidden', 'true');
    vector.innerHTML = '<svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="1"><path d="M73 18H127L154 45V95L127 122H73L46 95V45Z M80 34H120L138 52V88L120 106H80L62 88V52Z M86 48H114L124 58V82L114 92H86L76 82V58Z"/><path d="M100 8V34M100 106V132M32 70H62M138 70H168M12 22H36V46M164 94V118H188"/><path d="M72 70H128M100 44V96" stroke-dasharray="2 4"/></g></svg>';
    const sweep = element('div', 'console-sweep'); sweep.setAttribute('aria-hidden', 'true');
    const contacts = element('div', 'console-contacts');
    const empty = element('span', 'console-empty');
    screen.append(vector, sweep, contacts, empty); container.append(lamps, heading, screen);
    console = { count, contacts, empty, buttons: new Map() }; consoles.set(container, console);
  }
  container.dataset.disconnected = String(disconnected);
  console.count.textContent = String(sessions.length).padStart(3, '0');
  console.empty.textContent = disconnected ? 'NO SIGNAL' : sessions.length ? '' : 'NO SESSIONS';
  console.empty.hidden = !disconnected && sessions.length > 0;
  const ids = new Set(sessions.map(session => session.id));
  for (const [id, button] of console.buttons) {
    if (!ids.has(id)) { button.remove(); console.buttons.delete(id); }
  }
  for (const { session, x, y } of sessionMapPoints(sessions)) {
    let button = console.buttons.get(session.id);
    if (!button) {
      button = element('button', 'console-contact'); button.type = 'button';
      console.buttons.set(session.id, button); console.contacts.append(button);
    }
    const label = `${session.title || session.id} · ${labels[session.status] || 'Unknown'}`;
    button.title = label; button.setAttribute('aria-label', label);
    // Blip the contact when its session changes status (restart the animation by re-adding the class).
    if (button.dataset.status && button.dataset.status !== session.status) { button.classList.remove('blip'); void button.offsetWidth; button.classList.add('blip'); }
    button.dataset.status = session.status;
    button.disabled = disconnected;
    button.style.left = `${x}%`; button.style.top = `${y}%`;
    button.onclick = () => onSelect?.(session.id);
  }
}
