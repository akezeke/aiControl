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

// The hull is pushed out along normals in the shader, so it works on any mesh, not just ones centred on their origin.
// Hard edges (cylinder caps, cone tips, seams) give one point several normals, which would tear the hull open there,
// so it's pushed along the average of the distinct normals at each point instead.
function outlineNormals(geometry) {
  if (geometry.attributes.outlineNormal) return;
  const { position, normal } = geometry.attributes, at = new Map(), keys = [], n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1e4)).join();
    const seen = at.get(key) || at.set(key, []).get(key);
    n.fromBufferAttribute(normal, i);
    if (!seen.some(m => m.dot(n) > 0.999)) seen.push(n.clone());
    keys.push(key);
  }
  const out = new Float32Array(position.count * 3);
  keys.forEach((key, i) => {
    const sum = at.get(key).reduce((total, m) => total.add(m), new THREE.Vector3());
    (sum.lengthSq() > 1e-8 ? sum.normalize() : n.fromBufferAttribute(normal, i)).toArray(out, i * 3);
  });
  geometry.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
}
const outlines = new Map();
function outlineMaterial(thickness, color = '#1b1a1f') {
  const key = `${thickness}:${color}`;
  if (outlines.has(key)) return outlines.get(key);
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  material.onBeforeCompile = shader => { shader.vertexShader = `attribute vec3 outlineNormal;\n${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(outlineNormal) * ${thickness.toFixed(4)};`)}`; };
  material.customProgramCacheKey = () => `outline-${thickness}`;
  material.userData.thickness = thickness;
  outlines.set(key, material);
  return material;
}
export function withOutline(mesh, thickness = 0.009) {
  outlineNormals(mesh.geometry);
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  hull.userData.outline = true; hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}
// Hover: everything outlined under `root` gets a thicker blue outline; off puts the usual one back.
export function highlight(root, on) {
  root?.traverse(node => {
    if (!node.userData.outline) return;
    node.userData.plain ??= node.material;
    node.material = on ? outlineMaterial(node.userData.plain.userData.thickness * 1.5, HOVER) : node.userData.plain;
  });
}
const INK = new THREE.Color('#1b1a1f'), HOVER = '#4f7cff';
// An instanced mesh's outline: another instanced mesh sharing its instances, coloured per instance, so `light(i, on)` can
// outline one copy blue for hover (the same thickness, though).
export function instancedOutline(mesh, thickness = 0.009) {
  outlineNormals(mesh.geometry);
  const hull = new THREE.InstancedMesh(mesh.geometry, outlineMaterial(thickness, '#ffffff'), mesh.count);
  hull.instanceMatrix = mesh.instanceMatrix; hull.raycast = () => {};
  for (let i = 0; i < mesh.count; i++) hull.setColorAt(i, INK);
  hull.light = (i, on) => { hull.setColorAt(i, on ? new THREE.Color(HOVER) : INK); hull.instanceColor.needsUpdate = true; };
  mesh.add(hull);
  return hull;
}

// Shared materials and geometries live for the whole page; the office's unmount disposes GPU copies, which three re-uploads if used again.
export function clearToonCache() { materials.clear(); outlines.clear(); ramp = undefined; }
