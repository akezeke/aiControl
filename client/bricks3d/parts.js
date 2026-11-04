import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STUD } from './bond.js';

// Muted plastic of a castle set, close to the colours of real castle-set bricks.
export const COLOURS = {
  stone: '#6b6d68', ashlar: '#9fa4a1', iron: '#2c2e31', navy: '#1c3d70', crimson: '#7d1d1a', forest: '#1f4d30', timber: '#5c3516',
  gold: '#b38a30', tan: '#cdbb8b', cream: '#e8dfc6', sand: '#d8c9a0',
};

const STUD_R = 6, STUD_H = 4.4;   // 4.8 mm over 1.7 mm at 2.5 px/mm
const cache = new Map();

// key 'w:h:d:s' = w studs wide (x), h px tall (y), d px deep (z), with studs (s) or smooth (t). Origin at the back, left, bottom corner.
export function geometryFor(key) {
  if (cache.has(key)) return cache.get(key);
  const [w, h, d, mode] = key.split(':'); const W = w * STUD, H = +h, D = +d;
  let body;
  if (mode === 'slope') {
    // A 1 x n sloped brick, extruded across its width; the top recedes to the back.
    const profile = new THREE.Shape(); profile.moveTo(0, 0); profile.lineTo(D, 0); profile.lineTo(D, H); profile.closePath();
    body = new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false }); body.rotateY(Math.PI / 2); body.translate(0, 0, D);
  } else if (mode === 'round') {
    body = new THREE.CylinderGeometry(Math.min(W, H) / 2, Math.min(W, H) / 2, D, 24); body.rotateX(Math.PI / 2); body.translate(W / 2, H / 2, D / 2);
  } else { body = new RoundedBoxGeometry(W, H, D, 2, Math.min(1.4, H / 4, D / 4)); body.translate(W / 2, H / 2, D / 2); }
  const parts = [body];
  if (mode === 'side') {
    for (let i = 0; i < w; i++) {
      const stud = new THREE.CylinderGeometry(STUD_R, STUD_R, 4, 24);
      stud.rotateX(Math.PI / 2); stud.translate((i + .5) * STUD, H / 2, D + 2); parts.push(stud);
    }
  }
  if (mode === 's') {
    const lathe = [[0, 0], [STUD_R, 0], [STUD_R, STUD_H - 1], [STUD_R - 1, STUD_H], [0, STUD_H]].map(([x, y]) => new THREE.Vector2(x, y));
    const rows = Math.max(1, Math.round(D / STUD));
    for (let i = 0; i < w; i++) for (let j = 0; j < rows; j++) {
      const stud = new THREE.LatheGeometry(lathe, 18); stud.translate((i + .5) * STUD, H, D - (j + .5) * STUD); parts.push(stud);
    }
  }
  // Merging needs the same attributes and indexing throughout.
  const flat = parts.map(part => { const g = part.index ? part.toNonIndexed() : part; for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name); return g; });
  const merged = flat.length > 1 ? mergeGeometries(flat, false) : flat[0];
  cache.set(key, merged); return merged;
}

export function plastic() {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .32, metalness: 0, clearcoat: .55, clearcoatRoughness: .28 });
}

export const colour = hex => new THREE.Color(hex);
