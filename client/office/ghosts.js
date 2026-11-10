// Copies of what friends throw at a meeting (props.js and trickshot.js make them, office.js hears the throws): each flies by flight.js
// through this office's own boxes, where it hits nobody minds, then it fades and is gone. It's not one of your things: nothing of yours
// moves for it and it can't be clicked. Its looks are shared but for its materials, its own to fade, and kept for the next copy of the
// same thing when it's gone: a see-through material is its own shader, and the last one of it disposed would take that shader along,
// to be compiled again (on a phone, a stutter) at the next throw. With reduced motion it's just where it lands, for as long as a fade
// would take. No document here.
import * as THREE from 'three';
import { advance, makeBody, turnBy } from './flight.js';

export const MOST = 12, LIFE = 6, FADE = 1; // copies at once, the oldest going first; seconds at most; seconds a fade takes
const ZERO = new THREE.Vector3(), ignore = () => {};

// How much of a copy shows `t` s after the throw: all of it till it rests (at `rested` s, or null still going), then none a FADE
// later. However long it flies, it's gone by LIFE.
export const ghostLife = (t, rested = null) => THREE.MathUtils.clamp((Math.min(rested ?? Infinity, LIFE - FADE) + FADE - t) / FADE, 0, 1);

// `world(pos)`: the boxes, columns and ceiling where it is (no onContact); `hidden(pos)`: in a room that isn't drawn now.
export function createGhosts({ world, hidden = () => false, reducedMotion = () => false }) {
  // spare: a material → its see-through copies not in use, never more than MOST (no more copies are ever out at once); sourceOf: copy → material.
  const ghosts = [], spare = new Map(), sourceOf = new Map();
  const seeThrough = source => { const material = spare.get(source)?.pop() ?? Object.assign(source.clone(), { transparent: true }); sourceOf.set(material, source); return material; };
  const drop = g => {
    g.mesh.removeFromParent();
    for (const material of g.faded) { const source = sourceOf.get(material); material.opacity = 1; if (!spare.has(source)) spare.set(source, []); spare.get(source).push(material); }
  };
  const draw = (g, shown) => {
    const { body: b, mesh, centre } = g;
    mesh.visible = !hidden(b.pos); mesh.quaternion.copy(b.turn);
    mesh.position.copy(centre).applyQuaternion(b.turn).negate().add(b.pos);
    for (const material of g.faded) material.opacity = shown;
    for (const ink of g.inks) ink.visible = shown >= 1; // an outline doesn't fade: it goes
  };
  // The copy of `mesh` made see-through, its body at `pos`, put in `parent` (whose frame `pos` is in); at most MOST, the oldest not held going first.
  const make = (parent, mesh, kind, pos, vel, spin) => {
    const free = ghosts.findIndex(g => !g.held); if (ghosts.length >= MOST && free >= 0) drop(ghosts.splice(free, 1)[0]);
    const body = Object.assign(makeBody(kind, pos, vel), { turn: new THREE.Quaternion() }), faded = [], inks = [];
    body.spin.fromArray(spin);
    mesh.traverse(node => {
      node.raycast = ignore;
      if (node.userData.outline) inks.push(node);
      else if (node.material) { node.material = seeThrough(node.material); faded.push(node.material); }
    });
    const g = { body, mesh, centre: kind.centre ?? ZERO, faded, inks, t: 0, rested: null, held: null };
    parent.add(mesh); ghosts.push(g); draw(g, 1);
    return g;
  };
  // With reduced motion: where it lands, at once.
  const settle = g => { const b = g.body; for (let i = 0; i < 600 && !b.rest; i++) { advance(b, 1 / 60, world(b.pos)); turnBy(b, 1 / 60); } g.rested = 0; draw(g, 1); };
  return {
    // `mesh`: a copy of how the thing looks, its middle at `kind.centre`, put in `parent`, whose frame `pos` is in.
    add(parent, mesh, kind, { pos, vel, spin }) { const g = make(parent, mesh, kind, pos, vel, spin); if (reducedMotion()) settle(g); },
    // A copy held at `at()` (in `parent`'s frame, as props.carry takes it) in the goose's beak: it doesn't age or fly. `release()` lets it fall
    // from there with no speed, and it fades as a thrown copy does (with reduced motion it's just where it lands). After clear() it does nothing.
    hold(parent, mesh, kind, at) {
      const g = make(parent, mesh, kind, at(), ZERO, [0, 0, 0]); g.held = at; draw(g, 1);
      return { release() { if (!g.held) return; g.held = null; g.t = 0; if (ghosts.includes(g) && reducedMotion()) settle(g); } };
    },
    update(dt) {
      if (!ghosts.length) return;
      const still = reducedMotion();
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i], b = g.body;
        if (g.held) { b.pos.copy(g.held()); draw(g, 1); continue; }
        g.t += dt;
        advance(b, dt, world(b.pos)); turnBy(b, dt);
        if (b.rest && g.rested === null) g.rested = g.t;
        const life = ghostLife(g.t, g.rested);
        if (life <= 0) { drop(g); ghosts.splice(i, 1); } else draw(g, still ? 1 : life);
      }
    },
    // Every copy gone at once (going through the door: they're this office's), their materials kept.
    clear() { for (const g of ghosts) drop(g); ghosts.length = 0; },
    dispose() { this.clear(); for (const material of sourceOf.keys()) material.dispose(); spare.clear(); sourceOf.clear(); },
  };
}
