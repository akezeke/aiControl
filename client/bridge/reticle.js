// Your visor's sight: rings in the room rather than on the page, so they take its glow. They close in on what you can use, and name it.
import * as THREE from 'three';
import { fitText, font } from './displays.js';

const RADIUS = 23, AWAY = .5, CLOSE = 12, W = 640, H = 72;
export function createReticle(camera, still) {
  const group = new THREE.Group(); group.position.z = -AWAY; group.visible = false; group.renderOrder = 20; camera.add(group);
  const flat = extra => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const ink = flat({}), shade = flat({ color: 0, opacity: .4 }), calm = new THREE.Color(), live = new THREE.Color();
  const put = (geometry, material, parent = group, order = 21) => { const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = order; parent.add(mesh); return mesh; };
  const arcs = (parent, inner, outer, count, length) => { for (let i = 0; i < count; i++) put(new THREE.RingGeometry(inner, outer, 18, 1, i * 2 * Math.PI / count, length), ink, parent); };
  const ring = new THREE.Group(), core = new THREE.Group(); group.add(ring, core);
  arcs(ring, .84, 1, 3, 1.25); arcs(core, .44, .5, 2, 1.1);
  put(new THREE.RingGeometry(.76, 1.08, 40), shade, ring, 20);
  put(new THREE.CircleGeometry(.15, 16), shade, group, 20); put(new THREE.CircleGeometry(.09, 16), ink);

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), map = new THREE.CanvasTexture(canvas), tag = put(new THREE.PlaneGeometry(W / H * 1.2, 1.2), flat({ map }));
  tag.position.y = -2; tag.visible = false;
  let target = null, amount = 0, spin = 0, tint = '#6a8cff', text = '#e4eaff';
  function draw() {
    g.clearRect(0, 0, W, H); tag.visible = !!target; if (!target) return;
    g.font = font(600, 44); g.textAlign = 'center'; g.textBaseline = 'middle';
    const line = fitText(target.toUpperCase(), W - 40, s => g.measureText(s).width), wide = g.measureText(line).width + 32;
    g.beginPath(); g.roundRect((W - wide) / 2, 3, wide, H - 6, 6); g.fillStyle = 'rgba(5,9,34,.82)'; g.fill(); g.strokeStyle = tint; g.lineWidth = 2; g.stroke();
    g.fillStyle = text; g.fillText(line, W / 2, H / 2 + 2);
    map.needsUpdate = true;
  }
  return {
    show(on) { group.visible = on; },
    // What's under it, by name; null for nothing you can use.
    aim(name) { if (name !== target) { target = name; draw(); } },
    paint(colour, label) { tint = colour; text = label; calm.set(label); live.set(colour); draw(); },
    tick(dt, height) {
      if (!group.visible) return;
      amount += (+!!target - amount) * (still ? 1 : 1 - Math.exp(-dt * CLOSE));
      // The same size on the screen whatever the field of view.
      group.scale.setScalar(2 * AWAY * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height * RADIUS);
      ring.scale.setScalar(1 - amount * .34); ink.color.lerpColors(calm, live, amount);
      if (still) return;
      spin += dt * amount * 2.1; ring.rotation.z = -spin; core.rotation.z = spin * 1.4;
    },
  };
}
