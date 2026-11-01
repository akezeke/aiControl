import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Battlefields, PRUNE_MS } from '../server/battlefields.mjs';
import { placesFor } from '../client/fantasy/roster.js';

const sessions = projects => projects.map((project, i) => ({ id: `s${i}`, project }));
const spots = fields => Object.values(fields).map(field => `${field.place}/${field.time}`);
const names = Array.from({ length: 11 }, (_, i) => `project-${i}`);

test('a first start shares fields out as a page would alone', () => {
  assert.deepEqual(new Battlefields().update(sessions(names.slice(0, 6))), Object.fromEntries(placesFor(names.slice(0, 6))));
});
test('a project keeps its field as others come and go', () => {
  const fields = new Battlefields(), first = fields.update(sessions(names.slice(0, 3)));
  const more = fields.update(sessions(names));
  for (const project of names.slice(0, 3)) assert.deepEqual(more[project], first[project]);
  assert.equal(new Set(spots(more)).size, names.length);
  const fewer = fields.update(sessions(names.slice(1)));
  for (const project of names.slice(1)) assert.deepEqual(fewer[project], more[project]);
});
test('back again, a project has its old field if nobody took it', () => {
  const fields = new Battlefields(), first = fields.update(sessions(['a', 'b']));
  fields.update(sessions(['b']));
  assert.deepEqual(fields.update(sessions(['a', 'b'])).a, first.a);
});
test('back again to find its field taken, a project picks another and the one there keeps it', () => {
  const fields = new Battlefields(), first = fields.update(sessions(['a']));
  fields.update([]);
  // Whoever comes while it's gone gets its field: it's the only one taken by nobody on show.
  const taker = Array.from({ length: 200 }, (_, i) => `t${i}`).find(name => new Battlefields().update(sessions([name]))[name].place === first.a.place);
  const during = fields.update(sessions([taker]));
  assert.deepEqual(during[taker], first.a);
  const after = fields.update(sessions([taker, 'a']));
  assert.deepEqual(after[taker], first.a);
  assert.notEqual(after.a.place, first.a.place);
});
test('a restart keeps the fields; a week unseen forgets them', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fields-')), 'fantasy-battlefields.json'), now = 1_800_000_000_000;
  const first = new Battlefields(file).update(sessions(names.slice(0, 4)), now);
  const again = new Battlefields(file);
  assert.deepEqual(again.update(sessions(names.slice(0, 4)), now + 60_000), first);
  again.update([], now + PRUNE_MS + 3_600_000);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
});
