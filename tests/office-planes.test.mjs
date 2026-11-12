import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice, DESK_W, DESK_D } from '../client/office/layout.js';
import { touch, gap, newFlight, launch, fly, stepFlight, autopilot, makeCourse, endless, holds, better, medal, medalTime, STEP, HOLE, TUBE, RIM, RINGS, LAUNCH, AHEAD } from '../client/office/planes-course.js';

const box = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
const room = (boxes = []) => ({ boxes, columns: [], ceiling: 3, width: 10, depth: 10 });
const ahead = (f, steps, input = {}, world = room(), course = { rings: [] }) => { const events = []; for (let i = 0; i < steps && f.mode === 'fly'; i++) stepFlight(f, input, world, course, events); return events; };

// The boss's office behind its glass in the back-left corner (boss-plan.js): the plane can fly in, rings keep out.
const BOSS_ROOM = box(0, 0, 0, 4.1, 3, 4);
// A rough office from layout.js: walls, desks (top, screen, chair), the signs over pods, the printer corner, the boss's office;
// thrown from by the cabinet. Someone at every desk, where they sit and where they stand up behind the chair.
function office(projects, perProject) {
  const sessions = [];
  for (let p = 0; p < projects; p++) for (let k = 0; k < perProject; k++) sessions.push({ id: `s${p}-${k}`, cwd: `/p${p}`, project: `P${p}` });
  const layout = layoutOffice(sessions, null, 0), { width, depth } = layout.room;
  const boxes = [box(-0.2, 0, 0, 0, 3, depth), box(width, 0, 0, width + 0.2, 3, depth), box(-0.2, 0, -0.2, width + 0.2, 3, 0), box(-0.2, 0, depth, width + 0.2, 3, depth + 0.2)], people = [];
  for (const d of layout.desks.values()) {
    const s = d.rotation ? -1 : 1;
    people.push({ x: d.x, z: d.z - s * 0.35, r: 0.24, top: 1.55 }, { x: d.x, z: d.z - s * 1.15, r: 0.24, top: 1.55 });
    boxes.push(box(d.x - DESK_W / 2, 0, d.z - DESK_D / 2 + s * 0.45, d.x + DESK_W / 2, 0.76, d.z + DESK_D / 2 + s * 0.45));
    boxes.push(box(d.x - 0.3, 0.75, d.z + s * 0.7 - 0.06, d.x + 0.3, 1.18, d.z + s * 0.7 + 0.06));
    boxes.push(box(d.x - 0.28, 0, d.z - s * 0.35 - 0.28, d.x + 0.28, 0.95, d.z - s * 0.35 + 0.28));
  }
  for (const pod of layout.pods) boxes.push(box(pod.x - 0.82, 2.13, pod.z - 0.05, pod.x + 0.82, 3, pod.z + 0.05));
  boxes.push(box(width - 0.62, 0, 0.94, width - 0.1, 1, 1.56), box(width - 0.6, 0, 1.77, width - 0.04, 1.02, 2.33), box(0, 0, 0.95, 0.4, 2.1, 1.95));
  return { width, depth, boxes, people, keepOut: [BOSS_ROOM], start: { x: width - 1.47, y: 1.4, z: 2.05, yaw: -Math.PI / 2 } };
}
const around = o => ({ ...room(o.boxes), columns: o.people.map((p, i) => ({ ...p, id: `p${i}` })), width: o.width, depth: o.depth });
const person = p => box(p.x - p.r, 0, p.z - p.r, p.x + p.r, p.top, p.z + p.r);
function inside(o, r, i) {
  assert.ok(r.x > 0.5 && r.z > 0.5 && r.x < o.width - 0.5 && r.z < o.depth - 0.5 && r.y - (r.hole ?? HOLE) - TUBE > 0.05 && r.y < 2.5, `ring ${i} in the room, its hoop off the floor`);
  assert.ok(gap(BOSS_ROOM, r.x, r.y, r.z) > 0.5, `ring ${i} out of the boss's office`);
  assert.ok(o.boxes.every(b => gap(b, r.x, r.y, r.z) > 0.5), `ring ${i} clear`);
  assert.ok(o.people.every(p => gap(person(p), r.x, r.y, r.z) > 0.5), `ring ${i} clear of people`);
}

test('touches the floor, the ceiling, the way out, people and things, and nothing out in the open', () => {
  const w = { ...room([box(4, 0, 4, 5, 1, 5)]), columns: [{ id: 'kiwi', x: 2, z: 2, r: 0.3, top: 1.6 }] };
  assert.equal(touch(w, 5, 0.02, 5).surface, 'floor');
  assert.equal(touch(w, 5, 2.99, 5).surface, 'ceiling');
  assert.equal(touch(w, -0.1, 1.5, 5).surface, 'away');
  assert.deepEqual(touch(w, 2.1, 1.2, 2), { surface: 'person', id: 'kiwi' });
  assert.equal(touch(w, 2.1, 1.8, 2), null); // over their head
  assert.equal(touch(w, 4.5, 1.03, 4.5).surface, 'box');
  assert.equal(touch(w, 7, 1.5, 7), null);
  assert.equal(gap(box(0, 0, 0, 1, 1, 1), 0.5, 0.5, 0.5), 0);
  assert.equal(gap(box(0, 0, 0, 1, 1, 1), 2, 0.5, 0.5), 1);
});

test('stays in hand until thrown, then glides on, slowly down, and ends on the floor', () => {
  const f = newFlight({ x: 1, y: 1.4, z: 1, yaw: Math.PI / 4 });
  assert.deepEqual(fly(f, {}, room(), { rings: [] }, 1), []); assert.equal(f.mode, 'ready');
  launch(f); assert.equal(f.mode, 'fly'); assert.equal(f.speed, LAUNCH);
  ahead(f, 120);
  assert.ok(f.x > 2 && f.z > 2 && Math.abs(f.x - f.z) < 1e-9, 'straight on the way it was thrown');
  assert.ok(f.y < 1.4 && f.y > 1, 'losing a little height');
  const events = ahead(f, 30 / STEP, {}, { ...room(), width: 99, depth: 99 });
  assert.equal(f.mode, 'over'); assert.deepEqual(events.at(-1), { type: 'crash', surface: 'floor' });
});

test('steering right turns it right, banking the same way', () => {
  const f = newFlight({ x: 5, y: 1.5, z: 2, yaw: 0 }); launch(f); // heading +z: right is -x
  ahead(f, 60, { steer: 1 });
  assert.ok(f.x < 5 && f.yaw < 0 && f.roll > 0.3);
});

test('held nose up it climbs, slowing to a gentle climb that keeps on: no dip first, no nosing over', () => {
  const f = newFlight({ x: 1, y: 1.5, z: 5, yaw: Math.PI / 2 }), world = { ...room(), width: 99, ceiling: 99 }; launch(f);
  let lowest = f.y, lowestPitch = Infinity, at4 = 0;
  for (let i = 0; i < 8 / STEP && f.mode === 'fly'; i++) {
    stepFlight(f, { climb: 1 }, world, { rings: [] }); lowest = Math.min(lowest, f.y);
    if (i * STEP > 1) lowestPitch = Math.min(lowestPitch, f.pitch);
    if (i === Math.round(4 / STEP)) at4 = f.y;
  }
  assert.equal(f.mode, 'fly'); assert.equal(lowest, 1.5, 'never below where it was thrown');
  assert.ok(at4 > 2.5, 'climbs'); assert.ok(f.y > at4 + 0.5, 'and keeps climbing, slow as it is');
  assert.ok(lowestPitch > 0, 'never noses over'); assert.ok(f.speed > 1, 'keeps flying speed');
});

test('a dive pulled up comes out higher than it went in', () => {
  const f = newFlight({ x: 1, y: 5, z: 5, yaw: Math.PI / 2 }), world = { ...room(), width: 99, ceiling: 99 }; launch(f);
  ahead(f, 10 / STEP, {}, world); const from = f.y; // gliding as it settles to, left be
  ahead(f, 0.7 / STEP, { climb: -1 }, world); assert.ok(f.y < from - 0.3, 'down');
  ahead(f, 2.3 / STEP, { climb: 1 }, world); assert.ok(f.y > from + 0.2, 'and up past where it was');
});

test('a ring lifts it a little as well as pushing it on', () => {
  const ring = { x: 3, y: 1.4, z: 5, nx: 1, ny: 0, nz: 0 }, go = rings => { const f = newFlight({ x: 2, y: 1.4, z: 5, yaw: Math.PI / 2 }); launch(f); f.pitch = 0; ahead(f, 1 / STEP, {}, room(), { rings }); return f; };
  const through = go([ring]), past = go([]);
  assert.equal(through.next, 1); assert.ok(through.y > past.y + 0.1, 'higher'); assert.ok(through.speed > past.speed, 'faster');
});

test('goes through a ring only forwards and inside it, and is pushed on', () => {
  const ring = { x: 3, y: 1.4, z: 5, nx: 1, ny: 0, nz: 0 }, course = { rings: [ring] };
  const through = (y, z, yaw) => { const f = newFlight({ x: yaw ? 1 : 5, y, z, yaw }); launch(f); f.pitch = 0; return [f, ahead(f, 1.2 / STEP, { climb: 0.2 }, room(), course)]; };
  const [f, events] = through(1.45, 5, Math.PI / 2);
  assert.deepEqual(events[0], { type: 'ring', index: 0 }); assert.deepEqual(events[1], { type: 'done' });
  assert.equal(f.next, 1); assert.ok(f.done > 0);
  assert.equal(through(1.45, 5, -Math.PI / 2)[0].next, 0, 'backwards');
  assert.equal(through(1.45, 5 + HOLE * 2.5, Math.PI / 2)[0].next, 0, 'well wide of it');
});

test('come at slantwise, a ring counts a little wider the way it slants, not the other way or head on', () => {
  const ring = { x: 3, y: 1.4, z: 5, nx: 1, ny: 0, nz: 0 }, course = { rings: [ring] }, R = HOLE + RIM;
  // Just short of the ring's face, at `angle` off square, to cross it `side` out across and `up` out up.
  const through = (angle, side, up = 0) => {
    const f = newFlight({ x: 3 - Math.cos(angle) * 0.01, y: 1.4 + up, z: 5 + side - Math.sin(angle) * 0.01, yaw: Math.atan2(Math.cos(angle), Math.sin(angle)) });
    launch(f); f.pitch = 0; ahead(f, 3, {}, room(), course); return f.next;
  };
  assert.equal(through(0, R * 0.95), 1); assert.equal(through(0, R * 1.1), 0, 'head on: the hole');
  assert.equal(through(0, HOLE + 0.05), 1, 'half over the rim still counts');
  assert.equal(through(0.9, R * 1.15), 1, 'slanted: wider that way');
  assert.equal(through(0.9, 0, R * 1.15), 0, 'not the other way');
  assert.equal(through(1.3, R * 1.6), 0, 'and only so wide');
});

test('the same seed and office lay the same course; another seed another', () => {
  const o = office(2, 3), make = seed => makeCourse({ ...o, seed });
  assert.deepEqual(make('a'), make('a'));
  assert.notDeepEqual(make('a').rings, make('b').rings);
});

test('courses keep inside the office, clear of everything and everyone, rings apart', () => {
  for (const [p, k] of [[1, 2], [3, 4], [9, 6]]) {
    const o = office(p, k);
    for (const seed of ['x', 'y', 'z']) {
      const { rings } = makeCourse({ ...o, seed });
      for (const [i, r] of rings.entries()) {
        inside(o, r, i);
        assert.ok(Math.abs(Math.hypot(r.nx, r.ny, r.nz) - 1) < 1e-9);
        assert.ok(rings.slice(0, i).every(q => Math.hypot(q.x - r.x, q.y - r.y, q.z - r.z) > 1.3));
      }
    }
  }
});

test("rings keep out of the boss's office, and so does the way to each", () => {
  let wouldGo = 0;
  for (const [p, k] of [[1, 2], [3, 4], [9, 6]]) {
    const o = office(p, k);
    for (const seed of ['x', 'y', 'z']) {
      wouldGo += makeCourse({ ...o, keepOut: [], seed }).rings.filter(r => gap(BOSS_ROOM, r.x, r.y, r.z) < 0.5).length;
      for (const rings of [makeCourse({ ...o, seed }).rings, endless({ ...o, seed }).rings]) for (const [i, r] of rings.entries()) {
        assert.ok(gap(BOSS_ROOM, r.x, r.y, r.z) > 0.5, `${p}x${k} ${seed}: ring ${i}`);
        const a = rings[i - 1] || o.start;
        for (let t = 0.1; t < 1; t += 0.1) assert.ok(gap(BOSS_ROOM, a.x + (r.x - a.x) * t, a.y + (r.y - a.y) * t, a.z + (r.z - a.z) * t) > 0.25, `${p}x${k} ${seed}: the way to ring ${i}`);
      }
    }
  }
  assert.ok(wouldGo > 0, 'left to it, some would be in there');
});

test("a course with a ring where rings keep out doesn't hold", () => {
  const o = office(3, 4), course = makeCourse({ ...o, seed: 'held' }), r = course.rings[3];
  assert.ok(holds(course, o));
  assert.ok(!holds(course, { ...o, keepOut: [box(r.x - 0.2, 0, r.z - 0.2, r.x + 0.2, 3, r.z + 0.2)] }));
});

test('rings come down low out in the open, the hoop never down on the floor', () => {
  let lowest = Infinity, floor = Infinity;
  for (const [p, k] of [[1, 2], [3, 4], [9, 6]]) {
    const o = office(p, k);
    for (const seed of ['x', 'y', 'z', 'w']) for (const r of [...makeCourse({ ...o, seed }).rings, ...endless({ ...o, seed }).rings]) {
      lowest = Math.min(lowest, r.y); floor = Math.min(floor, r.y - (r.hole ?? HOLE) - TUBE);
    }
  }
  assert.ok(lowest < 0.7, `the lowest at ${lowest.toFixed(2)}`);
  assert.ok(floor > 0.05, `a hoop ${floor.toFixed(2)} off the floor`);
});

test('offices big and small get a whole course the autopilot flies round, its time the par', () => {
  for (const [p, k] of [[1, 1], [1, 2], [2, 3], [4, 4], [6, 2], [9, 6]]) {
    const o = office(p, k), course = makeCourse({ ...o, seed: `day-${p}-${k}` }), world = around(o);
    assert.equal(course.rings.length, RINGS, `${p}x${k}`);
    const f = newFlight(o.start); launch(f);
    for (let i = 0; i < 60 / STEP && f.mode === 'fly' && f.done == null; i++) stepFlight(f, autopilot(f, course), world, course);
    assert.equal(f.next, RINGS, `${p}x${k} flown`);
    assert.equal(course.par, f.done, `${p}x${k} par`);
  }
});

test('medals: gold near par, then silver, bronze, none, to the tenth shown', () => {
  assert.equal(medal(20, 20), '🥇'); assert.equal(medalTime(20, 1.1), 22);
  assert.equal(medal(22.04, 20), '🥇'); assert.equal(medal(22.06, 20), '🥈');
  assert.equal(medal(26, 20), '🥈'); assert.equal(medal(32, 20), '🥉'); assert.equal(medal(32.1, 20), null);
  assert.equal(medal(null, 20), null); assert.equal(medal(10, null), null);
});

test('endless rings: some always laid ahead, each one the autopilot flies through, narrowing, and no end', () => {
  for (const [p, k] of [[1, 1], [4, 4], [9, 6]]) {
    const o = office(p, k), course = endless({ ...o, seed: `run-${p}-${k}` }), world = around(o);
    assert.deepEqual(endless({ ...o, seed: `run-${p}-${k}` }).rings, course.rings, 'the same for the same seed');
    const f = newFlight(o.start), events = []; launch(f);
    for (let i = 0; i < 90 / STEP && f.mode === 'fly' && f.next < 30; i++) {
      if (stepFlight(f, autopilot(f, course), world, course, events).some(e => e.type === 'ring')) course.more(f);
      assert.ok(course.rings.length > f.next + AHEAD, 'laid ahead');
    }
    assert.equal(f.next, 30, `${p}x${k} flown`); assert.ok(!events.some(e => e.type === 'done'));
    for (const [i, r] of course.rings.entries()) {
      inside(o, r, i);
      assert.ok(r.hole <= HOLE && r.hole >= 0.3 && (!i || r.hole <= course.rings[i - 1].hole), `ring ${i} narrowing`);
    }
  }
});

test('better: more rings, or as many sooner', () => {
  assert.ok(better({ rings: 3, time: null }, null));
  assert.ok(better({ rings: 4, time: null }, { rings: 3, time: null }));
  assert.ok(better({ rings: 10, time: 9 }, { rings: 10, time: 11 }));
  assert.ok(!better({ rings: 10, time: 12 }, { rings: 10, time: 11 }));
  assert.ok(!better({ rings: 2, time: null }, { rings: 3, time: null }));
});
