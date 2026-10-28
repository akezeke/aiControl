// The camera: first person at the boss's eyes, or the overview (Tab, see overview.js).
// Walls between the camera and the room, and the ceiling, fade out as the overview rises.
import * as THREE from 'three';
import { toonMaterial } from './toon.js';
import { canvasTexture } from './furniture.js';
import { Overview } from './overview.js';

const EASE = 5, FADED = 0.12, RUN_FOV = 6, STRIDE = 1.6; // radians of walk cycle per metre

export class OfficeCamera {
  constructor(camera, scene, player, room, { reducedMotion, container }) {
    this.camera = camera; this.player = player; this.room = room; this.reducedMotion = reducedMotion;
    this.overview = false; this.amount = 0; this.focusPoint = null; this.focusAmount = 0; this.fov = camera.fov;
    this.overhead = new Overview(container, camera.userData.canvas, camera);
    // First person: your arm, holding a #1 BOSS mug by the handle, bottom right. The text faces you (the side starts at the back).
    this.hands = new THREE.Group(); camera.add(this.hands); scene.add(camera);
    const red = toonMaterial('#e8574a'), ink = toonMaterial('#26252b'), mug = new THREE.Group(); mug.position.set(0.25, -0.25, -0.62); mug.rotation.set(0.15, -0.4, 0); this.hands.add(mug);
    const label = canvasTexture(1024, 356, (g, w, h) => {
      g.fillStyle = '#e8574a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 140px system-ui, sans-serif'; g.fillText('#1', w / 2, h * 0.33); g.font = '900 104px system-ui, sans-serif'; g.fillText('BOSS', w / 2, h * 0.7);
    });
    mug.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 24, 1, true, Math.PI), toonMaterial('#fff', { map: label })));
    mug.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.12, 24, 1, true), toonMaterial('#c94538', { side: THREE.BackSide })));
    mug.add(new THREE.Mesh(new THREE.RingGeometry(0.05, 0.055, 24).rotateX(-Math.PI / 2).translate(0, 0.06, 0), red));
    mug.add(new THREE.Mesh(new THREE.CircleGeometry(0.05, 24).rotateX(Math.PI / 2).translate(0, -0.06, 0), red));
    mug.add(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 8, 16, Math.PI * 1.2).rotateZ(-Math.PI * 0.6).translate(0.06, 0.005, 0), red));
    this.coffee = new THREE.Mesh(new THREE.CircleGeometry(0.048, 24).rotateX(-Math.PI / 2), toonMaterial('#5b3a24')); this.coffee.position.y = 0.04; mug.add(this.coffee);
    // A right fist round the handle: fingers curled over the front and through it, thumb along the top; the arm runs from the wrist off the bottom right.
    mug.add(new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10).scale(0.8, 1.15, 1).translate(0.13, -0.002, 0), ink));
    for (const [y, arc] of [[0.016, 1.3], [-0.006, 1.35], [-0.027, 1.2]]) mug.add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0105, 6, 12, Math.PI * arc).rotateX(Math.PI / 2).translate(0.09, y, 0), ink));
    mug.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.034, 4, 8).rotateZ(Math.PI / 2 - 0.25).translate(0.1, 0.037, 0.006), ink));
    mug.updateMatrix(); const wrist = new THREE.Vector3(0.155, -0.005, 0).applyMatrix4(mug.matrix);
    const arm = new THREE.QuadraticBezierCurve3(wrist, new THREE.Vector3(0.5, -0.32, -0.5), new THREE.Vector3(0.62, -0.7, -0.25));
    this.hands.add(new THREE.Mesh(new THREE.TubeGeometry(arm, 16, 0.02, 8), ink));
    this.was = { x: 0, z: 0, yaw: 0, pitch: 0 }; this.walk = this.stride = 0; this.sway = new THREE.Vector2();
    this.from = new THREE.Vector3(); this.look = new THREE.Vector3();
  }

  setOverview(on) { this.overview = on; this.overhead.setActive(on); }
  setLayout(layout) { this.overhead.setLayout(layout); }
  // Frames a point (a character) from where you stand; null hands the camera back.
  focus(point) { this.focusPoint = point?.clone() || null; }

  update(dt) {
    this.overhead.update(dt);
    const instant = this.reducedMotion(), k = instant ? 1 : 1 - Math.exp(-dt * EASE);
    this.amount += ((this.overview ? 1 : 0) - this.amount) * k;
    this.focusAmount += ((this.focusPoint ? 1 : 0) - this.focusAmount) * k;
    if (Math.abs(this.amount - (this.overview ? 1 : 0)) < 0.001) this.amount = this.overview ? 1 : 0;

    const p = this.player, eye = p.position, look = new THREE.Vector3(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch)).add(eye);
    // Talking: ease the view onto the character's face, a little lower and closer than standing eye level.
    if (this.focusAmount > 0.001 && this.focusPoint) look.lerp(this.focusPoint, this.focusAmount);
    this.from.copy(eye); this.look.copy(look);
    if (this.amount) { const over = this.overhead.pose(); this.from.lerp(over.from, this.amount); this.look.lerp(over.look, this.amount); }
    this.camera.position.copy(this.from); this.camera.lookAt(this.look);
    // Running, or flying over to someone, widens the view a little.
    const fov = this.fov + (p.running && !instant ? RUN_FOV : 0);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * k; this.camera.updateProjectionMatrix(); }
    // While talking, shift the picture left so the character is centred in the part the panel leaves open.
    const panel = document.querySelector('#panel'), canvas = this.camera.userData.canvas, shift = panel && !panel.hidden && innerWidth > 640 ? panel.offsetWidth / 2 * this.focusAmount : 0;
    if (canvas && Math.abs(shift - (this.shift || 0)) > 0.5) {
      this.shift = shift;
      if (shift) this.camera.setViewOffset(canvas.clientWidth, canvas.clientHeight, shift, 0, canvas.clientWidth, canvas.clientHeight); else this.camera.clearViewOffset();
    }

    this.hands.visible = this.amount < 0.2 && !this.focusPoint;
    this.carry(dt, instant);
    this.fade();
  }

  // Walking bobs the mug and sloshes the coffee; turning or looking up and down drags it a little behind.
  carry(dt, instant) {
    const p = this.player, was = this.was, step = Math.hypot(p.position.x - was.x, p.position.z - was.z), rate = 1 / Math.max(dt, 0.001), k = 1 - Math.exp(-dt * 8);
    const spin = Math.atan2(Math.sin(p.yaw - was.yaw), Math.cos(p.yaw - was.yaw)) * rate, nod = (p.pitch - was.pitch) * rate;
    Object.assign(was, { x: p.position.x, z: p.position.z, yaw: p.yaw, pitch: p.pitch });
    if (instant || step > 0.5) { this.hands.position.set(0, 0, 0); this.hands.rotation.z = 0; this.coffee.rotation.set(0, 0, 0); return; } // reduced motion, or a jump across the room
    this.walk += (Math.min(1, step * rate / 3) - this.walk) * k; this.stride += step * STRIDE;
    this.sway.x += (THREE.MathUtils.clamp(spin * 0.012, -0.03, 0.03) - this.sway.x) * k; this.sway.y += (THREE.MathUtils.clamp(-nod * 0.01, -0.025, 0.025) - this.sway.y) * k;
    const side = Math.sin(this.stride) * this.walk, dip = (1 - Math.cos(this.stride * 2)) * this.walk;
    this.hands.position.set(side * 0.012 + this.sway.x, -dip * 0.008 + this.sway.y, 0); this.hands.rotation.z = this.sway.x * 1.5;
    this.coffee.rotation.set(Math.cos(this.stride * 2) * 0.05 * this.walk - this.sway.y * 3, 0, -side * 0.07 - this.sway.x * 4);
  }

  // The ceiling goes with the overview; a wall fades when it faces away from the camera (it's between the camera and the room).
  fade() {
    const { ceiling, walls } = this.room.fadeables;
    if (ceiling) ceiling.traverse(node => { if (node.material) { node.material.opacity = 1 - this.amount; node.visible = this.amount < 0.98; } });
    const centre = new THREE.Vector3(...(this.room.size?.split('x').map(Number) || [0, 0])).multiplyScalar(0.5);
    const toCamera = this.camera.position.clone().sub(new THREE.Vector3(centre.x, 0, centre.y)).setY(0).normalize();
    for (const { mesh, normal } of walls) {
      const between = normal.dot(toCamera) < -0.3, opacity = between ? 1 - (1 - FADED) * this.amount : 1;
      mesh.material.opacity = opacity; mesh.material.depthWrite = opacity > 0.99;
      for (const child of mesh.children) child.visible = opacity > 0.5;
    }
  }

  dispose() { this.overhead.dispose(); this.camera.removeFromParent(); }
}
