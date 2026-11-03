// The sessions as a graph for the node looks: You in the middle, projects round you, sessions off their project, subagents
// off their session. sync() fills the nodes from each snapshot and turns the differences into events; update() moves them
// on springs and smooths their status into 0..1 signals. No drawing.
//
// Node fields looks read:
//   id, kind 'you' | 'project' | 'session' | 'sub';  name, project (node), parent (node), index, seed, present
//   pos (Vector3, live, springy), rest (Vector3), vel, offset (from the parent, sessions and subs)
//   projects: sessions [], angle;  sessions: subs []
//   sessions/subs: status 'working'|'thinking'|'compacting'|'permission'|'question'|'waiting'|'idle'|'error'|'offline',
//     text (one-line status), tool, toolKind 'edit'|'read'|'search'|'bash'|'agent'|'web'|'', provider 'claude'|'codex'|'opencode',
//     mode ''|'plan'|'bypass', ctx 0..1, plan {done,total}|null, since (ms epoch, when it started needing you), waitSec, model
//   hovered, selected, pressed (held under the pointer until released or it turns into a pan): set by the board
//   s: smoothed 0..1 signals: alive, work, think, compact, need, wait, idle, error, off, heat (tool burst), urgency (need × wait up to 10 min),
//      hover, select, ctx
// world.usage: one entry per account, { id, provider, label, windows: [{ label, used 0..1, resetsAt }], spend: { spent, limit } | null }.
import * as THREE from 'three';
import { spendView } from '../usage-presentation.js';

export const RING = 15, FAN = 5.4, SUB = 2.4;
// The first project starts off the compass points, so four projects aren't up, right, down and left.
const TILT = -Math.PI / 2 + .55;
const BUSY = new Set(['working', 'thinking', 'compacting']);
const needs = status => status === 'permission' || status === 'question';
export const fnv = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
// A stable 0..1 per id and purpose.
const unit = (id, salt) => fnv(`${salt}:${id}`) / 4294967296;
export const toolKind = detail => [[/^(Edit|Write|MultiEdit|apply_patch)\b/i, 'edit'], [/^Read\b/, 'read'], [/^(Grep|Glob|Search)\b/, 'search'], [/^Web/, 'web'], [/^(Agent|Task)\b/, 'agent'], [/^(Bash|Shell)\b/, 'bash']].find(([re]) => re.test(detail || ''))?.[1] || '';

// What a session is doing, in the looks' words: the server's status refined by its activity.
export function statusOf(session) {
  const status = session.status;
  if (status === 'working') return session.activity === 'compacting' ? 'compacting' : session.activity === 'thinking' ? 'thinking' : 'working';
  if (status === 'idle' && session.waitingOn) return 'waiting';
  return ['permission', 'question', 'offline', 'error'].includes(status) ? status : 'idle';
}
export function textOf(session, status) {
  const request = session.requests?.[0];
  const asked = request?.questions?.[0]?.question || request?.title || session.asks;
  return { working: session.detail || 'Working', thinking: 'Thinking', compacting: 'Compacting', permission: asked || 'Needs permission', question: asked || 'Has a question',
    waiting: `Waiting · ${session.waitingOn}`, idle: session.parentId ? 'Done' : 'Idle', error: session.detail || 'Error', offline: 'Offline' }[status];
}
const MODES = { plan: 'plan', bypassPermissions: 'bypass' };
// ponytail: Claude doesn't report its window; 200k until it does.
const contextOf = session => { const used = session.context?.used; return used > 0 ? Math.min(1, used / (session.context.window || 200_000)) : 0; };
const planOf = session => session.plan?.length ? { done: session.plan.filter(step => step.status === 'done').length, total: session.plan.length } : null;
const windowLabel = label => label === 'Weekly' ? 'week' : String(label).replace(/-(hour|day|minute)$/, (_, unit) => unit[0]);
export const usageOf = usage => (usage || []).map(account => {
  const spend = spendView(account);
  return { id: `${account.provider}:${account.label || ''}`, provider: account.provider, label: account.name || account.provider,
    windows: (account.windows || []).filter(w => Number.isFinite(w.usedPercent)).map(w => ({ label: windowLabel(w.label), used: Math.min(1, Math.max(0, w.usedPercent / 100)), resetsAt: w.resetsAt })),
    spend: spend && { spent: spend.spent, limit: spend.limit } };
});

function node(kind, id, name, extra = {}) {
  return { kind, id, name, seed: fnv(id), present: true, pos: new THREE.Vector3(), rest: new THREE.Vector3(), vel: new THREE.Vector3(), offset: new THREE.Vector3(),
    s: { alive: 0, work: 0, think: 0, compact: 0, need: 0, wait: 0, idle: 1, error: 0, off: 0, heat: 0, urgency: 0, hover: 0, select: 0 },
    status: 'idle', text: '', tool: '', toolKind: '', provider: '', mode: '', ctx: 0, plan: null, since: 0, waitSec: 0, index: 0, ...extra };
}

export function createWorld() {
  const you = node('you', 'you', 'You');
  you.s.alive = 1;
  const byId = new Map([['you', you]]);
  const world = { you, projects: [], sessions: [], subs: [], nodes: [you], time: 0, reduced: false, usage: [], offline: false, synced: false,
    // How nodes move, set per look: zeta < 1 overshoots (bouncy, organic looks), 1 settles without overshoot (machines); drift is the idle wander.
    motion: { zeta: .42, k: 46, drift: 1, kick: 1 },
    // Changes whenever a look has to be built again: who's on the board, and the counts looks bake into geometry.
    structure: '',
    // How the board moved in the last update, for the frame pace: 'fast' (springing, or a signal still easing), 'drift' (only the idle
    // wander), or '' (at rest).
    stir: 'fast',
    // Counts snapshots that changed something, so the board draws for one however it came (a console or headless sync too).
    version: 0 };
  let events = [], queued = null, usageKey = '', lastKey = '', lastSmooth = 0;
  const emit = (type, n, data = {}) => events.push({ type, node: n, data });

  // Layout from ids alone, so every device and every restart shows the same board. Projects in name order round the ring,
  // sessions fanned outward from their project, subagents fanned from their session. Each branch is nudged in angle and
  // length by its own id, so the board grows like a plant rather than a compass rose.
  // ponytail: a new project re-spaces the ring; keep placements on the server (like server/towers.mjs) if that jumps too much.
  function layout() {
    const projects = world.projects, N = projects.length;
    const widest = Math.max(1, ...projects.map(p => p.sessions.length));
    const ring = Math.max(RING, N * 3.4, N > 1 ? (FAN + SUB) * 1.15 / Math.sin(Math.PI / N) : 0) + Math.max(0, widest - 5) * .6;
    projects.forEach((p, pi) => {
      const a = TILT + (pi + (unit(p.id, 'a') - .5) * .45) * Math.PI * 2 / Math.max(1, N);
      p.index = pi; p.angle = a; p.rest.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar((N === 1 ? RING * .8 : ring) * (.86 + unit(p.id, 'r') * .28));
      const n = p.sessions.length, step = n < 2 ? 0 : Math.min(n > 3 ? .52 : .6, 2.6 / (n - 1)), fan = Math.max(FAN, step ? 2.8 / step : FAN);
      p.sessions.forEach((s, si) => {
        const ang = a + (si - (n - 1) / 2 + (unit(s.id, 'a') - .5) * .5) * (step || .5);
        s.index = si; s.angle = ang; s.offset.set(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(fan * (.82 + unit(s.id, 'r') * .36)); s.rest.copy(p.rest).add(s.offset);
        const m = s.subs.length, kstep = m < 2 ? 0 : Math.min(1.05, 2.6 / (m - 1));
        s.subs.forEach((k, ki) => {
          const kang = ang + (ki - (m - 1) / 2 + (unit(k.id, 'a') - .5) * .4) * (kstep || .6);
          k.index = ki; k.angle = kang; k.offset.set(Math.cos(kang), 0, Math.sin(kang)).multiplyScalar((SUB + Math.max(0, m - 4) * .25) * (.85 + unit(k.id, 'r') * .3)); k.rest.copy(s.rest).add(k.offset);
        });
      });
    });
  }

  function restructure() {
    const byName = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0, byKey = (a, b) => a.id < b.id ? -1 : 1;
    world.projects.sort(byName);
    for (const p of world.projects) { p.sessions.sort(byKey); for (const s of p.sessions) s.subs.sort(byKey); }
    world.sessions = world.projects.flatMap(p => p.sessions); queued = null;
    world.subs = world.sessions.flatMap(s => s.subs);
    world.nodes = [you, ...world.projects, ...world.sessions, ...world.subs];
    layout();
    world.structure = world.nodes.map(n => `${n.id}${n.plan ? `/${n.plan.total}` : ''}${n.mode ? `/${n.mode}` : ''}`).join('|');
  }

  // A node takes its place at once on the first snapshot, and grows in from its parent after that.
  function arrive(n) { n.pos.copy(world.synced && n.parent ? n.parent.pos : n.rest); if (!world.synced) n.s.alive = 1; }

  world.sync = (snapshot, { error = false, now = Date.now() } = {}) => {
    // Most polls say nothing new: one that reads as the last changes nothing, so a still board isn't drawn for it.
    const list = snapshot.sessions || [], usage = JSON.stringify(snapshot.usage || null), all = `${+error}${usage}${error ? '' : JSON.stringify(list)}`;
    if (all === lastKey) return;
    lastKey = all; world.version++; world.offline = !!error;
    // The same array while the accounts read the same, so looks that redraw on a new one don't on every snapshot.
    if (usage !== usageKey) { usageKey = usage; world.usage = usageOf(snapshot.usage); }
    // While the connection is down nobody is known to have left.
    if (error) return;
    const here = new Set(list.map(session => session.id));
    let changed = false;
    const top = list.filter(session => !session.parentId), subs = list.filter(session => session.parentId && here.has(session.parentId));
    for (const session of [...top, ...subs]) {
      let n = byId.get(session.id);
      if (!n) {
        let parent;
        if (session.parentId) parent = byId.get(session.parentId);
        else {
          const key = session.cwd || session.project || 'Unknown';
          parent = byId.get(`project:${key}`);
          if (!parent) { parent = node('project', `project:${key}`, session.project || key, { key, parent: you, sessions: [] }); parent.project = parent; byId.set(parent.id, parent); world.projects.push(parent); }
        }
        n = node(session.parentId ? 'sub' : 'session', session.id, '', { project: parent.project, parent, subs: [], key: session.id });
        byId.set(n.id, n); (session.parentId ? parent.subs : parent.sessions).push(n);
        n.status = statusOf(session); n.fresh = true; changed = true;
      }
      if (!n.present) { n.present = true; changed = true; }
      const status = statusOf(session), was = n.status, mode = MODES[session.permissionMode] || '', plan = planOf(session);
      if (mode !== n.mode || (plan?.total ?? 0) !== (n.plan?.total ?? 0)) changed = true;
      Object.assign(n, { session, name: session.title || 'Session', provider: session.provider, mode, plan, model: session.model || '', ctx: contextOf(session), text: textOf(session, status) });
      const since = (needs(status) && session.requests?.[0]?.createdAt) || session.statusSince || session.updatedAt || now;
      if (needs(status) && (!needs(was) || n.fresh)) n.since = since;
      if (n.fresh) { n.fresh = false; n.status = status; if (world.synced) emit('spawn', n); if (needs(status)) emit('need', n); }
      else if (status !== was) {
        n.status = status; emit('state', n, { from: was, to: status });
        if (needs(status)) emit('need', n);
        if (needs(was) && !needs(status)) emit('answer', n);
        if (was === 'compacting') emit('compacted', n);
        if (status === 'idle' && BUSY.has(was)) emit('finish', n);
      }
      const detail = status === 'working' ? session.detail || '' : '';
      if (detail && detail !== n.tool) { n.s.heat = Math.min(1, n.s.heat + .5); emit('tool', n, { tool: detail, kind: toolKind(detail) }); }
      n.tool = detail || n.tool; n.toolKind = toolKind(n.tool);
    }
    for (const n of [...world.sessions, ...world.subs]) if (n.present && !here.has(n.id)) { n.present = false; emit('despawn', n); }
    for (const p of world.projects) p.present = p.sessions.some(s => s.present);
    if (changed) { restructure(); for (const n of world.nodes) if (n.s.alive === 0 && n.present && n.pos.lengthSq() === 0) arrive(n); }
    world.synced = true; queued = null;
  };
  // A session just fired from the panel leaves before the server has caught up.
  world.remove = id => { const n = byId.get(id); queued = null; lastKey = ''; if (n?.present) { n.present = false; emit('despawn', n); for (const k of n.subs || []) k.present = false; } };

  // Nodes that have faded out leave the board; that changes the structure, so the look is built again without them.
  function prune() {
    const gone = world.nodes.filter(n => n.kind !== 'you' && !n.present && n.s.alive <= 0 && !n.subs?.some(k => k.present || k.s.alive > 0) && !n.sessions?.some(s => s.present || s.s.alive > 0));
    if (!gone.length) return;
    for (const n of gone) { byId.delete(n.id); const list = n.kind === 'project' ? world.projects : n.kind === 'sub' ? n.parent.subs : n.parent.sessions; list.splice(list.indexOf(n), 1); }
    restructure();
  }

  const goal = new THREE.Vector3(), tmp = new THREE.Vector3();
  let fastest = 0, wander = false;
  function physics(dt) {
    fastest = 0; wander = false;
    const m = world.motion, zeta = world.reduced ? 1 : m.zeta, k = m.k, c = 2 * Math.sqrt(k) * zeta, t = world.time, drift = world.reduced ? 0 : .1 * m.drift;
    for (const n of world.nodes) {
      if (n.kind === 'you' || n.kind === 'project') goal.copy(n.rest);
      else goal.copy(n.parent.pos).add(n.offset);
      if (drift && n.kind !== 'you') goal.x += Math.sin(t * .5 + n.seed % 7) * drift, goal.z += Math.cos(t * .43 + n.seed % 11) * drift;
      if (n.magnet) { tmp.subVectors(n.magnet, goal).setY(0); const len = tmp.length(); if (len > 0) goal.addScaledVector(tmp, Math.min(.12, .5 / len) * m.drift); }
      n.vel.x += ((goal.x - n.pos.x) * k - n.vel.x * c) * dt;
      n.vel.y += ((goal.y - n.pos.y) * k - n.vel.y * c) * dt;
      n.vel.z += ((goal.z - n.pos.z) * k - n.vel.z * c) * dt;
      n.pos.addScaledVector(n.vel, dt);
      if (n.kind !== 'you') wander = true;
      let v2 = n.vel.x * n.vel.x + n.vel.y * n.vel.y + n.vel.z * n.vel.z;
      // Without the wander a spring only creeps closer for ever: land it, so a still board's frames change nothing to upload.
      if ((!drift || n.kind === 'you') && v2 < 1e-6 && n.pos.distanceToSquared(goal) < 1e-6) { n.pos.copy(goal); n.vel.set(0, 0, 0); v2 = 0; }
      if (v2 > fastest) fastest = v2;
    }
    if (!drift) wander = false;
  }

  // Each signal eases toward its target and lands once the rest wouldn't show; easing stays true while any is still on its way
  // (urgency creeps over ten minutes and never counts: it follows the clock, not frames, as a still board is drawn about once a minute).
  let easing = false;
  const ease = (v, to, k) => { const d = to - v; if (d > .004 || d < -.004) { easing = true; return v + d * k; } return to; };
  function smooth(dt) {
    const f = 1 - Math.exp(-dt * 6), g = 1 - Math.exp(-dt * 10), now = Date.now(), fu = 1 - Math.exp(-Math.max(dt, lastSmooth ? Math.min(60, (now - lastSmooth) / 1000) : 0) * 6);
    easing = false; lastSmooth = now;
    for (const n of world.nodes) {
      const s = n.s, st = n.status, live = n.kind === 'session' || n.kind === 'sub';
      s.alive = Math.max(0, Math.min(1, s.alive + (n.present ? 1 : -1) * dt * 1.6));
      if (s.alive > 0 && s.alive < 1) easing = true;
      s.hover = ease(s.hover, n.hovered ? 1 : 0, g);
      s.select = ease(s.select, n.selected ? 1 : 0, g);
      if (!live) continue;
      n.waitSec = needs(st) ? Math.max(0, (now - n.since) / 1000) : 0;
      s.work = ease(s.work, st === 'working' ? 1 : 0, f);
      s.think = ease(s.think, st === 'thinking' ? 1 : 0, f);
      s.compact = ease(s.compact, st === 'compacting' ? 1 : 0, f);
      s.need = ease(s.need, needs(st) ? 1 : 0, f);
      s.wait = ease(s.wait, st === 'waiting' ? 1 : 0, f);
      s.idle = ease(s.idle, st === 'idle' ? 1 : 0, f);
      s.error = ease(s.error, st === 'error' ? 1 : 0, f);
      s.off = ease(s.off, st === 'offline' ? 1 : 0, f);
      if (s.heat > 0) { s.heat = Math.max(0, s.heat - dt * 1.4); easing = true; }
      s.urgency += ((s.need > .5 ? Math.min(1, n.waitSec / 600) : 0) - s.urgency) * fu;
      s.ctx = s.ctx === undefined || n.ctx === undefined ? n.ctx : ease(s.ctx, n.ctx, f);
    }
  }

  // Everything that happened since the last call: the snapshots' differences, then nodes that finished leaving.
  // elapsed: the time since the last update when that's more than dt (a slow pace), for world.time, the clock looks animate by.
  world.update = (dt, elapsed = dt) => {
    world.time += elapsed;
    smooth(dt); physics(dt); prune();
    // The idle wander moves a node at about .05 a second times the look's drift (magnets add a little); springing is far faster.
    // Without the wander a spring is 'fast' until it lands (physics): stopped short, it would creep on with every later frame.
    world.stir = easing || fastest > (wander ? .3 * .3 * Math.max(1, world.motion.drift) ** 2 : 0) ? 'fast' : wander ? 'drift' : '';
    const out = events; events = []; return out;
  };
  world.layout = layout;
  // Who's waiting on you, longest first. Kept until the board changes (queued, above); callers only read it.
  world.queue = () => queued ||= world.sessions.filter(s => s.present && needs(s.status)).sort((a, b) => a.since - b.since);
  world.byId = id => byId.get(id);
  return world;
}
