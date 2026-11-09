import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionMapPoints, summary, renderThemeConsole } from '../client/theme-console.js';

// The console needs element identity, attributes and events, not layout or a canvas.
function consoleDOM(t, theme = 'command') {
  const previous = globalThis.document;
  const document = { activeElement: null, createElement: tag => node(tag), querySelectorAll: () => [], getElementById: () => line };
  function node(tag) {
    const classes = new Set(), attributes = {}, style = { setProperty(name, value) { this[name] = String(value); } };
    const element = {
      tagName: tag.toUpperCase(), ownerDocument: document, children: [], dataset: {}, style, attributes, hidden: false,
      setAttribute(name, value) { attributes[name] = String(value); }, getAttribute(name) { return attributes[name] ?? null; },
      removeAttribute(name) { delete attributes[name]; }, toggleAttribute(name, active) { if (active) attributes[name] = ''; else delete attributes[name]; },
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } },
      replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); },
      remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; },
      focus() { document.activeElement = this; this.onfocus?.(); },
      set className(value) { classes.clear(); for (const name of String(value || '').split(' ')) classes.add(name); }, get className() { return [...classes].join(' '); },
    };
    return element;
  }
  const root = node('html'), line = node('div'), container = node('div'); root.dataset.theme = theme;
  document.documentElement = root; globalThis.document = document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const all = (element = container) => element.children.flatMap(child => [child, ...all(child)]);
  return { container, line, document, all, byClass: name => all().find(child => child.classList.contains(name)), contact: id => all().find(child => child.dataset.sessionId === id) };
}
const unit = (id, project, status = 'working', extra = {}) => ({ id, project, cwd: `/projects/${project}`, title: `Task ${id}`, status, requests: [], ...extra });

test('EVA retains project sectors and contact positions through reordered polling and new sessions', t => {
  const dom = consoleDOM(t), a = unit('a', 'alpha'), b = unit('b', 'beta');
  renderThemeConsole(dom.container, [b, a]);
  assert.equal(dom.all().filter(node => node.classList.contains('console-sector')).length, 2);
  const contact = dom.contact('a'), position = [contact.style['--radar-x'], contact.style['--radar-y']];
  assert.ok(position.every(value => value != null));
  contact.focus();
  renderThemeConsole(dom.container, [unit('c', 'gamma'), { ...a, status: 'permission' }, unit('d', 'alpha'), b]);
  assert.equal(dom.contact('a'), contact, 'polling must preserve the focused DOM element');
  assert.equal(dom.document.activeElement, contact);
  assert.deepEqual([contact.style['--radar-x'], contact.style['--radar-y']], position);
  assert.match(contact.title, /alpha/);
});

test('EVA selects a contact without opening it, persists selection through polling, and opens explicitly', t => {
  const dom = consoleDOM(t), selected = [], opened = [], sessions = [unit('a', 'alpha'), unit('b', 'beta')];
  const options = { onSelect: id => opened.push(id), onInspect: (id, detail) => selected.push([id, detail]) };
  renderThemeConsole(dom.container, sessions, options);
  dom.contact('a').onclick();
  assert.deepEqual(opened, []);
  assert.deepEqual(selected.at(-1), ['a', { selected: true }]);
  assert.equal(dom.contact('a').getAttribute('aria-pressed'), 'true');
  renderThemeConsole(dom.container, [...sessions].reverse(), options);
  assert.equal(dom.byClass('console-command-title').textContent, 'Task a');
  dom.byClass('console-open').onclick();
  assert.deepEqual(opened, ['a']);
  renderThemeConsole(dom.container, sessions, { ...options, selectedId: 'b' });
  assert.equal(dom.contact('b').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.contact('a').getAttribute('aria-pressed'), 'false');
  assert.equal(dom.byClass('console-command-title').textContent, 'Task b');
});

test('EVA tray shows actual plan progress and clears actions when the selected session disappears', t => {
  const dom = consoleDOM(t), sessions = [unit('a', 'alpha', 'working', { plan: [{ status: 'done' }, { status: 'working' }, { status: 'pending' }], context: { used: 25, window: 100 } })];
  renderThemeConsole(dom.container, sessions, { selectedId: 'a', onSelect() {} });
  const progress = dom.byClass('console-progress');
  assert.ok(progress, 'selected plan progress is visible');
  assert.equal(progress.value, 1); assert.equal(progress.max, 3); assert.equal(progress.hidden, false);
  assert.match(dom.byClass('console-command-meta').textContent, /25%/);
  renderThemeConsole(dom.container, [], { selectedId: 'a', onSelect() { assert.fail('removed sessions cannot open'); } });
  assert.equal(dom.byClass('console-open').disabled, true);
  dom.byClass('console-open').onclick();
  assert.equal(progress.hidden, true);
});

test('a disconnected console blocks both radar and tray callbacks and preserves the link-lost status', t => {
  const dom = consoleDOM(t), calls = [], sessions = [unit('a', 'alpha', 'permission')];
  renderThemeConsole(dom.container, sessions, { selectedId: 'a', disconnected: true, onSelect: () => calls.push('open'), onInspect: () => calls.push('inspect'), onNext: () => calls.push('next') });
  assert.equal(dom.contact('a').disabled, true);
  assert.equal(dom.byClass('console-open').disabled, true);
  assert.equal(dom.byClass('console-next').disabled, true);
  dom.contact('a').onclick(); dom.byClass('console-open').onclick(); dom.byClass('console-next').onclick();
  assert.deepEqual(calls, []);
  assert.equal(dom.byClass('console-track-label').textContent, 'LINK LOST');
  assert.equal(dom.byClass('console-command-status').textContent, 'LINK LOST');
});

test('Alien status acknowledgement appears once for a real completion, not unchanged polling', t => {
  const dom = consoleDOM(t, 'alien'), opened = [];
  renderThemeConsole(dom.container, [unit('a', 'alpha')], { onSelect: id => opened.push(id) });
  assert.equal(dom.line.classList.contains('flash'), false);
  renderThemeConsole(dom.container, [unit('a', 'alpha', 'idle')]);
  assert.equal(dom.line.dataset.signal, 'complete');
  assert.match(dom.line.children.find(node => node.classList.contains('alien')).textContent, /TASK COMPLETE/);
  const text = dom.line.children.find(node => node.classList.contains('alien'));
  renderThemeConsole(dom.container, [unit('a', 'alpha', 'idle')], { onSelect: id => opened.push(id) });
  assert.equal(dom.line.children.find(node => node.classList.contains('alien')), text);
  dom.contact('a').onclick();
  assert.deepEqual(opened, ['a'], 'Alien keeps direct contact opening');
});

test('EVA next waiting requires a different waiting session', t => {
  const dom = consoleDOM(t), sessions = [unit('a', 'alpha', 'permission')], calls = [];
  renderThemeConsole(dom.container, sessions, { selectedId: 'a', onNext: id => calls.push(id) });
  assert.equal(dom.byClass('console-next').disabled, true);
  dom.byClass('console-next').onclick(); assert.deepEqual(calls, []);
  renderThemeConsole(dom.container, [...sessions, unit('b', 'beta', 'question')], { selectedId: 'a', onNext: id => calls.push(id) });
  assert.equal(dom.byClass('console-next').disabled, false);
  dom.byClass('console-next').onclick(); assert.deepEqual(calls, ['a']);
});

test('radar contacts close in on the centre the longer they wait for you', () => {
  const now = 1_000_000_000, session = (id, status, waited) => ({ id, status, requests: waited == null ? [] : [{ createdAt: now - waited }] });
  const points = sessionMapPoints([session('a', 'working'), session('b', 'question', 0), session('c', 'permission', 10 * 60_000)], now);
  const distance = id => { const p = points.find(point => point.session.id === id); return Math.hypot(p.x - 50, p.y - 50); };
  const fresh = sessionMapPoints([session('a', 'working'), session('b', 'working'), session('c', 'working')], now);
  const home = id => { const p = fresh.find(point => point.session.id === id); return Math.hypot(p.x - 50, p.y - 50); };
  assert.equal(distance('a'), home('a'));
  assert.equal(distance('b'), home('b'));
  assert.ok(Math.abs(distance('c') - home('c') * .2) < 1e-9);
});
test('city has its own wording', () => { assert.equal(summary([{ status: 'working' }, { status: 'permission' }]).city, '1 WAITING · 1 BUILDING'); assert.equal(summary([]).city, 'ALL QUIET'); });
test('Zelda status keeps waiting sessions visible alongside active quests', () => {
  assert.equal(summary([{ status: 'working' }, { status: 'permission' }, { status: 'question' }]).zelda, '2 need you · 1 exploring');
  assert.equal(summary([]).zelda, 'All is peaceful');
});
