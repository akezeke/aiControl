import test from 'node:test';
import assert from 'node:assert/strict';
import { slipMode } from '../client/office/signin.js';

test('the slip: a form to sign in, Sign out whenever you are joined', () => {
  assert.deepEqual(slipMode(null), { form: true, signOut: false, said: '' });
  assert.deepEqual(slipMode({ joined: false }), { form: true, signOut: false, said: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h' }), { form: false, signOut: true, said: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', offline: true }), { form: false, signOut: true, said: 'Hub closed' });
  // A replaced code: sign in again with the new one, or leave this hub for good.
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', error: 'code' }), { form: true, signOut: true, said: 'Code replaced' });
});
