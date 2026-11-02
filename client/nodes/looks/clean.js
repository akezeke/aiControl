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
  light: { bg: '#e8e7e2', dot: '#b9b7af', key: '#f7f6f2', off: '#dfddd7', housing: '#c4c2bb', shaft: '#6c6a64', cable: '#bdbab3', trunk: '#a19e97', top: '#fbfaf7', track: '#e2e0d9', ink: '#3a3c42',
    text: '#1d1f24', muted: '#6a6c72', need: '#9a5806', err: '#c8353a', you: '#2f4bff', youTop: '#2741e6', accent: '#2f4bff',
    hemi: ['#ffffff', '#cbc8c0', .55], sun: 2.2, fill: .35, env: .5, shade: ['#2a2418', .2], ao: ['#2a2418', .3], glow: .9, tint: .62, wire: .5 },
  dark: { bg: '#15171c', dot: '#30343d', key: '#30343c', off: '#24272d', housing: '#0b0c0f', shaft: '#040506', cable: '#3d424c', trunk: '#4c525d', top: '#1e2127', track: '#343843', ink: '#cfd3da',
    text: '#eceef2', muted: '#9aa0ab', need: '#f5a524', err: '#ff6b6f', you: '#4a62ff', youTop: '#3a52ee', accent: '#7f91ff',
    hemi: ['#d2d9ff', '#07080a', .5], sun: 1.7, fill: .25, env: .35, shade: ['#000000', .45], ao: ['#000000', .5], glow: .3, tint: .58, wire: .6 },
};
// Outlines in S units, as a radius along each angle: a squircle key for You, a round junction for a project,
// rounded-rectangle tiles for sessions and subagents, and a screen-shaped one for a session's screenshots.
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
  session: { r: roundRect(4.4, 1, .5), A: 4.4, B: 1 },
  sub: { r: roundRect(3.8, 1, .5), A: 3.8, B: 1 },
  shot: { r: roundRect(1.6, 1, .5), A: 1.6, B: 1 },
};
// World size per kind (S), and cap height. Sessions are the bodies to look at; projects are low junctions, big enough to press.
const SCALE = { you: 1.56, project: .78, session: 1.25, sub: .88 }, TALL = { you: 1.3, project: .6, session: .8, sub: .8 };
const H = .42, FACE_R = .78, DISH = .016, LAMP = .62; // cap height and display inset at scale 1; a tile's status lamp radius
const BASE_H = .07, TRAVEL = .15, POP = .5;           // housing height; how far a cap stands proud at rest, and when it needs you
const PEARL = 1.1, PX = 100;                           // world units between beads on a needs-you cord; canvas pixels per world unit
// The usage console: a column per account, the sloped face's length and slope, the lip under it, and the depth it takes on the desk.
const COL = 2.6, LEN = 3.4, SLOPE = .35, LIP = .14, DD = LEN * Math.cos(SLOPE);
// A screenshot key's half length and the lead to it; how far up the screen a raised key reaches, in desk units.
const SHOT_HALF = (OUTLINE.shot.A + .1) * SCALE.session, SHOT_GAP = .55, LIFT = .7;
const needs = n => n.status === 'permission' || n.status === 'question', busy = n => n.status === 'working' || n.status === 'thinking' || n.status === 'compacting';
// Per node, across rebuilds (the look is built again whenever sessions come or go): press, pop, height, gauge.
const keep = new WeakMap();

const FACE_FRAG = /* glsl */`
uniform float uKind, uTime, uAnim, uWork, uThink, uCompact, uNeed, uWait, uError, uOff, uCtx, uProv, uMode, uCount, uUrg, uPress, uSides, uP, uRot, uFlash;
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
    // Waiting: a clock hand that ticks once a second.
    float ha = (floor(uTime) + smoothstep(0., .12, fract(uTime))) * TAU / 12.; vec2 hd = vec2(sin(ha), cos(ha)); float hp = clamp(dot(p, hd), 0., .44);
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
function crosses(ax, az, bx, bz, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (!p) { if (q < 0) return false; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
// A project's name as printed on the desk: its canvas width in pixels (TPX to a world unit) at 84 high.
const TPX = 95, TITLE_FONT = '600 60px "Geist Mono", ui-monospace, monospace';
const measure = document.createElement('canvas').getContext('2d');
const titleW = name => { measure.font = TITLE_FONT; return Math.ceil(measure.measureText(name.toUpperCase()).width) + 24; };

// Longest prefix of text that fits in w, with an ellipsis.
function fit(g, text, w) {
  if (g.measureText(text).width <= w) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(text.slice(0, mid) + '…').width <= w) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}

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
body[data-look="clean"] .lbl { padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--panel) 88%, transparent); box-shadow: 0 1px 0 var(--edge); text-shadow: none; }
body[data-look="clean"] .lbl.project b { font: 500 11px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
body[data-look="clean"] .lbl.you b { font: 500 12px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
body[data-look="clean"] .lbl span { font-size: 10.5px; }
body[data-look="clean"] .lbl.on { padding: 0; background: none; box-shadow: none; }
body[data-look="clean"] .lbl.sub:not(.on) { padding: 0 2px; background: none; box-shadow: none; text-shadow: 0 0 4px var(--label-halo), 0 0 2px var(--label-halo); }
body[data-look="clean"] .lbl.sub b { font-size: 10.5px; }
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
    // Pick radii: a tile is picked over most of its length; the column's pitch keeps neighbours apart.
    ctx.setSizes({ you: 1.7, project: .9, session: 4.6, sub: 3 });
    let shotCount = 0;

    // Layout: projects where the world puts them, a little closer in; each project's sessions banked in a column off its
    // junction, each session's subagents just below it, indented. Wide screens bank to the side away from You, centred on
    // the junction; tall ones bank downwards (upwards above You) from the junction, so the board stays narrow. Then, nearest
    // You first, each project with its bank, screenshot keys and name moves straight out from You until it's clear of You, the
    // usage console and the projects already placed, so no two keys ever overlap.
    const bank = new Map(), planned = new Map(), deckAt = new THREE.Vector3(), frameBoxes = [];
    let planCols = 0;
    const tileW = k => 2 * (OUTLINE[k].A + .1) * SCALE[k], tileH = k => 2 * (OUTLINE[k].B + .1) * SCALE[k];
    const usageCols = () => Math.min(5, world.usage.filter(a => a.windows.length || a.spend).length) + 1;
    const overlaps = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
    function plan() {
      const tall = ctx.size.w / ctx.size.h < .8, you = world.you.rest, MARGIN = .6, R = SCALE.project * 1.15 + .3;
      planned.clear(); bank.clear(); frameBoxes.length = 0;
      const clusters = world.projects.map(p => {
        const x = p.rest.x * (tall ? .3 : .9), z = p.rest.z * (tall ? 1 : .9);
        const sx = tall || x >= you.x ? 1 : -1, inner = sx * (tall ? 1.1 : 1.8), rows = [];
        for (const s of p.sessions) { rows.push([s, tileH('session') + .5]); for (const k of s.subs) rows.push([k, tileH('sub') + .4]); }
        const total = rows.reduce((t, [, h]) => t + h, 0), at = new Map(), box = [-R, -R - LIFT, R, R];
        let rz = !tall ? -total / 2 : z >= you.z ? 1.3 : -1.3 - total;
        for (const [m, h] of rows) {
          const w = tileW(m.kind), cx = inner + sx * ((m.kind === 'sub' ? 1.3 : 0) + w / 2), cz = rz + h / 2, th = tileH(m.kind) / 2;
          at.set(m, [cx, cz]);
          const far = cx + sx * (w / 2 + (m.kind === 'session' && ctx.shot(m) ? SHOT_GAP + 2 * SHOT_HALF : 0));
          box[0] = Math.min(box[0], cx - sx * w / 2, far); box[2] = Math.max(box[2], cx - sx * w / 2, far);
          box[1] = Math.min(box[1], cz - th - LIFT); box[3] = Math.max(box[3], cz + th);
          rz += h;
        }
        return { p, x, z, sx, at, box };
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
      const yr = SCALE.you * 1.2 + .3, taken = [[you.x - yr, you.z - yr - LIFT, you.x + yr, you.z + yr], [deckAt.x - dw / 2, deckAt.z - DD / 2 - 1, deckAt.x + dw / 2, deckAt.z + DD / 2]];
      frameBoxes.push(taken[1]);
      clusters.sort((a, b) => Math.hypot(a.x - you.x, a.z - you.z) - Math.hypot(b.x - you.x, b.z - you.z));
      for (const c of clusters) {
        const d = Math.hypot(c.x - you.x, c.z - you.z), ux = d > 1e-3 ? (c.x - you.x) / d : 1, uz = d > 1e-3 ? (c.z - you.z) / d : 0;
        let x = c.x, z = c.z, title = null, tbox = null, cbox = null;
        for (let step = 0; step < 300; step++) {
          x = c.x + ux * step * .35; z = c.z + uz * step * .35;
          title = titleSpot(c.p.name, x, z, -c.sx);
          const tx = x + title.x, tx1 = tx + title.dir * title.w;
          tbox = [Math.min(tx, tx1), z + title.z - title.h / 2, Math.max(tx, tx1), z + title.z + title.h / 2];
          cbox = [x + c.box[0], z + c.box[1], x + c.box[2], z + c.box[3]];
          if (!taken.some(t => overlaps(cbox, t, MARGIN) || overlaps(tbox, t, MARGIN))) break;
        }
        taken.push(cbox, tbox); frameBoxes.push(cbox, tbox);
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
      const w = titleW(name) / TPX, h = 84 / TPX, R = SCALE.project * 1.15 + .3, y = world.you.rest, yr = SCALE.you * 1.5;
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
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(renderer), env = pmrem.fromScene(new RoomEnvironment(), .04);
    scene.environment = env.texture; scene.environmentIntensity = K.env;

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
    }
    fitShadow(); ctx.onResize(fitShadow);

    // The desk: a mat with a fine grid of crosses under a lamp, plus a shadow catcher.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShaderMaterial({
      uniforms: { uBg: { value: bg }, uDot: { value: C(K.dot) } },
      vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uBg, uDot; varying vec2 vP;
        void main(){ vec2 g = abs((fract(vP / 1.5 - .5) - .5) * 1.5); float aa = fwidth(vP.x) * .8, r = length(vP - vec2(0., 2.));
          float cross = max((1. - smoothstep(.012 - aa, .012 + aa, g.x)) * step(g.y, .1), (1. - smoothstep(.012 - aa, .012 + aa, g.y)) * step(g.x, .1));
          gl_FragColor = vec4(mix(uBg, uDot, .75 * cross * (1. - smoothstep(24., 60., r))) * (1. - .08 * smoothstep(16., 70., r)), 1.); }`,
    }));
    floor.rotation.x = -Math.PI / 2; root.add(floor);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: K.shade[0], opacity: K.shade[1] }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = .002; catcher.receiveShadow = true; root.add(catcher);

    const kits = Object.fromEntries(Object.entries(OUTLINE).map(([k, o]) => [k, shapeKit(THREE, kit, o)]));
    const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), lampGeo = new THREE.CircleGeometry(LAMP, 64).rotateX(-Math.PI / 2);
    const glowTex = kit.glowTexture([[0, 'rgba(255,255,255,1)'], [.4, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]);
    const shared = { uTop: C(K.top), uTrack: C(K.track), uInk: C(K.ink), uAccent: C(K.accent), uAmber: C(PAL.need), uRed: C(PAL.error), uGreen: C(PAL.work), uBlue: C(PAL.wait) };
    const baseMat = new THREE.MeshStandardMaterial({ color: K.housing, roughness: .7 });
    const blankMat = new THREE.MeshBasicMaterial({ color: K.top, polygonOffset: true, polygonOffsetFactor: -1 });
    const SHAFT = C(K.shaft), OFFCAP = C(K.off), amber = C(PAL.need), red = C(PAL.error), aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const hue = n => C(PROJ[n.project.index % PROJ.length]);
    const canvasTex = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
    let fontsReady = false;
    Promise.all(['600 20px Geist', '500 20px "Geist Mono"'].map(f => document.fonts?.load(f))).then(() => { fontsReady = true; }, () => {});

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
      const color = kind === 'you' ? C(K.you) : kind === 'project' ? C(K.key).lerp(hue(n), K.tint) : C(K.key);
      const mat = new THREE.MeshPhysicalMaterial({ color, roughness: kind === 'you' ? .4 : .52, clearcoat: .2, clearcoatRoughness: .45, sheen: .15, sheenRoughness: .8, sheenColor: '#ffffff', envMapIntensity: .9 });
      const body = new THREE.Mesh(sk.cap, mat); body.castShadow = true; body.scale.set(S, S * hy, S); cap.add(body);
      const uniforms = { uKind: { value: { session: 0, sub: 1, project: 2, you: 3 }[kind] }, uTime: { value: 0 }, uAnim: { value: 1 }, uWork: { value: 0 }, uThink: { value: 0 }, uCompact: { value: 0 },
        uNeed: { value: 0 }, uWait: { value: 0 }, uError: { value: 0 }, uOff: { value: 0 }, uCtx: { value: 0 }, uProv: { value: { claude: 0, codex: 1, opencode: 2 }[n.provider] ?? 0 },
        uMode: { value: n.mode === 'plan' ? 1 : n.mode === 'bypass' ? 2 : 0 }, uCount: { value: 0 }, uUrg: { value: 0 }, uPress: { value: 0 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color() },
        uSides: { value: tile ? 0 : o.sides }, uP: { value: o.p || 2 }, uRot: { value: o.rot || 0 },
        uCol: { value: new THREE.Color() }, uProj: { value: kind === 'project' ? hue(n) : C(K.ink) } };
      for (const k in shared) uniforms[k] = { value: shared[k] };
      if (kind === 'you') uniforms.uTop = { value: C(K.youTop) };
      const faceMat = new THREE.ShaderMaterial({ uniforms, vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, polygonOffset: true, polygonOffsetFactor: -1 });
      const v = { n, S, hy, o, sk, st, tile, group, shaft, shaftMat, cap, body, mat, color, uniforms, top: 0, tilt: (n.seed % 628) / 100, side: 1, textKey: '' };
      if (tile) {
        v.tex = canvasTex(Math.round(2 * sk.hx * S * PX), Math.round(2 * sk.hz * S * PX));
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

    // Labels: the keys and the desk carry their own text. When that's too small to read, it goes blank and the board's labels take
    // over: a key's name on the key while it's deep enough to hold one, else beside it; a project's name where it was on the desk.
    let legible = true;
    const onFit = { session: false, sub: false };
    ctx.setLabelRule(n => legible || n.kind === 'you' ? false : onFit[n.kind] ? 'on' : undefined);
    ctx.setLabelAnchor((n, out, on) => {
      const v = byNode.get(n), k = v?.group.scale.x ?? 1, b = n.kind === 'project' && bank.get(n);
      out.y = 0;
      if (v?.tile) { if (on) { out.x += v.side * .69 * v.S * k; out.y = v.top; } else out.z += ((v.o.B + .1) * v.S + .15) * k; }
      else if (b) { out.x += (b.title.x + b.title.dir * b.title.w / 2) * k; out.z += b.title.z * k - b.title.h / 2; }
      else out.z += { you: 2.3, project: 1.35 }[n.kind] || 1;
    });
    // Footprints, for picking and for keeping labels off keys: a tile's whole face, a round key's square.
    ctx.setShape(n => {
      const v = byNode.get(n); if (!v) return null;
      const f = v.foot || (v.foot = { hx: 0, hz: 0, y: 0, tw: 0 }), k = v.group.scale.x;
      if (v.tile) { f.hx = (v.o.A + .1) * v.S * k; f.hz = (v.o.B + .1) * v.S * k; f.tw = (2 * v.sk.hx - 1.7) * v.S * k; }
      else { f.hx = f.hz = 1.05 * v.S * k; f.tw = 2 * f.hx; }
      f.y = v.top; return f;
    });

    // A project's name, printed on the desk beside its junction (see titleSpot).
    const titles = world.projects.map(p => {
      const w = titleW(p.name), tex = canvasTex(w, 84);
      const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.scale.set(w / TPX, 1, 84 / TPX); m.renderOrder = -1; root.add(m);
      return { p, m, tex, text: p.name.toUpperCase(), w, drawn: null };
    });
    function drawTitle(t, dir) {
      const g = t.tex.image.getContext('2d'), h = t.tex.image.height;
      g.clearRect(0, 0, t.w, h); g.font = TITLE_FONT; g.fillStyle = K.text; g.globalAlpha = .85; g.textBaseline = 'middle';
      g.textAlign = dir > 0 ? 'left' : 'right'; g.fillText(t.text, dir > 0 ? 6 : t.w - 6, h / 2 + 3); g.globalAlpha = 1;
      t.tex.needsUpdate = true; t.drawn = `${fontsReady}${dir}`;
    }
    // A tile's text: the name in bold, what it's doing in mono below (amber when it needs you), plan steps as pips.
    const lineOf = n => needs(n) ? `${n.text} · ${kit.fmtWait(n.waitSec)}` : n.text;
    function drawTile(v) {
      const n = v.n, line = lineOf(n), key = [n.name, line, n.status, n.plan?.done, n.plan?.total, v.side, fontsReady].join('|');
      if (key === v.textKey) return;
      v.textKey = key;
      const cv = v.tex.image, g = cv.getContext('2d'), W = cv.width, h = cv.height, px = W / (2 * v.sk.hx), lampW = (2 * LAMP + .3) * px, pad = .16 * px;
      const x0 = v.side > 0 ? lampW : pad, x1 = v.side > 0 ? W - pad : W - lampW, sub = n.kind === 'sub';
      const col = needs(n) ? K.need : n.status === 'error' ? K.err : n.status === 'idle' || n.status === 'offline' ? K.muted : K.ink;
      g.fillStyle = K.top; g.fillRect(0, 0, W, h); g.textBaseline = 'alphabetic';
      if (sub) {
        g.font = `600 ${h * .4}px Geist, system-ui, sans-serif`; g.fillStyle = K.text;
        const name = fit(g, n.name, (x1 - x0) * .55); g.fillText(name, x0, h * .64);
        const nx = x0 + g.measureText(name).width + h * .2;
        g.font = `500 ${h * .32}px "Geist Mono", ui-monospace, monospace`; g.fillStyle = col; g.fillText(fit(g, line, x1 - nx), nx, h * .64);
      } else {
        g.font = `600 ${h * .36}px Geist, system-ui, sans-serif`; g.fillStyle = n.status === 'offline' ? K.muted : K.text; g.fillText(fit(g, n.name, x1 - x0), x0, h * .45);
        let end = x1;
        if (n.plan) {
          const t = n.plan.total, d = h * .12, gap = h * .05, pw = t * (d + gap);
          if (pw < (x1 - x0) * .35) {
            end = x1 - pw - h * .1;
            for (let i = 0; i < t; i++) { g.fillStyle = i < n.plan.done ? K.ink : K.track; g.fillRect(x1 - pw + i * (d + gap) + gap, h * .82 - d, d, d); }
          }
        }
        g.font = `500 ${h * .26}px "Geist Mono", ui-monospace, monospace`; g.fillStyle = col; g.fillText(fit(g, line, end - x0), x0, h * .82);
      }
      v.tex.needsUpdate = true;
    }

    // Cables: child → parent, lying on the desk in a gentle, fixed curve, a little thicker at the plugs, in the project's
    // colour (the trunk to You is plain). A tile's cable plugs into the end nearest its junction. Tool pulses ride them as beads.
    const trunkMat = new THREE.MeshStandardMaterial({ color: K.trunk, roughness: .75 }), wireMats = new Map();
    const wireMat = p => wireMats.get(p) || wireMats.set(p, new THREE.MeshStandardMaterial({ color: C(K.cable).lerp(hue(p), K.wire), roughness: .75 })).get(p);
    const links = world.nodes.filter(n => n.kind !== 'you').map(n => {
      const link = { n, child: byNode.get(n), parent: byNode.get(n.kind === 'project' ? world.you : n.parent), r: { project: .085, session: .06, sub: .04 }[n.kind], k: 1,
        a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), len: 1, sgn: n.seed % 2 ? 1 : -1, last: [], pulses: new kit.Pulses() };
      link.radius = t => link.r * link.k * (1 + .5 * (1 - kit.smoothstep(.06, .32, Math.min(t, 1 - t) * link.len)));
      link.point = (t, out) => { kit.bezier(link.a, link.c, link.b, t, out); out.y = link.radius(t); return out; };
      link.tube = new kit.Tube({ segments: 22, radial: 7, radius: link.radius });
      link.mesh = new THREE.Mesh(link.tube.geometry, n.kind === 'project' ? trunkMat : wireMat(n.project)); link.mesh.castShadow = true; link.mesh.frustumCulled = false; root.add(link.mesh);
      return link;
    });
    const linkOf = new Map(links.map(l => [l.n, l]));
    // Rebuild a tube only when what shapes it moved; at rest the board does no geometry work.
    function moved(last, ...xs) { let d = false; for (let i = 0; i < xs.length; i++) if (!(Math.abs(xs[i] - last[i]) < 1e-4)) { d = true; last[i] = xs[i]; } return d; }
    // How far a node's housing reaches towards (dx, dz), and where a tile's lamp sits along it.
    const reach = (v, dx, dz) => v.S * (v.o.r(Math.atan2(dz, dx)) + .06) * v.group.scale.x;
    const lampX = v => -v.side * (v.sk.hx - .15 - LAMP) * v.S * v.group.scale.x;

    // Needs-you cords: a taut amber wire strung from the popped key's lamp to You, high enough to clear what's between, with
    // beads sliding along it towards You (quicker as the wait grows).
    const cords = world.sessions.map(n => {
      const cord = { n, a: new THREE.Vector3(), b: new THREE.Vector3(), sag: 0, L: 1, ph: (n.seed % 97) / 97, last: [] };
      cord.tube = new kit.Tube({ segments: 40, radial: 6, radius: () => .055 });
      cord.mat = new THREE.MeshStandardMaterial({ color: PAL.need, emissive: PAL.need, emissiveIntensity: .25, roughness: .4 });
      cord.mesh = new THREE.Mesh(cord.tube.geometry, cord.mat); cord.mesh.castShadow = true; cord.mesh.frustumCulled = false; cord.mesh.visible = false; root.add(cord.mesh);
      cord.point = (t, out) => { out.lerpVectors(cord.a, cord.b, t).y -= 4 * t * (1 - t) * cord.sag; return out; };
      return cord;
    });

    const instanced = (geo, mat, count, shadow) => { const m = new THREE.InstancedMesh(geo, mat, count); m.castShadow = shadow; m.count = 0; m.frustumCulled = false; m.setColorAt(0, bg); root.add(m); return m; };
    const beads = instanced(new THREE.SphereGeometry(.12, 14, 10), new THREE.MeshStandardMaterial({ roughness: .35 }), 96, true);
    const pearls = instanced(new THREE.SphereGeometry(.12, 12, 8), new THREE.MeshStandardMaterial({ roughness: .3, emissive: '#ffb02e', emissiveIntensity: .3 }), 192, true);

    // Selection: crop marks at a key's four corners. Hover: the same, faint.
    const markTex = kit.canvasTexture(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s * .12); g.fillRect(0, 0, s * .12, s); });
    const marks = [K.accent, K.ink].map(color => {
      const mat = new THREE.MeshBasicMaterial({ map: markTex, color, transparent: true, depthWrite: false, opacity: 0 });
      return [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(planeGeo, mat); m.scale.setScalar(.7); m.visible = false; root.add(m); return m; });
    });
    function markOut(set, v, amount) {
      const on = !!v && amount > .01;
      set.forEach((m, i) => {
        m.visible = on; if (!on) return;
        const sx = i === 1 || i === 2 ? 1 : -1, sz = i >= 2 ? 1 : -1, hx = (v.tile ? v.o.A + .35 : 1.4) * v.S, hz = (v.tile ? 1.35 : 1.4) * v.S;
        m.position.set(v.group.position.x + sx * (hx - .35), .008, v.n.pos.z + sz * (hz - .35)); m.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][i]; m.material.opacity = amount;
      });
    }

    // Usage: a low console beside You. Its sloped display reads YOU and how many are waiting, then a ring gauge per account
    // (outer ring its longest window, inner its shortest, the fuller one's percent in the middle) and one for spend. It
    // stands in the widest gap round You, so no cable runs under it, and redraws only when a number changes.
    const standMat = new THREE.MeshPhysicalMaterial({ color: K.key, roughness: .55, clearcoat: .2, clearcoatRoughness: .45 });
    const deck = new THREE.Group(), deckBody = new THREE.Mesh(new THREE.BufferGeometry(), standMat), deckFace = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    deckBody.castShadow = true; onSlope(THREE, deckFace, LEN, SLOPE, LIP);
    deck.add(deckBody, deckFace); root.add(deck);
    let deckCols = 0, deckSig = '', deckW = 0;
    const pct = v => `${Math.round(v * 100)}%`, fillCol = v => v > .9 ? PAL.error : v > .7 ? K.accent : K.ink, mono = (px, w = 500) => `${w} ${px}px "Geist Mono", ui-monospace, monospace`;
    function drawDeck() {
      const list = world.usage.filter(a => a.windows.length || a.spend).slice(0, 5), q = world.queue().length;
      const sig = JSON.stringify([q, fontsReady, list.map(a => [a.label, a.windows.map(w => [w.label, Math.round(w.used * 100)]), a.spend && [Math.round(a.spend.spent), a.spend.limit]])]);
      if (sig === deckSig) return;
      deckSig = sig;
      if (list.length + 1 !== deckCols) {
        deckCols = list.length + 1; deckW = deckCols * COL + .3;
        deckBody.geometry.dispose(); deckBody.geometry = wedge(THREE, deckW, LEN, SLOPE, LIP);
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
    const shotMat = new THREE.MeshPhysicalMaterial({ color: K.key, roughness: .52, clearcoat: .2, clearcoatRoughness: .45, sheen: .15, sheenRoughness: .8, sheenColor: '#ffffff', envMapIntensity: .9 });
    const shotShaft = new THREE.MeshStandardMaterial({ color: SHAFT, roughness: .45 }), leadGeo = new THREE.CylinderGeometry(.06, .06, 1, 10).rotateZ(Math.PI / 2);
    const cards = new Map(world.sessions.map(n => { const t = ctx.addTarget({ node: n, pos: new THREE.Vector3(), radius: 2, hx: SHOT_HALF, hz: (OUTLINE.shot.B + .1) * SS, action: 'shots' }); return [n, { t, pos: t.pos, group: null, shot: null, lift: 0 }]; }));
    ctx.setFrame(add => { for (const b of frameBoxes) { add(b[0], b[1], 0); add(b[2], b[3], 0); } });
    function drawCard(c, shot) {
      const cv = c.tex.image, g = cv.getContext('2d'), W = cv.width, h = cv.height, m = 12, r = 16, b = shot.bitmap;
      // A dark screen fills the face, so a tall phone shot still reads as a display rather than a sliver on a blank key.
      g.fillStyle = K.top; g.fillRect(0, 0, W, h);
      g.save(); g.beginPath(); g.roundRect(m, m, W - 2 * m, h - 2 * m, r); g.clip(); g.fillStyle = '#16191f'; g.fillRect(m, m, W - 2 * m, h - 2 * m);
      const k = Math.min((W - 2 * m) / b.width, (h - 2 * m) / b.height), iw = b.width * k, ih = b.height * k;
      g.drawImage(b, (W - iw) / 2, (h - ih) / 2, iw, ih); g.restore();
      g.strokeStyle = K.track; g.lineWidth = 3; g.beginPath(); g.roundRect(m, m, W - 2 * m, h - 2 * m, r); g.stroke();
      const bx = W - m - 32, by = m + 32;
      g.fillStyle = K.top; g.beginPath(); g.arc(bx, by, 28, 0, Math.PI * 2); g.fill();
      g.fillStyle = K.accent; g.beginPath(); g.arc(bx, by, 23, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = mono(28, 600); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(shot.count), bx, by + 1);
      c.tex.needsUpdate = true;
    }
    function updateCard(v, c, dt) {
      const shot = v.n.s.alive > .02 ? ctx.shot(v.n) : null;
      if (!shot) { if (c.group) c.group.visible = c.ao.visible = c.lead.visible = false; return; }
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
      c.lift = ctx.reduced ? +!!c.t.hovered : kit.damp(c.lift, c.t.hovered ? 1 : 0, 14, dt);
      const travel = (TRAVEL + c.lift * .08) * SS;
      c.group.visible = c.ao.visible = c.lead.visible = true;
      c.group.position.set(x, 0, z); c.group.scale.setScalar(k);
      c.cap.position.y = BASE_H * SS + travel; c.shaft.scale.set(SS, travel, SS);
      c.ao.position.set(x, .004, z); c.ao.scale.set(2 * SK.ex * SS * k, 1, 2 * SK.ez * SS * k);
      c.lead.position.set(v.group.position.x + v.side * (end + SHOT_GAP * k / 2), .06, z); c.lead.scale.set(SHOT_GAP * k + .2, 1, 1);
      c.pos.set(x, .6, z);
    }

    const toolCol = Object.fromEntries(Object.entries(TOOL).map(([k, v]) => [k, C(v)]));
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), tmp = new THREE.Color(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();

    // A damped spring stepped finely, so stiff ones stay stable at low frame rates.
    function spring(o, x, v, goal, k, zeta, dt) {
      const c = 2 * Math.sqrt(k) * zeta, steps = Math.min(16, Math.ceil(dt * 240)), h = steps ? dt / steps : 0;
      for (let i = 0; i < steps; i++) { o[v] += ((goal - o[x]) * k - o[v] * c) * h; o[x] += o[v] * h; }
    }
    // A click: the cap dips and comes back. A flash: the lamp lights in a colour for a moment.
    const click = (v, amt) => { if (!ctx.reduced) v.st.pv += amt; };
    const flash = (v, color) => { if (ctx.reduced) return; v.uniforms.uFlash.value = 1; v.uniforms.uFlashCol.value.set(color); };
    function event(type, n, data) {
      const v = byNode.get(n); if (!v) return;
      // Only real work sends beads up the cable; idle, waiting and offline keys stay quiet.
      if (type === 'tool') { if (!busy(n)) return; click(v, 3); if (!ctx.reduced) linkOf.get(n)?.pulses.add(n.kind === 'sub' ? 2.4 : 1.5, 1, toolCol[data.kind] || toolCol['']); }
      else if (type === 'spawn') { if (!ctx.reduced) { v.st.y = 1.1; v.st.vy = 0; } }
      else if (type === 'finish') { flash(v, PAL.work); click(v, 14); }
      else if (type === 'answer') flash(v, PAL.work);
      else if (type === 'compacted') { flash(v, PAL.compact); click(v, 10); }
      else if (type === 'state' && data.to === 'error') { flash(v, PAL.error); if (!ctx.reduced) v.st.jv += 3.5; }
    }

    function update(dt, time) {
      const reduced = ctx.reduced, queue = world.queue(), youV = byNode.get(world.you);
      // A screenshot key sticks out past its session's key: plan the board again when one comes.
      let shotNow = 0; for (const n of world.sessions) if (ctx.shot(n)) shotNow++;
      if (shotNow !== shotCount) { shotCount = shotNow; ctx.setLayout(layout); }
      deck.position.set(deckAt.x, 0, deckAt.z);
      // How big a tile's name prints on screen right now, and whether a label's line of text (about 14px) fits on a key's display.
      p0.copy(world.you.pos).project(camera); p1.copy(world.you.pos).setX(world.you.pos.x + 1).project(camera);
      legible = Math.abs(p1.x - p0.x) * ctx.size.w / 2 * .36 * 2 * kits.session.hz * SCALE.session >= 8.5;
      p1.copy(world.you.pos).setZ(world.you.pos.z + 1).project(camera);
      const deep = Math.abs(p1.y - p0.y) * ctx.size.h / 2 * 2;
      // A subagent's key takes its smaller name (10.5px, css) from a shallower depth.
      for (const k in onFit) onFit[k] = deep * kits[k].hz * SCALE[k] >= (k === 'sub' ? 10 : 14);
      for (const v of vis) {
        const { n, S, hy, st, group, cap, uniforms: u } = v, s = n.s;
        group.visible = s.alive > .002;
        if (!group.visible) { v.ao.visible = v.glow.visible = false; if (n.kind === 'session') updateCard(v, cards.get(n), dt); continue; }
        // Press: held under the pointer it bottoms out, and comes back with one crisp tick. Compacting holds it half down.
        spring(st, 'press', 'pv', Math.max(n.pressed ? 1 : 0, s.compact * .5), 1400, reduced ? 1 : .5, dt);
        spring(st, 'pop', 'popv', (n.kind === 'you' ? queue.length > 0 : v.tile && needs(n)) ? 1 : 0, 500, reduced ? 1 : .6, dt);
        spring(st, 'jolt', 'jv', 0, 1100, .4, dt);
        // A new key drops onto the desk and lands with a knock.
        if (reduced) st.y = st.vy = 0;
        else if (st.y > 0) { st.vy -= 40 * dt; st.y += st.vy * dt; if (st.y <= 0) { st.pv += Math.min(16, -st.vy * 3); st.y = st.vy = 0; } }
        // The gauge fills as the window does, and drains visibly when the context is compacted.
        st.ctx = reduced ? n.ctx : n.ctx < st.ctx ? Math.max(n.ctx, st.ctx - dt * .5) : kit.damp(st.ctx, n.ctx, 4, dt);

        const grow = kit.smoothstep(0, 1, s.alive), popc = kit.clamp(st.pop), press = kit.clamp(st.press, -.4, 1);
        const rest = (TRAVEL + s.hover * .06 + st.pop * POP + s.error * .1) * (1 - s.off);
        const travel = Math.max(0, rest * (1 - press)) * S;
        group.position.set(n.pos.x + st.jolt, st.y, n.pos.z);
        group.scale.setScalar(Math.max(.0001, grow));
        cap.position.y = BASE_H * S + travel;
        const sq = 1 - .03 * kit.clamp(press); v.body.scale.set(S * sq, S * hy, S * sq);
        const tilt = s.error * (v.tile ? .08 : .11); cap.rotation.set(v.tile ? tilt : Math.cos(v.tilt) * tilt, 0, v.tile ? 0 : Math.sin(v.tilt) * tilt);
        v.shaft.visible = travel > .002; v.shaft.scale.set(S, Math.max(travel, .0001), S);
        v.shaftMat.color.copy(SHAFT).lerp(amber, popc).lerp(red, s.error);
        v.shaftMat.emissive.copy(amber).lerp(red, Math.max(s.error, s.urgency * .5)); v.shaftMat.emissiveIntensity = popc * .55 + s.error * .3;
        v.top = st.y + (BASE_H * S + travel + H * S * hy) * grow;
        v.mat.color.copy(v.color).lerp(OFFCAP, s.off).multiplyScalar(1 - .07 * kit.clamp(press));

        u.uTime.value = reduced ? 0 : time; u.uAnim.value = reduced ? 0 : 1; u.uPress.value = kit.clamp(press);
        u.uWork.value = reduced ? s.work * .5 : s.work; u.uThink.value = s.think; u.uCompact.value = reduced ? 0 : s.compact; u.uNeed.value = s.need;
        u.uWait.value = s.wait; u.uError.value = s.error; u.uOff.value = s.off; u.uCtx.value = st.ctx; u.uUrg.value = s.urgency;
        u.uFlash.value = Math.max(0, u.uFlash.value - dt * 2.2);
        if (v.tile) {
          kit.statusColor(n, PAL, u.uCol.value);
          v.side = bank.get(n.project)?.sx ?? 1;
          v.lamp.position.x = -v.side * (v.sk.hx - .15 - LAMP);
          const mat = legible ? v.textMat : blankMat;
          if (v.display.material !== mat) v.display.material = mat;
          if (legible) drawTile(v);
          if (n.kind === 'session') updateCard(v, cards.get(n), dt);
        }
        if (n.kind === 'you') { u.uCount.value = queue.length; u.uUrg.value = queue.reduce((m, x) => Math.max(m, x.s.urgency), 0); }

        // On the desk: a tight contact shadow that spreads and fades as the key leaves it, and the collar's light.
        v.ao.visible = true; v.ao.position.set(group.position.x, .004, n.pos.z); v.ao.scale.set(2 * v.sk.ex * S * grow * (1 + st.y * .5), 1, 2 * v.sk.ez * S * grow * (1 + st.y * .5));
        v.ao.material.opacity = K.ao[1] / (1 + st.y * 2.5);
        const want = popc * (.3 + s.urgency * .2) + s.error * .25;
        v.glow.visible = want > .01;
        if (v.glow.visible) {
          v.glow.position.set(group.position.x, .006, n.pos.z); v.glow.scale.set(2 * v.sk.ex * S * grow, 1, 2.6 * v.sk.ez * S * grow);
          v.glow.material.color.copy(amber).lerp(red, Math.max(s.error, s.urgency * .5)); v.glow.material.opacity = want * s.alive * K.glow;
        }
      }
      const sel = vis.find(v => v.n.selected), hov = vis.find(v => v.n.hovered && !v.n.selected);
      markOut(marks[0], sel, sel ? sel.n.s.select * .9 : 0); markOut(marks[1], hov, hov ? hov.n.s.hover * .35 : 0);

      for (const t of titles) {
        const b = bank.get(t.p), d = b?.title.dir;
        t.m.visible = !!b && legible && t.p.s.alive > .02;
        if (!t.m.visible) continue;
        if (t.drawn !== `${fontsReady}${d}`) drawTitle(t, d);
        const k = byNode.get(t.p)?.group.scale.x ?? 1;
        t.m.position.set(t.p.pos.x + b.title.x * k + d * t.m.scale.x / 2, .01, t.p.pos.z + b.title.z * k);
        t.m.material.opacity = t.p.s.alive;
      }

      // Cables, and the beads riding them; a bead reaching a project carries on to You, and ticks each key it reaches.
      let bi = 0;
      for (const l of links) {
        const ch = l.child, pa = l.parent, alive = ch.n.s.alive * (pa.n.s.alive || 1);
        for (const p of l.pulses.update(dt)) {
          click(pa, 2.5 * p.strength);
          if (l.n.kind === 'session') linkOf.get(l.n.project).pulses.add(.75, .8, p.data);
          if (l.n.kind === 'sub') linkOf.get(l.n.parent).pulses.add(1.5, .8, p.data);
        }
        const A = ch.group.position, B = pa.group.position;
        // A tile's plug is the middle of its inner end; anything else plugs in on the side facing the other end.
        if (ch.tile) p0.set(A.x - ch.side * (ch.o.A + .06) * ch.S * ch.group.scale.x, 0, A.z); else p0.copy(A);
        let dx = B.x - p0.x, dz = B.z - p0.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        const ra = ch.tile ? 0 : reach(ch, dx, dz), rb = reach(pa, -dx, -dz);
        l.mesh.visible = alive > .02 && d > ra + rb + .1;
        if (!l.mesh.visible) continue;
        l.k = Math.min(1, alive * 1.2);
        if (moved(l.last, p0.x, p0.z, B.x, B.z, ra, rb, l.k)) {
          l.a.set(p0.x + dx * ra, 0, p0.z + dz * ra); l.b.set(B.x - dx * rb, 0, B.z - dz * rb); l.len = d - ra - rb;
          l.c.set((l.a.x + l.b.x) / 2 - dz * l.sgn * .04 * l.len, 0, (l.a.z + l.b.z) / 2 + dx * l.sgn * .04 * l.len);
          l.tube.update(l.point);
        }
        for (const p of l.pulses.list) {
          if (bi >= 96) break;
          l.point(kit.easeInOutSine(p.t), pv); pv.y += l.r * l.k * .9;
          const k = Math.min(1, p.t * 10, (1 - p.t) * 10) * p.strength * (l.n.kind === 'project' ? 1.15 : l.n.kind === 'sub' ? .6 : .85);
          m4.compose(pv, q4, sv.setScalar(Math.max(.01, k))); beads.setMatrixAt(bi, m4); beads.setColorAt(bi, p.data); bi++;
        }
      }
      beads.count = bi; beads.instanceMatrix.needsUpdate = true; if (beads.instanceColor) beads.instanceColor.needsUpdate = true;

      // Needs-you cords run out from the lamp as the key pops and reel back in when it's answered.
      let ci = 0;
      for (const c of cords) {
        const v = byNode.get(c.n), grow = kit.clamp(v.st.pop) * c.n.s.alive;
        c.mesh.visible = grow > .01;
        if (!c.mesh.visible) continue;
        const ax = v.group.position.x + lampX(v), az = v.n.pos.z, B = youV.group.position;
        let dx = B.x - ax, dz = B.z - az; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        if (moved(c.last, ax, az, v.top, B.x, B.z, youV.top, grow)) {
          const rb = reach(youV, -dx, -dz) * .74;
          c.a.set(ax, v.top, az); c.b.set(B.x - dx * rb, youV.top, B.z - dz * rb);
          c.sag = Math.min(.3, d * .012); c.L = c.a.distanceTo(c.b);
          c.tube.update(c.point, 0, grow);
        }
        const urg = c.n.s.urgency;
        c.mat.color.copy(amber).lerp(red, urg * .35); c.mat.emissive.copy(c.mat.color);
        tmp.set('#fff1d6').lerp(red, urg * .4);
        if (!reduced) c.ph += dt * (.9 + urg * 1.8) / PEARL;
        const m = Math.floor(c.L / PEARL), frac = c.ph % 1;
        for (let i = 0; i <= m && ci < 192; i++) {
          const t = (i + frac) * PEARL / c.L; if (t > grow) break;
          const k = Math.min(1, t * c.L / .4, (grow - t) * c.L / .4);
          c.point(t, pv); m4.compose(pv, q4, sv.setScalar(Math.max(.01, k))); pearls.setMatrixAt(ci, m4); pearls.setColorAt(ci, tmp); ci++;
        }
      }
      pearls.count = ci; pearls.instanceMatrix.needsUpdate = true; if (pearls.instanceColor) pearls.instanceColor.needsUpdate = true;

      drawDeck();
    }

    return { update, event, dispose() { env.dispose(); pmrem.dispose(); for (const k of Object.values(kits)) { k.cap.dispose(); k.base.dispose(); k.shaft.dispose(); k.face.dispose(); k.ao.dispose(); } } };
  },
};
