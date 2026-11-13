import test from 'node:test';
import assert from 'node:assert/strict';
import { ICONS, PICO_PALETTE, paint, iconCanvas, stripUrl, cursorUrl } from '../client/office/pc-icons.js';

// A canvas that records its size and rects, and a doc that hands them out.
function fakeDoc() {
  const canvases = [];
  return {
    canvases,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const rects = [], canvas = {
        width: 0, height: 0, rects,
        getContext: () => ({ set fillStyle(v) {}, fillRect: (...a) => rects.push(a) }),
        toDataURL: () => `data:image/png;base64,${canvas.width}x${canvas.height}`,
      };
      canvases.push(canvas);
      return canvas;
    },
  };
}

test('every icon is a rectangle of palette digits', () => {
  for (const [name, icon] of Object.entries(ICONS)) for (const frame of [icon].flat()) {
    assert.equal(frame.rows.length, frame.h, name);
    for (const row of frame.rows) { assert.equal(row.length, frame.w, name); assert.match(row, /^[0-9a-f.]*$/, name); }
  }
  assert.equal(ICONS.throbber.length, 8);
});
test('paint draws one rect per run and skips transparent pixels', () => {
  const calls = [], g = { set fillStyle(v) { calls.push(['style', v]); }, fillRect: (...a) => calls.push(['rect', ...a]) };
  paint(g, { w: 4, h: 1, rows: ['77.0'] }, 10, 20, 2);
  assert.deepEqual(calls.filter(c => c[0] === 'rect'), [['rect', 10, 20, 4, 2], ['rect', 16, 20, 2, 2]]);
});
test('icons have the sizes the brief gives', () => {
  const size = { console: 16, hourglass: 16, arrow: 10, globe: 32, notepad: 32, cart: 32, info: 32, warn: 32, error: 32, question: 32 };
  for (const [name, n] of Object.entries(size)) assert.deepEqual([ICONS[name].w, ICONS[name].h], [n, n], name);
  for (const frame of ICONS.throbber) assert.deepEqual([frame.w, frame.h], [24, 24]);
});
test('paint colours runs from the palette', () => {
  const styles = [], g = { set fillStyle(v) { styles.push(v); }, fillRect() {} };
  paint(g, { w: 2, h: 1, rows: ['8c'] }, 0, 0);
  assert.deepEqual(styles, [PICO_PALETTE[8], PICO_PALETTE[12]]);
});
test('iconCanvas sizes the canvas to w*scale by h*scale', () => {
  const doc = fakeDoc(), canvas = iconCanvas(ICONS.globe, 2, doc);
  assert.deepEqual([canvas.width, canvas.height], [64, 64]);
  assert.ok(canvas.rects.length > 0);
});
test('stripUrl is one canvas, 8 frames wide, as a data url', () => {
  const doc = fakeDoc(), url = stripUrl(ICONS.throbber, 2, doc);
  assert.equal(doc.canvases.length, 1);
  assert.deepEqual([doc.canvases[0].width, doc.canvases[0].height], [24 * 8 * 2, 48]);
  assert.equal(url, `data:image/png;base64,${24 * 8 * 2}x48`);
});
test('stripUrl puts frame k inside its own slot', () => {
  const doc = fakeDoc(); stripUrl(ICONS.throbber, 2, doc);
  const w = 24 * 2, seen = new Set();
  for (const [x, , rw] of doc.canvases[0].rects) { const k = Math.floor(x / w); assert.ok(x + rw <= (k + 1) * w); seen.add(k); }
  assert.equal(seen.size, 8);
});
test('cursorUrl is a data url', () => {
  assert.match(cursorUrl(ICONS.hourglass, 2, fakeDoc()), /^data:/);
});
test('the throbber frames differ, so the globe turns', () => {
  const rows = ICONS.throbber.map(f => f.rows.join('|'));
  assert.equal(new Set(rows).size, 8);
});
