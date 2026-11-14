import test from 'node:test';
import assert from 'node:assert/strict';
import { applyThemeIcons } from '../client/app-icons.js';
import { faviconBadge } from '../client/alerts.js';

function iconDOM(t) {
  const links = Object.fromEntries(['icon', 'manifest', 'apple-touch-icon'].map(rel => [rel, {
    href: `/${rel}`, dataset: {},
    getAttribute(name) { return this[name]; }, setAttribute(name, value) { this[name] = value; },
  }]));
  const previous = globalThis.document;
  globalThis.document = { querySelector: selector => links[selector.match(/rel=["']?([^\]"']+)/)[1]] };
  t.after(() => { globalThis.document = previous; });
  return links;
}

test('theme selection updates install icons, resolves Orbit auto and preserves the badge', async t => {
  const links = iconDOM(t);
  t.mock.method(globalThis, 'fetch', async url => new Response(`<svg viewBox="0 0 64 64"><title>${url}</title></svg>`));
  applyThemeIcons('modern', false);
  assert.equal(links.icon.href, '/app-icons/modern-light/favicon.svg');
  applyThemeIcons('modern', true);
  assert.equal(links.icon.href, '/app-icons/modern-dark/favicon.svg');
  assert.equal(links.manifest.href, '/app-icons/modern-dark/manifest.webmanifest');
  assert.equal(links['apple-touch-icon'].href, '/app-icons/modern-dark/apple-touch-icon.png');
  await faviconBadge(1);
  applyThemeIcons('nodes-neurons', true);
  await faviconBadge(1);
  assert.match(decodeURIComponent(links.icon.href), /nodes-neurons/);
  assert.match(decodeURIComponent(links.icon.href), /<circle/);
  assert.equal(links.manifest.href, '/app-icons/nodes-neurons/manifest.webmanifest');
  await faviconBadge(0);
  assert.equal(links.icon.href, '/app-icons/nodes-neurons/favicon.svg');
});

test('late icon downloads cannot restore a cleared badge or an old theme', async t => {
  const links = iconDOM(t), pending = new Map();
  t.mock.method(globalThis, 'fetch', url => new Promise(resolve => pending.set(url, resolve)));
  applyThemeIcons('parchment', false);
  const first = faviconBadge(1);
  applyThemeIcons('graphite', true);
  const second = faviconBadge(1);
  pending.get('/app-icons/graphite/favicon.svg')(new Response('<svg><title>graphite</title></svg>'));
  await second;
  pending.get('/app-icons/parchment/favicon.svg')(new Response('<svg><title>parchment</title></svg>'));
  await first;
  assert.match(decodeURIComponent(links.icon.href), /graphite/);
  assert.doesNotMatch(decodeURIComponent(links.icon.href), /parchment/);
  applyThemeIcons('office', false);
  const third = faviconBadge(1);
  await faviconBadge(0);
  pending.get('/app-icons/office/favicon.svg')(new Response('<svg><title>office</title></svg>'));
  await third;
  assert.equal(links.icon.href, '/app-icons/office/favicon.svg');
});

test('a failed icon fetch keeps the theme icon and retries on the next badge update', async t => {
  const links = iconDOM(t);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? new Response('Not found', { status: 404 }) : new Response('<svg><title>retry</title></svg>'));
  applyThemeIcons('city', true);
  await faviconBadge(1);
  assert.equal(links.icon.href, '/app-icons/city/favicon.svg');
  await faviconBadge(1);
  assert.match(decodeURIComponent(links.icon.href), /<circle/);
  assert.equal(attempts, 2);
});
