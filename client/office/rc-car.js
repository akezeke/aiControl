// The RC car's looks, for yours, the NPCs' and friends' at a meeting. A little open-wheel racer, built 36 cm long (drawn at
// SIZE), nose to +z: a rounded tub in the car's colour with side pods and a tapered nose with #1 on it, front and rear wings,
// the driver in a yellow helmet behind a small screen, two exhausts (a flame from each on a boost), fat rear wheels and slimmer
// front ones that steer, a white bar across each rim to show it turning, and a folded paper glider wing for the big jump.
// It's built once; every car is a clone sharing that geometry, its colour shared by every car of that colour, and only the
// lamps its own (each dims, brakes and lights up by itself).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMaterial, withOutline } from './toon.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, once } from './furniture.js';
import { SIZE } from './rc-physics.js';

// Parts are found again in a clone by name: body, driver, wing, wheel, front (a steering pivot), flame, pool, beam, lamp, tail.
// userData.paint: takes the car's colour; userData.own: a material of the car's own.
function build() {
  const car = new THREE.Group(), body = new THREE.Group(); body.name = 'body';
  const paint = toonMaterial('#e23b2a'), ink = toonMaterial('#24252c'), glass = toonMaterial('#3a4a5c'), yellow = toonMaterial('#ffd23f'), white = toonMaterial('#f4f1ea'), steel = toonMaterial('#8b8f99');
  const part = (geometry, material, x, y, z, parent = body) => {
    const m = withOutline(new THREE.Mesh(geometry, material), 0.004); m.position.set(x, y, z); m.userData.paint = material === paint; parent.add(m); return m;
  };
  const round = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, r);
  part(round(0.16, 0.045, 0.3, 0.016), paint, 0, 0.055, -0.01); // tub
  part(round(0.034, 0.047, 0.31, 0.012), white, 0, 0.0555, -0.01); // stripe
  part(round(0.095, 0.034, 0.13, 0.013), paint, 0, 0.05, 0.17); // nose
  part(round(0.03, 0.036, 0.132, 0.01), white, 0, 0.0505, 0.17);
  for (const x of [0.098, -0.098]) part(round(0.05, 0.048, 0.15, 0.016), paint, x, 0.058, -0.035); // side pods
  part(round(0.25, 0.01, 0.05, 0.004), ink, 0, 0.027, 0.215); // front wing
  for (const x of [0.125, -0.125]) part(new THREE.BoxGeometry(0.008, 0.03, 0.06), white, x, 0.035, 0.215);
  part(round(0.1, 0.012, 0.12, 0.005), ink, 0, 0.079, -0.035); // cockpit rim
  const number = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: canvasTexture(64, 64, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1, 0, 7); g.fill(); g.fillStyle = '#1b1c22'; g.font = '900 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1', w / 2, h / 2 + 3); }),
  }));
  number.position.set(0, 0.0675, 0.185); number.rotation.y = Math.PI; body.add(number);
  const screen = part(round(0.09, 0.03, 0.006, 0.002), glass, 0, 0.092, 0.035); screen.rotation.x = -0.5;
  // The driver: so it reads as someone driving it, not a toy. Hidden in their own view.
  const driver = new THREE.Group(); driver.name = 'driver'; body.add(driver);
  part(round(0.07, 0.05, 0.05, 0.015), toonMaterial('#3466d6'), 0, 0.1, -0.045, driver);
  part(new THREE.SphereGeometry(0.03, 18, 14), yellow, 0, 0.152, -0.04, driver);
  part(round(0.046, 0.016, 0.02, 0.006), ink, 0, 0.155, -0.017, driver); // visor
  part(round(0.03, 0.05, 0.04, 0.008), ink, 0, 0.115, -0.1); // roll hoop
  // Rear wing on two struts, end plates in the car's colour.
  part(round(0.22, 0.012, 0.055, 0.004), ink, 0, 0.148, -0.175);
  for (const x of [0.11, -0.11]) part(new THREE.BoxGeometry(0.008, 0.05, 0.07), paint, x, 0.14, -0.175);
  for (const x of [0.05, -0.05]) part(new THREE.BoxGeometry(0.01, 0.07, 0.02), ink, x, 0.11, -0.16);
  const fire = new THREE.MeshBasicMaterial({ color: '#ffb02e' });
  for (const x of [0.035, -0.035]) {
    part(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 10).rotateX(Math.PI / 2), steel, x, 0.06, -0.17);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.08, 8).rotateX(-Math.PI / 2), fire);
    flame.name = 'flame'; flame.position.set(x, 0.06, -0.235); flame.visible = false; body.add(flame);
  }
  // The glider: a paper delta over the driver, folded away (hidden) till the big jump unfolds it.
  const delta = new THREE.BufferGeometry().setFromPoints([[0, 0, 0.13], [0.5, 0.03, -0.17], [0, -0.01, -0.1], [0, 0, 0.13], [0, -0.01, -0.1], [-0.5, 0.03, -0.17]].map(p => new THREE.Vector3(...p)));
  delta.computeVertexNormals();
  const wing = new THREE.Mesh(delta, toonMaterial('#fbfaf6', { side: THREE.DoubleSide })); wing.name = 'wing'; wing.position.set(0, 0.2, -0.04); wing.visible = false; body.add(wing);
  car.add(body); car.scale.setScalar(SIZE);
  for (const [x, z, r, w] of [[0.105, 0.125, 0.04, 0.04], [-0.105, 0.125, 0.04, 0.04], [0.115, -0.115, 0.05, 0.06], [-0.115, -0.115, 0.05, 0.06]]) {
    const pivot = new THREE.Group(), wheel = new THREE.Group(); pivot.position.set(x, r, z); pivot.name = z > 0 ? 'front' : 'rear'; wheel.name = 'wheel';
    wheel.add(withOutline(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), ink), 0.004));
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.003, 14).rotateZ(Math.PI / 2), yellow));
    wheel.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.005, r * 0.18, r * 1.1), white));
    wheel.userData.r = r * SIZE; pivot.add(wheel); car.add(pivot);
  }
  // Lights, faked (lights.js: a new light would recompile every material): lamps on the nose and brake lights on the rear wing,
  // and in the dark a warm pool on the floor ahead and two faint beams, added on, so they brighten whatever they fall on.
  const glow = canvasTexture(128, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const added = extra => new THREE.MeshBasicMaterial({ color: '#ffe6a8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...extra });
  const own = (mesh, name) => { mesh.name = name; mesh.userData.own = true; return mesh; };
  const pool = own(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3).rotateX(-Math.PI / 2), added({ map: glow, polygonOffset: true, polygonOffsetFactor: -2 })), 'pool');
  pool.position.set(0, 0.032, 1.75); pool.visible = false; car.add(pool); // just over the rugs
  const beam = added({ side: THREE.DoubleSide }), cone = new THREE.ConeGeometry(0.32, 2.2, 16, 1, true).translate(0, -1.1, 0).rotateX(-Math.PI / 2);
  for (const x of [0.028, -0.028]) { const m = own(new THREE.Mesh(cone, beam), 'beam'); m.position.set(x, 0.05, 0.24); m.visible = false; body.add(m); }
  const front = new THREE.MeshBasicMaterial({ color: '#e8e1c8', toneMapped: false }), tail = new THREE.MeshBasicMaterial({ color: '#6a1414', toneMapped: false });
  for (const x of [0.028, -0.028]) { const lamp = own(new THREE.Mesh(new THREE.CircleGeometry(0.013, 14), front), 'lamp'); lamp.position.set(x, 0.05, 0.238); body.add(lamp); }
  for (const x of [0.11, -0.11]) { const lamp = own(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.022, 0.006), tail), 'tail'); lamp.position.set(x, 0.135, -0.212); body.add(lamp); }
  return car;
}

const ignore = () => {};
// A car in `colour`; `driver` false leaves the driver out (yours, seen from their seat, hides it as it goes).
// → { car, body, driver, wing, wheels, fronts, flames, lamps: { pool, beam, beams, front, tail } }
export function buildCar({ colour = '#e23b2a', driver = true } = {}) {
  const car = once('rcCar', build).clone(true), paint = once(`rcCar:${colour}`, () => toonMaterial(colour)), owned = new Map();
  const parts = { car, wheels: [], fronts: [], flames: [], beams: [], owned };
  car.traverse(node => {
    node.raycast = ignore; // clones don't keep it
    if (node.userData.paint) node.material = paint;
    if (node.userData.own) { if (!owned.has(node.material)) owned.set(node.material, node.material.clone()); node.material = owned.get(node.material); }
    if (node.name === 'body' || node.name === 'driver' || node.name === 'wing') parts[node.name] = node;
    else if (node.name === 'wheel') parts.wheels.push(node);
    else if (node.name === 'front') parts.fronts.push(node);
    else if (node.name === 'flame') parts.flames.push(node);
    else if (node.name === 'beam') parts.beams.push(node);
    else if (node.name === 'pool') parts.pool = node;
    else if (node.name === 'lamp') parts.front = node.material;
    else if (node.name === 'tail') parts.tail = node.material;
  });
  parts.driver.visible = driver;
  parts.lamps = { pool: parts.pool, beam: parts.beams[0].material, beams: parts.beams, front: parts.front, tail: parts.tail };
  return parts;
}

// An NPC's car or the parked one (buildCar's parts) in a dozen draw calls, not 65: everything but its flames, wing and lamps' light merged into a
// mesh per material on its body, outlines too (their outlineNormal turned as the normals are). Its wheels go in with it, so an
// NPC's don't turn or steer (wheels and fronts come back empty). → parts, the merged geometry in parts.baked.
export function lighten(parts) {
  const { car, body } = parts, moving = new Set([...parts.flames, parts.wing, parts.pool, ...parts.beams]), groups = new Map(), taken = [];
  car.updateMatrixWorld(true);
  const into = new THREE.Matrix4().copy(body.matrixWorld).invert(), m = new THREE.Matrix4(), n = new THREE.Matrix3();
  car.traverse(node => { if (node.isMesh && !moving.has(node)) taken.push(node); });
  for (const node of taken) {
    m.multiplyMatrices(into, node.matrixWorld); n.getNormalMatrix(m);
    const g = (node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone()).applyMatrix4(m);
    g.attributes.outlineNormal?.applyNormalMatrix(n);
    if (!groups.has(node.material)) groups.set(node.material, { list: [], outline: !!node.userData.outline });
    groups.get(node.material).list.push(g);
  }
  for (const node of taken) node.removeFromParent();
  for (const pivot of [...parts.fronts, ...car.children.filter(c => c.name === 'rear')]) pivot.removeFromParent();
  parts.baked = [];
  for (const [material, { list, outline }] of groups) {
    // Only what every piece has (a decal's uv, say, where the rest have none) can be merged.
    const names = Object.keys(list[0].attributes).filter(name => list.every(g => g.attributes[name]));
    for (const g of list) for (const name of Object.keys(g.attributes)) if (!names.includes(name)) g.deleteAttribute(name);
    const merged = mergeGeometries(list); parts.baked.push(merged);
    const mesh = new THREE.Mesh(merged, material); mesh.raycast = ignore; if (outline) mesh.userData.outline = true;
    body.add(mesh);
  }
  parts.wheels = []; parts.fronts = [];
  return parts;
}

// What's this car's own: its lamps' materials (and a lightened car's merged geometry). The rest stays, for the next car.
export const disposeCar = parts => { for (const m of parts.owned.values()) m.dispose(); for (const g of parts.baked || []) g.dispose(); parts.car.removeFromParent(); };
