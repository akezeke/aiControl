import test from 'node:test';
import assert from 'node:assert/strict';
import { slipMode } from '../client/office/signin.js';

test('the slip: a form to join, Leave whenever you are in a meeting', () => {
  assert.deepEqual(slipMode(null), { form: true, signOut: false, said: '', code: '' });
  assert.deepEqual(slipMode({ joined: false }), { form: true, signOut: false, said: '', code: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h' }), { form: false, signOut: true, said: '', code: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', offline: true }), { form: false, signOut: true, said: 'Off for now', code: '' });
  // A replaced code: join again with the new one, or leave this meeting for good.
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', error: 'code' }), { form: true, signOut: true, said: 'The code was changed', code: '' });
});

test('the meeting code shows only for a host that has one', () => {
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', hosting: true, code: 'h/abc' }).code, 'h/abc');
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', hosting: false, code: 'h/abc' }).code, '');
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', hosting: true }).code, '');
  assert.equal(slipMode(null).code, '');
});
