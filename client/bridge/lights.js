import * as THREE from 'three';
import { CENTER } from './deck.js';
import { C } from './parts.js';

// three's physical lights divide by pi where the study's older renderer did not.
export const LIGHT_SCALE = Math.PI;
const RED = C('#ff2a1a'), WARM = C('#eef1ff'), LAMP = C('#f4f6ff'), RECESS = C('#f2f5ff'), VIEW = C('#dfe6ff'), DULL = C('#40120c');
const AMBIENT = { limit: C('#b0463a'), hail: C('#e4e6f4'), calm: C('#f2f4ff') };
// The floor rings move only because agents are at work.
export const chaseSpeed = w => w * 1.85;

// Dim overall: the colour comes from the room's own lamps, and all of it turns red with the room.
export function createLights(world, glow, still = false) {
  const group = new THREE.Group(); group.position.set(CENTER, 0, CENTER); world.add(group);
  const point = (intensity, distance, decay, x, y, z) => { const light = new THREE.PointLight(0xffffff, intensity * LIGHT_SCALE, distance, decay); light.position.set(x, y, z); group.add(light); return light; };
  // Brighter from above than below, which is what gives flat-shaded plates their shape.
  const ambient = new THREE.HemisphereLight(0xffffff, 0x000000, 1); group.add(ambient);
  const ring = point(1, 10, 1.1, 0, 3.5, 0), view = point(1, 6, 1.4, 0, 2, -3.4), left = point(.9, 4.5, 1.4, -3.1, 2.6, 0), right = point(.9, 4.5, 1.4, 3.1, 2.6, 0);
  const tmp = new THREE.Color();
  let palette = null, neon = new THREE.Color(), hail = false, limit = false;
  return {
    setMotion(value) { still = value; },
    setMode(state) { hail = state.mode === 'hail'; limit = state.mode === 'limit'; },
    repaint(next) { palette = next; neon = C(next.neon); },
    tick(dt, t, space) {
      const pulse = still ? 1 : .5 + .5 * Math.sin(t * 3.4), { warpLevel: w } = space;
      ambient.color.copy(limit ? AMBIENT.limit : hail ? AMBIENT.hail : AMBIENT.calm); ambient.groundColor.copy(ambient.color).multiplyScalar(.55); ambient.intensity = (limit ? .26 : palette.ambient) * 1.3 * LIGHT_SCALE;
      // A hail is told by the strips and the lamps; washing the whole room red turns the pale palette salmon and the crew tan.
      ring.color.copy(limit ? RED : hail ? tmp.copy(WARM).lerp(RED, .08 + pulse * .12) : WARM); ring.intensity = (limit ? .4 : hail ? 1.1 : 1.25) * LIGHT_SCALE;
      view.color.copy(hail ? tmp.copy(VIEW).lerp(RED, .35) : VIEW); view.intensity = (limit ? .08 : .6 + w * .4) * LIGHT_SCALE;
      glow.neon.color.copy(limit || hail ? RED : neon).multiplyScalar(limit ? .2 : hail ? .5 + pulse * 1.6 : 1.9);
      glow.chase.color.copy(glow.neon.color); glow.rib.color.copy(glow.neon.color).multiplyScalar(.16); glow.ring.color.copy(glow.neon.color).multiplyScalar(.14);
      left.color.copy(glow.neon.color).multiplyScalar(hail ? .22 : .6); right.color.copy(left.color);
      left.intensity = right.intensity = (limit ? .05 : .9) * LIGHT_SCALE;
      if (!still) glow.chaseMap.offset.x -= dt * chaseSpeed(w);
      glow.lamp.color.copy(limit ? RED : hail ? tmp.copy(WARM).lerp(RED, .6) : LAMP).multiplyScalar(limit ? .22 : hail ? .6 + pulse * .4 : 1);
      glow.recess.color.copy(limit ? RED : hail ? tmp.copy(RECESS).lerp(RED, .65) : RECESS).multiplyScalar(limit ? .2 : hail ? .35 + pulse : 1.35);
      glow.edge.color.copy(hail ? RED : limit ? DULL : neon).multiplyScalar(hail ? .4 + pulse * 1.5 : limit ? 1 : 1.7);
      glow.glass.color.setScalar(limit ? .4 : 1);
    },
  };
}
