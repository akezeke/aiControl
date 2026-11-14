// Regenerate all icons, or one theme: node scripts/app-icons.mjs [theme] (requires ImageMagick's convert).
// This is an artwork tool; serving the app needs no image renderer.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../client/public/', import.meta.url);
const asset = (name, ink) => {
  const source = readFileSync(new URL(name, publicDir), 'utf8');
  const [, attrs, body] = source.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  const [left, top, width, height] = attrs.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const scale = 64 / Math.max(width, height), x = (64 - width * scale) / 2 - left * scale, y = (64 - height * scale) / 2 - top * scale;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${ink}">${body.replace(/(["'])#000(?:000)?\1/g, `"${ink}"`)}</g>`;
};
const portrait = name => {
  const png = execFileSync('convert', [fileURLToPath(new URL(name, publicDir)), '-trim', '+repage', '-strip', 'png:-']);
  return `<image width="64" height="64" href="data:image/png;base64,${png.toString('base64')}"/>`;
};
const orbit = ink => `<g fill="none" stroke="${ink}" stroke-width="3"><circle cx="32" cy="32" r="15"/><ellipse cx="32" cy="32" rx="33" ry="12" transform="rotate(-25 32 32)"/></g><circle cx="54" cy="17" r="5" fill="${ink}"/>`;
const paper = ink => `<g fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"><rect x="2" y="2" width="60" height="60" rx="4"/><path d="M15 19h34M15 32h34M15 45h20"/></g>`;
const office = `<g transform="rotate(-6 32 32)"><path d="M6 6h52v52H6z" fill="#ffe58b" stroke="#3c3430" stroke-width="3"/><path d="M18 21h28M18 32h28M18 43h17" fill="none" stroke="#3c3430" stroke-width="3" stroke-linecap="round"/></g>`;
// Match the existing brand marks and theme palettes, including each selectable Nodes look.
const icons = {
  'modern-light': ['#f4f5f8', orbit('#6366f1')],
  'modern-dark': ['#0b0d12', orbit('#a5a6ff')],
  parchment: ['#e9e5db', paper('#4f6456')],
  graphite: ['#242722', paper('#c4ceba')],
  alien: ['#030703', asset('alien-emblem.svg', '#e2ffd6')],
  command: ['#252b29', asset('command-emblem.svg', '#f0c94a')],
  simpsons: ['#86cbed', asset('springfield-donut.svg', '#f9d84a')],
  diablo: ['#100d0b', portrait('diablo-portrait.webp')],
  heroes: ['#172749', asset('heroes-crest.svg', '#efd080')],
  zelda: ['#183a29', asset('zelda-crest.svg', '#efd080')],
  office: ['#dcc6a3', office],
  bridge: ['#150f33', asset('bridge-mark.svg', '#a7baff')],
  // The sidebar mark is a tile; app icons keep just its crane and skyline on transparency.
  city: ['#4d4a44', asset('city-mark.svg', '#f9c22b').replace(/<path fill="#(?:2c3032|3e4447)"[^>]*\/>/g, '')],
  fantasy: ['#123b33', asset('fantasy/mark.svg', '#ffc738')],
  bricks: ['#2f8fe4', portrait('bricks-banner.webp')],
  nodes: ['#eceef2', asset('nodes-mark.svg', '#1b2130')],
  'nodes-clean-dark': ['#15171c', asset('nodes-mark.svg', '#e3e6ee')],
  'nodes-neurons': ['#07060d', asset('nodes-neurons-mark.svg', '#c0a5ff')],
  'nodes-synthetic': ['#05090c', asset('nodes-mark.svg', '#50e3dd')],
  'nodes-steampunk': ['#1a120b', asset('nodes-mark.svg', '#d2a05e')],
  'nodes-mycelium': ['#0e0f0a', asset('nodes-mycelium-mark.svg', '#c9db8a')],
};

const entries = Object.entries(icons).filter(([id]) => !process.argv[2] || id === process.argv[2]);
if (!entries.length) throw new Error('Unknown icon theme');
for (const [id, [background, mark]] of entries) {
  const dir = new URL(`app-icons/${id}/`, publicDir);
  mkdirSync(dir, { recursive: true });
  const svg = size => `<svg xmlns="http://www.w3.org/2000/svg"${size ? ` width="${size}" height="${size}"` : ''} viewBox="0 0 64 64">${mark}</svg>\n`;
  writeFileSync(new URL('favicon.svg', dir), svg());
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    execFileSync('convert', ['-background', 'none', 'svg:-', '-strip', `PNG32:${fileURLToPath(new URL(name, dir))}`], { input: svg(size) });
  }
  // Keep one app identity across themes. Icon URLs change with the artwork so installed PWAs can detect updates.
  const manifest = {
    id: '/', name: 'AI Control', short_name: 'AI Control', start_url: '/', scope: '/', display: 'standalone',
    background_color: background, theme_color: background,
    icons: [192, 512].map(size => {
      const file = `icon-${size}.png`, hash = createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex').slice(0, 10);
      return { src: `/app-icons/${id}/${file}?v=${hash}`, sizes: `${size}x${size}`, type: 'image/png' };
    }),
  };
  writeFileSync(new URL('manifest.webmanifest', dir), `${JSON.stringify(manifest, null, 2)}\n`);
  if (id === 'alien') {
    for (const name of ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']) {
      writeFileSync(new URL(name, publicDir), readFileSync(new URL(name, dir)));
    }
  }
}
console.log(`Generated ${entries.length} theme icon sets.`);
