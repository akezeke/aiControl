// The pure parts of the shared goose, with no three.js so they run under node --test: who keeps the goose, playing a plan's
// route back, easing a replayed goose onto its plan, where it stands by the food, and how often plans go out.
import { CELL, index } from './path.js';
import { CLEAR, centre, reach } from './snake.js';

// Whether this page runs the goose (keeper), replays it (watcher) or has it to itself (home: no meeting, or a hub that marks no keeper).
export function gooseRole(players, me) {
  const mine = me && players.find(p => p.id === me && p.at === 'meeting');
  const keeper = mine && players.find(p => p.at === 'meeting' && p.goose);
  return !keeper ? { role: 'home', keeper: null } : { role: keeper.id === me ? 'keeper' : 'watcher', keeper: keeper.id };
}

// Where a goose at `at` has got to after `seconds` along `route` (waypoints still ahead) at `speed` m/s: its spot, the route left,
// whether it's still moving and the unit heading of the leg it's on. At the end it stands.
export function routeAt(at, route, speed, seconds) {
  let left = Math.max(0, seconds) * speed, [x, z] = at, i = 0, dir = null;
  for (; i < route.length; i++) {
    const [tx, tz] = route[i], len = Math.hypot(tx - x, tz - z);
    if (len > 0) dir = [(tx - x) / len, (tz - z) / len];
    if (len > left) { x += dir[0] * left; z += dir[1] * left; return { at: [x, z], route: route.slice(i), moving: true, dir }; }
    left -= len; x = tx; z = tz;
  }
  return { at: [x, z], route: [], moving: false, dir: null };
}

// A drawn goose further than JUMP metres off its plan snaps to it; nearer, the offset eases away by exp(-EASE t).
export const JUMP = 1, EASE = 4;
export const gapOf = (drawn, planned) => { const g = [drawn[0] - planned[0], drawn[1] - planned[1]]; return Math.hypot(...g) > JUMP ? [0, 0] : g; };
export const eased = (offset, dt) => offset.map(v => v * Math.exp(-EASE * dt));

// Open cells 0.75 to 1 m from the food (centres), from which a block of radius r still leaves the food's cell reachable from `head`.
export function standSpots(grid, food, head, r = 0.2) {
  const goal = index(grid, { x: food[0], z: food[1] }), spots = [], c0 = Math.floor((food[0] - grid.left) / CELL), r0 = Math.floor((food[1] - grid.back) / CELL);
  for (let j = r0 - 4; j <= r0 + 4; j++) for (let i = c0 - 4; i <= c0 + 4; i++) {
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows || !grid.open[j * grid.cols + i]) continue;
    const spot = centre(grid, j * grid.cols + i), d = Math.hypot(spot[0] - food[0], spot[1] - food[1]);
    if (d < 0.75 - 1e-9 || d > 1 + 1e-9) continue;
    if (goal >= 0 && reach(grid, head, [{ x: spot[0], z: spot[1], r }])[goal] >= 0) spots.push(spot);
  }
  return spots;
}
// The spot nearest `at`, or null.
export const nearestSpot = (spots, at) => spots.reduce((best, s) => !best || Math.hypot(s[0] - at[0], s[1] - at[1]) < Math.hypot(best[0] - at[0], best[1] - at[1]) ? s : best, null);
// A random spot within 1.5 m of `from` but not `from`, or null.
export function nextSpot(spots, from, rand = Math.random) {
  const near = spots.filter(s => (s[0] !== from[0] || s[1] !== from[1]) && Math.hypot(s[0] - from[0], s[1] - from[1]) <= 1.5);
  return near.length ? near[Math.floor(rand() * near.length)] : null;
}

// Plans go out at most twice a second when something changed, and at least every 2 s.
export const PLAN_EVERY = 0.5, PLAN_KEEP = 2;
export const planDue = (t, sentAt, changed) => (changed && t - sentAt >= PLAN_EVERY) || t - sentAt >= PLAN_KEEP;

// Each number in a list rounded to 0.01.
export const round2 = list => list.map(v => Math.round(v * 100) / 100);
// The goose message for what the keeper's goose is doing: its spot, the first 32 waypoints of its path, rounded.
export const planOf = ({ at, yaw, mode, idle, speed, path, carry, target }) => ({
  type: 'goose', at: round2([at.x, at.z]), yaw: round2([yaw])[0], mode, idle, speed,
  route: (path || []).slice(0, 32).map(p => round2([p.x, p.z])), carry, target: target ? round2([target.x, target.y, target.z]) : null,
});
// What makes one plan a change from the last: mode, idle pose, carry, target and where the route ends; not passing a waypoint.
export const planKey = m => JSON.stringify([m.mode, m.idle, m.carry, m.target, m.route.at(-1) ?? null]);
