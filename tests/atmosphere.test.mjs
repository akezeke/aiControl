import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtmosphere } from '../client/atmosphere.js';

const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('atmosphere remembers each theme independently across reloads', () => {
  const storage = memory(), first = createAtmosphere({ storage });
  assert.ok(first, 'Atmosphere preferences are available');
  first.selectTheme('alien'); first.set('still');
  first.selectTheme('heroes'); first.set('subtle');
  const reload = createAtmosphere({ storage });
  reload.selectTheme('alien'); assert.equal(reload.preference(), 'still');
  reload.selectTheme('heroes'); assert.equal(reload.preference(), 'subtle');
  reload.selectTheme('command'); assert.equal(reload.preference(), 'full');
});

test('reduced motion overrides the effective atmosphere without losing the saved choice', () => {
  const preference = createAtmosphere({ storage: memory() });
  assert.ok(preference, 'Atmosphere preferences are available');
  const changes = [], stop = preference.subscribe(value => changes.push(value));
  preference.selectTheme('office'); preference.set('subtle');
  preference.reduce(true); assert.equal(preference.effective(), 'still');
  assert.equal(preference.preference(), 'subtle');
  preference.reduce(false); assert.equal(preference.effective(), 'subtle');
  assert.deepEqual(changes, ['subtle', 'still', 'subtle']);
  stop(); preference.set('full'); assert.equal(changes.length, 3);
});

test('blocked storage keeps atmosphere usable within the tab', () => {
  const preference = createAtmosphere({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
  assert.ok(preference, 'Atmosphere preferences are available');
  preference.selectTheme('alien'); preference.set('still');
  preference.selectTheme('heroes'); preference.set('subtle');
  preference.selectTheme('alien'); assert.equal(preference.effective(), 'still');
});

test('system override changes notify controls even when the saved theme is already still', () => {
  const preference = createAtmosphere({ storage: memory() });
  preference.selectTheme('alien'); preference.set('still');
  const changes = []; preference.subscribe(value => changes.push(value));
  preference.reduce(true); preference.reduce(false);
  assert.deepEqual(changes, ['still', 'still']);
});

test('malformed atmosphere preferences and invalid choices use safe defaults', () => {
  for (const raw of ['null', '[]', 'oops', '{"alien":"broken","heroes":"subtle"}']) {
    const preference = createAtmosphere({ storage: { getItem: () => raw, setItem() {} } });
    assert.ok(preference, 'Atmosphere preferences are available');
    preference.selectTheme('alien'); assert.equal(preference.preference(), 'full');
    preference.set('broken'); assert.equal(preference.effective(), 'full');
    preference.selectTheme('heroes'); assert.equal(preference.preference(), raw.includes('subtle') ? 'subtle' : 'full');
  }
});
