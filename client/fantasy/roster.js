// Sessions into fights: a project is a fight, a session a party member, a subagent that member's minion. Pure, so it can be tested without a canvas.

export const fnv = text => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rng = seed => { let a = fnv(seed); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

const SYLLABLES = ['va', 'ry', 'ko', 'ze', 'mi', 'tor', 'sa', 'el', 'dra', 'nu', 'ka', 'lio', 'ren', 'ba', 'vex', 'ash', 'or', 'quil', 'ti', 'ga'];
export function nameOf(id, retry = 0) { const r = rng(`name${retry || ''}${id}`), a = SYLLABLES[r() * SYLLABLES.length | 0], b = SYLLABLES[r() * SYLLABLES.length | 0], s = r() < .5 ? a : a + b; return s[0].toUpperCase() + s.slice(1); }
// Nobody in a party shares a name: the earlier id keeps it, a later one draws again.
function nameParty(members) {
  const taken = new Set();
  for (const member of members) { for (let retry = 1; taken.has(member.name) && retry < 40; retry++) member.name = nameOf(member.id, retry); taken.add(member.name); }
  return members;
}

export const CLASS_NAMES = { sage: 'Sage', duelist: 'Duelist', rogue: 'Rogue', knight: 'Knight', gunner: 'Gunner' };
// The provider picks the side and the session the class, so a party of one model still has different classes.
const SIDES = { claude: ['sage', 'duelist', 'rogue', 'gunner'], codex: ['knight', 'gunner'] };
export function classOf({ provider, id = '' }) { const side = SIDES[provider] || SIDES.claude; return side[fnv(`class${id}`) % side.length]; }
const FAMILIES = [[/bug|fix|error|crash|debug|flak/i, 'bug'], [/refactor|rewrite|migrat|clean|split|persist/i, 'golem'], [/test|verify|check|review|audit/i, 'sentinel'], [/doc|readme|spec|plan|explain|research/i, 'wraith'], [/deploy|release|push|ci\b|pipeline|ship/i, 'drone'], [/\bui\b|css|style|theme|look|polish|layout/i, 'slime'], [/secur|auth|server|\bapi\b|database|network|cert/i, 'soldier'], [/feature|add|build|implement|new\b/i, 'beast'], [/small|tweak|typo|rename|minor|quick/i, 'critter']];
const WILD = ['serpent', 'beast', 'critter', 'soldier'];
export const familyOf = (title = '') => FAMILIES.find(([pattern]) => pattern.test(title))?.[1] || WILD[fnv(title) % WILD.length];
export const minionKindOf = (title = '') => /explore|search|find|scout/i.test(title) ? 'bat' : /plan|research|doc/i.test(title) ? 'tome' : 'imp';

export const PLACE_KEYS = ['reactor', 'mesa', 'wood', 'meadow', 'ember', 'wrecks'];
export const placeOf = project => PLACE_KEYS[fnv(project) % PLACE_KEYS.length];
export const TIMES = ['day', 'dusk', 'night'];
// The field a project takes beside the `held` ones ('place/time'): of the places free soonest in the day, the one it likes best, its favourite being the one it had before fields were shared out. Past six projects a place comes again at another hour.
export function pickField(project, held) {
  const r = rng(`place${project}`), first = placeOf(project), likes = [first, ...PLACE_KEYS.filter(key => key !== first).map(key => [r(), key]).sort((a, b) => a[0] - b[0]).map(([, key]) => key)];
  const free = key => { const at = TIMES.findIndex(time => !held.has(`${key}/${time}`)); return at < 0 ? TIMES.length : at; };
  const soonest = Math.min(...likes.map(free));
  return { place: likes.find(key => free(key) === soonest), time: TIMES[soonest % TIMES.length] };
}
// An order fixed by the names alone.
export const byHash = (a, b) => fnv(a) - fnv(b) || (a < b ? -1 : a > b ? 1 : 0);
// Every project a field of its own from the names alone, for when the server hasn't handed them out (server/battlefields.mjs keeps them as projects come and go).
export function placesFor(projects) {
  const held = new Set(), out = new Map();
  for (const project of [...new Set(projects)].sort(byHash)) { const field = pickField(project, held); held.add(`${field.place}/${field.time}`); out.set(project, field); }
  return out;
}

export const stateOf = (session, unread) => {
  const { status, activity, waitingOn } = session;
  if (['permission', 'question', 'error', 'offline'].includes(status)) return status;
  if (status === 'working') return activity === 'compacting' ? 'compacting' : activity === 'thinking' ? 'thinking' : 'working';
  if (waitingOn) return 'waiting';
  return unread ? 'done' : 'idle';
};
export const needsYou = state => state === 'permission' || state === 'question';
// Out of the fight for now: they fall back behind the line. Busy: they step up to it.
export const resting = state => state === 'idle' || state === 'offline';
export const busy = state => state === 'working' || state === 'thinking' || state === 'compacting';
export const hasTurn = state => ['working', 'thinking', 'compacting', 'permission', 'question', 'waiting', 'error'].includes(state);

// HP is the room left before Compact, which comes at about 83% of the window (as in office/status.js).
export function hpOf(context) {
  const used = context?.used;
  if (used == null) return null;
  const size = context.window || (used > 200_000 ? 1_000_000 : 200_000), max = size * .83, left = Math.max(0, max - used);
  return { used, left, max, ratio: Math.min(1, left / max) };
}
export const hpBand = ratio => ratio == null ? '' : ratio < .1 ? 'crit' : ratio < .25 ? 'low' : '';
export const tokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : String(Math.round(n));

// The name people call a model by.
export function modelName(model = '') {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model); if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  const gpt = /^gpt-([\d.]+)/.exec(model); return gpt ? `GPT-${gpt[1]}` : model;
}
// What the enemy stands for: the last thing they were asked to do. Harness messages come wrapped in tags and aren't anybody's request.
export function taskOf(session) {
  const said = (session.messages || []).filter(message => message.role === 'user' && typeof message.text === 'string' && message.text.trim() && !message.text.trimStart().startsWith('<')).at(-1)?.text;
  return said ? said.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
}
export function planOf(session) {
  const steps = session.plan;
  if (!steps?.length) return null;
  return { done: steps.filter(step => step.status === 'done').length, total: steps.length };
}
// A turn starts at the user's last message: a new one brings a new enemy.
function turnOf(session) {
  const said = (session.messages || []).filter(message => message.role === 'user');
  return String(said.at(-1)?.timestamp ?? said.length);
}
const toolsOf = session => (session.messages || []).filter(message => message.tool);
// The last tool call, for its result: "Miss!" is only ever a call that really failed.
function lastTool(session) {
  const tool = toolsOf(session).at(-1);
  return tool ? { id: tool.id ?? tool.text, failed: !!tool.failed } : null;
}

function memberOf(session, kids, unread) {
  const state = stateOf(session, unread(session)), requests = session.requests || [];
  return {
    id: session.id, session, name: nameOf(session.id), cls: classOf(session), state, title: session.title || 'Session', hp: hpOf(session.context), plan: planOf(session),
    mode: session.permissionMode === 'bypassPermissions' ? 'berserk' : session.permissionMode === 'plan' ? 'scan' : '',
    detail: session.detail || '', tool: lastTool(session), turn: turnOf(session), request: requests[0] || null, job: session.waitingOn || '',
    family: familyOf(session.title), askedAt: requests[0]?.createdAt ?? null, task: taskOf(session), model: modelName(session.model), effort: session.effort || '', branch: session.branch || '', cost: session.cost || null,
    minions: kids.map(kid => ({ id: kid.id, session: kid, kind: minionKindOf(kid.title), title: kid.title || 'Subagent', state: stateOf(kid, false), detail: kid.detail || '' })),
  };
}
const rank = fight => fight.members.some(member => needsYou(member.state)) ? 0 : fight.members.some(member => member.state === 'error') ? 1 : fight.members.some(member => ['working', 'thinking', 'compacting'].includes(member.state)) ? 2 : 3;

const projectOf = session => session.project || 'Unknown';
// Whoever needs you first, then errors, then whoever's busy; by name within that, so tiles don't swap for no reason. `fields` is where each project fights, from the server.
export function buildFights(sessions = [], unread = () => false, fields = null) {
  const ids = new Set(sessions.map(session => session.id)), kids = new Map(), projects = new Map();
  for (const session of sessions) if (session.parentId && ids.has(session.parentId)) { if (!kids.has(session.parentId)) kids.set(session.parentId, []); kids.get(session.parentId).push(session); }
  for (const session of sessions) {
    if (session.parentId && ids.has(session.parentId)) continue;
    const project = projectOf(session);
    if (!projects.has(project)) projects.set(project, []);
    projects.get(project).push(memberOf(session, (kids.get(session.id) || []).sort((a, b) => a.id < b.id ? -1 : 1), unread));
  }
  const own = fields ? new Map(Object.entries(fields)) : placesFor(projects.keys());
  return [...projects].map(([project, members]) => { const fight = { project, ...(own.get(project) ?? { place: placeOf(project), time: 'day' }), members: nameParty(members.sort((a, b) => a.id < b.id ? -1 : 1)) }; fight.rank = rank(fight); return fight; })
    .sort((a, b) => a.rank - b.rank || a.project.localeCompare(b.project));
}

// Where everyone stands: two parallel slanted lines, the party's on the right, each member's enemy across from them. The slant runs across the opening view, so nobody stands behind anybody. Whoever's resting goes behind whoever isn't, and a line longer than `perRank` makes another rank behind it, set off along the line so it shows through the gaps. A tall tile asks for short ranks, which is what lets a phone draw everyone larger.
// The enemies' line runs across the usual view and each takes as much of it as it and its lessers are wide, so none stands in front of another. A long line backs away rather than crossing the field.
export const ENEMY_LINE = [-.6, .8];
const ENEMY_WIDTH = 3.6, ENEMY_FRONT = -1.6, STAGGER = [0, 2.5, 1.2, 3.6];
export function formation(count, widths = [], rest = [], perRank = 5) {
  const party = Array(count), enemies = Array(count), width = i => widths[i] ?? ENEMY_WIDTH, active = [], resters = [], ranks = [];
  for (let i = 0; i < count; i++) (rest[i] ? resters : active).push(i);
  for (const group of [active, resters]) for (let at = 0; at < group.length; at += perRank) ranks.push(group.slice(at, at + perRank));
  const sum = rank => rank.reduce((total, i) => total + width(i), 0);
  const far = Math.max(0, ...ranks.map((rank, row) => -4.6 - row * 3.6 - ENEMY_LINE[0] * sum(rank) / 2 - ENEMY_FRONT));
  ranks.forEach((rank, row) => {
    let along = -sum(rank) / 2;
    rank.forEach((i, slot) => {
      const k = slot - (rank.length - 1) / 2, wide = width(i);
      party[i] = [4.2 - k * 1.2 + row * 2.8, 0, k * 3 + STAGGER[row % STAGGER.length]];
      along += wide / 2;
      enemies[i] = [-4.6 - row * 3.6 - far + along * ENEMY_LINE[0], 0, row + along * ENEMY_LINE[1]];
      along += wide / 2;
    });
  });
  return { party, enemies, widths: enemies.map((_, i) => width(i)) };
}
