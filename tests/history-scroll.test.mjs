import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryScroll } from '../client/history-scroll.js';

function events(object = {}) {
  const listeners = new Map();
  return Object.assign(object, {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    emit: (name, event = {}) => listeners.get(name)?.(event),
  });
}
function pane(heights, clientHeight = 200) {
  let position = 0;
  const viewport = events({
    messages: heights.map((height, id) => ({ id: String(id), height })), clientHeight,
    get scrollHeight() { return this.messages.reduce((sum, message) => sum + message.height, 0); },
    get scrollTop() { return position; },
    set scrollTop(value) { position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
    getBoundingClientRect: () => ({ top: 42 }),
    focus() { this.focused = true; },
    querySelectorAll() {
      return this.messages.map(message => ({
        dataset: { messageId: message.id },
        getBoundingClientRect: () => {
          const offset = this.messages.slice(0, this.messages.indexOf(message)).reduce((sum, row) => sum + row.height, 0);
          return { top: 42 + offset - position, bottom: 42 + offset + message.height - position };
        },
      }));
    },
  });
  const latest = events({ hidden: false });
  const flow = new HistoryScroll(viewport, latest);
  flow.restore(flow.capture());
  return { viewport, latest, flow };
}

test('history opens on the latest message and follows new messages', () => {
  const { viewport, latest, flow } = pane([200, 200, 200]);
  assert.equal(viewport.scrollTop, 400);
  const saved = flow.capture();
  viewport.messages.push({ id: 'new', height: 120 });
  flow.restore(saved);
  assert.equal(viewport.scrollTop, 520);
  assert.equal(latest.hidden, true);
  flow.destroy();
});

test('a late scroll event after content grows keeps following the end', () => {
  const { viewport, flow } = pane([200, 200, 200]);
  viewport.messages[2].height = 260; viewport.emit('scroll');
  flow.resized();
  assert.equal(viewport.scrollTop, 460);
  flow.destroy();
});

test('scrolling up pauses following; Latest returns to the end and resumes it', () => {
  const { viewport, latest, flow } = pane([200, 200, 200]);
  viewport.scrollTop = 100; viewport.emit('scroll');
  const saved = flow.capture(); viewport.messages.push({ id: 'new', height: 120 }); flow.restore(saved);
  assert.equal(viewport.scrollTop, 100);
  assert.equal(latest.hidden, false);
  latest.emit('click');
  assert.equal(viewport.scrollTop, 520); assert.equal(latest.hidden, true); assert.equal(viewport.focused, true);
  const next = flow.capture(); viewport.messages.push({ id: 'newer', height: 80 }); flow.restore(next);
  assert.equal(viewport.scrollTop, 600);
  flow.destroy();
});

test('rolling history keeps the visible message anchored when an older entry disappears', () => {
  const { viewport, flow } = pane([100, 100, 100, 100, 100], 160);
  viewport.scrollTop = 240; viewport.emit('scroll');
  const saved = flow.capture();
  viewport.messages.shift(); viewport.messages.push({ id: 'new', height: 100 });
  flow.restore(saved);
  assert.equal(viewport.scrollTop, 140);
  const anchor = viewport.querySelectorAll().find(node => node.dataset.messageId === '2');
  assert.equal(anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top, -40);
  flow.destroy();
});

test('resizing follows the end only when the reader has not scrolled away', () => {
  const { viewport, flow } = pane([200, 200, 200]);
  viewport.clientHeight = 100; flow.resized(); assert.equal(viewport.scrollTop, 500);
  viewport.scrollTop = 100; viewport.emit('scroll');
  viewport.clientHeight = 150; flow.resized(); assert.equal(viewport.scrollTop, 100);
  flow.destroy();
});

test('expanding an earlier message pauses following before its height changes', () => {
  const { viewport, latest, flow } = pane([200, 200, 200]);
  const summary = { parentElement: { tagName: 'DETAILS', open: false } };
  viewport.emit('click', { target: { closest: () => summary } });
  viewport.messages[1].height += 300; flow.resized();
  assert.equal(viewport.scrollTop, 400); assert.equal(latest.hidden, false);
  flow.destroy();
});
