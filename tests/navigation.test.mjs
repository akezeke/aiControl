import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelNavigation } from '../client/navigation.js';

function browser(url = 'https://control.test/') {
  const listeners = new Map(), entries = [{ url: new URL(url), state: null }]; let index = 0;
  const value = { addEventListener(name, handler) { listeners.set(name, handler); }, get location() { return entries[index].url; } };
  const move = step => { const next = index + step; if (entries[next]) { index = next; listeners.get('popstate')?.(); } };
  value.history = {
    get state() { return entries[index].state; },
    pushState(state, _title, target) { entries.splice(index + 1); entries.push({ url: new URL(target, entries[index].url), state }); index++; },
    replaceState(state, _title, target) { entries[index] = { url: new URL(target, entries[index].url), state }; },
    back() { move(-1); }, forward() { move(1); },
  };
  return value;
}

test('phone/browser Back closes session details and Forward opens them again', () => {
  const window = browser(); let selected;
  const navigation = new PanelNavigation(window, id => { selected = id; });
  navigation.open('codex:a/b?c'); assert.equal(selected, 'codex:a/b?c');
  window.history.back(); assert.equal(selected, null); assert.equal(window.location.pathname, '/');
  window.history.forward(); assert.equal(selected, 'codex:a/b?c');
  navigation.close(); assert.equal(selected, null); assert.equal(window.location.hash, '');
});

test('Back from a directly linked detail view stays in the dashboard', () => {
  const window = browser('https://control.test/#session=claude%3A123'); let selected;
  const navigation = new PanelNavigation(window, id => { selected = id; });
  navigation.sync(); assert.equal(selected, 'claude:123');
  navigation.close(); assert.equal(selected, null); assert.equal(window.location.hash, '');
  navigation.open('access'); navigation.reset(); assert.equal(window.location.hash, '');
});
