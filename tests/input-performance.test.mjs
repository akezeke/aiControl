import test from 'node:test';
import assert from 'node:assert/strict';
import { ComposerInput } from '../client/composer-input.js';
import { LiveRender } from '../client/live-render.js';

function clock() {
  let now = 0, serial = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, delay) { const id = ++serial; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    },
  };
}
class Input extends EventTarget {
  text = '';
  writes = 0;
  selectionStart = 0;
  get value() { return this.text; }
  set value(value) { this.text = value; this.writes++; this.selectionStart = value.length; }
  type(text, cursor = text.length) { this.text = text; this.selectionStart = cursor; this.dispatchEvent(new Event('input')); }
}

test('typing a burst changes controls only on empty/nonempty transitions and saves one draft', () => {
  const time = clock(), input = new Input();
  let controls = 0, saved = '', saves = 0;
  const draft = { get text() { return saved; }, set text(value) { saved = value; saves++; } };
  const composer = new ComposerInput(input, draft, () => controls++, time);
  for (let i = 1; i <= 50; i++) { input.type('x'.repeat(i)); time.advance(10); }
  assert.equal(input.writes, 1); assert.equal(controls, 1); assert.equal(saves, 0);
  time.advance(150);
  assert.equal(saves, 1); assert.equal(saved, 'x'.repeat(50));
  input.type(''); assert.equal(controls, 2); assert.equal(composer.hasText, false);
  composer.destroy();
});

test('polling does not overwrite text or move the caret during an uncommitted draft or composition', () => {
  const time = clock(), input = new Input(), draft = { text: 'old draft' };
  const composer = new ComposerInput(input, draft, () => {}, time);
  input.type('new draft', 3);
  for (let i = 0; i < 20; i++) composer.syncReset();
  assert.equal(input.value, 'new draft'); assert.equal(input.selectionStart, 3); assert.equal(input.writes, 1);
  input.dispatchEvent(new Event('compositionstart'));
  input.type('正在输入'); time.advance(500);
  assert.equal(draft.text, 'old draft'); assert.equal(composer.composing, true);
  composer.syncReset(); assert.equal(input.value, '正在输入');
  input.dispatchEvent(new Event('compositionend')); time.advance(150);
  assert.equal(draft.text, '正在输入'); assert.equal(composer.composing, false);
  composer.destroy();
});

test('sending immediately flushes the last keystroke, and only acknowledged sends clear the field', () => {
  const time = clock(), input = new Input(), draft = { text: '' };
  const composer = new ComposerInput(input, draft, () => {}, time);
  input.type('Send this entire message');
  assert.equal(composer.flush(), 'Send this entire message');
  draft.error = 'Network unavailable'; composer.syncReset();
  assert.equal(input.value, 'Send this entire message');
  draft.text = ''; draft.revision = 1; composer.syncReset();
  assert.equal(input.value, ''); assert.equal(composer.hasText, false);
  time.advance(1000); assert.equal(draft.text, '');
  composer.destroy();
});

test('leaving the session flushes its draft and locking cancels pending draft writes', () => {
  const time = clock(), input = new Input(), draft = { text: '' };
  const composer = new ComposerInput(input, draft, () => {}, time);
  input.type('Keep this when navigating back'); composer.destroy();
  assert.equal(draft.text, 'Keep this when navigating back');
  draft.text = ''; time.advance(1000);
  assert.equal(draft.text, '');
});

test('live updates coalesce after a typing pause without running inside the input handler', () => {
  const time = clock(); let renders = 0, latest = 0, rendered;
  const view = new LiveRender(() => { renders++; rendered = latest; }, time);
  view.interact(); latest = 1; view.request(); time.advance(100);
  view.interact(); latest = 2; view.request(); time.advance(100);
  view.interact(); latest = 3; view.request();
  assert.equal(renders, 0); time.advance(179); assert.equal(renders, 0);
  time.advance(1); assert.equal(renders, 1); assert.equal(rendered, 3);
  time.advance(1000); assert.equal(renders, 1);
});

test('continuous typing cannot starve permission updates; cancelled renders stay cancelled', () => {
  const time = clock(); let renders = 0;
  const view = new LiveRender(() => renders++, time);
  view.interact(); view.request();
  for (let i = 0; i < 9; i++) { time.advance(100); view.interact(); }
  time.advance(100); assert.equal(renders, 1);
  view.interact(); view.request(); view.cancel(); time.advance(1000);
  assert.equal(renders, 1);
  view.request(); assert.equal(renders, 1); time.advance(0); assert.equal(renders, 2);
});

test('default timers keep the browser global receiver for scheduling and cancellation', t => {
  const time = clock(), receivers = [];
  t.mock.method(globalThis, 'setTimeout', function (callback, delay) {
    receivers.push(this);
    return time.setTimer(callback, delay);
  });
  t.mock.method(globalThis, 'clearTimeout', function (timer) {
    receivers.push(this);
    time.clearTimer(timer);
  });
  try {
    const input = new Input(), draft = { text: '' };
    const composer = new ComposerInput(input, draft, () => {});
    input.type('First'); input.type('Latest'); time.advance(150);
    assert.equal(draft.text, 'Latest');
    input.type('Final'); composer.destroy();
    assert.equal(draft.text, 'Final');

    let renders = 0;
    const view = new LiveRender(() => renders++, { now: time.now });
    view.interact(); view.request(); time.advance(100);
    view.interact(); time.advance(180);
    assert.equal(renders, 1);
    view.request(); view.cancel(); time.advance(1000);
    assert.equal(renders, 1);
  } finally {
    t.mock.restoreAll();
  }
  assert.ok(receivers.length > 0);
  assert.ok(receivers.every(receiver => receiver === globalThis), 'browser timers must be called on the global object');
});
