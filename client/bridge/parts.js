import * as THREE from 'three';

// Building blocks shared by the room and the view outside.
export const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// A box with chamfered edges, flat-shaded by being unindexed. The chamfer can't take more than the plate is thick, or it would turn inside out.
export function plate(w, h, d, x = 0, y = 0, z = 0, bevel = .012) {
  const b = Math.min(bevel, d * .4), shape = new THREE.Shape(), hw = w / 2 - b, hh = h / 2 - b; shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: d - 2 * b, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 }).translate(x, y, z - d / 2 + b);
}
export function add(geometry, material, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh);
  return mesh;
}
export const STD = (color, roughness = .8, metalness = .05, extra = {}) => new THREE.MeshStandardMaterial({ color: C(color), roughness, metalness, ...extra });
export const lit = (color, k = 1) => new THREE.MeshBasicMaterial({ color: C(color, k) });
export function canvas(w, h, draw) {
  const el = document.createElement('canvas'); el.width = w; el.height = h;
  draw?.(el.getContext('2d'), w, h);
  return el;
}
export function canvasTexture(el, srgb = true) {
  const texture = new THREE.CanvasTexture(el);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export function seeded(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
