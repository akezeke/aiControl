// The one place deciding what may cross between machines in an office meeting: what a page or the server may send up to the hub,
// what the hub may send down, and the host's floor (who sits where and how they look), which carries no words from the host's
// sessions. Everything arriving is rebuilt field by field here; anything malformed is dropped whole. Pure.
import { cleanName } from './leaderboard.js';
import { identity, officeStatus, naturalColor } from './status.js';
import { layoutOffice } from './layout.js';

// Pickable fruit, in the slip's order: [id, emoji].
export const FRUITS = [['apple', '🍎'], ['pear', '🍐'], ['orange', '🍊'], ['lemon', '🍋'], ['eggplant', '🍆'], ['strawberry', '🍓'], ['pineapple', '🍍'], ['kiwi', '🥝'], ['watermelon', '🍉'], ['banana', '🍌']];
export const COLOURS = ['#ff5d8f', '#3a86ff', '#8338ec', '#06d6a0', '#ffbe0b', '#ff7b00', '#00b4d8', '#e5e5e5'];
export const POSES = ['standing', 'walking', 'running', 'holding', 'playing'];
// Everything props.js (BALLS, LOOSE) and levels.js (ITEMS) can throw; a test keeps this in step with them.
export const KINDS = ['football', 'paper', 'rubber', 'roll', 'mug', 'plate', 'teabag', 'cup', 'duck', 'books', 'plant', 'cactus', 'frame'];
// Everything status.js's styles put in the head slot.
const HEAD = ['bow', 'flower', 'beanie', 'cap', 'headphones'], SCREENS = ['off', 'dark', 'green', 'amber', 'blue', 'red'];
const MAX_PODS = 64, MAX_DESKS = 256, MAX_PLAYERS = 32;

const fruitIds = FRUITS.map(([id]) => id);
const own = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && keys.every(key => key in value);
const num = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const word = v => typeof v === 'string' && /^[a-z]{1,16}$/.test(v);
const colour = v => COLOURS.includes(v);
const vec = (v, limit) => Array.isArray(v) && v.length === 3 && v.every(n => num(n, -limit, limit));
const id = v => typeof v === 'string' && /^[a-z0-9]{1,12}$/.test(v);

// What a player wears: a stable look from their name, their fruit, their colour on the trim, and a cap (a bow for a banana).
export function playerLook(name, fruit, shade) {
  const key = 'player:' + String(name).toLowerCase(), base = identity(key);
  const accessories = [...base.accessories.filter(item => !HEAD.includes(item)), fruit === 'banana' ? 'bow' : 'cap'];
  return { ...base, fruit, color: naturalColor(fruit, key), trim: shade, accessories, colour: shade };
}

const checks = {
  hello: m => { const name = cleanName(m.name); return own(m, ['name', 'fruit', 'colour']) && name && fruitIds.includes(m.fruit) && colour(m.colour) ? { type: 'hello', name, fruit: m.fruit, colour: m.colour } : null; },
  look: m => own(m, ['fruit', 'colour']) && fruitIds.includes(m.fruit) && colour(m.colour) ? { type: 'look', fruit: m.fruit, colour: m.colour } : null,
  where: m => m.at === 'home' || m.at === 'meeting' ? { type: 'where', at: m.at } : null,
  pos: m => num(m.x, -1, 200) && num(m.y, -1, 6) && num(m.z, -1, 200) && num(m.yaw) && POSES.includes(m.pose) ? { type: 'pos', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pose: m.pose } : null,
  throw: m => KINDS.includes(m.kind) && vec(m.pos, 1000) && vec(m.vel, 40) && vec(m.spin, 100) ? { type: 'throw', kind: m.kind, pos: [...m.pos], vel: [...m.vel], spin: [...m.spin] } : null,
  floor: m => { const floor = checkFloor(m.floor); return floor ? { type: 'floor', floor } : null; },
};
const run = (table, msg) => own(msg, ['type']) && Object.hasOwn(table, msg.type) ? table[msg.type](msg) : null;
export const checkUp = msg => run(checks, msg);

const player = p => own(p, ['id', 'name', 'fruit', 'colour', 'at']) && id(p.id) && cleanName(p.name) && fruitIds.includes(p.fruit) && colour(p.colour) && (p.at === 'home' || p.at === 'meeting')
  ? { id: p.id, name: cleanName(p.name), fruit: p.fruit, colour: p.colour, at: p.at } : null;
const withId = (type, fields) => m => { const inner = checks[type](m); return inner && id(m.id) ? { type, id: m.id, ...Object.fromEntries(fields.map(f => [f, inner[f]])) } : null; };
const down = {
  roster: m => {
    if (!Array.isArray(m.players) || m.players.length > MAX_PLAYERS) return null;
    const players = m.players.map(player);
    return players.every(Boolean) ? { type: 'roster', players } : null;
  },
  pos: withId('pos', ['x', 'y', 'z', 'yaw', 'pose']),
  throw: withId('throw', ['kind', 'pos', 'vel', 'spin']),
  floor: m => { if (m.floor === null) return { type: 'floor', floor: null }; const floor = checkFloor(m.floor); return floor ? { type: 'floor', floor } : null; },
  refused: m => typeof m.why === 'string' && m.why.length <= 40 ? { type: 'refused', why: m.why } : null,
};
export const checkDown = msg => run(down, msg);

// The host's floor: pods by [col, row], and every desk with an opaque id (`d0`, `d1`, ...), its pod, slot, the desk it helps (or null),
// its fruit's look and a rounded status. Nothing of the session itself: not its id, title, project, folder or messages.
const round = (v, places = 0) => Math.round(v * 10 ** places) / 10 ** places;
export function meetingFloor(snapshot) {
  const { office, sessions } = snapshot, byId = new Map(sessions.map(s => [s.id, s]));
  const podIndex = new Map(office.pods.map((pod, i) => [pod.key, i]));
  const rows = [], opaque = new Map();
  const add = (session, pod, slot, parentId) => {
    const { props, notes, ...look } = identity(session.id);
    const { pose, expression, screen, since, wear, cups } = officeStatus(session);
    opaque.set(session.id, `d${rows.length}`);
    rows.push({ id: `d${rows.length}`, pod, slot, parent: parentId, look, status: { pose, expression, screen, since: since === undefined ? null : round(since), wear: round(wear, 1), cups } });
  };
  for (const desk of office.desks) {
    const session = byId.get(desk.sessionId), pod = podIndex.get(desk.podKey);
    if (session && pod !== undefined) add(session, pod, desk.slot, null);
  }
  for (const session of sessions) {
    const parent = session.parentId && opaque.get(session.parentId);
    if (parent) { const top = rows.find(row => row.id === parent); add(session, top.pod, top.slot, parent); }
  }
  const { width = 0, depth = 0 } = office.room || {}, door = office.door || { x: width / 2, z: depth };
  return { room: { width: round(width, 1), depth: round(depth, 1) }, door: { x: round(door.x, 1), z: round(door.z, 1) }, pods: office.pods.map(pod => [pod.col, pod.row]), desks: rows };
}

const lookOk = look => own(look, ['fruit', 'color', 'accessories', 'trim', 'habits']) && fruitIds.includes(look.fruit) && /^#[0-9a-f]{6}$/i.test(look.color) && /^#[0-9a-f]{6}$/i.test(look.trim)
  && Array.isArray(look.accessories) && look.accessories.length <= 8 && look.accessories.every(word) && own(look.habits, ['typing', 'thinking', 'sleeping', 'finish']) && ['typing', 'thinking', 'sleeping', 'finish'].every(k => word(look.habits[k]));
const statusOk = s => own(s, ['pose', 'expression', 'screen', 'since', 'wear', 'cups']) && word(s.pose) && word(s.expression) && SCREENS.includes(s.screen) && (s.since === null || num(s.since, 0, 1e14)) && num(s.wear, 0, 1) && Number.isInteger(s.cups) && s.cups >= 0 && s.cups <= 6;
// Rebuilt field by field, or null if any of it fails.
export function checkFloor(floor) {
  if (!own(floor, ['room', 'door', 'pods', 'desks']) || !own(floor.room, ['width', 'depth']) || !own(floor.door, ['x', 'z'])) return null;
  const { room, door, pods, desks } = floor;
  if (!num(room.width, 0, 200) || !num(room.depth, 0, 200) || !num(door.x, 0, 200) || !num(door.z, 0, 200)) return null;
  if (!Array.isArray(pods) || pods.length > MAX_PODS || !Array.isArray(desks) || desks.length > MAX_DESKS) return null;
  if (!pods.every(pod => Array.isArray(pod) && pod.length === 2 && pod.every(n => Number.isInteger(n) && n >= 0 && n < 64))) return null;
  const ids = new Set(desks.map(desk => desk?.id));
  const clean = desks.map(desk => own(desk, ['id', 'pod', 'slot', 'parent', 'look', 'status']) && /^d[0-9]{1,3}$/.test(desk.id) && Number.isInteger(desk.pod) && desk.pod >= 0 && desk.pod < pods.length
    && Number.isInteger(desk.slot) && desk.slot >= 0 && desk.slot < 64 && (desk.parent === null || (ids.has(desk.parent) && desk.parent !== desk.id)) && lookOk(desk.look) && statusOk(desk.status)
    ? { id: desk.id, pod: desk.pod, slot: desk.slot, parent: desk.parent, look: { fruit: desk.look.fruit, color: desk.look.color, accessories: [...desk.look.accessories], trim: desk.look.trim, habits: { ...desk.look.habits } },
      status: { pose: desk.status.pose, expression: desk.status.expression, screen: desk.status.screen, since: desk.status.since, wear: desk.status.wear, cups: desk.status.cups } } : null);
  if (!clean.every(Boolean) || ids.size !== desks.length) return null;
  return { room: { width: room.width, depth: room.depth }, door: { x: door.x, z: door.z }, pods: pods.map(([col, row]) => [col, row]), desks: clean };
}

// A floor in the form the office reads (office.update): the geometry laid out again from each pod's grid spot and each desk's slot,
// with fake screens and no speech bubbles.
export function floorSnapshot(floor) {
  const keys = floor.pods.map((_, i) => `p${i}`), sessions = floor.desks.map(desk => ({ id: desk.id, parentId: desk.parent || undefined, cwd: keys[desk.pod], project: 'Office', status: 'idle' }));
  const previous = { saved: true, desks: new Map(floor.desks.filter(d => !d.parent).map(d => [d.id, { podKey: keys[d.pod], slot: d.slot }])), pods: floor.pods.map(([col, row], i) => ({ key: keys[i], col, row, name: 'Office' })), room: { width: 0, depth: 0 } };
  const office = layoutOffice(sessions, previous);
  const statuses = new Map(floor.desks.map(desk => [desk.id, { ...desk.status, since: desk.status.since ?? undefined, mode: '', bubble: null, monitor: fakeMonitor(desk.id, desk.status.screen, Date.now() / 1000), identity: { ...desk.look, props: [], notes: 0 } }]));
  return { office: { ...office, desks: [...office.desks.values()] }, sessions: sessions.map(({ id, parentId }) => ({ id, parentId, status: floor.desks.find(d => d.id === id).status })), statuses };
}

// A screen that looks busy without showing anything: lines made of a fixed word list, the same for the same desk and second.
export const WORDS = ['let', 'const', 'return', 'if', 'else', 'for', 'while', 'map', 'filter', 'reduce', 'await', 'async', 'import', 'export', 'node', 'value', 'list', 'item', 'result', 'error', 'build', 'test', 'pass', 'fail', 'read', 'write', 'edit', 'check', 'run', 'file', 'path', 'name', 'type', 'state', 'event', 'data', 'update', 'render', 'load', 'save'];
const KINDS_OF_LINE = ['assistant', 'assistant', 'tool', 'user'];
const hashOf = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const lineAt = (seed, n) => {
  let h = hashOf(`${seed}:${n}`);
  const next = () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = (h ^ (h >>> 12)) >>> 0; return h; };
  return { kind: KINDS_OF_LINE[next() % KINDS_OF_LINE.length], text: Array.from({ length: 3 + next() % 4 }, () => WORDS[next() % WORDS.length]).join(' ') };
};
export function fakeMonitor(seed, tone, t) {
  if (tone === 'amber') return { title: '', plan: null, lines: [{ kind: 'user', text: '› ' }] };
  if (tone !== 'green') return null;
  const now = Math.floor(t);
  return { title: '', plan: null, lines: Array.from({ length: 6 }, (_, i) => lineAt(seed, now - 5 + i)) };
}
