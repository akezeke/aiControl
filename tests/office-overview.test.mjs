import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitOverview } from '../client/office/overview.js';

// Where the boxes' corners (floor and head height) land on screen, from a fitted view.
function extent(boxes, { look, distance }, fov, aspect) {
  const cam = new THREE.PerspectiveCamera(fov, aspect), pitch = 55 * Math.PI / 180;
  cam.position.copy(look).add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance)); cam.lookAt(look); cam.updateMatrixWorld();
  const points = boxes.flatMap(([x0, x1, z0, z1]) => [x0, x1].flatMap(x => [0, 2.2].flatMap(y => [z0, z1].map(z => new THREE.Vector3(x, y, z).project(cam)))));
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), bottom: Math.min(...points.map(p => p.y)), top: Math.max(...points.map(p => p.y)) };
}

test('the overview fits the pods snugly, centred, looking at the floor', () => {
  // Two rows; the front one shorter, so the box round them all would take in an empty corner.
  const boxes = [[1.3, 4.1, 1, 6.4], [8, 10.8, 1, 6.4], [14.7, 17.5, 1, 6.4], [1.3, 4.1, 6.5, 11.9], [8, 10.8, 6.5, 11.9]];
  for (const aspect of [1.31, 0.49, 2.2]) {
    const fit = fitOverview(boxes, 70, aspect), e = extent(boxes, fit, 70, aspect);
    assert.equal(fit.look.y, 0);
    assert.ok(Math.max(e.right, -e.left, e.top, -e.bottom) <= 0.931, `inside the margin at ${aspect}`);
    assert.ok(Math.max(e.right, -e.left, e.top, -e.bottom) > 0.92, `as close as fits at ${aspect}`);
    assert.ok(Math.abs(e.left + e.right) < 0.03 && Math.abs(e.top + e.bottom) < 0.03, `centred at ${aspect}`);
  }
});
