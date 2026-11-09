import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sun } from '../client/office/windows.js';
import { location } from '../server/config.mjs';

const stockholm = [59.3333, 18.05];
const highest = day => Math.max(...Array.from({ length: 1440 }, (_, m) => sun(Date.parse(day) + m * 6e4, stockholm).elevation));

test('the sun climbs as high as the solstices allow and rises in the morning', () => {
  assert.ok(Math.abs(highest('2026-06-21') - (90 - 59.3333 + 23.436)) < 0.1);
  assert.ok(Math.abs(highest('2026-12-21') - (90 - 59.3333 - 23.436)) < 0.1);
  const morning = sun(Date.parse('2026-11-09T07:27+01:00'), stockholm), evening = sun(Date.parse('2026-11-09T15:36+01:00'), stockholm);
  assert.ok(morning.rising && Math.abs(morning.elevation + 0.833) < 0.3, 'Stockholm sunrise 07:27');
  assert.ok(!evening.rising && Math.abs(evening.elevation + 0.833) < 0.3, 'Stockholm sunset 15:36');
});

test('the location comes from the config, else the time zone’s city in zone.tab', () => {
  const tab = join(mkdtempSync(join(tmpdir(), 'zone-')), 'zone.tab');
  writeFileSync(tab, '# comment\nSE\t+5920+01803\tEurope/Stockholm\nUS\t+404251-0740023\tAmerica/New_York\tEastern (most areas)\n');
  assert.deepEqual(location({ location: [1, 2] }, 'Europe/Stockholm', tab), [1, 2]);
  assert.deepEqual(location({}, 'Europe/Stockholm', tab), [59 + 20 / 60, 18 + 3 / 60]);
  assert.deepEqual(location({}, 'America/New_York', tab), [40 + 42 / 60 + 51 / 3600, -(74 + 23 / 3600)]);
  assert.equal(location({ location: 'here' }, 'Etc/UTC', tab), null);
});
