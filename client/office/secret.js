// The secret room. A tall bookshelf against the right wall, a little past the lounge, stands in front of a doorway: press the
// right book (the red one with gold bands, leaning a little proud; it doesn't light up under the pointer) and the shelf slides
// aside. Behind it is a games room: confetti carpet, a neon sign, string lights, a disco ball whose spots sweep the walls and
// floor, a lava lamp and beanbags, under two coloured lamps of its own that don't reach the office. It isn't drawn at all
// until the shelf moves, nor in the overview, and the shelf slides shut by itself once you've left and walked off.
// Fruit and the goose stay out (no paths in here yet). With reduced motion the shelf jumps and nothing in there moves.
import * as THREE from 'three';
import { WALL_H, WALL_T, mesh, once, canvasTexture, glowTexture, paint, painted, piece } from './furniture.js';
import { toonMaterial } from './toon.js';

// The doorway in the office's right wall: wide and high, its middle this far from the front wall (room.js cuts it).
export const DOOR = { w: 1.3, h: 2.2, back: 3.8 };
// The games room, from the doorway's middle on its far side: how far it reaches in (x), behind it (-z) and in front (+z).
export const SECRET = { w: 6, back: 4.1, front: 3.1 };
const SHELF = { w: 1.5, h: 2.3, d: 0.38 }, SLIDE = 1.6, MOVE = 1.4; // metres; seconds to slide open or shut
const SHUT_AFTER = 5, AWAY = 3; // it shuts once you've been out of the room and this far from the doorway this many seconds
// The right book: which shelf (from the floor), where along it, its size; it leans out LEAN and tips out further when pressed.
const KEY = { shelf: 2, x: 0.36, w: 0.06, h: 0.32 }, LEAN = 0.07, PRESS = 0.6;
const NEON = ['#ff4fd8', '#38f2ff', '#ffe14f', '#7dff6b', '#ff8a3d'];

const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const jitter = (i, salt) => { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };

// The shelf in its own frame, facing +z: back, sides, top, five shelves of books with a gap where the right book goes.
function shelfParts() {
  const { w, h, d } = SHELF, wood = '#7a4e2d', rows = 5, gap = (h - 0.06) / rows, colors = ['#d1495b', '#2e86ab', '#edae49', '#00798c', '#30638e', '#e07a5f', '#81b29a', '#3d405b'];
  const parts = [[B(w, h, 0.03, 0, h / 2, -d / 2 + 0.015), wood], [B(0.04, h, d, -w / 2 + 0.02, h / 2, 0), wood], [B(0.04, h, d, w / 2 - 0.02, h / 2, 0), wood], [B(w, 0.04, d, 0, h - 0.02, 0), wood]];
  for (let row = 0; row < rows; row++) {
    const y = 0.02 + row * gap;
    parts.push([B(w - 0.06, 0.03, d - 0.02, 0, y, 0), wood]);
    for (let i = 0, x = -w / 2 + 0.05; x < w / 2 - 0.12; i++) {
      const bw = 0.04 + jitter(i, row) * 0.035, bh = 0.24 + jitter(i, row + 9) * 0.12;
      if (row === KEY.shelf && x + bw > KEY.x - KEY.w / 2 - 0.004 && x < KEY.x + KEY.w / 2 + 0.004) { x = KEY.x + KEY.w / 2 + 0.006; continue; }
      parts.push([B(bw, bh, d - 0.12, x + bw / 2, y + 0.015 + bh / 2, 0.02), colors[(i + row * 3) % colors.length]]);
      x += bw + 0.005;
    }
  }
  return parts;
}
const keyRow = () => 0.02 + KEY.shelf * (SHELF.h - 0.06) / 5 + 0.015;

// Arcade carpet: neon rings, zigzags and triangles on navy, drawn wrapped so it tiles.
const confetti = (g, w, h) => {
  g.fillStyle = '#1d1a3a'; g.fillRect(0, 0, w, h); g.lineWidth = 4;
  for (let i = 0; i < 60; i++) for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const r = 6 + jitter(i, 3) * 8; g.save(); g.translate(jitter(i, 1) * w + dx, jitter(i, 2) * h + dy); g.rotate(jitter(i, 4) * Math.PI);
    g.strokeStyle = g.fillStyle = NEON[i % NEON.length]; g.beginPath();
    if (i % 3 === 0) { g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    else if (i % 3 === 1) { g.moveTo(-r, 0); for (let k = 1; k <= 4; k++) g.lineTo(-r + k * r / 2, k % 2 ? -r / 2 : 0); g.stroke(); }
    else { g.moveTo(0, -r); g.lineTo(r, r); g.lineTo(-r, r); g.closePath(); g.fill(); }
    g.restore();
  }
};
// The disco ball's spots: soft coloured dots, wrapped across for the walls; for the floor, inside a circle that fades out.
const dot = (g, x, y, r, color) => { const grad = g.createRadialGradient(x, y, 0, x, y, r); grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2); };
const wallSpots = (g, w, h) => { for (let i = 0; i < 70; i++) for (const dx of [-w, 0, w]) dot(g, jitter(i, 5) * w + dx, jitter(i, 6) * h, 4 + jitter(i, 7) * 5, i % 3 ? '#ffffff' : NEON[i % NEON.length]); };
const floorSpots = (g, w) => { for (let i = 0; i < 90; i++) { const a = jitter(i, 8) * Math.PI * 2, d = Math.sqrt(jitter(i, 9)) * w * 0.46; g.globalAlpha = 1 - d / (w * 0.5); dot(g, w / 2 + Math.cos(a) * d, w / 2 + Math.sin(a) * d, 3 + jitter(i, 10) * 4, i % 3 ? '#ffffff' : NEON[i % NEON.length]); } };
const mirror = (g, w, h) => { for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) { const v = 120 + Math.floor(jitter(x * 31 + y, 11) * 135); g.fillStyle = `rgb(${v},${v},${v + 10})`; g.fillRect(x + 1, y + 1, 6, 6); } };
const neon = (g, w, h) => {
  g.clearRect(0, 0, w, h); g.font = `bold 150px 'Comic Neue', 'Comic Sans MS', cursive`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  for (const [blur, width, color] of [[40, 14, '#ff3fd2'], [16, 9, '#ff6be0'], [0, 3, '#ffe6fb']]) { g.shadowBlur = blur; g.shadowColor = '#ff3fd2'; g.lineWidth = width; g.strokeStyle = color; g.strokeText('GAME ROOM', w / 2, h * 0.42); }
  g.shadowBlur = 24; g.shadowColor = '#38f2ff'; g.strokeStyle = '#bff9ff'; g.lineWidth = 6; g.beginPath(); g.moveTo(w * 0.18, h * 0.8);
  for (let k = 1; k <= 12; k++) g.lineTo(w * 0.18 + k * w * 0.64 / 12, h * (k % 2 ? 0.72 : 0.8)); g.stroke();
};

export function createSecret({ onPress }) {
  let open = false, t = 0, idle = 0, press = 0, time = 0, built = null;
  const games = []; // what's played in here (darts.js): built into the room and updated with it
  const shelf = new THREE.Group(); shelf.userData.secret = 'shelf'; // userData keeps room.js's bake off what moves
  shelf.add(piece('secretShelf', shelfParts));
  // The right book tips out from its bottom front edge.
  const key = mesh(once('secretKey', () => paint([[B(KEY.w, KEY.h, SHELF.d - 0.12, 0, KEY.h / 2, -(SHELF.d - 0.12) / 2), '#8c1c13'], ...[0.06, 0.26].map(y => [B(KEY.w + 0.004, 0.018, 0.006, 0, y, 0.002), '#e8c15a'])])), painted(), 0.006);
  key.position.set(KEY.x, keyRow(), 0.02 + (SHELF.d - 0.12) / 2 + 0.04); key.rotation.x = LEAN; key.userData = { toggle: () => onPress(), quiet: true }; // quiet: no outline or pointer on hover (office.js)
  shelf.add(key);

  const secret = {
    shelf,
    // Inside the games room (past the middle of the wall), at `p`.
    inside(p) { return !!built && p.x > built.door.x + WALL_T / 2 && p.z > built.door.z - SECRET.back && p.z < built.door.z + SECRET.front; },
    // How far you may walk: the office and the games room beside it (walls and the shelf do the rest).
    bounds(room) { return { width: room.width + WALL_T + SECRET.w, depth: room.depth }; },
    // Where to stand to press the right book.
    get spot() { return built && new THREE.Vector3(built.door.x - 0.9, 0, built.door.z); },
    toggle() { open = !open; idle = 0; press = PRESS; },
    add(game) { games.push(game); if (built) game.build(built.room); },
    // A room `width` × `depth` (a new shell): the shelf and the games room go in `shell`; returns what blocks walking.
    build({ width, depth, shell }) {
      const door = new THREE.Vector3(width, 0, depth - DOOR.back), room = buildRoom(), collider = new THREE.Box3();
      room.position.set(width + WALL_T, 0, door.z); room.visible = false; shell.add(room, shelf);
      shelf.rotation.y = -Math.PI / 2;
      // Its own lamps sit in the shell, always there, so showing the room never changes the count of lights (which would
      // recompile every material); hidden, they're just off. Neither reaches past the wall into the office.
      const lamps = [[NEON[0], 5, 4.2, 4.5, -0.4], [NEON[1], 4, 3.3, 3.4, 1.9]].map(([color, power, reach, x, z]) => {
        const light = new THREE.PointLight(color, 0, reach, 1.2); light.position.set(width + WALL_T + x, 2.5, door.z + z); shell.add(light);
        return [light, power];
      });
      room.updateMatrixWorld(true);
      const colliders = room.userData.walls.map(wall => new THREE.Box3().setFromObject(wall));
      built = { door, room, collider, lamps }; place();
      for (const game of games) game.build(room);
      return [...colliders, collider];
    },
    // Each frame, with where you stand (not the camera, which the overview lifts away).
    update(dt, at, still, overview) {
      if (!built) return;
      time += dt;
      const inside = secret.inside(at);
      if (open && !inside && Math.hypot(at.x - built.door.x, at.z - built.door.z) > AWAY) { if ((idle += dt) > SHUT_AFTER) open = false; } else idle = 0;
      const goal = open ? 1 : 0;
      if (t !== goal) { t = still ? goal : THREE.MathUtils.clamp(t + (goal ? dt : -dt) / MOVE, 0, 1); place(); }
      press = Math.max(0, press - dt);
      key.rotation.x = LEAN + (still ? 0 : 0.4 * Math.sin(Math.PI * press / PRESS));
      const shown = (t > 0 || inside) && overview < 0.01, { room } = built;
      room.visible = shown;
      for (const [light, power] of built.lamps) light.intensity = shown ? power : 0;
      if (shown && !still) room.userData.animate(time);
      for (const game of games) game.update(dt, at, still, shown);
    },
  };
  // The shelf where the slide has got to (eased, with a little judder while it moves), and what it blocks there.
  function place() {
    const e = t * t * (3 - 2 * t), z = built.door.z - SLIDE * e, judder = t > 0 && t < 1 ? Math.sin(time * 70) * 0.004 : 0;
    shelf.position.set(built.door.x - SHELF.d / 2 - 0.01 + judder, 0, z);
    built.collider.min.set(built.door.x - SHELF.d - 0.01, 0, z - SHELF.w / 2); built.collider.max.set(built.door.x, SHELF.h, z + SHELF.w / 2);
  }
  return secret;
}

// The games room in its own frame: the doorway's middle at the origin on the floor, the room reaching out along +x.
// userData.walls are its walls (to block walking); userData.animate(time) moves what moves.
function buildRoom() {
  const { w, back, front } = SECRET, long = back + front, mid = (front - back) / 2, group = new THREE.Group();
  group.userData.secret = 'room';
  const carpet = canvasTexture(256, 256, confetti); carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.repeat.set(w / 2, long / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, long).rotateX(-Math.PI / 2), toonMaterial('#ffffff', { map: carpet }));
  floor.position.set(w / 2, 0, mid); floor.userData.floor = true; group.add(floor);
  // Hidden, it can't be clicked through the wall.
  floor.raycast = (raycaster, hits) => { if (group.visible) THREE.Mesh.prototype.raycast.call(floor, raycaster, hits); };
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, long).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#191430' }));
  ceiling.position.set(w / 2, WALL_H, mid); group.add(ceiling);
  // Deep purple walls; the office's coral wall gets a purple lining this side, the doorway cut out of it.
  const purple = toonMaterial('#4a3380');
  // The end and far walls start where the office's wall stops (x = 0): any further in and their ends would share its face and flicker.
  group.userData.walls = [[w + WALL_T, WALL_T, (w + WALL_T) / 2, -back - WALL_T / 2], [w + WALL_T, WALL_T, (w + WALL_T) / 2, front + WALL_T / 2], [WALL_T, long + 2 * WALL_T, w + WALL_T / 2, mid]].map(([sx, sz, x, z]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_H, sz), purple); wall.position.set(x, WALL_H / 2, z); group.add(wall); return wall;
  });
  const outline = new THREE.Shape().moveTo(-front, 0).lineTo(-DOOR.w / 2, 0).lineTo(-DOOR.w / 2, DOOR.h).lineTo(DOOR.w / 2, DOOR.h).lineTo(DOOR.w / 2, 0).lineTo(back, 0).lineTo(back, WALL_H).lineTo(-front, WALL_H);
  const lining = new THREE.Mesh(new THREE.ShapeGeometry(outline).rotateY(Math.PI / 2), purple); lining.position.x = 0.005; group.add(lining);
  // LED strips: cyan along the skirting, pink along the top, either side of the doorway on the near wall.
  const strips = [];
  for (const [y, color] of [[0.04, NEON[1]], [WALL_H - 0.04, NEON[0]]]) {
    strips.push([B(w, 0.025, 0.025, w / 2, y, -back + 0.02), color], [B(w, 0.025, 0.025, w / 2, y, front - 0.02), color], [B(0.025, 0.025, long, w - 0.02, y, mid), color]);
    if (y > DOOR.h) strips.push([B(0.025, 0.025, long, 0.02, y, mid), color]);
    else strips.push([B(0.025, 0.025, front - DOOR.w / 2, 0.02, y, (front + DOOR.w / 2) / 2), color], [B(0.025, 0.025, back - DOOR.w / 2, 0.02, y, -(back + DOOR.w / 2) / 2), color]);
  }
  group.add(new THREE.Mesh(paint(strips), new THREE.MeshBasicMaterial({ vertexColors: true })));

  // The neon sign across from the doorway, with a pink glow on the wall behind it; now and then it flickers.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 300, neon), transparent: true, depthWrite: false }));
  sign.position.set(w - 0.03, 2.15, 0); group.add(sign);
  document.fonts?.load(`bold 150px 'Comic Neue'`).then(() => sign.material.map?.redraw?.()).catch(() => {});
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff4fd8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.set(w - 0.04, 2.15, 0); group.add(halo);

  // The disco ball, and its spots: on the walls they slide along, on the floor they turn with it.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), toonMaterial('#ffffff', { map: canvasTexture(256, 128, mirror), flatShading: true }));
  ball.position.set(w / 2, 2.5, mid); group.add(ball);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, WALL_H - 2.7), new THREE.MeshBasicMaterial({ color: '#2a2238' })); cord.position.set(w / 2, (WALL_H + 2.7) / 2, mid); group.add(cord);
  const spots = canvasTexture(512, 256, wallSpots); spots.wrapS = THREE.RepeatWrapping;
  const spotLook = new THREE.MeshBasicMaterial({ map: spots, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [length, x, z, turn] of [[w, w / 2, -back + 0.012, 0], [w, w / 2, front - 0.012, Math.PI], [long, w - 0.012, mid, -Math.PI / 2]]) {
    const plane = new THREE.PlaneGeometry(length, 2.3), uv = plane.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * length / 3); // 3 m a repeat
    const m = new THREE.Mesh(plane.rotateY(turn), spotLook); m.position.set(x, 1.5, z); m.raycast = () => {}; group.add(m);
  }
  const floorDots = new THREE.Mesh(new THREE.CircleGeometry(3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, floorSpots), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  floorDots.position.set(w / 2, 0.012, mid); floorDots.raycast = () => {}; group.add(floorDots);

  // String lights sagging between hooks round the top of the walls, the bulbs chasing in colour.
  const corners = [[0.07, -back + 0.07], [w - 0.07, -back + 0.07], [w - 0.07, front - 0.07], [0.07, front - 0.07], [0.07, -back + 0.07]], at = [];
  for (let c = 0; c < 4; c++) {
    const [x0, z0] = corners[c], [x1, z1] = corners[c + 1], length = Math.hypot(x1 - x0, z1 - z0), spans = Math.max(1, Math.round(length / 1.5)), n = Math.round(length / 0.25);
    for (let i = 0; i < n; i++) { const s = i / n, u = (s * spans) % 1; at.push(new THREE.Vector3(x0 + (x1 - x0) * s, 2.82 - 0.16 * 4 * u * (1 - u), z0 + (z1 - z0) * s)); }
  }
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshBasicMaterial(), at.length), base = new THREE.Color(), matrix = new THREE.Matrix4();
  at.forEach((p, i) => { bulbs.setMatrixAt(i, matrix.makeTranslation(p.x, p.y - 0.03, p.z)); bulbs.setColorAt(i, base.set(NEON[i % NEON.length])); });
  const colors = bulbs.instanceColor.array.slice(); bulbs.raycast = () => {}; group.add(bulbs);
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...at, at[0]]), new THREE.LineBasicMaterial({ color: '#2a2238' })); wire.raycast = () => {}; group.add(wire);

  // Two beanbags and a side table with a lava lamp, along the far wall.
  for (const [z, color, turn] of [[-1.3, '#ff5fa2', 0.5], [1.4, '#2ec4b6', -0.4]]) {
    const bag = piece(`beanbag${color}`, () => [[new THREE.SphereGeometry(0.42, 16, 12).scale(1, 0.55, 1).translate(0, 0.23, 0), color], [new THREE.SphereGeometry(0.3, 14, 10).scale(1, 0.6, 0.8).translate(0, 0.42, -0.14), color]]);
    bag.position.set(w - 0.65, 0, z); bag.rotation.y = -Math.PI / 2 + turn; group.add(bag);
  }
  const table = piece('sideTable', () => [[new THREE.CylinderGeometry(0.24, 0.24, 0.04, 24).translate(0, 0.52, 0), '#2a2238'], [new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8).translate(0, 0.26, 0), '#2a2238'], [new THREE.CylinderGeometry(0.16, 0.18, 0.02, 20).translate(0, 0.01, 0), '#2a2238']]);
  table.position.set(w - 0.45, 0, 0.1); group.add(table);
  const lamp = new THREE.Group(); lamp.position.set(w - 0.45, 0.54, 0.1); group.add(lamp);
  lamp.add(piece('lavaBase', () => [[new THREE.CylinderGeometry(0.05, 0.085, 0.12, 16).translate(0, 0.06, 0), '#c0c4cc'], [new THREE.CylinderGeometry(0.03, 0.045, 0.05, 16).translate(0, 0.415, 0), '#c0c4cc']], 0.004));
  lamp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.27, 16, 1, true).translate(0, 0.255, 0), new THREE.MeshBasicMaterial({ color: '#ff3d2e', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })));
  const blobs = [0.022, 0.03, 0.018].map(r => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8).scale(1, 1.3, 1), new THREE.MeshBasicMaterial({ color: '#ffb02e' })); lamp.add(b); return b; });

  group.userData.animate = time => {
    ball.rotation.y = time * 0.6; floorDots.rotation.y = -time * 0.6; spots.offset.x = -time * 0.05;
    const c = bulbs.instanceColor.array;
    for (let i = 0; i < at.length; i++) { const k = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2.5 - i * 0.45)); for (let j = 0; j < 3; j++) c[i * 3 + j] = colors[i * 3 + j] * k; }
    bulbs.instanceColor.needsUpdate = true;
    blobs.forEach((b, i) => { b.position.set(Math.sin(time * 0.3 + i) * 0.012, 0.25 + 0.1 * Math.sin(time * (0.35 + i * 0.12) + i * 2), 0); });
    sign.material.opacity = halo.material.opacity = time % 11 < 0.4 && Math.floor(time * 25) % 3 === 0 ? 0.25 : 1;
  };
  return group;
}
