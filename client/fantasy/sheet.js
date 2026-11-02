// A contact sheet for the harness: every class and enemy plan at once, each in its own cell at fighting distance, to look over the generators.
import * as THREE from 'three';
import { POSE, makeCharacter, setPose } from './characters.js';
import { PLANS, makeEnemy, makeHourglass, makeMinion } from './enemies.js';
import { newShared } from './rig.js';

const CLASSES = ['sage', 'duelist', 'rogue', 'knight', 'gunner'], POSES = ['stance', 'aim', 'gather', 'release', 'stepL', 'ready', 'cast', 'strike', 'windup', 'think', 'kneel', 'done'];
export function makeContactSheet(box) {
  const params = new URLSearchParams(location.search), W = box.clientWidth, H = box.clientHeight, renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setClearColor(0x6a6f5a, 1); renderer.setSize(W, H); box.append(renderer.domElement);
  const scene = new THREE.Scene(), shared = newShared({ value: params.get('look') === 'ps1' ? 0 : 1 }, { fog: 0x6a6f5a, sun: 0xfff0d8, sky: 0x8a8f80, bounce: 0x5a5340, dir: [-.4, .75, .55] }), taken = new Set(), cells = [], page = params.get('page') || 'party';
  const add = (root, tall, turn) => { root.position.set(cells.length * 60, 0, 0); root.rotation.y = turn; cells.push({ root, tall }); };
  if (page === 'party') for (const cls of CLASSES) for (let i = 0; i < 8; i++) { const char = makeCharacter({ id: `${cls}${i}`, cls, session: { id: `${cls}${i}` } }, scene, shared, taken); char.rig.show(true); setPose(char.rig.J, POSE[POSES[i]], 1); add(char.rig.root, 3.1, -.6); }
  else if (page === 'small') {
    for (const kind of ['bat', 'tome', 'imp']) for (let i = 0; i < 3; i++) { const minion = makeMinion(kind, `${kind}${i}`, scene, shared); minion.rig.show(true); add(minion.rig.root, 1.1, -.6); }
    const glass = makeHourglass(scene, shared); glass.show(true); add(glass.root, 1, 0);
  } else for (const [family, plans] of Object.entries(PLANS)) for (let plan = 0; plan < plans; plan++) for (let i = 0; i < 2; i++) { const enemy = makeEnemy(`${family}${plan}${i}`, family, scene, shared, 1, plan); enemy.rig.show(true); add(enemy.rig.root, Math.max(2.6, enemy.h), .6); enemy.anim(1, 0); }
  const columns = page === 'party' ? 8 : Math.ceil(Math.sqrt(cells.length * W / H)), rows = Math.ceil(cells.length / columns), cw = Math.floor(W / columns), ch = Math.floor(H / rows), camera = new THREE.PerspectiveCamera(30, cw / ch, 1, 200);
  scene.updateMatrixWorld(true); renderer.setScissorTest(true); renderer.autoClear = true;
  cells.forEach(({ root, tall }, i) => {
    const x = (i % columns) * cw, y = H - ((i / columns | 0) + 1) * ch, at = root.position, d = tall * 3.1;
    camera.position.set(at.x, tall * .55 + d * .18, d); camera.lookAt(at.x, tall * .5, 0);
    shared.uRes.value.set(cw, ch); renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch); renderer.render(scene, camera);
  });
  window.sheetDone = cells.length;
}
