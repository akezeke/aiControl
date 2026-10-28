// Where everyone sits: one pod of paired desks per project, pods on a grid, the door and an open start area at the front (+z).
// Pure, so it runs under node --test. Units are metres; the room spans x 0..width, z 0..depth.
// Everything is anchored at the back-left corner so a growing pod or grid only extends right and forward and nobody already seated moves.
// ponytail: when the widest pod gains a pair, pods in later columns still shift right; fixed-width cells if that's distracting.
export const DESK_W = 1.6, DESK_D = 0.9, AISLE = 2.4, MAX_SUBAGENTS = 3;
const CHAIR = 1, START = 4, MIN_ROOM = 10;

const podKey = session => session.cwd || session.project || 'Unknown';

// A desk's `rotation` is the yaw its sitter faces (0 = +z). Slot k is pair k >> 1; even slots face +z, odd face -z, across a shared desk edge.
export function layoutOffice(sessions, previous) {
  const top = sessions.filter(s => !s.parentId), ids = new Set(top.map(s => s.id));
  const groups = new Map();
  for (const session of top) {
    const key = podKey(session);
    if (!groups.has(key)) groups.set(key, { key, name: session.project || 'Unknown', sessions: [] });
    groups.get(key).sessions.push(session);
  }
  const pods = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  // Seats from the previous layout stay put; newcomers take the lowest free slot.
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
    pod.pairs = Math.max(1, Math.ceil(slots.length / 2));
    pod.width = pod.pairs * DESK_W;
    pod.depth = 2 * DESK_D + 2 * CHAIR;
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(pods.length))), rows = Math.max(1, Math.ceil(pods.length / cols));
  const cellW = Math.max(DESK_W, ...pods.map(p => p.width)) + AISLE, cellD = Math.max(...pods.map(p => p.depth), 2 * DESK_D + 2 * CHAIR) + AISLE;
  const width = Math.max(MIN_ROOM, cols * cellW + AISLE), depth = Math.max(MIN_ROOM, rows * cellD + AISLE + START);

  const kids = new Map();
  for (const session of sessions) if (session.parentId && ids.has(session.parentId)) {
    if (!kids.has(session.parentId)) kids.set(session.parentId, []);
    kids.get(session.parentId).push(session.id);
  }

  const desks = new Map();
  pods.forEach((pod, i) => {
    pod.left = AISLE + (i % cols) * cellW;
    pod.x = pod.left + pod.width / 2;
    pod.z = AISLE + Math.floor(i / cols) * cellD + pod.depth / 2;
    pod.slots.forEach((id, slot) => {
      if (id === undefined) return;
      const side = slot % 2, pair = slot >> 1, children = kids.get(id) || [];
      desks.set(id, {
        sessionId: id, podKey: pod.key, slot,
        x: pod.left + DESK_W * (pair + 0.5),
        z: pod.z + (side ? DESK_D / 2 : -DESK_D / 2),
        rotation: side ? Math.PI : 0,
        subagents: children.slice(0, MAX_SUBAGENTS), overflow: Math.max(0, children.length - MAX_SUBAGENTS),
      });
    });
  });

  return {
    pods: pods.map(({ key, name, x, z, width, depth: d, slots }) => ({ key, name, x, z, width, depth: d, deskIds: slots.filter(id => id !== undefined) })),
    desks, room: { width, depth }, door: { x: width / 2, z: depth },
  };
}
