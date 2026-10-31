// The captain's chair: what a click means from it and away from it, and the view that closes in on a screen. Pure.
import * as THREE from 'three';

const MARGIN = 1.15, NEAREST = .3;

// `hit` is what's under the click ({ kind: 'character' | 'screen' | 'shot' | 'chair' | 'floor' }, or null). A mouse not yet captured is
// captured by a click on nothing in particular, as in the office; the floor only walks you once you've left the chair.
export function clickAction(hit, { seated, zoomed, overview, locked, mouse }) {
  if (hit?.kind === 'shot' && !overview) return 'shots';
  if (zoomed) return 'back';
  if (hit?.kind === 'character') return 'talk';
  if (overview) return null;
  if (hit?.kind === 'screen') return 'zoom';
  if (hit?.kind === 'chair' && !seated) return 'sit';
  if (mouse && !locked) return 'capture';
  return hit?.kind === 'floor' && !seated ? 'walk' : null;
}
// The point on the view that's aimed at: the sight when the mouse is captured, and by touch, where there's no pointer to hover and looking
// around is how you point. The overview has no sight, so by touch nothing is aimed at there.
export const aimPoint = ({ aiming, touch, overview }, centre, mouse) => aiming || (touch && !overview) ? centre : touch ? null : mouse;
// E on what's aimed at: a click's meaning, but never to capture the mouse or walk you to the floor.
export function keyAction(hit, state) {
  const action = clickAction(hit, { ...state, mouse: false });
  return action === 'walk' ? null : action;
}

// Square in front of a screen's lit side, with all of it in view. `userData` has its width and height.
export function screenPose(mesh, fov, aspect) {
  const look = mesh.getWorldPosition(new THREE.Vector3()), facing = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  const tan = Math.tan(THREE.MathUtils.degToRad(fov) / 2), { width, height } = mesh.userData;
  const distance = Math.max(NEAREST, MARGIN * Math.max(height / 2 / tan, width / 2 / (tan * aspect)));
  return { position: look.clone().addScaledVector(facing, distance), look };
}
