// Targeting brackets: four thick corners round whatever you can use, on the sight's plane. A dark edge keeps them readable on anything,
// pale walls and lit screens included. One colour in every palette, and not one a signal uses, so they never read as a session's state.
import * as THREE from 'three';

const AWAY = .5, ARM = 30, THICK = 6, EDGE = 2, OUT = 8, INSET = 6, NEAR_SLICE = 1e-4, COLOUR = '#c6ff2e', BACKING = '#04060f';
const clamp = value => THREE.MathUtils.clamp(value, -1, 1);

// A single mesh's own box, carried into the world, so corners sit on a display that stands at an angle; anything in parts gets the box round it.
export const boxCorners = object => {
  const single = object.isMesh && !object.children.length;
  if (single && !object.geometry.boundingBox) object.geometry.computeBoundingBox();
  const { min, max } = single ? object.geometry.boundingBox : new THREE.Box3().setFromObject(object), out = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) { const corner = new THREE.Vector3(x, y, z); out.push(single ? object.localToWorld(corner) : corner); }
  return out;
};
// Where a rectangle on a plane's canvas (W by H, y running down) is in the world: a list row, a picture on a display.
export const rectCorners = (mesh, { x, y, w, h }, W, H) => {
  const { width, height } = mesh.geometry.parameters;
  return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([cx, cy]) => mesh.localToWorld(new THREE.Vector3((cx / W - .5) * width, (.5 - cy / H) * height, 0)));
};

// The corners' extent on screen, from -1 to 1 each way; null if none of it is in view. A box that reaches behind you is cut at the near
// plane, as a point behind the camera projects to the wrong side. The camera's matrices should be up to date.
export function bracketsFor(corners, camera) {
  const near = -camera.near - NEAR_SLICE, local = corners.map(corner => corner.clone().applyMatrix4(camera.matrixWorldInverse));
  const ahead = local.filter(({ z }) => z <= near); if (!ahead.length) return null;
  const points = [...ahead];
  for (const from of ahead) for (const to of local) if (to.z > near) points.push(from.clone().lerp(to, (near - from.z) / (to.z - from.z)));
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const point of points) {
    point.applyMatrix4(camera.projectionMatrix);
    left = Math.min(left, point.x); right = Math.max(right, point.x); bottom = Math.min(bottom, point.y); top = Math.max(top, point.y);
  }
  if (left > 1 || right < -1 || bottom > 1 || top < -1) return null;
  return { left: clamp(left), right: clamp(right), bottom: clamp(bottom), top: clamp(top) };
}

// The brackets' outer corners and arm lengths in pixels from the middle of a view: just outside the thing, but always on screen,
// and with arms short enough on something small that they don't close into a box.
export function bracketFrame(extent, width, height) {
  const fit = (value, half) => THREE.MathUtils.clamp(value * half + Math.sign(value || 1) * OUT, -half + INSET, half - INSET);
  const left = fit(extent.left, width / 2), right = fit(extent.right, width / 2), bottom = fit(extent.bottom, height / 2), top = fit(extent.top, height / 2);
  return { left, right, bottom, top, armX: Math.min(ARM, (right - left) * .4), armY: Math.min(ARM, (top - bottom) * .4) };
}

export function createBrackets(camera) {
  const group = new THREE.Group(); group.position.z = -AWAY; group.visible = false; group.renderOrder = 19; camera.add(group);
  const face = new THREE.MeshBasicMaterial({ color: COLOUR, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const backing = new THREE.MeshBasicMaterial({ color: BACKING, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }), plane = new THREE.PlaneGeometry(1, 1);
  const bar = (material, order) => { const mesh = new THREE.Mesh(plane, material); mesh.renderOrder = order; group.add(mesh); return mesh; };
  // A corner's two arms, each [which way across, which way up]. Backings all go first, so one arm's edge can't cut across the other arm.
  const arms = [[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(corner => [true, false].map(along => ({ under: bar(backing, 19), over: bar(face, 20), corner, along })));
  let corners = null;
  return {
    // A thing, or the corners of part of one. Also called a few times a second with the same thing, as a figure's pose changes its outline.
    aim(aimed) { corners = Array.isArray(aimed) ? aimed : aimed && boxCorners(aimed); },
    tick(height) {
      camera.updateMatrixWorld();
      const out = corners && bracketsFor(corners, camera); group.visible = !!out; if (!out) return;
      const halfY = AWAY * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), px = 2 * halfY / height, frame = bracketFrame(out, height * camera.aspect, height);
      for (const { under, over, corner: [cx, cy], along } of arms) {
        const x = (cx < 0 ? frame.left : frame.right) * px, y = (cy < 0 ? frame.bottom : frame.top) * px, reach = (along ? frame.armX : frame.armY) * px, thick = THICK * px;
        const place = (mesh, grow) => {
          mesh.scale.set(((along ? reach : thick) + grow), ((along ? thick : reach) + grow), 1);
          mesh.position.set(x - cx * (along ? reach : thick) / 2, y - cy * (along ? thick : reach) / 2, 0);
        };
        place(under, 2 * EDGE * px); place(over, 0);
      }
    },
  };
}
