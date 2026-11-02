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
  // Points are matched to 0.1 mm, hashed to a number (strings were most of the load-time cost), checked against the bucket.
  const { position, normal } = geometry.attributes, buckets = new Map(), of = [], n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const x = Math.round(position.getX(i) * 1e4), y = Math.round(position.getY(i) * 1e4), z = Math.round(position.getZ(i) * 1e4);
    const hash = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791), bucket = buckets.get(hash);
    let point = bucket?.find(p => p.x === x && p.y === y && p.z === z);
    if (!point) { point = { x, y, z, normals: [], sum: new THREE.Vector3() }; if (bucket) bucket.push(point); else buckets.set(hash, [point]); }
    n.fromBufferAttribute(normal, i);
    if (!point.normals.some(m => m.dot(n) > 0.999)) { point.normals.push(n.clone()); point.sum.add(n); }
    of.push(point);
  }
  for (const bucket of buckets.values()) for (const point of bucket) point.sum = point.sum.lengthSq() > 1e-8 ? point.sum.normalize() : null;
  const out = new Float32Array(position.count * 3);
  of.forEach((point, i) => (point.sum ?? n.fromBufferAttribute(normal, i)).toArray(out, i * 3));
  geometry.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
}
const outlines = new Map(), INK = '#1b1a1f', HOVER = '#4f7cff', ink = { value: new THREE.Color(INK) }, shown = { value: 1 };
// Outlines on everything, or only on what's hovered or picked: the plain ink ones are hidden then, and an instanced hull's
// ink copies collapse to a point in its shader.
export function showOutlines(on) {
  shown.value = on ? 1 : 0;
  for (const material of outlines.values()) if (material.userData.ink) material.visible = on;
}
function outlineMaterial(thickness, color = INK) {
  const key = `${thickness}:${color}`;
  if (outlines.has(key)) return outlines.get(key);
  // The thickness is a uniform, so every outline (and hover's thicker ones) shares one shader: no compile on a first hover.
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, visible: color !== INK || !!shown.value }), uniform = { value: thickness };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { outlineThickness: uniform, outlineShown: shown, outlineInk: ink });
    shader.vertexShader = `attribute vec3 outlineNormal;\nuniform float outlineThickness, outlineShown;\nuniform vec3 outlineInk;\n${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
transformed += normalize(outlineNormal) * outlineThickness;
#ifdef USE_INSTANCING_COLOR
if (outlineShown < 0.5 && distance(instanceColor, outlineInk) < 0.01) transformed = vec3(0.0);
#endif`)}`;
  };
  material.customProgramCacheKey = () => 'outline';
  Object.assign(material.userData, { thickness, ink: color === INK });
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
// Hover: everything outlined under `root` gets a thicker blue outline (or `color`); off puts the usual one back.
export function highlight(root, on, color = HOVER) {
  root?.traverse(node => {
    if (!node.userData.outline) return;
    node.userData.plain ??= node.material;
    node.material = on ? outlineMaterial(node.userData.plain.userData.thickness * 1.5, color) : node.userData.plain;
  });
}
// An instanced mesh's outline: another instanced mesh sharing its instances, coloured per instance, so `light(i, on)` can
// outline one copy blue for hover (the same thickness, though).
export function instancedOutline(mesh, thickness = 0.009) {
  outlineNormals(mesh.geometry);
  const hull = new THREE.InstancedMesh(mesh.geometry, outlineMaterial(thickness, '#ffffff'), mesh.count);
  hull.instanceMatrix = mesh.instanceMatrix; hull.raycast = () => {};
  for (let i = 0; i < mesh.count; i++) hull.setColorAt(i, ink.value);
  hull.light = (i, on) => { hull.setColorAt(i, on ? new THREE.Color(HOVER) : ink.value); hull.instanceColor.needsUpdate = true; };
  mesh.add(hull);
  return hull;
}

// Shared materials and geometries live for the whole page; the office's unmount disposes GPU copies, which three re-uploads if used again.
export function clearToonCache() { materials.clear(); outlines.clear(); ramp = undefined; }
