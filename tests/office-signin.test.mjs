import test from 'node:test';
import assert from 'node:assert/strict';
import { slipMode } from '../client/office/signin.js';

test('the slip: a form to join, Leave whenever you are in a meeting', () => {
  assert.deepEqual(slipMode(null), { form: true, signOut: false, said: '' });
  assert.deepEqual(slipMode({ joined: false }), { form: true, signOut: false, said: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h' }), { form: false, signOut: true, said: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', offline: true }), { form: false, signOut: true, said: 'Off for now' });
  // A replaced code: join again with the new one, or leave this meeting for good.
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', error: 'code' }), { form: true, signOut: true, said: 'The code was changed' });
});
