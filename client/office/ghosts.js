// Copies of what friends throw at a meeting (props.js and trickshot.js make them, office.js hears the throws): each flies by flight.js
// through this office's own boxes, where it hits nobody minds, then it fades and is gone. It's not one of your things: nothing of yours
// moves for it and it can't be clicked. Its looks are shared but for its materials, its own to fade. With reduced motion it's just
// where it lands, for as long as a fade would take. No document here.
import * as THREE from 'three';
import { advance, makeBody, turnBy } from './flight.js';

export const MOST = 12, LIFE = 6, FADE = 1; // copies at once, the oldest going first; seconds at most; seconds a fade takes
const ZERO = new THREE.Vector3(), ignore = () => {};

// How much of a copy shows `t` s after the throw: all of it till it rests (at `rested` s, or null still going), then none a FADE
// later. However long it flies, it's gone by LIFE.
export const ghostLife = (t, rested = null) => THREE.MathUtils.clamp((Math.min(rested ?? Infinity, LIFE - FADE) + FADE - t) / FADE, 0, 1);

// `world(pos)`: the boxes, columns and ceiling where it is (no onContact); `hidden(pos)`: in a room that isn't drawn now.
export function createGhosts({ world, hidden = () => false, reducedMotion = () => false }) {
  const ghosts = [];
  const drop = g => { g.mesh.removeFromParent(); for (const material of g.faded) material.dispose(); };
  const draw = (g, shown) => {
    const { body: b, mesh, centre } = g;
    mesh.visible = !hidden(b.pos); mesh.quaternion.copy(b.turn);
    mesh.position.copy(centre).applyQuaternion(b.turn).negate().add(b.pos);
    for (const material of g.faded) material.opacity = shown;
    for (const ink of g.inks) ink.visible = shown >= 1; // an outline doesn't fade: it goes
  };
  return {
    // `mesh`: a copy of how the thing looks, its middle at `kind.centre`, put in `parent`, whose frame `pos` is in.
    add(parent, mesh, kind, { pos, vel, spin }) {
      if (ghosts.length >= MOST) drop(ghosts.shift());
      const body = Object.assign(makeBody(kind, pos, vel), { turn: new THREE.Quaternion() }), faded = [], inks = [];
      body.spin.fromArray(spin);
      mesh.traverse(node => {
        node.raycast = ignore;
        if (node.userData.outline) inks.push(node);
        else if (node.material) { node.material = node.material.clone(); node.material.transparent = true; faded.push(node.material); }
      });
      const g = { body, mesh, centre: kind.centre ?? ZERO, faded, inks, t: 0, rested: null };
      if (reducedMotion()) { for (let i = 0; i < 600 && !body.rest; i++) { advance(body, 1 / 60, world(body.pos)); turnBy(body, 1 / 60); } g.rested = 0; }
      parent.add(mesh); ghosts.push(g); draw(g, 1);
    },
    update(dt) {
      if (!ghosts.length) return;
      const still = reducedMotion();
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i], b = g.body;
        g.t += dt;
        advance(b, dt, world(b.pos)); turnBy(b, dt);
        if (b.rest && g.rested === null) g.rested = g.t;
        const life = ghostLife(g.t, g.rested);
        if (life <= 0) { drop(g); ghosts.splice(i, 1); } else draw(g, still ? 1 : life);
      }
    },
    dispose() { for (const g of ghosts) drop(g); ghosts.length = 0; },
  };
}
