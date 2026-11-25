import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryScroll, mergeHistory } from '../client/history-scroll.js';

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

test('following the latest message does not measure every history item before an update', () => {
  const { viewport, flow } = pane(Array(100).fill(40));
  viewport.querySelectorAll = () => { throw new Error('following should not scan message positions'); };
  const saved = flow.capture();
  viewport.messages.push({ id: 'new', height: 40 });
  flow.restore(saved);
  assert.equal(viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight);
  flow.destroy();
});

test('older pages join the live window: each message once, the live copy kept, nothing lost as the window rolls on', () => {
  const list = (...ids) => ids.map(id => ({ id })), ids = messages => messages.map(message => message.id).join(' ');
  assert.equal(ids(mergeHistory([], list('c', 'd'))), 'c d');
  assert.equal(ids(mergeHistory(list('a', 'b', 'c', 'd'), list('c', 'd', 'e'))), 'a b c d e');
  const live = [{ id: 'c', text: 'new' }];
  assert.equal(mergeHistory([{ id: 'c', text: 'old' }], live)[0].text, 'new');
  // What the window dropped stays, and what left it before rolling out (a streamed part) goes.
  let shown = mergeHistory(list('a', 'b', 'c'), list('b', 'c', 'part'));
  shown = mergeHistory(shown, list('c', 'd'));
  assert.equal(ids(shown), 'a b c d');
  // A page that came back ahead of the snapshot never doubles a message.
  assert.equal(ids(mergeHistory(list('e', 'a', 'b', 'c'), list('b', 'c', 'd', 'e'))), 'a b c d e');
});

test('a subagent keeps its pinned task first, with older pages between it and the live window', () => {
  const list = (...ids) => ids.map(id => ({ id })), ids = messages => messages.map(message => message.id).join(' ');
  assert.equal(ids(mergeHistory(list('task', 'a', 'b', 'c'), list('task', 'c', 'd'), true)), 'task a b c d');
  assert.equal(ids(mergeHistory(list('a', 'b', 'c'), list('task', 'c', 'd'), true)), 'task a b c d');
});

test('a new width keeps a settled reader at their message', async () => {
  const { viewport, flow } = pane([100, 100, 100, 100, 100], 160);
  viewport.clientWidth = 600; flow.resized();
  viewport.scrollTop = 230; viewport.emit('scroll');
  await new Promise(resolve => setTimeout(resolve, 150));
  viewport.messages.forEach(message => { message.height = 140; }); viewport.clientWidth = 400; flow.resized();
  assert.equal(viewport.scrollTop, 310); assert.equal(flow.following, false);
  flow.destroy();
});

test('older messages load in above the reader without moving what they are reading', () => {
  const { viewport, flow } = pane([100, 100, 100, 100, 100], 160);
  viewport.scrollTop = 30; viewport.emit('scroll');
  const saved = flow.capture();
  viewport.messages.unshift({ id: 'older-1', height: 250 }, { id: 'older-2', height: 70 });
  flow.restore(saved);
  assert.equal(viewport.scrollTop, 350);
  assert.equal(flow.following, false);
  flow.destroy();
});
