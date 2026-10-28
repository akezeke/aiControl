// Where everyone sits: one pod of paired desks per project, pods on a grid, the door and an open start area at the front (+z).
// Pure, so it runs under node --test. Units are metres; the room spans x 0..width, z 0..depth.
// Everything is anchored at the back-left corner, pods keep their grid cell once placed, and the room only grows,
// so nobody already seated moves when projects come and go.
// ponytail: cells fit CELL_PAIRS pairs; a pod bigger than that widens every cell and shifts later columns once.
export const DESK_W = 1.6, DESK_D = 0.9, AISLE = 1.9, MAX_SUBAGENTS = 3, VACANT_MS = 30_000;
// The first column sits a little nearer the left wall (bookshelf and coffee corner) than AISLE, leaving more room by the lounge.
const CHAIR = 0.9, START = 2.6, MIN_ROOM = 8, CELL_PAIRS = 3, LEFT = 1.5;

const podKey = session => session.cwd || session.project || 'Unknown';

// A desk's `rotation` is the yaw its sitter faces (0 = +z). Slot k is pair k >> 1; even slots face +z, odd face -z, across a shared desk edge.
const seat = (pod, slot) => ({ x: pod.left + DESK_W * ((slot >> 1) + 0.5), z: pod.z + (slot % 2 ? DESK_D / 2 : -DESK_D / 2), rotation: slot % 2 ? Math.PI : 0 });

// A session that ends keeps its (empty) desk for VACANT_MS, so it can walk out and the pod doesn't jump at once.
export function layoutOffice(sessions, previous, now = Date.now()) {
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

  // Seats from the previous layout stay put; newcomers take the lowest free slot. That slot is also the pod's spare desk,
  // for starting another agent in its folder, so whoever you start there sits down at it.
  for (const pod of pods) {
    const slots = [], kept = new Set();
    for (const session of pod.sessions) {
      const old = previous?.desks.get(session.id);
      if (old?.podKey === pod.key && slots[old.slot] === undefined) { slots[old.slot] = session.id; kept.add(session.id); }
    }
    for (const session of pod.sessions) {
      if (kept.has(session.id)) continue;
      let slot = 0; while (slots[slot] !== undefined) slot++;
      slots[slot] = session.id;
    }
    pod.slots = slots;
    pod.cwd = pod.sessions.find(session => session.cwd && session.vacantSince === undefined)?.cwd;
    if (pod.cwd) { pod.spare = 0; while (slots[pod.spare] !== undefined) pod.spare++; }
    pod.pairs = Math.max(1, Math.ceil(Math.max(slots.length, pod.cwd ? pod.spare + 1 : 0) / 2));
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
    let cell = 0; while (taken.has(`${cell % cols},${Math.floor(cell / cols)}`)) cell++;
    pod.col = cell % cols; pod.row = Math.floor(cell / cols); taken.add(`${pod.col},${pod.row}`);
  }
  const rows = Math.max(1, ...pods.map(pod => pod.row + 1));
  const width = Math.max(MIN_ROOM, previous?.room.width || 0, cols * cellW + AISLE), depth = Math.max(MIN_ROOM, previous?.room.depth || 0, rows * cellD + AISLE + START);

  const vacant = new Map(top.filter(s => s.vacantSince !== undefined).map(s => [s.id, s.vacantSince]));
  const kids = new Map();
  for (const session of sessions) if (session.parentId && ids.has(session.parentId)) {
    if (!kids.has(session.parentId)) kids.set(session.parentId, []);
    kids.get(session.parentId).push(session.id);
  }

  const desks = new Map();
  pods.forEach(pod => {
    pod.left = LEFT + pod.col * cellW;
    pod.x = pod.left + pod.width / 2;
    pod.z = AISLE + pod.row * cellD + pod.depth / 2;
    pod.slots.forEach((id, slot) => {
      if (id === undefined) return;
      const children = kids.get(id) || [];
      desks.set(id, {
        sessionId: id, podKey: pod.key, slot, ...seat(pod, slot),
        subagents: children.slice(0, MAX_SUBAGENTS), overflow: Math.max(0, children.length - MAX_SUBAGENTS),
        ...(vacant.has(id) && { vacantSince: vacant.get(id) }),
      });
    });
  });

  return {
    pods: pods.map(pod => ({ key: pod.key, name: pod.name, cwd: pod.cwd, x: pod.x, z: pod.z, width: pod.width, depth: pod.depth, col: pod.col, row: pod.row,
      deskIds: pod.slots.filter(id => id !== undefined), spare: pod.cwd ? seat(pod, pod.spare) : null })),
    desks, room: { width, depth }, door: { x: width / 2, z: depth }, grid: { cols, cellW },
  };
}
