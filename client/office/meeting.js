// The one place deciding what may cross between machines in an office meeting: what a page or the server may send up to the hub,
// what the hub may send down, and the host's floor (who sits where and how they look), which carries no words from the host's
// sessions. Everything arriving is rebuilt field by field here; anything malformed is dropped whole. Pure.
import { cleanName } from './leaderboard.js';
import { identity, officeStatus, naturalColor, PROPS, ACCESSORIES } from './status.js';
import { layoutOffice } from './layout.js';

// Pickable fruit, in the slip's order: [id, emoji].
export const FRUITS = [['apple', '🍎'], ['pear', '🍐'], ['orange', '🍊'], ['lemon', '🍋'], ['eggplant', '🍆'], ['strawberry', '🍓'], ['pineapple', '🍍'], ['kiwi', '🥝'], ['watermelon', '🍉'], ['banana', '🍌']];
export const COLOURS = ['#ff5d8f', '#3a86ff', '#8338ec', '#06d6a0', '#ffbe0b', '#ff7b00', '#00b4d8', '#e5e5e5'];
export const POSES = ['standing', 'walking', 'running', 'holding', 'playing'];
// The meeting's protocol: in every hello, and the hub refuses a link speaking another (refused { why: 'version' }). Raise it when
// a message changes so that the other end would misread it.
export const PROTOCOL = 1;
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
const cell = v => Array.isArray(v) && v.length === 2 && v.every(n => num(n, -12, 200));
// The shared goose: what its keeper plans (modes, idle poses) and what happens to it.
const GOOSE_MODES = ['loiter', 'walk', 'fetch', 'reach', 'haul', 'drop', 'sneak', 'aim', 'chase', 'visit', 'mill'], GOOSE_IDLES = ['look', 'peck', 'preen'];

// What a player wears: a stable look from their name, their fruit, their colour on the trim, and a cap (a bow for a banana).
export function playerLook(name, fruit, shade) {
  const key = 'player:' + String(name).toLowerCase(), base = identity(key);
  const accessories = [...base.accessories.filter(item => !HEAD.includes(item)), fruit === 'banana' ? 'bow' : 'cap'];
  return { ...base, fruit, color: naturalColor(fruit, key), trim: shade, accessories, colour: shade };
}

// An AI Control from before the number (no `v`) speaks the first one.
const version = v => v === undefined ? 1 : Number.isInteger(v) && v > 0 && v < 1000 ? v : null;
const checks = {
  hello: m => { const name = cleanName(m.name), v = version(m.v); return own(m, ['name', 'fruit', 'colour']) && v && name && fruitIds.includes(m.fruit) && colour(m.colour) ? { type: 'hello', v, name, fruit: m.fruit, colour: m.colour } : null; },
  look: m => own(m, ['fruit', 'colour']) && fruitIds.includes(m.fruit) && colour(m.colour) ? { type: 'look', fruit: m.fruit, colour: m.colour } : null,
  where: m => m.at === 'home' || m.at === 'meeting' ? { type: 'where', at: m.at } : null,
  // `t`, optional: the sender's clock (ms) when it was there, so friends.js can play moves back at an even pace.
  pos: m => num(m.x, -12, 200) && num(m.y, -1, 6) && num(m.z, -12, 200) && num(m.yaw) && POSES.includes(m.pose) && (m.t === undefined || num(m.t, 0))
    ? { type: 'pos', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pose: m.pose, ...m.t !== undefined && { t: m.t } } : null,
  throw: m => KINDS.includes(m.kind) && vec(m.pos, 1000) && vec(m.vel, 40) && vec(m.spin, 100) ? { type: 'throw', kind: m.kind, pos: [...m.pos], vel: [...m.vel], spin: [...m.spin] } : null,
  floor: m => { const floor = checkFloor(m.floor); return floor ? { type: 'floor', floor } : null; },
  remove: m => { const name = cleanName(m.name); return name ? { type: 'remove', name } : null; },
  // A snake game for the watchers: `path` is the body cell by cell from the head ('-' unknown, 0-3 the way to the next), `plant` a plant spot.
  snake: m => {
    if (m.mode === 'off') return { type: 'snake', mode: 'off' };
    return own(m, ['head', 'path', 'dir', 'rate', 'food', 'plant']) && ['ready', 'play', 'over'].includes(m.mode) && cell(m.head) && (m.food === null || cell(m.food))
      && typeof m.path === 'string' && /^[0-3-]{0,1200}$/.test(m.path) && Number.isInteger(m.dir) && m.dir >= 0 && m.dir <= 3 && num(m.rate, 1, 32) && Number.isInteger(m.plant) && m.plant >= 0 && m.plant <= 3
      ? { type: 'snake', mode: m.mode, head: [...m.head], path: m.path, dir: m.dir, rate: m.rate, food: m.food && [...m.food], plant: m.plant } : null;
  },
  // The goose's plan: where it is, what it does next and the cells it walks, for the other pages to replay. `age` is only the server's.
  goose: m => own(m, ['at', 'yaw', 'mode', 'idle', 'speed', 'route', 'carry', 'target']) && cell(m.at) && num(m.yaw) && GOOSE_MODES.includes(m.mode) && GOOSE_IDLES.includes(m.idle) && num(m.speed, 0, 4)
    && Array.isArray(m.route) && m.route.length <= 32 && m.route.every(cell) && (m.carry === null || KINDS.includes(m.carry)) && (m.target === null || Array.isArray(m.target) && m.target.length === 3 && m.target.every(n => num(n, -12, 200)))
    ? { type: 'goose', at: [...m.at], yaw: m.yaw, mode: m.mode, idle: m.idle, speed: m.speed, route: m.route.map(c => [...c]), carry: m.carry, target: m.target && [...m.target] } : null,
  // What happened to the goose, each kind keeping only its own fields.
  goosed: m => {
    switch (m.what) {
      case 'nip': return id(m.who) ? { type: 'goosed', what: 'nip', who: m.who } : null;
      case 'take': return KINDS.includes(m.kind) && Array.isArray(m.spot) && m.spot.length === 3 && m.spot.every(n => num(n, -12, 200)) ? { type: 'goosed', what: 'take', kind: m.kind, spot: [...m.spot] } : null;
      case 'drop': return { type: 'goosed', what: 'drop' };
      case 'wake': return cell(m.spot) ? { type: 'goosed', what: 'wake', spot: [...m.spot] } : null;
      case 'honk': return m.icon === '🪿' || m.icon === '💢' ? { type: 'goosed', what: 'honk', icon: m.icon } : null;
      default: return null;
    }
  },
  poke: m => ['hit', 'click', 'took'].includes(m.why) ? { type: 'poke', why: m.why } : null,
};
const run = (table, msg) => own(msg, ['type']) && Object.hasOwn(table, msg.type) ? table[msg.type](msg) : null;
export const checkUp = msg => run(checks, msg);

const player = p => own(p, ['id', 'name', 'fruit', 'colour', 'at']) && id(p.id) && cleanName(p.name) && fruitIds.includes(p.fruit) && colour(p.colour) && (p.at === 'home' || p.at === 'meeting')
  && (p.goose === undefined || typeof p.goose === 'boolean') ? { id: p.id, name: cleanName(p.name), fruit: p.fruit, colour: p.colour, at: p.at, ...p.goose === true && { goose: true } } : null;
const withId = (type, fields) => m => { const inner = checks[type](m); return inner && id(m.id) ? { type, id: m.id, ...Object.fromEntries(fields.filter(f => inner[f] !== undefined).map(f => [f, inner[f]])) } : null; };
const down = {
  roster: m => {
    if (!Array.isArray(m.players) || m.players.length > MAX_PLAYERS) return null;
    const players = m.players.map(player);
    return players.every(Boolean) ? { type: 'roster', players } : null;
  },
  pos: withId('pos', ['x', 'y', 'z', 'yaw', 'pose', 't']),
  throw: withId('throw', ['kind', 'pos', 'vel', 'spin']),
  snake: withId('snake', ['mode', 'head', 'path', 'dir', 'rate', 'food', 'plant']),
  goose: m => { const msg = withId('goose', ['at', 'yaw', 'mode', 'idle', 'speed', 'route', 'carry', 'target'])(m); return msg && m.age === undefined ? msg : msg && num(m.age, 0, 10000) ? { ...msg, age: m.age } : null; },
  goosed: withId('goosed', ['what', 'who', 'kind', 'spot', 'icon']),
  poke: withId('poke', ['why']),
  floor: m => { if (m.floor === null) return { type: 'floor', floor: null }; const floor = checkFloor(m.floor); return floor ? { type: 'floor', floor } : null; },
  refused: m => typeof m.why === 'string' && m.why.length <= 40 ? { type: 'refused', why: m.why } : null,
  // The hub's answer to hello: your id in the roster, the colour you got and where you are.
  welcome: m => id(m.id) && colour(m.colour) && (m.at === 'home' || m.at === 'meeting') ? { type: 'welcome', id: m.id, colour: m.colour, at: m.at } : null,
};
export const checkDown = msg => run(down, msg);

// The host's floor: pods by [col, row], and every desk with an opaque id (`d0`, `d1`, ...), its pod, slot, the desk it helps (or null),
// its fruit's look and a rounded status. Nothing of the session itself: not its id, title, project, folder or messages.
// `ids`: session id → desk id, kept by the caller from one floor to the next (and never sent), so a desk keeps its id while others
// come and go; a new session gets the lowest one the last floor didn't use, so no id moves straight on to another desk.
const round = (v, places = 0) => Math.round(v * 10 ** places) / 10 ** places;
export function meetingFloor(snapshot, ids = new Map()) {
  const { office, sessions } = snapshot, byId = new Map(sessions.map(s => [s.id, s]));
  const podIndex = new Map(office.pods.map((pod, i) => [pod.key, i]));
  const rows = [], opaque = new Map(), used = new Set(ids.values());
  const add = (session, pod, slot, parentId) => {
    const look = identity(session.id); // its desk's props and notes too: random from the id, nothing of the session
    const { pose, expression, screen, since, wear, cups } = officeStatus(session);
    let id = ids.get(session.id);
    if (!id) { let n = 0; while (used.has(`d${n}`)) n++; id = `d${n}`; used.add(id); }
    opaque.set(session.id, id);
    rows.push({ id, pod, slot, parent: parentId, look, status: { pose, expression, screen, since: since === undefined ? null : round(since), wear: round(wear, 1), cups } });
  };
  for (const desk of office.desks) {
    const session = byId.get(desk.sessionId), pod = podIndex.get(desk.podKey);
    if (session && pod !== undefined) add(session, pod, desk.slot, null);
  }
  for (const session of sessions) {
    const parent = session.parentId && opaque.get(session.parentId);
    if (parent) { const top = rows.find(row => row.id === parent); add(session, top.pod, top.slot, parent); }
  }
  ids.clear(); for (const [session, id] of opaque) ids.set(session, id);
  const { width = 0, depth = 0 } = office.room || {}, door = office.door || { x: width / 2, z: depth };
  return { room: { width: round(width, 1), depth: round(depth, 1) }, door: { x: round(door.x, 1), z: round(door.z, 1) }, pods: office.pods.map(pod => [pod.col, pod.row]), desks: rows };
}

// A desk's look and status, rebuilt. Desk things (props, notes) are optional, so a host on an older version still gets visitors:
// missing means none. What a newer host has and this version doesn't know (a fruit, screen, prop or accessory; more notes or
// cups) comes out as the nearest it knows, so the room is still drawn; a wrong type or size still fails the whole floor.
const HABITS = ['typing', 'thinking', 'sleeping', 'finish'], hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const count = (v, most) => Number.isInteger(v) ? Math.min(most, Math.max(0, v)) : null;
const known = (v, most, list) => Array.isArray(v) && v.length <= most && v.every(word) ? v.filter(item => list.includes(item)) : null;
function lookOf(look) {
  if (!own(look, ['fruit', 'color', 'accessories', 'trim', 'habits']) || !word(look.fruit) || !hex(look.color) || !hex(look.trim) || !own(look.habits, HABITS) || !HABITS.every(k => word(look.habits[k]))) return null;
  const accessories = known(look.accessories, 8, ACCESSORIES), props = look.props === undefined ? [] : known(look.props, 3, PROPS), notes = look.notes === undefined ? 0 : count(look.notes, 3);
  if (!accessories || !props || notes === null) return null;
  return { fruit: fruitIds.includes(look.fruit) ? look.fruit : 'apple', color: look.color, accessories, trim: look.trim, habits: Object.fromEntries(HABITS.map(k => [k, look.habits[k]])), props, notes };
}
function statusOf(s) {
  if (!own(s, ['pose', 'expression', 'screen', 'since', 'wear', 'cups']) || !word(s.pose) || !word(s.expression) || !word(s.screen) || !(s.since === null || num(s.since, 0, 1e14)) || !num(s.wear, 0, 1)) return null;
  const cups = count(s.cups, 6);
  return cups === null ? null : { pose: s.pose, expression: s.expression, screen: SCREENS.includes(s.screen) ? s.screen : 'off', since: s.since, wear: s.wear, cups };
}
// Rebuilt field by field, or null if any of it fails.
export function checkFloor(floor) {
  if (!own(floor, ['room', 'door', 'pods', 'desks']) || !own(floor.room, ['width', 'depth']) || !own(floor.door, ['x', 'z'])) return null;
  const { room, door, pods, desks } = floor;
  if (!num(room.width, 0, 200) || !num(room.depth, 0, 200) || !num(door.x, 0, 200) || !num(door.z, 0, 200)) return null;
  if (!Array.isArray(pods) || pods.length > MAX_PODS || !Array.isArray(desks) || desks.length > MAX_DESKS) return null;
  if (!pods.every(pod => Array.isArray(pod) && pod.length === 2 && pod.every(n => Number.isInteger(n) && n >= 0 && n < 64))) return null;
  const ids = new Set(desks.map(desk => desk?.id));
  const clean = desks.map(desk => {
    if (!own(desk, ['id', 'pod', 'slot', 'parent', 'look', 'status']) || !/^d[0-9]{1,3}$/.test(desk.id) || !Number.isInteger(desk.pod) || desk.pod < 0 || desk.pod >= pods.length
      || !Number.isInteger(desk.slot) || desk.slot < 0 || desk.slot >= 64 || !(desk.parent === null || (ids.has(desk.parent) && desk.parent !== desk.id))) return null;
    const look = lookOf(desk.look), status = statusOf(desk.status);
    return look && status ? { id: desk.id, pod: desk.pod, slot: desk.slot, parent: desk.parent, look, status } : null;
  });
  if (!clean.every(Boolean) || ids.size !== desks.length) return null;
  return { room: { width: room.width, depth: room.depth }, door: { x: door.x, z: door.z }, pods: pods.map(([col, row]) => [col, row]), desks: clean };
}

// A floor in the form the office reads (office.update): the geometry laid out again from each pod's grid spot and each desk's slot,
// in a room the host's size (theirs only ever grows, so it can be bigger than its pods need), with fake screens and no speech bubbles.
export function floorSnapshot(floor) {
  const keys = floor.pods.map((_, i) => `p${i}`), sessions = floor.desks.map(desk => ({ id: desk.id, parentId: desk.parent || undefined, cwd: keys[desk.pod], project: 'Office', status: 'idle' }));
  const previous = { saved: true, desks: new Map(floor.desks.filter(d => !d.parent).map(d => [d.id, { podKey: keys[d.pod], slot: d.slot }])), pods: floor.pods.map(([col, row], i) => ({ key: keys[i], col, row, name: 'Office' })), room: { width: floor.room.width, depth: floor.room.depth } };
  const office = layoutOffice(sessions, previous);
  const statuses = new Map(floor.desks.map(desk => [desk.id, { ...desk.status, since: desk.status.since ?? undefined, mode: '', bubble: null, monitor: fakeMonitor(desk.id, desk.status.screen, Date.now() / 1000), identity: { ...desk.look } }]));
  return { office: { ...office, desks: [...office.desks.values()] }, sessions: sessions.map(({ id, parentId }) => ({ id, parentId, status: floor.desks.find(d => d.id === id).status })), statuses };
}

// Screens that are obviously fake: a Hollywood hacker's terminal at Low-Hanging Fruit Ltd. Everything comes from these lists, the same
// for the same desk and second, and nothing from the host's sessions.
export const COMMANDS = ['$ npm install more-ram', '$ git commit -m "fixed it (for real)"', '$ sudo make me a sandwich', '$ ./ripen --force bananas', '$ rm -rf mondays/', '$ docker run coffee:double', '$ curl stackoverflow.com | sh', '$ git push --force-with-confidence', '$ cd /fruit/low-hanging', '$ ssh root@the-mainframe', '$ make it-work', '$ chmod +x banana', '$ ping -c 1 the-cloud', '$ cat /dev/urandom | grep meaning'];
export const PROGRESS = ['Downloading more RAM', 'Reticulating splines', 'Squeezing legacy juice', 'Ripening branch', 'Peeling bananas.js', 'Hacking the mainframe', 'Defragging fruit bowl', 'Compiling the synergy', 'Untangling spaghetti', 'Bribing the GC', 'Watering the stack', 'Polishing the apples', 'Mining fruitcoin', 'Warming up the cloud'];
export const RESULTS = ['✓ 4,812 tests passed (2 looked at)', '⚠ it works on my machine', 'ERROR: too much fruit in the stack', '✓ deployed (fingers crossed)', 'TODO: ask the banana', '✓ bug fixed (renamed to feature)', '⚠ 99 problems, 98 are fruit', 'ERROR: keyboard not found, press F1', '✓ coffee level: critical', '⚠ legacy code is looking at me', 'TODO: delete this TODO', '✓ merged without reading', 'ERROR: pear-to-pear link lost', '✓ cloud = fruit on another tree'];
export const BANNERS = ['ACCESS GRANTED', 'ENHANCE.', 'HACK COMPLETE', 'I\'M IN.'];
const hashOf = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const mix = h => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0; return (h ^ (h >>> 15)) >>> 0; };
const rolled = (seed, tag, n) => mix(hashOf(`${seed}:${tag}:${n}`));
const BAR = 10;
// Each line is a pure function of its index n, so lines scroll. Even lines use the lists' even entries and odd lines the odd ones,
// so the same joke never sits on two lines in a row.
const lineAt = (seed, n) => {
  const h = rolled(seed, 'line', n), kind = ['user', 'tool', 'assistant'][h % 3], pick = ((h >>> 4) % 7) * 2 + (n & 1);
  if (kind === 'user') return { kind, text: COMMANDS[pick] };
  if (kind === 'assistant') return { kind, text: RESULTS[pick] };
  const label = PROGRESS[pick], shape = (h >>> 9) % 4, pct = 1 + (h >>> 12) % 99, done = Math.round(pct * BAR / 100);
  return { kind, text: shape === 0 ? `${label} …` : shape === 1 ? `${label} ${'█'.repeat(BAR)} done` : `${label} ${'█'.repeat(done)}${'░'.repeat(BAR - done)} ${pct}%` };
};
const bannerAt = (seed, n) => rolled(seed, 'banner', n) % 12 === 0 && rolled(seed, 'banner', n - 1) % 12 !== 0 ? BANNERS[rolled(seed, 'words', n) % BANNERS.length] : undefined;
const bounce = (v, size) => { const m = ((v % (2 * size)) + 2 * size) % (2 * size); return (m > size ? 2 * size - m : m) / size; };
const SAVER_STEP = [0.137, 0.091];
export function fakeMonitor(seed, tone, t) {
  const now = Math.floor(t);
  if (tone === 'amber') return { title: '', plan: null, lines: [{ kind: 'user', text: now % 2 ? '' : 'hello? anyone? (tap tap tap)' }] }; // the screen draws its ›
  if (tone === 'dark') {
    const [x0, y0] = [rolled(seed, 'x', 0) / 2 ** 32, rolled(seed, 'y', 0) / 2 ** 32];
    return { title: '', plan: null, lines: [], saver: { text: 'brb ☕', x: bounce(x0 + now * SAVER_STEP[0], 1), y: bounce(y0 + now * SAVER_STEP[1], 1) } };
  }
  if (tone !== 'green') return null;
  const monitor = { title: '', plan: null, lines: Array.from({ length: 6 }, (_, i) => lineAt(seed, now - 5 + i)) }, banner = bannerAt(seed, now);
  if (banner) monitor.banner = banner;
  return monitor;
}
