// Clean: a control surface on a desk. Sessions are wide keys with their own display: a status lamp ringed by the context
// gauge, and the session's name and what it's doing printed beside it. They're banked in a column off their project's
// junction and wired to it by cables in the project's colour. You are the big cobalt key, with a usage console beside you.
// Keys rise a little under the pointer, bottom out while pressed and pop up on an amber collar when they need you. Motion is
// firm and well damped: nothing drifts or sways. Light and dark from one palette table.
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const PAL = { work: '#17a673', think: '#1a9fc4', compact: '#7c5cf0', need: '#ef9a12', wait: '#3b7ff0', idle: '#aeb5c1', error: '#e5484d', off: '#c9ccd2' };
const PROJ = ['#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6', '#64748b'];
const TOOL = { edit: '#6366f1', read: '#0ea5e9', search: '#14b8a6', bash: '#334155', web: '#ec4899', agent: '#8b5cf6', '': '#17a673' };
const PROVIDER = { claude: '#d9774b', codex: '#5b6cff', opencode: '#14a3b8' };
const SCHEME = {
  light: { bg: '#e8e7e2', dot: '#b9b7af', key: '#f7f6f2', subKey: '#d2d0c9', subTop: '#dcdad3', off: '#dfddd7', housing: '#c4c2bb', shaft: '#6c6a64', cable: '#bdbab3', trunk: '#a19e97', top: '#fbfaf7', track: '#e2e0d9', ink: '#3a3c42',
    text: '#1d1f24', muted: '#6a6c72', need: '#9a5806', err: '#c8353a', you: '#2f4bff', youTop: '#2741e6', accent: '#2f4bff',
    hemi: ['#ffffff', '#cbc8c0', .55], sun: 2.2, fill: .35, env: .5, shade: ['#2a2418', .2], ao: ['#2a2418', .3], glow: .9, tint: .62, wire: .5 },
  dark: { bg: '#15171c', dot: '#30343d', key: '#30343c', subKey: '#262930', subTop: '#191b20', off: '#24272d', housing: '#0b0c0f', shaft: '#040506', cable: '#3d424c', trunk: '#4c525d', top: '#1e2127', track: '#343843', ink: '#cfd3da',
    text: '#eceef2', muted: '#9aa0ab', need: '#f5a524', err: '#ff6b6f', you: '#4a62ff', youTop: '#3a52ee', accent: '#7f91ff',
    hemi: ['#d2d9ff', '#07080a', .5], sun: 1.7, fill: .25, env: .35, shade: ['#000000', .45], ao: ['#000000', .5], glow: .3, tint: .58, wire: .6 },
};
// Outlines in S units, as a radius along each angle: a squircle key for You, a round junction for a project, a deep
// rounded-rectangle tile for a session (two lines of name), a short pill for a subagent, and a screen-shaped one for screenshots.
const pnorm = (sides, p, rot) => a => { let s = 0; for (let k = 0; k < sides / 2; k++) s += Math.abs(Math.cos(a - rot - k * 2 * Math.PI / sides)) ** p; return s ** (-1 / p); };
function roundRect(A, B, rc) {
  const a0 = A - rc, b0 = B - rc;
  return a => {
    const c = Math.abs(Math.cos(a)) || 1e-6, s = Math.abs(Math.sin(a)) || 1e-6;
    if (A / c * s <= b0) return A / c;
    if (B / s * c <= a0) return B / s;
    const k = a0 * c + b0 * s; return k + Math.sqrt(k * k - (a0 * a0 + b0 * b0 - rc * rc));
  };
}
const OUTLINE = {
  you: { r: pnorm(4, 4.5, 0), sides: 4, p: 4.5, rot: 0 },
  project: { r: () => 1, sides: 0 },
  session: { r: roundRect(4.6, 1.3, .55), A: 4.6, B: 1.3 },
  sub: { r: roundRect(3.4, .85, .85), A: 3.4, B: .85 },
  shot: { r: roundRect(2.45, 1.75, .7), A: 2.45, B: 1.75 },
};
// World size per kind (S), and cap height. Sessions are the bodies to look at; a project is the hub, a big round key its
// cables fan from; a subagent is a low grey pill, half a session's length, so the three tell apart by shape from afar.
const SCALE = { you: 1.56, project: 1.15, session: 1.25, sub: .8 }, TALL = { you: 1.3, project: 1.05, session: .8, sub: .5 };
const H = .42, FACE_R = .78, DISH = .016, LAMP = .62; // cap height and display inset at scale 1; a tile's status lamp radius
const BASE_H = .07, TRAVEL = .15, POP = .5;           // housing height; how far a cap stands proud at rest, and when it needs you
const PEARL = 1.1, PX = 100;                           // world units between beads on a needs-you cord; canvas pixels per world unit
// The usage console: a column per account, the sloped face's length and slope, the lip under it, and the depth it takes on the desk.
const COL = 2.6, LEN = 3.4, SLOPE = .35, LIP = .14, DD = LEN * Math.cos(SLOPE);
// A screenshot key's half length and depth (deeper than a session's tile) and the lead to it; how far up the screen a raised key
// reaches, in desk units.
const SHOT_HALF = (OUTLINE.shot.A + .1) * SCALE.session, SHOT_Z = (OUTLINE.shot.B + .1) * SCALE.session, SHOT_GAP = .55, LIFT = .7;
// The room a junction keeps round it; how far a subagent's key is indented from its session's, past the session's lamp.
const JR = SCALE.project * 1.15 + .3, SUB_IN = 2.4;
const needs = n => n.status === 'permission' || n.status === 'question', busy = n => n.status === 'working' || n.status === 'thinking' || n.status === 'compacting';
// Per node, across rebuilds (the look is built again whenever sessions come or go): press, pop, height, gauge.
const keep = new WeakMap();
// The room light the keys reflect, made once per renderer: building it takes a PMREM pass, and the look is rebuilt whenever a
// session comes or goes. userData.keep: the rebuild's disposeTree leaves it alone.
const envs = new WeakMap();
function roomEnv(THREE, renderer) {
  let tex = envs.get(renderer);
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    tex = pmrem.fromScene(room, .04).texture; tex.userData.keep = true;
    room.dispose(); pmrem.dispose(); envs.set(renderer, tex);
  }
  return tex;
}

const FACE_FRAG = /* glsl */`
uniform float uKind, uTime, uClock, uAnim, uWork, uThink, uCompact, uNeed, uWait, uError, uOff, uCtx, uProv, uMode, uCount, uUrg, uPress, uSides, uP, uRot, uFlash;
uniform vec3 uCol, uTop, uTrack, uInk, uAccent, uProj, uAmber, uRed, uGreen, uBlue, uFlashCol;
varying vec2 vUv;
#define TAU 6.2831853
float band(float r, float a, float b, float aa) { return smoothstep(a - aa, a + aa, r) * (1. - smoothstep(b - aa, b + aa, r)); }
float disc(vec2 p, float rad, float aa) { return 1. - smoothstep(rad - aa, rad + aa, length(p)); }
// Distance in the display's own outline: 1 at its edge.
float edge(vec2 p) {
  if (uSides < .5) return length(p);
  float s = 0.;
  for (int k = 0; k < 3; k++) { if (float(k) >= uSides * .5) break; float a = uRot + float(k) * TAU / uSides; s += pow(abs(dot(p, vec2(cos(a), sin(a)))), uP); }
  return pow(s, 1. / uP);
}
float glyph(vec2 q, float prov, float aa) {
  float r = length(q);
  if (prov < .5) { float a = atan(q.x, q.y); float d = abs(sin(a * 4.)) * r * .25; return (1. - smoothstep(.03 - aa, .03 + aa, d)) * (1. - smoothstep(.36 - aa, .36 + aa, r)) * smoothstep(.07, .1, r) + disc(q, .07, aa); }
  if (prov < 1.5) { vec2 h = abs(q); float hex = max(h.x * .866 + h.y * .5, h.x); return band(hex, .24, .33, aa); }
  float sq = max(abs(q.x), abs(q.y)); return band(sq, .21, .29, aa) + disc(q, .07, aa);
}
void main() {
  vec2 p = vUv * 2. - 1.; float r = length(p), d = edge(p), aa = fwidth(r) * 1.1;
  float u = fract(atan(p.x, p.y) / TAU + 1.);           // 0 at the top, clockwise
  vec3 c = uTop;
  if (uKind < 1.5) {                                     // a tile's lamp
    // Context: a gauge round the lamp, filling clockwise; neutral, then the accent from 70%, red past 90%.
    vec3 gc = mix(mix(uInk, uAccent, smoothstep(.68, .8, uCtx)), uRed, smoothstep(.88, .92, uCtx));
    c = mix(c, mix(uTrack, gc, step(u, uCtx)), band(d, .74, .97, aa));
    vec3 s = uCol * (1.05 - .12 * r / .62);
    s = mix(s, vec3(1.), uWork * .4 * pow(fract(u - uTime * .8), 5.));
    for (int i = 0; i < 3; i++) { float a = uTime * 1.6 + float(i) * 2.094; s = mix(s, vec3(1.), uThink * .9 * disc(p - vec2(sin(a), cos(a)) * .4, .06, aa)); }
    s = mix(s, vec3(1.), uCompact * .4 * smoothstep(.55, .95, fract(r * 3.6 + uTime * 1.2)));
    float rip = fract(uTime * (.55 + uUrg * 1.1));
    s = mix(s, vec3(1.), uAnim * uNeed * .5 * band(r, rip * .58 - .05, rip * .58, aa) * (1. - rip));
    // Waiting: a clock hand that ticks once a second (uClock: seconds, whole ones while the board only redraws for the tick).
    float ha = (floor(uClock) + smoothstep(0., .12, fract(uClock))) * TAU / 12.; vec2 hd = vec2(sin(ha), cos(ha)); float hp = clamp(dot(p, hd), 0., .44);
    s = mix(s, vec3(1.), uWait * (1. - smoothstep(.045 - aa, .045 + aa, length(p - hd * hp))));
    s = mix(s, uTop, uOff * .8);
    float face = disc(p, .62, aa);
    c = mix(c, s, face);
    c = mix(c, uTrack * .9, uOff * step(.5, fract(u * 18.)) * band(r, .55, .61, aa));
    float bang = step(abs(p.x), .06) * step(-.02, p.y) * step(p.y, .33) + disc(p - vec2(0., -.17), .065, aa);
    float g = glyph(p / .62, uProv, aa / .62) * (1. - uError) + bang * uError;
    c = mix(c, vec3(1.), clamp(g, 0., 1.) * face * (1. - uOff * .75));
    if (uMode > .5) { vec2 m = p - vec2(.62, .62); vec3 mc = uMode > 1.5 ? uRed : uBlue; c = mix(c, vec3(1.), disc(m, .17, aa)); c = mix(c, mc, disc(m, .12, aa)); }
  } else if (uKind < 2.5) {                              // project: a junction in its colour, with a plus: it starts a session there
    float plus = min(max(abs(p.x) - .07, abs(p.y) - .32), max(abs(p.y) - .07, abs(p.x) - .32));
    c = mix(uProj, vec3(.98), .35 * band(d, .8, .86, aa));
    c = mix(c, vec3(.98), 1. - smoothstep(-aa, aa, plus));
  } else {                                               // you: an amber dash per waiting session
    float n = max(uCount, 1.), l = fract(u * n);
    float dash = smoothstep(.03, .06, min(l, 1. - l) * TAU * r / n) * band(d, .64, .88, aa);
    c = mix(c, uAmber * (1. + uUrg * .15), dash * step(.5, uCount));
    c = mix(c, vec3(.55, .95, .78), band(d, .74, .79, aa) * step(uCount, .5));
    float rip = fract(uTime * .6);
    c = mix(c, uAmber, uAnim * step(.5, uCount) * band(r, rip * .56, rip * .56 + .035, aa) * (1. - rip) * .7);
    c = mix(c, vec3(1.), disc(p, .12, aa));
  }
  c = mix(c, uFlashCol, uFlash * .55);
  // The dish's lip shades the display's edge on the light's side.
  float rim = smoothstep(.86, 1., d), side = dot(p, vec2(-.81, .58)) / max(r, 1e-3);
  c *= 1. - rim * (.07 + .09 * side) - uPress * .05;
  gl_FragColor = vec4(c, 1.);
}`;
const FACE_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';

// A solid turned round Y on outline o: a profile point [x, y] sits 1 - x inside the outline (so bevels keep their width on
// long tiles), x = 0 at the centre. A repeated point is a crease. Columns wrap, so there's no seam.
function solid(THREE, o, profile, segs = 128) {
  const P = profile.length, pos = new Float32Array(P * segs * 3), index = [];
  for (let j = 0; j < segs; j++) {
    const a = j / segs * Math.PI * 2, R = o.r(a), c = Math.cos(a), s = Math.sin(a);
    profile.forEach(([x, y], i) => { const m = x ? Math.max(0, R - 1 + x) : 0; pos.set([m * c, y, m * s], (j * P + i) * 3); });
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < P - 1; i++) { const a = j * P + i, b = (j + 1) % segs * P + i; index.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(index); g.computeVertexNormals();
  return g;
}
// Everything one outline needs: cap, housing, plunger, display (uv over its bounding box) and a contact shadow.
function shapeKit(THREE, kit, o) {
  const cap = [[0, 0], [.95, 0]], fb = .05, ft = .1, lip = FACE_R + .022;
  for (let i = 1; i <= 4; i++) { const a = -Math.PI / 2 + i / 4 * Math.PI / 2; cap.push([1 - fb + Math.cos(a) * fb, fb + Math.sin(a) * fb]); }
  cap.push([1, H - ft]);
  for (let i = 1; i <= 8; i++) { const a = i / 8 * Math.PI / 2; cap.push([1 - ft + Math.cos(a) * ft, H - ft + Math.sin(a) * ft]); }
  cap.push([lip, H], [lip, H], [FACE_R, H - DISH], [FACE_R, H - DISH], [0, H - DISH]);
  const base = [[0, 0], [1.1, 0], [1.1, BASE_H - .03]];
  for (let i = 1; i <= 3; i++) { const a = i / 3 * Math.PI / 2; base.push([1.07 + Math.cos(a) * .03, BASE_H - .03 + Math.sin(a) * .03]); }
  base.push([.9, BASE_H], [.9, BASE_H], [.9, BASE_H - .02], [0, BASE_H - .02]);
  const inset = 1 - FACE_R, hx = (o.A || 1) - inset, hz = (o.B || 1) - inset, N = 128, fp = [0, 0, 0], fu = [.5, .5], fi = [];
  for (let j = 0; j < N; j++) { const a = j / N * Math.PI * 2, r = o.r(a) - inset, x = Math.cos(a) * r, z = Math.sin(a) * r; fp.push(x, 0, z); fu.push((x / hx + 1) / 2, (-z / hz + 1) / 2); fi.push(0, (j + 1) % N + 1, j + 1); }
  const face = new THREE.BufferGeometry(); face.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); face.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); face.setIndex(fi);
  const ex = (o.A || 1) + .7, ez = (o.B || 1) + .7, W = 256, Hh = Math.round(W * ez / ex);
  const ao = kit.canvasTexture(W, g => {
    g.canvas.height = Hh; g.filter = `blur(${W * .022}px)`; g.fillStyle = '#fff'; g.beginPath();
    for (let j = 0; j <= 96; j++) { const a = j / 96 * Math.PI * 2, r = o.r(a) + .13; g.lineTo((Math.cos(a) * r / ex + 1) / 2 * W, (Math.sin(a) * r / ez + 1) / 2 * Hh); }
    g.fill();
  });
  return { o, hx, hz, ex, ez, cap: solid(THREE, o, cap), base: solid(THREE, o, base), shaft: solid(THREE, o, [[.93, 0], [.93, 1]], 96), face, ao };
}
// A low wedge W wide whose top slopes up and back at `slope`, LEN long, for a display that faces the camera; and where that
// display goes on it.
function wedge(THREE, W, LEN, slope, lip) {
  const D = LEN * Math.cos(slope), H = LEN * Math.sin(slope);
  const shape = new THREE.Shape([new THREE.Vector2(D / 2, 0), new THREE.Vector2(D / 2, lip), new THREE.Vector2(-D / 2, lip + H), new THREE.Vector2(-D / 2, 0)]);
  return new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 3 }).rotateY(-Math.PI / 2).translate(W / 2, .06, 0);
}
function onSlope(THREE, mesh, LEN, slope, lip) {
  mesh.rotation.x = slope - Math.PI / 2;
  mesh.position.set(0, .06 + lip + LEN * Math.sin(slope) / 2, 0).addScaledVector(new THREE.Vector3(0, Math.cos(slope), Math.sin(slope)), .075);
}
// Whether segment a→b crosses the box [x0, z0, x1, z1] (Liang–Barsky).
// Edge by edge, with nothing made per call: the labels test their spots with it every frame.
let ct0 = 0, ct1 = 1;
function clip(p, q) {
  if (!p) return q >= 0;
  const r = q / p; if (p < 0) { if (r > ct1) return false; if (r > ct0) ct0 = r; } else { if (r < ct0) return false; if (r < ct1) ct1 = r; }
  return true;
}
function crosses(ax, az, bx, bz, x0, z0, x1, z1) {
  const dx = bx - ax, dz = bz - az; ct0 = 0; ct1 = 1;
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az);
}
// A project's name as printed on the desk: its canvas width in pixels (TPX to a world unit) at 84 high. Big: it heads its
// bank, and it's about the size its label takes when the desk's print is too small to read (.lbl.project in css).
const TPX = 62, TITLE_FONT = '600 60px "Geist Mono", ui-monospace, monospace';
const measure = document.createElement('canvas').getContext('2d');
const titleW = name => { measure.font = TITLE_FONT; return Math.ceil(measure.measureText(name.toUpperCase()).width) + 24; };

// Longest prefix of text that fits in w, with an ellipsis.
function fit(g, text, w) {
  if (g.measureText(text).width <= w) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(text.slice(0, mid) + '…').width <= w) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}
// A name over two lines of w: as many whole words as fit on the first (a long word breaks where it runs out), the rest on the
// second, with an ellipsis if that runs over too.
function wrap(g, text, w, out) {
  let cut = 0;
  for (let i = text.indexOf(' ', 1); i > 0; i = text.indexOf(' ', i + 1)) { if (g.measureText(text.slice(0, i)).width > w) break; cut = i; }
  if (!cut) {
    let lo = 1, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(text.slice(0, mid)).width <= w) lo = mid; else hi = mid - 1; }
    out[0] = text.slice(0, lo); out[1] = fit(g, text.slice(lo), w);
  } else { out[0] = text.slice(0, cut); out[1] = fit(g, text.slice(cut + 1).trimStart(), w); }
}
// A tile's display, roomiest first: the name's size and baseline(s), the status line's, all as fractions of the display's height,
// and the zoom it takes (z: how far past just-legible, 1 being the first one's name at NAME_MIN px) for the name to stay as big on
// screen as the first one's at its smallest. A session's name drops a size, then goes to two lines, before it's cut short; a
// subagent's goes from beside its status to a row of its own. Below the largest z the display goes blank and the labels print the
// name instead: they're crisper than a texture that small, and a name never shows cut.
const NAME_FONT = px => `600 ${px}px Geist, system-ui, sans-serif`, STATUS_FONT = px => `500 ${px}px "Geist Mono", ui-monospace, monospace`;
const LAYOUT = {
  session: [{ nf: .27, ny: .42, sf: .19, sy: .78, z: 0 }, { nf: .24, ny: .4, sf: .19, sy: .78, z: .27 / .24 },
    { nf: .24, ny: .32, ny2: .6, sf: .16, sy: .86, z: .27 / .24, wrap: true }],
  sub: [{ nf: .4, ny: .64, sf: .32, sy: .64, z: 0, row: .55 }, { nf: .36, ny: .43, sf: .29, sy: .82, z: .4 / .36, wrap: true }],
};
const NAME_MIN = { session: 12.5, sub: 10 }, ZMAX = { session: .27 / .24, sub: .4 / .36 };
// The board's labels' type and sizes (css below), so the look can tell whether a name fits before it's shown: on a key (on), and
// beside one (a session's chip, a subagent's bare name), with the gap to the key and each label's height (H2: with its status).
const ON_PX = 11.5, ON_LH = 13.5, SUB_PX = 10.5, SUB_LH = 13, BESIDE_PX = 12, BESIDE_LH = 14, BESIDE_H = BESIDE_LH + 2, BESIDE_H2 = BESIDE_H + 14, SUB_H = SUB_LH, BESIDE_GAP = 10;
const ON_FONT = `600 ${ON_PX}px Geist, system-ui, sans-serif`, SUB_ON_FONT = `500 ${SUB_PX}px Geist, system-ui, sans-serif`;
const BESIDE_FONT = `600 ${BESIDE_PX}px Geist, system-ui, sans-serif`, SUB_BESIDE_FONT = SUB_ON_FONT;
const BESIDE_PAD = 12 + BESIDE_PX * 1.07, SUB_BESIDE_PAD = 4 + SUB_PX * 1.28; // padding and the kind mark (.k in nodes.css)
// What a session that needs you or failed shows under its name, beside its key: up to 300px (nodes.css) and the padding.
const LINE_FONT = '10.5px "Geist Mono", ui-monospace, monospace', LINE_MAX = 300, LINE_PAD = 12;
// A project's pill (.lbl.project): its type size (smaller on a narrow board, css --clean-pill), the spacing after each letter,
// padding and folder mark, and height.
const PILL_PX = 12.5, PILL_PX_NARROW = 11, NARROW = 560, PILL_LH = 1.36;
const pillFont = px => `500 ${px}px "Geist Mono", ui-monospace, monospace`, pillLS = px => px * .06, pillPad = px => 15 + px * 1.38;
const pillH = px => Math.round(px * PILL_LH) + 4;
// The wait printed after a needs-you status (kit.fmtWait) changes only when this does.
const waitStep = s => s < 60 ? Math.max(1, Math.round(s)) : s < 3600 ? 100 + Math.floor(s / 60) : 10000 + Math.floor(s / 3600);
// Whether x has moved off the value last acted on (a[i]) by more than a hair; if so, that becomes the new one. NaN: never acted on.
const ch = (a, i, x) => { if (Math.abs(x - a[i]) <= 1e-3) return 0; a[i] = x; return 1; };
const unseen = n => new Float64Array(n).fill(NaN);
const MIX = ['work', 'think', 'compact', 'need', 'wait', 'idle', 'error', 'off'], MARK_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export default {
  id: 'clean',
  name: 'Clean',
  css: `
body[data-look="clean"] { --bg: #e8e7e2; --fg: #1d1f24; --muted: #6a6c72; --panel: #fbfaf8; --line: #d3d1ca; --accent: #2f4bff;
  --need: #9a5806; --work: #12895f; --err: #d93c41; --wait: #3b7ff0; --font: Geist, system-ui, sans-serif; --mono: "Geist Mono", ui-monospace, monospace; --display: Geist, system-ui, sans-serif;
  --radius: 8px; --blur: 0px; --key: linear-gradient(#fdfcfa, #f1f0ec); --edge: #c2c0b9; --shadow: inset 0 1px #fff, 0 1px 0 var(--edge), 0 8px 22px -10px rgba(42, 36, 24, .3);
  --label: #1d1f24; --label-sub: #5f6168; --label-halo: rgba(232, 231, 226, .95); color-scheme: light; }
body[data-look="clean"][data-dark] { --bg: #15171c; --fg: #eceef2; --muted: #9aa0ab; --panel: #23262d; --line: #3a3e48; --accent: #7f91ff; --need: #f5a524; --work: #34c88f; --err: #ff6b6f; --wait: #6f9cff;
  --key: linear-gradient(#2c3038, #24272e); --edge: #0b0c0f; --shadow: inset 0 1px #ffffff14, 0 1px 0 var(--edge), 0 10px 26px -10px rgba(0, 0, 0, .7);
  --label: #eceef2; --label-sub: #9aa0ab; --label-halo: rgba(21, 23, 28, .95); color-scheme: dark; }
body[data-look="clean"] .lbl { padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--panel) 92%, transparent); box-shadow: 0 1px 0 var(--edge); text-shadow: none; }
body[data-look="clean"] .lbl.session b { font: 600 ${BESIDE_PX}px/${BESIDE_LH}px var(--display); }
body[data-look="clean"] .lbl span { font-size: 10.5px; line-height: 14px; }
/* Beside its key, a session's label is one row high, to sit on the key's row: what it's doing shows only when that's trouble. */
body[data-look="clean"] .lbl.session:not(.need, .error) span { display: none; }
/* A project heads its bank: its name in caps, light on dark, the loudest label on the board. */
body[data-look="clean"] .lbl.project { padding: 2px 8px 2px 7px; border-radius: 4px; background: var(--fg); color: var(--bg); box-shadow: 0 3px 8px -3px rgba(0, 0, 0, .45); }
body[data-look="clean"] .lbl.project b { font: 500 var(--clean-pill, ${PILL_PX}px)/${PILL_LH} var(--mono); letter-spacing: .06em; text-transform: uppercase; }
body[data-look="clean"] .lbl.project .k { opacity: 1; }
body[data-look="clean"] .lbl.project.on .k { display: inline-block; }
body[data-look="clean"] .lbl.you b { font: 500 12px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
/* A subagent: its name alone, small and quiet, never in a chip. */
body[data-look="clean"] .lbl.sub { padding: 0 2px; background: none; box-shadow: none; text-shadow: 0 0 4px var(--label-halo), 0 0 2px var(--label-halo); }
body[data-look="clean"] .lbl.sub b { font: 500 ${SUB_PX}px/${SUB_LH}px var(--display); }
/* On its key: printed on the display from beside the lamp, as the display prints it up close, on up to two lines. */
body[data-look="clean"] .lbl:is(.session, .sub).on { width: 100vw; align-items: flex-start; padding: 0; background: none; box-shadow: none; text-shadow: none; }
body[data-look="clean"] .lbl.session.on b { font: 600 ${ON_PX}px/${ON_LH}px var(--display); white-space: normal; text-wrap: balance; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--clean-lines, 2); }
body[data-look="clean"] .nodes-overlay button { background: var(--key); box-shadow: var(--shadow); transition: transform .06s, box-shadow .06s; }
body[data-look="clean"] .nodes-overlay button:hover { border-color: var(--accent); }
body[data-look="clean"] .nodes-overlay button:active { transform: translateY(1px); box-shadow: inset 0 1px 2px rgba(0, 0, 0, .18); }
body[data-look="clean"] .nodes-overlay .nodes-next { background: #ef9a12; border-color: #c97d0a; color: #1d1f24; box-shadow: inset 0 1px #ffffff55, 0 2px 0 #9a5806, 0 6px 12px -4px rgba(180, 103, 10, .5); }
body[data-look="clean"] .nodes-overlay .nodes-next:is(:hover, :focus-visible) { background: #f5a524; border-color: #c97d0a; color: #1d1f24; }
body[data-look="clean"] .nodes-overlay .nodes-next:active { box-shadow: inset 0 1px 2px rgba(0, 0, 0, .25); }
body[data-look="clean"] .nodes-tip .dot { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px var(--line); }
@media (prefers-reduced-motion: reduce) { body[data-look="clean"] .nodes-overlay button { transition: none; } }`,

  create(ctx) {
    const { THREE, kit, scene, root, renderer, world, camera } = ctx;
    const K = SCHEME[ctx.dark ? 'dark' : 'light'], C = hex => new THREE.Color(hex), bg = C(K.bg);
    ctx.setPost({ bloom: false, toneMapping: THREE.NeutralToneMapping, exposure: 1 });
    // A long lens: little perspective, so text across the board stays upright.
    ctx.setView({ tilt: .72, fov: 12 });
    // ...which stands the camera far off, so move its near plane out too (the desk's decals need the depth precision).
    camera.near = 10; camera.updateProjectionMatrix();
    // Firm: nodes slide home without overshoot, never wander, and events don't hop them; the look does its own clicks.
    ctx.setMotion({ zeta: 1, k: 110, drift: 0, kick: 0 });
    // Sizes: what the framing keeps in view round each node. Picking goes by the footprints (setShape) and the banks' boxes are
    // framed whole (setFrame), so a tile needs only its depth here: more just frames the board smaller.
    ctx.setSizes({ you: 1.7, project: 1.3, session: 1.4, sub: .9 });
    let shotCount = 0;

    // Layout: each project's sessions banked in a column off its junction, a session's subagents just below it, indented and
    // hung off it by an elbow. Wide screens bank to the side away from You, centred on the junction; tall ones bank downwards
    // (upwards above You) from it, so the board stays narrow. Then, in the world's order round You and nearest first, each
    // project with its bank, screenshot keys and name takes the nearest spot out from You (turned a little either way if
    // that's nearer) that's clear of You, the usage console, the projects already placed and their cables: packed close, so
    // the keys are as big as the screen allows, and no cable runs under a key.
    const bank = new Map(), planned = new Map(), deckAt = new THREE.Vector3(), frameBoxes = [];
    let planCols = 0;
    const tileW = k => 2 * (OUTLINE[k].A + .1) * SCALE[k], tileH = k => 2 * (OUTLINE[k].B + .1) * SCALE[k];
    const usageCols = () => Math.min(5, world.usage.filter(a => a.windows.length || a.spend).length) + 1;
    const overlaps = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
    const NUDGE = [0, .07, -.07, .14, -.14, .21, -.21, .28, -.28];
    function plan() {
      const tall = ctx.size.w / ctx.size.h < .8, you = world.you.rest, MARGIN = .7, xs = tall ? .3 : 1;
      planned.clear(); bank.clear(); frameBoxes.length = 0;
      const clusters = world.projects.map(p => {
        const x = you.x + (p.rest.x - you.x) * xs, z = p.rest.z;
        const sx = tall || x >= you.x ? 1 : -1, inner = sx * (JR + (tall ? .5 : 1.3)), rows = [];
        // Each row's middle down the bank. A screenshot key is deeper than its session's tile and stands past the subagents' ends,
        // so it only has to clear the screenshot key before it.
        let rz = 0, shotEnd = -Infinity;
        for (const s of p.sessions) for (const m of [s, ...s.subs]) {
          const h = m.kind === 'sub' ? tileH('sub') + .35 : tileH('session') + .5, shot = m.kind === 'session' && !!ctx.shot(m);
          if (shot) { rz = Math.max(rz, shotEnd + .5 + SHOT_Z - h / 2); shotEnd = rz + h / 2 + SHOT_Z; }
          rows.push([m, rz + h / 2, shot]); rz += h;
        }
        const total = rz, at = new Map(), box = [-JR, -JR - LIFT, JR, JR], top = !tall ? -total / 2 : z >= you.z ? JR + .2 : -JR - .2 - total;
        for (const [m, mz, shot] of rows) {
          const w = tileW(m.kind), cx = inner + sx * ((m.kind === 'sub' ? SUB_IN : 0) + w / 2), cz = top + mz, th = shot ? Math.max(tileH(m.kind) / 2, SHOT_Z) : tileH(m.kind) / 2;
          at.set(m, [cx, cz]);
          const far = cx + sx * (w / 2 + (shot ? SHOT_GAP + 2 * SHOT_HALF : 0));
          box[0] = Math.min(box[0], cx - sx * w / 2, far); box[2] = Math.max(box[2], cx - sx * w / 2, far);
          box[1] = Math.min(box[1], cz - th - LIFT); box[3] = Math.max(box[3], cz + th);
        }
        return { p, x, z, sx, at, box, a: Math.atan2(z - you.z, (x - you.x) / xs), d: Math.hypot(x - you.x, z - you.z) };
      });
      // The console goes in the widest gap round You, so no cable runs under it.
      const angs = [];
      for (const c of clusters) { angs.push(Math.atan2(c.z - you.z, c.x - you.x)); for (const [cx, cz] of c.at.values()) angs.push(Math.atan2(c.z + cz - you.z, c.x + cx - you.x)); }
      angs.sort((a, b) => a - b);
      let best = Math.PI / 2, span = 0;
      angs.forEach((a, i) => { const gap = (angs[i + 1] ?? angs[0] + Math.PI * 2) - a; if (gap > span) { span = gap; best = a + gap / 2; } });
      planCols = usageCols();
      const dw = planCols * COL + .3, dx = Math.cos(best), dz = Math.sin(best), r = SCALE.you * 1.4 + .6 + Math.abs(dx) * dw / 2 + Math.abs(dz) * DD / 2;
      deckAt.set(you.x + dx * r, 0, you.z + dz * r);
      const yr = SCALE.you * 1.2 + .3, taken = [[you.x - yr, you.z - yr - LIFT, you.x + yr, you.z + yr], [deckAt.x - dw / 2, deckAt.z - DD / 2 - 1, deckAt.x + dw / 2, deckAt.z + DD / 2]], trunks = [];
      frameBoxes.push(taken[1]);
      clusters.sort((a, b) => a.d - b.d);
      const cbox = [0, 0, 0, 0], tbox = [0, 0, 0, 0], fall = [0, 0, 0];
      // Whether a box is clear of what's taken and of the cables already laid.
      const clearOf = (b, m) => { for (const t of taken) if (overlaps(b, t, m)) return false; for (const t of trunks) if (crosses(t[0], t[1], t[2], t[3], b[0], b[1], b[2], b[3])) return false; return true; };
      for (const c of clusters) {
        let x = 0, z = 0, title = null, found = false, hasFall = false;
        for (let step = 0; step < 400 && !found; step++) {
          for (const da of NUDGE) {
            const a = c.a + da, rr = 2 + step * .4;
            x = you.x + Math.cos(a) * rr * xs; z = you.z + Math.sin(a) * rr;
            title = titleSpot(c.p.name, x, z, -c.sx);
            const tx = x + title.x, tx1 = tx + title.dir * title.w;
            tbox[0] = Math.min(tx, tx1); tbox[1] = z + title.z - title.h / 2; tbox[2] = Math.max(tx, tx1); tbox[3] = z + title.z + title.h / 2;
            cbox[0] = x + c.box[0]; cbox[1] = z + c.box[1]; cbox[2] = x + c.box[2]; cbox[3] = z + c.box[3];
            if (!clearOf(cbox, MARGIN) || !clearOf(tbox, MARGIN)) continue;
            if (!hasFall) { hasFall = true; fall[0] = x; fall[1] = z; fall[2] = da; }
            let cut = false; // the cable in, from You (so not You's own box)
            for (let i = 1; i < taken.length && !cut; i++) cut = crosses(you.x, you.z, x, z, taken[i][0], taken[i][1], taken[i][2], taken[i][3]);
            if (!cut) { found = true; break; }
          }
        }
        // Boxed in all round: the nearest spot clear of keys, though its cable crosses one.
        if (!found) { x = fall[0]; z = fall[1]; title = titleSpot(c.p.name, x, z, -c.sx); }
        const tx = x + title.x, tx1 = tx + title.dir * title.w;
        const tb = [Math.min(tx, tx1), z + title.z - title.h / 2, Math.max(tx, tx1), z + title.z + title.h / 2], cb = [x + c.box[0], z + c.box[1], x + c.box[2], z + c.box[3]];
        taken.push(cb, tb); frameBoxes.push(cb, tb); trunks.push([you.x, you.z, x, z]);
        planned.set(c.p, [x, z]);
        const at = new Map(); for (const [m, [cx, cz]] of c.at) at.set(m, new THREE.Vector3(x + cx, 0, z + cz));
        bank.set(c.p, { sx: c.sx, at, title });
      }
    }
    function layout(n) {
      if (n.kind === 'you') plan();
      else if (n.kind === 'project') { const q = planned.get(n); if (q) n.rest.set(q[0], 0, q[1]); }
      else if (n.kind === 'session' || n.kind === 'sub') {
        const b = bank.get(n.project), p = b?.at.get(n), from = n.kind === 'sub' ? b?.at.get(n.parent) : n.project.rest;
        if (p && from) n.offset.subVectors(p, from).setY(0);
      }
    }
    // A project's name runs away from its bank, from beside the junction at (jx, jz): level with it, else just above or below it,
    // wherever the cable to You and You's key leave room. Offsets from the junction to the end of the name nearest it.
    function titleSpot(name, jx, jz, dir) {
      const w = titleW(name) / TPX, h = 84 / TPX, R = JR, y = world.you.rest, yr = SCALE.you * 1.5;
      const spots = [[dir * R, 0], [dir * R * .3, -R - .2], [dir * R * .3, R + .2]];
      const hits = ([x, z]) => {
        const xa = jx + x, x0 = Math.min(xa, xa + dir * w) - .25, x1 = Math.max(xa, xa + dir * w) + .25, z0 = jz + z - h / 2 - .25, z1 = jz + z + h / 2 + .25;
        return crosses(jx, jz, y.x, y.z, x0, z0, x1, z1) || (y.x > x0 - yr && y.x < x1 + yr && y.z > z0 - yr && y.z < z1 + yr);
      };
      const [x, z] = spots.find(spot => !hits(spot)) || spots[1];
      return { x, z, dir, w, h };
    }
    ctx.setLayout(layout);
    ctx.onResize(() => ctx.setLayout(layout));

    scene.background = bg;
    // The shadow map is drawn only when something casting into it moves (shadowDirty, below), not every frame.
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    let shadowDirty = false;
    scene.environment = roomEnv(THREE, renderer); scene.environmentIntensity = K.env;

    root.add(new THREE.HemisphereLight(...K.hemi));
    const sun = new THREE.DirectionalLight('#ffffff', K.sun);
    sun.position.set(-14, 30, -10); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 3; sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
    sun.shadow.camera.near = 2; sun.shadow.camera.far = 90;
    root.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#eef2ff', K.fill); fill.position.set(12, 8, 14); root.add(fill);
    function fitShadow() {
      let m = 24; for (const n of world.nodes) m = Math.max(m, Math.abs(n.rest.x) + 8, Math.abs(n.rest.z) + 6);
      Object.assign(sun.shadow.camera, { left: -m, right: m, top: m, bottom: -m }); sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
    }
    fitShadow(); ctx.onResize(fitShadow);

    // The desk: a mat with a fine grid of crosses under a lamp, taking the shadows. One opaque plane: the grid is drawn in the
    // shadow material's own pass, so the screen isn't filled twice (as a mat and then a see-through shadow catcher over it).
    const deskMat = new THREE.ShadowMaterial({ color: K.shade[0], opacity: K.shade[1] }), dot = C(K.dot);
    deskMat.transparent = false;
    deskMat.onBeforeCompile = sh => {
      sh.uniforms.uBg = { value: bg }; sh.uniforms.uDot = { value: dot };
      sh.vertexShader = 'varying vec2 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vP = (modelMatrix * vec4(transformed, 1.)).xz;');
      sh.fragmentShader = 'uniform vec3 uBg, uDot; varying vec2 vP;\n' + sh.fragmentShader.replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', `
        vec2 g = abs((fract(vP / 1.5 - .5) - .5) * 1.5); float aa = fwidth(vP.x) * .8, r = length(vP - vec2(0., 2.));
        float cr = max((1. - smoothstep(.012 - aa, .012 + aa, g.x)) * step(g.y, .1), (1. - smoothstep(.012 - aa, .012 + aa, g.y)) * step(g.x, .1));
        vec3 desk = mix(uBg, uDot, .75 * cr * (1. - smoothstep(24., 60., r))) * (1. - .08 * smoothstep(16., 70., r));
        gl_FragColor = vec4(mix(desk, color, opacity * (1. - getShadowMask())), 1.);`);
    };
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), deskMat);
    desk.rotation.x = -Math.PI / 2; desk.receiveShadow = true; root.add(desk);

    const kits = Object.fromEntries(Object.entries(OUTLINE).map(([k, o]) => [k, shapeKit(THREE, kit, o)]));
    const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), lampGeo = new THREE.CircleGeometry(LAMP, 64).rotateX(-Math.PI / 2);
    const glowTex = kit.glowTexture([[0, 'rgba(255,255,255,1)'], [.4, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]);
    const shared = { uTop: C(K.top), uTrack: C(K.track), uInk: C(K.ink), uAccent: C(K.accent), uAmber: C(PAL.need), uRed: C(PAL.error), uGreen: C(PAL.work), uBlue: C(PAL.wait) };
    const baseMat = new THREE.MeshStandardMaterial({ color: K.housing, roughness: .7 });
    const blankMat = new THREE.MeshBasicMaterial({ color: K.top, polygonOffset: true, polygonOffsetFactor: -1 }), blankSub = new THREE.MeshBasicMaterial({ color: K.subTop, polygonOffset: true, polygonOffsetFactor: -1 });
    const SHAFT = C(K.shaft), OFFCAP = C(K.off), amber = C(PAL.need), red = C(PAL.error), aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const hue = n => C(PROJ[n.project.index % PROJ.length]);
    const canvasTex = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
    let fontsReady = false;
    // Outside update, so ask for a frame: an idle board draws none of its own.
    Promise.all(['600 20px Geist', '500 20px "Geist Mono"'].map(f => document.fonts?.load(f))).then(() => { fontsReady = true; ctx.wake(); }, () => {});
    // Shared by every display: the lamps' clock (seconds, real time, so animations keep their speed at any frame pace), the wait
    // hand's, and whether anything animates at all.
    const timeU = { value: 0 }, clockU = { value: 0 }, animU = { value: 1 };
    const palC = MIX.map(k => C(PAL[k]));
    // kit.statusColor without its per-call colour parsing: the status colours blended by the smoothed signals.
    function statusMix(s, out) {
      let r = 0, gr = 0, b = 0, total = 0;
      for (let i = 0; i < 8; i++) { const w = s[MIX[i]]; if (!(w >= .001)) continue; const c = palC[i]; r += c.r * w; gr += c.g * w; b += c.b * w; total += w; }
      return total > 0 ? out.setRGB(r / total, gr / total, b / total) : out.copy(palC[5]);
    }

    // One key per node: a group (height off the desk, size) holding the housing, the plunger and the cap with its display;
    // a contact shadow and a coloured spill of light stay on the desk. A tile's display is a canvas of its text, with the
    // lamp at the end nearest its junction.
    const vis = world.nodes.map(n => {
      const kind = n.kind, S = SCALE[kind], hy = TALL[kind], sk = kits[kind], o = sk.o, tile = kind === 'session' || kind === 'sub';
      const st = keep.get(n) || { press: 0, pv: 0, pop: 0, popv: 0, y: 0, vy: 0, jolt: 0, jv: 0, ctx: n.ctx };
      keep.set(n, st);
      const group = new THREE.Group(); root.add(group);
      const base = new THREE.Mesh(sk.base, baseMat); base.scale.setScalar(S); base.receiveShadow = true; group.add(base);
      const shaftMat = new THREE.MeshStandardMaterial({ color: SHAFT, roughness: .45, emissive: PAL.need, emissiveIntensity: 0 });
      const shaft = new THREE.Mesh(sk.shaft, shaftMat); shaft.position.y = BASE_H * S; group.add(shaft);
      const cap = new THREE.Group(); group.add(cap);
      const color = kind === 'you' ? C(K.you) : kind === 'project' ? C(K.key).lerp(hue(n), K.tint) : C(kind === 'sub' ? K.subKey : K.key);
      // Standard, not physical: the faint clearcoat and sheen cost a second specular lobe and a sheen term on every cap pixel.
      const mat = new THREE.MeshStandardMaterial({ color, roughness: kind === 'you' ? .4 : .52, envMapIntensity: .9 });
      const body = new THREE.Mesh(sk.cap, mat); body.castShadow = true; body.scale.set(S, S * hy, S); cap.add(body);
      const uniforms = { uKind: { value: { session: 0, sub: 1, project: 2, you: 3 }[kind] }, uTime: timeU, uClock: clockU, uAnim: animU, uWork: { value: 0 }, uThink: { value: 0 }, uCompact: { value: 0 },
        uNeed: { value: 0 }, uWait: { value: 0 }, uError: { value: 0 }, uOff: { value: 0 }, uCtx: { value: 0 }, uProv: { value: { claude: 0, codex: 1, opencode: 2 }[n.provider] ?? 0 },
        uMode: { value: n.mode === 'plan' ? 1 : n.mode === 'bypass' ? 2 : 0 }, uCount: { value: 0 }, uUrg: { value: 0 }, uPress: { value: 0 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color() },
        uSides: { value: tile ? 0 : o.sides }, uP: { value: o.p || 2 }, uRot: { value: o.rot || 0 },
        uCol: { value: new THREE.Color() }, uProj: { value: kind === 'project' ? hue(n) : C(K.ink) } };
      for (const k in shared) uniforms[k] = { value: shared[k] };
      if (kind === 'you') uniforms.uTop = { value: C(K.youTop) }; else if (kind === 'sub') uniforms.uTop = { value: C(K.subTop) };
      const faceMat = new THREE.ShaderMaterial({ uniforms, vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, polygonOffset: true, polygonOffsetFactor: -1 });
      // sh: what the shadow map was last drawn with (see ch).
      const v = { n, S, hy, o, sk, st, tile, group, shaft, shaftMat, cap, body, mat, color, uniforms, top: 0, tilt: (n.seed % 628) / 100, side: 1, sh: unseen(8) };
      if (tile) {
        v.tex = canvasTex(Math.round(2 * sk.hx * S * PX), Math.round(2 * sk.hz * S * PX));
        // The display's text: the layouts it can take, its text area, and what it was last drawn from (k*) and with.
        // padU: the display's margin at the far end (a subagent's round end needs more); tw0: its text's width, in S units.
        const W = v.tex.image.width, px = W / (2 * sk.hx), sub = kind === 'sub', padU = sub ? .45 : .16;
        Object.assign(v, { L: LAYOUT[kind], lampW: (2 * LAMP + .3) * px, pad: padU * px, padU, tw0: 2 * sk.hx - (2 * LAMP + .3) - padU, topCol: sub ? K.subTop : K.top,
          blank: sub ? blankSub : blankMat, rule: undefined, w1: 0, w2: 0, bw: 0, mOf: null, mFonts: false, lay: -1, nw: 0, nwOf: null, nwFonts: false, kName: null, kText: null, kStatus: null,
          kWait: 0, kDone: 0, kTotal: 0, kSide: 0, kFonts: false, lines: ['', ''], two: false, nameFont: '', statusFont: '', nameCol: '', col: '', ny: 0, ny2: 0, sy: 0, sf: 0,
          x0: 0, sx: 0, end: 0, shown: '', pips: 0, pipDone: 0, pipX: 0, pipD: 0, pipGap: 0 });
        const display = new THREE.Mesh(sk.face, new THREE.MeshBasicMaterial({ map: v.tex, polygonOffset: true, polygonOffsetFactor: -1 }));
        display.position.y = H - DISH + .002; body.add(display); v.display = display; v.textMat = display.material;
        faceMat.polygonOffsetFactor = -2; faceMat.polygonOffsetUnits = -2; v.lamp = new THREE.Mesh(lampGeo, faceMat); v.lamp.position.y = H - DISH + .006; body.add(v.lamp);
      } else { const face = new THREE.Mesh(sk.face, faceMat); face.position.y = H - DISH + .002; body.add(face); }
      v.ao = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: sk.ao, color: K.ao[0], transparent: true, opacity: K.ao[1], depthWrite: false }));
      v.ao.position.y = .004; v.ao.renderOrder = -2; root.add(v.ao);
      v.glow = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: PAL.need, transparent: true, opacity: 0, depthWrite: false }));
      v.glow.position.y = .006; v.glow.renderOrder = -1; root.add(v.glow);
      return v;
    });
    const byNode = new Map(vis.map(v => [v.n, v]));

    // Labels: the keys and the desk carry their own text. When that's too small to read it goes blank and the board's labels take
    // over: a key's name on its own display while it fits there whole (on two lines once the key's deep enough on screen), else
    // on the key's row just past its outer end, so it still reads as that key's; a project's name where it's printed on the desk.
    // pxu, dpu: screen pixels to a world unit across and down the desk at You, this frame; spx, sdp: the same at a point (scaleAt),
    // as a name's room and place on screen go by its own key's (a far bank comes out a few percent smaller than one nearby).
    let legible = true, legibleSub = true, pxu = 10, dpu = 7, spx = 10, sdp = 7, lines = 0, pillPx = PILL_PX, pillCss = 0;
    const sa = new THREE.Vector3(), sb = new THREE.Vector3();
    function scaleAt(x, y, z) {
      sa.set(x, y, z).project(camera); sb.set(x + 1, y, z).project(camera); spx = Math.abs(sb.x - sa.x) * ctx.size.w / 2;
      sb.set(x, y, z + 1).project(camera); sdp = Math.abs(sb.y - sa.y) * ctx.size.h / 2;
    }
    // The point at height y under a point on screen (px), into out's x and z: where to anchor a label so it lands just there.
    const rayA = new THREE.Vector3(), rayB = new THREE.Vector3(), spot = new THREE.Vector3();
    function onLevel(px, py, y, out) {
      const nx = px / ctx.size.w * 2 - 1, ny = 1 - py / ctx.size.h * 2;
      rayA.set(nx, ny, -1).unproject(camera); rayB.set(nx, ny, 1).unproject(camera);
      const t = (y - rayA.y) / (rayB.y - rayA.y || 1e-9);
      out.x = rayA.x + (rayB.x - rayA.x) * t; out.z = rayA.z + (rayB.z - rayA.z) * t;
    }
    // Each key's box on screen this frame, as the board's placer sees it (nodes.js rectBox: the corners of its face up top and
    // its foot on the desk; the near ones reach further out), and its middle up top (bx, by) with the scale there (bpx, bdp).
    // live: the placer counts it.
    function boxOf(v, x, z) {
      const k = v.group.scale.x, hx = (v.tile ? v.o.A + .1 : 1.05) * v.S * k, hz = (v.tile ? v.o.B + .1 : 1.05) * v.S * k, w = ctx.size.w, h = ctx.size.h;
      scaleAt(x, v.top, z);
      v.bx = (sa.x + 1) / 2 * w; v.by = (1 - sa.y) / 2 * h; v.bz = sa.z; v.bpx = spx; v.bdp = sdp;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0, c = v.top > .05 ? 8 : 4; i < c; i++) {
        sb.set(x + (i & 1 ? hx : -hx), i & 4 ? 0 : v.top, z + (i & 2 ? hz : -hz)).project(camera);
        const px = (sb.x + 1) / 2 * w, py = (1 - sb.y) / 2 * h;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      v.b0 = x0; v.b1 = y0; v.b2 = x1; v.b3 = y1;
    }
    // Where a tile's name beside it starts on screen: past its box (and its screenshot key's end), on its side.
    function besideAt(v) {
      const n = v.n, shot = n.kind === 'session' && ctx.shot(n) ? v.bx + v.side * ((v.o.A + .1) * v.S + SHOT_GAP + 2 * SHOT_HALF) * v.group.scale.x * v.bpx : v.bx;
      return (v.side > 0 ? Math.max(v.b2, shot) : Math.min(v.b0, shot)) + v.side * BESIDE_GAP;
    }
    // Pills, and names beside keys, placed this frame (x0, y0, x1, y1 each): what the names after them keep clear of.
    const pills = new Float64Array(4 * world.projects.length), besides = new Float64Array(12 * vis.length), PILL_ORDER = [[-1, 0, 1], [0, -1, 1], [1, 0, -1]];
    let pillN = 0, besideN = 0;
    const clearOf = (list, n, x0, y0, x1, y1) => { for (let i = 0; i < n * 4; i += 4) if (x0 < list[i + 2] && x1 > list[i] && y0 < list[i + 3] && y1 > list[i + 1]) return false; return true; };
    // The usage console's box on screen too (deckBox, from boxDeck): the board doesn't keep names off it, but its readings matter.
    const deckBox = new Float64Array(4);
    function boxDeck() {
      const w = ctx.size.w, h = ctx.size.h, top = LEN * Math.sin(SLOPE) + LIP;
      deckBox[0] = deckBox[1] = Infinity; deckBox[2] = deckBox[3] = -Infinity;
      for (let i = 0; i < 8; i++) {
        sb.set(deckAt.x + (i & 1 ? deckW : -deckW) / 2, i & 4 ? 0 : top, deckAt.z + (i & 2 ? DD : -DD) / 2).project(camera);
        const px = (sb.x + 1) / 2 * w, py = (1 - sb.y) / 2 * h;
        deckBox[0] = Math.min(deckBox[0], px); deckBox[2] = Math.max(deckBox[2], px); deckBox[1] = Math.min(deckBox[1], py); deckBox[3] = Math.max(deckBox[3], py);
      }
    }
    const keysClear = (v, x0, y0, x1, y1) => {
      for (const o of vis) if (o !== v && o.live && x0 < o.b2 && x1 > o.b0 && y0 < o.b3 && y1 > o.b1) return false;
      return !(x0 < deckBox[2] && x1 > deckBox[0] && y0 < deckBox[3] && y1 > deckBox[1]);
    };
    const free = (v, x0, y0, x1, y1) => keysClear(v, x0, y0, x1, y1) && clearOf(pills, pillN, x0, y0, x1, y1) && clearOf(besides, besideN, x0, y0, x1, y1);
    // How much of a box keys, the console and names would cover, for when nowhere is free (a name over another worse than over
    // a key); and how much the pills would, which a pill never may (pillsOver, 2px apart), as neither then reads.
    const cover = (x0, y0, x1, y1, a0, b0, a1, b1) => Math.max(0, Math.min(x1, a1) - Math.max(x0, a0)) * Math.max(0, Math.min(y1, b1) - Math.max(y0, b0));
    function crowd(v, x0, y0, x1, y1) {
      let a = cover(x0, y0, x1, y1, deckBox[0], deckBox[1], deckBox[2], deckBox[3]);
      for (const o of vis) if (o !== v && o.live) a += cover(x0, y0, x1, y1, o.b0, o.b1, o.b2, o.b3);
      for (let i = 0; i < besideN * 4; i += 4) a += 2 * cover(x0, y0, x1, y1, besides[i], besides[i + 1], besides[i + 2], besides[i + 3]);
      return a;
    }
    const pillsOver = (x0, y0, x1, y1) => { let a = 0; for (let i = 0; i < pillN * 4; i += 4) a += cover(x0 - 2, y0 - 2, x1 + 2, y1 + 2, pills[i], pills[i + 1], pills[i + 2], pills[i + 3]); return a; };
    // From afar a project's name is a pill on the junction's shoulder, where the desk prints it up close: level with it away
    // from its bank, else above or below running away from the bank, then centred, then towards it, then those a step further
    // up or down. The first spot in view and clear of the keys, the console, the other pills, the loud names and the cable to
    // You, else of those but the cable, else the least covered (or cut off by the view's edge) that's clear of the pills. On
    // the junction ('on'), so the board places it first and nowhere else. Boxed in by pills (a crowded middle on a phone),
    // it's left to the board, which shows it where there's room or not at all.
    function placePill(v) {
      v.pOn = false;
      const b = bank.get(v.n), you = byNode.get(world.you); if (!b || !v.live) return;
      const name = v.n.name;
      if (v.pOf !== name || v.pFonts !== fontsReady || v.pPx !== pillPx) {
        measure.font = pillFont(pillPx); v.pw = Math.ceil(measure.measureText(name.toUpperCase()).width + name.length * pillLS(pillPx) + pillPad(pillPx));
        v.pOf = name; v.pFonts = fontsReady; v.pPx = pillPx;
      }
      const w = v.pw, h = pillH(pillPx), dir = b.title.dir, order = PILL_ORDER[Math.sign(b.title.z) + 1];
      let x = 0, y = 0, found = false, least = Infinity, lx = 0, ly = 0;
      for (let pass = 0; pass < 3 && !found; pass++) for (let i = 0; i < 18 && !found; i++) {
        const j = i % 9, step = i < 9 ? 0 : Math.ceil(h * .6), at = order[j % 3], slide = j / 3 | 0, inset = (v.b2 - v.b0) * .3;
        if (!at && (slide || step)) continue;
        x = at ? v.bx + (slide === 1 ? 0 : (slide ? -dir : dir) * (w / 2 - inset)) : dir > 0 ? v.b2 + 4 + w / 2 : v.b0 - 4 - w / 2;
        y = at < 0 ? v.b1 - 3 - h / 2 - step : at > 0 ? v.b3 + 3 + h / 2 + step : v.by;
        const x0 = x - w / 2, y0 = y - h / 2, x1 = x + w / 2, y1 = y + h / 2;
        const out = Math.max(0, 4 - x0, x1 - ctx.size.w + 4) * h + Math.max(0, 4 - y0, y1 - ctx.size.h + 4) * w;
        if (pass < 2) found = !out && free(v, x0, y0, x1, y1) && (pass || !you?.live || !crosses(v.bx, v.by, you.bx, you.by, x0, y0, x1, y1));
        else if (!pillsOver(x0, y0, x1, y1)) { const a = crowd(v, x0, y0, x1, y1) + step * w + 8 * out; if (a < least) { least = a; lx = x; ly = y; } }
      }
      if (!found) { if (least === Infinity) return; x = lx; y = ly; }
      const i = 4 * pillN++; pills[i] = x - w / 2; pills[i + 1] = y - h / 2; pills[i + 2] = x + w / 2; pills[i + 3] = y + h / 2;
      onLevel(x, y, v.top, spot); v.pOn = true; v.pdx = spot.x - v.n.pos.x; v.pdz = spot.z - v.n.pos.z;
    }
    ctx.setLabelRule(n => {
      if (n.kind === 'you') return false;
      const v = byNode.get(n);
      return v?.tile ? v.rule : legible ? false : v?.pOn ? 'on' : undefined;
    });
    ctx.setLabelAnchor((n, out, on) => {
      const v = byNode.get(n), k = v?.group.scale.x ?? 1, b = n.kind === 'project' && bank.get(n);
      out.y = 0;
      if (v?.tile) {
        out.y = v.top;
        if (on) out.x += v.side * (2 * LAMP + .3 - v.padU) / 2 * v.S * k;
        else {
          // Its middle level with the key's, a little past the key's end (and its screenshot key's).
          onLevel(besideAt(v) + v.side * v.lw / 2, v.by - (needs(n) || n.status === 'error' ? BESIDE_H2 : n.kind === 'sub' ? SUB_H : BESIDE_H) / 2, v.top, out);
        }
      }
      else if (b && on && v.pOn) { out.y = v.top; out.x += v.pdx; out.z += v.pdz; }
      else if (b) { out.x += (b.title.x + b.title.dir * b.title.w / 2) * k; out.z += b.title.z * k - b.title.h / 2; }
      else out.z += { you: 2.3, project: 1.35 }[n.kind] || 1;
    });
    // Footprints, for picking and for keeping labels off keys: a tile's whole face, a round key's square. tw, th: the space a
    // name on a tile takes, its display bar beside the lamp (th across the view's scale, as the board measures it), so a name cut
    // to two lines keeps the others off both; a project's pill: as wide as it is.
    ctx.setShape(n => {
      const v = byNode.get(n); if (!v) return null;
      const f = v.foot || (v.foot = { hx: 0, hz: 0, y: 0, tw: 0, th: 0 }), k = v.group.scale.x;
      if (v.tile) { f.hx = (v.o.A + .1) * v.S * k; f.hz = (v.o.B + .1) * v.S * k; f.tw = v.tw0 * v.S * k; f.th = 2 * v.sk.hz * v.S * k * v.bdp / Math.max(1e-3, v.bpx); }
      else { f.hx = f.hz = 1.05 * v.S * k; f.tw = n.kind === 'project' ? 99 : 2 * f.hx; f.th = 0; }
      f.y = v.top; return f;
    });
    // A tile's name as the labels print it (css: .lbl.on, .lbl beside): across, on one line and at least on two, and beside its key.
    function measureName(v) {
      const name = v.n.name, sub = v.n.kind === 'sub';
      measure.font = sub ? SUB_ON_FONT : ON_FONT; v.w1 = v.w2 = measure.measureText(name).width;
      // Two lines break at a space or after a hyphen: the narrowest that holds both halves.
      if (!sub) for (let i = 1; i < name.length - 1; i++) {
        const c = name.charCodeAt(i); if (c !== 32 && c !== 45) continue;
        v.w2 = Math.min(v.w2, Math.max(measure.measureText(name.slice(0, c === 32 ? i : i + 1)).width, measure.measureText(name.slice(i + 1)).width));
      }
      measure.font = sub ? SUB_BESIDE_FONT : BESIDE_FONT; v.bw = measure.measureText(name).width + (sub ? SUB_BESIDE_PAD : BESIDE_PAD);
      v.mOf = name; v.mFonts = fontsReady;
    }
    // Where a tile's name goes this frame (after boxOf and the pills): on it while it fits there whole, on one line or on the
    // two the rows have room for (lines; a little slack to come back, so it doesn't flicker at the edge), else beside it
    // (undefined; settle decides). cut: whether it may go on it cut short instead.
    function ruleFor(v) {
      const n = v.n, sub = n.kind === 'sub';
      if (sub ? legibleSub : legible) return false;
      if (v.mOf !== n.name || v.mFonts !== fontsReady) measureName(v);
      const k = v.group.scale.x, room = v.tw0 * v.S * k * v.bpx * (v.rule === 'on' ? .99 : .95), face = 2 * v.sk.hz * v.S * k * v.bdp, lh = sub ? SUB_LH : ON_LH;
      v.cut = !sub && room >= 44 && face >= lh - 3; v.lw = v.bw;
      return v.w1 <= room && face >= lh - 3 || !sub && lines === 2 && v.w2 <= room ? 'on' : undefined;
    }
    // The names beside keys, placed here first as the board then will (nodes.js renderLabels: most important first, then nearest;
    // each clear of the pills, of the names placed before it and, below needs-you, of the keys; 6px to spare, 1 once placed, and
    // a pixel more here so it never takes a spot the board wouldn't; held
    // 8px inside the view, where one past the edge would be pushed back over its own key),
    // but only right beside its key: a name that would go elsewhere goes on its key cut short, or nowhere. Moved a row off or
    // over another bank it reads as someone else's, and pushes the next one off its row too. Under the pointer, picked or in
    // trouble, it's the board's to place anyway.
    const besideQ = [], rankOf = n => n.selected ? 9 : n.hovered ? 8 : needs(n) ? 7 : n.status === 'error' ? 5 : n.kind === 'session' ? 4 : 1;
    const byRank = (a, b) => b.rank - a.rank || a.bz - b.bz;
    function settle(v) {
      const n = v.n, loud = v.rank >= 5, said = needs(n) || n.status === 'error', h = said ? BESIDE_H2 : n.kind === 'sub' ? SUB_H : BESIDE_H;
      if (said) {
        const t = lineOf(n);
        if (v.sOf !== t || v.sFonts !== fontsReady) { measure.font = LINE_FONT; v.sw = Math.min(LINE_MAX, Math.ceil(measure.measureText(t).width)) + LINE_PAD; v.sOf = t; v.sFonts = fontsReady; }
        v.lw = Math.max(v.bw, v.sw);
      }
      const a = besideAt(v), e = a + v.side * v.lw, x0 = Math.min(a, e), x1 = Math.max(a, e), y0 = v.by - h / 2, y1 = y0 + h;
      const pad = v.beside ? 2 : 7, P0 = x0 - pad, P1 = y0 - pad, P2 = x1 + pad, P3 = y1 + pad;
      const fits = x0 >= 8 && x1 <= ctx.size.w - 8 && clearOf(pills, pillN, P0, P1, P2, P3) && clearOf(besides, besideN, P0, P1, P2, P3) && (v.rank >= 7 && !loud || keysClear(v, P0, P1, P2, P3));
      v.beside = loud || fits;
      if (!v.beside) { v.rule = v.cut ? 'on' : false; return; }
      take(x0, y0, x1, y1);
      // A loud one that may not fit there the board moves: inside the view, or up over its key (its next spot), so keep both.
      if (loud && !fits) { const sx = Math.min(Math.max(0, 8 - x0), ctx.size.w - 8 - x1); take(x0 + sx, y0, x1 + sx, y1); take(x0 + sx, v.b1 - 3 - h, x1 + sx, v.b1 - 3); }
    }
    function take(x0, y0, x1, y1) { const i = 4 * besideN++; besides[i] = x0; besides[i + 1] = y0; besides[i + 2] = x1; besides[i + 3] = y1; }

    // A project's name, printed on the desk beside its junction (see titleSpot).
    const titles = world.projects.map(p => {
      const w = titleW(p.name), tex = canvasTex(w, 84);
      const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.scale.set(w / TPX, 1, 84 / TPX); m.renderOrder = -1; root.add(m);
      return { p, m, tex, text: p.name.toUpperCase(), w, dir: 0, fonts: null };
    });
    function drawTitle(t, dir) {
      const g = t.tex.image.getContext('2d'), h = t.tex.image.height;
      g.clearRect(0, 0, t.w, h); g.font = TITLE_FONT; g.fillStyle = K.text; g.globalAlpha = .85; g.textBaseline = 'middle';
      g.textAlign = dir > 0 ? 'left' : 'right'; g.fillText(t.text, dir > 0 ? 6 : t.w - 6, h / 2 + 3); g.globalAlpha = 1;
      t.tex.needsUpdate = true; t.dir = dir; t.fonts = fontsReady;
    }
    // A tile's text: the name in bold, what it's doing in mono below (amber when it needs you), plan steps as pips. The name takes
    // the roomiest layout it fits whole in at this zoom (LAYOUT); hysteresis keeps a tile from flipping at a threshold.
    const lineOf = n => needs(n) ? `${n.text} · ${kit.fmtWait(n.waitSec)}` : n.text;
    function layoutOf(v, zr) {
      const L = v.L, n = v.n;
      if (v.nwOf !== n.name || v.nwFonts !== fontsReady) { measure.font = NAME_FONT(v.tex.image.height * L[0].nf); v.nw = measure.measureText(n.name).width; v.nwOf = n.name; v.nwFonts = fontsReady; }
      const room = v.tex.image.width - v.lampW - v.pad;
      for (let i = 0; i < L.length; i++) if (!L[i].wrap && zr >= L[i].z * (i === v.lay ? .97 : 1) && v.nw * L[i].nf / L[0].nf <= room * (L[i].row || 1) * .99) return i;
      for (let i = 0; i < L.length; i++) if (L[i].wrap && zr >= L[i].z * (i === v.lay ? .97 : 1)) return i;
      for (let i = L.length - 1; i > 0; i--) if (!L[i].wrap && zr >= L[i].z * (i === v.lay ? .97 : 1)) return i;
      return 0;
    }
    // Where everything goes in layout lay, and the name as it'll print.
    function layTile(v, g, lay) {
      const n = v.n, L = v.L[lay], W = v.tex.image.width, h = v.tex.image.height, sub = n.kind === 'sub';
      const x0 = v.side > 0 ? v.lampW : v.pad, x1 = v.side > 0 ? W - v.pad : W - v.lampW;
      v.nameFont = NAME_FONT(h * L.nf); v.statusFont = STATUS_FONT(h * L.sf); v.ny = L.ny; v.sy = L.sy; v.sf = L.sf; v.x0 = x0;
      v.nameCol = !sub && n.status === 'offline' ? K.muted : K.text;
      v.col = needs(n) ? K.need : n.status === 'error' ? K.err : n.status === 'idle' || n.status === 'offline' ? K.muted : K.ink;
      g.font = v.nameFont;
      v.two = !!L.wrap && !sub;
      if (v.two) { wrap(g, n.name, x1 - x0, v.lines); v.ny2 = L.ny2; } else { v.lines[0] = fit(g, n.name, (x1 - x0) * (L.row || 1)); v.lines[1] = ''; }
      v.sx = L.row ? x0 + g.measureText(v.lines[0]).width + h * .2 : x0; v.end = x1; v.pips = 0;
      if (n.plan && !sub) {
        const t = n.plan.total, d = h * L.sf * .46, gap = h * L.sf * .19, pw = t * (d + gap);
        if (pw < (x1 - x0) * .35) Object.assign(v, { end: x1 - pw - h * .1, pips: t, pipDone: n.plan.done, pipX: x1 - pw, pipD: d, pipGap: gap });
      }
    }
    function statusText(v, g) { g.font = v.statusFont; return fit(g, lineOf(v.n), v.end - v.sx); }
    function paintTile(v, g) {
      const W = v.tex.image.width, h = v.tex.image.height;
      g.fillStyle = v.topCol; g.fillRect(0, 0, W, h); g.textBaseline = 'alphabetic';
      g.font = v.nameFont; g.fillStyle = v.nameCol; g.fillText(v.lines[0], v.x0, h * v.ny);
      if (v.lines[1]) g.fillText(v.lines[1], v.x0, h * v.ny2);
      for (let i = 0; i < v.pips; i++) { g.fillStyle = i < v.pipDone ? K.ink : K.track; g.fillRect(v.pipX + i * (v.pipD + v.pipGap) + v.pipGap, h * v.sy - v.pipD, v.pipD, v.pipD); }
      g.font = v.statusFont; g.fillStyle = v.col; g.fillText(v.shown, v.sx, h * v.sy);
    }
    // A wait counting up changes a few characters at the end of the status line: repaint and upload only the strip from the first
    // changed character to the line's end, from its top to the display's bottom, not the whole display. It goes through a canvas
    // the strip's exact size: the texture flips rows on upload, so the strip lands at the texture's bottom edge.
    const band = document.createElement('canvas'), bandG = band.getContext('2d'), bandTex = new THREE.Texture(band), bandAt = new THREE.Vector2();
    function restatus(v, g, shown) {
      const W = v.tex.image.width, h = v.tex.image.height, old = v.shown, m = Math.min(old.length, shown.length);
      let p = 0; while (p < m && old.charCodeAt(p) === shown.charCodeAt(p)) p++;
      g.font = v.statusFont;
      const xa = Math.max(0, Math.floor(v.sx + g.measureText(shown.slice(0, p)).width) - 4);
      const xb = Math.min(W, Math.ceil(v.sx + Math.max(g.measureText(old).width, g.measureText(shown).width)) + 6);
      const r0 = Math.max(0, Math.floor(h * (v.sy - .9 * v.sf)) - 2), bw = xb - xa, bh = h - r0;
      v.shown = shown;
      if (bw <= 0) return;
      g.save(); g.beginPath(); g.rect(xa, r0, bw, bh); g.clip(); paintTile(v, g); g.restore();
      if (band.width !== bw || band.height !== bh) { band.width = bw; band.height = bh; }
      bandG.drawImage(g.canvas, xa, r0, bw, bh, 0, 0, bw, bh);
      renderer.copyTextureToTexture(bandTex, v.tex, null, bandAt.set(xa, 0));
    }
    function drawTile(v, zr) {
      const n = v.n, lay = layoutOf(v, zr), plan = n.plan, done = plan ? plan.done : -1, total = plan ? plan.total : -1, wait = needs(n) ? waitStep(n.waitSec) : 0;
      const same = lay === v.lay && n.name === v.kName && n.status === v.kStatus && done === v.kDone && total === v.kTotal && v.side === v.kSide && fontsReady === v.kFonts;
      if (same && n.text === v.kText && wait === v.kWait) return;
      const g = v.tex.image.getContext('2d');
      v.kText = n.text; v.kWait = wait;
      if (same) { const shown = statusText(v, g); if (shown !== v.shown) restatus(v, g, shown); return; }
      Object.assign(v, { lay, kName: n.name, kStatus: n.status, kDone: done, kTotal: total, kSide: v.side, kFonts: fontsReady });
      layTile(v, g, lay); v.shown = statusText(v, g); paintTile(v, g);
      v.tex.needsUpdate = true;
    }

    // Cables: child → parent, lying on the desk in a gentle, fixed curve, a little thicker at the plugs, in the project's
    // colour (the trunk to You is plain). A tile's cable plugs into the end nearest its junction. Tool pulses ride them as beads.
    const trunkMat = new THREE.MeshStandardMaterial({ color: K.trunk, roughness: .75 }), wireMats = new Map();
    const wireMat = p => wireMats.get(p) || wireMats.set(p, new THREE.MeshStandardMaterial({ color: C(K.cable).lerp(hue(p), K.wire), roughness: .75 })).get(p);
    const links = world.nodes.filter(n => n.kind !== 'you').map(n => {
      const link = { n, child: byNode.get(n), parent: byNode.get(n.kind === 'project' ? world.you : n.parent), r: { project: .085, session: .06, sub: .04 }[n.kind], k: 1,
        a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), len: 1, sgn: n.seed % 2 ? 1 : -1, last: unseen(7), on: false, pulses: new kit.Pulses() };
      link.radius = t => link.r * link.k * (1 + .5 * (1 - kit.smoothstep(.06, .32, Math.min(t, 1 - t) * link.len)));
      link.point = (t, out) => { kit.bezier(link.a, link.c, link.b, t, out); out.y = link.radius(t); return out; };
      link.tube = new kit.Tube({ segments: 22, radial: 7, radius: link.radius });
      link.mesh = new THREE.Mesh(link.tube.geometry, n.kind === 'project' ? trunkMat : wireMat(n.project)); link.mesh.castShadow = true; link.mesh.frustumCulled = false; root.add(link.mesh);
      return link;
    });
    const linkOf = new Map(links.map(l => [l.n, l]));
    // Rebuild a tube (and redraw the shadow map) only when what shapes it moved; at rest the board does no geometry work.
    const moved = (a, x0, x1, x2, x3, x4, x5, x6) => (ch(a, 0, x0) | ch(a, 1, x1) | ch(a, 2, x2) | ch(a, 3, x3) | ch(a, 4, x4) | ch(a, 5, x5) | ch(a, 6, x6)) > 0;
    // How far a node's housing reaches towards (dx, dz), and where a tile's lamp sits along it.
    const reach = (v, dx, dz) => v.S * (v.o.r(Math.atan2(dz, dx)) + .06) * v.group.scale.x;
    const lampX = v => -v.side * (v.sk.hx - .15 - LAMP) * v.S * v.group.scale.x;

    // Needs-you cords: a taut amber wire strung from the popped key's lamp to You, high enough to clear what's between, with
    // beads sliding along it towards You (quicker as the wait grows).
    const cords = world.sessions.map(n => {
      const cord = { n, a: new THREE.Vector3(), b: new THREE.Vector3(), sag: 0, L: 1, ph: (n.seed % 97) / 97, last: unseen(7), on: false };
      cord.tube = new kit.Tube({ segments: 40, radial: 6, radius: () => .055 });
      cord.mat = new THREE.MeshStandardMaterial({ color: PAL.need, emissive: PAL.need, emissiveIntensity: .25, roughness: .4 });
      cord.mesh = new THREE.Mesh(cord.tube.geometry, cord.mat); cord.mesh.castShadow = true; cord.mesh.frustumCulled = false; cord.mesh.visible = false; root.add(cord.mesh);
      cord.point = (t, out) => { out.lerpVectors(cord.a, cord.b, t).y -= 4 * t * (1 - t) * cord.sag; return out; };
      return cord;
    });

    // Beads and pearls cast no shadow: they move on every frame they're out, and each would mean drawing the shadow map again.
    const instanced = (geo, mat, count) => { const m = new THREE.InstancedMesh(geo, mat, count); m.count = 0; m.frustumCulled = false; m.setColorAt(0, bg); root.add(m); return m; };
    const beads = instanced(new THREE.SphereGeometry(.12, 14, 10), new THREE.MeshStandardMaterial({ roughness: .35 }), 96);
    const pearls = instanced(new THREE.SphereGeometry(.12, 12, 8), new THREE.MeshStandardMaterial({ roughness: .3, emissive: '#ffb02e', emissiveIntensity: .3 }), 192);
    // Upload just the instances in use, and only on a frame that has some.
    function upload(m, count) {
      m.count = count; if (!count) return;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, count * 16); m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, count * 3); m.instanceColor.needsUpdate = true;
    }
    // A cable's beads, from instance bi on; returns the next free one.
    function beadsOn(l, bi) {
      for (const p of l.pulses.list) {
        if (bi >= 96) break;
        l.point(kit.easeInOutSine(p.t), pv); pv.y += l.r * l.k * .9;
        const k = Math.min(1, p.t * 10, (1 - p.t) * 10) * p.strength * (l.n.kind === 'project' ? 1.15 : l.n.kind === 'sub' ? .6 : .85);
        m4.compose(pv, q4, sv.setScalar(Math.max(.01, k))); beads.setMatrixAt(bi, m4); beads.setColorAt(bi, p.data); bi++;
      }
      return bi;
    }

    // Selection: crop marks at a key's four corners. Hover: the same, faint.
    const markTex = kit.canvasTexture(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s * .12); g.fillRect(0, 0, s * .12, s); });
    const marks = [K.accent, K.ink].map(color => {
      const mat = new THREE.MeshBasicMaterial({ map: markTex, color, transparent: true, depthWrite: false, opacity: 0 });
      return [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(planeGeo, mat); m.scale.setScalar(.7); m.visible = false; root.add(m); return m; });
    });
    function markOut(set, v, amount) {
      const on = !!v && amount > .01;
      for (let i = 0; i < 4; i++) {
        const m = set[i]; m.visible = on; if (!on) continue;
        const sx = i === 1 || i === 2 ? 1 : -1, sz = i >= 2 ? 1 : -1, hx = (v.tile ? v.o.A + .35 : 1.4) * v.S, hz = (v.tile ? v.o.B + .35 : 1.4) * v.S;
        m.position.set(v.group.position.x + sx * (hx - .35), .008, v.n.pos.z + sz * (hz - .35)); m.rotation.y = MARK_ROT[i]; m.material.opacity = amount;
      }
    }

    // Usage: a low console beside You. Its sloped display reads YOU and how many are waiting, then a ring gauge per account
    // (outer ring its longest window, inner its shortest, the fuller one's percent in the middle) and one for spend. It
    // stands in the widest gap round You, so no cable runs under it, and redraws only when a number changes.
    const standMat = new THREE.MeshStandardMaterial({ color: K.key, roughness: .55 });
    const deck = new THREE.Group(), deckBody = new THREE.Mesh(new THREE.BufferGeometry(), standMat), deckFace = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    deckBody.castShadow = true; onSlope(THREE, deckFace, LEN, SLOPE, LIP);
    deck.add(deckBody, deckFace); root.add(deck);
    let deckCols = 0, deckSig = '', deckW = 0, deckUsage = null, deckQ = -1, deckFonts = false;
    const deckSh = unseen(2);
    const pct = v => `${Math.round(v * 100)}%`, fillCol = v => v > .9 ? PAL.error : v > .7 ? K.accent : K.ink, mono = (px, w = 500) => `${w} ${px}px "Geist Mono", ui-monospace, monospace`;
    function drawDeck() {
      const q = world.queue().length;
      // world.usage is a new list only when the usage changed, so most frames stop here.
      if (world.usage === deckUsage && q === deckQ && fontsReady === deckFonts) return;
      deckUsage = world.usage; deckQ = q; deckFonts = fontsReady;
      const list = world.usage.filter(a => a.windows.length || a.spend).slice(0, 5);
      const sig = JSON.stringify([q, fontsReady, list.map(a => [a.label, a.windows.map(w => [w.label, Math.round(w.used * 100)]), a.spend && [Math.round(a.spend.spent), a.spend.limit]])]);
      if (sig === deckSig) return;
      deckSig = sig;
      if (list.length + 1 !== deckCols) {
        deckCols = list.length + 1; deckW = deckCols * COL + .3;
        deckBody.geometry.dispose(); deckBody.geometry = wedge(THREE, deckW, LEN, SLOPE, LIP); shadowDirty = true;
        deckFace.scale.set(deckW - .3, LEN - .3, 1);
        deckFace.material.map?.dispose(); deckFace.material.map = canvasTex(Math.round((deckW - .3) * PX), Math.round((LEN - .3) * PX)); deckFace.material.needsUpdate = true;
        if (deckCols !== planCols) ctx.setLayout(layout);
      }
      const tex = deckFace.material.map, cv = tex.image, g = cv.getContext('2d'), mid = COL * PX / 2;
      g.fillStyle = K.top; g.fillRect(0, 0, cv.width, cv.height); g.textAlign = 'center'; g.lineCap = 'butt';
      g.fillStyle = K.accent; g.font = mono(64, 600); g.fillText('YOU', mid, 120);
      g.fillStyle = q ? K.need : K.muted; g.font = mono(38, 600); g.fillText(q ? `${q} waiting` : 'all clear', mid, 190);
      list.forEach((a, i) => {
        const x = (i + 1) * COL * PX + mid, y = 124, ws = a.windows.slice(0, 2);
        g.fillStyle = K.track; g.fillRect((i + 1) * COL * PX - 1, 24, 2, cv.height - 48);
        const rings = ws.length ? [ws[ws.length - 1], ws.length > 1 ? ws[0] : null] : [a.spend.limit ? { used: Math.min(1, a.spend.spent / a.spend.limit) } : null];
        rings.forEach((w, k) => {
          const r = k ? 80 : 106; g.lineWidth = 18;
          g.strokeStyle = K.track; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
          if (w) { g.strokeStyle = fillCol(w.used); g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(.005, w.used)); g.stroke(); }
        });
        const top = ws.reduce((m, w) => w.used > m.used ? w : m, ws[0] || { used: 0 });
        g.fillStyle = K.ink; g.globalAlpha = .6; g.font = mono(22); g.fillText(ws.length ? top.label.toUpperCase() : 'SPENT', x, 82); g.globalAlpha = 1;
        g.fillStyle = ws.length ? fillCol(top.used) : K.ink; g.font = mono(60, 600); g.fillText(ws.length ? pct(top.used) : `$${Math.round(a.spend.spent)}`, x, 146);
        // Whose: the provider's mark from the lamps, and the account's own name if it has one.
        g.font = mono(38, 600); const label = fit(g, (a.label.split(' · ')[1] || a.label.replace(' Code', '')).toUpperCase(), COL * PX - 70);
        const gx = x - g.measureText(label).width / 2 - 8; g.fillText(label, x + 14, 296);
        g.fillStyle = PROVIDER[a.provider] || K.ink; g.beginPath();
        if (a.provider === 'codex') for (let j = 0; j < 6; j++) g.lineTo(gx + Math.cos(j * Math.PI / 3) * 14, 283 + Math.sin(j * Math.PI / 3) * 14);
        else if (a.provider === 'opencode') g.rect(gx - 12, 271, 24, 24);
        else for (let j = 0; j < 16; j++) { const r = j % 2 ? 6 : 15; g.lineTo(gx + Math.sin(j * Math.PI / 8) * r, 283 - Math.cos(j * Math.PI / 8) * r); }
        g.fill();
      });
      tex.needsUpdate = true;
    }

    // Screenshots: a key of their own off the outer end of a session's key, on a short lead in the project's colour, the session's
    // latest screenshot on its display and a count in the corner. It rises under the pointer; a click opens the viewer. Made
    // when the first screenshot comes, redrawn when it changes.
    const SK = kits.shot, SS = SCALE.session;
    const shotMat = new THREE.MeshStandardMaterial({ color: K.key, roughness: .52, envMapIntensity: .9 });
    const shotShaft = new THREE.MeshStandardMaterial({ color: SHAFT, roughness: .45 }), leadGeo = new THREE.CylinderGeometry(.06, .06, 1, 10).rotateZ(Math.PI / 2);
    const cards = new Map(world.sessions.map(n => { const t = ctx.addTarget({ node: n, pos: new THREE.Vector3(), radius: 2.6, hx: SHOT_HALF, hz: SHOT_Z, action: 'shots' }); return [n, { t, pos: t.pos, group: null, shot: null, lift: 0, sh: unseen(5) }]; }));
    ctx.setFrame(add => { for (const b of frameBoxes) { add(b[0], b[1], 0); add(b[2], b[3], 0); } });
    function drawCard(c, shot) {
      const cv = c.tex.image, g = cv.getContext('2d'), W = cv.width, h = cv.height, m = 12, r = 16, b = shot.bitmap;
      // A dark screen fills the face, so a tall phone shot still reads as a display rather than a sliver on a blank key.
      g.fillStyle = K.top; g.fillRect(0, 0, W, h);
      g.save(); g.beginPath(); g.roundRect(m, m, W - 2 * m, h - 2 * m, r); g.clip(); g.fillStyle = '#16191f'; g.fillRect(m, m, W - 2 * m, h - 2 * m);
      const k = Math.min((W - 2 * m) / b.width, (h - 2 * m) / b.height), iw = b.width * k, ih = b.height * k;
      g.drawImage(b, (W - iw) / 2, (h - ih) / 2, iw, ih); g.restore();
      g.strokeStyle = K.track; g.lineWidth = 3; g.beginPath(); g.roundRect(m, m, W - 2 * m, h - 2 * m, r); g.stroke();
      const u = W / 640, bx = W - m - 32 * u, by = m + 32 * u; // the count's badge, sized to the key
      g.fillStyle = K.top; g.beginPath(); g.arc(bx, by, 28 * u, 0, Math.PI * 2); g.fill();
      g.fillStyle = K.accent; g.beginPath(); g.arc(bx, by, 23 * u, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = mono(Math.round(28 * u), 600); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(shot.count), bx, by + 1);
      c.tex.needsUpdate = true;
    }
    function updateCard(v, c, dt) {
      const shot = v.n.s.alive > .02 ? ctx.shot(v.n) : null;
      if (!shot) { if (c.group) { c.group.visible = c.ao.visible = c.lead.visible = false; if (ch(c.sh, 0, 0)) shadowDirty = true; } return; }
      if (!c.group) {
        c.group = new THREE.Group(); root.add(c.group);
        const base = new THREE.Mesh(SK.base, baseMat); base.scale.setScalar(SS); base.receiveShadow = true;
        c.shaft = new THREE.Mesh(SK.shaft, shotShaft); c.shaft.position.y = BASE_H * SS;
        c.cap = new THREE.Group();
        const body = new THREE.Mesh(SK.cap, shotMat); body.castShadow = true; body.scale.set(SS, SS * TALL.session, SS); c.cap.add(body);
        c.tex = canvasTex(Math.round(2 * SK.hx * SS * PX * 1.6), Math.round(2 * SK.hz * SS * PX * 1.6));
        const display = new THREE.Mesh(SK.face, new THREE.MeshBasicMaterial({ map: c.tex, polygonOffset: true, polygonOffsetFactor: -1 })); display.position.y = H - DISH + .002; body.add(display);
        c.group.add(base, c.shaft, c.cap);
        c.ao = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: SK.ao, color: K.ao[0], transparent: true, opacity: K.ao[1], depthWrite: false })); c.ao.renderOrder = -2; root.add(c.ao);
        c.lead = new THREE.Mesh(leadGeo, wireMat(v.n.project)); c.lead.castShadow = true; root.add(c.lead);
      }
      if (shot !== c.shot) { c.shot = shot; drawCard(c, shot); }
      const k = v.group.scale.x, end = (v.o.A + .1) * v.S * k, x = v.group.position.x + v.side * (end + SHOT_GAP * k + SHOT_HALF * k), z = v.n.pos.z;
      const goal = c.t.hovered ? 1 : 0;
      c.lift = ctx.reduced ? goal : kit.damp(c.lift, goal, 14, dt);
      if (Math.abs(c.lift - goal) < .002) c.lift = goal; else settling = true;
      const travel = (TRAVEL + c.lift * .08) * SS;
      c.group.visible = c.ao.visible = c.lead.visible = true;
      c.group.position.set(x, 0, z); c.group.scale.setScalar(k);
      c.cap.position.y = BASE_H * SS + travel; c.shaft.scale.set(SS, travel, SS);
      c.ao.position.set(x, .004, z); c.ao.scale.set(2 * SK.ex * SS * k, 1, 2 * SK.ez * SS * k);
      c.lead.position.set(v.group.position.x + v.side * (end + SHOT_GAP * k / 2), .06, z); c.lead.scale.set(SHOT_GAP * k + .2, 1, 1);
      c.pos.set(x, .6, z);
      if (ch(c.sh, 0, 1) | ch(c.sh, 1, x) | ch(c.sh, 2, z) | ch(c.sh, 3, k) | ch(c.sh, 4, travel)) shadowDirty = true;
    }

    const toolCol = Object.fromEntries(Object.entries(TOOL).map(([k, v]) => [k, C(v)]));
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), tmp = new THREE.Color(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    const lampAt = new THREE.Vector3(), pearlC = C('#fff1d6');
    // settling: something is still springing or fading this frame, so the next one is wanted straight away (see update's return).
    let settling = true, springV = 0, lastNow = performance.now() / 1000, lastPace = Infinity;

    // A damped spring stepped finely, so stiff ones stay stable at low frame rates. Returns the position, the velocity in springV;
    // it snaps to rest once there's nothing left to see, so the board can stop drawing.
    function spring(x, v, goal, k, zeta, dt) {
      if (x === goal && v === 0) { springV = 0; return x; }
      const c = 2 * Math.sqrt(k) * zeta, steps = Math.min(16, Math.ceil(dt * 240)), h = steps ? dt / steps : 0;
      for (let i = 0; i < steps; i++) { v += ((goal - x) * k - v * c) * h; x += v * h; }
      if (Math.abs(goal - x) < 1e-4 && Math.abs(v) < 1e-3) { x = goal; v = 0; } else settling = true;
      springV = v; return x;
    }
    const set = (u, x) => { if (u.value !== x) u.value = x; };
    // A click: the cap dips and comes back. A flash: the lamp lights in a colour for a moment.
    const click = (v, amt) => { if (!ctx.reduced) v.st.pv += amt; };
    const flash = (v, color) => { if (ctx.reduced) return; v.uniforms.uFlash.value = 1; v.uniforms.uFlashCol.value.copy(color); };
    function event(type, n, data) {
      const v = byNode.get(n); if (!v) return;
      // Only real work sends beads up the cable; idle, waiting and offline keys stay quiet.
      if (type === 'tool') { if (!busy(n)) return; click(v, 3); if (!ctx.reduced) linkOf.get(n)?.pulses.add(n.kind === 'sub' ? 2.4 : 1.5, 1, toolCol[data.kind] || toolCol['']); }
      else if (type === 'spawn') { if (!ctx.reduced) { v.st.y = 1.1; v.st.vy = 0; } }
      else if (type === 'finish') { flash(v, palC[0]); click(v, 14); }
      else if (type === 'answer') flash(v, palC[0]);
      else if (type === 'compacted') { flash(v, palC[2]); click(v, 10); }
      else if (type === 'state' && data.to === 'error') { flash(v, palC[6]); if (!ctx.reduced) v.st.jv += 3.5; }
    }

    // Whether world point (x, y, z) is on screen, or near enough that its lamp or pearl would be.
    const onScreen = (x, y, z) => { lampAt.set(x, y, z).project(camera); return Math.abs(lampAt.x) < 1.15 && Math.abs(lampAt.y) < 1.15; };

    function update(dt) {
      const reduced = ctx.reduced, queue = world.queue(), youV = byNode.get(world.you);
      // The lamps run on real time, not the board's: frames come only as often as this asks (see the end), and the board's clock
      // steps by at most a twentieth of a second a frame. The wait hand moves in whole seconds while the board draws once a second.
      const now = performance.now() / 1000, rdt = Math.min(.1, now - lastNow); lastNow = now;
      set(timeU, reduced ? 0 : now % 3600); set(clockU, reduced ? 0 : lastPace > 1 ? now % 60 : Math.floor(now % 60)); set(animU, reduced ? 0 : 1);
      settling = false;
      let loop = 0, pulsing = false, ticking = false;
      // A screenshot key sticks out past its session's key: plan the board again when one comes.
      let shotNow = 0; for (const n of world.sessions) if (ctx.shot(n)) shotNow++;
      if (shotNow !== shotCount) { shotCount = shotNow; ctx.setLayout(layout); }
      deck.position.set(deckAt.x, 0, deckAt.z);
      if (ch(deckSh, 0, deckAt.x) | ch(deckSh, 1, deckAt.z)) shadowDirty = true;
      // Pixels a world unit across and down the desk, how big each kind's name prints on its display (zr, zs: 1 at NAME_MIN), and
      // whether the displays print their own (legible), a little slack to come back so they don't flicker at the edge.
      p0.copy(world.you.pos).project(camera); p1.copy(world.you.pos).setX(world.you.pos.x + 1).project(camera);
      pxu = Math.abs(p1.x - p0.x) * ctx.size.w / 2;
      p1.copy(world.you.pos).setZ(world.you.pos.z + 1).project(camera);
      dpu = Math.abs(p1.y - p0.y) * ctx.size.h / 2;
      const zr = pxu * LAYOUT.session[0].nf * 2 * kits.session.hz * SCALE.session / NAME_MIN.session;
      const zs = pxu * LAYOUT.sub[0].nf * 2 * kits.sub.hz * SCALE.sub / NAME_MIN.sub;
      legible = zr >= ZMAX.session * (legible ? .97 : 1); legibleSub = zs >= ZMAX.sub * (legibleSub ? .97 : 1);
      // A session's name on its key takes two lines while two fit in its row with a little to spare, else one (css: --clean-lines).
      const two = (tileH('session') + .5) * dpu >= 2 * ON_LH + (lines === 2 ? 2 : 4), sceneEl = renderer.domElement.parentElement;
      if (lines !== (two ? 2 : 1) && sceneEl) { lines = two ? 2 : 1; sceneEl.style.setProperty('--clean-lines', lines); }
      // On a phone the pills come smaller, as a dozen at full size crowd its board.
      const px = ctx.size.w < NARROW ? PILL_PX_NARROW : PILL_PX;
      if (pillCss !== px && sceneEl) { pillCss = px; sceneEl.style.setProperty('--clean-pill', px + 'px'); }
      pillPx = px;
      let urgent = 0; for (let i = 0; i < queue.length; i++) urgent = Math.max(urgent, queue[i].s.urgency);
      for (const v of vis) {
        const { n, S, hy, st, group, cap, uniforms: u } = v, s = n.s, sh = v.sh;
        group.visible = s.alive > .002; v.live = s.alive > .5;
        if (!group.visible) {
          v.ao.visible = v.glow.visible = false; if (ch(sh, 0, 0)) shadowDirty = true;
          if (n.kind === 'session') updateCard(v, cards.get(n), dt);
          continue;
        }
        // Press: held under the pointer it bottoms out, and comes back with one crisp tick. Compacting holds it half down.
        st.press = spring(st.press, st.pv, Math.max(n.pressed ? 1 : 0, s.compact * .5), 1400, reduced ? 1 : .5, dt); st.pv = springV;
        st.pop = spring(st.pop, st.popv, (n.kind === 'you' ? queue.length > 0 : v.tile && needs(n)) ? 1 : 0, 500, reduced ? 1 : .6, dt); st.popv = springV;
        st.jolt = spring(st.jolt, st.jv, 0, 1100, .4, dt); st.jv = springV;
        // A new key drops onto the desk and lands with a knock.
        if (reduced) { if (st.y || st.vy) st.y = st.vy = 0; }
        else if (st.y > 0) { settling = true; st.vy -= 40 * dt; st.y += st.vy * dt; if (st.y <= 0) { st.pv += Math.min(16, -st.vy * 3); st.y = st.vy = 0; } }
        // The gauge fills as the window does, and drains visibly when the context is compacted.
        if (st.ctx !== n.ctx) {
          st.ctx = reduced ? n.ctx : n.ctx < st.ctx ? Math.max(n.ctx, st.ctx - dt * .5) : kit.damp(st.ctx, n.ctx, 4, dt);
          if (Math.abs(st.ctx - n.ctx) < .002) st.ctx = n.ctx; else settling = true;
        }

        const grow = kit.smoothstep(0, 1, s.alive), popc = kit.clamp(st.pop), press = kit.clamp(st.press, -.4, 1);
        const rest = (TRAVEL + s.hover * .06 + st.pop * POP + s.error * .1) * (1 - s.off);
        const travel = Math.max(0, rest * (1 - press)) * S;
        const gx = n.pos.x + st.jolt, scale = Math.max(.0001, grow), capY = BASE_H * S + travel, sq = 1 - .03 * kit.clamp(press), tilt = s.error * (v.tile ? .08 : .11);
        group.position.set(gx, st.y, n.pos.z);
        group.scale.setScalar(scale);
        cap.position.y = capY;
        v.body.scale.set(S * sq, S * hy, S * sq);
        cap.rotation.set(v.tile ? tilt : Math.cos(v.tilt) * tilt, 0, v.tile ? 0 : Math.sin(v.tilt) * tilt);
        // The keys are what cast the shadows: draw the map again only when one moved.
        if (ch(sh, 0, 1) | ch(sh, 1, gx) | ch(sh, 2, st.y) | ch(sh, 3, n.pos.z) | ch(sh, 4, scale) | ch(sh, 5, capY) | ch(sh, 6, sq) | ch(sh, 7, tilt)) shadowDirty = true;
        v.shaft.visible = travel > .002; v.shaft.scale.set(S, Math.max(travel, .0001), S);
        v.shaftMat.color.copy(SHAFT).lerp(amber, popc).lerp(red, s.error);
        v.shaftMat.emissive.copy(amber).lerp(red, Math.max(s.error, s.urgency * .5)); v.shaftMat.emissiveIntensity = popc * .55 + s.error * .3;
        v.top = st.y + (BASE_H * S + travel + H * S * hy) * grow;
        boxOf(v, n.pos.x, n.pos.z);
        v.mat.color.copy(v.color).lerp(OFFCAP, s.off).multiplyScalar(1 - .07 * kit.clamp(press));

        set(u.uPress, kit.clamp(press)); set(u.uWork, reduced ? s.work * .5 : s.work); set(u.uThink, s.think); set(u.uCompact, reduced ? 0 : s.compact); set(u.uNeed, s.need);
        set(u.uWait, s.wait); set(u.uError, s.error); set(u.uOff, s.off); set(u.uCtx, st.ctx); set(u.uUrg, n.kind === 'you' ? urgent : s.urgency);
        if (u.uFlash.value > 0) { u.uFlash.value = Math.max(0, u.uFlash.value - dt * 2.2); settling = true; }
        // How often this key's lamp wants a frame: the lamp's own loops while it's big enough on screen to see them move.
        const lively = v.tile ? Math.max(s.work, s.think, s.compact, s.need) > .01 : n.kind === 'you' && queue.length > 0;
        if ((lively || s.wait > .01) && !reduced) {
          const r = .6 * S * grow * pxu;
          if (r >= 2 && onScreen(gx + (v.tile ? lampX(v) : 0), v.top, n.pos.z)) { if (lively) loop = Math.max(loop, r < 5 ? 15 : 30); else ticking = true; }
        }
        if (n.kind === 'you') set(u.uCount, queue.length);
        if (v.tile) {
          statusMix(s, u.uCol.value);
          v.side = bank.get(n.project)?.sx ?? 1;
          v.lamp.position.x = -v.side * (v.sk.hx - .15 - LAMP);
          const sub = n.kind === 'sub', shows = sub ? legibleSub : legible, mat = shows ? v.textMat : v.blank;
          if (v.display.material !== mat) v.display.material = mat;
          if (shows) drawTile(v, sub ? zs : zr);
          if (n.kind === 'session') updateCard(v, cards.get(n), dt);
        }

        // On the desk: a tight contact shadow that spreads and fades as the key leaves it, and the collar's light.
        v.ao.visible = true; v.ao.position.set(gx, .004, n.pos.z); v.ao.scale.set(2 * v.sk.ex * S * grow * (1 + st.y * .5), 1, 2 * v.sk.ez * S * grow * (1 + st.y * .5));
        v.ao.material.opacity = K.ao[1] / (1 + st.y * 2.5);
        const want = popc * (.3 + s.urgency * .2) + s.error * .25;
        v.glow.visible = want > .01;
        if (v.glow.visible) {
          v.glow.position.set(gx, .006, n.pos.z); v.glow.scale.set(2 * v.sk.ex * S * grow, 1, 2.6 * v.sk.ez * S * grow);
          v.glow.material.color.copy(amber).lerp(red, Math.max(s.error, s.urgency * .5)); v.glow.material.opacity = want * s.alive * K.glow;
        }
      }
      // The labels' places, now every key's box is known: the pills first, then the names round them.
      // Names: the loud ones beside their keys first, then the pills round them, then the rest (see settle).
      pillN = 0; besideN = 0; besideQ.length = 0; boxDeck();
      for (const v of vis) {
        if (!v.tile) continue;
        v.rule = ruleFor(v);
        // A quiet subagent's name the board shows only up close (or not at all: placed last, it can't push another's off).
        if (v.rule === undefined && v.live && (v.n.kind === 'session' || v.n.hovered || v.n.selected || needs(v.n) || busy(v.n))) { v.rank = rankOf(v.n); besideQ.push(v); }
        else v.beside = false;
      }
      besideQ.sort(byRank);
      let q = 0;
      for (; q < besideQ.length && besideQ[q].rank >= 5; q++) settle(besideQ[q]);
      for (const v of vis) if (v.n.kind === 'project') { if (legible) v.pOn = false; else placePill(v); }
      for (; q < besideQ.length; q++) settle(besideQ[q]);
      let sel = null, hov = null;
      for (const v of vis) { if (v.n.selected) { if (!sel) sel = v; } else if (v.n.hovered && !hov) hov = v; }
      markOut(marks[0], sel, sel ? sel.n.s.select * .9 : 0); markOut(marks[1], hov, hov ? hov.n.s.hover * .35 : 0);

      for (const t of titles) {
        const b = bank.get(t.p), d = b?.title.dir;
        t.m.visible = !!b && legible && t.p.s.alive > .02;
        if (!t.m.visible) continue;
        if (t.dir !== d || t.fonts !== fontsReady) drawTitle(t, d);
        const k = byNode.get(t.p)?.group.scale.x ?? 1;
        t.m.position.set(t.p.pos.x + b.title.x * k + d * t.m.scale.x / 2, .01, t.p.pos.z + b.title.z * k);
        t.m.material.opacity = t.p.s.alive;
      }

      // Cables, and the beads riding them; a bead reaching a project carries on to You, and ticks each key it reaches.
      let bi = 0;
      for (const l of links) {
        const kid = l.child, pa = l.parent, alive = kid.n.s.alive * (pa.n.s.alive || 1);
        for (const p of l.pulses.update(dt)) {
          click(pa, 2.5 * p.strength);
          if (l.n.kind === 'session') linkOf.get(l.n.project).pulses.add(.75, .8, p.data);
          if (l.n.kind === 'sub') linkOf.get(l.n.parent).pulses.add(1.5, .8, p.data);
        }
        const A = kid.group.position, B = pa.group.position;
        // A tile's plug is the middle of its inner end; anything else plugs in on the side facing the other end.
        if (kid.tile) p0.set(A.x - kid.side * (kid.o.A + .06) * kid.S * kid.group.scale.x, 0, A.z); else p0.copy(A);
        // A subagent hangs off its session by an elbow: down from under the session's lamp, then across into its plug.
        if (kid.n.kind === 'sub' && pa.tile) {
          const bx = B.x + lampX(pa), bz = B.z + (pa.o.B + .06) * pa.S * pa.group.scale.x;
          if (p0.z - bz > .3) {
            l.mesh.visible = alive > .02;
            if (l.mesh.visible !== l.on) { l.on = l.mesh.visible; shadowDirty = true; }
            if (!l.mesh.visible) continue;
            l.k = Math.min(1, alive * 1.2);
            if (moved(l.last, p0.x, p0.z, bx, bz, 1, 1, l.k)) {
              l.a.copy(p0); l.b.set(bx, 0, bz); l.c.set(bx, 0, p0.z); l.len = Math.abs(p0.x - bx) + p0.z - bz;
              l.tube.update(l.point); shadowDirty = true;
            }
            if (l.pulses.list.length) pulsing = true;
            bi = beadsOn(l, bi);
            continue;
          }
        }
        let dx = B.x - p0.x, dz = B.z - p0.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        const ra = kid.tile ? 0 : reach(kid, dx, dz), rb = reach(pa, -dx, -dz);
        l.mesh.visible = alive > .02 && d > ra + rb + .1;
        if (l.mesh.visible !== l.on) { l.on = l.mesh.visible; shadowDirty = true; }
        if (!l.mesh.visible) continue;
        l.k = Math.min(1, alive * 1.2);
        if (moved(l.last, p0.x, p0.z, B.x, B.z, ra, rb, l.k)) {
          l.a.set(p0.x + dx * ra, 0, p0.z + dz * ra); l.b.set(B.x - dx * rb, 0, B.z - dz * rb); l.len = d - ra - rb;
          l.c.set((l.a.x + l.b.x) / 2 - dz * l.sgn * .04 * l.len, 0, (l.a.z + l.b.z) / 2 + dx * l.sgn * .04 * l.len);
          l.tube.update(l.point); shadowDirty = true;
        }
        if (l.pulses.list.length) pulsing = true;
        bi = beadsOn(l, bi);
      }
      upload(beads, bi);

      // Needs-you cords run out from the lamp as the key pops and reel back in when it's answered.
      let ci = 0;
      for (const c of cords) {
        const v = byNode.get(c.n), grow = kit.clamp(v.st.pop) * c.n.s.alive;
        c.mesh.visible = grow > .01;
        if (c.mesh.visible !== c.on) { c.on = c.mesh.visible; shadowDirty = true; }
        if (!c.mesh.visible) continue;
        const ax = v.group.position.x + lampX(v), az = v.n.pos.z, B = youV.group.position;
        let dx = B.x - ax, dz = B.z - az; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        if (moved(c.last, ax, az, v.top, B.x, B.z, youV.top, grow)) {
          const rb = reach(youV, -dx, -dz) * .74;
          c.a.set(ax, v.top, az); c.b.set(B.x - dx * rb, youV.top, B.z - dz * rb);
          c.sag = Math.min(.3, d * .012); c.L = c.a.distanceTo(c.b);
          c.tube.update(c.point, 0, grow); shadowDirty = true;
        }
        const urg = c.n.s.urgency;
        c.mat.color.copy(amber).lerp(red, urg * .35); c.mat.emissive.copy(c.mat.color);
        tmp.copy(pearlC).lerp(red, urg * .4);
        // The pearls slide on while any of the cord shows (an end, or its middle).
        if (!reduced) {
          c.ph += rdt * (.9 + urg * 1.8) / PEARL;
          const r = .12 * pxu;
          if (r >= 1 && loop < 30 && (onScreen(c.a.x, c.a.y, c.a.z) || onScreen(c.b.x, c.b.y, c.b.z) || onScreen((c.a.x + c.b.x) / 2, c.a.y, (c.a.z + c.b.z) / 2))) loop = Math.max(loop, r < 2.5 ? 15 : 30);
        }
        const m = Math.floor(c.L / PEARL), frac = c.ph % 1;
        for (let i = 0; i <= m && ci < 192; i++) {
          const t = (i + frac) * PEARL / c.L; if (t > grow) break;
          const k = Math.min(1, t * c.L / .4, (grow - t) * c.L / .4);
          c.point(t, pv); m4.compose(pv, q4, sv.setScalar(Math.max(.01, k))); pearls.setMatrixAt(ci, m4); pearls.setColorAt(ci, tmp); ci++;
        }
      }
      upload(pearls, ci);

      drawDeck();
      if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
      // Frames a second this wants: every frame while anything springs or fades; the lamps' and cords' loops while they show
      // (quarter speed when they're specks), beads at full; once a second for a wait hand; else none. Reduced motion: none but
      // what settles.
      lastPace = settling ? Infinity : reduced ? 0 : Math.max(loop, pulsing ? 60 : 0, ticking ? 1 : 0);
      return lastPace;
    }

    return { update, event, dispose() { const sceneEl = renderer.domElement.parentElement; sceneEl?.style.removeProperty('--clean-lines'); sceneEl?.style.removeProperty('--clean-pill'); bandTex.dispose(); for (const k of Object.values(kits)) { k.cap.dispose(); k.base.dispose(); k.shaft.dispose(); k.face.dispose(); k.ao.dispose(); } } };
  },
};
