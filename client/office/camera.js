// The camera: first person at the boss's eyes, or the overview (hold Tab) lifted over the room at about 45°.
// Walls between the camera and the room, and the ceiling, fade out as the overview rises.
import * as THREE from 'three';
import { createFruit, handGeometry } from './fruit.js';
import { toonMaterial } from './toon.js';

const EASE = 5, FADED = 0.12;

export class OfficeCamera {
  constructor(camera, scene, player, room, { reducedMotion }) {
    this.camera = camera; this.player = player; this.room = room; this.reducedMotion = reducedMotion;
    this.overview = false; this.amount = 0; this.focusPoint = null; this.focusAmount = 0;
    // First person: your hand holding a coffee mug, bottom right.
    this.hands = new THREE.Group(); camera.add(this.hands); scene.add(camera);
    const hand = new THREE.Mesh(handGeometry(), toonMaterial('#26252b')); hand.position.set(0.3, -0.3, -0.62); hand.rotation.set(-0.3, -0.5, 1.2); this.hands.add(hand);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.085, 16), toonMaterial('#e8574a')); mug.position.set(0.29, -0.25, -0.64); this.hands.add(mug);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16).rotateX(-Math.PI / 2), toonMaterial('#5b3a24')); coffee.position.set(0.29, -0.207, -0.64); this.hands.add(coffee);
    // Overview: you're a pineapple in a tie.
    this.boss = createFruit({ fruit: 'pineapple', color: '#f2b632', accessory: 'tie' }); this.boss.group.visible = false; scene.add(this.boss.group);
    this.from = new THREE.Vector3(); this.look = new THREE.Vector3();
  }

  setOverview(on) { this.overview = on; }
  // Frames a point (a character) from where you stand; null hands the camera back.
  focus(point) { this.focusPoint = point?.clone() || null; }

  update(dt) {
    const instant = this.reducedMotion(), k = instant ? 1 : 1 - Math.exp(-dt * EASE);
    this.amount += ((this.overview ? 1 : 0) - this.amount) * k;
    this.focusAmount += ((this.focusPoint ? 1 : 0) - this.focusAmount) * k;
    if (Math.abs(this.amount - (this.overview ? 1 : 0)) < 0.001) this.amount = this.overview ? 1 : 0;

    const p = this.player, eye = p.position, look = new THREE.Vector3(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch)).add(eye);
    // Talking: ease the view onto the character's face, a little lower and closer than standing eye level.
    if (this.focusAmount > 0.001 && this.focusPoint) look.lerp(this.focusPoint, this.focusAmount);
    const size = this.room.size?.split('x').map(Number) || [10, 10], [w, d] = size, height = (Math.max(w, d) * 0.62 + 1) / Math.min(1, this.camera.aspect * 1.2); // pull back further on tall (phone) screens
    const overFrom = new THREE.Vector3(w / 2, height, d + height * 0.45), overLook = new THREE.Vector3(w / 2, 0, d / 2 + 0.3);
    this.from.copy(eye).lerp(overFrom, this.amount); this.look.copy(look).lerp(overLook, this.amount);
    this.camera.position.copy(this.from); this.camera.lookAt(this.look);
    // While talking, shift the picture left so the character is centred in the part the panel leaves open.
    const panel = document.querySelector('#panel'), canvas = this.camera.userData.canvas, shift = panel && !panel.hidden && innerWidth > 640 ? panel.offsetWidth / 2 * this.focusAmount : 0;
    if (canvas && Math.abs(shift - (this.shift || 0)) > 0.5) {
      this.shift = shift;
      if (shift) this.camera.setViewOffset(canvas.clientWidth, canvas.clientHeight, shift, 0, canvas.clientWidth, canvas.clientHeight); else this.camera.clearViewOffset();
    }

    this.hands.visible = this.amount < 0.2 && !this.focusPoint;
    this.boss.group.visible = this.amount > 0.2;
    this.boss.group.position.set(eye.x, 0, eye.z); this.boss.group.rotation.y = p.yaw;
    this.fade();
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

  dispose() { this.boss.dispose(); this.camera.removeFromParent(); }
}
