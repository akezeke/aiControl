// The office's light: fill and daylight, the ceiling lamps, and the monitors' glow. The switch by the door dims the room
// (each browser remembers it); dimmed, the screens light their desks and sitters in their colour.
import * as THREE from 'three';
import { mesh, rounded } from './furniture.js';
import { toonMaterial } from './toon.js';

const KEY = 'office-lights', DIM = 0.2; // the share of its brightness a dimmed board, sign or clock keeps
// The screens' light is a fixed pool of spot lights on the nearest lit desks: adding lights would recompile every material.
const SCREENS = 8, SCREEN_POWER = 1.6, SCREEN_LIT = 0.3; // the share they keep while the room lights are on
// Each screen tone's light, a whiter shade of its accent, and how bright.
const tones = { green: ['#a4f2c2', 1], amber: ['#ffd496', 1], red: ['#ffa3a3', 1], dark: ['#aebcd8', 0.45] };

// Marks what the switch dims (a light's intensity, a material's colour or opacity) and how much of it stays.
export function dims(target, keep = DIM, what = target.isLight ? 'intensity' : 'color') {
  target.userData.lit = { what, keep, value: what === 'color' ? target.color.clone() : target[what] };
  return target;
}

// `beam`: where a desk's screen light sits and what it points at, in the desk's frame.
export function createLights(root, beam) {
  const sun = dims(new THREE.DirectionalLight('#fff8ee', 0.55), 0.2); sun.position.set(-2, 6, -7);
  root.add(dims(new THREE.HemisphereLight('#f6f4ff', '#5d6575', 0.6), 0.25), sun);
  const pool = Array.from({ length: SCREENS }, () => {
    // A soft, wide cone that fades slowly, like a lit panel rather than a bulb.
    const light = new THREE.SpotLight('#ffffff', 0, 2.5, 1.35, 1, 1); root.add(light, light.target);
    return { light, desk: null, on: false, level: 0, strength: 0 };
  });
  let on = true, level = -1, stale = true, assignIn = 0, rocker = null, led = null;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch {}

  const apply = () => root.traverse(node => {
    for (const target of [node, ...[node.material].flat()]) {
      const lit = target?.userData.lit; if (!lit) continue;
      const k = lit.keep + (1 - lit.keep) * level;
      // Colours are linear, so a keep is raised to 2.2 to read as that share of the brightness on screen.
      if (lit.what === 'color') target.color.copy(lit.value).multiplyScalar(k ** 2.2); else target[lit.what] = lit.value * k;
    }
  });
  const show = () => { if (rocker) { rocker.rotation.x = on ? -0.22 : 0.22; led.color.set(on ? '#6b6358' : '#ffb23e'); } };

  const lights = {
    get on() { return on; },
    toggle() { on = !on; show(); try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {} },
    // Something new (a sign, a rebuilt shell) may need dimming.
    refresh() { stale = true; },
    // A rocker switch with a locator light that glows while the lights are off; clicking it (userData.toggle) flips them.
    createSwitch() {
      const group = new THREE.Group();
      group.add(mesh(rounded(0.13, 0.2, 0.016, 0.006), toonMaterial('#f4f2ec'), 0.005));
      rocker = mesh(rounded(0.056, 0.1, 0.026, 0.008), toonMaterial('#e6e3da'), 0.005); rocker.position.z = 0.01; group.add(rocker);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.007, 12), new THREE.MeshBasicMaterial()); dot.position.set(0, -0.032, 0.0135); rocker.add(dot); led = dot.material;
      group.userData.toggle = () => lights.toggle();
      show();
      return group;
    },
    // Each frame: the switch's level, then the screen lights on the desks nearest `eye`.
    update(dt, eye, still, desks) {
      dt = Math.max(0, dt); // the first frame's dt can be negative (its timestamp predates the loop starting)
      const next = +on;
      if (next !== level || (stale && level < 1)) { level = next; apply(); }
      stale = false;
      if ((assignIn -= dt) <= 0) {
        assignIn = 0.25;
        const near = [...desks].filter(desk => tones[desk.glow]).sort((a, b) => a.group.position.distanceToSquared(eye) - b.group.position.distanceToSquared(eye)).slice(0, SCREENS);
        for (const slot of pool) slot.on = near.includes(slot.desk);
        for (const desk of near) {
          if (pool.some(slot => slot.desk === desk)) continue;
          const slot = pool.find(slot => !slot.on && slot.level < 0.02); if (!slot) break;
          slot.desk = desk; slot.on = true;
        }
        // Desks move when the layout does, and screens change colour.
        for (const slot of pool) {
          if (!slot.desk) continue;
          slot.light.position.copy(beam.from).applyMatrix4(slot.desk.group.matrixWorld);
          slot.light.target.position.copy(beam.to).applyMatrix4(slot.desk.group.matrixWorld); slot.light.target.updateMatrixWorld();
          const tone = tones[slot.desk.glow]; if (tone) { slot.light.color.set(tone[0]); slot.strength = tone[1]; }
        }
      }
      const share = SCREEN_LIT + (1 - SCREEN_LIT) * (1 - level);
      for (const slot of pool) {
        slot.level = still ? +slot.on : THREE.MathUtils.clamp(slot.level + (slot.on ? dt : -dt) * 4, 0, 1);
        slot.light.intensity = slot.level * slot.strength * SCREEN_POWER * share;
      }
    },
  };
  return lights;
}
