// The view: first person on the bridge's two floor levels, and the close-up of a screen it flies to.
import * as THREE from 'three';
import { floorHeight } from './deck.js';

// The eye stands a little above Player's EYE, the height the room was composed for.
const LIFT = .1, STEP = 12, TURN = 8, ZOOM = .45;
const turnBy = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const ease = t => (1 - Math.cos(Math.PI * t)) / 2;

export class BridgeCamera {
  constructor(camera, player, { reducedMotion }) {
    this.camera = camera; this.player = player; this.still = reducedMotion; this.overview = false; this.turn = null; this.close = 0; this.closing = false; this.focus = null;
    this.floor = floorHeight(player.position.x, player.position.z);
    this.at = new THREE.Vector3(); this.looking = new THREE.Quaternion(); this.aim = new THREE.Object3D(); this.aim.rotation.order = 'YXZ';
  }

  setOverview(on) {
    if (on === this.overview) return;
    this.overview = on; this.player.setOverview(on);
  }

  // Turns you to face a point; null lets go of a turn still under way.
  turnTo(x, z) {
    this.turn = x == null ? null : Math.atan2(x - this.player.position.x, z - this.player.position.z);
    if (this.turn !== null && this.still) { this.player.yaw = this.turn; this.turn = null; }
  }

  update(dt) {
    const { player, camera } = this, { position } = player, floor = floorHeight(position.x, position.z);
    this.floor = this.still ? floor : this.floor + (floor - this.floor) * (1 - Math.exp(-dt * STEP));
    if (this.turn !== null) {
      const left = turnBy(player.yaw, this.turn);
      if (Math.abs(left) < .01) { player.yaw = this.turn; this.turn = null; } else player.yaw += left * Math.min(1, dt * TURN);
    }
    this.at.set(position.x, position.y + this.floor + LIFT, position.z);
    camera.rotation.set(player.pitch, player.yaw + Math.PI, 0);
    camera.position.copy(this.at);
    this.close = this.still ? +this.closing : THREE.MathUtils.clamp(this.close + (this.closing ? dt : -dt) / ZOOM, 0, 1);
    if (this.close) this.blend(this.focus.position, this.focus.look, ease(this.close));
    camera.updateMatrixWorld();
  }

  // Part way from where you are to a pose elsewhere.
  blend(from, look, k) {
    this.aim.position.copy(from); this.aim.up.set(0, 1, 0); this.aim.lookAt(look);
    // Object3D.lookAt points +z at a target for anything but a camera, and a camera looks down -z.
    this.looking.copy(this.aim.quaternion).multiply(FLIP);
    this.camera.quaternion.slerp(this.looking, k); this.camera.position.lerpVectors(this.at, from, k);
  }
}
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
