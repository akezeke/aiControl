// A session's face for the menus: the character from its fight, drawn once to a small picture and kept. The context lives only while pictures are being drawn.
import * as THREE from 'three';
import { POSE, WORN, makeCharacter, setPose } from './characters.js';
import { makeMinion } from './enemies.js';
import { newShared } from './rig.js';
import { classOf, minionKindOf } from './roster.js';

const SIZE = 112, faces = new Map(), waiting = new Map(), shown = new Map();
let stage = null, closing = 0;
const open = () => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setClearColor(0, 0); renderer.setSize(SIZE, SIZE, false);
  const shared = newShared({ value: 1 }, { fog: 0x6a6f5a, sun: 0xfff0d8, sky: 0xa8b0a0, bounce: 0x6a6048, dir: [-.45, .75, .6] });
  shared.uRes.value.set(SIZE, SIZE);
  return { renderer, shared, camera: new THREE.PerspectiveCamera(26, 1, .1, 60) };
};
const close = () => { stage?.renderer.dispose(); stage?.renderer.forceContextLoss(); stage = null; };

function draw(session, cloth) {
  stage ??= open();
  const { renderer, shared, camera } = stage, scene = new THREE.Scene();
  const rig = session.parentId ? makeMinion(minionKindOf(session.title), session.id, scene, shared).rig : makeCharacter({ id: session.id, cls: classOf(session), session, cloth }, scene, shared, new Set()).rig;
  rig.show(true); if (!session.parentId) setPose(rig.J, POSE.stance, 1);
  rig.root.rotation.y = -.5; scene.updateMatrixWorld(true);
  // A person's head and shoulders; all of a minion, which is hardly more than a head.
  const at = new THREE.Vector3(0, .08, 0), distance = session.parentId ? 2.5 : 1.75;
  if (!session.parentId) { rig.J.head.getWorldPosition(at); at.y -= .02; }
  camera.position.set(at.x, at.y + distance * .05, at.z + distance); camera.lookAt(at);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', .9);
  scene.traverse(node => { node.geometry?.dispose(); });
  return url;
}
function drain() {
  const next = waiting.entries().next().value;
  if (!next) { clearTimeout(closing); closing = setTimeout(close, 800); return; }
  const [key, { session, cloth, nodes }] = next; waiting.delete(key);
  try { const url = draw(session, cloth); faces.set(key, url); for (const node of nodes) wear(node, key, url); } catch { faces.set(key, null); }
  setTimeout(drain);
}
const wear = (node, key, url) => { if (node.dataset.face === key && url) { node.style.setProperty('--fy-face', `url(${url})`); node.classList.add('fy-faced'); } };

// `node` shows the face in --fy-face once there is one; until then, and without WebGL, it keeps what it had. A list drawn before the fight has to guess the colours, so once the fight has settled them every picture of that person follows.
export function paintPortrait(node, session) {
  const cloth = WORN.get(session.id), key = `${session.id}|${cloth ?? ''}`, same = shown.get(session.id) ?? new Set();
  shown.set(session.id, same); same.add(node);
  for (const other of same) if (!other.isConnected && other !== node) same.delete(other); else if (other !== node && other.dataset.face !== key) put(other, session, cloth, key);
  put(node, session, cloth, key);
}
function put(node, session, cloth, key) {
  if (node.dataset.face === key) return;
  node.dataset.face = key;
  if (faces.has(key)) { wear(node, key, faces.get(key)); return; }
  const queued = waiting.get(key);
  if (queued) { queued.nodes.add(node); return; }
  waiting.set(key, { session, cloth, nodes: new Set([node]) });
  clearTimeout(closing);
  if (waiting.size === 1) setTimeout(drain);
}
