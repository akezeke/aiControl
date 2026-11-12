import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { useDom } from './fixtures/pc-dom.mjs';

test('fixture elements carry an upper-case tagName like real ones', t => {
  const doc = useDom(t); assert.equal(doc.createElement('input').tagName, 'INPUT'); assert.equal(doc.createElement('a').tagName, 'A');
});
test('production code never reads the fixture-only .tag property', () => {
  const dir = new URL('../client/office/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.js'))) assert.doesNotMatch(readFileSync(new URL(name, dir), 'utf8'), /\.tag\b/, name);
});
