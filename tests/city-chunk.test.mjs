import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Walks static imports from city.js: nothing on the way may be three.js.
test('City never imports three.js', () => {
  const seen = new Set(), walk = file => { if (seen.has(file)) return; seen.add(file); const text = readFileSync(file, 'utf8');
    for (const [, spec] of text.matchAll(/(?:from\s+|import\s+|import\()['"]([^'"]+)['"]/g)) { assert.notEqual(spec, 'three', `${file} imports three`); if (spec.startsWith('.') && spec.endsWith('.js')) walk(resolve(dirname(file), spec)); } };
  walk(resolve('client/city/city.js')); assert.ok(seen.size > 5);
});
