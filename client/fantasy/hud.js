// The windows over the fights: the bar, one tile per project, and the party and enemy windows of the fight in focus. The DOM is touched only when something changed.
import { usageAccounts } from '../usage.js';
import { paintPortrait } from './portraits.js';
import { tileLayout } from './camera.js';
import { busy, hasTurn, hpBand, needsYou, tokens, turnGauge } from './roster.js';

const GLYPH = { working: '⚔', thinking: '✦', compacting: '✚', permission: '!', question: '?', waiting: '…', idle: 'Zzz', done: '✓', error: '✕', offline: '○' };
const WORD = { working: 'Working', thinking: 'Thinking', compacting: 'Compacting', permission: 'Needs approval', question: 'Has a question', waiting: 'Waiting', idle: 'Idle', done: 'Finished', error: 'Error', offline: 'Offline' };
const SHOUT = { permission: 'READY!', question: '?' };

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const tip = (node, text) => { if (node.title !== text) node.title = text; };
const cls = (node, name) => { if (node.className !== name) node.className = name; };
const fill = (node, percent) => { const width = `${percent.toFixed(1)}%`; if (node.style.width !== width) node.style.width = width; };
const button = (className, text, label, onClick) => { const node = el('button', className, text); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.onclick = onClick; return node; };
// A mark in the bar, drawn in pixels (scripts/fantasy-frames.mjs).
const pixelMark = name => el('i', `fy-mark fy-m-${name}`);
const bar = () => { const track = el('u'), inner = el('b'); track.append(inner); return { track, inner }; };

const sinceOf = member => { const at = member.askedAt || member.session?.statusSince, ms = typeof at === 'number' ? at : Date.parse(at); return Number.isFinite(ms) ? ms : null; };
export function elapsed(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}
const gaugeWords = (member, gauge, time) => gauge.tone === 'ready' ? 'Your move' : gauge.tone === 'error' ? 'Stopped on an error' : [`${WORD[member.state]}${time ? ` ${time}` : ''}`, gauge.last && `last turn took ${elapsed(Date.now() - gauge.last)}`].filter(Boolean).join(', ');
const showsTime = state => needsYou(state) || state === 'waiting' || state === 'error' || state === 'compacting';
// What this member is up to, in the fewest words that are still true.
export function statusLine(member) {
  const { state, detail, request, job } = member;
  if (needsYou(state)) return request?.title || WORD[state];
  if (state === 'working') return detail || WORD.working;
  if (state === 'error') return detail || WORD.error;
  if (state === 'waiting') return job || WORD.waiting;
  return WORD[state] || state;
}
// Hovering anything that stands for a member brings up their bubble; a finger just opens them.
const hovers = (node, actions) => {
  node.onpointerenter = event => { if (event.pointerType === 'mouse') actions.hover(node.dataset.id); };
  node.onpointerleave = () => actions.hover(null);
  node.onfocus = () => { if (node.matches(':focus-visible')) actions.hover(node.dataset.id); };
  node.onblur = () => actions.hover(null);
};

function createRow(actions) {
  const row = button('fy-row', null, '', () => actions.open(row.dataset.id));
  const nm = el('span', 'fy-nm'), face = el('i'), name = el('span'), st = el('span', 'fy-st'), glyph = el('b'), line = el('span'), tag = el('i'), tm = el('span', 'fy-tm'), turn = bar(), tmText = el('em'), md = el('span', 'fy-md');
  const hp = el('span', 'fy-bar'), hpBar = bar(), hpText = el('em');
  nm.append(face, name); st.append(glyph, line, tag); hp.append(hpBar.track, hpText); tm.append(turn.track, tmText); row.append(nm, st, tm, md, hp);
  hovers(row, actions);
  return {
    row,
    set(member) {
      row.dataset.id = member.id;
      const band = hpBand(member.hp?.ratio), status = statusLine(member), minions = member.minions.length;
      cls(row, `fy-row${needsYou(member.state) ? ' ready' : ''}${member.state === 'error' ? ' error' : ''}${['idle', 'offline'].includes(member.state) ? ' faded' : ''}${band ? ` ${band}` : ''}`);
      row.setAttribute('aria-label', `${member.title}, ${WORD[member.state] || member.state}`); row.removeAttribute('title');
      paintPortrait(face, member.session); put(name, member.title); put(md, member.model); put(glyph, GLYPH[member.state] || '·'); put(line, status);
      put(tag, [member.mode === 'berserk' ? 'Berserk' : member.mode === 'scan' ? 'Scan' : '', member.plan ? `${member.plan.done}/${member.plan.total}` : '', minions ? `+${minions}` : ''].filter(Boolean).join(' '));
      const gauge = turnGauge(member), time = showsTime(member.state) || busy(member.state) ? elapsed(sinceOf(member)) : '';
      cls(tm, `fy-tm${gauge ? ` ${gauge.tone}` : ''}${gauge?.urgent ? ' urgent' : ''}${gauge && gauge.ratio == null ? ' unknown' : ''}`); turn.track.hidden = !gauge; fill(turn.inner, (gauge?.ratio ?? 0) * 100); put(tmText, time); tip(tm, gauge ? gaugeWords(member, gauge, time) : '');
      cls(hp, `fy-bar${band ? ` ${band}` : ''}`); fill(hpBar.inner, (member.hp?.ratio ?? 0) * 100); put(hpText, member.hp ? tokens(member.hp.left) : '—'); tip(hp, member.hp ? `${tokens(member.hp.left)} left before it compacts` : 'Context not reported');
      tip(tag, [member.mode === 'berserk' ? 'Berserk: asks for no permissions' : member.mode === 'scan' ? 'Scan: plan mode, changes nothing yet' : '', member.plan ? `${member.plan.done} of ${member.plan.total} plan steps done` : '', minions ? `${minions} subagent${minions > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')); tip(md, 'Model');
    },
  };
}

function createTile(project, actions) {
  const tile = el('button', 'fy-tile'); tile.type = 'button'; tile.dataset.project = project;
  // A session's row, plate or body opens it; the project's name, even with someone's mark behind it, and anywhere else the whole fight. A key press has no point to go by. Measured, as not every browser sends a button's children their own events.
  const over = (node, event) => { const box = node.getBoundingClientRect(); return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom; };
  const rowAt = event => [...held].find(([, chip]) => over(chip.node, event))?.[0] ?? null;
  tile.onclick = event => { if (event.detail && over(title, event)) { actions.peek(null); actions.zoom(project); } else actions.pick(project, event, event.detail ? rowAt(event) : null); };
  tile.onpointermove = event => { if (event.pointerType === 'mouse') actions.peek(over(title, event) ? null : project, event, rowAt(event)); };
  tile.onpointerleave = () => actions.peek(null);
  const top = el('span', 'fy-t-top'), title = el('b', null, project), low = el('span', 'fy-t-low'), chips = el('span', 'fy-chips');
  top.append(title); low.append(chips); tile.append(top, low);
  const held = new Map();
  return {
    tile,
    set(data) {
      const asking = data.members.find(member => needsYou(member.state));
      cls(tile, `fy-tile${asking ? ' alarm' : ''}`); tile.setAttribute('aria-label', `${project}, ${data.members.length} in the party`); tile.dataset.party = data.members.length;
      const ids = new Set(data.members.map(member => member.id));
      for (const [id, chip] of held) if (!ids.has(id)) { chip.node.remove(); held.delete(id); }
      data.members.forEach((member, i) => {
        let chip = held.get(member.id);
        if (!chip) { const node = el('span'), face = el('i'), name = el('b'), doing = el('span'), time = el('em'), hp = bar(); node.append(face, name, doing, time, hp.track); chip = { node, face, name, doing, time, hp }; held.set(member.id, chip); }
        chip.node.dataset.id = member.id; if (chips.children[i] !== chip.node) chips.insertBefore(chip.node, chips.children[i] || null);
        const band = hpBand(member.hp?.ratio);
        cls(chip.node, `fy-chip c-${member.state}${needsYou(member.state) ? ' ask' : ''}`); paintPortrait(chip.face, member.session); put(chip.name, member.title); put(chip.doing, statusLine(member)); put(chip.time, showsTime(member.state) ? elapsed(sinceOf(member)) : '');
        cls(chip.hp.track, band); chip.hp.track.hidden = !member.hp; fill(chip.hp.inner, (member.hp?.ratio ?? 0) * 100);
      });
    },
  };
}

// `actions`: zoom(project), pick(project, event, id), peek(project, event), back(), open(id), hover(id), next(), list(), spawn(control), look(low), reset().
export function createHud(box, actions) {
  const ui = el('div', 'fy-ui'), top = el('div', 'fy-top win'), body = el('div', 'fy-body'), tiles = el('div', 'fy-tiles'), under = el('div', 'fy-under'), empty = el('div', 'fy-empty win');
  const list = button('fy-nav', '', 'Show the list', () => actions.list());
  const back = button('fy-nav', '', 'Back to all fights', () => actions.back());
  const add = button('fy-nav', '', 'New agent', () => actions.spawn(add));
  // A narrow scene keeps the commands' marks and drops their words.
  for (const [node, mark, word] of [[list, 'list', 'List'], [back, 'back', 'Back'], [add, 'plus', 'New']]) node.append(pixelMark(mark), el('span', 'fy-word', ` ${word}`));
  // With nothing to show, starting something is the whole screen's business.
  const start = button('fy-nav', '', 'New agent', () => actions.spawn(start)); start.append(pixelMark('plus'), ' New'); empty.append(el('span', '', 'No sessions'), start);
  const crumb = el('strong', 'fy-crumb'), conn = el('span', 'fy-conn', 'Connection lost'), limits = el('span', 'fy-limits');
  const next = button('fy-next', '', 'Next waiting', () => actions.next());
  let low = false; const look = button('fy-look', '', 'Switch between the PS1 and HD look', () => actions.look(!low));
  const reset = button('fy-icon fy-reset', '', 'Reset the camera', () => actions.reset()); reset.append(pixelMark('reset'));
  // A narrow bar folds the look, the camera and full screen into one menu.
  const more = el('span', 'fy-more'), sheet = el('div', 'fy-sheet win'), dots = button('fy-nav fy-dots', '', 'More', () => (sheet.hidden ? openMore() : closeMore())); dots.append(pixelMark('dots'));
  dots.setAttribute('aria-haspopup', 'menu'); dots.setAttribute('aria-expanded', 'false'); sheet.setAttribute('role', 'menu'); sheet.hidden = true; more.append(dots, sheet);
  const item = (word, act) => { const node = el('button', null, word), value = el('em'); node.type = 'button'; node.setAttribute('role', 'menuitem'); node.append(value); node.onclick = act; sheet.append(node); return { node, word, value }; };
  const show = (it, value) => { put(it.value, value); it.node.setAttribute('aria-label', `${it.word}: ${value}`); };
  const lookItem = item('Look', () => actions.look(!low)), resetItem = item('Reset camera', () => { closeMore(true); actions.reset(); });
  const screenItem = item('Full screen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  const showScreen = () => show(screenItem, document.fullscreenElement ? 'On' : 'Off');
  resetItem.value.append(pixelMark('reset')); resetItem.node.setAttribute('aria-label', resetItem.word); screenItem.node.hidden = !document.fullscreenEnabled; showScreen();
  const shown = () => [...sheet.children].filter(node => !node.hidden);
  function openMore() { sheet.hidden = false; dots.setAttribute('aria-expanded', 'true'); shown()[0]?.focus(); }
  function closeMore(refocus) { if (sheet.hidden) return; sheet.hidden = true; dots.setAttribute('aria-expanded', 'false'); if (refocus) dots.focus(); }
  more.onkeydown = event => {
    const items = shown(), at = items.indexOf(document.activeElement), step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (sheet.hidden) return;
    if (event.key === 'Escape') closeMore(true);
    else if (step) items[(Math.max(at, step > 0 ? -1 : 0) + step + items.length) % items.length]?.focus();
    else if (event.key === 'Home' || event.key === 'End') items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    else return;
    // Not the scene's too: Escape here closes the menu, not the fight.
    event.preventDefault(); event.stopPropagation();
  };
  more.addEventListener('focusout', event => { if (event.relatedTarget && !more.contains(event.relatedTarget)) closeMore(); });
  const outside = event => { if (!sheet.hidden && !more.contains(event.target)) closeMore(); };
  document.addEventListener('pointerdown', outside, true); document.addEventListener('fullscreenchange', showScreen);
  top.append(list, back, add, crumb, conn, el('span', 'fy-grow'), limits, next, look, reset, more);
  // These work beside an open panel; the rest take its place.
  for (const node of [next, look, reset]) node.dataset.beside = '';
  const hud = el('div', 'fy-hud'), banner = el('div', 'fy-banner win'), bannerName = el('b'), bannerLine = el('span'), spacer = el('div', 'fy-spacer'), wins = el('div', 'fy-wins');
  const foes = el('div', 'fy-foes win'), ask = el('div', 'fy-ask win'), askShout = el('b'), askText = el('p'), answer = el('button', 'fy-answer', 'Answer'), party = el('div', 'fy-party win'), head = el('div', 'fy-row fy-head');
  answer.type = 'button'; answer.onclick = () => askId && actions.open(askId);
  const contextHead = el('span', '', 'Context'); contextHead.title = 'Room left before this session has to compact';
  const turnHead = el('span', '', 'Turn'); turnHead.title = 'How long this turn has run, against the last one. Full: your move';
  head.append(el('span', '', ''), el('span', '', ''), turnHead, el('span', 'fy-md', ''), contextHead);
  const foeList = el('div', 'fy-foelist'), sum = el('div', 'fy-sum'); foes.append(foeList, sum);
  ask.append(askShout, askText, answer); banner.append(bannerName, bannerLine); party.append(head); wins.append(foes, ask, party); hud.append(banner, spacer, wins);
  tiles.append(under); body.append(tiles, hud, empty); ui.append(top, body); box.append(ui);
  const tileOf = new Map(), rows = new Map(), foeLines = [];
  let order = '', laid = '', askId = null, bannerLeft = 0, bannerBig = false, limitsKey = '', focused = null;
  // Nothing says "no sessions" until a snapshot has really said so.
  hud.hidden = true; conn.hidden = true; ask.hidden = true; empty.hidden = true; banner.classList.add('off');
  const setLook = value => { low = value; put(look, value ? 'PS1' : 'HD'); show(lookItem, value ? 'PS1' : 'HD'); };

  const refreshParty = data => {
    const ids = new Set(data.members.map(member => member.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.row.remove(); rows.delete(id); }
    data.members.forEach((member, i) => {
      let row = rows.get(member.id);
      if (!row) { row = createRow(actions); rows.set(member.id, row); }
      if (party.children[i + 1] !== row.row) party.insertBefore(row.row, party.children[i + 1] || null);
      row.set(member);
    });
    const asking = data.members.find(member => needsYou(member.state));
    askId = asking?.id ?? null; ask.hidden = !asking; foes.hidden = !!asking;
    if (asking) { put(askShout, `${SHOUT[asking.state]} ${asking.title}`); put(askText, statusLine(asking)); tip(askText, statusLine(asking)); return; }
    // One line per member, in the party's order: what they were asked to do, dimmed once it's over.
    data.members.forEach((member, i) => {
      let line = foeLines[i];
      if (!line) { const node = button('fy-foe', null, '', () => actions.open(node.dataset.id)); line = { node, glyph: el('b'), name: el('span'), count: el('small') }; node.append(line.glyph, line.name, line.count); hovers(node, actions); foeLines[i] = line; }
      if (foeList.children[i] !== line.node) foeList.insertBefore(line.node, foeList.children[i] || null);
      const over = !hasTurn(member.state);
      line.node.dataset.id = member.id; cls(line.node, `fy-foe${over ? ' over' : ''}`); line.node.setAttribute('aria-label', `${member.title}: ${member.task || member.title}`); line.node.removeAttribute('title');
      put(line.glyph, over ? '✓' : '⚔'); put(line.name, member.task || member.title); put(line.count, member.minions.length ? `+${member.minions.length}` : ''); tip(line.count, member.minions.length ? `${member.minions.length} subagent${member.minions.length > 1 ? 's' : ''}` : '');
    });
    while (foeList.children.length > data.members.length) foeList.lastChild.remove();
    // The fight as a whole, from what the sessions report.
    const branches = [...new Set(data.members.map(member => member.branch).filter(Boolean))], costs = data.members.map(member => member.cost).filter(Boolean), usd = costs.reduce((all, cost) => all + (cost.usd || 0), 0), added = costs.reduce((all, cost) => all + (cost.added || 0), 0), removed = costs.reduce((all, cost) => all + (cost.removed || 0), 0);
    put(sum, [branches.length > 1 ? `${branches.length} branches` : branches[0], usd > 0 && `$${usd.toFixed(2)}`, (added || removed) && `+${added} −${removed}`].filter(Boolean).join(' · ')); sum.hidden = !sum.textContent; tip(sum, 'Branch, cost so far, and lines added and removed');
  };
  return {
    ui, tiles, under, top, wins, body, hud,
    setLook,
    // The tiles of these fights, in this order; `hidden(fight)` for those the sidebar filtered out.
    setFights(fights, hidden) {
      for (const [project, tile] of tileOf) if (!fights.some(fight => fight.project === project)) { tile.tile.remove(); tileOf.delete(project); }
      for (const data of fights) { let tile = tileOf.get(data.project); if (!tile) { tile = createTile(data.project, actions); tileOf.set(data.project, tile); } tile.set(data); tile.tile.hidden = hidden(data); }
      const now = fights.map(fight => fight.project).join('\n');
      if (now !== order) { order = now; tiles.append(...fights.map(fight => tileOf.get(fight.project).tile)); }
      empty.hidden = fights.length > 0; ui.classList.toggle('bare', !fights.length);
    },
    tile: project => tileOf.get(project)?.tile ?? null,
    // Bigger parties get bigger tiles. Asked twice a second, so only a change in the parties or the room lays them out again.
    layout(width, height) {
      const shown = [...tiles.querySelectorAll('.fy-tile:not([hidden])')], parties = shown.map(tile => +tile.dataset.party || 1);
      const key = `${shown.map(tile => tile.dataset.project).join('\n')}|${parties}|${Math.round(width)}|${Math.round(height)}`;
      if (key === laid) return;
      laid = key;
      const { units, tracks, tiles: placed } = tileLayout(parties, width, height);
      tiles.style.gridTemplateColumns = `repeat(${units}, minmax(0, 1fr))`;
      tiles.style.gridTemplateRows = tracks.map(h => `minmax(min-content, ${Math.max(1, Math.round(h))}fr)`).join(' ');
      shown.forEach((tile, i) => {
        const { row, column, fight } = placed[i];
        tile.style.gridArea = `${row[0]} / ${column[0]} / ${row[1]} / ${column[1]}`;
        tile.style.setProperty('--fy-fight', fight ? `${Math.round(fight)}px` : '');
      });
    },
    // The fight in the windows, or null for the tiles. A `lone` fight has no tiles to go back to.
    focus(data, lone = false) {
      focused = data;
      ui.classList.toggle('zoomed', !!data); hud.hidden = !data; back.hidden = !data || lone; reset.hidden = resetItem.node.hidden = !data; crumb.hidden = !data; tiles.inert = !!data;
      if (data) { put(crumb, data.project); refreshParty(data); } else banner.classList.add('off');
      const adds = data ? `New agent in ${data.project}` : 'New agent'; add.title = adds; add.setAttribute('aria-label', adds);
    },
    setLone(lone) { back.hidden = !focused || lone; },
    refresh(data) { if (data && focused) refreshParty(data); },
    status({ error, waiting, usage }) {
      conn.hidden = !error;
      next.hidden = !waiting; put(next, waiting ? `⚠ ${waiting}` : '');
      // The list's own gauges (usage.js), so the scene's bar and the list's header read the same.
      const key = JSON.stringify([usage, !!error, Math.floor(Date.now() / 60_000)]);
      if (key === limitsKey) return;
      limitsKey = key;
      limits.replaceChildren(...usage ? [usageAccounts(usage, { disconnected: !!error })] : []);
    },
    // A summon or big spell keeps the banner until it ends; small attacks don't talk over it.
    banner(name, line, seconds, big, final) {
      if (bannerBig && bannerLeft > 0 && !big) return;
      bannerBig = !!big; put(bannerName, name); put(bannerLine, line || ''); bannerLine.title = line || ''; banner.classList.toggle('big', bannerBig); banner.classList.toggle('final', !!final); banner.classList.remove('off'); bannerLeft = seconds;
    },
    tick(dt) { if (bannerLeft > 0) { bannerLeft -= dt; if (bannerLeft <= 0) banner.classList.add('off'); } },
    dispose() { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('fullscreenchange', showScreen); ui.remove(); },
  };
}
