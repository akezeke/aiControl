import test from 'node:test';
import assert from 'node:assert/strict';
import { setBrickSky } from '../client/backdrop/brick-sky.js';

test('castle effects are mounted once with the theme and removed when it changes', () => {
  const previous = globalThis.document;
  const body = { children: [], prepend(el) { this.children.unshift(el); el.isConnected = true; } };
  globalThis.document = { body, createElement(tag) { return {
    tag, children: [], isConnected: false,
    setAttribute(name, value) { this[name] = value; },
    append(...nodes) { this.children.push(...nodes); },
    remove() { this.isConnected = false; body.children = body.children.filter(child => child !== this); },
  }; } };
  try {
    setBrickSky(true); setBrickSky(true);
    assert.equal(body.children.length, 1);
    const sky = body.children[0];
    assert.equal(sky['aria-hidden'], 'true');
    assert.ok(sky.children.some(child => child.className === 'castle-scene'), 'castle effects are present');
    setBrickSky(false);
    assert.equal(body.children.length, 0);
    setBrickSky(true);
    assert.equal(body.children.length, 1);
  } finally { setBrickSky(false); globalThis.document = previous; }
});
