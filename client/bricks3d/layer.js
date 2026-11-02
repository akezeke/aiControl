import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { geometryFor, plastic, colour } from './parts.js';

// One scene, one camera. World units are CSS pixels: x right, y up (so a DOM point (x, y) is world (x, -y)), z out of the wall toward the viewer, the wall's
// front at z = 0. The camera looks straight at the wall from `D` px away, above the top of the screen, through an off-axis frustum, so the wall plane
// still maps 1:1 onto the viewport while everything standing out of it shows its top (and a little of a side) with real perspective. Nothing is
// compensated per element: scrolling a region just moves its bricks under the fixed camera, and the parallax comes with it.
export const DISTANCE = 1800, LIFT = .35;

export function webglAvailable() {
  try { const canvas = document.createElement('canvas'); return !!(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; }
}

// Instanced bricks, one mesh per (geometry, group), grown as needed.
class Pool {
  constructor(parent, key, material, depth) {
    this.parent = parent; this.key = key; this.material = material; this.depth = depth; this.count = 0; this.cap = 0; this.make(128);
  }
  make(cap) {
    const old = this.mesh;
    this.mesh = new THREE.InstancedMesh(geometryFor(this.key), this.material, cap);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.customDepthMaterial = this.depth;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (old) { this.mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.count * 16)); this.mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, this.count * 3)); this.parent.remove(old); old.dispose(); }
    this.cap = cap; this.mesh.count = this.count; this.parent.add(this.mesh);
  }
  add(matrix, color) {
    if (this.count === this.cap) this.make(this.cap * 2);
    this.mesh.setMatrixAt(this.count, matrix); this.mesh.setColorAt(this.count, color); return this.count++;
  }
  commit() { this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
  clear() { this.count = 0; this.mesh.count = 0; }
}

const STICKER = new THREE.PlaneGeometry(1, 1);

export class BrickLayer {
  constructor(canvas) {
    this.canvas = canvas; this.size = { width: 0, height: 0 }; this.pools = new Map(); this.frame = 0; this.shadowDirty = true; this.tweens = new Set();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0); this.depths = {}; this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap; this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene(); this.material = plastic();
    const pmrem = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; this.scene.environmentIntensity = .22; pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x2a2c31, .22));
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.8); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -.0004; this.sun.shadow.normalBias = .6; this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.groups = {}; this.clips = {};
    this.camera = new THREE.PerspectiveCamera(); this.camera.matrixAutoUpdate = true; this.eye = { x: 0, y: 0 }; this.stickers = [];
  }
  // `eye` is where the camera is in this layer's pixels (x across, y down from the layer's top, which may be above it); the page's and the panel's layers
  // share one camera, so the panel passes the page's eye in its own coordinates.
  resize(width, height, eye = { x: width / 2, y: -LIFT * height }, ratio = Math.min(devicePixelRatio || 1, 2)) {
    this.size = { width, height }; this.eye = eye; this.renderer.setPixelRatio(ratio); this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
    const near = DISTANCE - 400, far = DISTANCE + 400, k = near / DISTANCE, cam = this.camera;
    cam.position.set(eye.x, -eye.y, DISTANCE); cam.rotation.set(0, 0, 0); cam.updateMatrixWorld(true);
    cam.projectionMatrix.makePerspective((0 - eye.x) * k, (width - eye.x) * k, eye.y * k, (eye.y - height) * k, near, far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const reach = Math.max(width, height) * .95, shadow = this.sun.shadow.camera;
    this.sun.target.position.set(width / 2, -height / 2, 0); this.sun.position.set(width / 2 - reach * .45, -height / 2 + reach * .75, reach); shadow.left = -reach; shadow.right = reach; shadow.top = reach; shadow.bottom = -reach; shadow.near = 1; shadow.far = reach * 4; shadow.updateProjectionMatrix();
    this.shadowDirty = true; this.invalidate();
  }
  // A group moves as one: a scrolling region's bricks, optionally clipped to the region's box (x, y, w, h in CSS pixels from the top left).
  group(name) {
    if (!this.groups[name]) { this.groups[name] = new THREE.Group(); this.scene.add(this.groups[name]); }
    return this.groups[name];
  }
  scrollGroup(name, y, clip) {
    this.group(name).position.y = y;
    if (clip !== undefined) {
      this.clips[name] = clip;
      // What is scrolled out of the region is clipped on screen, so it must not cast its shadow into what is on screen either. The camera is above, so what
      // stands out of the wall is drawn lower than where it is: at the top edge a brick's world position can lie up to 24 px above the box.
      const bounds = this.depthFor(name).userData.bounds; bounds.value.set(clip.x - 24, -(clip.y + clip.h), clip.x + clip.w + 24, -clip.y + 24);
    }
    this.shadowDirty = true; this.invalidate();
  }
  // The shadow material of a group: depth, but discarding whatever lies outside the group's bounds (x0, y0, x1, y1 in world pixels; unbounded until it scrolls).
  depthFor(name) {
    if (this.depths[name]) return this.depths[name];
    const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), bounds = { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) };
    material.userData.bounds = bounds; material.customProgramCacheKey = () => `bounds-${name}`;   // one program each, or only the first would be given its own uniform
    material.onBeforeCompile = shader => {
      shader.uniforms.bounds = bounds;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorld;').replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWorld = (modelMatrix * wp).xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nuniform vec4 bounds;').replace('void main() {', 'void main() {\n  if (vWorld.x < bounds.x || vWorld.x > bounds.z || vWorld.y < bounds.y || vWorld.y > bounds.w) discard;');
    };
    return this.depths[name] = material;
  }
  // Where a point at DOM (x, y) lying at depth z appears on screen, relative to where the wall behind it would show it: the DOM is moved by this to follow its bricks.
  shiftOf(x, y, z) {
    const k = z / (DISTANCE - z); return { x: (x - this.eye.x) * k, y: (y - this.eye.y) * k };
  }
  pool(group, key) {
    this.group(group); const id = `${group}|${key}`; let pool = this.pools.get(id);
    if (!pool) { pool = new Pool(this.groups[group], key, this.material, this.depthFor(group)); this.pools.set(id, pool); }
    return pool;
  }
  begin() {
    for (const pool of this.pools.values()) pool.clear();
    for (const mesh of this.stickers) { mesh.parent?.remove(mesh); mesh.material.dispose(); } this.stickers = []; this.matrix = new THREE.Matrix4();
  }
  // A brick of key `w:h:d:s|t` whose front face has its top-left at (x, y) in DOM pixels and its front at z `front`; it is `d` deep, behind that.
  add(group, key, x, y, front, hex) {
    const [, h, d] = key.split(':'), pool = this.pool(group, key);
    this.matrix.makeTranslation(x, -(y + +h), front - d);
    return { pool, index: pool.add(this.matrix, colour(hex)), x, y, front, key };
  }
  // A picture of an element's content (see paint.js) as a plane on a face: DOM rect (x, y, w, h) at depth z, in front of the bricks there.
  sticker(group, texture, x, y, w, h, z) {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
    const mesh = new THREE.Mesh(STICKER, material); mesh.scale.set(w, h, 1); mesh.position.set(x + w / 2, -(y + h / 2), z); mesh.renderOrder = 2; mesh.matrixAutoUpdate = true;
    this.group(group).add(mesh); this.stickers.push(mesh);
    return { mesh, base: mesh.position.clone() };
  }
  // Moves a placed brick or sticker by (dx, dy, dz) from where it was put: dy is down the screen, dz toward the viewer.
  nudge(handle, dx, dy, dz) {
    if (handle.mesh) { handle.mesh.position.set(handle.base.x + dx, handle.base.y - dy, handle.base.z + dz); return; }
    const [, h, d] = handle.key.split(':'); this.matrix.makeTranslation(handle.x + dx, -(handle.y + +h) - dy, handle.front - d + dz);
    handle.pool.mesh.setMatrixAt(handle.index, this.matrix); handle.pool.mesh.instanceMatrix.needsUpdate = true;
  }
  end() { for (const pool of this.pools.values()) pool.commit(); this.shadowDirty = true; this.invalidate(); }
  invalidate() { if (!this.frame) this.frame = requestAnimationFrame(now => { this.frame = 0; this.draw(now); }); }
  // Short eased changes; the layer keeps drawing while any is running.
  tween(duration, step, done, start = performance.now()) {
    const tween = { start, duration, step, done }; this.tweens.add(tween); this.invalidate(); return tween;
  }
  stop() { this.tweens.clear(); }
  draw(now) {
    for (const tween of [...this.tweens]) {
      const t = Math.max(0, Math.min(1, (performance.now() - tween.start) / tween.duration)); tween.step(t);
      if (t >= 1) { this.tweens.delete(tween); tween.done?.(); }
    }
    const { renderer, scene, camera } = this, names = Object.keys(this.groups);
    if (this.tweens.size) this.shadowDirty = true;   // shadows move with whatever is moving
    if (this.shadowDirty) {   // the shadow map is made with everything in place, colours off, so a clipped region still shades what is outside it
      const gl = renderer.getContext(); gl.colorMask(false, false, false, false); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); gl.colorMask(true, true, true, true); this.shadowDirty = false;
    }
    renderer.setScissorTest(false); renderer.autoClear = true; renderer.clear(); renderer.autoClear = false;
    for (const name of names) {
      for (const other of names) this.groups[other].visible = other === name;
      const clip = this.clips[name];
      if (clip) { renderer.setScissorTest(true); renderer.setScissor(clip.x, this.size.height - clip.y - clip.h, clip.w, clip.h); } else renderer.setScissorTest(false);
      renderer.render(scene, camera);
    }
    for (const name of names) this.groups[name].visible = true;
    renderer.setScissorTest(false); renderer.autoClear = true;
    if (this.tweens.size) this.invalidate();
  }
  dispose() { cancelAnimationFrame(this.frame); this.renderer.dispose(); this.renderer.forceContextLoss?.(); }
}
