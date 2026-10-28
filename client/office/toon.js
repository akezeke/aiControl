// Shared cartoon look: soft three-band toon shading and inverted-hull outlines.
import * as THREE from 'three';

let ramp;
const materials = new Map();
export function toonMaterial(color, options = {}) {
  ramp ??= Object.assign(new THREE.DataTexture(new Uint8Array([105, 185, 255]), 3, 1, THREE.RedFormat), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, needsUpdate: true });
  const key = Object.keys(options).length ? null : color;
  if (key && materials.has(key)) return materials.get(key);
  const material = new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...options });
  if (key) materials.set(key, material);
  return material;
}

// The hull is pushed out along normals in the shader, so it works on any smooth mesh, not just ones centred on their origin.
const outlines = new Map();
function outlineMaterial(thickness) {
  if (outlines.has(thickness)) return outlines.get(thickness);
  const material = new THREE.MeshBasicMaterial({ color: '#1b1a1f', side: THREE.BackSide });
  material.onBeforeCompile = shader => { shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(4)};`); };
  material.customProgramCacheKey = () => `outline-${thickness}`;
  outlines.set(thickness, material);
  return material;
}
export function withOutline(mesh, thickness = 0.012) {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  hull.userData.outline = true; hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

// Shared materials and geometries live for the whole page; the office's unmount disposes GPU copies, which three re-uploads if used again.
export function clearToonCache() { materials.clear(); outlines.clear(); ramp = undefined; }
