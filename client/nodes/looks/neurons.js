// Neurons: every session is a neuron, and the fibre joining it to its project's larger neuron is one of its own dendrites,
// grown across and fused into the other cell; projects join You the same way. Activity glows in the soma and crackles through
// it, tool calls fire action potentials along the fibres, plan steps swell into myelin beads, and a session that needs you
// stretches its You-ward dendrite across the board until it touches You. You wear the usage limits as rings underneath.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import * as kit from '../kit.js';

const KEYS = ['work', 'think', 'compact', 'need', 'wait', 'idle', 'error', 'off'];
const pal = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new THREE.Color(v)]));
// Core glow per state, its strength, and the membrane rim tint.
const CORE = pal({ work: '#ff4a12', think: '#ffa86a', compact: '#b08aff', need: '#ffc531', wait: '#3f9dff', idle: '#4a5f8c', error: '#ff1f45', off: '#151c2e' });
const ACT = { work: 1, think: .7, compact: .45, need: 1, wait: .5, idle: .14, error: .9, off: 0 };
const RIM = pal({ work: '#cfe0ff', think: '#d4e2ff', compact: '#c8bcff', need: '#ffe3a6', wait: '#b8dcff', idle: '#8fa7d6', error: '#ffb3c0', off: '#7d8bab' });
const PULSE = pal({ edit: '#ffb46a', read: '#a6dbff', search: '#d2a6ff', bash: '#ffe07a', web: '#7dffd8', agent: '#ff9ad6', '': '#ffd0a0' });
const C = { white: new THREE.Color('#fff4e6'), cyan: new THREE.Color('#7fe6ff'), gold: new THREE.Color('#ffb21f'), violet: new THREE.Color('#b99cff'), red: new THREE.Color('#ff3355'),
  bulb: new THREE.Color('#4fdcff'), youCalm: new THREE.Color('#8fd0ff'), rimProject: new THREE.Color('#d6e6ff'), plan: new THREE.Color('#5fe0ff'), bypass: new THREE.Color('#ff4fd8'),
  beadOn: new THREE.Color('#ffa24a'), ash: new THREE.Color('#1d2436'), beadOff: new THREE.Color('#34558f').multiplyScalar(.7) };
const Y = new THREE.Vector3(0, 1, 0);

// Soma radius, dendrite count, length, branching depth and crackle filaments per kind; providers vary the shape. Sessions are
// the bodies that matter; a project is only the ganglion where the trunk from You splits towards them.
const SHAPE = {
  you: { R: 1.25, count: 10, len: 5.8, depth: 2, filaments: 18 },
  project: { R: .5, count: 3, len: 1.7, depth: 1, filaments: 7 },
  session: { R: .72, count: 6, len: 2.8, depth: 2, filaments: 12 },
  sub: { R: .36, count: 4, len: 1.2, depth: 1, filaments: 5 },
};
const PROVIDER = { claude: { count: 6, len: 1, curl: 1, depth: 2 }, codex: { count: 4, len: 1.3, curl: .35, depth: 1 }, opencode: { count: 5, len: .85, curl: 1.35, depth: 2, extra: true } };
// A fibre's thickness midway between its cells.
const MID = { project: .14, session: .085, sub: .05 };

// The whole cell is soft: a slow low-frequency warp bends soma and dendrites together as if adrift in fluid, the membrane
// breathes along its normals, and dendrite tips trail a travelling wave so they curl rather than wag. It is a function of a
// point in the cell's own space, so a fibre that runs it for each of its cells moves exactly as each soma does where it joins.
const WARP_GLSL = /* glsl */`
${kit.NOISE_GLSL}
uniform float uTime;
vec3 warp(vec3 p, vec3 nrm, float along, float R, float seed, float sway) {
  vec3 q = p / R; float t = uTime, sw = sway * along * along;
  vec3 d = vec3(snoise(q * .32 + vec3(seed, t * .16, 0.)), snoise(q * .32 + vec3(4.1, seed, t * .13)) * .5, snoise(q * .32 + vec3(t * .14, 8.3, seed))) * R * .3 * sway;
  d += nrm * snoise(q * .85 + vec3(0., t * .3, seed)) * R * .1 * sway * (1. - along);
  d.x += (sin(t * .8 + q.z * .9 + seed) + .6 * sin(t * 1.4 - along * 4.5 + q.x * .7)) * sw * R * .3;
  d.z += (cos(t * .7 + q.x * .8 + seed) + .6 * cos(t * 1.2 - along * 4.5 + q.z * .7)) * sw * R * .3;
  d.y += sin(t * .6 + q.x * .7 + seed * 2.) * sw * R * .16;
  return d;
}`;
// Fibrous strands from ridged noise in the cell's space; from far away they fade so cells read as soft shapes, not scribbles.
const FIBRE_GLSL = /* glsl */`
${kit.NOISE_GLSL}
vec2 fibres(vec3 q, float seed, float dist) {
  float n1 = snoise(q * 1.5 + seed);
  return vec2(n1, pow(max(1. - abs(snoise(q * vec3(1.5, 2.4, 1.5) + n1 * .5 - seed)), 0.), 4.) * .75 * (1. - .55 * smoothstep(35., 80., dist)));
}`;
const MEMBRANE_VERT = /* glsl */`
attribute float along, bulb;
uniform float uSway, uSeed, uR;
varying vec3 vN, vV, vLocal; varying float vAlong, vBulb;
${WARP_GLSL}
void main() {
  vLocal = position; vAlong = along; vBulb = bulb;
  vec4 mv = modelViewMatrix * vec4(position + warp(position, normal, along, uR, uSeed, uSway), 1.);
  vV = -mv.xyz; vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;
const MEMBRANE_FRAG = /* glsl */`
uniform vec3 uRim, uCore, uBulb; uniform float uCoreAmt, uAlpha, uGrow, uFront, uTime, uHi, uR, uSeed, uShimmer;
varying vec3 vN, vV, vLocal; varying float vAlong, vBulb;
${FIBRE_GLSL}
void main() {
  if (vAlong > uGrow) discard;
  vec3 N = normalize(vN), V = normalize(vV);
  float ndv = clamp(abs(dot(N, V)), 0., 1.), fres = pow(1. - ndv, 2.2);
  vec3 q = vLocal / uR;
  vec2 f = fibres(q, uSeed, length(vV));
  float fib = .55 + .3 * f.x, ridge = f.y, inner = 1. - smoothstep(.15, 1.3, length(q));
  float sh = 1. + uShimmer * .6 * sin(uTime * 2.6 + f.x * 5.);
  // Strands near an active core catch its colour, like the golden filaments in a firing cell.
  float warm = clamp(inner * uCoreAmt * 1.1, 0., .85);
  vec3 strand = mix(uRim, uCore * 1.25, warm);
  vec3 col = uRim * (fres * fib + .04) * (1. - warm * .5) + strand * ridge * (.35 + fres * .6);
  col += uCore * uCoreAmt * inner * (.22 + .5 * ndv) * sh * (.6 + .5 * ridge);
  float front = uFront * smoothstep(uGrow - .12, uGrow, vAlong);
  col += vec3(.45, .8, 1.) * front * .9;
  float a = clamp(.04 + fres * .6 * fib + ridge * .3 + inner * uCoreAmt * .22 + front * .5, 0., 1.);
  if (vBulb > .5) { col = uBulb * (.35 + fres * 1.1); a = .55 + fres * .4; }
  col *= 1. + uHi;
  gl_FragColor = vec4(col, a * uAlpha);
}`;
// A fibre between two cells, drawn from a static resting tube. Each end rides rigidly with its own cell (offset and scale,
// then that cell's warp in that cell's space), so near a soma the fibre is exactly where a dendrite of that cell would be and
// moves with it; between the ends it blends from one cell to the other and meanders. Normals follow the live bends.
const FIBRE_VERT = /* glsl */`
attribute vec3 aC, aT;
uniform vec3 uCenA, uCenB, uCen0A, uCen0B, uSide; uniform float uSclA, uSclB, uRA, uRB, uSeedA, uSeedB, uSwayA, uSwayB;
uniform vec2 uSkin; uniform vec4 uMeander, uPlan;
#ifdef REACH
uniform float uReach, uRest, uGrowA, uR0, uLenD, uTip, uTipR, uTipM, uLift;
#endif
varying vec3 vN, vV, vQA, vQB; varying float vU, vW, vBead, vStep;
${WARP_GLSL}
vec3 meander(float u) {
  float x = clamp((u - uSkin.x) / max(uSkin.y - uSkin.x, 1e-3), 0., 1.), e = sin(3.14159265 * x), env = e * e, ph = x * uMeander.y * 3.14159265, t = uTime * uMeander.z, sd = uMeander.w;
  vec3 m = uSide * env * (sin(ph - t + sd) + .35 * sin(ph * 2.3 + t * .6 + sd * 3.)) * uMeander.x * .85;
  m.y += env * sin(ph * .7 + t * .8 + sd * 2.) * uMeander.x * .4;
#ifdef REACH
  m.y += uLift * env;
#endif
  return m;
}
void main() {
  float u = uv.x, span = max(uSkin.y - uSkin.x, 1e-3), x = clamp((u - uSkin.x) / span, 0., 1.);
  float w = x * x * (3. - 2. * x), dw = 6. * x * (1. - x) / span, along = 0., r = length(position - aC), dr = 0.;
#ifdef REACH
  // At rest only the first stretch shows, tapering like any dendrite; reaching, it runs all the way and swells into a bouton.
  float g = mix(uRest * uGrowA, 1., uReach), s = clamp(u / max(g, 1e-3), 0., 1.), m = mix(.1, uTipM, uReach), z = (u - g) / uTip + 1.;
  r = uR0 * (m + (1. - m) * pow(1. - s, 1.25)) * (1. + .45 * exp(-9. * u / uLenD));
  r = max(r, uReach * uTipR * sqrt(max(1. - z * z, 0.)));
  along = s * (1. - uReach);
#endif
  // Plan steps swell the fibre into myelin beads.
  float bead = 0., stepK = -1.;
  if (uPlan.x > .5) {
    float len = uPlan.w - uPlan.z, k = floor((u - uPlan.z) / len * uPlan.x);
    if (k >= 0. && k < uPlan.x) {
      float hl = len / uPlan.x * .36, zb = (u - uPlan.z - len * (k + .5) / uPlan.x) / hl, q2 = max(1. - zb * zb, 0.), grow = r * .8 + .03;
      bead = q2 * sqrt(q2); stepK = k; dr = -3. * grow * sqrt(q2) * zb / hl; r += grow * bead;
    }
  }
  vec3 n = normal, p = aC + n * r;
  vec3 pa = uCenA + uSclA * (p - uCen0A), pb = uCenB + uSclB * (p - uCen0B);
  vec3 live = mix(pa, pb, w) + meander(u);
  vec3 T = mix(uSclA, uSclB, w) * aT + dw * (pb - pa) + (meander(u + .003) - meander(u - .003)) / .006;
  float tl = max(length(T), 1e-5);
  T /= tl; n = normalize(n - T * dot(n, T) - T * dr / tl);
  vec3 la = p - uCen0A, lb = p - uCen0B, d = vec3(0.);
  if (w < 1.) d += (1. - w) * uSclA * warp(la, n, along, uRA, uSeedA, uSwayA);
  if (w > 0.) d += w * uSclB * warp(lb, n, 0., uRB, uSeedB, uSwayB);
  vQA = la / uRA; vQB = lb / uRB; vU = u; vW = w; vBead = bead; vStep = stepK;
  vec4 mv = modelViewMatrix * vec4(live + d, 1.);
  vV = -mv.xyz; vN = normalMatrix * n;
  gl_Position = projectionMatrix * mv;
}`;
// The same membrane as the cells, with each end's colour and strands in that cell's space, plus pulses, beads and growth.
const FIBRE_FRAG = /* glsl */`
uniform vec3 uRimA, uRimB, uPulseCol, uBeadOn, uBeadOff; uniform vec4 uPulse, uPlan;
uniform float uHiA, uHiB, uAlphaA, uAlphaB, uSeedA, uSeedB, uTime, uLen, uFlash, uGrow, uFront;
#ifdef REACH
uniform vec3 uGold; uniform float uReach, uRest, uGrowA, uFlow, uFlowSpeed, uTip, uGoldAmt;
#endif
varying vec3 vN, vV, vQA, vQB; varying float vU, vW, vBead, vStep;
${FIBRE_GLSL}
void main() {
#ifdef REACH
  float g = mix(uRest * uGrowA, 1., uReach);
  if (vU > g) discard;
#else
  // A new fibre grows out of both cells at once and fuses in the middle.
  float gA = uGrow * .6, gB = 1. - uGrow * .4;
  if (vU > gA && vU < gB) discard;
#endif
  vec3 N = normalize(vN), V = normalize(vV);
  float ndv = clamp(abs(dot(N, V)), 0., 1.), fres = pow(1. - ndv, 2.2), dist = length(vV);
  vec2 f = mix(vW < 1. ? fibres(vQA, uSeedA, dist) : vec2(0.), vW > 0. ? fibres(vQB, uSeedB, dist) : vec2(0.), vW);
  float fib = .55 + .3 * f.x;
  vec3 rim = mix(uRimA, uRimB, vW);
  vec3 col = rim * (fres * fib + .04) + rim * f.y * (.35 + fres * .6);
  float a = .04 + fres * .6 * fib + f.y * .3;
#ifndef REACH
  float front = uFront * max(smoothstep(gA - .1, gA, vU) * step(vU, gA), smoothstep(gB + .1, gB, vU) * step(gB, vU));
  col += vec3(.45, .8, 1.) * front * .9; a += front * .5;
#endif
  if (vBead > .001) {
    float done = step(vStep + .5, uPlan.y), now = (1. - done) * step(vStep - .5, uPlan.y);
    vec3 bc = mix(uBeadOff, uBeadOn, done) + uBeadOn * now * (.3 + .2 * sin(uTime * 3.));
    col = mix(col, bc * (.3 + fres * 1.3), vBead * .9); a = mix(a, .32 + fres * .6, vBead);
  }
  // Action potentials: a tight bright head with a fading wake, running from the child (u = 0) to the parent.
  float p = 0.;
  for (int i = 0; i < 4; i++) { float t = uPulse[i]; if (t >= 0.) { float d = (vU - t) * uLen; p += exp(-d * d * 7.) + (d < 0. ? exp(d * 1.1) * .2 : 0.); } }
  col += uPulseCol * (p * 1.35 + uFlash * .7); a = max(a, min(1., p * 1.1 + uFlash * .4));
#ifdef REACH
  float gold = uReach * uGoldAmt * smoothstep(0., .08, vU), fl = uFlow * pow(.5 + .5 * sin(vU * uLen * 1.3 - uTime * uFlowSpeed), 5.);
  col = mix(col, uGold * (fres * 1.1 + .2 + f.y * .5), gold * .75) + uGold * (fl * 1.25 + uFlow * .2) * gold;
  float tip = uReach * uGoldAmt * smoothstep(g - uTip * 2.4, g - uTip * .7, vU);
  col += uGold * tip * 1.4; a = max(a, max(fl * .85 + uFlow * .25, tip) * gold);
#endif
  col *= 1. + mix(uHiA, uHiB, vW);
  gl_FragColor = vec4(col, clamp(a, 0., 1.) * mix(uAlphaA, uAlphaB, vW));
}`;
const NUCLEUS_VERT = /* glsl */`
varying vec3 vN, vV, vLocal, vCol; varying float vSeed;
void main() {
  vLocal = position; vCol = instanceColor; vSeed = dot(instanceMatrix[3].xyz, vec3(.37, .11, .53));
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.); vV = -mv.xyz; vN = normalMatrix * mat3(instanceMatrix) * normal;
  gl_Position = projectionMatrix * mv;
}`;
const NUCLEUS_FRAG = /* glsl */`
uniform float uTime;
varying vec3 vN, vV, vLocal, vCol; varying float vSeed;
${kit.NOISE_GLSL}
void main() {
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0., 1.);
  float g = snoise(vLocal * 4.5 + vec3(0., uTime * .35, vSeed));
  float spark = smoothstep(.55, .9, snoise(vLocal * 11. + vec3(uTime * .8, vSeed, 0.)));
  gl_FragColor = vec4(vCol * (.25 + .75 * ndv) * (.7 + .55 * g) + vCol * vec3(1., .8, .5) * spark * .8, 1.);
}`;
// A soft halo quad that always faces the camera.
const HALO_VERT = /* glsl */`
varying vec2 vP; varying vec3 vCol;
void main() {
  vP = position.xy; vCol = instanceColor;
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.);
  mv.xy += position.xy * length(instanceMatrix[0].xyz);
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FRAG = /* glsl */`
varying vec2 vP; varying vec3 vCol;
void main() { float r = length(vP); if (r > 1.) discard; float f = pow(max(1. - r, 0.), 2.4) + .5 * exp(-r * r * 30.); gl_FragColor = vec4(vCol * f, 1.); }`;
const CRACKLE_VERT = /* glsl */`
attribute float along, phase; varying float vAlong, vPhase;
void main() { vAlong = along; vPhase = phase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const CRACKLE_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAmt, uTime, uRate, uStatic;
varying float vAlong, vPhase;
float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float tick = floor(uTime * uRate + vPhase * 13.);
  float on = step(.48, h(vPhase * 91.7 + tick));
  float travel = smoothstep(.3, 0., abs(fract(uTime * 1.4 + vPhase) - vAlong));
  float lit = mix(on * (.5 + .9 * travel), .55, uStatic);
  gl_FragColor = vec4(uColor * 1.7, uAmt * lit * (1. - vAlong * .7));
}`;
const PLANE_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const RIPPLE_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uProg, uAmt; varying vec2 vUv;
void main() {
  float d = length(vUv - .5) * 2., a = (d - uProg) * 16., b = (d - uProg * .82) * 6.;
  float ring = exp(-a * a) + .4 * exp(-b * b);
  gl_FragColor = vec4(uColor * 1.6, ring * (1. - uProg) * (1. - uProg) * uAmt * step(d, 1.) * smoothstep(0., .08, uProg));
}`;
const RING_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uDash, uTime, uAmt; varying vec2 vUv;
void main() {
  vec2 c = vUv - .5; float d = length(c) * 2.;
  float ring = smoothstep(.035, 0., abs(d - .86));
  float dash = uDash > .5 ? smoothstep(-.2, .2, sin(atan(c.y, c.x) * 12. + uTime * .8)) : .65 + .35 * sin(uTime * 3.);
  gl_FragColor = vec4(uColor * 1.2, ring * dash * uAmt);
}`;
// You's usage limits: each account an arc gauge in its own sector round You, one band per window, filling from the top down
// (w < 0 runs it the other way, for the left side) and turning cyan to amber to red.
const USAGE_FRAG = /* glsl */`
uniform vec4 uArc[10]; uniform float uN; varying vec2 vUv;
void main() {
  vec2 c = (vUv - .5) * 2.; float d = length(c), at = atan(c.x, c.y);
  vec3 col = vec3(0.);
  for (int i = 0; i < 10; i++) {
    if (float(i) >= uN) break;
    vec4 a = uArc[i];
    float band = smoothstep(.02, .008, abs(d - a.z));
    if (band <= 0. || at < a.x || at > a.y) continue;
    float u = abs(a.w), f = a.w < 0. ? (a.y - at) / (a.y - a.x) : (at - a.x) / (a.y - a.x), h = (f - u) * 36., head = exp(-h * h) * step(.004, u);
    vec3 tint = mix(vec3(.3, .85, 1.), vec3(1., .7, .16), smoothstep(.55, .8, u));
    tint = mix(tint, vec3(1., .2, .3), smoothstep(.86, .97, u));
    col += tint * band * (step(f, u) * .42 + .05 + head * .8);
  }
  gl_FragColor = vec4(col, 1.);
}`;
// A screenshot vesicle: a soft, wobbling oval cell facing the camera with the image lensed inside its membrane, which carries
// the same lit rim and fibrous strands as the cells and swells into a neck where its dendrite arrives. Bright screenshots are
// eased down under the bloom threshold so they don't glare.
const VESICLE_VERT = /* glsl */`
uniform vec3 uCenter; uniform vec2 uOval; varying vec2 vP;
void main() { vP = position.xy * (uOval + .75) * 2.; vec4 mv = viewMatrix * vec4(uCenter, 1.); mv.xy += vP; gl_Position = projectionMatrix * mv; }`;
const VESICLE_FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec2 uOval, uImg, uOff, uNeck; uniform vec3 uRim; uniform float uAmt, uTime, uSeed, uHi; varying vec2 vP;
${kit.NOISE_GLSL}
float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
void main() {
  vec2 p = vP, e = p / uOval;
  float ang = atan(p.y, p.x), edge = 1. / length(uNeck / uOval);
  float d = (length(e) - 1.) * min(uOval.x, uOval.y) + .05 * sin(ang * 3. + uTime * .6 + uSeed) + .028 * sin(ang * 5. - uTime * .45 + uSeed * 2.);
  vec2 pa = p - uNeck * edge * .72, ba = uNeck * (edge * .28 + .38);
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  d = smin(d, length(pa - ba * h) - mix(.42, .15, h * h), .28);
  if (d > .5) discard;
  float inside = smoothstep(.012, -.02, d), near = smoothstep(-.42, 0., d);
  vec2 uv = (p * (.86 + .14 * dot(e, e)) - uOff) / (uImg * 2.);
  vec3 img = texture2D(uMap, clamp(uv + .5, 0., 1.)).rgb * step(abs(uv.x), .5) * step(abs(uv.y), .5);
  float l = dot(img, vec3(.2126, .7152, .0722)), soft = l < .2 ? l : .2 + .13 * (1. - exp((.2 - l) / .13));
  img *= soft / max(l, 1e-4);
  float ridge = pow(max(1. - abs(snoise(vec3(p * 2.3, uSeed + uTime * .05))), 0.), 4.) * near;
  vec3 col = mix(img, vec3(.015, .025, .07), near * .5) + uRim * (ridge * .3 + near * near * .16);
  float rim = exp(-abs(d) * 26.), glow = exp(-max(d, 0.) * 11.) * (1. - inside);
  col = col * inside + uRim * (rim * .5 + glow * .14);
  gl_FragColor = vec4(col * (1. + uHi), max(inside * .95, rim * .6 + glow * .3) * uAmt);
}`;
const BOKEH_VERT = /* glsl */`
attribute float aSize, aSeed; attribute vec3 aColor;
uniform float uTime, uPx; varying vec3 vColor;
void main() {
  vec3 p = position;
  p.x += sin(uTime * .05 + aSeed * 6.28) * 2.2; p.z += cos(uTime * .04 + aSeed * 4.1) * 2.2; p.y += sin(uTime * .08 + aSeed * 9.) * .7;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_PointSize = min(aSize * uPx / -mv.z, 220.);
  vColor = aColor; gl_Position = projectionMatrix * mv;
}`;
const BOKEH_FRAG = /* glsl */`
varying vec3 vColor;
void main() { vec2 c = gl_PointCoord * 2. - 1.; float r = length(c); if (r > 1.) discard; gl_FragColor = vec4(vColor, smoothstep(1., .55, r) * (.5 + .35 * r * r)); }`;
const NEBULA_VERT = /* glsl */`varying vec2 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const NEBULA_FRAG = /* glsl */`
varying vec2 vW; uniform float uTime;
${kit.NOISE_GLSL}
void main() {
  vec2 p = vW * .011;
  float n = snoise(vec3(p, uTime * .006)) * .65 + snoise(vec3(p * 2.4, 3.1 + uTime * .004)) * .35;
  vec3 col = mix(vec3(.004, .009, .03), vec3(.016, .04, .13), smoothstep(-.5, .7, n));
  float k = smoothstep(.15, .95, n);
  col += vec3(.05, .16, .45) * k * k * .55;
  vec2 h1 = vW - vec2(70., -95.), h2 = vW - vec2(-90., 40.);
  col += vec3(.08, .3, .85) * exp(-dot(h1, h1) / 2600.) * .55 + vec3(.25, .1, .4) * exp(-dot(h2, h2) / 3400.) * .25;
  gl_FragColor = vec4(col, 1.);
}`;

const cubic = (a, b, c, d, t, out) => {
  const s = 1 - t, k0 = s * s * s, k1 = 3 * s * s * t, k2 = 3 * s * t * t, k3 = t * t * t;
  return out.set(a.x * k0 + b.x * k1 + c.x * k2 + d.x * k3, a.y * k0 + b.y * k1 + c.y * k2 + d.y * k3, a.z * k0 + b.z * k1 + c.z * k2 + d.z * k3);
};
// A fibre's resting shape as a static tube: per ring its centre (aC) and derivative along u (aT), u by arc length. `us` lists
// each ring's u and radius(u, L) its thickness. Frames are parallel-transported, so nothing twists where the fibre climbs.
function restFibre(curve, us, radial, radius) {
  const S = 200, pts = [curve(0, new THREE.Vector3())], acc = [0];
  for (let i = 1; i <= S; i++) { pts.push(curve(i / S, new THREE.Vector3())); acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1])); }
  const L = acc[S], a = new THREE.Vector3(), b = new THREE.Vector3();
  const at = (u, P, T) => {
    const d = kit.clamp(u) * L; let k = 1;
    while (k < S && acc[k] < d) k++;
    const s = (k - 1 + kit.clamp((d - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]))) / S;
    curve(s, P);
    if (T) { curve(Math.min(1, s + 1e-3), a); curve(Math.max(0, s - 1e-3), b); T.subVectors(a, b).normalize(); }
    return P;
  };
  const ring = radial + 1, N = us.length, count = N * ring;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), ac = new Float32Array(count * 3), atn = new Float32Array(count * 3);
  const P = new THREE.Vector3(), T = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const u = us[i], r = radius(u, L);
    at(u, P, T);
    if (i === 0) { nrm.crossVectors(T, Y); if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0); } else nrm.addScaledVector(T, -nrm.dot(T));
    nrm.normalize(); bin.crossVectors(nrm, T);
    for (let j = 0; j <= radial; j++) {
      const ang = j / radial * Math.PI * 2, o = i * ring + j;
      v.copy(nrm).multiplyScalar(Math.cos(ang)).addScaledVector(bin, Math.sin(ang));
      pos[o * 3] = P.x + v.x * r; pos[o * 3 + 1] = P.y + v.y * r; pos[o * 3 + 2] = P.z + v.z * r;
      nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
      uv[o * 2] = u; uv[o * 2 + 1] = j / radial;
      ac[o * 3] = P.x; ac[o * 3 + 1] = P.y; ac[o * 3 + 2] = P.z;
      atn[o * 3] = T.x * L; atn[o * 3 + 1] = T.y * L; atn[o * 3 + 2] = T.z * L;
    }
  }
  const index = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < radial; j++) { const p = i * ring + j, q = p + ring; index.push(p, q, p + 1, q, q + 1, p + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aC', new THREE.BufferAttribute(ac, 3)); g.setAttribute('aT', new THREE.BufferAttribute(atn, 3)); g.setIndex(index);
  return { geometry: g, L, at };
}

// The round sphere every soma is pushed out from, welded once: building it per cell was most of a rebuild's time.
let somaSphere = null;
function baseSoma() {
  if (!somaSphere) { const g = new THREE.IcosahedronGeometry(1, 12); g.deleteAttribute('uv'); g.deleteAttribute('normal'); somaSphere = mergeVertices(g); g.dispose(); }
  return somaSphere;
}

// A soft, out-of-focus neuron drawn into a canvas for the deep background.
function blurNeuron(seed, blur, core) {
  return kit.canvasTexture(256, (g, S) => {
    const r = kit.rng(seed), c = S / 2;
    g.filter = `blur(${blur}px)`; g.lineCap = 'round';
    const branch = (x, y, a, len, w, depth) => {
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        a += (r() - .5) * .6;
        const nx = x + Math.cos(a) * len / steps, ny = y + Math.sin(a) * len / steps, k = 1 - i / steps;
        g.strokeStyle = `rgba(165, 200, 255, ${.45 + .35 * k})`; g.lineWidth = Math.max(.7, w * k);
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        if (depth > 0 && i === 2 + (r() * 3 | 0)) branch(nx, ny, a + (r() < .5 ? -1 : 1) * (.5 + r() * .5), len * .6, w * k * .8, depth - 1);
        x = nx; y = ny;
      }
    };
    const n = 6 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) branch(c, c, i / n * Math.PI * 2 + r() * .6, S * (.3 + r() * .2), S * .05, 2);
    let gr = g.createRadialGradient(c, c, 0, c, c, S * .11);
    gr.addColorStop(0, 'rgba(220, 234, 255, .95)'); gr.addColorStop(1, 'rgba(150, 190, 255, 0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, S * .11, 0, 7); g.fill();
    if (core) {
      gr = g.createRadialGradient(c, c, 0, c, c, S * .085);
      gr.addColorStop(0, 'rgba(255, 205, 140, 1)'); gr.addColorStop(.45, 'rgba(255, 110, 60, .85)'); gr.addColorStop(1, 'rgba(255, 70, 40, 0)');
      g.fillStyle = gr; g.beginPath(); g.arc(c, c, S * .085, 0, 7); g.fill();
    }
    g.filter = 'none'; g.globalCompositeOperation = 'destination-in';
    gr = g.createRadialGradient(c, c, S * .22, c, c, S * .5); gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
}

function create(ctx) {
  const { scene, root, world } = ctx;
  ctx.setPost({ bloom: { strength: .85, radius: .55, threshold: .34 }, exposure: 1 });
  ctx.addPass(kit.vignettePass({ darkness: 1.05, offset: 1.05, grain: .028, tint: '#e2eaff' }));
  ctx.setView({ tilt: .56 });
  ctx.setSizes({ project: .85, session: 1.05 });
  // A label hangs just clear of its soma's front: the body leans out towards the camera by about 1.3 radii on screen.
  ctx.setLabelAnchor((n, out) => { const e = neurons.get(n); out.z += (e ? e.R * e.sc : .7) * 1.55 + (n.kind === 'you' ? .5 : .28); out.y = 0; });
  scene.background = new THREE.Color('#02050f');

  const tmp = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
  let anim = 0;
  const blend = (n, p, out) => {
    out.setRGB(0, 0, 0); let tot = 0;
    for (const k of KEYS) { const w = n.s[k]; if (w < .001) continue; out.r += p[k].r * w; out.g += p[k].g * w; out.b += p[k].b * w; tot += w; }
    return tot > .001 ? out.multiplyScalar(1 / tot) : out.copy(p.idle);
  };
  const activity = n => { let a = 0, tot = 0; for (const k of KEYS) { a += n.s[k] * ACT[k]; tot += n.s[k]; } return tot > .001 ? a / tot : ACT.idle; };
  const hash = x => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };

  // ── Deep background: nebula, blurred neurons and bokeh ──
  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG, uniforms: { uTime: { value: 0 } }, depthWrite: false }));
  nebula.position.y = -60; nebula.renderOrder = -30; root.add(nebula);
  const bgTex = [blurNeuron(11, 2.2, true), blurNeuron(23, 2.2, false), blurNeuron(37, 5.5, true), blurNeuron(41, 5.5, false), blurNeuron(59, 3.5, false)];
  // The blurred background neurons merge into one mesh per texture, tinted and faded through vertex colours.
  const br = kit.rng(7), bgParts = bgTex.map(() => []), bgCol = new THREE.Color(), bgObj = new THREE.Object3D();
  for (let i = 0; i < 34; i++) {
    const depth = br(), far = depth > .5, core = br() < .4;
    const t = far ? (core ? 2 : 3) : (core ? 0 : br() < .5 ? 1 : 4);
    bgCol.setHSL(.6 + br() * .06, .7, .55 + br() * .2).multiplyScalar(far ? .16 + br() * .16 : .22 + br() * .22);
    const sz = far ? 26 + br() * 26 : 14 + br() * 14;
    bgObj.scale.set(sz, 1, sz); bgObj.rotation.y = br() * Math.PI * 2;
    bgObj.position.set((br() - .5) * 220, -14 - depth * 36, -150 + br() * 200); bgObj.updateMatrix();
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).applyMatrix4(bgObj.matrix);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [bgCol.r, bgCol.g, bgCol.b]).flat(), 3));
    bgParts[t].push(g);
  }
  bgParts.forEach((parts, t) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ map: bgTex[t], vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    parts.forEach(g => g.dispose()); m.renderOrder = -20; m.frustumCulled = false; root.add(m);
  });
  const NB = 190, bp = new Float32Array(NB * 3), bs = new Float32Array(NB), bseed = new Float32Array(NB), bc = new Float32Array(NB * 3);
  for (let i = 0; i < NB; i++) {
    const near = i < 40, col = new THREE.Color(br() < .32 ? (br() < .5 ? '#ff8a5a' : '#ff6f9a') : br() < .6 ? '#5fb6ff' : '#7fe6ff');
    bp[i * 3] = (br() - .5) * (near ? 70 : 220); bp[i * 3 + 1] = near ? -1.5 - br() * 4 : -6 - br() * 40; bp[i * 3 + 2] = (near ? -35 : -170) + br() * (near ? 70 : 230);
    bs[i] = near ? .05 + br() * .09 : .6 + br() * 2.4; bseed[i] = br();
    col.multiplyScalar(near ? .4 + br() * .5 : .1 + br() * .25); bc.set([col.r, col.g, col.b], i * 3);
  }
  const bokehGeo = new THREE.BufferGeometry();
  bokehGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bokehGeo.setAttribute('aSize', new THREE.BufferAttribute(bs, 1));
  bokehGeo.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1)); bokehGeo.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
  const bokehMat = new THREE.ShaderMaterial({ vertexShader: BOKEH_VERT, fragmentShader: BOKEH_FRAG, uniforms: { uTime: { value: 0 }, uPx: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const bokeh = new THREE.Points(bokehGeo, bokehMat); bokeh.renderOrder = -10; bokeh.frustumCulled = false; root.add(bokeh);
  const px = () => { bokehMat.uniforms.uPx.value = ctx.size.h * ctx.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2))); };
  px(); ctx.onResize(px);

  // ── Shapes: each cell's own, from its kind, provider and seed ──
  const shapes = new Map();
  function shapeOf(n) {
    let P = shapes.get(n);
    if (P) return P;
    P = { ...SHAPE[n.kind], curl: 1, extra: false, roots: [], branches: [] };
    if (n.kind === 'session' || n.kind === 'sub') {
      const pv = PROVIDER[n.provider] || PROVIDER.claude;
      P.count = n.kind === 'sub' ? Math.max(3, pv.count - 2) : pv.count; P.len *= pv.len; P.curl = pv.curl; P.depth = n.kind === 'sub' ? 1 : pv.depth; P.extra = !!pv.extra;
    }
    // A little bigger or smaller, flatter or rounder, and now and then one long apical dendrite pointing away from its parent.
    const r = kit.rng(n.seed ^ 0xa53c9e);
    P.R *= .93 + r() * .14; P.squash = .7 + r() * .16; P.apical = (n.kind === 'session' || n.kind === 'sub') && r() < .4;
    shapes.set(n, P); return P;
  }
  // Where a root's arm runs from the soma's centre: the soma is squashed vertically, and the arm with it.
  const arm = (P, d) => new THREE.Vector3(d.x, d.y * P.squash, d.z);
  const warpU = (s, k) => s - k * Math.sin(2 * Math.PI * s) / (2 * Math.PI);

  // ── Fibres: every link is a dendrite of the child grown into its parent ──
  // Both ends leave their soma exactly as a dendrite does: from a root arm the soma swells out along the fibre's own end
  // tangent, at a dendrite's depth, thickness and taper, with side branches off the trunk. The resting shape is a static tube
  // that the shader bends live, so nothing is rebuilt per frame.
  const links = [];
  for (const n of world.nodes) {
    if (n.kind === 'you') continue;
    const p = n.parent, A = shapeOf(n), B = shapeOf(p), r = kit.rng(n.seed ^ 0x51ed27);
    const flat = new THREE.Vector3().subVectors(p.rest, n.rest).setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
    flat.normalize();
    // Leave and arrive turned a little, as a C or an S.
    const bend = (r() < .5 ? 1 : -1) * (.1 + r() * .18), turn = r() < .35 ? 1 : -1;
    const dA = flat.clone().applyAxisAngle(Y, bend).setY(-.2).normalize(), dB = flat.clone().negate().applyAxisAngle(Y, bend * turn * .8).setY(-.16).normalize();
    A.roots.push({ d: dA, w: 1.1, out: true }); B.roots.push({ d: dB, w: 1.1 });
    const S = arm(A, dA).multiplyScalar(A.R * 1.35).add(n.rest), E = arm(B, dB).multiplyScalar(B.R * 1.35).add(p.rest);
    const L0 = S.distanceTo(E), P1 = S.clone().addScaledVector(arm(A, dA).normalize(), L0 * .38), P2 = E.clone().addScaledVector(arm(B, dB).normalize(), L0 * .38);
    const r0A = A.R * .3, r0B = B.R * .3, mid = MID[n.kind];
    const end = (d, r0, len) => (r0 * (1 + .45 * Math.exp(-9 * d / len)) - mid) * Math.pow(1 - Math.min(1, d / len), 1.25);
    const radius = (u, L) => mid + Math.max(0, end(u * L, r0A, Math.min(A.len * .9, L * .5))) + Math.max(0, end((1 - u) * L, r0B, Math.min(B.len * .9, L * .5)));
    const steps = n.plan ? Math.min(16, n.plan.total) : 0;
    const N = Math.round(kit.clamp(L0 * 9, 18, 72) + steps * 12), us = Array.from({ length: N }, (_, i) => warpU(i / (N - 1), steps ? .35 : .7));
    const rest = restFibre((t, out) => cubic(S, P1, P2, E, t, out), us, n.kind === 'sub' ? 6 : 8, radius);
    // Each end rides rigidly with its cell over a soma's reach; the rest blends and meanders.
    const rigidA = Math.min(rest.L * .3, A.R * 1.6), rigidB = Math.min(rest.L * .3, B.R * 1.6);
    const lk = { n, rest, steps, skin: new THREE.Vector2(rigidA / rest.L, 1 - rigidB / rest.L), side: new THREE.Vector3(), pulses: new kit.Pulses(), flash: 0,
      amp: Math.min(1.1, rest.L * .05) * (n.kind === 'project' ? 1 : n.kind === 'session' ? .8 : .5), waves: kit.clamp(rest.L / 5.5, 1.2, 4.5), speed: n.kind === 'project' ? .35 : .5, mseed: (n.seed % 97) / 15 };
    links.push(lk);
    // Side branches off the trunk near each end, built into that cell like its other dendrites.
    const sideBranch = (P, cell, fromEnd, rigid) => {
      const db = rigid * (.45 + r() * .45), u = fromEnd ? 1 - db / rest.L : db / rest.L, at = new THREE.Vector3(), t = new THREE.Vector3();
      rest.at(u, at, t); if (fromEnd) t.negate();
      const d = t.applyAxisAngle(Y, (r() < .5 ? -1 : 1) * (.55 + r() * .45)); d.y += (r() - .6) * .3; d.normalize();
      P.branches.push({ start: at.sub(cell.rest), dir: d, len: P.len * (.35 + r() * .25), r0: radius(u, rest.L) * .72, depth: P.depth > 1 ? 1 : 0 });
    };
    const kids = n.kind === 'sub' ? (r() < .4 ? 1 : 0) : 1 + (r() < .35 ? 1 : 0);
    for (let k = 0; k < kids; k++) sideBranch(A, n, false, rigidA);
    if (r() < (p.kind === 'you' ? .7 : .5)) sideBranch(B, p, true, rigidB);
  }
  // The dendrite each session turns towards You: an ordinary dendrite at rest, it stretches all the way to You while the
  // session needs you. It leaves the soma beside the session's own trunk, to the side away from it.
  const reachSpecs = [];
  for (const n of world.sessions) {
    const P = shapeOf(n), U = shapeOf(world.you), r = kit.rng(n.seed ^ 0x7eac41), you = world.you.rest;
    const toYou = new THREE.Vector3().subVectors(you, n.rest).setY(0);
    if (toYou.lengthSq() < 1e-6) toYou.set(-1, 0, 0);
    toYou.normalize();
    const out = P.roots.find(o => o.out).d, ay = Math.atan2(toYou.z, toYou.x), ao = Math.atan2(out.z, out.x);
    const side = Math.sign(Math.atan2(Math.sin(ay - ao), Math.cos(ay - ao))) || (n.seed % 2 ? 1 : -1), ang = ay + side * (.62 + r() * .2);
    const d = new THREE.Vector3(Math.cos(ang), .04, Math.sin(ang)).normalize();
    P.roots.push({ d, w: 1 });
    const back = toYou.clone().negate(), v = back.clone().multiplyScalar(.75).setY(.66).normalize();
    const S = arm(P, d).multiplyScalar(P.R * 1.35).add(n.rest), E = new THREE.Vector3(v.x, v.y * U.squash, v.z).multiplyScalar(U.R * .72).add(you);
    const L0 = S.distanceTo(E), P1 = S.clone().addScaledVector(arm(P, d).normalize(), L0 * .3), P2 = E.clone().addScaledVector(back.multiplyScalar(.6).setY(.8).normalize(), L0 * .3);
    reachSpecs.push({ n, curve: (t, out) => cubic(S, P1, P2, E, t, out), L0 });
  }
  // The dendrite each session holds its screenshots out on: an ordinary one until it has some, then it carries a vesicle with the
  // latest inside. It points up the screen (away from the label), where the cell's other arms and its neighbours leave most room.
  // The vesicle faces the camera, whose tilt is fixed, so the neck where the dendrite fuses into it is known here: the dendrite's
  // resting shape ends exactly at the neck's tip, arriving along it.
  const OVAL = new THREE.Vector2(1.35, 1), camX = new THREE.Vector3(1, 0, 0), camY = new THREE.Vector3(0, Math.sin(.56), -Math.cos(.56));
  const shotSpecs = [];
  for (const n of world.sessions) {
    const P = shapeOf(n), taken = P.roots.map(o => Math.atan2(o.d.z, o.d.x));
    for (const m of world.sessions) if (m !== n && m.rest.distanceTo(n.rest) < 7) taken.push(Math.atan2(m.rest.z - n.rest.z, m.rest.x - n.rest.x));
    let ang = -Math.PI / 2, room = -1;
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16 - .5) * 2.6;
      let s = Math.PI; for (const t of taken) s = Math.min(s, Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))));
      if (s > room + 1e-3) { room = s; ang = a; }
    }
    const flat = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)), d = flat.clone().setY(.16).normalize();
    P.roots.push({ d, w: 1 });
    const V0 = n.rest.clone().addScaledVector(flat, 5).setY(1.1), S = arm(P, d).multiplyScalar(P.R * 1.35).add(n.rest);
    const to = new THREE.Vector3().subVectors(S, V0), neck = new THREE.Vector2(to.dot(camX), to.dot(camY)).normalize();
    const tip = neck.clone().multiplyScalar(1 / neck.clone().divide(OVAL).length() + .38);
    const E = V0.clone().addScaledVector(camX, tip.x).addScaledVector(camY, tip.y), L0 = S.distanceTo(E), out = camX.clone().multiplyScalar(neck.x).addScaledVector(camY, neck.y);
    const P1 = S.clone().addScaledVector(arm(P, d).normalize(), L0 * .35), P2 = E.clone().addScaledVector(out, L0 * .3);
    shotSpecs.push({ n, V0, neck, curve: (t, out) => cubic(S, P1, P2, E, t, out), L0 });
  }

  // ── Neurons ──
  const glowTex = kit.glowTexture([[0, 'rgba(255,255,255,1)'], [.2, 'rgba(255,255,255,.45)'], [.5, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']]);
  // Every nucleus is one instance of a granular sphere and every halo one instance of a camera-facing quad: two draw calls in all.
  // Instance colour carries the core colour already scaled by its strength.
  const NN = world.nodes.length;
  const nuclei = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 4), new THREE.ShaderMaterial({ vertexShader: NUCLEUS_VERT, fragmentShader: NUCLEUS_FRAG, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), NN);
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), NN);
  for (const im of [nuclei, halos]) { im.renderOrder = 2; im.frustumCulled = false; for (let i = 0; i < NN; i++) im.setColorAt(i, C.white); root.add(im); }
  const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const neurons = new Map(), list = [];

  function buildNeuron(n) {
    const P = shapeOf(n), r = kit.rng(n.seed), R = P.R, curl = P.curl, extra = P.extra;
    const avoid = P.roots.map(o => Math.atan2(o.d.z, o.d.x)), roots = P.roots.map(o => ({ d: o.d, w: o.w })), out = P.roots.find(o => o.out);
    const geos = [];
    // Dendrites bend smoothly: the curvature eases from one random value to another along the branch, so each one is an
    // arc or a soft S rather than a jitter; trunks swell where they leave the soma and taper to fine tips.
    const branch = (start, dir, len, r0, a0, depth, trunk = a0 === 0) => {
      const K = 9, pts = [start.clone()], h = dir.clone(), p = start.clone();
      const bendA = (r() - .5) * 1.1 * curl, bendB = (r() - .5) * 1.1 * curl, ph = r() * 6;
      for (let i = 1; i <= K; i++) {
        const f = i / K;
        h.applyAxisAngle(Y, (bendA * (1 - f) + bendB * f) * 2.2 / K + Math.sin(ph + f * 5) * .05 * curl);
        h.y += (r() - .5) * .05 - .025 * f; h.normalize();
        p.addScaledVector(h, len / K); pts.push(p.clone());
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new kit.Tube({ segments: trunk ? 18 : 12, radial: trunk ? 8 : 6, radius: t => Math.max(.012, r0 * (.1 + .9 * Math.pow(1 - t, 1.25)) * (1 + (trunk ? .45 : .2) * Math.exp(-t * 9))) });
      tube.update((t, o) => curve.getPoint(t, o));
      const g = tube.geometry, uv = g.attributes.uv, along = new Float32Array(uv.count);
      for (let i = 0; i < uv.count; i++) along[i] = a0 + uv.getX(i) * (1 - a0);
      g.setAttribute('along', new THREE.BufferAttribute(along, 1)); g.setAttribute('bulb', new THREE.BufferAttribute(new Float32Array(uv.count), 1)); g.deleteAttribute('uv');
      geos.push(g);
      if (depth > 0) {
        const kids = extra ? 2 : 1 + (r() < .5 ? 1 : 0);
        for (let k = 0; k < kids; k++) {
          const t0 = .32 + r() * .38, at = curve.getPoint(t0), tan = curve.getTangent(t0);
          const d2 = tan.applyAxisAngle(Y, (k % 2 ? 1 : -1) * (r() < .5 ? 1 : -1) * (.45 + r() * .55)); d2.y += (r() - .6) * .3; d2.normalize();
          branch(at, d2, len * (1 - t0) * (.75 + r() * .45), r0 * Math.pow(1 - t0, .85) * .85, a0 + t0 * (1 - a0), depth - 1);
        }
      }
      if (r() < .42) {
        const b = new THREE.SphereGeometry(R * (.065 + r() * .05), 10, 8); b.deleteAttribute('uv');
        b.translate(...curve.getPoint(1).toArray());
        const cnt = b.attributes.position.count;
        b.setAttribute('along', new THREE.BufferAttribute(new Float32Array(cnt).fill(1), 1)); b.setAttribute('bulb', new THREE.BufferAttribute(new Float32Array(cnt).fill(1), 1));
        geos.push(b);
      }
    };
    // Hubs give up free dendrites to the fibres they already grow.
    const count = n.kind === 'you' ? Math.max(4, P.count - Math.round(P.roots.length * .5)) : n.kind === 'project' ? Math.max(1, P.count - Math.round(P.roots.length * .3)) : P.count;
    // Nothing grows straight down the screen from a session, where its label sits.
    const label = n.kind === 'session' || n.kind === 'sub' ? Math.PI / 2 : null;
    for (let i = 0; i < count; i++) {
      let a = (i + r() * .6) / count * Math.PI * 2 + n.seed % 6, len = P.len * (.7 + r() * .5), r0 = R * .3;
      if (i === 0 && P.apical && out) { a = Math.atan2(-out.d.z, -out.d.x) + (r() - .5) * .3; len *= 1.55; r0 *= 1.15; }
      for (let pass = 0; pass < 3; pass++) {
        for (const v of avoid) { const d = Math.atan2(Math.sin(a - v), Math.cos(a - v)); if (Math.abs(d) < .42) a = v + Math.sign(d || 1) * .5; }
        if (label !== null) { const d = Math.atan2(Math.sin(a - label), Math.cos(a - label)); if (Math.abs(d) < .55) a = label + Math.sign(d || 1) * .6; }
      }
      const dir = new THREE.Vector3(Math.cos(a), -(.06 + r() * .3), Math.sin(a)).normalize();
      roots.push({ d: dir, w: .8 + r() * .7 });
      const start = dir.clone().multiplyScalar(R * 1.35); start.y *= P.squash;
      branch(start, dir, len, r0, 0, P.depth);
    }
    for (const b of P.branches) branch(b.start, b.dir, b.len, b.r0, 0, b.depth, false);
    // The soma: a small body drawn out into tapering arms where the dendrites and fibres leave, with the hollows between
    // them left concave and the whole thing lopsided, so it reads as a cell rather than a balloon.
    const soma = baseSoma().clone();
    const pos = soma.attributes.position, v = new THREE.Vector3(), s1 = r() * 6, s2 = r() * 6, s3 = r() * 6;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      let k = .78;
      for (const { d, w } of roots) { const c = Math.max(0, v.dot(d)), c2 = c * c, c4 = c2 * c2; k += w * (1.05 * c4 * c4 * c4 * c2 + .22 * c4); }
      k *= 1 + .16 * Math.sin(v.x * 1.9 + s1) * Math.sin(v.z * 2.1 + s2) + .07 * Math.sin(v.y * 3.2 + v.x * 2.4 + s3);
      pos.setXYZ(i, v.x * R * k, v.y * R * k * P.squash, v.z * R * k);
    }
    soma.computeVertexNormals();
    soma.setAttribute('along', new THREE.BufferAttribute(new Float32Array(pos.count), 1)); soma.setAttribute('bulb', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    const geo = mergeGeometries([soma, ...geos]);
    soma.dispose(); geos.forEach(g => g.dispose());

    const group = new THREE.Group();
    const mat = new THREE.ShaderMaterial({ vertexShader: MEMBRANE_VERT, fragmentShader: MEMBRANE_FRAG, transparent: true, depthWrite: false,
      uniforms: { uRim: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uBulb: { value: C.bulb.clone() }, uCoreAmt: { value: 0 }, uAlpha: { value: 1 }, uGrow: { value: 1 }, uFront: { value: 0 },
        uTime: { value: 0 }, uHi: { value: 0 }, uR: { value: R }, uSeed: { value: (n.seed % 1000) / 37 }, uShimmer: { value: 0 }, uSway: { value: 1 },
        // Not used by the cell itself: the fibres it grows read where it is.
        uCen: { value: n.pos.clone() }, uCen0: { value: n.rest.clone() }, uScl: { value: 1 } } });
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 1; group.add(mesh);
    // Crackle: jagged filaments from the core out into the dendrite roots.
    const lp = [], la = [], lph = [];
    for (let f = 0; f < P.filaments; f++) {
      const d = f % 4 === 3 && out ? out.d : roots[f % roots.length].d, ph = r(), K = 10;
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize(), sway = (r() - .5) * R * .7, wph = r() * 6, lift = (r() - .5) * R * .3;
      let prev = new THREE.Vector3((r() - .5) * R * .3, (r() - .5) * R * .2, (r() - .5) * R * .3);
      for (let k = 1; k <= K; k++) {
        const f2 = k / K, next = d.clone().multiplyScalar(R * (.15 + 1.75 * f2)).addScaledVector(side, sway * Math.sin(f2 * 2.4 + wph) * f2).add(new THREE.Vector3((r() - .5) * R * .06, lift * f2, (r() - .5) * R * .06));
        next.y *= P.squash;
        lp.push(prev.x, prev.y, prev.z, next.x, next.y, next.z); la.push((k - 1) / K, k / K); lph.push(ph, ph); prev = next;
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('along', new THREE.Float32BufferAttribute(la, 1)); lg.setAttribute('phase', new THREE.Float32BufferAttribute(lph, 1));
    const lineMat = new THREE.ShaderMaterial({ vertexShader: CRACKLE_VERT, fragmentShader: CRACKLE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uAmt: { value: 0 }, uTime: { value: 0 }, uRate: { value: 12 }, uStatic: { value: 0 } } });
    const lines = new THREE.LineSegments(lg, lineMat); lines.renderOrder = 3; group.add(lines);
    let ring = null;
    if (n.mode === 'plan' || n.mode === 'bypass') {
      ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ vertexShader: PLANE_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: (n.mode === 'plan' ? C.plan : C.bypass).clone() }, uDash: { value: n.mode === 'plan' ? 1 : 0 }, uTime: { value: 0 }, uAmt: { value: 1 } } }));
      ring.scale.setScalar(R * 3.4); ring.position.y = -R * .5; ring.renderOrder = 2; group.add(ring);
    }
    root.add(group);
    const alive = n.s.alive, target = n.kind === 'you' || n.kind === 'project' ? 1 : alive;
    const e = { n, R, i: list.length, nucR: R * .5, group, mesh, mat, lines, lineMat, ring, core: new THREE.Color(), rim: new THREE.Color(), amt: 0, base: 0, flash: 0, grow: target, front: 0,
      vis: n.pos.clone(), sc: 1, seedF: (n.seed % 1000) / 159 };
    neurons.set(n, e); list.push(e);
    return e;
  }
  for (const n of world.nodes) buildNeuron(n);
  const order = [...list.filter(e => e.n.kind === 'sub'), ...list.filter(e => e.n.kind === 'session'), ...list.filter(e => e.n.kind === 'project'), ...list.filter(e => e.n.kind === 'you')];

  // A fibre reads both of its cells' uniforms directly, so it always matches them where it joins.
  const fibreMaterial = (ua, ub, extra, reach) => {
    return new THREE.ShaderMaterial({ vertexShader: FIBRE_VERT, fragmentShader: FIBRE_FRAG, transparent: true, depthWrite: false, defines: reach ? { REACH: '' } : {},
      uniforms: { uTime: ua.uTime, uCenA: ua.uCen, uCen0A: ua.uCen0, uSclA: ua.uScl, uRA: ua.uR, uSeedA: ua.uSeed, uSwayA: ua.uSway, uRimA: ua.uRim, uHiA: ua.uHi, uAlphaA: ua.uAlpha,
        uCenB: ub.uCen, uCen0B: ub.uCen0, uSclB: ub.uScl, uRB: ub.uR, uSeedB: ub.uSeed, uSwayB: ub.uSway, uRimB: ub.uRim, uHiB: ub.uHi, uAlphaB: ub.uAlpha,
        uSide: { value: new THREE.Vector3() }, uPlan: { value: new THREE.Vector4(0, 0, .24, .76) }, uPulse: { value: new THREE.Vector4(-1, -1, -1, -1) }, uPulseCol: { value: PULSE[''].clone() },
        uFlash: { value: 0 }, uGrow: { value: 1 }, uFront: { value: 0 }, uBeadOn: { value: C.beadOn }, uBeadOff: { value: C.beadOff }, ...extra } });
  };
  const fibreOf = new Map();
  for (const lk of links) {
    lk.a = neurons.get(lk.n); lk.b = neurons.get(lk.n.parent);
    lk.mat = fibreMaterial(lk.a.mat.uniforms, lk.b.mat.uniforms, { uSkin: { value: lk.skin }, uLen: { value: lk.rest.L }, uMeander: { value: new THREE.Vector4(lk.amp, lk.waves, lk.speed, lk.mseed) } });
    lk.mesh = new THREE.Mesh(lk.rest.geometry, lk.mat); lk.mesh.renderOrder = 1.5; lk.mesh.frustumCulled = false; root.add(lk.mesh);
    fibreOf.set(lk.n, lk);
  }
  const reaches = reachSpecs.map(({ n, curve, L0 }) => {
    const P = shapeOf(n), U = shapeOf(world.you);
    // Rings packed where the resting dendrite and the bouton at You are.
    const restLen = P.len * .85, g0 = Math.min(.5, restLen * 1.15 / L0), us = [];
    for (let i = 0; i < 26; i++) us.push(g0 * i / 26);
    for (let i = 0; i < 44; i++) us.push(g0 + (.94 - g0) * i / 44);
    for (let i = 0; i <= 12; i++) us.push(.94 + .06 * i / 12);
    const rest = restFibre(curve, us, 6, () => 1);
    const rc = { n, rest, a: neurons.get(n), b: neurons.get(world.you), skin: new THREE.Vector2(Math.min(.3, P.R * 1.6 / rest.L), 1 - Math.min(.3, U.R * 1.4 / rest.L)), side: new THREE.Vector3(),
      amp: Math.min(1.1, rest.L * .05) * .7, waves: kit.clamp(rest.L / 6, 1.2, 4), speed: .9, mseed: (n.seed % 89) / 13, lift: 0, tip: .18 / rest.L };
    rc.mat = fibreMaterial(rc.a.mat.uniforms, rc.b.mat.uniforms, { uSkin: { value: rc.skin }, uLen: { value: rest.L }, uMeander: { value: new THREE.Vector4(rc.amp, rc.waves, rc.speed, rc.mseed) },
      uReach: { value: 0 }, uRest: { value: restLen / rest.L }, uGrowA: neurons.get(n).mat.uniforms.uGrow, uR0: { value: P.R * .3 }, uLenD: { value: restLen / rest.L }, uTip: { value: rc.tip },
      uTipR: { value: .12 }, uTipM: { value: .4 }, uLift: { value: 0 }, uGold: { value: C.gold }, uGoldAmt: { value: 1 }, uFlow: { value: 0 }, uFlowSpeed: { value: 4 } }, true);
    rc.mesh = new THREE.Mesh(rest.geometry, rc.mat); rc.mesh.renderOrder = 1.5; rc.mesh.frustumCulled = false; root.add(rc.mesh);
    rc.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.gold.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    rc.glow.renderOrder = 3; rc.glow.visible = false; root.add(rc.glow);
    return rc;
  });
  // Where a fibre's centreline is now (without the warp): the same skin and meander the shader applies.
  const skinA = new THREE.Vector3(), skinB = new THREE.Vector3();
  function fibrePoint(f, u, out) {
    f.rest.at(u, out);
    const x = kit.clamp((u - f.skin.x) / Math.max(1e-3, f.skin.y - f.skin.x)), w = x * x * (3 - 2 * x);
    skinA.subVectors(out, f.a.mat.uniforms.uCen0.value).multiplyScalar(f.a.sc).add(f.a.vis);
    skinB.subVectors(out, f.b.mat.uniforms.uCen0.value).multiplyScalar(f.b.sc).add(f.b.vis);
    out.lerpVectors(skinA, skinB, w);
    const e1 = Math.sin(Math.PI * x), env = e1 * e1, ph = x * f.waves * Math.PI, t = anim * f.speed, sd = f.mseed;
    const s = env * (Math.sin(ph - t + sd) + .35 * Math.sin(ph * 2.3 + t * .6 + sd * 3)) * f.amp * .85;
    return out.set(out.x + f.side.x * s, out.y + env * Math.sin(ph * .7 + t * .8 + sd * 2) * f.amp * .4 + f.lift * env, out.z + f.side.z * s);
  }
  const sideOf = f => { tmp.subVectors(f.b.vis, f.a.vis).setY(0); const L = tmp.length() || 1; f.side.set(-tmp.z / L, 0, tmp.x / L); };

  // ── You's usage limits: arc gauges under You, and their labels drawn after the bloom so the text stays crisp ──
  const ye = () => neurons.get(world.you);
  const usage = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ vertexShader: PLANE_VERT, fragmentShader: USAGE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uArc: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) }, uN: { value: 0 } } }));
  const UR = ye().R * 4.4;
  usage.scale.setScalar(UR * 2); usage.position.y = -ye().R * .55; usage.renderOrder = 2; ye().group.add(usage);
  const overlay = new THREE.Scene(), overlayPass = ctx.addPass(new RenderPass(overlay, ctx.camera));
  overlayPass.clear = false;
  const tags = new Map();
  const level = u => u > .86 ? '#ff6474' : u > .6 ? '#ffc04a' : '#86e2ff';
  function drawTag(tag, acc, right) {
    const parts = acc.windows.map(w => [`${w.label} `, `${Math.round(w.used * 100)}%`, level(w.used)]);
    if (acc.spend?.limit > 0) parts.push(['$', `${Math.round(acc.spend.spent)}/${Math.round(acc.spend.limit)}`, level(acc.spend.spent / acc.spend.limit)]);
    const name = acc.label.replace('Claude Code', 'Claude').toUpperCase(), fonts = document.fonts?.check?.('24px "IBM Plex Mono"') ? 1 : 0;
    const key = `${name}|${parts.map(p => p[0] + p[1]).join(' ')}|${right}|${fonts}`;
    if (tag.key === key) return;
    tag.key = key;
    const c = tag.canvas, g = c.getContext('2d'), mono = '500 24px "IBM Plex Mono", ui-monospace, monospace', head = '600 19px Sora, system-ui, sans-serif', sp = 20;
    g.font = mono; const widths = parts.map(([a, b]) => g.measureText(a + b).width), line = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * sp;
    g.font = head; g.letterSpacing = '2px'; const nw = g.measureText(name).width;
    const pad = 14, W = Math.ceil(Math.max(nw, line)) + pad * 2, H = 64;
    c.width = W; c.height = H;
    // A soft dark wash under the text, so You's glow and the arcs don't eat into it.
    g.shadowColor = 'rgba(2, 5, 17, .9)'; g.shadowBlur = 10; g.fillStyle = 'rgba(2, 5, 17, .5)'; g.beginPath(); g.roundRect(8, 6, W - 16, H - 12, 14); g.fill();
    g.textBaseline = 'alphabetic'; g.shadowColor = '#020511'; g.shadowBlur = 8;
    g.font = head; g.letterSpacing = '2px'; g.fillStyle = '#93a9de'; g.fillText(name, right ? pad : W - pad - nw, 22);
    g.letterSpacing = '0px'; g.font = mono;
    let x = right ? pad : W - pad - line;
    parts.forEach(([a, b, col], i) => { g.fillStyle = '#7086bd'; g.fillText(a, x, 55); g.fillStyle = col; g.fillText(b, x + g.measureText(a).width, 55); x += widths[i] + sp; });
    tag.tex.needsUpdate = true; tag.aspect = W / H;
  }
  // Accounts split down both sides of You, filling from the top, so the readouts never sit on You's own label below.
  function updateUsage() {
    const accs = world.usage.filter(a => a.windows.length || a.spend?.limit > 0).slice(0, 6), arcs = usage.material.uniforms.uArc.value, y = ye();
    const px = 2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2)) / ctx.size.h, lh = ctx.size.w < 700 ? 26 : 32, half = Math.ceil(accs.length / 2), gap = .1;
    let i = 0;
    accs.forEach((acc, k) => {
      const right = k >= half, j = right ? k - half : k, per = right ? accs.length - half : half, w = (2.1 - gap * (per - 1)) / per;
      const lo = .3 + j * (w + gap), hi = lo + w, a0 = right ? lo : -hi, a1 = right ? hi : -lo;
      const bands = [...acc.windows.map(x => x.used), ...(acc.spend?.limit > 0 ? [Math.min(1, acc.spend.spent / acc.spend.limit)] : [])];
      bands.forEach((u, b) => { if (i < 10) arcs[i++].set(a0, a1, y.R * (2.7 + .34 * b) / UR, right ? u : -u); });
      let tag = tags.get(acc.id);
      if (!tag) {
        const canvas = document.createElement('canvas'), tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
        tag = { canvas, tex, sprite, key: '', aspect: 4 }; overlay.add(sprite); tags.set(acc.id, tag);
      }
      drawTag(tag, acc, right);
      const mid = (a0 + a1) / 2, r = y.R * (2.7 + .34 * bands.length + .65) * y.sc;
      tag.sprite.center.set(right ? 0 : 1, .5);
      tag.sprite.position.set(y.vis.x + Math.sin(mid) * r, y.vis.y - y.R * .55, y.vis.z - Math.cos(mid) * r);
      tag.sprite.scale.set(lh * px * tag.aspect, lh * px, 1);
      tag.sprite.visible = true; tag.seen = true;
    });
    for (const tag of tags.values()) { if (!tag.seen) tag.sprite.visible = false; tag.seen = false; }
    usage.material.uniforms.uN.value = i;
  }

  // ── Screenshots: a vesicle on its own dendrite, clickable to open the viewer ──
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const shots = shotSpecs.map(({ n, V0, neck, curve, L0 }) => {
    const P = shapeOf(n), e = neurons.get(n), ua = e.mat.uniforms, restLen = Math.min(P.len * .6, L0 * .55), g0 = restLen / L0, us = [];
    for (let i = 0; i < 18; i++) us.push(g0 * 1.1 * i / 18);
    for (let i = 0; i <= 22; i++) us.push(g0 * 1.1 + (1 - g0 * 1.1) * i / 22);
    const rest = restFibre(curve, us, 6, () => 1), pos = V0.clone();
    // The vesicle end of the dendrite rides with the vesicle, which floats rigidly beside its session and doesn't warp.
    const ub = { uCen: { value: pos }, uCen0: { value: V0 }, uScl: { value: 1 }, uR: { value: .45 }, uSeed: ua.uSeed, uSway: { value: 0 }, uRim: ua.uRim, uHi: ua.uHi, uAlpha: ua.uAlpha };
    const sh = { n, rest, pos, V0, a: e, b: { mat: { uniforms: ub }, sc: 1, vis: pos }, skin: new THREE.Vector2(Math.min(.35, P.R * 1.6 / rest.L), .8), side: new THREE.Vector3(),
      amp: .12, waves: 1.2, speed: .6, mseed: (n.seed % 53) / 9, lift: 0, k: 0, last: null, tex: null, canvas: null, img: new THREE.Vector2(1, .7), off: new THREE.Vector2() };
    sh.mat = fibreMaterial(ua, ub, { uSkin: { value: sh.skin }, uLen: { value: rest.L }, uMeander: { value: new THREE.Vector4(sh.amp, sh.waves, sh.speed, sh.mseed) },
      uReach: { value: 0 }, uRest: { value: g0 }, uGrowA: ua.uGrow, uR0: { value: P.R * .3 }, uLenD: { value: g0 }, uTip: { value: .1 }, uTipR: { value: 0 }, uTipM: { value: .62 }, uLift: { value: 0 },
      uGold: { value: C.gold }, uGoldAmt: { value: 0 }, uFlow: { value: 0 }, uFlowSpeed: { value: 0 } }, true);
    sh.mesh = new THREE.Mesh(rest.geometry, sh.mat); sh.mesh.renderOrder = 1.5; sh.mesh.frustumCulled = false; root.add(sh.mesh);
    // Drawn before the cells, so a dendrite passing in front of it, its own included, lies over it.
    sh.cell = new THREE.Mesh(cardGeo, new THREE.ShaderMaterial({ vertexShader: VESICLE_VERT, fragmentShader: VESICLE_FRAG, transparent: true, depthWrite: false,
      uniforms: { uCenter: { value: pos }, uOval: { value: OVAL }, uImg: { value: sh.img }, uOff: { value: sh.off }, uNeck: { value: neck }, uRim: ua.uRim, uHi: ua.uHi, uAmt: { value: 0 }, uTime: ua.uTime, uSeed: ua.uSeed, uMap: { value: null } } }));
    sh.cell.renderOrder = .9; sh.cell.frustumCulled = false; sh.cell.visible = false; root.add(sh.cell);
    ctx.addTarget({ node: n, pos, radius: 1.4, action: 'shots' });
    return sh;
  });
  // The newest screenshot fitted into the vesicle, its count on a small vesicle of its own in the corner. Only when it changes.
  function drawShot(sh, shot) {
    const b = shot.bitmap, W = b.width, H = b.height;
    if (!sh.canvas) {
      sh.canvas = document.createElement('canvas'); sh.tex = new THREE.CanvasTexture(sh.canvas);
      sh.tex.colorSpace = THREE.SRGBColorSpace; sh.tex.minFilter = THREE.LinearMipmapLinearFilter; sh.cell.material.uniforms.uMap.value = sh.tex;
    }
    const c = sh.canvas, g = c.getContext('2d');
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; sh.tex.dispose(); }
    g.drawImage(b, 0, 0, W, H);
    // Most of the way to covering the oval, cropping what spills over; a tall shot keeps its top, where a screen's content
    // usually is. The count sits inside the oval's lower right, where the lens puts it.
    const kc = Math.min(OVAL.x * 2 / W, OVAL.y * 2 / H), k = kc + (Math.max(OVAL.x * 2 / W, OVAL.y * 2 / H) - kc) * .55;
    sh.img.set(W * k / 2, H * k / 2); sh.off.set(0, -Math.max(0, sh.img.y - OVAL.y * .95));
    if (shot.count > 1) {
      const ux = (OVAL.x * .55 * .93 - sh.off.x) / (2 * sh.img.x), uy = (-OVAL.y * .5 * .93 - sh.off.y) / (2 * sh.img.y);
      const r = Math.round(Math.min(W / sh.img.x, H / sh.img.y) * .13), x = W * (.5 + ux), y = H * (.5 - uy);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = 'rgba(4, 7, 26, .82)'; g.fill(); g.lineWidth = Math.max(2, r * .12); g.strokeStyle = '#79c6ff'; g.stroke();
      g.fillStyle = '#e8f4ff'; g.font = `500 ${Math.round(r * 1.1)}px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(shot.count), x, y + r * .06);
    }
    sh.tex.needsUpdate = true;
  }
  function updateShot(sh, dt) {
    const n = sh.n, e = sh.a, shot = ctx.shot(n), u = sh.mat.uniforms;
    if (shot && shot !== sh.last) { drawShot(sh, shot); sh.last = shot; }
    sh.k = kit.damp(sh.k, shot && n.s.alive > .5 ? 1 : 0, ctx.reduced ? 12 : 3, dt);
    sh.mesh.visible = e.group.visible;
    sh.pos.subVectors(sh.V0, n.rest).multiplyScalar(e.sc).add(e.vis);
    if (!ctx.reduced) sh.pos.y += Math.sin(anim * .9 + e.seedF) * .07;
    sideOf(sh); u.uSide.value.copy(sh.side);
    const k = kit.easeOutCubic(sh.k); u.uReach.value = k;
    sh.cell.visible = k > .01 && e.group.visible && !!sh.tex;
    if (!sh.cell.visible) return;
    sh.cell.material.uniforms.uAmt.value = k * Math.min(1, n.s.alive * 1.4);
  }

  // ── Ripples: finish, compaction, answers, spawns and errors ──
  const ripples = Array.from({ length: 14 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ vertexShader: PLANE_VERT, fragmentShader: RIPPLE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uProg: { value: 0 }, uAmt: { value: 1 } } }));
    m.visible = false; m.renderOrder = 4; root.add(m);
    return { m, node: null, t: 1, dur: 1, max: 4 };
  });
  let rippleNext = 0;
  function ripple(n, color, amt = 1, scale = 6) {
    const r = ripples[rippleNext++ % ripples.length], e = neurons.get(n);
    r.node = n; r.t = 0; r.dur = ctx.reduced ? .6 : 1.25; r.max = e.R * scale;
    r.m.material.uniforms.uColor.value.copy(color); r.m.material.uniforms.uAmt.value = amt; r.m.visible = true;
  }

  // ── Per-frame ──
  function updateNeuron(e, dt) {
    const { n, mat, lineMat } = e, s = n.s, reduced = ctx.reduced, u = mat.uniforms;
    const alive = s.alive;
    e.group.visible = alive > .01;
    let crackle = 0, rate = 12;
    if (n.kind === 'session' || n.kind === 'sub') {
      blend(n, CORE, e.core); blend(n, RIM, e.rim);
      let amt = activity(n);
      e.base = amt;
      if (!reduced) {
        amt *= 1 + s.wait * (.5 * Math.sin(anim * 2.4 + e.seedF) - .1);
        if (s.error > .3) amt *= hash(Math.floor(anim * 15) + e.seedF) > .45 ? 1.2 : .2;
        const beat = Math.pow(.5 + .5 * Math.sin(anim * (3 + s.urgency * 5) + e.seedF), 4);
        amt += s.need * beat * .5 * (1 + s.urgency * .8);
      } else amt += s.need * .25 * (1 + s.urgency);
      amt += s.heat * .2;
      crackle = s.work * 1 + s.error * 1.1 + s.think * .35 + s.need * .55 + s.compact * .2;
      rate = 11 + s.error * 18 + s.heat * 6;
      e.amt = amt;
      // Context fill is the nucleus: it grows as the context does, and shrinks while compacting.
      const ctxR = .26 + .44 * (s.ctx ?? n.ctx);
      e.nucR = e.R * ctxR * (1 - .25 * s.compact);
      const target = Math.min(kit.lerp(1, .38, s.off), kit.smoothstep(.05, .95, alive));
      e.grow = kit.damp(e.grow, target, target > e.grow ? 2.4 : 3, dt);
      e.front = kit.clamp((target - e.grow) * 10, 0, 1);
    } else if (n.kind === 'project') {
      e.core.setRGB(0, 0, 0); let tot = 0, sum = 0, need = 0;
      for (const ss of n.sessions) {
        const se = neurons.get(ss); if (ss.s.alive < .05) continue;
        const w = se.base * se.base + .02; e.core.r += se.core.r * w; e.core.g += se.core.g * w; e.core.b += se.core.b * w; tot += w; sum += se.base * ss.s.alive; need = Math.max(need, ss.s.need);
      }
      if (tot > 0) e.core.multiplyScalar(1 / tot);
      e.rim.copy(C.rimProject).lerp(RIM.need, need * .5);
      e.amt = .2 + Math.min(.8, sum * .32);
      crackle = Math.min(1, sum * .3);
      e.nucR = e.R * .5;
    } else {
      let need = 0, urg = 0; for (const ss of world.sessions) if (ss.s.alive > .5) { need = Math.max(need, ss.s.need); urg = Math.max(urg, ss.s.urgency * ss.s.need); }
      e.core.copy(C.youCalm).lerp(CORE.need, need); e.rim.copy(C.rimProject).lerp(RIM.need, need * .6);
      const beat = reduced ? .5 : Math.pow(.5 + .5 * Math.sin(anim * (2.6 + urg * 4)), 6);
      e.amt = .32 + need * (.15 + beat * .35 * (1 + urg));
      crackle = need * .6;
      e.nucR = e.R * .52;
    }
    e.amt += e.flash; e.flash = Math.max(0, e.flash - dt * 2);
    let sc = n.kind === 'sub' ? kit.easeOutBack(alive) : n.kind === 'session' ? kit.easeOutCubic(alive) : 1;
    sc *= 1 - .16 * s.compact;
    if (!reduced) sc *= 1 + .022 * Math.sin(anim * 1.3 + e.seedF);
    sc *= 1 + Math.min(e.flash, 1) * .1;
    e.sc = Math.max(.001, sc);
    e.group.scale.setScalar(e.sc);
    e.vis.copy(n.pos); e.vis.y += .5 * s.hover + .3 * s.select;
    e.group.position.copy(e.vis);
    const hi = s.hover * .55 + s.select * .4;
    u.uRim.value.copy(e.rim); u.uCore.value.copy(e.core); u.uCoreAmt.value = e.amt; u.uGrow.value = n.kind === 'you' || n.kind === 'project' ? 1 : e.grow; u.uFront.value = e.front;
    u.uAlpha.value = (n.kind === 'sub' ? Math.min(1, alive * 1.4) : 1) * (1 - .2 * s.off); u.uTime.value = anim; u.uHi.value = hi; u.uShimmer.value = s.think; u.uSway.value = reduced ? 0 : 1 - s.off * .8;
    u.uCen.value.copy(e.vis); u.uScl.value = e.sc;
    u.uBulb.value.copy(C.bulb).multiplyScalar(1 - .75 * s.off + hi * .5);
    lineMat.uniforms.uColor.value.copy(e.core).lerp(C.gold, s.error > .5 ? 0 : .45); lineMat.uniforms.uAmt.value = crackle * alive; lineMat.uniforms.uTime.value = anim;
    lineMat.uniforms.uRate.value = rate; lineMat.uniforms.uStatic.value = reduced ? 1 : 0; e.lines.visible = crackle > .02;
    tmpC.copy(e.core).multiplyScalar(e.amt * (1 - s.off)).lerp(C.ash, s.off); nuclei.setColorAt(e.i, tmpC);
    tmpQ.identity(); tmpM.compose(e.vis, tmpQ, tmpS.setScalar(Math.max(1e-4, e.nucR * e.sc))); nuclei.setMatrixAt(e.i, tmpM);
    tmpC.copy(e.core).multiplyScalar(Math.min(.6, e.amt * .2 + hi * .15) * alive * (1 - s.off)); halos.setColorAt(e.i, tmpC);
    tmpM.compose(e.vis, tmpQ, tmpS.setScalar(e.R * (2.6 + 1.4 * Math.min(e.amt, 1.5)) * .5 * (e.group.visible ? 1 : 0) + 1e-4)); halos.setMatrixAt(e.i, tmpM);
    if (e.ring) { e.ring.material.uniforms.uTime.value = anim; e.ring.material.uniforms.uAmt.value = alive * (.5 + hi) * (1 - s.off * .6); }
  }

  function updateLink(lk, dt) {
    const n = lk.n, s = n.s, u = lk.mat.uniforms, alive = n.kind === 'project' ? 1 : s.alive;
    lk.mesh.visible = alive > .01;
    if (!lk.mesh.visible) { lk.pulses.list.length = 0; return; }
    sideOf(lk); u.uSide.value.copy(lk.side);
    const grow = n.kind === 'project' ? 1 : n.kind === 'sub' ? alive : kit.easeOutCubic(alive);
    u.uGrow.value = Math.max(.02, grow); u.uFront.value = kit.clamp((1 - grow) * 6);
    // Advance pulses in place (kit's Pulses.update builds two arrays per call).
    const L = lk.pulses.list;
    for (let i = L.length - 1; i >= 0; i--) { const p = L[i]; p.t += p.speed * dt; if (p.t >= 1) { L.splice(i, 1); arrive(lk, p); } }
    lk.pulses.vec4(u.uPulse.value);
    if (lk.steps) u.uPlan.value.set(alive > .6 ? lk.steps : 0, Math.round(n.plan.done / n.plan.total * lk.steps), .24, .76);
    u.uFlash.value = lk.flash; lk.flash = Math.max(0, lk.flash - dt * 2.5);
  }
  function arrive(lk, p) {
    const pe = neurons.get(lk.n.parent);
    pe.flash = Math.min(1.2, pe.flash + (lk.n.parent.kind === 'you' ? .18 : .3));
    if (lk.n.parent.kind === 'project' && hash(p.t * 13 + lk.rest.L) < .55) fire(fibreOf.get(lk.n.parent), p.data);
    else if (lk.n.parent.kind === 'session' || lk.n.parent.kind === 'sub') fire(fibreOf.get(lk.n.parent), p.data);
  }
  // Only a cell that is really at work fires up its axon: an idle, waiting or offline one rests, even when its subagents are busy.
  const FIRING = new Set(['working', 'thinking', 'compacting']);
  function fire(lk, kind) {
    if (!lk || (lk.n.kind !== 'project' && !FIRING.has(lk.n.status))) return;
    if (ctx.reduced) { lk.flash = .8; neurons.get(lk.n.parent).flash += .2; return; }
    lk.pulses.add(Math.min(1.8, 12 / Math.max(lk.rest.L, 1)), 1, kind);
    lk.mat.uniforms.uPulseCol.value.copy(PULSE[kind] || PULSE['']);
  }

  function updateReach(rc, dt) {
    const n = rc.n, s = n.s, e = rc.a, u = rc.mat.uniforms, need = s.alive > .5 ? s.need : 0, k = kit.easeOutCubic(need);
    rc.mesh.visible = e.group.visible;
    sideOf(rc); u.uSide.value.copy(rc.side);
    // The longer it waits, the higher it arches and the faster the gold runs along it.
    rc.lift = k * s.urgency * 1.6; u.uLift.value = rc.lift;
    u.uReach.value = k; u.uFlow.value = (.75 + s.urgency * .5) * k; u.uFlowSpeed.value = ctx.reduced ? 0 : 4 + s.urgency * 9;
    const beat = ctx.reduced ? .5 : Math.pow(.5 + .5 * Math.sin(anim * (4 + s.urgency * 6) + e.seedF), 3);
    u.uTipR.value = .1 + beat * .05 * (1 + s.urgency);
    rc.glow.visible = k > .01 && rc.mesh.visible;
    if (!rc.glow.visible) return;
    fibrePoint(rc, kit.lerp(u.uRest.value * u.uGrowA.value, 1, k) - rc.tip, rc.glow.position);
    rc.glow.scale.setScalar(1.2 + beat * (1 + s.urgency * 1.5)); rc.glow.material.opacity = k * (.5 + beat * .45);
  }

  function updateRipples(dt) {
    for (const r of ripples) {
      if (!r.m.visible) continue;
      r.t += dt / r.dur;
      if (r.t >= 1) { r.m.visible = false; continue; }
      const e = neurons.get(r.node), p = kit.easeOutCubic(r.t);
      r.m.position.copy(e.vis); r.m.position.y -= .25;
      r.m.scale.setScalar(r.max * 2);
      r.m.material.uniforms.uProg.value = p;
    }
  }

  return {
    update(dt) {
      if (!ctx.reduced) anim += dt;
      nebula.material.uniforms.uTime.value = anim; bokehMat.uniforms.uTime.value = anim;
      for (const e of order) updateNeuron(e, dt);
      nuclei.material.uniforms.uTime.value = anim;
      for (const im of [nuclei, halos]) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
      for (const lk of links) updateLink(lk, dt);
      for (const rc of reaches) updateReach(rc, dt);
      for (const sh of shots) updateShot(sh, dt);
      updateUsage();
      updateRipples(dt);
    },
    event(type, n, data) {
      const e = neurons.get(n); if (!e) return;
      if (type === 'tool' && (n.kind === 'session' || n.kind === 'sub')) { fire(fibreOf.get(n), data.kind); e.flash = Math.min(1, e.flash + .22); }
      else if (type === 'finish') { ripple(n, C.cyan, 1); e.flash = .9; }
      else if (type === 'compacted') { ripple(n, C.violet, 1); e.flash = 1.2; }
      else if (type === 'need') ripple(n, C.gold, .9, 5);
      else if (type === 'answer') { ripple(n, C.gold, .8); ripple(world.you, C.gold, .7, 4); ye().flash = .8; }
      else if (type === 'spawn') { ripple(n, C.cyan, .7, 4); e.grow = Math.min(e.grow, .02); }
      else if (type === 'state' && data.to === 'error') ripple(n, C.red, 1);
    },
    // The usage labels live outside root, in the overlay drawn after the bloom.
    dispose() {
      for (const t of tags.values()) { t.tex.dispose(); t.sprite.material.dispose(); }
      overlay.clear();
    },
  };
}

export default {
  id: 'neurons',
  name: 'Neurons',
  css: `
body[data-look="neurons"] {
  --bg: #02050f; --fg: #e8f0ff; --muted: #8a9cc4; --panel: rgba(8, 15, 38, .74); --line: rgba(130, 175, 255, .16); --accent: #79c6ff;
  --need: #ffc93c; --work: #ff8c4f; --err: #ff4d6d; --wait: #5cb8ff;
  --font: "Sora", system-ui, sans-serif; --display: "Sora", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, monospace;
  --radius: 14px; --shadow: 0 12px 40px rgba(0, 4, 20, .55), 0 0 28px rgba(70, 130, 255, .07); --blur: 16px;
  --label: #eef4ff; --label-sub: #9fb4dc; --label-halo: rgba(2, 5, 18, .95);
}
body[data-look="neurons"] :is(.nodes-tip, .nodes-overlay button) { border-color: rgba(140, 185, 255, .2); box-shadow: inset 0 0 0 1px rgba(121, 198, 255, .06), inset 0 0 22px -12px rgba(121, 198, 255, .45), var(--shadow); }
body[data-look="neurons"] .nodes-tip { border-radius: 18px 22px 20px 16px / 18px 16px 22px 20px; }
body[data-look="neurons"] .nodes-overlay button { border-radius: 99px; background: radial-gradient(120% 90% at 28% 18%, rgba(255, 255, 255, .06), transparent 45%), var(--panel); }
body[data-look="neurons"] .nodes-tip .dot { box-shadow: 0 0 8px var(--c, var(--need)); }
/* Labels float on a small membrane of their own: dark cytoplasm, a lit rim, gold or red when the cell needs you or misfired. */
body[data-look="neurons"] .lbl { gap: 1px; padding: 3px 10px 4px; border-radius: 13px 15px 14px 12px / 12px 11px 14px 13px; background: radial-gradient(120% 120% at 30% 0%, rgba(44, 70, 170, .32), transparent 65%), rgba(4, 7, 26, .74);
  box-shadow: inset 0 0 0 1px rgba(121, 198, 255, .16), inset 0 0 12px -5px rgba(121, 198, 255, .4), 0 4px 14px -6px rgba(0, 0, 0, .8); text-shadow: none; }
body[data-look="neurons"] .lbl b { font-weight: 500; letter-spacing: .01em; }
body[data-look="neurons"] .lbl.project { padding: 1px 8px 2px; border-radius: 99px; background: rgba(4, 7, 26, .6); box-shadow: inset 0 0 0 1px rgba(121, 198, 255, .1); }
body[data-look="neurons"] .lbl.you { background: radial-gradient(120% 120% at 50% 0%, rgba(255, 190, 110, .2), transparent 65%), rgba(4, 7, 26, .74); box-shadow: inset 0 0 0 1px rgba(255, 214, 150, .22), inset 0 0 12px -5px rgba(255, 190, 110, .4), 0 4px 14px -6px rgba(0, 0, 0, .8); }
body[data-look="neurons"] .lbl.you b { color: #ffe6b0; }
body[data-look="neurons"] .lbl.need { background: radial-gradient(120% 120% at 30% 0%, rgba(255, 201, 60, .2), transparent 65%), rgba(12, 9, 20, .8); box-shadow: inset 0 0 0 1px rgba(255, 201, 60, .45), inset 0 0 12px -4px rgba(255, 201, 60, .45), 0 0 16px -6px rgba(255, 201, 60, .6); }
body[data-look="neurons"] .lbl.error { box-shadow: inset 0 0 0 1px rgba(255, 77, 109, .5), inset 0 0 12px -4px rgba(255, 77, 109, .45), 0 0 14px -6px rgba(255, 77, 109, .6); }
body[data-look="neurons"] .nodes-overlay .nodes-next { box-shadow: 0 0 16px rgba(255, 201, 60, .3), var(--shadow); animation: neurons-beat 1.3s ease-in-out infinite; }
@keyframes neurons-beat { 0%, 40%, 100% { box-shadow: 0 0 10px rgba(255, 201, 60, .2), var(--shadow); } 12% { box-shadow: 0 0 22px rgba(255, 201, 60, .55), var(--shadow); } }
@media (prefers-reduced-motion: reduce) { body[data-look="neurons"] .nodes-overlay .nodes-next { animation: none; } }`,
  create,
};
