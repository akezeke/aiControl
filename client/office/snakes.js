// The other players' snakes in a meeting, played back from the `snake` messages their games send (office.js feeds them in),
// each in its player's look with their name over its head, while friends.js hides their fruit. Built from a player's first
// message; dropped on 'off', after SILENCE s without a message (an 'off' can be lost), or when they or you leave the meeting.
import * as THREE from 'three';
import { DIRS, unpack } from './snake.js';
import { createSnakeModel } from './snake-model.js';
import { tag, atMeeting } from './friends.js';

// Seconds without a message before a snake's dropped; cells a body's looked for moved on by, at most; cells waiting before it
// plays faster; metres the name sits over the head.
const SILENCE = 5, BACK = 32, BEHIND = 3, OVER = 0.45;
const same = (a, b) => a === b || !!a && !!b && a[0] === b[0] && a[1] === b[1];
const ignored = () => {};

// How many new head cells `now` is `old` moved on by: the fewest (up to BACK) with the rest of `now` the front of `old`, at
// least one cell kept. -1 if it doesn't follow on.
export function movedOn(old, now) {
  for (let k = 0; k <= Math.min(now.length - 1, BACK); k++) {
    if (now.length - k > old.length) continue;
    let i = k; while (i < now.length && same(now[i], old[i - k])) i++;
    if (i === now.length) return k;
  }
  return -1;
}

// One player's snake, played back from what they send. Each message's new head cells are queued and played at their rate, a
// cell a step, drawn with the game's own prev → body lerp (`s` is snake-shaped, for the model); twice as fast once more than
// BEHIND wait, till it's caught up. It grows to the length heard. A message that doesn't follow on from the last one heard
// (some lost, another tab, a new game) snaps to it. Food moving off a cell that's queued was eaten there: `advance` gives
// 'gulp' and puts out the new food when the head gets to it.
export function createPlayback() {
  const s = { body: [], prev: [], acc: 1, dir: 0, mode: 'ready', rate: 8, stall: 0 }, queue = [], meals = []; // meals: { at, then }, held food changes
  let last = null, lastFood = null, target = 0, fast = false; // the last body and food heard; the length to grow to
  const playback = {
    s, food: null,
    get waiting() { return queue.length; },
    heard(m) {
      const body = unpack(m), food = m.food ?? null, k = last ? movedOn(last, body) : -1;
      s.mode = m.mode; s.rate = m.rate;
      if (k < 0) { s.body = s.prev = body; s.acc = 1; s.dir = m.dir; queue.length = meals.length = 0; fast = false; playback.food = food; }
      else {
        for (let i = k - 1; i >= 0; i--) queue.push(body[i]);
        // Eaten on the way, or moved: then the food shown after any held ones is the new one.
        if (!same(food, lastFood)) {
          if (lastFood && queue.some(c => same(c, lastFood))) meals.push({ at: lastFood, then: food });
          else if (meals.length) meals.at(-1).then = food;
          else playback.food = food;
        }
      }
      last = body; lastFood = food; target = body.length;
    },
    advance(dt) {
      if (queue.length > BEHIND) fast = true;
      s.acc += dt * s.rate * (fast ? 2 : 1);
      let gulp = null;
      while (s.acc >= 1 && queue.length) {
        const next = queue.shift(); s.acc -= 1;
        s.prev = s.body; s.body = [next, ...s.body].slice(0, Math.min(s.body.length + 1, target));
        const [a, b] = s.body, d = b ? DIRS.findIndex(([x, z]) => x === Math.sign(a[0] - b[0]) && z === Math.sign(a[1] - b[1])) : -1;
        if (d >= 0) s.dir = d;
        if (meals.length && same(next, meals[0].at)) { playback.food = meals.shift().then; gulp = 'gulp'; }
      }
      if (!queue.length) { fast = false; s.acc = Math.min(s.acc, 1); }
      return gulp;
    },
  };
  return playback;
}

// `room`: for its shut kitchen and secret room. `clock`: seconds, for how long a snake's been quiet.
export function createSnakes(scene, { room, reducedMotion = () => false, clock = () => performance.now() / 1000 }) {
  const snakes = new Map(); // id → { group, sprite, model, playback, look, name, colour, plant, at (heard) }
  let here = new Map(); // who's at the meeting, by id, at the last sync

  // Its model in their look, again when that changes; the old one's freed (not the head or food, which are shared).
  function dress(n, p) {
    if (n.model) { n.model.root.removeFromParent(); n.model.dispose(); }
    n.model = createSnakeModel({ fruit: p.fruit, colour: p.colour }); n.look = `${p.fruit}${p.colour}`;
    n.model.root.traverse(o => { o.raycast = ignored; }); // not clickable, as friends aren't
    n.model.set(n.playback.s); n.model.face(); n.group.add(n.model.root);
  }
  function build(p) {
    const group = new THREE.Group(), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag(p.name, p.colour), transparent: true, toneMapped: false, depthWrite: false }));
    sprite.renderOrder = 4; sprite.scale.set(0.8, 0.2, 1); sprite.raycast = ignored; group.add(sprite); scene.add(group);
    return { group, sprite, model: null, playback: createPlayback(), look: '', name: p.name, colour: p.colour, plant: 0, at: 0 };
  }
  function drop(id) {
    const n = snakes.get(id); if (!n) return;
    n.group.removeFromParent(); n.model.root.removeFromParent(); n.model.dispose();
    n.sprite.material.map.dispose(); n.sprite.material.dispose(); n.sprite.removeFromParent();
    snakes.delete(id);
  }

  return {
    // `me` is your own id; `show` false (you're not at the meeting) shows none. Drops the snakes of whoever's left; a new look
    // is built again, a new name or colour written again.
    sync(roster, me, show = true) {
      here = new Map(show ? atMeeting(roster, me).map(p => [p.id, p]) : []);
      for (const [id, n] of snakes) {
        const p = here.get(id);
        if (!p) { drop(id); continue; }
        if (n.look !== `${p.fruit}${p.colour}`) dress(n, p);
        if (n.name !== p.name || n.colour !== p.colour) { n.name = p.name; n.colour = p.colour; n.sprite.material.map.dispose(); n.sprite.material.map = tag(p.name, p.colour); }
      }
    },
    // A snake message from `id`: built on the first that isn't 'off', from anyone at the meeting.
    heard(id, m) {
      const p = here.get(id); if (!p) return;
      if (m.mode === 'off') { drop(id); return; }
      let n = snakes.get(id); const fresh = !n;
      if (fresh) snakes.set(id, n = build(p));
      n.playback.heard(m); n.plant = m.plant; n.at = clock();
      if (fresh) dress(n, p);
    },
    // Whose snake started from that plant, or null.
    taken(plant) { for (const n of snakes.values()) if (n.plant === plant) return n.name; return null; },
    has(id) { return snakes.has(id); },
    // Every snake in ready or play with its food showing: { food, head } as cells' centres, copies, for the goose.
    foods() { const out = []; for (const n of snakes.values()) { const { s, food } = n.playback; if ((s.mode === 'ready' || s.mode === 'play') && food && s.body[0]) out.push({ food: [...food], head: [...s.body[0]] }); } return out; },
    update(dt) {
      const reduced = reducedMotion(), now = clock();
      for (const [id, n] of snakes) {
        if (now - n.at > SILENCE) { drop(id); continue; }
        if (n.playback.advance(dt) && !reduced) n.model.gulp();
        n.model.food(n.playback.food); n.model.update(dt, reduced);
        // Its head in a shut room: behind that room's wall, as a friend would be.
        const head = n.model.head.position;
        n.group.visible = !(room.kitchen.inside(head) && !room.kitchen.shown) && !(room.secret.inside(head) && !room.secret.shown);
        n.sprite.position.set(head.x, head.y + OVER, head.z);
      }
    },
    dispose() { for (const id of snakes.keys()) drop(id); here = new Map(); },
  };
}
