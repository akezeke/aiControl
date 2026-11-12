import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// createPlanes builds its stick out of the page: a bare element will do here.
const element = () => ({ style: {}, classList: { toggle() {} }, appendChild() {} });
globalThis.document ??= { createElement: element };
const { createPlanes } = await import('../client/office/planes.js');

// A plain 10 m room, the paper stack by the right wall facing into it.
function planes(endless) {
  const stack = new THREE.Object3D(); stack.position.set(9, 1, 5); stack.rotation.y = -Math.PI / 2;
  const box = (a, b) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b));
  const walls = [box([-0.2, 0, 0], [0, 3, 10]), box([10, 0, 0], [10.2, 3, 10]), box([0, 0, -0.2], [10, 3, 0]), box([0, 0, 10], [10, 3, 10.2])];
  const p = createPlanes({ canvas: { addEventListener() {}, parentElement: null }, home: () => stack, grid: () => null, endless, score() {},
    world: () => ({ boxes: walls, columns: [], people: [], width: 10, depth: 10 }) });
  p.enter(); return p;
}

// The room's walls and ceiling are see-through (to fade out of the way of the overview) and write depth, and three.js draws
// see-through things farthest middle first: a wall whose middle is nearer than a ring would be drawn after it, over it.
test("the rings, their film, the way round and the trail draw after the room's see-through walls and ceiling", () => {
  for (const endless of [false, true]) {
    const drawn = []; planes(endless).root.traverse(n => { if (n.material?.transparent) drawn.push(n); });
    assert.ok(drawn.filter(n => n.geometry?.type === 'TorusGeometry').length >= 3, 'rings laid');
    for (const n of drawn) assert.ok(n.renderOrder > 0, `${n.type} ${n.geometry?.type}`);
  }
});
