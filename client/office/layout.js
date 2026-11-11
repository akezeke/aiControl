// Where everyone sits: one pod of paired desks per project, pods on a grid, the door and an open start area at the front (+z).
// Pure, so it runs under node --test. Units are metres; the room spans x 0..width, z 0..depth.
// Everything is anchored at the back-left corner, pods keep their grid cell once placed, and the room only grows,
// so nobody already seated moves when projects come and go.
// ponytail: cells fit CELL_PAIRS pairs; a pod bigger than that widens every cell and shifts later columns once.
export const DESK_W = 1.6, DESK_D = 0.9, AISLE = 1.9, MAX_SUBAGENTS = 3, VACANT_MS = 30_000, DONE_MS = 60_000;
// The first column sits a little nearer the left wall (bookshelf and the kitchen doorway) than AISLE, leaving more room by the lounge.
const CHAIR = 0.9, START = 2.6, MIN_ROOM = 8, CELL_PAIRS = 3, LEFT = 1.5;
// The boss's glass office takes the back-left corner (boss-plan.js): its front glass's outer face is this far from the windows
// wall. The first column's pods start an aisle in front of it, the rest an aisle from the windows; the first column fills last
// in each row, so it's a pod short and the room no deeper for the office until every column's full.
export const BOSS_FRONT = 4.0;
const back = col => AISLE + (col === 0 ? BOSS_FRONT : 0);

// The left wall in front of the boss's glass (room.js): the bookshelf's middle (it's 0.9 long), then the whiteboard's (3.1 with
// its frame), in the middle of the wall unless that's on the shelf, as it is in the shallowest rooms.
export const SHELF_Z = BOSS_FRONT + 1.25, whiteboardZ = depth => Math.max(depth / 2, SHELF_Z + 0.45 + 0.1 + 1.55);

// Where the coffee counter stands along the door wall (world x), and the kitchen doorway in the left wall (world z).
export const KITCHEN_DOOR_W = 1.5, COFFEE_X = 1.05;
export const kitchenDoor = depth => depth - 1.5;
// How far the kitchen, and whoever's in it, moves when the room's depth changes.
export const kitchenShift = (before, after) => kitchenDoor(after) - kitchenDoor(before);

const podKey = session => session.cwd || session.project || 'Unknown';

// A desk's `rotation` is the yaw its sitter faces (0 = +z). Slot k is pair k >> 1; even slots face +z, odd face -z, across a shared desk edge.
const seat = (pod, slot) => ({ x: pod.left + DESK_W * ((slot >> 1) + 0.5), z: pod.z + (slot % 2 ? DESK_D / 2 : -DESK_D / 2), rotation: slot % 2 ? Math.PI : 0 });

// The layout as the server sends it (server/seats.mjs), desks as a list, back in the form everything here reads.
export const sharedLayout = office => ({ ...office, desks: new Map(office.desks.map(desk => [desk.sessionId, desk])) });

// A session that ends keeps its (empty) desk for VACANT_MS, so it can walk out and the pod doesn't jump at once.
// `reserved` is Map<podKey, slots, oldest first>: slots asked for by a spawn, which the next newcomers take if still free.
export function layoutOffice(sessions, previous, now = Date.now(), reserved = new Map()) {
  const top = sessions.filter(s => !s.parentId), ids = new Set(top.map(s => s.id));
  for (const [id, old] of previous?.desks || []) {
    if (ids.has(id)) continue;
    const since = old.vacantSince ?? now;
    if (now - since >= VACANT_MS) continue;
    const pod = previous.pods.find(p => p.key === old.podKey);
    top.push({ id, cwd: old.podKey, project: pod?.name, vacantSince: since });
  }
  const groups = new Map();
  for (const session of top) {
    const key = podKey(session);
    if (!groups.has(key)) groups.set(key, { key, name: session.project || 'Unknown', sessions: [] });
    groups.get(key).sessions.push(session);
  }
  const pods = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  // Seats saved from an earlier page (`saved`): the columns and rows nobody here now uses close up, everyone keeping their
  // order, so a project that's gone doesn't leave an empty stretch of floor behind for good.
  if (previous?.saved) {
    const here = new Set(pods.map(pod => pod.key)), kept = previous.pods.filter(pod => here.has(pod.key));
    const used = axis => [...new Set(kept.map(pod => pod[axis]))].sort((a, b) => a - b), cols = used('col'), rows = used('row');
    previous = { ...previous, pods: kept.map(pod => ({ ...pod, col: cols.indexOf(pod.col), row: rows.indexOf(pod.row) })), grid: { cols: Math.max(1, cols.length), cellW: 0 } };
  }

  // Seats from the previous layout stay put; newcomers take the lowest free slot.
  for (const pod of pods) {
    const slots = [], kept = new Set();
    for (const session of pod.sessions) {
      const old = previous?.desks.get(session.id);
      if (old?.podKey === pod.key && slots[old.slot] === undefined) { slots[old.slot] = session.id; kept.add(session.id); }
    }
    // By id, so a fresh page seats everyone the same way whatever order the snapshot lists them in.
    const wanted = [...reserved.get(pod.key) || []];
    for (const session of [...pod.sessions].sort((a, b) => a.id.localeCompare(b.id))) {
      if (kept.has(session.id)) continue;
      // Someone who has left only holds a seat until it's asked for: they're off the floor once its agent arrives.
      const open = slot => slots[slot] === undefined || pod.sessions.some(other => other.id === slots[slot] && other.vacantSince !== undefined);
      let slot = wanted.shift();
      while (slot !== undefined && !open(slot)) slot = wanted.shift();
      if (slot === undefined) { slot = 0; while (slots[slot] !== undefined) slot++; }
      slots[slot] = session.id;
    }
    pod.slots = slots;
    // The folder the pod's sign starts another agent in (room.js), from someone still here, or as last known while the last of them leaves.
    pod.cwd = pod.sessions.find(session => session.cwd && session.vacantSince === undefined)?.cwd ?? previous?.pods.find(old => old.key === pod.key)?.cwd;
    pod.pairs = Math.max(1, Math.ceil(slots.length / 2));
    pod.width = pod.pairs * DESK_W;
    pod.depth = 2 * DESK_D + 2 * CHAIR;
  }

  // Grid: columns and cell size only ever grow; each pod keeps the cell it was first given.
  const grid = previous?.grid || { cols: 1, cellW: 0 };
  const cols = Math.max(grid.cols, Math.ceil(Math.sqrt(pods.length)));
  const cellW = Math.max(grid.cellW, CELL_PAIRS * DESK_W + AISLE, ...pods.map(p => p.width + AISLE)), cellD = 2 * DESK_D + 2 * CHAIR + AISLE;
  const before = new Map((previous?.pods || []).map(pod => [pod.key, pod])), taken = new Set();
  for (const pod of pods) { const old = before.get(pod.key); if (old && old.col < cols && !taken.has(`${old.col},${old.row}`)) { pod.col = old.col; pod.row = old.row; taken.add(`${pod.col},${pod.row}`); } }
  for (const pod of pods) {
    if (pod.col !== undefined) continue;
    const at = cell => [(cell + 1) % cols, Math.floor(cell / cols)];
    let cell = 0; while (taken.has(at(cell).join())) cell++;
    [pod.col, pod.row] = at(cell); taken.add(at(cell).join());
  }
  // As deep as the first column's first pod needs, at least, so the boss's office has its aisle and the left wall its shelf and whiteboard.
  const reach = ({ col, row }) => back(col) + (row + 1) * cellD + START;
  const width = Math.max(MIN_ROOM, previous?.room.width || 0, cols * cellW + AISLE), depth = Math.max(MIN_ROOM, previous?.room.depth || 0, reach({ col: 0, row: 0 }), ...pods.map(reach));

  const vacant = new Map(top.filter(s => s.vacantSince !== undefined).map(s => [s.id, s.vacantSince]));
  // A helper that's finished (idle since it last wrote) sits DONE_MS, then walks out (`leaving`) and is gone VACANT_MS later.
  // One already done when first seen never sits down.
  const kids = new Map(), done = session => session.status === 'idle' ? now - (session.updatedAt ?? now) : -Infinity;
  for (const session of sessions) if (session.parentId && ids.has(session.parentId) && done(session) < DONE_MS + VACANT_MS) {
    if (!kids.has(session.parentId)) kids.set(session.parentId, []);
    kids.get(session.parentId).push(session);
  }

  const desks = new Map();
  pods.forEach(pod => {
    pod.left = LEFT + pod.col * cellW;
    pod.x = pod.left + pod.width / 2;
    pod.z = back(pod.col) + pod.row * cellD + pod.depth / 2;
    pod.slots.forEach((id, slot) => {
      if (id === undefined) return;
      // Helpers keep the seats they had, newcomers after them in the order they came.
      const before = previous?.desks.get(id)?.subagents || [], rank = kid => { const i = before.indexOf(kid.id); return i < 0 ? before.length : i; };
      const children = (kids.get(id) || []).filter(kid => done(kid) < DONE_MS || before.includes(kid.id)).sort((a, b) => rank(a) - rank(b)), seated = children.slice(0, MAX_SUBAGENTS);
      desks.set(id, {
        sessionId: id, podKey: pod.key, slot, ...seat(pod, slot),
        subagents: seated.map(kid => kid.id), leaving: seated.filter(kid => done(kid) >= DONE_MS).map(kid => kid.id), overflow: Math.max(0, children.length - MAX_SUBAGENTS),
        ...(vacant.has(id) && { vacantSince: vacant.get(id) }),
      });
    });
  });

  return {
    pods: pods.map(pod => ({ key: pod.key, name: pod.name, cwd: pod.cwd, x: pod.x, z: pod.z, width: pod.width, depth: pod.depth, col: pod.col, row: pod.row,
      deskIds: pod.slots.filter(id => id !== undefined) })),
    desks, room: { width, depth }, door: { x: width / 2, z: depth }, grid: { cols, cellW },
  };
}
