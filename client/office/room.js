// The office itself: floor, walls, ceiling, door, windows, desks with chairs and monitors, project signs and the wall boards.
// Coordinates come straight from layout.js: the room spans x 0..width, z 0..depth, the door is on the front wall (z = depth).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMaterial, withOutline } from './toon.js';
import { DESK_W, DESK_D } from './layout.js';

export const WALL_H = 3, DESK_H = 0.76, SEAT_H = 0.47;
const WALL_T = 0.2;
const screens = { green: '#5ee08a', amber: '#ffb23e', dark: '#2b3140', red: '#ff5a5a', off: '#16181d' };
const rugs = ['#f4a6a6', '#a6d8f4', '#b9e4a1', '#f6d28b', '#cdb4f2', '#f7b8de'];

const shared = {};
const once = (key, make) => shared[key] ??= make();
const rounded = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, r);

function mesh(geometry, material, outline = 0.01) {
  const m = new THREE.Mesh(geometry, material);
  return outline ? withOutline(m, outline) : m;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  texture.redraw = (...args) => { draw(canvas.getContext('2d'), width, height, ...args); texture.needsUpdate = true; };
  texture.redraw();
  return texture;
}

// One desk in its own frame: the sitter faces +z from the chair at -z; the monitor is at the far (+z) edge facing them.
function createDesk({ props }) {
  const group = new THREE.Group(), wood = toonMaterial('#c98f5a'), dark = toonMaterial('#3a3d46'), chairColor = toonMaterial('#5b7fd6');
  const top = mesh(once('deskTop', () => rounded(DESK_W * 0.94, 0.07, DESK_D * 0.92, 0.03)), wood); top.position.y = DESK_H - 0.035; group.add(top);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = mesh(once('deskLeg', () => new THREE.CylinderGeometry(0.035, 0.03, DESK_H - 0.07, 10)), wood, 0.008);
    leg.position.set(x * (DESK_W * 0.42), (DESK_H - 0.07) / 2, z * (DESK_D * 0.36)); group.add(leg);
  }
  // Monitor: chunky bezel, glowing screen, round foot.
  const monitor = new THREE.Group(); monitor.position.set(0, DESK_H, DESK_D * 0.28); monitor.rotation.y = Math.PI; group.add(monitor);
  const bezel = mesh(once('bezel', () => rounded(0.62, 0.4, 0.06, 0.03)), dark); bezel.position.y = 0.34; monitor.add(bezel);
  const screen = new THREE.Mesh(once('screen', () => new THREE.PlaneGeometry(0.54, 0.32)), new THREE.MeshBasicMaterial({ color: screens.off }));
  screen.position.set(0, 0.34, 0.031); monitor.add(screen);
  const neck = mesh(once('neck', () => new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8)), dark, 0.006); neck.position.y = 0.09; monitor.add(neck);
  const foot = mesh(once('foot', () => new THREE.CylinderGeometry(0.12, 0.13, 0.025, 20)), dark, 0.006); foot.position.y = 0.012; monitor.add(foot);
  const keyboard = mesh(once('keyboard', () => rounded(0.42, 0.025, 0.14, 0.012)), toonMaterial('#e9e6df'), 0.006); keyboard.position.set(0, DESK_H + 0.012, -DESK_D * 0.08); group.add(keyboard);
  // Chair: puffy seat and back on a post with a round base.
  const chair = new THREE.Group(); chair.position.z = -(DESK_D / 2 + 0.32); group.add(chair);
  const seat = mesh(once('seat', () => rounded(0.48, 0.1, 0.46, 0.05)), chairColor); seat.position.y = SEAT_H - 0.05; chair.add(seat);
  const back = mesh(once('back', () => rounded(0.46, 0.5, 0.09, 0.045)), chairColor); back.position.set(0, SEAT_H + 0.28, -0.22); back.rotation.x = -0.12; chair.add(back);
  const post = mesh(once('post', () => new THREE.CylinderGeometry(0.03, 0.03, SEAT_H - 0.1, 8)), dark, 0.006); post.position.y = (SEAT_H - 0.1) / 2 + 0.04; chair.add(post);
  const base = mesh(once('base', () => new THREE.CylinderGeometry(0.26, 0.28, 0.04, 20)), dark, 0.006); base.position.y = 0.02; chair.add(base);
  // Props on the desk corners.
  const spots = [[-DESK_W * 0.36, DESK_D * 0.2], [DESK_W * 0.36, DESK_D * 0.2]];
  props.forEach((prop, i) => { const item = makeProp(prop); item.position.set(spots[i][0], DESK_H, spots[i][1]); group.add(item); });
  return { group, screen, chair };
}

function makeProp(kind) {
  const group = new THREE.Group();
  if (kind === 'plant') {
    const pot = mesh(once('pot', () => new THREE.CylinderGeometry(0.07, 0.055, 0.12, 14)), toonMaterial('#d9774b'), 0.006); pot.position.y = 0.06; group.add(pot);
    for (const [x, y, z, r] of [[0, 0.2, 0, 0.08], [0.05, 0.16, 0.03, 0.06], [-0.05, 0.17, -0.02, 0.065]]) {
      const leaf = mesh(once(`leaf${r}`, () => new THREE.SphereGeometry(r, 12, 8)), toonMaterial('#5cb85c'), 0.006); leaf.position.set(x, y, z); group.add(leaf);
    }
  } else if (kind === 'mug') {
    const cup = mesh(once('mug', () => new THREE.CylinderGeometry(0.045, 0.04, 0.1, 14)), toonMaterial('#f2f2f2'), 0.006); cup.position.y = 0.05; group.add(cup);
    const handle = mesh(once('handle', () => new THREE.TorusGeometry(0.03, 0.009, 6, 12)), toonMaterial('#f2f2f2'), 0); handle.position.set(0.05, 0.05, 0); group.add(handle);
  } else if (kind === 'duck') {
    const yellow = toonMaterial('#ffd93b');
    const body = mesh(once('duckBody', () => new THREE.SphereGeometry(0.06, 14, 10).scale(1.2, 0.85, 1)), yellow, 0.006); body.position.y = 0.05; group.add(body);
    const head = mesh(once('duckHead', () => new THREE.SphereGeometry(0.04, 12, 8)), yellow, 0.006); head.position.set(0.04, 0.12, 0); group.add(head);
    const beak = mesh(once('beak', () => new THREE.ConeGeometry(0.018, 0.04, 8).rotateZ(-Math.PI / 2)), toonMaterial('#ff8c1a'), 0); beak.position.set(0.085, 0.115, 0); group.add(beak);
    group.rotation.y = -Math.PI / 2;
  }
  return group;
}

function signTexture(name) {
  return canvasTexture(512, 128, (g, w, h, waiting = false) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = waiting ? '#ffb23e' : '#2f3542'; g.beginPath(); g.roundRect(0, 0, w, h, 28); g.fill();
    g.fillStyle = '#fffaf0'; g.beginPath(); g.roundRect(10, 10, w - 20, h - 20, 20); g.fill();
    g.fillStyle = '#2f3542'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // Shrink to fit first; only very long names get cut.
    let size = 60, text = name; g.font = `bold ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > w - 60 && size > 36) g.font = `bold ${size -= 2}px system-ui, sans-serif`;
    while (g.measureText(text).width > w - 60 && text.length > 3) text = text.slice(0, -2) + '…';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

export function createRoom(scene) {
  const root = new THREE.Group(); scene.add(root);
  const shell = new THREE.Group(); root.add(shell);
  const desks = new Map(), signs = new Map();
  const room = {
    colliders: [], fadeables: { ceiling: null, walls: [] }, boards: {},
    deskAnchor(id) {
      const desk = desks.get(id); if (!desk) return null;
      desk.group.updateMatrixWorld();
      return {
        seat: desk.chair.getWorldPosition(new THREE.Vector3()).setY(SEAT_H),
        facing: desk.group.rotation.y,
        monitor: desk.screen.getWorldPosition(new THREE.Vector3()),
        top: new THREE.Vector3(0, DESK_H, 0).applyMatrix4(desk.group.matrixWorld),
      };
    },
    sync(layout, statuses) {
      if (room.size !== `${layout.room.width}x${layout.room.depth}`) buildShell(layout);
      for (const [id, place] of layout.desks) {
        let desk = desks.get(id);
        if (!desk) { desk = createDesk({ props: statuses.get(id)?.identity?.props || [] }); desks.set(id, desk); root.add(desk.group); }
        desk.group.position.set(place.x, 0, place.z); desk.group.rotation.y = place.rotation;
        desk.screen.material.color.set(screens[statuses.get(id)?.screen] || screens.off);
      }
      for (const [id, desk] of desks) if (!layout.desks.has(id)) { removeDesk(desk); desks.delete(id); }
      const podKeys = new Set();
      for (const pod of layout.pods) {
        podKeys.add(pod.key);
        let sign = signs.get(pod.key);
        if (!sign) { sign = createSign(pod); signs.set(pod.key, sign); root.add(sign.group); }
        sign.group.position.set(pod.x, 0, pod.z);
        sign.rug.scale.set(pod.width + 0.6, 1, pod.depth + 0.4);
        const waiting = pod.deskIds.some(id => statuses.get(id)?.bubble?.highlight);
        if (sign.waiting !== waiting) { sign.waiting = waiting; sign.texture.redraw(waiting); }
      }
      for (const [key, sign] of signs) if (!podKeys.has(key)) { disposeTree(sign.group); signs.delete(key); }
      room.colliders = [...room.wallColliders, ...[...desks.values()].map(desk => new THREE.Box3().setFromObject(desk.group))];
    },
    dispose() { disposeTree(root); },
  };

  function createSign(pod) {
    const group = new THREE.Group(), texture = signTexture(pod.name), y = 2.35;
    const board = new THREE.Mesh(once('sign', () => rounded(1.6, 0.4, 0.05, 0.03)), [null, null, null, null, null, null].map((_, i) => i === 4 || i === 5 ? new THREE.MeshBasicMaterial({ map: texture }) : toonMaterial('#2f3542')));
    board.position.y = y; group.add(board);
    for (const x of [-0.6, 0.6]) { const cord = new THREE.Mesh(once('cord', () => new THREE.CylinderGeometry(0.008, 0.008, WALL_H - y - 0.2, 6)), toonMaterial('#2f3542')); cord.position.set(x, (WALL_H + y + 0.2) / 2, 0); group.add(cord); }
    const rug = new THREE.Mesh(once('rug', () => new RoundedBoxGeometry(1, 0.012, 1, 2, 0.005)), toonMaterial(rugs[signs.size % rugs.length])); rug.position.y = 0.006; group.add(rug);
    return { group, texture, rug, waiting: null };
  }

  function removeDesk(desk) { desk.group.removeFromParent(); desk.screen.material.dispose(); }

  function buildShell({ room: { width, depth }, door }) {
    disposeTree(shell, false);
    room.size = `${width}x${depth}`;
    const wallMaterial = () => toonMaterial('#f3ead8', { transparent: true });
    // Floor: warm planks drawn once into a repeating texture.
    const planks = canvasTexture(256, 256, g => {
      g.fillStyle = '#e2b47c'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#c99a63'; g.lineWidth = 3;
      for (let y = 0; y <= 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      for (let y = 0; y < 256; y += 32) { const x = (y / 32 % 2) * 128 + 64; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
    });
    planks.wrapS = planks.wrapT = THREE.RepeatWrapping; planks.repeat.set(width / 2, depth / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), toonMaterial('#ffffff', { map: planks }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(width / 2, 0, depth / 2); floor.userData.floor = true; shell.add(floor);

    // Walls, each with the inward normal used to fade the ones between the overview camera and the room.
    room.fadeables.walls = []; room.wallColliders = [];
    const wall = (w, x, z, rotation, normal) => {
      const m = mesh(new THREE.BoxGeometry(w, WALL_H, WALL_T), wallMaterial(), 0);
      m.position.set(x, WALL_H / 2, z); m.rotation.y = rotation; shell.add(m);
      const trim = mesh(new THREE.BoxGeometry(w, 0.14, WALL_T + 0.04), toonMaterial('#8c6a4f'), 0); trim.position.y = -WALL_H / 2 + 0.07; m.add(trim);
      room.fadeables.walls.push({ mesh: m, normal });
      room.wallColliders.push(new THREE.Box3().setFromObject(m));
      return m;
    };
    const back = wall(width + WALL_T * 2, width / 2, -WALL_T / 2, 0, new THREE.Vector3(0, 0, 1));
    const front = wall(width + WALL_T * 2, width / 2, depth + WALL_T / 2, 0, new THREE.Vector3(0, 0, -1));
    const left = wall(depth, -WALL_T / 2, depth / 2, Math.PI / 2, new THREE.Vector3(1, 0, 0));
    wall(depth, width + WALL_T / 2, depth / 2, Math.PI / 2, new THREE.Vector3(-1, 0, 0));

    // Windows on the back wall: a frame around a sky gradient (no real cutout needed).
    const sky = canvasTexture(64, 128, g => { const grad = g.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, '#6ec3f4'); grad.addColorStop(1, '#d8f1ff'); g.fillStyle = grad; g.fillRect(0, 0, 64, 128); g.fillStyle = '#ffffffcc'; g.beginPath(); g.ellipse(22, 40, 14, 6, 0, 0, 7); g.ellipse(34, 37, 10, 7, 0, 0, 7); g.fill(); });
    const count = Math.max(1, Math.floor(width / 4));
    for (let i = 0; i < count; i++) {
      const x = -width / 2 + (i + 0.5) * width / count;
      const frame = mesh(rounded(1.5, 1.3, 0.06, 0.03), toonMaterial('#ffffff'), 0.008); frame.position.set(x, 0.25, WALL_T / 2 + 0.03); back.add(frame);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.16), new THREE.MeshBasicMaterial({ map: sky, transparent: true })); glass.position.set(x, 0.25, WALL_T / 2 + 0.065); back.add(glass);
      const bar = mesh(new THREE.BoxGeometry(0.05, 1.16, 0.03), toonMaterial('#ffffff'), 0); bar.position.set(x, 0.25, WALL_T / 2 + 0.07); back.add(bar);
    }

    // Door in the front wall, facing into the room.
    const doorGroup = new THREE.Group(); doorGroup.position.set(door.x - width / 2, -WALL_H / 2, -WALL_T / 2 - 0.02); doorGroup.rotation.y = Math.PI; front.add(doorGroup);
    const panel = mesh(rounded(1.05, 2.15, 0.06, 0.03), toonMaterial('#9b6a43')); panel.position.y = 1.075; doorGroup.add(panel);
    const knob = mesh(new THREE.SphereGeometry(0.04, 12, 8), toonMaterial('#f2c14e'), 0.006); knob.position.set(0.4, 1.05, 0.06); doorGroup.add(knob);

    // Boards; boards.js draws on their faces. The whiteboard is on the left wall, the clock above the door, the waiting board beside it.
    const board = (w, h, frameColor) => { const g = new THREE.Group(); const frame = mesh(rounded(w + 0.1, h + 0.1, 0.05, 0.02), toonMaterial(frameColor), 0.008); g.add(frame); const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#ffffff' })); face.position.z = 0.03; g.add(face); g.userData.face = face; return g; };
    const whiteboard = board(2.4, 1.2, '#c0c4cc'); whiteboard.position.set(0, 0.15, WALL_T / 2 + 0.03); whiteboard.rotation.y = 0; left.add(whiteboard);
    whiteboard.rotation.y = 0;
    const clock = new THREE.Group(); const rim = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 32).rotateX(Math.PI / 2), toonMaterial('#2f3542'), 0.008); clock.add(rim);
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), new THREE.MeshBasicMaterial({ color: '#ffffff' })); clockFace.position.z = 0.032; clock.add(clockFace); clock.userData.face = clockFace;
    clock.position.set(door.x - width / 2, 2.55 - WALL_H / 2 + 0.05 + 0.0, -WALL_T / 2 - 0.04); clock.rotation.y = Math.PI; front.add(clock);
    const waiting = board(1.1, 0.8, '#8c6a4f'); waiting.position.set(door.x - width / 2 - 1.4, 0.0, -WALL_T / 2 - 0.03); waiting.rotation.y = Math.PI; front.add(waiting);
    room.boards = { whiteboard: whiteboard.userData.face, clock: clockFace, waiting: waiting.userData.face };

    // Ceiling tiles and round lamps; hidden as one group in the overview.
    const tiles = canvasTexture(128, 128, g => { g.fillStyle = '#fbf8f1'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#ddd6c6'; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128); });
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(width / 1.2, depth / 1.2);
    const ceiling = new THREE.Group(); shell.add(ceiling);
    const ceilingPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: tiles, transparent: true }));
    ceilingPlane.rotation.x = Math.PI / 2; ceilingPlane.position.set(width / 2, WALL_H, depth / 2); ceiling.add(ceilingPlane);
    for (let x = 2; x < width - 1; x += 4) for (let z = 2; z < depth - 1; z += 4) {
      const lamp = new THREE.Mesh(once('lamp', () => new THREE.CylinderGeometry(0.35, 0.4, 0.06, 24)), new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true }));
      lamp.position.set(x, WALL_H - 0.03, z); ceiling.add(lamp);
    }
    room.fadeables.ceiling = ceiling;
  }

  return room;
}

// Removes a subtree and frees what only it uses; shared geometries stay for the next desk and are freed with the scene on unmount.
function disposeTree(object, removeSelf = true) {
  const sharedGeometry = new Set(Object.values(shared));
  for (const child of [...object.children]) {
    child.traverse(node => {
      if (node.geometry && !sharedGeometry.has(node.geometry)) node.geometry.dispose();
      for (const material of [node.material].flat()) if (material && !material.userData?.shared) { material.map?.dispose(); if (material.type === 'MeshBasicMaterial') material.dispose(); }
    });
    if (!removeSelf || object !== child) child.removeFromParent();
  }
  if (removeSelf) object.removeFromParent();
}
