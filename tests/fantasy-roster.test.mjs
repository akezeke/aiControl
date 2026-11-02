import { modelName, taskOf } from '../client/fantasy/roster.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFights, classOf, familyOf, formation, hpOf, hpBand, nameOf, placeOf, placesFor, PLACE_KEYS, stateOf, TIMES, turnGauge } from '../client/fantasy/roster.js';
import { abilityOf, actionWords } from '../client/fantasy/abilities.js';
import { fit, homeView, PARTY_VIEW, spotsFor, tileLayout, FOV } from '../client/fantasy/camera.js';
import { summary } from '../client/theme-console.js';

test('a project is a fight, a session a member and its subagents that member\'s minions', () => {
  const fights = buildFights([{ id: 'a', project: 'x' }, { id: 'b', project: 'x', title: 'Fix login' }, { id: 'kid', project: 'x', parentId: 'b', title: 'Explore' }, { id: 'c', project: 'y' }]);
  assert.deepEqual(fights.map(fight => fight.project), ['x', 'y']);
  const [a, b] = fights[0].members;
  assert.deepEqual([a.id, b.id, b.family], ['a', 'b', 'bug']);
  assert.deepEqual(b.minions.map(minion => [minion.id, minion.kind]), [['kid', 'bat']]);
  assert.equal(a.minions.length, 0);
});
test('whoever needs you comes first', () => {
  const fights = buildFights([{ id: 'a', project: 'a', status: 'working' }, { id: 'b', project: 'b', status: 'idle' }, { id: 'c', project: 'c', status: 'question' }]);
  assert.equal(fights[0].project, 'c');
});
test('a subagent whose parent is gone still fights', () => {
  assert.deepEqual(buildFights([{ id: 'kid', project: 'x', parentId: 'gone' }])[0].members.map(member => member.id), ['kid']);
});
test('the same session is always the same person in the same place', () => {
  assert.equal(nameOf('abc'), nameOf('abc'));
  assert.ok(PLACE_KEYS.includes(placeOf('project')));
  assert.equal(placeOf('project'), placeOf('project'));
});
test('every project fights somewhere of its own, the same on every device', () => {
  const projects = ['aiControl', 'billing', 'docs', 'infra', 'mobile', 'web'], places = placesFor(projects);
  assert.equal(new Set(projects.map(project => places.get(project).place)).size, PLACE_KEYS.length);
  assert.deepEqual([...placesFor([...projects].reverse())].sort(), [...places].sort());
  assert.ok(projects.every(project => places.get(project).time === 'day'));
  // A lone project keeps the place it always had.
  assert.deepEqual(placesFor(['solo']).get('solo'), { place: placeOf('solo'), time: 'day' });
});
test('past six projects a place comes again at another hour', () => {
  const projects = Array.from({ length: 14 }, (_, i) => `p${i}`), places = placesFor(projects), seen = new Set(projects.map(project => `${places.get(project).place}/${places.get(project).time}`));
  assert.equal(seen.size, projects.length);
  assert.deepEqual(TIMES.map(time => projects.filter(project => places.get(project).time === time).length), [6, 6, 2]);
});
test('a fight is where the server says, or somewhere of its own without', () => {
  const sessions = ['a', 'b', 'c', 'd'].map(project => ({ id: project, project }));
  assert.equal(new Set(buildFights(sessions).map(fight => fight.place)).size, 4);
  const fights = buildFights(sessions, undefined, { a: { place: 'wrecks', time: 'night' } });
  assert.deepEqual(fights.find(fight => fight.project === 'a'), { ...fights.find(fight => fight.project === 'a'), place: 'wrecks', time: 'night' });
  assert.deepEqual(['place', 'time'].map(key => fights.find(fight => fight.project === 'b')[key]), [placeOf('b'), 'day']);
});
test('the provider picks the side and the session the class, so one model still makes a mixed party', () => {
  const classes = (provider, count = 24) => new Set(Array.from({ length: count }, (_, i) => classOf({ provider, id: `s${i}`, model: 'same-model' })));
  assert.deepEqual([...classes('claude')].sort(), ['duelist', 'gunner', 'rogue', 'sage']);
  assert.deepEqual([...classes('codex')].sort(), ['gunner', 'knight']);
  assert.equal(classOf({ provider: 'claude', id: 'a' }), classOf({ provider: 'claude', id: 'a' }));
});
test('nobody in a party shares a name', () => {
  const [fight] = buildFights(Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, project: 'x' })));
  assert.equal(new Set(fight.members.map(member => member.name)).size, 60);
  assert.equal(fight.members[0].name, nameOf('s0'));
});
test('the title picks the enemy, always the same one', () => {
  assert.equal(familyOf('Fix the crash'), 'bug');
  assert.equal(familyOf('Refactor sessions'), 'golem');
  assert.equal(familyOf('Something else'), familyOf('Something else'));
});
test('HP is the room left before Compact', () => {
  assert.equal(hpOf({}), null);
  assert.equal(hpOf(null), null);
  const hp = hpOf({ used: 66_000, window: 200_000 });
  assert.equal(hp.max, 166_000);
  assert.equal(hp.left, 100_000);
  assert.ok(Math.abs(hp.ratio - 100_000 / 166_000) < 1e-9);
  assert.equal(hpOf({ used: 190_000, window: 200_000 }).left, 0);
  assert.equal(hpOf({ used: 300_000 }).max, 830_000);
  assert.deepEqual([hpBand(null), hpBand(.5), hpBand(.2), hpBand(.05)], ['', '', 'low', 'crit']);
});
test('states come from the session', () => {
  assert.equal(stateOf({ status: 'working', activity: 'compacting' }), 'compacting');
  assert.equal(stateOf({ status: 'question' }), 'question');
  assert.equal(stateOf({ status: 'idle', waitingOn: 'job' }), 'waiting');
  assert.equal(stateOf({ status: 'idle' }, true), 'done');
  assert.equal(stateOf({ status: 'idle' }, false), 'idle');
});
test('a miss is only ever a tool that really failed', () => {
  const [member] = buildFights([{ id: 'a', project: 'x', messages: [{ tool: 'Bash', id: 1, failed: true }, { tool: 'Read', id: 2 }] }])[0].members;
  assert.deepEqual(member.tool, { id: 2, failed: false });
  assert.equal(buildFights([{ id: 'a', project: 'x', messages: [{ tool: 'Bash', id: 1, failed: true }] }])[0].members[0].tool.failed, true);
  assert.equal(buildFights([{ id: 'a', project: 'x' }])[0].members[0].tool, null);
});
test('a tool line becomes its move and keeps the real line', () => {
  const key = line => abilityOf(line).key;
  assert.equal(key('Read · a.js'), 'scan');
  assert.equal(key('Grep · foo'), 'seek');
  assert.equal(key('Edit · a.js'), 'cut');
  assert.equal(key('Write · a.js'), 'forge');
  assert.equal(key('Bash · npm test'), 'trial');
  assert.equal(key('Bash · git commit -m x'), 'seal');
  assert.equal(key('Bash · git push'), 'launch');
  assert.equal(key('Bash · ls'), 'strike');
  assert.equal(key('WebFetch · x'), 'sight');
  assert.equal(abilityOf('Read · a.js').line, 'Read · a.js');
  assert.deepEqual([abilityOf('Agent · explore-code').name, abilityOf('Agent · x').summon], ['Summon Explore Code', true]);
  assert.deepEqual([abilityOf('Skill · code-review').name, abilityOf('Skill · x').big], ['Code Review', true]);
});
test('the party and its enemies stand in two lines that nobody hides behind', () => {
  const { party, enemies } = formation(5), yaw = homeView(1.6).yaw, across = ([x, , z]) => x * Math.cos(yaw) - z * Math.sin(yaw);
  assert.equal(party.length, 5); assert.equal(enemies.length, 5);
  for (let i = 0; i < 5; i++) assert.ok(party[i][0] > 0 && enemies[i][0] < 0, 'on their own sides');
  const spread = [...party].map(across).sort((a, b) => a - b);
  for (let i = 1; i < 5; i++) assert.ok(spread[i] - spread[i - 1] > 1, `gap ${spread[i] - spread[i - 1]}`);
});
test('a wide enemy takes room on the line, and the line never crosses the field', () => {
  const yaw = homeView(1.6).yaw, across = ([x, , z]) => x * Math.cos(yaw) - z * Math.sin(yaw), widths = [9, 3, 7, 3, 9];
  const { enemies } = formation(5, widths);
  for (let i = 1; i < 5; i++) assert.ok(Math.abs(across(enemies[i]) - across(enemies[i - 1])) >= (widths[i] + widths[i - 1]) / 2 * .85, `gap ${i}`);
  for (const count of [1, 5, 12]) for (const at of formation(count, Array(count).fill(12)).enemies) assert.ok(at[0] < -1, `x ${at[0]}`);
});
test('every view keeps everyone in frame', () => {
  for (const count of [1, 2, 3, 5, 8, 12]) for (const [aspect, clear] of [[1.6, 0], [1.6, .3], [.5, .35], [2.4, 0]]) for (const yaw of [homeView(aspect).yaw, 0, 1.6, 3.1, -2]) {
    const pitch = homeView(aspect).pitch, spots = spotsFor(formation(count, Array.from({ length: count }, (_, i) => 3 + i % 3 * 3))), view = fit({ spots, aspect, yaw, pitch, clear });
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], tan = Math.tan(FOV * Math.PI / 360);
    for (const spot of spots) {
      const d = [0, 1, 2].map(i => spot[i] - view.position[i]), depth = -dot(d, view.back);
      assert.ok(depth > 0, 'in front of the camera');
      assert.ok(Math.abs(dot(d, view.right)) / depth <= tan * aspect + 1e-6, `across at ${count}, ${aspect}, ${yaw}`);
      assert.ok(Math.abs(dot(d, view.up)) / depth <= tan * Math.max(.2, 1 - clear) + 1e-6, `up at ${count}, ${aspect}, ${yaw}`);
    }
  }
});
test('whoever\'s resting goes behind whoever isn\'t', () => {
  const rest = [true, false, true, false, false], { party } = formation(5, [], rest), front = Math.max(...party.filter((_, i) => !rest[i]).map(at => at[0]));
  for (const i of [0, 2]) assert.ok(party[i][0] > front, `member ${i} at ${party[i][0]}`);
  assert.deepEqual(formation(3, [], [true, true, true]).party, formation(3).party);
});
test('a long line makes ranks, with the rank behind showing through the gaps', () => {
  for (const [aspect, perRank] of [[.5, 3], [1.5, 4], [1.6, 5]]) for (const count of [6, 8, 12]) {
    const { party } = formation(count, [], [], perRank), { yaw, pitch } = homeView(aspect), spot = ([x, , z]) => [x * Math.cos(yaw) - z * Math.sin(yaw), (x * Math.sin(yaw) + z * Math.cos(yaw)) * Math.sin(pitch)];
    for (let i = 0; i < count; i++) for (let j = 0; j < i; j++) {
      const a = spot(party[i]), b = spot(party[j]);
      assert.ok(Math.abs(a[0] - b[0]) > .35 || Math.abs(a[1] - b[1]) > 1, `${i} on ${j} of ${count} at ${perRank}`);
    }
  }
});
test('short ranks let a phone draw everyone larger', () => {
  const room = perRank => { const view = fit({ spots: spotsFor(formation(8, Array(8).fill(4), [], perRank)), aspect: .5, ...homeView(.5), clear: .3 }); return view.distance; };
  assert.ok(room(3) < room(5), `${room(3)} against ${room(5)}`);
});
test('nobody across from a rank at rest leaves the camera room for no one', () => {
  const { party, enemies, widths } = formation(2, [4, 0], [false, true]);
  assert.equal(spotsFor({ party, enemies, widths }).length, 16 * 2 - 8);
});
test('a bubble is short on a tile and says what it\'s on when there\'s room', () => {
  assert.equal(actionWords('Read · src/client/a.js', true), 'Read · a.js');
  assert.equal(actionWords('Read · src/client/a.js', false), 'Read');
  assert.equal(actionWords('Bash · npm test -- tests/a', true), 'Bash · npm test -- tests/a');
  assert.ok(actionWords('Bash · npm run something really very long indeed', true).length <= 26);
});
test('a phone\'s tile frames the party larger, and keeps every one of them in', () => {
  for (const count of [1, 3, 5, 8]) {
    const shape = formation(count, Array(count).fill(4), [], 4), spots = spotsFor({ party: shape.party, enemies: [] }), clear = .22, aspect = 1.9;
    const view = fit({ spots, aspect, ...PARTY_VIEW, clear }), all = fit({ spots: spotsFor(shape), aspect, ...PARTY_VIEW, clear }), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], tan = Math.tan(FOV * Math.PI / 360);
    assert.ok(view.distance < all.distance * .9, `${view.distance} against ${all.distance}`);
    for (const spot of spots) {
      const d = [0, 1, 2].map(i => spot[i] - view.position[i]), depth = -dot(d, view.back);
      assert.ok(Math.abs(dot(d, view.right)) / depth <= tan * aspect + 1e-6 && Math.abs(dot(d, view.up)) / depth <= tan * (1 - clear) + 1e-6, `${count}`);
    }
  }
});
test('tiles leave no holes, and a bigger party gets a bigger tile', () => {
  const span = ([a, b]) => b - a, cols = layout => new Set(layout.tiles.map(tile => tile.column.join())).size;
  // Equal parties keep an even grid.
  for (const [count, width, height, columns] of [[4, 1190, 790, 2], [5, 1190, 790, 2], [6, 1264, 730, 3], [5, 374, 700, 1], [1, 1190, 790, 1]]) {
    const layout = tileLayout(Array(count).fill(1), width, height), widths = new Set(layout.tiles.slice(0, columns).map(tile => span(tile.column)));
    assert.equal(widths.size, 1, `${count} in ${width}`);
    assert.equal(layout.units / span(layout.tiles[0].column), columns, `${count} in ${width}`);
  }
  // Six beside three of one: the six holds the full height, the three stack beside it.
  const desk = tileLayout([6, 1, 1, 1], 1424, 790);
  assert.equal(desk.scroll, false);
  assert.deepEqual(desk.tiles[0].row, [1, desk.tracks.length + 1]);
  assert.ok(span(desk.tiles[0].column) > desk.units / 2);
  assert.ok(desk.tiles.slice(1).every(tile => span(tile.row) === 1 && tile.column[0] === desk.tiles[0].column[1]));
  const two = tileLayout([2, 1, 1, 1], 1424, 790);
  assert.ok(span(two.tiles[0].column) > span(two.tiles[1].column) && two.tracks[0] > two.tracks[1]);
  // A phone scrolls one tile wide; the big party keeps a taller picture, never more than most of the view.
  const phone = tileLayout([6, 1, 1, 1], 374, 684);
  assert.equal(phone.scroll, true);
  assert.equal(cols(phone), 1);
  assert.ok(phone.tiles[0].fight > 170 && phone.tracks[0] <= 684 * .8 && phone.tracks[0] > phone.tracks[1]);
  for (const parties of [[1], [6, 1, 1, 1], [1, 6, 1, 1], [1, 1, 6, 1], [3, 3, 1, 1, 1], [2, 5, 1, 9, 1, 1, 3, 1], Array(10).fill(1), Array(15).fill(2)]) for (const [width, height] of [[1190, 790], [1900, 1000], [700, 900], [374, 700]]) {
    const layout = tileLayout(parties, width, height), grid = layout.tracks.map(() => Array(layout.units).fill(0));
    assert.equal(layout.tiles.length, parties.length);
    for (const { row, column } of layout.tiles) for (let r = row[0]; r < row[1]; r++) for (let c = column[0]; c < column[1]; c++) grid[r - 1][c - 1]++;
    assert.ok(grid.every(line => line.every(cell => cell === 1)), `${parties} in ${width}x${height}`);
  }
});
test('the chrome knows the fantasy', () => {
  assert.match(readFileSync('client/theme-console.js', 'utf8'), /fantasy:/);
  assert.match(readFileSync('client/alerts.js', 'utf8'), /fantasy:/);
  assert.match(readFileSync('client/themes.css', 'utf8'), /\[data-theme=fantasy/);
  assert.match(readFileSync('client/style.css', 'utf8'), /\.status-text\.fantasy/);
  assert.match(readFileSync('client/main.js', 'utf8'), /fantasy-list\.css/);
  const line = (...statuses) => summary(statuses.map(status => ({ status }))).fantasy;
  assert.equal(line(), 'At rest');
  assert.equal(line('working'), '1 fighting');
  assert.equal(line('working', 'question'), '1 ready · 1 fighting');
});

test('a model goes by the name people call it', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(modelName('gpt-5.5-codex'), 'GPT-5.5');
  assert.equal(modelName('explorer'), 'explorer');
  assert.equal(modelName(undefined), '');
});

test('the enemy is the last real request, not whatever the harness wrote', () => {
  const said = (...texts) => ({ messages: texts.map(text => ({ role: 'user', text })) });
  assert.equal(taskOf(said('Fix the\n  tests', 'Now  ship it')), 'Now ship it');
  assert.equal(taskOf(said('Fix it', '<command-name>/clear</command-name>')), 'Fix it');
  assert.equal(taskOf({ messages: [{ role: 'assistant', text: 'Sure' }] }), '');
  assert.equal(taskOf({}), '');
});

test('the words that open under the cursor never take the mouse, or a click on a bubble would be lost', () => {
  assert.match(readFileSync('client/fantasy/say.js', 'utf8'), /el\('fy-say-in win'\)/);
  assert.match(readFileSync('client/fantasy/fantasy.css', 'utf8'), /\.fy-say \.win \{ pointer-events: none; \}/);
});

test('the turn gauge shows only what is known: your move, or this turn against the last', () => {
  const now = 1_000_000, session = { statusSince: now - 60_000, lastTurnMs: 240_000 };
  assert.deepEqual(turnGauge({ state: 'permission', session }, now), { tone: 'ready', ratio: 1, urgent: true });
  assert.deepEqual(turnGauge({ state: 'done', session }, now), { tone: 'ready', ratio: 1 });
  assert.equal(turnGauge({ state: 'error', session }, now).tone, 'error');
  assert.equal(turnGauge({ state: 'idle', session }, now), null);
  assert.equal(turnGauge({ state: 'offline', session }, now), null);
  assert.equal(turnGauge({ state: 'working', session }, now).ratio, .25);
  assert.equal(turnGauge({ state: 'thinking', session: { ...session, statusSince: new Date(now - 60_000).toISOString() } }, now).ratio, .25);
  // Only a session waiting on you ever shows full.
  assert.equal(turnGauge({ state: 'working', session: { ...session, statusSince: now - 9_000_000 } }, now).ratio, .97);
  // Nothing to go by: no fill, whatever the time.
  for (const gauge of [turnGauge({ state: 'working', session: { statusSince: now } }, now), turnGauge({ state: 'compacting', session }, now), turnGauge({ state: 'waiting', session }, now)]) { assert.equal(gauge.tone, 'charge'); assert.equal(gauge.ratio, null); }
});
