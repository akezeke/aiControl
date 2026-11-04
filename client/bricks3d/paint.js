// Paints a DOM element's visible content (backgrounds, borders, text, icons, portraits) into a canvas at the positions the browser gave it, so it can be
// a sticker on a brick face in three.js and move with the bricks. This is not a general renderer: it covers what this interface draws (flat colours,
// hard shadows, solid and dotted borders, one background image per element, text runs with ellipsis, inline SVG icons, <img>).
const images = new Map();
let loaded = 0;
export const imagesLoaded = () => loaded;

// An image by URL, or null while it loads (and `onLoad` is called once it has).
function image(url, onLoad) {
  let entry = images.get(url);
  if (!entry) {
    const img = new Image(); entry = { img, ready: false, failed: false }; images.set(url, entry);
    img.onload = () => { entry.ready = true; loaded++; onLoad?.(); }; img.onerror = () => { entry.failed = true; };
    img.src = url;
  }
  return entry.ready ? entry.img : null;
}

const px = value => parseFloat(value) || 0;
const clear = color => !color || color === 'transparent' || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(color);

// The first, hard (no blur) shadow of a computed box-shadow or text-shadow: [color, x, y, blur].
function shadowOf(value) {
  if (!value || value === 'none') return null;
  const color = value.match(/rgba?\([^)]*\)/)?.[0], rest = value.replace(color || '', '').trim().split(/\s+/).map(px);
  return color ? [color, rest[0] || 0, rest[1] || 0, rest[2] || 0, /inset/.test(value)] : null;
}

function paintBox(ctx, el, cs, r, scale, onLoad) {
  const bl = px(cs.borderLeftWidth), br = px(cs.borderRightWidth), bt = px(cs.borderTopWidth), bb = px(cs.borderBottomWidth);
  const radius = px(cs.borderTopLeftRadius), inner = { x: r.left + bl, y: r.top + bt, w: r.width - bl - br, h: r.height - bt - bb };
  const shape = (x, y, w, h) => { ctx.beginPath(); radius > 0 && ctx.roundRect ? ctx.roundRect(x, y, w, h, radius) : ctx.rect(x, y, w, h); };
  const shadow = shadowOf(cs.boxShadow);
  if (shadow && !shadow[4] && !shadow[3] && !clear(shadow[0])) { ctx.fillStyle = shadow[0]; shape(r.left + shadow[1], r.top + shadow[2], r.width, r.height); ctx.fill(); }
  if (!clear(cs.backgroundColor)) { ctx.fillStyle = cs.backgroundColor; shape(r.left, r.top, r.width, r.height); ctx.fill(); }
  const url = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
  if (url && inner.w > 0 && inner.h > 0) {
    const img = image(new URL(url, location.href).href, onLoad);
    if (img) {
      const nw = img.naturalWidth, nh = img.naturalHeight, size = cs.backgroundSize.split(' '), [sx = 'auto', sy = sx] = size;
      let dw = nw, dh = nh;
      if (sx === 'cover' || sx === 'contain') { const k = (sx === 'cover' ? Math.max : Math.min)(inner.w / nw, inner.h / nh); dw = nw * k; dh = nh * k; }
      else if (sx !== 'auto' || sy !== 'auto') { dw = sx === 'auto' ? NaN : sx.endsWith('%') ? inner.w * px(sx) / 100 : px(sx); dh = sy === 'auto' ? NaN : sy.endsWith('%') ? inner.h * px(sy) / 100 : px(sy); if (Number.isNaN(dw)) dw = dh * nw / nh; if (Number.isNaN(dh)) dh = dw * nh / nw; }
      const [ox = '0%', oy = '0%'] = cs.backgroundPosition.split(' '), place = (value, room) => value.endsWith('%') ? room * px(value) / 100 : px(value);
      ctx.save(); shape(inner.x, inner.y, inner.w, inner.h); ctx.clip(); ctx.drawImage(img, inner.x + place(ox, inner.w - dw), inner.y + place(oy, inner.h - dh), dw, dh); ctx.restore();
    }
  }
  for (const [side, width, style, color] of [['top', bt, cs.borderTopStyle, cs.borderTopColor], ['right', br, cs.borderRightStyle, cs.borderRightColor], ['bottom', bb, cs.borderBottomStyle, cs.borderBottomColor], ['left', bl, cs.borderLeftStyle, cs.borderLeftColor]]) {
    if (!width || style === 'none' || style === 'hidden' || clear(color)) continue;
    ctx.fillStyle = color;
    const [x, y, w, h] = side === 'top' ? [r.left, r.top, r.width, width] : side === 'bottom' ? [r.left, r.bottom - width, r.width, width] : side === 'left' ? [r.left, r.top, width, r.height] : [r.right - width, r.top, width, r.height];
    if (style === 'dotted' || style === 'dashed') {
      const step = width * (style === 'dotted' ? 2 : 4), along = side === 'top' || side === 'bottom';
      for (let t = 0; t < (along ? w : h); t += step) ctx.fillRect(along ? x + t : x, along ? y : y + t, along ? Math.min(width * (style === 'dotted' ? 1 : 3), w - t) : w, along ? h : Math.min(width * (style === 'dotted' ? 1 : 3), h - t));
    } else ctx.fillRect(x, y, w, h);
  }
  if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) && !clear(cs.outlineColor) && el.matches(':focus-visible')) {
    const o = px(cs.outlineOffset), w = px(cs.outlineWidth); ctx.strokeStyle = cs.outlineColor; ctx.lineWidth = w; ctx.strokeRect(r.left - o - w / 2, r.top - o - w / 2, r.width + 2 * o + w, r.height + 2 * o + w);
  }
}

// Text: whole words at the position the browser laid them out, so wrapping, kerning and justification are the browser's.
const range = document.createRange();
function runsOf(node) {
  const runs = [], text = node.data; let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    let j = i; while (j < text.length && !/\s/.test(text[j])) j++;
    runs.push([i, j]); i = j;
  }
  return runs;
}
function rectOf(node, a, b) { range.setStart(node, a); range.setEnd(node, b); return range.getBoundingClientRect(); }

function paintText(ctx, node, el, cs, clip, scale) {
  if (!node.data.trim()) return;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; ctx.font = font; ctx.fillStyle = cs.color; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  const ascent = ctx.measureText('Mg').fontBoundingBoxAscent, shadow = shadowOf(cs.textShadow), upper = cs.textTransform;
  if (shadow && !clear(shadow[0])) { ctx.shadowColor = shadow[0]; ctx.shadowOffsetX = shadow[1] * scale; ctx.shadowOffsetY = shadow[2] * scale; ctx.shadowBlur = shadow[3] * scale; }
  const transform = s => upper === 'uppercase' ? s.toUpperCase() : upper === 'lowercase' ? s.toLowerCase() : upper === 'capitalize' ? s.replace(/\b\w/g, c => c.toUpperCase()) : s;
  const clamps = cs.webkitLineClamp !== 'none' || cs.textOverflow === 'ellipsis', ellipsis = clip && clamps; let cut = false, last = null;
  for (const [a, b] of runsOf(node)) {
    if (cut) break;
    const first = rectOf(node, a, a + 1), whole = rectOf(node, a, b), text = transform(node.data.slice(a, b));
    if (!whole.width && !whole.height) continue;
    const middle = whole.top + whole.height / 2, hiddenBelow = clip && (middle > clip.bottom || middle < clip.top), hiddenRight = clip && whole.right > clip.right + .5;
    if (ellipsis && (hiddenBelow || hiddenRight)) {
      cut = true; const w = ctx.measureText('…').width;
      if (hiddenBelow && last) ctx.fillText('…', Math.min(last.right, clip.right - w), last.baseline);
      else if (hiddenRight) { let t = text; while (t && ctx.measureText(t).width > clip.right - first.left - w) t = t.slice(0, -1); ctx.fillText(`${t}…`, first.left, first.top + ascent); }
      break;
    }
    if (rectOf(node, b - 1, b).top - first.top > 2) { for (let k = a; k < b; k++) { const r = rectOf(node, k, k + 1); ctx.fillText(transform(node.data[k]), r.left, r.top + ascent); } }   // a word the browser broke mid-way
    else ctx.fillText(text, first.left, first.top + ascent);
    last = { right: whole.right, baseline: first.top + ascent };
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  if (cs.textDecorationLine.includes('underline') && !clear(cs.textDecorationColor)) { const r = el.getBoundingClientRect(); ctx.fillStyle = cs.textDecorationColor; ctx.fillRect(r.left, r.bottom - 2, r.width, 1); }
}

function paintSvg(ctx, el, cs, r, onLoad) {
  // The treasury's emblem names a bitmap, which an image made from SVG cannot load: draw the visible one directly.
  const bitmap = [...el.querySelectorAll('.spend-art image')].find(node => getComputedStyle(node.closest('.spend-art')).display !== 'none');
  if (bitmap) {
    const img = image(new URL(bitmap.getAttribute('href'), location.href).href, onLoad);
    if (img) { const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k; ctx.drawImage(img, r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h); }
    return;
  }
  let markup = new XMLSerializer().serializeToString(el).replace(/currentColor/g, cs.color);
  if (!/xmlns=/.test(markup)) markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  markup = markup.replace(/^<svg/, `<svg width="${r.width}" height="${r.height}"`);
  const img = image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, onLoad); if (img) ctx.drawImage(img, r.left, r.top, r.width, r.height);
}

const SKIP = 'input, textarea, select, option, .console-contact';
// `own` tells whether an element is another sticker's root (painted on its own, so left out here).
export function paint(root, { scale, sticker = false, own, onLoad }) {
  const box = root.getBoundingClientRect(), w = Math.max(1, Math.ceil(box.width)), h = Math.max(1, Math.ceil(box.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  // A faint clear label gives the printed button a visible sticker edge without
  // obscuring its underlying colour or the text painted on top.
  if (sticker && w > 8 && h > 8) { ctx.fillStyle = 'rgba(255, 250, 230, .12)'; ctx.fillRect(3, 3, w - 6, h - 6); ctx.strokeStyle = 'rgba(255, 255, 255, .2)'; ctx.lineWidth = .5; ctx.strokeRect(3, 3, w - 6, h - 6); }
  ctx.translate(-box.left, -box.top);
  const walk = (el, clip) => {
    const cs = getComputedStyle(el);
    const parent = el.parentElement, shut = parent && parent.tagName === 'DETAILS' && !parent.open && el.tagName !== 'SUMMARY';
    if (shut || cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || (el !== root && (own(el) || el.matches(SKIP)))) return;
    const opacity = +cs.opacity; if (!opacity) return;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height && el.tagName !== 'svg') return;
    ctx.save(); ctx.globalAlpha *= opacity;
    paintBox(ctx, el, cs, r, scale, onLoad);
    if (el instanceof SVGElement) { if (el.tagName === 'svg') paintSvg(ctx, el, cs, r, onLoad); ctx.restore(); return; }
    if (el.tagName === 'IMG') {
      const img = image(el.currentSrc || el.src, onLoad);
      if (img) { const k = (cs.objectFit === 'contain' ? Math.min : Math.max)(r.width / img.naturalWidth, r.height / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k; ctx.save(); ctx.beginPath(); ctx.rect(r.left, r.top, r.width, r.height); ctx.clip(); ctx.drawImage(img, r.left + (r.width - dw) / 2, r.top + (r.height - dh) / 2, dw, dh); ctx.restore(); }
      ctx.restore(); return;
    }
    let inner = clip;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const bl = px(cs.borderLeftWidth), bt = px(cs.borderTopWidth);
      inner = { left: r.left + bl, top: r.top + bt, right: r.right - px(cs.borderRightWidth), bottom: r.bottom - px(cs.borderBottomWidth) };
      ctx.beginPath(); ctx.rect(inner.left, inner.top, inner.right - inner.left, inner.bottom - inner.top); ctx.clip();
    }
    for (const node of el.childNodes) {
      if (node.nodeType === 3) paintText(ctx, node, el, cs, inner, scale);
      else if (node.nodeType === 1) walk(node, inner);
    }
    ctx.restore();
  };
  walk(root, null);
  return { canvas, width: w, height: h };
}
