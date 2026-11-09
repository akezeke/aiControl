import test from 'node:test';
import assert from 'node:assert/strict';
import { wideFov } from '../client/office/camera.js';

const across = (fov, aspect) => 2 * Math.atan(Math.tan(fov * Math.PI / 360) * aspect) * 180 / Math.PI;

test('a narrow screen sees as much across as a landscape one, up to the widest the view goes', () => {
  assert.equal(wideFov(70, 16 / 9), 70); assert.ok(Math.abs(wideFov(70, 1.6) - 70) < 1e-9);
  assert.equal(wideFov(70, 390 / 788), 95); // a phone held upright
  for (const aspect of [1.2, 1.4]) assert.ok(Math.abs(across(wideFov(70, aspect), aspect) - across(70, 1.6)) < 1e-9, `at ${aspect}`);
  for (let aspect = 0.4; aspect < 2; aspect += 0.1) assert.ok(wideFov(70, aspect) >= wideFov(70, aspect + 0.1), 'narrower is never less');
  assert.equal(wideFov(52, 390 / 736, 80), 80); // the trickshot's
});
