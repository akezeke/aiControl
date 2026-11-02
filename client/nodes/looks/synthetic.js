// Synthetic: a dark circuit board. Sessions are chips with a dot-matrix display beside them (name over what it's doing),
// projects small switches where their sessions' traces fan out (a port LED per session, toward it), You a reactor core with
// its own display and an instrument card per account round it (seven-segment readouts over LED bars). Every chip is
// generated from its id (package, pins, marking, footprint, passives), so a session keeps its chip on every screen. Traces
// route at right angles with chamfered corners and parts are placed clear of them; every tool call fires a packet up the
// copper to the core, a session that needs you lights its own line and its project's interrupt line amber and streams
// interrupts along them, and a finish sends a shockwave through the board.
// Parts, faces, footprints, packets, vias, glows, rings and lamps are each one instanced draw; all traces are one dynamic mesh.
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PAL = { work: '#2dffa0', think: '#36d6ff', compact: '#a47bff', need: '#ffab1a', wait: '#3d7bff', idle: '#4f6170', error: '#ff2d4b', off: '#151b21' };
const DKEYS = ['work', 'think', 'compact', 'need', 'wait', 'idle', 'error', 'off']; // project port codes are index + 1; 0 = no session
const TOOL = { edit: '#26e6ff', read: '#4d8dff', search: '#4dffb8', bash: '#ffd34d', web: '#ff5fd2', agent: '#b78bff', '': '#26e6ff' };
const CYAN = '#26e6ff', RED = '#ff2d4b';
const KIND = { session: 0, sub: 1, project: 2 };
const PROV = { claude: 0, codex: 1, opencode: 2 };
const TILE = 30, TRACE_Y = .012, DECAL_Y = .004;

// Part meshes (rounded moulding for packages, plain boxes for passives), and the colours parts are made in.
const EPOXY = 0, METAL = 1, LEAD = 2, CAN = 3, BOX = 4;
const MOLD = [0x0f1317, 0x0b0e11, 0x16181b, 0x10161f, 0x1b1c1f], CERAMIC = [0x2c3035, 0x463f35];
const SUBSTRATE = [0x1b3a29, 0x3a2918, 0x152438, 0x232a26], SILICON = 0x17142c;
const TIN = 0xc5ccd2, NICKEL = 0x9aa1a7, COPPER = 0xb5703a, GOLDLID = 0xb59c5c;
const SLEEVE = [0x2c2150, 0x111418, 0x1b2f57, 0x173826], CAPS = [0x8f7250, 0x6d604f, 0x7a6a58], RES = 0x121315, TANT = 0xc28f1c;
const needs = n => n.status === 'permission' || n.status === 'question';
const NX = [1, 0, -1, 0], NZ = [0, 1, 0, -1], RY = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const SMD = { cap: [.075, .042, .05], res: [.075, .04, .035], tant: [.1, .06, .065], tiny: [.045, .024, .028] };
const PREFIX = { claude: 'CL', codex: 'CX', opencode: 'OC' };
// Dot-matrix displays: glass height in board units, and their canvases (two 32 px lines of 24 px mono, 14.4 px a character).
const DISP_PX = 64, DISP_ADV = 14.4, NAME_EM = .78, YOU_W = 3.6, YOU_H = 1.55, GLASS_Y = .106;
// One display per kind: glass height and width in board units, characters across (canvas width = view px).
const glass = (h, chars) => ({ h, w: h * (chars * DISP_ADV + 24) / DISP_PX, view: chars * DISP_ADV + 24 });
const DISPLAYS = { session: glass(1.8, 15), sub: glass(1.2, 12) };
// Screenshot modules: an LCD the shape of the 512×320 thumbnails (active area SHOT_W × SHOT_H) on its own board (LCD_W × LCD_D).
const SHOT_W = 2.8, SHOT_H = 1.75, LCD_W = SHOT_W + .62, LCD_D = SHOT_H + .95, LCD_Z_REL = -LCD_D / 2 + .18 + SHOT_H / 2 + .12;
const FONT = '"JetBrains Mono", ui-monospace, monospace', DISPLAY = '"Chakra Petch", "JetBrains Mono", ui-monospace, sans-serif';

// Usage cards, one per account in You's corners: a row per window (and for spend) with a big seven-segment readout over a
// thin LED bar. Laid out in card units and scaled up as far as the board round You leaves room.
const MAXU = 4, ROWS = 3, LEDS = 20, DIG = 4, SEG = 8, PER_ROW = LEDS + DIG * SEG, PER_CARD = ROWS * PER_ROW;
const CARD_W = 4.6, CARD_DMAX = 3.1, CARD_PX = 512, CARD_H = 512, CARD_K = CARD_PX / CARD_W, CARD_D = CARD_H / CARD_K, GAP = 2.05, SCALES = [2, 1.8, 1.6, 1.4, 1.2, 1, .9];
const DW = .17, DH = .31, ST = .036; // digit half width, half height, segment half thickness
// a..g and the point: x, z, half length, half thickness, upright, hexagonal
const SEGS = [[0, -DH + ST, DW - ST * 1.3, ST, 0, 1], [DW - ST, -DH / 2, DH / 2 - ST * 1.3, ST, 1, 1], [DW - ST, DH / 2, DH / 2 - ST * 1.3, ST, 1, 1], [0, DH - ST, DW - ST * 1.3, ST, 0, 1],
  [-DW + ST, DH / 2, DH / 2 - ST * 1.3, ST, 1, 1], [-DW + ST, -DH / 2, DH / 2 - ST * 1.3, ST, 1, 1], [0, 0, DW - ST * 1.3, ST, 0, 1], [DW + ST * 2.4, DH - ST, ST, ST, 0, 0]];
const DIGITS = { 0: 0x3f, 1: 0x06, 2: 0x5b, 3: 0x4f, 4: 0x66, 5: 0x6d, 6: 0x7d, 7: 0x07, 8: 0x7f, 9: 0x6f, '-': 0x40 };

const INST_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vC;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#else
  vC = vec3(1.);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}`;
const UV_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

const FACE_VERT = /* glsl */`
attribute vec4 iA, iB, iC, iD, iE, iCol, iF, iG;
varying vec4 vUv, vA, vB, vC, vD, vE, vCol, vG;
void main() {
  vUv = vec4(uv, iF.xy + uv * iF.zw); vA = iA; vB = iB; vC = iC; vD = iD; vE = iE; vCol = iCol; vG = iG;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}`;
// One shader for every chip top, in face units (the shorter half side is 1; iG.xy is the half size). Sessions and subagents:
// a die window whose pattern is the state, a context LED bar, plan LEDs, power and activity LEDs, a provider mark and a mode
// LED. Projects: a switch whose hub glows with traffic, with a port LED toward each session in its state. iG.z is the top:
// moulded, bare silicon or a nickel lid.
// pow() takes abs()/max() bases, atan() never gets (0, 0) and smoothstep edges never meet: each is NaN on some GPUs.
const FACE_FRAG = /* glsl */`
uniform float uTime, uMotion; uniform vec3 uPal[9]; uniform vec3 uCyan, uAmber, uRed, uGreen, uBlue; uniform sampler2D uMark;
varying vec4 vUv, vA, vB, vC, vD, vE, vCol, vG;
#define TAU 6.2831853
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float at2(float y, float x) { return atan(y, abs(x) < 1e-5 ? 1e-5 : x); }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float fill(float d, float aa) { return 1. - smoothstep(-aa, aa, d); }
float glyph(vec2 q, float prov, float aa) {
  float r = length(q);
  if (prov < .5) { float a = at2(q.y, q.x), s = TAU / 8.; return fill(r * abs(sin(a - s * floor(a / s + .5))) - .11, aa) * fill(r - .95, aa); }
  if (prov < 1.5) { vec2 h = abs(q); return fill(abs(max(dot(h, vec2(.866, .5)), h.y) - .66) - .14, aa); }
  return fill(abs(sdBox(q, vec2(.72, .92), 0.) + .11) - .11, aa) * step(.4, abs(q.x));
}
void main() {
  vec2 ext = vG.xy, p = (vUv.xy * 2. - 1.) * ext;
  float aa = max(fwidth(p.x), 1e-4) * 1.2;
  float kind = vE.x, seed = vE.y, hl = vE.z, heat = vE.w, top = vG.z;
  float t = uTime + seed * 3.7;
  float boot = vD.z, flash = vD.w;
  float bootY = mix(-ext.y - .25, ext.y + .25, clamp(boot, 0., 1.));
  float powered = boot >= 1. ? 1. : step(0., boot) * (1. - smoothstep(bootY - .03, bootY + .03, p.y));
  float sweep = boot > 0. && boot < 1. ? exp(-pow(abs((p.y - bootY) * 9.), 2.)) : 0.;
  float rimD = sdBox(p, ext, .08);
  vec3 col;
  if (top > 1.5) col = vec3(.1, .105, .11) + vec3(.022) * h2(vec2(floor(p.y * 70.), seed));
  else if (top > .5) { col = vec3(.02, .018, .045) + vec3(.025, .015, .05) * (.5 + .5 * sin(p.x * 2.3 - p.y * 1.7 + seed * 9.)); vec2 sg = abs(fract(p * 12.) - .5); col += vec3(.008, .01, .025) * step(.45, max(sg.x, sg.y)); }
  else { col = vec3(.02, .026, .032) + vec3(.012, .016, .02) * (p.y / ext.y * .5 + .5); vec2 mg = abs(fract(p * 9.) - .5); col += vec3(.005, .009, .011) * step(.44, max(mg.x, mg.y)); }
  col += vec3(.03, .05, .06) * smoothstep(-.07, 0., rimD);
  col += uCyan * hl * smoothstep(-.05, 0., rimD) * .9;
  float etch = texture2D(uMark, vUv.zw).r;
  col = mix(col, top > 1.5 ? col * .35 : col + vec3(.13, .15, .16), etch * .9);
  if (kind < 1.5) {
    float work = vA.x, think = vA.y, compact = vA.z, need = vA.w, wait = vB.x, err = vB.y, off = vB.z, idle = vB.w;
    float ctx = vC.x, pDone = vC.y, pTot = vC.z, prov = vC.w, mode = vD.x, urg = vD.y, sub = step(.5, kind);
    vec3 sc = vCol.rgb;
    float on = (1. - off) * powered;
    vec2 wb = top > .5 ? ext - vec2(.12, .32) : ext - mix(vec2(.38, .5), vec2(.34, .44), sub);
    vec2 wc = vec2(0., top > .5 ? 0. : mix(.03, .1, sub));
    vec2 qa = (p - wc) / wb, q = (p - wc) / wb.y;
    float aq = aa / wb.y * 1.4;
    // Error: rows tear sideways in bursts.
    float gOn = step(.68, h1(floor(t * 7.) + seed * 31.)) * err * uMotion;
    float tear = (h1(floor(qa.y * 6.) + floor(t * 21.)) - .5) * .4 * gOn;
    qa.x += tear; q.x += tear * wb.x / wb.y;
    float win = fill(sdBox(p - wc, wb, .05), aa);
    float cs = wb.y / 3.5;
    vec2 cg = (p - wc + wb) / cs + vec2(tear * wb.x / cs, 0.), ci = floor(cg), cf = fract(cg);
    float lat = step(.16, min(cf.x, cf.y));
    vec3 e = vec3(0.);
    float shim = .62 + .38 * sin(t * 19. + h2(ci) * TAU);
    float sweepW = pow(max(.5 + .5 * sin((q.x + q.y) * 2.4 - t * 5.), 0.), 14.);
    e += sc * work * (.16 + .8 * lat * shim + sweepW * 1.3);
    float yl = 1.15 - 2.3 * fract(t * .32), dy = qa.y - yl;
    e += sc * think * (.1 * lat + exp(-dy * dy * 140.) * 2.6 + step(0., dy) * exp(-dy * 4.) * .45 * lat);
    vec2 bg = (qa * .5 + .5) * vec2(4., 3.), bi = floor(bg), bf = fract(bg);
    float idx = bi.x + (2. - bi.y) * 4., cyc = floor(t / 2.6), ph = fract(t / 2.6);
    float blk = mix(step(.5, h1(idx + cyc * 13.1)), step(idx, 4.5), step(h1(idx * 3.7 + cyc), ph * 1.3));
    blk *= fill(sdBox(bf - .5, vec2(.36), .06), .05) * step(0., bi.x) * step(bi.x, 3.) * step(0., bi.y) * step(bi.y, 2.);
    e += sc * compact * (.05 + blk * 1.6);
    float np = .6 + .4 * sin(t * (3.5 + urg * 7.));
    e += sc * need * (.3 + lat * 1.1) * np * (1. + urg * .6);
    float r = length(q), ang = at2(q.x, q.y);
    float ring = fill(abs(r - .74) - .07, aq);
    float ticks = fill(abs(r - .55) - .06, aq) * step(.82, fract(ang / TAU * 12. + .09));
    float ha = t * 1.2; vec2 hd = vec2(sin(ha), cos(ha));
    float hand = fill(length(q - hd * clamp(dot(q, hd), 0., .52)) - .06, aq);
    e += sc * wait * (ring * 1.7 + hand * 2. + ticks * .7 + .03);
    e += mix(sc, vec3(.2, .5, .6), .5) * idle * .5 * lat; // standby: the die stays visibly powered
    float flick = 1. - .5 * uMotion * step(h1(floor(t * 24.) + seed * 7.), .22);
    float mark = fill(sdBox(q - vec2(0., .2), vec2(.11, .36), .05), aq) + fill(length(q - vec2(0., -.5)) - .13, aq);
    e += sc * err * (.35 + lat * 1.1) * flick * (1. - clamp(mark, 0., 1.) * .92);
    e += vec3(.85, .75, 1.) * flash * 2.6 * (.4 + lat);
    col = mix(col, vec3(.005, .01, .013) + e * on, win);
    // Near edge: the context LED bar, then an activity LED that flickers with each tool call and the power LED (a slow
    // standby breath when idle).
    float rowY = -ext.y + .18;
    vec3 ledC = mix(sc * 1.5, vec3(.25, .75, 1.) * (.35 + .3 * sin(t * 1.3)), idle);
    col += fill(length(p - vec2(ext.x - .18, rowY)) - mix(.065, .1, sub), aa) * on * ledC;
    if (sub < .5) {
      float blink = uMotion > .5 ? step(.4, h1(floor(t * 26.) + seed)) : 1.;
      col += fill(length(p - vec2(ext.x - .4, rowY)) - .05, aa) * on * mix(vec3(.04, .03, .01), vec3(1.7, 1.2, .3), clamp(heat * 1.5, 0., 1.) * blink);
    }
    float segN = mix(10., 5., sub), x0 = -ext.x + .3, x1 = ext.x - mix(.58, .34, sub);
    float bx = (p.x - x0) / (x1 - x0), sI = floor(bx * segN), sF = fract(bx * segN), sw = max(fwidth(bx * segN), 1e-4);
    float inBar = step(0., bx) * step(bx, 1.) * fill(abs(p.y - rowY) - mix(.05, .08, sub), aa) * smoothstep(.14, .14 + sw, sF) * (1. - smoothstep(.86 - sw, .86, sF));
    vec3 segC = sI >= segN * .9 ? uRed : sI >= segN * .8 ? uAmber : uCyan;
    col += inBar * mix(vec3(.014, .02, .024), segC * .85, step((sI + .5) / segN, ctx) * on);
    // Plan LEDs along the far edge: done lit, the next one blinks while working.
    if (pTot > .5) {
      float sp = min(.19, (2. * ext.x - .9) / max(pTot - 1., 1.)), ii = clamp(floor(p.x / sp + (pTot - 1.) * .5 + .5), 0., pTot - 1.);
      vec2 lq = p - vec2((ii - (pTot - 1.) * .5) * sp, ext.y - .18);
      vec3 lc = ii < pDone - .5 ? uCyan * 1.7 : abs(ii - pDone) < .5 ? uGreen * (.15 + 1.6 * work * (.5 + .5 * sin(t * 7.))) : vec3(.02, .028, .034);
      col += fill(length(lq) - min(.055, sp * .32), aa) * mix(vec3(.02), lc, on);
    }
    if (sub < .5) col += vec3(.16, .2, .23) * glyph((p - vec2(-ext.x + .2, ext.y - .2)) / .13, prov, aa / .13);
    if (mode > .5) { vec2 mq = p - vec2(ext.x - .18, ext.y - .18); col += (mode > 1.5 ? uRed : uBlue) * (fill(length(mq) - .07, aa) * 2.2 + .3 * exp(-dot(mq, mq) * 70.)) * on; }
    col = mix(col, vec3(dot(col, vec3(.33))) * .55, off * .85);
  } else {
    // Ports pack (direction in 64ths of a turn) × 16 + state code + alive × .99.
    float N = vB.x, busy = vB.y, needAny = vB.z, r = length(p);
    float hub = fill(sdBox(p, vec2(.4), .08), aa);
    vec2 hg = abs(fract(p * 7.) - .5);
    vec3 hubC = uCyan * (.12 + busy * (.5 + .8 * pow(max(.5 + .5 * sin(r * 18. - t * 6.), 0.), 4.))) + uAmber * needAny * (.7 + .4 * sin(t * 5.));
    col = mix(col, vec3(.008, .012, .016) + hubC * (.35 + .65 * step(.38, max(hg.x, hg.y))) * powered, hub);
    col += vec3(.09, .065, .025) * fill(abs(sdBox(p, vec2(.47), .1)) - .015, aa);
    float ports[8];
    ports[0] = vA.x; ports[1] = vA.y; ports[2] = vA.z; ports[3] = vA.w; ports[4] = vC.x; ports[5] = vC.y; ports[6] = vC.z; ports[7] = vC.w;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= N) break;
      float v = ports[i], q = floor(v / 16. + .0001), rest = v - q * 16., code = floor(rest + .001), alive = clamp(fract(rest + .001) / .99, 0., 1.);
      float pa = q / 64. * TAU, tt = t + float(i) * 1.3;
      vec2 dv = vec2(cos(pa), sin(pa));
      float inten = code < .5 ? 0.
        : code < 1.5 ? 1.3 + .8 * step(.5, h1(floor(tt * 9.))) * uMotion
        : code < 2.5 ? .9 + .5 * sin(tt * 3.)
        : code < 3.5 ? 1.1
        : code < 4.5 ? 1.4 + .7 * sin(tt * 6.)
        : code < 5.5 ? .8
        : code < 6.5 ? .5
        : code < 7.5 ? 1.5 - .7 * uMotion * step(h1(floor(tt * 22.)), .25)
        : .03;
      float led = fill(length(p - dv * .76) - .11, aa), lane = fill(length(p - dv * clamp(dot(p, dv), .42, .66)) - .025, aa);
      col += (led * 1.5 + lane * .4) * uPal[int(code)] * inten * alive * powered;
    }
  }
  col += uCyan * sweep * 2.2;
  gl_FragColor = vec4(col, 1.);
}`;

// Footprints: silkscreen (r), copper pads (g) and the switches' names (b) from the atlas; pads take a little of the chip's state.
const DECAL_VERT = /* glsl */`
attribute vec4 iRect, iTint;
varying vec2 vT; varying vec4 vTint;
void main() { vT = iRect.xy + uv * iRect.zw; vTint = iTint; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.); }`;
const DECAL_FRAG = /* glsl */`
uniform sampler2D uAtlas; uniform float uNames; varying vec2 vT; varying vec4 vTint;
void main() {
  vec3 t = texture2D(uAtlas, vT).rgb; t.b *= uNames;
  float a = max(max(t.r, t.g), t.b);
  if (a < .02) discard;
  vec3 c = vec3(.5, .6, .62) * t.r * .36 + vec3(.4, .31, .12) * t.g * .55 + vTint.rgb * t.g * vTint.a + vec3(.62, .92, 1.) * t.b * .85;
  gl_FragColor = vec4(c, a * .95);
}`;

// Instrument lamps: an LED (rounded rectangle) or a seven-segment bar (pointed hexagon); iS = half size, shape.
const LAMP_VERT = /* glsl */`
attribute vec3 iS;
varying vec2 vP; varying vec3 vS, vC;
void main() {
  vP = uv * 2. - 1.; vS = iS;
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#else
  vC = vec3(1.);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}`;
const LAMP_FRAG = /* glsl */`
varying vec2 vP; varying vec3 vS, vC;
void main() {
  vec2 p = vP * vS.xy; float aa = max(fwidth(p.x) + fwidth(p.y), 1e-4) * .7;
  float d = vS.z > .5 ? max(abs(p.y) - vS.y, abs(p.x) + abs(p.y) - vS.x) : length(max(abs(p) - vS.xy + .015, 0.)) - .015;
  float a = 1. - smoothstep(-aa, aa, d);
  if (a < .01) discard;
  gl_FragColor = vec4(vC, a);
}`;

// Display glass: two lines of the canvas behind a dot-matrix screen, tinted by line (canvas text is a white mask), kept below
// the bloom threshold so it stays crisp. The glass lies flat, so the text is sheared back by the slant perspective gives
// the glass where it is on screen (uShear), and reads upright. Dots show only once they're big enough to read as dots.
const DISP_FRAG = /* glsl */`
uniform sampler2D uTex; uniform vec3 uC1, uC2; uniform vec2 uView, uSize; uniform float uOn, uShear;
varying vec2 vUv;
void main() {
  float second = step(vUv.y, .5), lv = fract(vUv.y * 2.);
  float u = (vUv.x + uShear * (vUv.y - .5)) * uView.x;
  vec2 tuv = vec2(u, mix(.5 + lv * .5, lv * .5, second));
  // Minified, thin strokes average out to grey: gain them back by how far the canvas is shrunk.
  float a = clamp(texture2D(uTex, tuv).r * clamp(length(fwidth(tuv * uSize)) * .9, 1., 3.5), 0., 1.) * step(u, 1.);
  vec2 px = tuv * uSize, cell = fract(px / 2.) - .5;
  float fw = max(length(fwidth(px)), 1e-4), dot = 1. - smoothstep(.3, .48, length(cell)), dots = 1. - smoothstep(.45, .9, fw);
  vec3 c = vec3(.006, .014, .017) + vec3(.012, .03, .034) * dot * dots;
  c += mix(uC1, uC2, second) * a * mix(1., dot * 1.15, dots) * uOn;
  gl_FragColor = vec4(c, 1.);
}`;

// A screenshot on a TFT: the image a touch under white so it doesn't bloom, with subpixels and scanlines once it's big
// enough on screen to show them, and the backlight bleeding at the edges.
const SHOT_FRAG = /* glsl */`
uniform sampler2D uTex; uniform vec2 uRes; uniform float uOn; varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  vec2 px = vUv * uRes; float near = 1. - smoothstep(.4, .9, max(length(fwidth(px)), 1e-4)), f = fract(px.x);
  vec3 sub = vec3(step(f, .34), step(.33, f) * step(f, .67), step(.66, f)) * 2.4;
  c *= mix(vec3(1.), sub, near * .45) * mix(1., .78 + .22 * sin(px.y * 6.2831853), near);
  vec2 e = min(vUv, 1. - vUv);
  c = min(c * .9, vec3(.95)) + vec3(.5, .8, 1.) * exp(-min(e.x, e.y * 1.6) * 45.) * .14;
  gl_FragColor = vec4(c * uOn, 1.);
}`;

const TRACE_VERT = /* glsl */`
attribute vec4 aInfo; attribute vec3 aCol;
varying vec4 vI; varying vec3 vC;
void main() { vI = aInfo; vC = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
// aInfo: distance along the trace (from the child), side -1..1, glow, flow. Flow runs dashes toward the parent.
const TRACE_FRAG = /* glsl */`
uniform float uTime;
varying vec4 vI; varying vec3 vC;
void main() {
  float s = abs(vI.y), aa = max(fwidth(vI.y), 1e-4) * 1.5;
  float edge = 1. - smoothstep(1. - aa, 1., s);
  float core = 1. - smoothstep(.15, .7, s);
  float flow = vI.w * pow(max(.5 + .5 * sin(vI.x * 2.1 - uTime * 11.), 0.), 6.);
  vec3 c = vC * vI.z * (.4 + .6 * core) + vC * flow * 2.8 * core;
  gl_FragColor = vec4(c, edge);
}`;

const VIA_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vC;
void main() {
  vec2 p = vUv * 2. - 1.; float r = length(p), aa = max(fwidth(r), 1e-4) * 1.5;
  float ring = smoothstep(.42 - aa, .42 + aa, r) * (1. - smoothstep(.92 - aa, .92 + aa, r));
  float hole = 1. - smoothstep(.42 - aa, .42 + aa, r);
  gl_FragColor = vec4(vC * ring * (1.2 - r * .5) + vec3(.002, .004, .005) * hole, ring + hole);
}`;

const PACKET_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vC;
void main() {
  float x = vUv.x, y = abs(vUv.y * 2. - 1.);
  float tail = pow(max(x, 0.), 2.4) * (1. - smoothstep(.0, .85, y));
  float head = exp(-pow(abs((x - .88) * 8.), 2.)) * (1. - y * y);
  gl_FragColor = vec4(vC * (tail * 1. + head * 1.6) * 1.15, 1.);
}`;

const RING_VERT = /* glsl */`
attribute vec2 iR;
varying vec2 vUv; varying vec3 vC; varying vec2 vR;
void main() {
  vUv = uv; vR = iR;
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#else
  vC = vec3(1.);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}`;
// iR: thickness (negative = dashed), alpha.
const RING_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vC; varying vec2 vR;
void main() {
  vec2 p = vUv * 2. - 1.; float r = length(p), aa = max(fwidth(r), 1e-4) * 1.5, th = abs(vR.x);
  float band = smoothstep(1. - th - aa, 1. - th, r) * (1. - smoothstep(1. - aa, 1., r));
  if (vR.x < 0.) band *= step(.35, fract(atan(p.y, abs(p.x) < 1e-5 ? 1e-5 : p.x) / 6.2831853 * 28.));
  gl_FragColor = vec4(vC * band * vR.y * 2.2, 1.);
}`;

const BRACKET_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uA; varying vec2 vUv;
void main() {
  vec2 p = abs(vUv * 2. - 1.); float m = max(p.x, p.y), aa = max(fwidth(m), 1e-4) * 1.5;
  float frame = smoothstep(.94 - aa, .94, m) * (1. - smoothstep(1. - aa, 1., m));
  gl_FragColor = vec4(uCol * frame * step(.62, min(p.x, p.y)) * uA * 1.15, 1.);
}`;

const REACTOR_FRAG = /* glsl */`
uniform float uTime, uCount, uUrg, uFlash; uniform vec3 uCyan, uAmber; varying vec2 vUv;
#define TAU 6.2831853
float band(float r, float a, float b, float aa) { return smoothstep(a - aa, a + aa, r) * (1. - smoothstep(b - aa, b + aa, r)); }
void main() {
  vec2 p = vUv * 2. - 1.; float r = length(p), aa = max(fwidth(r), 1e-4) * 1.2;
  float u = fract(atan(p.x, abs(p.y) < 1e-5 ? 1e-5 : p.y) / TAU + 1.);
  vec3 c = vec3(.012, .02, .025) + vec3(.01, .02, .024) * step(.5, fract(r * 14.)) * step(r, .9);
  float n = 12., k = floor(u * n), l = fract(u * n), lw = max(fwidth(u * n), 1e-4);
  float cell = band(r, .74, .92, aa) * smoothstep(.07, .07 + lw, l) * (1. - smoothstep(.93 - lw, .93, l));
  float q = step(k + .5, uCount), pulse = .6 + .4 * sin(uTime * (3. + uUrg * 6.) - k * .6);
  c += cell * mix(uCyan * .16, uAmber * 2. * pulse, q);
  c += uCyan * .9 * band(r, .675, .69, aa);
  c += uCyan * 1.3 * band(r, .56, .6, aa) * step(.45, fract(u * 24. - uTime * .2));
  c += uCyan * .14 * step(.96, fract(u * 16.)) * band(r, .44, .67, aa);
  c += uCyan * .7 * band(r, .43, .44, aa);
  c += mix(uCyan, uAmber, step(.5, uCount)) * (1.2 + uFlash * 2.) * (1. - smoothstep(0., .38, r));
  gl_FragColor = vec4(c, 1.);
}`;

const COLUMN_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
void main() {
  float s = pow(max(.5 + .5 * sin(vUv.y * 22. - uTime * 6.), 0.), 6.);
  gl_FragColor = vec4(uCol * (1. - vUv.y) * (.35 + s * .9), 1.);
}`;

let boardCanvas = null, envCache = null;

export default {
  id: 'synthetic',
  name: 'Synthetic',
  css: `
body[data-look="synthetic"] { --bg: #020608; --fg: #d9f7ff; --muted: #6d8e9a; --panel: rgba(3, 12, 16, .88); --line: rgba(60, 220, 255, .2); --accent: #26e6ff;
  --need: #ffab1a; --work: #2dffa0; --err: #ff2d4b; --wait: #3d7bff; --font: "Chakra Petch", system-ui, sans-serif; --mono: "JetBrains Mono", ui-monospace, monospace;
  --display: "Chakra Petch", system-ui, sans-serif; --radius: 2px; --shadow: 0 10px 30px rgba(0, 0, 0, .55); --label: #e2fbff; --label-sub: #80b3c0; --label-halo: rgba(0, 5, 8, .95); }
body[data-look="synthetic"] :is(.nodes-tip, .nodes-overlay button) { --cut: 7px; box-shadow: inset 0 1px 0 rgba(38, 230, 255, .3);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
body[data-look="synthetic"] .nodes-overlay button { --cut: 5px; }
body[data-look="synthetic"] .nodes-overlay .nodes-next { box-shadow: 0 0 12px color-mix(in srgb, var(--need) 45%, transparent); }
body[data-look="synthetic"] .lbl { padding: 2px 6px 3px; background: rgba(1, 7, 9, .9); border: 1px solid rgba(38, 230, 255, .3); box-shadow: 0 0 0 1px rgba(0, 0, 0, .6), inset 0 0 10px rgba(38, 230, 255, .1);
  text-shadow: 0 0 5px rgba(120, 240, 255, .4); }
body[data-look="synthetic"] .lbl b { font: 400 11.5px/1.3 var(--mono); color: #d6f8ff; }
body[data-look="synthetic"] .lbl span { font: 400 10.5px/1.3 var(--mono); color: #7fb9c6; }
body[data-look="synthetic"] .lbl.need { border-color: rgba(255, 171, 26, .65); }
body[data-look="synthetic"] .lbl.error { border-color: rgba(255, 45, 75, .65); }
body[data-look="synthetic"] .lbl:is(.project, .you) { padding: 0; background: none; border: 0; box-shadow: none; }
body[data-look="synthetic"] .lbl.sub { padding: 0 2px; background: none; border: 0; box-shadow: none; text-shadow: 0 0 4px #000, 0 0 2px #000; }
body[data-look="synthetic"] .lbl.sub b { font: 400 10.5px/1.3 var(--mono); }
body[data-look="synthetic"] .lbl.sub:not(.need, .error) b { color: #7fb9c6; }
body[data-look="synthetic"] .lbl.project b { font: 600 12.5px/1.2 var(--display); text-transform: uppercase; letter-spacing: .16em; color: #9ff0ff; }
body[data-look="synthetic"] .lbl.you b { font: 600 13px/1.2 var(--display); letter-spacing: .12em; text-transform: uppercase; }
body[data-look="synthetic"] .nodes-tip b { text-transform: uppercase; letter-spacing: .06em; }`,

  create(ctx) {
    const { THREE, kit, scene, root, renderer, world, camera } = ctx;
    // Bloom only for what's brighter than white: status lights, packets and needs-you rings. Text, digits and silkscreen stay below.
    ctx.setPost({ bloom: { strength: .38, radius: .35, threshold: 1 }, exposure: 1.05 });
    ctx.setView({ tilt: .58, fov: 33 });
    ctx.setMotion(kit.RIGID);
    ctx.setSizes({ you: 2.0, project: .9, session: 1.3, sub: .55 });
    // The engine's layout, opened out: session chips are big and carry displays, so fans and the ring get more room. The
    // screen's shape is taken once here; placements below are worked out for it.
    {
      const aspect = ctx.size.w / ctx.size.h, tall = aspect < .8, sx = (aspect > 1.2 ? Math.min(1.4, aspect / 1.15) : tall ? .82 : 1) * 1.12, sz = (tall ? Math.min(1.7, .95 / aspect) : 1) * 1.12;
      ctx.setLayout(n => { if (n.kind === 'project') { n.rest.x *= sx; n.rest.z *= sz; } else if (n.kind !== 'you') n.offset.multiplyScalar(1.35); });
    }
    ctx.addPass(kit.vignettePass({ darkness: .32, offset: 1.05, grain: .015 }));
    const C = hex => new THREE.Color(hex);
    const bg = C('#020608');
    scene.background = bg; renderer.setClearColor(bg, 1);
    // The look is rebuilt whenever sessions come or go; the reflections are generated once per renderer and kept.
    if (envCache?.renderer !== renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
      envCache = { renderer, texture: pmrem.fromScene(room, .04).texture };
      room.dispose(); pmrem.dispose();
    }
    scene.environment = envCache.texture; scene.environmentIntensity = .4;
    root.add(new THREE.HemisphereLight('#7fdcff', '#020407', .4));
    const key = new THREE.DirectionalLight('#dff6ff', 1.1); key.position.set(-10, 24, 14); root.add(key, key.target);

    const m4 = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), qI = new THREE.Quaternion(), qR = new THREE.Quaternion();
    const pv = new THREE.Vector3(), sv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
    const cyan = C(CYAN), red = C(RED), amber = C(PAL.need), green = C(PAL.work), blue = C(PAL.wait), WHITE = C('#ffffff');
    const toolCol = Object.fromEntries(Object.entries(TOOL).map(([k, v]) => [k, C(v)]));
    const palC = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, C(v)]));

    // ── Board: a dark solder mask over a tiled copper layout (r traces, g pads and vias, b silkscreen), drawn once per page ──
    if (!boardCanvas) { boardCanvas = document.createElement('canvas'); boardCanvas.width = boardCanvas.height = 2048; drawBoard(boardCanvas.getContext('2d'), 2048, kit.rng(1337)); }
    const boardTex = new THREE.CanvasTexture(boardCanvas);
    boardTex.colorSpace = THREE.NoColorSpace; boardTex.wrapS = boardTex.wrapT = THREE.RepeatWrapping; boardTex.anisotropy = 8;
    const ripU = Array.from({ length: 6 }, () => new THREE.Vector4()), ripC = Array.from({ length: 6 }, () => new THREE.Color()), ripW = new Array(6).fill(1);
    const boardU = { uTex: { value: boardTex }, uTile: { value: TILE }, uRip: { value: ripU }, uRipC: { value: ripC }, uRipW: { value: ripW }, uYou: { value: new THREE.Vector2() },
      uHome: { value: new THREE.Vector2(0, 1.5) }, uCore: { value: C(CYAN) } };
    const board = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: boardU,
      vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform float uTile; uniform vec4 uRip[6]; uniform vec3 uRipC[6]; uniform float uRipW[6]; uniform vec2 uYou, uHome; uniform vec3 uCore;
        varying vec2 vP;
        ${kit.NOISE_GLSL}
        float grid(vec2 p, float s) { vec2 q = p / s, g = abs(fract(q - .5) - .5) / max(fwidth(q), vec2(1e-5)); return 1. - min(min(g.x, g.y), 1.); }
        void main() {
          vec4 t = texture2D(uTex, vP / uTile), t2 = texture2D(uTex, vP.yx / (uTile * 1.43) + .37);
          float zone = smoothstep(-.4, .4, snoise(vec3(vP * .045, 1.7)));
          float fade = 1. - smoothstep(26., 68., length(vP - uHome));
          float tr = clamp(t.r * mix(.3, 1., zone) + t2.r * .22, 0., 1.), pad = t.g * mix(.35, 1., zone), silk = t.b * zone;
          float fw = length(fwidth(vP)), g1 = grid(vP, 1.) * (1. - smoothstep(.06, .2, fw)), g5 = grid(vP, 5.) * (1. - smoothstep(.3, 1., fw));
          vec3 col = vec3(.004, .009, .012);
          col += vec3(.012, .035, .04) * (g1 * .22 + g5 * .5);
          col = mix(col, vec3(.012, .05, .056), tr * .9);
          col = mix(col, vec3(.05, .052, .036), pad * .8);
          col = mix(col, vec3(.055, .075, .085), silk * .5);
          col *= fade;
          float dy = length(vP - uYou);
          col += uCore * (.025 * exp(-dy * dy / 30.) + (tr + pad) * .3 * exp(-dy * dy / 70.)) * fade;
          for (int i = 0; i < 6; i++) {
            vec4 rp = uRip[i]; if (rp.w <= 0.) continue;
            float d = length(vP - rp.xy), w = uRipW[i], front = exp(-pow(abs((d - rp.z) / w), 2.));
            col += uRipC[i] * rp.w * front * (.04 + (tr * 1.8 + pad * 1.3) / w + (g1 + g5) * .25) * (.35 + .65 * fade);
          }
          gl_FragColor = vec4(col, 1.);
        }`,
    }));
    root.add(board);

    // ── Traces: child → parent, right angles with a chamfer. Projects reach You on a three-trace bus that turns onto You's own
    // axis outside the instruments and comes in through the middle of a side, buses on one side in lanes, so You's corners
    // stay free for the usage cards. ──
    const links = [], traces = [], sides = new Map();
    for (const n of world.nodes) {
      if (n.kind === 'you') continue;
      const parent = n.kind === 'project' ? world.you : n.parent, bus = n.kind === 'project';
      const dx = parent.rest.x - n.rest.x, dz = parent.rest.z - n.rest.z;
      const link = { n, parent, bus, xFirst: (Math.abs(dx) >= Math.abs(dz)) !== bus, lane: 0, cmax: bus ? 3.4 : 1.6, P: v4(THREE), M: v4(THREE), traces: [], mid: null };
      if (bus) { const side = (link.xFirst ? 'z' : 'x') + Math.sign(link.xFirst ? dz : dx); if (!sides.has(side)) sides.set(side, []); sides.get(side).push(link); }
      const w = bus ? .06 : n.kind === 'session' ? .09 : .06;
      for (const o of bus ? [-.28, 0, .28] : [0]) { const tr = { link, o, w, base: traces.length * 8, q: v4(THREE), cum: new Float32Array(4), len: 0 }; traces.push(tr); link.traces.push(tr); }
      link.mid = link.traces[(link.traces.length - 1) >> 1];
      links.push(link);
    }
    for (const list of sides.values()) {
      list.sort((a, b) => a.xFirst ? a.n.rest.x - b.n.rest.x : a.n.rest.z - b.n.rest.z);
      const step = Math.min(.95, 2.6 / Math.max(1, list.length - 1));
      list.forEach((l, i) => { l.lane = (i - (list.length - 1) / 2) * step; });
    }
    const linkOf = new Map(links.map(l => [l.n, l]));
    const CLEAR = GAP + CARD_W * SCALES[0] + .4;
    const routeOf = (L, P, a, b) => {
      if (L.shot) return route(P, a.x, a.z, a.x + L.shot.hp[0], a.z + L.shot.hp[1], L.xFirst, L.cmax);
      if (!L.bus) return route(P, a.x, a.z, b.x, b.z, L.xFirst, L.cmax);
      const cmax = Math.max(0, Math.min(L.cmax, (L.xFirst ? Math.abs(b.z - a.z) : Math.abs(b.x - a.x)) - CLEAR));
      route(P, a.x, a.z, b.x + (L.xFirst ? L.lane : 0), b.z + (L.xFirst ? 0 : L.lane), L.xFirst, cmax);
    };

    // ── Chips, each designed from its id and furnished with parts wherever the copper leaves room ──
    const you = world.you, segs = [], blockers = [], P0 = v4(THREE);
    for (const L of links) {
      routeOf(L, P0, L.n.rest, L.parent.rest);
      const hw = L.bus ? .42 : L.n.kind === 'session' ? .16 : .12;
      for (let i = 0; i < 3; i++) segs.push([P0[i].x, P0[i].z, P0[i + 1].x, P0[i + 1].z, hw]);
    }
    const order = { project: 0, session: 1, sub: 2 };
    const chips = world.nodes.filter(n => n.kind !== 'you').map((n, i) => ({ n, i, d: design(n, kit.rng(n.seed)), bootAt: 0, flash: 0, x: NaN, y: 0, z: 0, sc: -1, top: 0, busy: 0, col: new THREE.Color(), T: new THREE.Matrix4() }));
    for (const v of chips) { const [fx, fz] = v.d.foot; blockers.push([v.n.rest.x - fx, v.n.rest.z - fz, v.n.rest.x + fx, v.n.rest.z + fz]); }
    // The cards take the largest size at which no chip or trace crosses the corners they'd fill.
    const corners = sc => [-1, 1].flatMap(sx => [-1, 1].map(sz => [you.rest.x + Math.min(sx * GAP, sx * (GAP + CARD_W * sc)), you.rest.z + Math.min(sz * GAP, sz * (GAP + CARD_DMAX * sc)), you.rest.x + Math.max(sx * GAP, sx * (GAP + CARD_W * sc)), you.rest.z + Math.max(sz * GAP, sz * (GAP + CARD_DMAX * sc))]));
    const cardScale = SCALES.find(sc => corners(sc).every(a => !blockers.some(b => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) && !segs.some(sg => segBox(sg, a)))) ?? SCALES[SCALES.length - 1];
    blockers.push([you.rest.x - 2.4, you.rest.z - 2.4, you.rest.x + 2.4, you.rest.z + 2.4], ...corners(cardScale));
    const fitter = v => ([x0, z0, x1, z1], grow = true, overTraces = false) => {
      const a = [v.n.rest.x + x0, v.n.rest.z + z0, v.n.rest.x + x1, v.n.rest.z + z1], d = v.d;
      for (const b of blockers) if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) return false;
      if (!overTraces) for (const sg of segs) if (segBox(sg, a)) return false;
      blockers.push(a);
      if (grow) d.ext = [Math.min(d.ext[0], x0), Math.min(d.ext[1], z0), Math.max(d.ext[2], x1), Math.max(d.ext[3], z1)];
      return true;
    };
    // Modules beside a chip (its display, its screenshot LCD): round the chip, nearest ring first and the side away from the
    // parent first, with a clear run for the bus from the module's header to the chip; clear of traces if it can be.
    const P1 = v4(THREE);
    const mount = (v, hw, hh, gaps, overs = [false, true]) => {
      const { n, d } = v, [fx, fz] = d.foot, o = n.offset, cx = n.rest.x, cz = n.rest.z;
      const own = blockers.find(b => b[0] === cx - fx && b[1] === cz - fz);
      for (const over of overs) for (const g of gaps) {
        const gx = fx + g, gz = fz + g;
        const cand = [[gx + hw, 0], [-gx - hw, 0], [0, gz + hh], [0, -gz - hh], [gx + hw, gz * .7], [-gx - hw, gz * .7], [gx + hw, -gz * .7], [-gx - hw, -gz * .7]]
          .sort((a, b) => (b[0] * o.x + b[1] * o.z) / Math.hypot(...b) - (a[0] * o.x + a[1] * o.z) / Math.hypot(...a));
        for (const [x, z] of cand) {
          const xFacing = Math.abs(x) - hw > Math.abs(z) - hh, hp = xFacing ? [x - Math.sign(x) * (hw - .06), z] : [x, z - Math.sign(z) * (hh - .06)];
          const rect = [cx + x - hw, cz + z - hh, cx + x + hw, cz + z + hh];
          if (blockers.some(b => rect[0] < b[2] && rect[2] > b[0] && rect[1] < b[3] && rect[3] > b[1]) || (!over && segs.some(sg => segBox(sg, rect)))) continue;
          route(P1, cx, cz, cx + hp[0], cz + hp[1], !xFacing, .6);
          const run = [0, 1, 2].map(i => [P1[i].x, P1[i].z, P1[i + 1].x, P1[i + 1].z, .16]);
          if (run.some(sg => blockers.some(b => b !== own && segBox(sg, b)) || (!over && segs.some(t => segsCross(sg, t, own))))) continue;
          blockers.push(rect); segs.push(...run);
          return { x, z, hp, xFirst: !xFacing, header: xFacing ? [Math.sign(-x), 0] : [0, Math.sign(-z)] };
        }
      }
      return null;
    };
    // Text first: every session's and subagent's display (one size per kind), and each switch's silkscreened name.
    for (const v of chips) {
      const { n, d } = v;
      if (n.kind === 'project') {
        const fits = fitter(v), o = n.rest.clone().sub(you.rest), name = n.name.toUpperCase(), hw = measure(name, NAME_EM) / 2 + .1, hh = NAME_EM * .6 + .05, R = d.ring + .1;
        for (const over of [false, true]) {
          const at = [[0, R + hh], [0, -R - hh], [R + hw, 0], [-R - hw, 0]].sort((a, b) => (b[0] * o.x + b[1] * o.z) / Math.hypot(...b) - (a[0] * o.x + a[1] * o.z) / Math.hypot(...a))
            .find(([x, z]) => fits([x - hw, z - hh, x + hw, z + hh], true, over));
          if (at) { d.text.push([name, at[0], at[1], NAME_EM, 'center', DISPLAY, 'rgb(0,0,255)']); d.named = true; break; }
        }
        continue;
      }
      const spec = DISPLAYS[n.kind], m = mount(v, spec.w / 2 + .26, spec.h / 2 + .26, [.3, 1, 1.8]);
      if (m) { d.disp = { ...m, ...spec }; display(d, m, spec); }
    }
    // Then room for a screenshot module beside every session: screenshots arrive after the board is built, so the space is
    // kept even while there are none.
    for (const v of chips) if (v.n.kind === 'session') v.d.shot = mount(v, LCD_W / 2 + .12, LCD_D / 2 + .12, [.6, 1.4, 2.3, 3.3], [false]);
    for (const v of [...chips].sort((a, b) => order[a.n.kind] - order[b.n.kind])) {
      const { n, d } = v;
      furnish(d, n.kind, kit.rng(n.seed ^ 0x5bd1e995), fitter(v));
      // Labels go on the side away from the parent, so they don't sit on it.
      v.above = n.kind === 'project' ? n.rest.z - you.rest.z > 2 : n.offset.z < -Math.abs(n.offset.x) * .35;
      // A switch's port LEDs point at its sessions (face y is board -z), in 64 steps.
      if (n.kind === 'project') v.ports = n.sessions.slice(0, 8).map(x => Math.round(((Math.atan2(-x.offset.z, x.offset.x) / (Math.PI * 2)) % 1 + 1) % 1 * 64) % 64);
    }
    // The modules' buses join the traces (left out of linkOf: no packets ride them).
    for (const v of chips) for (const [m, os, lcd] of [[v.d.disp, [-.07, .07], false], [v.d.shot, [-.1, 0, .1], true]]) {
      if (!m) continue;
      const link = { n: v.n, parent: v.n, shot: m, lcd, xFirst: m.xFirst, cmax: .6, P: v4(THREE), M: v4(THREE), traces: [], mid: null };
      for (const o of os) { const tr = { link, o, w: .026, base: traces.length * 8, q: v4(THREE), cum: new Float32Array(4), len: 0 }; traces.push(tr); link.traces.push(tr); }
      link.mid = link.traces[0]; links.push(link);
    }
    const byNode = new Map(chips.map(v => [v.n, v]));
    const NC = chips.length;

    // Footprints and markings, packed into one atlas.
    const cells = [];
    for (const v of chips) {
      const d = v.d, E = Math.max(-d.ext[0], -d.ext[1], d.ext[2], d.ext[3]) + .32, f = d.face;
      v.E = E;
      cells.push({ v, decal: true, u: 2 * E, w: 0, h: 0 }, { v, decal: false, u: 2 * f.ext[0], ratio: f.ext[1] / f.ext[0], w: 0, h: 0 });
    }
    let scale = 1, AW = 2048, AH = 0;
    do {
      for (const c of cells) { const px = c.decal ? 46 : c.v.n.kind === 'project' ? 88 : 64; c.w = Math.ceil(c.u * px * scale) + 6; c.h = c.decal ? c.w : Math.ceil((c.w - 6) * c.ratio) + 6; }
      AH = pack(cells, AW); scale *= .85;
    } while (AH > 2048);
    AH = Math.max(64, Math.ceil(AH / 4) * 4);
    const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = AW; atlasCanvas.height = AH;
    const ag = atlasCanvas.getContext('2d');
    ag.fillStyle = '#000'; ag.fillRect(0, 0, AW, AH); ag.globalCompositeOperation = 'lighter';
    for (const c of cells) {
      const k = (c.w - 6) / c.u, rect = [(c.x + 3) / AW, 1 - (c.y + c.h - 3) / AH, (c.w - 6) / AW, (c.h - 6) / AH];
      ag.save(); ag.beginPath(); ag.rect(c.x, c.y, c.w, c.h); ag.clip(); ag.setTransform(k, 0, 0, k, c.x + c.w / 2, c.y + c.h / 2);
      if (c.decal) { drawDecal(ag, k, c.v.d); c.v.decalRect = rect; } else { drawMark(ag, k, c.v.d, c.v.n.kind); c.v.markRect = rect; }
      ag.restore();
    }
    const atlas = new THREE.CanvasTexture(atlasCanvas);
    atlas.colorSpace = THREE.NoColorSpace; atlas.anisotropy = 4;

    // Parts: rounded epoxy, metal boxes, gull-wing leads and cans, one instanced draw each.
    const box = new THREE.BoxGeometry(2, 1, 2).translate(0, .5, 0);
    const partGeo = [new RoundedBoxGeometry(2, 1, 2, 2, .06).translate(0, .5, 0), box, leadGeometry(THREE), new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, .5, 0), box];
    const metal = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .3, metalness: 1 });
    const epoxy = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .5, metalness: .25 });
    const partMat = [epoxy, metal, metal, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .4, metalness: .45 }), epoxy];
    const counts = [0, 0, 0, 0, 0];
    for (const v of chips) v.parts = v.d.parts.map(([t, x, y, z, hx, h, hz, color, ry, rx = 0]) => ({ t, i: counts[t]++, color, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(hx, h, hz)) }));
    const partMesh = partGeo.map((g, t) => new THREE.InstancedMesh(g, partMat[t], Math.max(1, counts[t])));
    partMesh.forEach((mesh, t) => { mesh.count = counts[t]; mesh.setColorAt(0, bg); });
    for (const v of chips) for (const p of v.parts) partMesh[p.t].setColorAt(p.i, tmpC.setHex(p.color));

    const faceGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const fa = {};
    for (const name of ['iA', 'iB', 'iC', 'iD', 'iE', 'iCol', 'iF', 'iG']) { fa[name] = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, NC) * 4), 4).setUsage(THREE.DynamicDrawUsage); faceGeo.setAttribute(name, fa[name]); }
    const pal = ['#000000', ...DKEYS.map(k => PAL[k])].map(C);
    const faceU = { uTime: { value: 0 }, uMotion: { value: 1 }, uPal: { value: pal }, uCyan: { value: cyan }, uAmber: { value: amber }, uRed: { value: red }, uGreen: { value: green }, uBlue: { value: blue }, uMark: { value: atlas } };
    const faces = new THREE.InstancedMesh(faceGeo, new THREE.ShaderMaterial({ uniforms: faceU, vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), Math.max(1, NC));
    faces.count = NC;
    const decalGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const dRect = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, NC) * 4), 4), dTint = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, NC) * 4), 4).setUsage(THREE.DynamicDrawUsage);
    decalGeo.setAttribute('iRect', dRect); decalGeo.setAttribute('iTint', dTint);
    const decalU = { uAtlas: { value: atlas }, uNames: { value: 1 } };
    const decals = new THREE.InstancedMesh(decalGeo, new THREE.ShaderMaterial({ uniforms: decalU, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false }), Math.max(1, NC));
    decals.count = NC; decals.renderOrder = 1;
    for (const v of chips) {
      const { d, i } = v, f = d.face, o = i * 4;
      v.faceM = new THREE.Matrix4().compose(pv.set(0, f.y + .002, 0), qI, sv.set(f.w, 1, f.d));
      v.decalM = new THREE.Matrix4().compose(pv.set(0, DECAL_Y, 0), qI, sv.set(v.E, 1, v.E));
      fa.iF.array.set(v.markRect, o); fa.iG.array.set([f.ext[0], f.ext[1], f.top, 0], o); dRect.array.set(v.decalRect, o);
    }
    const instanced = [...partMesh, faces, decals];

    // Displays: a canvas each, redrawn only when its text changes; the glass follows its chip.
    const glassGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), displays = [];
    const screen = (w, view) => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = DISP_PX;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
      const u = { uTex: { value: tex }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uView: { value: new THREE.Vector2(view / 256, 0) }, uSize: { value: new THREE.Vector2(256, DISP_PX) }, uOn: { value: 1 }, uShear: { value: 0 } };
      const mesh = new THREE.Mesh(glassGeo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: UV_VERT, fragmentShader: DISP_FRAG, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      return { canvas, tex, u, mesh, view, w, sig: '' };
    };
    for (const v of chips) {
      const dp = v.d.disp;
      if (!dp) continue;
      // The display shows the name, so clicking it opens the session like the chip does.
      const x = Object.assign(screen(dp.w, dp.view), { v, at: new THREE.Vector3(dp.x, GLASS_Y, dp.z), local: new THREE.Matrix4().compose(pv.set(dp.x, GLASS_Y, dp.z), qI, sv.set(dp.w / 2, 1, dp.h / 2)),
        target: ctx.addTarget({ node: v.n, pos: new THREE.Vector3(), hx: dp.w / 2 + .16, hz: dp.h / 2 + .16, action: 'node' }) });
      x.u.uC1.value.set('#d6f8ff').multiplyScalar(.85); x.mesh.matrixAutoUpdate = false; x.mesh.frustumCulled = false; root.add(x.mesh); displays.push(x);
    }
    const fontsReady = () => { for (const x of displays) x.sig = ''; if (youScreen) youScreen.sig = ''; };
    document.fonts?.ready.then(fontsReady);
    // Screenshot modules: a little board of their own with an LCD on it (bezel, inset glass, flex into a connector, a driver
    // IC and caps), a pin header on the edge facing the chip, hidden while its session has no screenshots.
    const shotMods = [], boxGeo = partGeo[1], LCD_Z = LCD_Z_REL;
    const mat = (color, roughness = .5, metalness = .2) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const lcdMats = { pcb: mat('#0a2620', .6, .15), bezel: mat('#0a0c0e', .45, .3), ic: mat('#101317'), flex: mat('#7a4f18', .55), conn: mat('#16181b'), cap: mat('#8f7250'), pin: mat('#c5ccd2', .3, 1) };
    // Built the first time its session has a screenshot to show.
    function buildShot(m) {
      const sh = m.v.d.shot, canvas = m.canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
      const tex = m.tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const silk = document.createElement('canvas'); silk.width = 256; silk.height = Math.round(256 * LCD_D / LCD_W);
      const header = sh.header;
      drawLcdBoard(silk.getContext('2d'), 256 / LCD_W, header);
      const silkTex = new THREE.CanvasTexture(silk); silkTex.colorSpace = THREE.SRGBColorSpace; silkTex.anisotropy = 4;
      m.u = { uTex: { value: tex }, uRes: { value: new THREE.Vector2(512, 320) }, uOn: { value: 1 } };
      const group = m.group = new THREE.Group(), nz = LCD_Z + SHOT_H / 2 + .12;
      const add = (geo, mt, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); o.scale.set(sx, sy, sz); group.add(o); return o; };
      add(boxGeo, lcdMats.pcb, 0, 0, 0, LCD_W / 2, .045, LCD_D / 2);
      add(glassGeo, new THREE.MeshStandardMaterial({ map: silkTex, roughness: .6, metalness: .15 }), 0, .0452, 0, LCD_W / 2, 1, LCD_D / 2);
      add(boxGeo, lcdMats.bezel, 0, .045, LCD_Z, SHOT_W / 2 + .12, .065, SHOT_H / 2 + .12);
      for (const sg of [-1, 1]) { add(boxGeo, lcdMats.bezel, 0, .11, LCD_Z + sg * (SHOT_H / 2 + .08), SHOT_W / 2 + .12, .016, .04); add(boxGeo, lcdMats.bezel, sg * (SHOT_W / 2 + .08), .11, LCD_Z, .04, .016, SHOT_H / 2 + .04); }
      add(glassGeo, new THREE.ShaderMaterial({ uniforms: m.u, vertexShader: UV_VERT, fragmentShader: SHOT_FRAG }), 0, .112, LCD_Z, SHOT_W / 2, 1, SHOT_H / 2);
      add(boxGeo, lcdMats.flex, .55, .045, nz + .09, .3, .012, .1);
      add(boxGeo, lcdMats.conn, .55, .045, nz + .24, .4, .035, .07);
      add(boxGeo, lcdMats.ic, -1.05, .045, nz + .25, .17, .035, .17);
      for (let i = 0; i < 3; i++) add(boxGeo, lcdMats.cap, -.62 + i * .14, .045, nz + .25, .03, .03, .06);
      for (let i = 0; i < 8; i++) {
        const t = (i - 3.5) * .16;
        if (header[0]) add(boxGeo, lcdMats.pin, header[0] * (LCD_W / 2 - .02), 0, t, .05, .06, .035);
        else add(boxGeo, lcdMats.pin, t, 0, header[1] * (LCD_D / 2 - .02), .035, .06, .05);
      }
      // Like the chips: a status LED in its session's colour, and corner brackets that lock on when it's hovered or selected.
      m.led = add(boxGeo, new THREE.MeshBasicMaterial({ color: '#000000' }), LCD_W / 2 - .3, .045, nz + .25, .05, .03, .05);
      m.rim = add(glassGeo, new THREE.ShaderMaterial({ uniforms: { uCol: { value: C(CYAN) }, uA: { value: 0 } }, vertexShader: UV_VERT, fragmentShader: BRACKET_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 0, .14, 0, LCD_W / 2 + .14, 1, LCD_D / 2 + .14);
      m.rim.renderOrder = 7;
      group.matrixAutoUpdate = false; root.add(group);
    }
    for (const v of chips) {
      const sh = v.d.shot;
      if (sh) shotMods.push({ v, group: null, shot: null, local: new THREE.Matrix4().makeTranslation(sh.x, 0, sh.z), at: new THREE.Vector3(sh.x, .112, sh.z + LCD_Z),
        target: ctx.addTarget({ node: v.n, pos: new THREE.Vector3(), hx: SHOT_W / 2 + .12, hz: SHOT_H / 2 + .12, action: 'shots' }) });
    }
    // The newest screenshot, letterboxed, with how many there are; drawn only when the engine hands over a new one.
    function paintShot(m, shot) {
      const g = m.canvas.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, 512, 320);
      try { const b = shot.bitmap, k = Math.min(512 / b.width, 320 / b.height); g.drawImage(b, (512 - b.width * k) / 2, (320 - b.height * k) / 2, b.width * k, b.height * k); } catch {}
      if (shot.count > 1) { g.fillStyle = 'rgba(0, 0, 0, .78)'; g.fillRect(412, 268, 92, 44); g.fillStyle = '#9ff2ff'; g.font = `400 32px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(`×${shot.count}`, 496, 291); }
      m.tex.needsUpdate = true;
    }
    const BLANK = [];
    function paintScreen(x, lines) {
      const sig = lines.join('|');
      if (sig === x.sig) return;
      x.sig = sig;
      const g = x.canvas.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, 256, DISP_PX); g.fillStyle = '#fff'; g.font = `400 24px ${FONT}`; g.textBaseline = 'middle';
      // A line too long for the glass ends in an ellipsis, on a whole character.
      lines.forEach((line, i) => {
        let t = line;
        if (g.measureText(t).width > x.view - 10) { while (t.length > 1 && g.measureText(`${t}…`).width > x.view - 10) t = t.slice(0, -1); t = `${t.trimEnd()}…`; }
        g.fillText(t, 5, i * 32 + 17);
      });
      x.tex.needsUpdate = true;
    }
    for (const mesh of instanced) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(mesh); }

    // ── You: a reactor core in an octagonal socket ──
    const youG = new THREE.Group(); root.add(youG);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(2.02, 2.22, .34, 8, 1), new THREE.MeshStandardMaterial({ color: '#0e151b', roughness: .32, metalness: .7 }));
    socket.rotation.y = Math.PI / 8; socket.position.y = .17; youG.add(socket);
    const reactorU = { uTime: { value: 0 }, uCount: { value: 0 }, uUrg: { value: 0 }, uFlash: { value: 0 }, uCyan: { value: cyan }, uAmber: { value: amber } };
    const plate = new THREE.Mesh(new THREE.CircleGeometry(1.9, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: reactorU, vertexShader: UV_VERT, fragmentShader: REACTOR_FRAG }));
    plate.position.y = .343; youG.add(plate);
    const CORE_Y = 1.6;
    const coreU = { uTime: { value: 0 }, uNeed: { value: 0 }, uUrg: { value: 0 }, uFlash: { value: 0 }, uA: { value: C('#0a2f7a') }, uB: { value: C('#5ef3ff') }, uAmber: { value: amber } };
    const core = new THREE.Mesh(new THREE.SphereGeometry(.6, 48, 32), new THREE.ShaderMaterial({
      uniforms: coreU,
      vertexShader: 'varying vec3 vN, vV, vP; void main(){ vP = position; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform float uTime, uNeed, uUrg, uFlash; uniform vec3 uA, uB, uAmber; varying vec3 vN, vV, vP;
        ${kit.NOISE_GLSL}
        void main() {
          float f = pow(clamp(1. - dot(normalize(vN), normalize(vV)), 0., 1.), 2.2);
          float n = snoise(vP * 2.6 + vec3(0., uTime * .8, uTime * .3)) * .5 + .5, n2 = snoise(vP * 6. - uTime * 1.2) * .5 + .5;
          float k = clamp(n * n2 * 1.7, 0., 1.);
          vec3 c = mix(uA, uB, k) + vec3(.6, .9, 1.) * pow(k, 6.) * .8;
          c = mix(c, mix(uAmber * .5, uAmber * 1.3, k), uNeed * (.82 + .18 * sin(uTime * (2.5 + uUrg * 5.))));
          gl_FragColor = vec4(c * (.75 + f * 1.8 + uFlash * 1.4), 1.);
        }`,
    }));
    core.position.y = CORE_Y; youG.add(core);
    const ringMat = new THREE.MeshBasicMaterial({ color: C(CYAN).multiplyScalar(1.5) });
    const gyro1 = new THREE.Mesh(new THREE.TorusGeometry(1.0, .028, 8, 120), ringMat), gyro2 = new THREE.Mesh(new THREE.TorusGeometry(1.24, .02, 8, 120), ringMat);
    gyro1.position.y = gyro2.position.y = CORE_Y; youG.add(gyro1, gyro2);
    const columnU = { uTime: { value: 0 }, uCol: { value: C(CYAN) } };
    const column = new THREE.Mesh(new THREE.CylinderGeometry(.16, .44, 1.0, 32, 1, true), new THREE.ShaderMaterial({ uniforms: columnU, vertexShader: UV_VERT, fragmentShader: COLUMN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    column.position.y = .343 + .5; youG.add(column);
    const glowTex = kit.glowTexture([[0, 'rgba(255,255,255,1)'], [.3, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C(CYAN), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = CORE_Y; halo.scale.setScalar(2.6); youG.add(halo);
    const light = new THREE.PointLight(CYAN, 60, 22, 2); light.position.y = CORE_Y; youG.add(light);
    let coreFlash = 0, needSmooth = 0;
    // You's own display, in front of the core between the usage cards: who's waiting on you.
    const youScreen = screen(YOU_W, YOU_W / YOU_H * DISP_PX), youZ = 2.42 + YOU_H / 2;
    youScreen.mesh.position.set(0, GLASS_Y, youZ); youScreen.mesh.scale.set(YOU_W / 2, 1, YOU_H / 2);
    youScreen.u.uC1.value.set('#d6f8ff').multiplyScalar(.9);
    const youMat = new THREE.MeshStandardMaterial({ color: '#05080a', roughness: .5, metalness: .3 });
    const youBoard = new THREE.Mesh(new THREE.BoxGeometry(YOU_W + .36, .04, YOU_H + .36).translate(0, .02, 0), new THREE.MeshStandardMaterial({ color: '#0a221c', roughness: .6, metalness: .15 }));
    const youPanel = new THREE.Mesh(new THREE.BoxGeometry(YOU_W + .14, .06, YOU_H + .14).translate(0, .07, 0), youMat);
    youBoard.position.set(0, 0, youZ); youPanel.position.set(0, 0, youZ); youG.add(youBoard, youPanel, youScreen.mesh);

    // ── Usage: an instrument card per account in You's corners, plugged into the reactor's socket. Per window, one big
    // seven-segment readout over a thin LED bar; lamps are one instanced draw, lit below the bloom threshold so they stay
    // crisp. A card's silkscreen is redrawn only when its text changes. ──
    const lampGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), lampS = new THREE.InstancedBufferAttribute(new Float32Array(MAXU * PER_CARD * 3), 3);
    lampGeo.setAttribute('iS', lampS);
    const lamps = new THREE.InstancedMesh(lampGeo, new THREE.ShaderMaterial({ vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG, transparent: true, depthWrite: false }), MAXU * PER_CARD);
    for (let i = 0; i < lamps.count; i++) lamps.setMatrixAt(i, ZERO);
    lamps.setColorAt(0, bg); lamps.frustumCulled = false; lamps.renderOrder = 2; youG.add(lamps);
    const cardBase = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), cardTop = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const cardMat = new THREE.MeshStandardMaterial({ color: '#0a1a22', roughness: .55, metalness: .2 });
    const cards = [], lampC = new THREE.Color(), qV = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), LAMP_Y = .078, S = cardScale;
    function setLamp(k, c, x, z, hx, hz, upright, shape) { lamps.setMatrixAt(k, m4.compose(pv.set(c.ox + x * S, LAMP_Y, c.oz + z * S), upright ? qV : qI, sv.set(hx * S, 1, hz * S))); lampS.setXYZ(k, hx * S, hz * S, shape); }
    function placeCard(i, a, shape) {
      let c = cards[i];
      if (!c) {
        const canvas = document.createElement('canvas'); canvas.width = CARD_PX; canvas.height = CARD_H;
        const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        c = cards[i] = { canvas, tex, group: new THREE.Group(), vals: [], sig: '', check: 0 };
        c.base = new THREE.Mesh(cardBase, cardMat); c.base.position.y = .02;
        c.top = new THREE.Mesh(cardTop, new THREE.MeshBasicMaterial({ map: tex })); c.top.position.y = .0715;
        c.group.add(c.base, c.top); youG.add(c.group);
      }
      const lay = c.lay = cardLayout(a), sx = i % 2 ? 1 : -1, sz = (i >> 1) % 2 ? 1 : -1;
      const cx = sx * (GAP + lay.W * S / 2), cz = sz * (GAP + lay.D * S / 2);
      Object.assign(c, { shape, sx, vals: [], sig: '', check: 0, ox: cx - lay.W * S / 2, oz: cz - lay.D * S / 2 });
      c.group.position.set(cx, 0, cz); c.group.visible = true;
      c.base.scale.set(lay.W * S, .05, lay.D * S); c.top.scale.set(lay.W * S, 1, lay.D * S);
      c.tex.repeat.set(1, lay.D / CARD_D); c.tex.offset.set(0, 1 - lay.D / CARD_D);
      const base = i * PER_CARD;
      for (let k = 0; k < PER_CARD; k++) lamps.setMatrixAt(base + k, ZERO);
      lay.rows.forEach((row, ri) => {
        const b = base + ri * PER_ROW;
        row.leds.forEach((x, j) => setLamp(b + j, c, x, row.z + .98, row.lw, .045, false, 0));
        row.digits.forEach((x, di) => SEGS.forEach(([sx2, sz2, hl, ht, up, hex], si) => setLamp(b + LEDS + di * SEG + si, c, x + sx2, row.z + .44 + sz2, hl, ht, up, hex)));
      });
      lamps.instanceMatrix.needsUpdate = true; lampS.needsUpdate = true;
    }
    function paintRow(i, ri, row, u, text) {
      const b = i * PER_CARD + ri * PER_ROW, sev = u >= .95 ? red : u >= .8 ? amber : cyan, lit = Math.round(u * LEDS);
      for (let j = 0; j < LEDS; j++) lamps.setColorAt(b + j, lampC.copy(sev).multiplyScalar(j < lit ? .9 : .1));
      const glyphs = [];
      for (const ch of text) { if (ch === '.') { if (glyphs.length) glyphs[glyphs.length - 1].dp = true; } else glyphs.push({ ch, dp: false }); }
      row.digits.forEach((_, di) => {
        const gph = glyphs[di - (row.digits.length - glyphs.length)], mask = gph ? DIGITS[gph.ch] ?? 0 : 0;
        for (let si = 0; si < SEG; si++) lamps.setColorAt(b + LEDS + di * SEG + si, lampC.copy(sev).multiplyScalar((si < 7 ? (mask >> si) & 1 : gph?.dp) ? .95 : .07));
      });
    }
    function updateCards(dt) {
      const list = world.usage.filter(a => a.windows.length || a.spend?.limit).slice(0, MAXU);
      let paint = false;
      for (let i = 0; i < MAXU; i++) {
        const a = list[i];
        if (!a) {
          const c = cards[i];
          if (c?.group.visible) { c.group.visible = false; c.shape = ''; for (let k = 0; k < PER_CARD; k++) lamps.setMatrixAt(i * PER_CARD + k, ZERO); lamps.instanceMatrix.needsUpdate = true; }
          continue;
        }
        const shape = `${a.id}|${a.label}|${a.windows.map(w => w.label)}|${!!a.spend?.limit}`;
        if (cards[i]?.shape !== shape) placeCard(i, a, shape);
        const c = cards[i], lay = c.lay;
        if ((c.check -= dt) <= 0) {
          c.check = 1;
          for (const row of lay.rows) row.note = row.w >= 0 ? resetText(a.windows[row.w]?.resetsAt) : `/ $${money(a.spend.limit).replace(/\.0+$/, '')}`;
          const sig = lay.rows.map(row => row.note).join('|');
          if (sig !== c.sig) { c.sig = sig; drawCard(c.canvas.getContext('2d'), lay, a, c.sx); c.tex.needsUpdate = true; }
        }
        lay.rows.forEach((row, ri) => {
          const u = row.w >= 0 ? a.windows[row.w]?.used ?? 0 : kit.clamp(a.spend.spent / a.spend.limit);
          const text = row.w >= 0 ? String(Math.round(u * 100)) : money(a.spend.spent), val = `${u.toFixed(2)}|${text}`;
          if (c.vals[ri] !== val) { c.vals[ri] = val; paintRow(i, ri, row, u, text); paint = true; }
        });
      }
      if (paint) lamps.instanceColor.needsUpdate = true;
    }

    // ── Traces mesh and vias ──
    const TV = traces.length * 8;
    const tPos = new Float32Array(TV * 3), tInfo = new Float32Array(TV * 4), tCol = new Float32Array(TV * 3), tIdx = [];
    for (let t = 0; t < traces.length; t++) for (let s = 0; s < 3; s++) { const a = t * 8 + s * 2; tIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const traceGeo = new THREE.BufferGeometry();
    traceGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
    traceGeo.setAttribute('aInfo', new THREE.BufferAttribute(tInfo, 4).setUsage(THREE.DynamicDrawUsage));
    traceGeo.setAttribute('aCol', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
    traceGeo.setIndex(tIdx);
    const traceU = { uTime: { value: 0 } };
    const traceMesh = new THREE.Mesh(traceGeo, new THREE.ShaderMaterial({ uniforms: traceU, vertexShader: TRACE_VERT, fragmentShader: TRACE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    traceMesh.frustumCulled = false; traceMesh.renderOrder = 3; root.add(traceMesh);
    const flatQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const vias = new THREE.InstancedMesh(flatQuad, new THREE.ShaderMaterial({ vertexShader: INST_VERT, fragmentShader: VIA_FRAG, transparent: true, depthWrite: false }), Math.max(1, traces.length));
    vias.setColorAt(0, bg); vias.frustumCulled = false; vias.renderOrder = 4; root.add(vias);
    const traceBase = C('#0f4f58'), traceC = new THREE.Color(), needC = new THREE.Color();
    // Needs you, per project: how strongly its middle bus line (the interrupt line) carries a waiting session's call to the core.
    const callOf = new Map(), callIn = new Map();

    // ── Packets, floor glows, rings, selection brackets ──
    const additive = frag => new THREE.ShaderMaterial({ vertexShader: INST_VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const MAXP = 120;
    const packetMesh = new THREE.InstancedMesh(flatQuad, additive(PACKET_FRAG), MAXP);
    packetMesh.setColorAt(0, bg); packetMesh.count = 0; packetMesh.frustumCulled = false; packetMesh.renderOrder = 5; root.add(packetMesh);
    const packets = Array.from({ length: MAXP }, () => ({ on: false, tr: null, d: 0, speed: 9, col: new THREE.Color() }));
    const head = new THREE.Vector3(), dir = new THREE.Vector3();

    const glows = new THREE.InstancedMesh(flatQuad, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), NC + 1);
    glows.setColorAt(0, bg); glows.frustumCulled = false; glows.renderOrder = 2; root.add(glows); instanced.push(glows);

    const MAXR = 48, ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAXR * 2), 2).setUsage(THREE.DynamicDrawUsage);
    ringGeo.setAttribute('iR', ringAttr);
    const ringMesh = new THREE.InstancedMesh(ringGeo, new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), MAXR);
    ringMesh.setColorAt(0, bg); ringMesh.count = 0; ringMesh.frustumCulled = false; ringMesh.renderOrder = 6; root.add(ringMesh);
    const shots = Array.from({ length: 16 }, () => ({ on: false, n: null, t0: 0, dur: 1, r0: 1, r1: 2, th: .1, col: new THREE.Color(), lift: false }));
    const ripples = Array.from({ length: 6 }, () => ({ t0: -99, dur: 1, x: 0, z: 0, r: 10, str: 0, w: 1.3, col: new THREE.Color() }));

    const bracketGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const bracket = col => { const m = new THREE.Mesh(bracketGeo, new THREE.ShaderMaterial({ uniforms: { uCol: { value: C(col) }, uA: { value: 0 } }, vertexShader: UV_VERT, fragmentShader: BRACKET_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.renderOrder = 7; m.visible = false; root.add(m); return m; };
    const selB = bracket(CYAN), hovB = bracket('#8ff3ff');

    // A node whose display or silkscreen is big enough on screen to read needs no HTML label; zoomed out, it gets one back.
    const la = new THREE.Vector3(), lb = new THREE.Vector3(), lc = new THREE.Vector3(), wp = new THREE.Vector3();
    // How far perspective slants a flat glass of half size (w, h) at p: the shift of its far edge over its width, on screen.
    const shearAt = (p, w, h) => { la.copy(p).project(camera); lb.copy(p); lb.z -= h / 2; lb.project(camera); lc.copy(p); lc.x += w / 2; lc.project(camera); return Math.abs(lc.x - la.x) > 1e-6 ? (lb.x - la.x) / (lc.x - la.x) : 0; };
    // Measured up the board (z), where flat text is foreshortened.
    const pxPerUnit = n => { la.copy(n.pos).project(camera); lb.copy(n.pos); lb.z -= 1; lb.project(camera); return Math.hypot((lb.x - la.x) * ctx.size.w, (lb.y - la.y) * ctx.size.h) / 2; };
    let ppu = 20, far = false;
    // Displays and silkscreen carry every node's text while they're big enough on screen to read; zoomed out further, the
    // HTML labels take over for every node at once. A node that found no room for a display keeps its label.
    ctx.setLabelRule(n => {
      if (far) return undefined;
      const v = byNode.get(n);
      return n.kind === 'you' ? false : n.kind === 'project' ? !v?.d.named : !v?.d.disp;
    });
    // Labels sit below a chip, or above it when its parent is below, clear of the chip's parts either way.
    const lray = new THREE.Raycaster(), lplane = new THREE.Plane(UP, 0), lndc = new THREE.Vector2(), lp = new THREE.Vector3();
    ctx.setLabelAnchor((n, out) => {
      const v = byNode.get(n);
      if (!v) return out.set(n.pos.x, 0, n.pos.z + 2.5);
      const e = v.d.ext;
      if (!v.above) return out.set(n.pos.x, 0, n.pos.z + e[3] + .1);
      lp.set(n.pos.x, v.top, n.pos.z + e[1]).project(camera);
      lndc.set(lp.x, lp.y + (n.kind === 'sub' ? 22 : 36) * 2 / ctx.size.h); lray.setFromCamera(lndc, camera);
      return lray.ray.intersectPlane(lplane, out) || out.set(n.pos.x, 0, n.pos.z + e[1] - 1.5);
    });

    // Power-on: chips boot outward from the core.
    let lt = 0, lastTime = world.time, beat = 3;
    for (const v of chips) v.bootAt = .25 + v.n.rest.length() * .028 + (v.n.seed % 7) * .03;

    function launch(link, col, speed) {
      if (!link) return;
      for (const p of packets) if (!p.on) { p.on = true; p.tr = link.mid; p.d = 0; p.speed = speed; p.col.copy(col); return; }
    }
    function shot(n, col, r0, r1, dur, th = .08, lift = false) {
      if (ctx.reduced) return;
      let r = shots[0];
      for (const s of shots) { if (!s.on) { r = s; break; } if (s.t0 < r.t0) r = s; }
      Object.assign(r, { on: true, n, t0: lt, dur, r0, r1, th, lift }); r.col.copy(col);
    }
    function ripple(n, col, radius, str, dur, w = 1.3) {
      if (ctx.reduced) return;
      let r = ripples[0];
      for (const x of ripples) if (x.t0 + x.dur < r.t0 + r.dur) r = x;
      Object.assign(r, { t0: lt, dur, x: n.pos.x, z: n.pos.z, r: radius, str, w }); r.col.copy(col);
    }

    function event(type, n, data) {
      const v = byNode.get(n);
      if (type === 'tool') { if (!ctx.reduced && (n.kind === 'session' || n.kind === 'sub')) launch(linkOf.get(n), toolCol[data.kind] || toolCol[''], n.kind === 'sub' ? 7 : 9); return; }
      if (!v) return;
      const S = Math.max(...v.d.foot);
      if (type === 'finish') { ripple(n, green, 24, 1, 2.6); shot(n, green, S * 1.2, S * 3.6, 1.1, .06); }
      else if (type === 'need') shot(n, amber, S * 1.2, S * 3.2, 1, .07, true);
      else if (type === 'answer') { shot(n, cyan, S * 2.6, S * 1.15, .6, .08, true); ripple(n, cyan, 9, .6, 1.4); }
      else if (type === 'compacted') { v.flash = 1; shot(n, palC.compact, S * 2.8, S * 1.1, .7, .1, true); }
      else if (type === 'spawn') { v.bootAt = lt; ripple(n, cyan, 10, .7, 1.6); }
      else if (type === 'state' && data.to === 'error') { shot(n, red, S * 1.1, S * 2.8, .8, .1); ripple(n, red, 8, .8, 1.3); }
    }

    function update(dt, time) {
      const reduced = ctx.reduced, queue = world.queue();
      // Look clock: real time, but jumps with the world (advance) and keeps running while sessions are paused.
      const dw = Math.max(0, time - lastTime); lastTime = time;
      const jump = Math.max(dt, dw), step = Math.min(.25, jump); lt += Math.min(30, jump);
      const at = reduced ? 1.3 : lt;
      faceU.uMotion.value = reduced ? 0 : 1;
      faceU.uTime.value = traceU.uTime.value = reactorU.uTime.value = coreU.uTime.value = columnU.uTime.value = at;

      // You
      youG.position.set(you.pos.x, Math.max(0, you.pos.y), you.pos.z);
      let urg = 0; for (const s of queue) urg = Math.max(urg, s.s.urgency);
      needSmooth = kit.damp(needSmooth, queue.length ? 1 : 0, 4, dt);
      coreFlash = Math.max(0, coreFlash - dt * 2.5);
      reactorU.uCount.value = queue.length; reactorU.uUrg.value = urg; reactorU.uFlash.value = coreFlash;
      coreU.uNeed.value = needSmooth; coreU.uUrg.value = urg; coreU.uFlash.value = coreFlash;
      if (!reduced) { gyro1.rotation.set(at * .7, at * .45, 0); gyro2.rotation.set(-at * .5, 0, at * .6); } else { gyro1.rotation.set(1.2, .3, 0); gyro2.rotation.set(-.4, 0, .9); }
      tmpC.copy(cyan).lerp(amber, needSmooth * .8);
      halo.material.color.copy(tmpC).multiplyScalar(.45 + coreFlash * .5); light.color.copy(tmpC); light.intensity = 50 + coreFlash * 40;
      columnU.uCol.value.copy(tmpC);
      boardU.uCore.value.copy(tmpC); boardU.uYou.value.set(you.pos.x, you.pos.z);
      youG.updateMatrixWorld();
      // The core's heartbeat: a broad, faint swell out through the copper.
      if (!reduced && (beat -= step) <= 0) { beat = 9; ripple(you, cyan, 38, .16, 7, 4.5); }
      updateCards(dt);

      // Chips: parts move only when their chip does; the faces and footprints take the state every frame.
      const A = fa.iA.array, B = fa.iB.array, Cc = fa.iC.array, D = fa.iD.array, E = fa.iE.array, K = fa.iCol.array, TT = dTint.array;
      let moved = false;
      for (const v of chips) {
        const { n, d, i } = v, s = n.s, o = i * 4;
        const sc = s.alive < .002 ? 0 : reduced ? s.alive : kit.easeOutCubic(s.alive), y = Math.max(0, n.pos.y);
        if (v.x !== n.pos.x || v.z !== n.pos.z || v.y !== y || v.sc !== sc) {
          v.x = n.pos.x; v.y = y; v.z = n.pos.z; v.sc = sc;
          v.T.compose(pv.set(v.x, y, v.z), qI, sv.set(sc, sc, sc));
          for (const p of v.parts) partMesh[p.t].setMatrixAt(p.i, m4.multiplyMatrices(v.T, p.m));
          faces.setMatrixAt(i, m4.multiplyMatrices(v.T, v.faceM)); decals.setMatrixAt(i, m4.multiplyMatrices(v.T, v.decalM));
          moved = v.moved = true;
        } else v.moved = false;
        v.top = y + d.top * sc;
        v.flash = Math.max(0, v.flash - step * 1.6);
        const boot = v.boot = reduced ? 1 : kit.clamp((lt - v.bootAt) / .9, -1, 1);
        let pads;
        if (n.kind === 'project') {
          let busy = 0, need = 0, err = 0;
          for (let j = 0; j < 8; j++) { const x = n.sessions[j], val = x ? v.ports[j] * 16 + dom(x) + Math.min(.99, x.s.alive) : 0; if (j < 4) A[o + j] = val; else Cc[o + j - 4] = val; }
          for (const x of n.sessions) { busy += x.s.work * x.s.alive; need = Math.max(need, x.s.need * x.s.alive); err = Math.max(err, x.s.error * x.s.alive); }
          v.busy = Math.min(1, busy);
          B[o] = Math.min(8, n.sessions.length); B[o + 1] = reduced ? 0 : v.busy; B[o + 2] = need; B[o + 3] = err;
          v.col.copy(cyan); pads = .08 + v.busy * .25 + s.hover * .2 + s.select * .25;
        } else {
          A[o] = s.work; A[o + 1] = s.think; A[o + 2] = s.compact; A[o + 3] = s.need;
          B[o] = s.wait; B[o + 1] = s.error; B[o + 2] = s.off; B[o + 3] = s.idle;
          Cc[o] = s.ctx ?? n.ctx; Cc[o + 1] = n.plan?.done || 0; Cc[o + 2] = n.plan?.total || 0; Cc[o + 3] = PROV[n.provider] ?? 0;
          kit.statusColor(n, PAL, v.col);
          if (s.need > .01) v.col.lerp(red, s.urgency * .65 * s.need);
          K[o] = v.col.r; K[o + 1] = v.col.g; K[o + 2] = v.col.b;
          pads = s.work * .3 + s.think * .18 + s.compact * .25 + s.need * (.55 + s.urgency * .3) + s.error * .5 + s.hover * .2 + s.select * .25;
        }
        D[o] = n.mode === 'plan' ? 1 : n.mode === 'bypass' ? 2 : 0; D[o + 1] = s.urgency; D[o + 2] = boot; D[o + 3] = reduced ? 0 : v.flash;
        E[o] = KIND[n.kind]; E[o + 1] = (n.seed % 997) / 997; E[o + 2] = Math.max(s.hover * .45, s.select); E[o + 3] = s.heat;
        TT[o] = v.col.r; TT[o + 1] = v.col.g; TT[o + 2] = v.col.b; TT[o + 3] = pads * s.alive * (boot > 0 ? 1 : 0);
        // Floor glow
        const want = n.kind === 'project' ? .04 + v.busy * .09 : s.need * (.38 + s.urgency * .3) + s.error * .38 + s.work * .14 + s.think * .08 + s.compact * .12 + s.wait * .07;
        const gs = Math.max(...d.foot) * 3.6 * sc;
        m4.compose(pv.set(n.pos.x, .006, n.pos.z), qI, sv.set(gs, 1, gs)); glows.setMatrixAt(i, m4);
        glows.setColorAt(i, tmpC2.copy(v.col).multiplyScalar(want * s.alive));
      }
      m4.compose(pv.set(you.pos.x, .006, you.pos.z), qI, sv.set(8, 1, 8)); glows.setMatrixAt(NC, m4);
      glows.setColorAt(NC, tmpC2.copy(cyan).lerp(amber, needSmooth).multiplyScalar(.12 + needSmooth * .06 + coreFlash * .12));
      // Displays: the name over what it's doing, in its state's colour, dimmer when idle. Zoomed out too far to read them, the
      // HTML labels come back (one board-wide decision, so it doesn't flicker chip by chip), and the displays and silkscreen go
      // blank so no name shows twice.
      ppu = pxPerUnit(you); far = DISPLAYS.session.h * 24 / DISP_PX * ppu < 7; decalU.uNames.value = far ? 0 : 1;
      for (const x of displays) {
        const { v } = x, n = v.n, s = n.s;
        paintScreen(x, far ? BLANK : [n.name, needs(n) ? `${n.text} · ${kit.fmtWait(n.waitSec)}` : n.text]);
        x.u.uC2.value.copy(v.col).lerp(WHITE, .22);
        x.u.uOn.value = s.alive * (1 - s.off * .5) * (1 - s.idle * .35) * (v.boot > 0 ? 1 : .1);
        x.u.uShear.value = shearAt(wp.copy(x.at).applyMatrix4(v.T), x.w, DISPLAYS[n.kind].h); x.target.pos.copy(wp);
        if (v.moved) { x.mesh.matrix.multiplyMatrices(v.T, x.local); x.mesh.matrixWorldNeedsUpdate = true; }
      }
      paintScreen(youScreen, ['YOU', queue.length ? `${queue.length} WAITING` : 'ALL CLEAR']);
      for (const m of shotMods) {
        const shot = ctx.shot(m.v.n);
        if (shot !== m.shot) { m.shot = shot; if (shot) { if (!m.group) buildShot(m); paintShot(m, shot); } if (m.group) m.group.visible = !!shot; m.v.shotOn = !!shot; }
        if (!shot) continue;
        m.group.matrix.multiplyMatrices(m.v.T, m.local); m.group.matrixWorldNeedsUpdate = true;
        m.target.pos.copy(m.at).applyMatrix4(m.v.T); m.u.uOn.value = m.v.n.s.alive;
        const ns = m.v.n.s;
        m.led.material.color.copy(m.v.col).multiplyScalar(1.5 * ns.alive * (1 - ns.idle * .6));
        m.rim.material.uniforms.uA.value = Math.max(ns.hover * .45, ns.select, m.target.hovered ? .45 : 0);
      }
      youScreen.u.uC2.value.copy(queue.length ? amber : cyan).multiplyScalar(queue.length ? 1 : .75);
      youScreen.u.uShear.value = shearAt(wp.set(youG.position.x, GLASS_Y, youG.position.z + youZ), YOU_W, YOU_H);
      if (moved) for (const mesh of instanced) mesh.instanceMatrix.needsUpdate = true;
      glows.instanceMatrix.needsUpdate = true; glows.instanceColor.needsUpdate = true;
      for (const name of ['iA', 'iB', 'iC', 'iD', 'iE', 'iCol']) fa[name].needsUpdate = true;
      dTint.needsUpdate = true;

      // Traces and vias. A session that needs you lights its own trace and its project's middle bus line amber → red,
      // with dashes running core-ward, and sends interrupt packets up it: the call travels on the copper, never through the air.
      callOf.clear();
      for (const n of world.sessions) {
        const k = n.s.need * n.s.alive; if (k < .01) continue;
        const c = callOf.get(n.project); if (!c || k > c.k) callOf.set(n.project, { k, u: n.s.urgency });
        if (!reduced) {
          const t = (callIn.get(n) ?? 0) - step;
          if (t <= 0 && k > .5) { launch(linkOf.get(n), needC.copy(amber).lerp(red, n.s.urgency * .75), 8 + n.s.urgency * 6); callIn.set(n, 1.1 - n.s.urgency * .6); }
          else callIn.set(n, t);
        }
      }
      let vi = 0;
      for (const L of links) {
        const ch = L.n, cs = ch.s, alive = L.shot ? (L.lcd && !byNode.get(ch).shotOn ? 0 : cs.alive) : cs.alive * (L.parent.s.alive || 1);
        routeOf(L, L.P, ch.pos, L.parent.pos);
        miter(L.P, L.M);
        let glow, flow;
        if (L.shot) { tmpC.copy(traceBase).lerp(cyan, .3); glow = .6 * alive; flow = 0; }
        else if (ch.kind === 'project') { const busy = byNode.get(ch).busy; tmpC.copy(traceBase).lerp(cyan, .35 + busy * .4); glow = (.55 + busy * .35) * alive; flow = reduced ? 0 : busy * .7; }
        else { tmpC.copy(traceBase).lerp(byNode.get(ch).col, .55 - cs.off * .4); glow = alive * (.45 + .55 * (1 - cs.off) * (1 - cs.idle * .45)); flow = reduced ? 0 : cs.work * alive; }
        const call = L.shot ? null : ch.kind === 'project' ? callOf.get(ch) : ch.kind === 'session' && cs.need > .01 ? { k: cs.need * alive, u: cs.urgency } : null;
        for (const tr of L.traces) {
          const q = tr.q, base = tr.base, k = call && (ch.kind !== 'project' || tr.o === 0) ? call.k : 0;
          let g = glow, f = flow; traceC.copy(tmpC);
          if (k) { traceC.lerp(needC.copy(amber).lerp(red, call.u * .75), k); g = glow + k * (.6 + call.u * .4); f = reduced ? 0 : Math.max(flow, k * (.9 + call.u * .6)); }
          for (let i = 0; i < 4; i++) q[i].copy(L.P[i]).addScaledVector(L.M[i], tr.o);
          tr.cum[0] = 0; for (let i = 1; i < 4; i++) tr.cum[i] = tr.cum[i - 1] + q[i].distanceTo(q[i - 1]);
          tr.len = tr.cum[3];
          const w = tr.w * Math.min(1, alive * 1.5);
          for (let i = 0; i < 4; i++) for (let sd = 0; sd < 2; sd++) {
            const vtx = base + i * 2 + sd, side = sd ? 1 : -1, M = L.M[i];
            tPos[vtx * 3] = q[i].x + M.x * side * w; tPos[vtx * 3 + 1] = TRACE_Y; tPos[vtx * 3 + 2] = q[i].z + M.z * side * w;
            tInfo[vtx * 4] = tr.cum[i]; tInfo[vtx * 4 + 1] = side; tInfo[vtx * 4 + 2] = g; tInfo[vtx * 4 + 3] = f;
            tCol[vtx * 3] = traceC.r; tCol[vtx * 3 + 1] = traceC.g; tCol[vtx * 3 + 2] = traceC.b;
          }
          const ch2 = tr.cum[2] - tr.cum[1];
          if (ch2 > .35 && alive > .05) {
            const vs = (tr.w * 2 + .16) * 1.6;
            m4.compose(pv.lerpVectors(q[1], q[2], .5).setY(TRACE_Y + .002), qI, sv.set(vs, 1, vs)); vias.setMatrixAt(vi, m4);
            vias.setColorAt(vi, tmpC2.copy(traceC).multiplyScalar(g * 1.3)); vi++;
          }
        }
      }
      vias.count = vi; vias.instanceMatrix.needsUpdate = true; if (vias.instanceColor) vias.instanceColor.needsUpdate = true;
      traceGeo.attributes.position.needsUpdate = traceGeo.attributes.aInfo.needsUpdate = traceGeo.attributes.aCol.needsUpdate = true;

      // Packets ride the traces; one reaching a project carries on up the bus, one reaching You flashes the core.
      let pi = 0;
      for (const p of packets) {
        if (!p.on) continue;
        if (reduced) { p.on = false; continue; }
        p.d += p.speed * step;
        const tr = p.tr;
        if (p.d >= tr.len) {
          p.on = false;
          const ln = tr.link.n;
          if (ln.kind === 'session') launch(linkOf.get(ln.project), p.col, p.speed * 1.15);
          else if (ln.kind === 'sub') launch(linkOf.get(ln.parent), p.col, 9);
          else coreFlash = Math.min(1.2, coreFlash + .3);
          continue;
        }
        if (pi >= MAXP) continue;
        sample(tr, p.d, head, dir);
        const len = Math.min(1.1, p.d + .05);
        m4.compose(pv.copy(head).addScaledVector(dir, -len / 2).setY(TRACE_Y + .01), qR.setFromAxisAngle(UP, Math.atan2(-dir.z, dir.x)), sv.set(len, 1, .22));
        packetMesh.setMatrixAt(pi, m4); packetMesh.setColorAt(pi, p.col); pi++;
      }
      packetMesh.count = pi; packetMesh.instanceMatrix.needsUpdate = true; if (packetMesh.instanceColor) packetMesh.instanceColor.needsUpdate = true;

      // Rings: one-off shots, plus dashed rings spreading over the board round every chip that needs you.
      ri = 0;
      for (const r of shots) {
        if (!r.on) continue;
        const f = (lt - r.t0) / r.dur;
        if (f >= 1 || reduced) { r.on = false; continue; }
        const v = byNode.get(r.n) || null, e = kit.easeOutCubic(f);
        putRing(r.n.pos.x, r.lift && v ? v.top + .04 : .03, r.n.pos.z, kit.lerp(r.r0, r.r1, e), r.th, (1 - f) * .9, r.col);
      }
      for (const v of chips) {
        const s = v.n.s;
        if (s.need < .02 || v.n.kind !== 'session') continue;
        const S = Math.max(...v.d.foot);
        tmpC.copy(amber).lerp(red, s.urgency * .7);
        if (reduced) { putRing(v.x, .03, v.z, S * 1.55, -.06, .8 * s.need, tmpC); continue; }
        for (let j = 0; j < 2; j++) {
          const f = (lt * (.7 + s.urgency * 1.1) + j * .5) % 1;
          putRing(v.x, .03, v.z, S * (1.2 + f * 1.4), -.05, (1 - f) * s.need * (.7 + s.urgency * .5), tmpC);
        }
      }
      ringMesh.count = ri; ringMesh.instanceMatrix.needsUpdate = true; ringAttr.needsUpdate = true; if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;

      // Board shockwaves
      for (let i = 0; i < 6; i++) {
        const r = ripples[i], f = (lt - r.t0) / r.dur;
        if (f < 0 || f >= 1 || reduced) { ripU[i].set(0, 0, 0, 0); continue; }
        ripU[i].set(r.x, r.z, r.r * kit.easeOutCubic(f * .85 + .15 * f), r.str * Math.pow(1 - f, 1.4)); ripC[i].copy(r.col); ripW[i] = r.w;
      }

      // Hover and selection brackets lock on around the chip.
      let sel = null, hov = null;
      for (const n of world.nodes) { if (n.selected) sel = n; else if (n.hovered) hov = n; }
      placeBracket(selB, sel, 'select', 1);
      placeBracket(hovB, hov, 'hover', .45);
    }

    let ri = 0;
    function putRing(x, y, z, radius, th, a, col) {
      if (ri >= MAXR) return;
      m4.compose(pv.set(x, y, z), qI, sv.set(radius, 1, radius)); ringMesh.setMatrixAt(ri, m4); ringMesh.setColorAt(ri, col);
      ringAttr.array[ri * 2] = th; ringAttr.array[ri * 2 + 1] = a; ri++;
    }
    function placeBracket(mesh, n, key, a) {
      mesh.visible = !!n;
      if (!n) return;
      const k = n.s[key];
      let x = n.pos.x, y, z = n.pos.z, S;
      if (n.kind === 'you') { y = youG.position.y + .36; S = 2.25; }
      else { const v = byNode.get(n); x = v.x; z = v.z; y = v.top + .02; S = Math.max(...v.d.foot) * 1.15; }
      mesh.position.set(x, y, z); mesh.scale.setScalar(S * (1.12 + (1 - k) * (ctx.reduced ? 0 : .5)));
      mesh.material.uniforms.uA.value = k * a;
    }

    return { update, event };
  },
};

// Dominant status as a project core code (1..8, see DKEYS).
function dom(n) {
  let best = 5, bv = n.s.idle;
  for (let j = 0; j < 8; j++) { const w = n.s[DKEYS[j]]; if (w > bv) { bv = w; best = j; } }
  return best + 1;
}
const v4 = THREE => [0, 0, 0, 0].map(() => new THREE.Vector3());

// Child → parent as an L with a 45° chamfer at the corner: along x first (xFirst) or z first, then into the parent.
function route(P, ax, az, bx, bz, xFirst, cmax) {
  const dx = bx - ax, dz = bz - az, sx = Math.sign(dx) || 1, sz = Math.sign(dz) || 1;
  const c = Math.min(Math.abs(dx), Math.abs(dz)) * .75, cc = Math.min(c, cmax);
  P[0].set(ax, 0, az); P[3].set(bx, 0, bz);
  if (xFirst) { P[1].set(bx - sx * cc, 0, az); P[2].set(bx, 0, az + sz * cc); }
  else { P[1].set(ax, 0, bz - sz * cc); P[2].set(ax + sx * cc, 0, bz); }
}
// Miter offsets per point (unit normal scaled so parallel offsets stay parallel through the chamfer).
const segD = new Float32Array(6);
function miter(P, M) {
  for (let i = 0; i < 3; i++) {
    const dx = P[i + 1].x - P[i].x, dz = P[i + 1].z - P[i].z, l = Math.hypot(dx, dz);
    if (l > 1e-4) { segD[i * 2] = dx / l; segD[i * 2 + 1] = dz / l; } else segD[i * 2] = NaN;
  }
  for (let i = 1; i < 3; i++) if (Number.isNaN(segD[i * 2])) { segD[i * 2] = segD[i * 2 - 2]; segD[i * 2 + 1] = segD[i * 2 - 1]; }
  for (let i = 1; i >= 0; i--) if (Number.isNaN(segD[i * 2])) { segD[i * 2] = segD[i * 2 + 2]; segD[i * 2 + 1] = segD[i * 2 + 3]; }
  if (Number.isNaN(segD[0])) for (let i = 0; i < 3; i++) { segD[i * 2] = 1; segD[i * 2 + 1] = 0; }
  for (let i = 0; i < 4; i++) {
    const a = Math.max(0, i - 1), b = Math.min(2, i);
    const d0x = segD[a * 2], d0z = segD[a * 2 + 1], d1x = segD[b * 2], d1z = segD[b * 2 + 1];
    let tx = d0x + d1x, tz = d0z + d1z, tl = Math.hypot(tx, tz);
    if (tl < 1e-4) { tx = d1x; tz = d1z; tl = 1; }
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx, s = 1 / Math.max(.4, nx * -d0z + nz * d0x);
    M[i].set(nx * s, 0, nz * s);
  }
}
function sample(tr, d, out, dir) {
  let i = 0;
  while (i < 2 && d > tr.cum[i + 1]) i++;
  const a = tr.q[i], b = tr.q[i + 1], L = tr.cum[i + 1] - tr.cum[i];
  if (L < 1e-5) { out.copy(b); return; }
  out.lerpVectors(a, b, (d - tr.cum[i]) / L);
  dir.subVectors(b, a).divideScalar(L);
}
// Does a trace segment [ax, az, bx, bz, half width] cross a box [x0, z0, x1, z1]?
function segBox([ax, az, bx, bz, w], [x0, z0, x1, z1]) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0 + w], [dx, x1 + w - ax], [-dz, az - z0 + w], [dz, z1 + w - az]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return true;
}
// Do two trace runs come within their widths of each other, outside the box `under` (the chip they start from)? Sampled:
// runs are short.
function segsCross(a, b, under) {
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = a[0] + (a[2] - a[0]) * t, z = a[1] + (a[3] - a[1]) * t;
    if (under && x > under[0] - .15 && x < under[2] + .15 && z > under[1] - .15 && z < under[3] + .15) continue;
    if (segBox(b, [x - a[4], z - a[4], x + a[4], z + a[4]])) return true;
  }
  return false;
}
// Shelf packing, tallest first: sets x, y on each item and returns the height used.
function pack(items, W) {
  let x = 0, y = 0, row = 0;
  for (const it of [...items].sort((a, b) => b.h - a.h)) { if (x + it.w > W) { x = 0; y += row; row = 0; } it.x = x; it.y = y; x += it.w; row = Math.max(row, it.h); }
  return y + row;
}

// ── Chip designs ──
// A design is the package and what's soldered round it, in board units about the chip's centre: parts [mesh, x, y, z, half x,
// height, half z, colour, turn], copper pads, silkscreen, the face its state shows on, the footprint (foot) and extent (ext).
function design(n, r) {
  const pick = list => list[Math.floor(r() * list.length)], b36 = n.seed.toString(36).toUpperCase().padStart(7, '0');
  const d = { parts: [], pads: [], silk: [], text: [], face: null, foot: [0, 0], top: 0, ext: [0, 0, 0, 0], name: '', notch: 0 };
  d.part = n.kind === 'project' ? `AIC-${b36.slice(-4)}` : `${PREFIX[n.provider] || 'IC'}${b36.slice(-5)}`;
  d.date = `${21 + n.seed % 6}${String(1 + (n.seed >>> 6) % 52).padStart(2, '0')}`;
  d.ref = n.kind === 'project' ? `U${1 + n.seed % 9}` : n.kind === 'session' ? `U${10 + n.seed % 90}` : `U${100 + n.seed % 900}`;
  (n.kind === 'project' ? junction : n.kind === 'session' ? chip : small)(d, r, pick);
  if (n.kind === 'session') grow(d, 1.4);
  else if (n.kind === 'project') { grow(d, 1.3); d.ring *= 1.3; }
  const [fx, fz] = d.foot;
  d.ext = [-fx, -fz, fx, fz];
  const big = n.kind === 'session' ? .19 : .13;
  d.text.push([d.ref, -fx, -fz - big * .9, big, 'left']);
  if (n.kind === 'project' || d.face.top === 1) d.text.push([d.part, -fx, fz + big * .9, big * .75, 'left']);
  d.ext[1] -= big * 1.5; if (d.text.length > 1) d.ext[3] += big * 1.4;
  if (d.ring) d.ext = d.ext.map((e, i) => i < 2 ? Math.min(e, -d.ring - .12) : Math.max(e, d.ring + .12));
  return d;
}
const put = (d, t, x, y, z, hx, h, hz, color, ry = 0, rx = 0) => d.parts.push([t, x, y, z, hx, h, hz, color, ry, rx]);
// A display module: its own board with a bezel round the glass (the glass is drawn by the look) and a pin header on the
// edge facing its chip, where its bus comes in.
function display(d, { x, z, header: [hx, hz] }, { w, h }) {
  put(d, BOX, x, 0, z, w / 2 + .16, .04, h / 2 + .16, 0x0a221c);
  put(d, BOX, x, .04, z, w / 2 + .07, .06, h / 2 + .07, 0x040507);
  const n = Math.max(3, Math.floor((hx ? h : w) * .5 / .16));
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * .16;
    if (hx) put(d, METAL, x + hx * (w / 2 + .14), 0, z + t, .05, .055, .035, TIN);
    else put(d, METAL, x + t, 0, z + hz * (h / 2 + .14), .035, .055, .05, TIN);
  }
}
let measurer = null;
const measure = (s, em) => { measurer ||= document.createElement('canvas').getContext('2d'); measurer.font = `600 100px ${DISPLAY}`; return measurer.measureText(s).width / 100 * em; };
// Sessions are the focus: their packages come a size up.
function grow(d, k) {
  for (const p of d.parts) { p[1] *= k; p[3] *= k; p[4] *= k; p[6] *= k; }
  for (const p of d.pads) for (let i = 0; i < 4; i++) p[i] *= k;
  for (const op of d.silk) for (let i = 1; i < op.length; i++) op[i] *= k;
  d.face.w *= k; d.face.d *= k; d.foot = d.foot.map(f => f * k);
}
// The face: its half size, height, top (0 moulded, 1 bare silicon, 2 nickel lid), and its size in face units.
function face(d, w, dz, y, top) { d.face = { w, d: dz, y, top, ext: w >= dz ? [w / dz, 1] : [1, dz / w] }; d.top = y; }
// m gull-wing leads on side s (0 +x, 1 +z, 2 -x, 3 -z) of a body (bx, bz), L long at height H, `span` kept clear at the corners.
function leads(d, s, m, bx, bz, L, H, span) {
  const along = s % 2 ? bx : bz, edge = s % 2 ? bz : bx, pitch = 2 * (along - span) / m, w = pitch * .22, nx = NX[s], nz = NZ[s];
  for (let i = 0; i < m; i++) {
    const t = -along + span + pitch * (i + .5), x = nx ? nx * edge : t, z = nz ? nz * edge : t;
    put(d, LEAD, x, 0, z, L, H, w, TIN, RY[s]);
    d.pads.push([x + nx * L * .74, z + nz * L * .74, nx ? L * .34 : w * 1.5, nz ? L * .34 : w * 1.5]);
  }
}
function flatPads(d, s, m, b, span) {
  const pitch = 2 * (b - span) / m, nx = NX[s], nz = NZ[s], w = pitch * .26;
  for (let i = 0; i < m; i++) {
    const t = -b + span + pitch * (i + .5), x = nx ? nx * (b - .015) : t, z = nz ? nz * (b - .015) : t;
    put(d, METAL, x, 0, z, nx ? .03 : w, .02, nz ? .03 : w, TIN);
    d.pads.push([x + nx * .07, z + nz * .07, nx ? .09 : w * 1.2, nz ? .09 : w * 1.2]);
  }
}
// Two-terminal SMD part (cap, resistor, tantalum) along x or z; y > 0 sits it on a substrate, without board pads.
function smd(d, kind, x, y, z, alongX, color) {
  const [L, W, h] = SMD[kind];
  put(d, BOX, x, y, z, alongX ? L * .62 : W, h, alongX ? W : L * .62, color);
  if (kind === 'tant') put(d, BOX, x - (alongX ? L * .45 : 0), y, z - (alongX ? 0 : L * .45), alongX ? L * .1 : W * 1.01, h * 1.02, alongX ? W * 1.01 : L * .1, 0x4a3209);
  for (const sg of [-1, 1]) {
    const cx = x + (alongX ? sg * L * .8 : 0), cz = z + (alongX ? 0 : sg * L * .8);
    put(d, METAL, cx, y, cz, alongX ? L * .2 : W, h * 1.02, alongX ? W : L * .2, TIN);
    if (!y) d.pads.push([cx + (alongX ? sg * .02 : 0), cz + (alongX ? 0 : sg * .02), alongX ? L * .2 + .03 : W + .02, alongX ? W + .02 : L * .2 + .03]);
  }
  if (!y) d.silk.push(['rect', x, z, (alongX ? L : W) + .05, (alongX ? W : L) + .05]);
}
function crystal(d, x, z, alongX) {
  const L = .2, W = .085;
  put(d, BOX, x, 0, z, (alongX ? L : W) + .02, .02, (alongX ? W : L) + .02, 0x15181b);
  put(d, METAL, x, .02, z, alongX ? L : W, .065, alongX ? W : L, TIN);
  for (const sg of [-1, 1]) d.pads.push([x + (alongX ? sg * L : 0), z + (alongX ? 0 : sg * L), alongX ? .06 : W + .03, alongX ? W + .03 : .06]);
  d.silk.push(['rect', x, z, (alongX ? L : W) + .07, (alongX ? W : L) + .07]);
}
function electrolytic(d, x, z, r0, h, sleeve) {
  put(d, BOX, x, 0, z, r0 + .02, .025, r0 + .02, 0x141414);
  put(d, CAN, x, .025, z, r0, h, r0, sleeve);
  put(d, CAN, x, .025 + h, z, r0 * .9, .008, r0 * .9, NICKEL);
  d.pads.push([x, z - r0 * .7, .05, .08], [x, z + r0 * .7, .05, .08]);
  d.silk.push(['rect', x, z, r0 + .06, r0 + .06], ['dot', x - r0 - .1, z - r0 + .02, .025]);
}

// A session: QFP, QFN, SOP, flip-chip BGA or a lidless SoC with a stiffener ring.
function chip(d, r, pick) {
  const pkg = pick(['qfp', 'qfp', 'qfn', 'bga', 'sop', 'soc']);
  if (pkg === 'qfp' || pkg === 'qfn') {
    const qfn = pkg === 'qfn', b = (qfn ? .56 : .58) + r() * .1, h = qfn ? .09 : .15, m = (qfn ? 5 : 6) + Math.floor(r() * 5);
    put(d, EPOXY, 0, 0, 0, b, h, b, pick(MOLD));
    for (let s = 0; s < 4; s++) qfn ? flatPads(d, s, m, b, b * .16) : leads(d, s, m, b, b, .17, h * .6, b * .14);
    const f = b + (qfn ? .17 : .2);
    face(d, b - .03, b - .03, h, 0); d.foot = [b + (qfn ? .12 : .17), b + (qfn ? .12 : .17)]; d.name = `${pkg.toUpperCase()}${4 * m}`;
    d.silk.push(['corners', 0, 0, f, f], ['dot', -f - .06, -f - .06, .035]);
  } else if (pkg === 'sop') {
    const alongX = r() < .5, hl = .74 + r() * .14, hs = .36 + r() * .1, h = .15, m = 5 + Math.floor(r() * 6), bx = alongX ? hl : hs, bz = alongX ? hs : hl;
    put(d, EPOXY, 0, 0, 0, bx, h, bz, r() < .35 ? pick(CERAMIC) : pick(MOLD));
    for (const s of alongX ? [1, 3] : [0, 2]) leads(d, s, m, bx, bz, .17, h * .6, hl * .08);
    face(d, bx - .03, bz - .03, h, 0); d.foot = alongX ? [bx, bz + .17] : [bx + .17, bz]; d.name = `SOP${2 * m}`; d.notch = 1;
    d.silk.push(['rect', 0, 0, bx + .04, bz + .04], ['dot', alongX ? -bx - .1 : -bx - .26, alongX ? -bz - .26 : -bz - .1, .035]);
  } else {
    const soc = pkg === 'soc', b = (soc ? .8 : .72) + r() * .08, sub = pick(SUBSTRATE), ds = (soc ? .3 : .36) + r() * (soc ? .1 : .14), dz = soc ? ds : ds * (.72 + r() * .28);
    put(d, EPOXY, 0, 0, 0, b, .05, b, sub);
    put(d, EPOXY, 0, .05, 0, ds, .04, dz, SILICON);
    if (soc) {
      const ring = b - .17, rc = r() < .5 ? NICKEL : COPPER;
      for (const s of [-1, 1]) { put(d, METAL, 0, .05, s * (ring - .035), ring, .035, .035, rc); put(d, METAL, s * (ring - .035), .05, 0, .035, .035, ring - .07, rc); }
    }
    const rim = soc ? b - .085 : (Math.max(ds, dz) + b) / 2 + .02, used = new Set();
    for (let k = 2 + Math.floor(r() * 5); k > 0; k--) {
      const s = Math.floor(r() * 4), slot = Math.floor(r() * 5);
      if (used.has(s * 5 + slot)) continue;
      used.add(s * 5 + slot);
      const t = (slot - 2) * (b - .16) / 2;
      smd(d, 'tiny', NX[s] ? NX[s] * rim : t, .05, NZ[s] ? NZ[s] * rim : t, !NX[s], pick(CAPS));
    }
    face(d, ds - .008, dz - .008, .09, 1); d.foot = [b, b]; d.name = `${soc ? 'SOC' : 'BGA'}${64 + 16 * Math.floor(r() * 12)}`;
    d.silk.push(['rect', 0, 0, b + .06, b + .06], ['chamfer', -b - .06, -b - .06, .18]);
  }
}
// A subagent: SOT-23, SO-8 or a small QFN.
function small(d, r, pick) {
  const pkg = pick(['sot', 'so', 'qfn']);
  if (pkg === 'qfn') {
    const b = .28, h = .07;
    put(d, EPOXY, 0, 0, 0, b, h, b, pick(MOLD));
    for (let s = 0; s < 4; s++) flatPads(d, s, 3, b, .05);
    face(d, b - .02, b - .02, h, 0); d.foot = [b + .1, b + .1]; d.name = 'QFN12';
    d.silk.push(['corners', 0, 0, b + .15, b + .15]);
    return;
  }
  const sot = pkg === 'sot', alongX = r() < .5, hl = sot ? .26 : .34, hs = sot ? .15 : .2, h = sot ? .1 : .11, bx = alongX ? hl : hs, bz = alongX ? hs : hl, L = sot ? .1 : .11;
  put(d, EPOXY, 0, 0, 0, bx, h, bz, pick(MOLD));
  const [s1, s2] = alongX ? [1, 3] : [0, 2];
  leads(d, s1, sot ? 3 : 4, bx, bz, L, h * .6, .04); leads(d, s2, sot ? 2 : 4, bx, bz, L, h * .6, sot ? .08 : .04);
  face(d, bx - .02, bz - .02, h, 0); d.foot = alongX ? [bx, bz + L] : [bx + L, bz]; d.name = sot ? 'SOT23' : 'SO8';
  d.silk.push(['rect', 0, 0, bx + .03, bz + .03]);
}
// A project: a small switch where its sessions' traces fan out, as a QFN, a leaded QFP or a lidded BGA, ringed by the vias
// its traces drop through.
function junction(d, r, pick) {
  const pkg = pick(['qfn', 'qfp', 'bga']), b = .48 + r() * .08;
  if (pkg === 'bga') {
    put(d, EPOXY, 0, 0, 0, b + .08, .05, b + .08, pick(SUBSTRATE));
    put(d, METAL, 0, .05, 0, b - .05, .07, b - .05, pick([NICKEL, NICKEL, GOLDLID]));
    face(d, b - .07, b - .07, .12, 2); d.foot = [b + .08, b + .08]; d.name = `BGA${100 + 16 * Math.floor(r() * 8)}`;
    d.silk.push(['rect', 0, 0, b + .14, b + .14], ['chamfer', -b - .14, -b - .14, .14]);
  } else {
    const qfn = pkg === 'qfn', h = qfn ? .09 : .13, m = 5 + Math.floor(r() * 4), f = b + (qfn ? .12 : .14);
    put(d, EPOXY, 0, 0, 0, b, h, b, pick(MOLD));
    for (let s = 0; s < 4; s++) qfn ? flatPads(d, s, m, b, b * .16) : leads(d, s, m, b, b, .14, h * .6, b * .14);
    face(d, b - .03, b - .03, h, 0); d.foot = [f, f]; d.name = `${pkg.toUpperCase()}${4 * m}`;
    d.silk.push(['corners', 0, 0, f + .05, f + .05]);
  }
  const k = 12 + 4 * Math.floor(r() * 3);
  d.ring = d.foot[0] + .32;
  for (let i = 0; i < k; i++) { const a = (i + .5) / k * TAU; d.silk.push(['via', Math.cos(a) * d.ring, Math.sin(a) * d.ring, .05]); }
}
// Parts round the package, placed only where fits() says the copper and other parts leave room.
function furnish(d, kind, r, fits) {
  const pick = list => list[Math.floor(r() * list.length)], [fx, fz] = d.foot;
  const tiny = kind === 'sub', main = kind === 'session', cands = [];
  for (let s = 0; s < 4; s++) for (const t of main ? [-.5, 0, .5] : [0]) cands.push([s, t]);
  shuffle(cands, r);
  let want = main ? 2 + Math.floor(r() * 5) : Math.floor(r() * 3), extra = !main ? null : r() < .3 ? 'xtal' : r() < .25 ? 'electro' : null;
  for (const [s, t] of cands) {
    if (!want && !extra) break;
    const nx = NX[s], nz = NZ[s], alongX = !nx, kind2 = extra || (tiny ? 'tiny' : pick(['cap', 'cap', 'cap', 'res', 'res', 'tant']));
    const [len, wid] = kind2 === 'xtal' ? [.22, .1] : kind2 === 'electro' ? [.14, .14] : SMD[kind2];
    const dist = (d.ring || (nx ? fx : fz)) + .1 + wid, x = nx ? nx * dist : t * fx, z = nz ? nz * dist : t * fz;
    const hx = alongX ? len : wid, hz = alongX ? wid : len;
    if (!fits([x - hx - .04, z - hz - .04, x + hx + .04, z + hz + .04])) continue;
    if (kind2 === 'xtal') crystal(d, x, z, alongX);
    else if (kind2 === 'electro') electrolytic(d, x, z, .12, .22, pick(SLEEVE));
    else smd(d, kind2, x, 0, z, alongX, kind2 === 'res' ? RES : kind2 === 'tant' ? TANT : pick(CAPS));
    if (kind2 === extra) extra = null; else want--;
  }
}
function shuffle(list, r) { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; }

// Unit gull-wing lead: out along +x from the body's edge (0..1), up to the shoulder (0..1), width -1..1.
function leadGeometry(THREE) {
  const parts = [[0, .42, .62, 1], [.3, .56, .08, 1], [.46, 1, 0, .3]].map(([x0, x1, y0, y1]) => new THREE.BoxGeometry(x1 - x0, y1 - y0, 2).translate((x0 + x1) / 2, (y0 + y1) / 2, 0));
  const g = mergeGeometries(parts); parts.forEach(p => p.dispose());
  return g;
}

// ── Atlas drawing: silkscreen in red, copper in green, in board units (k px each) about the cell's centre ──
const SILK = 'rgb(255,0,0)', CU = 'rgb(0,255,0)', TAU = Math.PI * 2;
function text(g, k, s, x, y, size, align = 'center', weight = 600, family = FONT, maxWidth) {
  g.save(); g.translate(x, y); g.scale(1 / k, 1 / k);
  g.font = `${weight} ${(size * k).toFixed(1)}px ${family}`; g.textAlign = align; g.textBaseline = 'middle';
  maxWidth ? g.fillText(s, 0, 0, maxWidth * k) : g.fillText(s, 0, 0); g.restore();
}
function drawDecal(g, k, d) {
  g.fillStyle = CU;
  for (const [x, z, hx, hz] of d.pads) g.fillRect(x - hx, z - hz, hx * 2, hz * 2);
  g.strokeStyle = g.fillStyle = SILK; g.lineWidth = .028; g.lineJoin = 'miter';
  for (const [op, x, z, a, b] of d.silk) {
    if (op === 'rect') g.strokeRect(x - a, z - b, a * 2, b * 2);
    else if (op === 'dot') { g.beginPath(); g.arc(x, z, a, 0, TAU); g.fill(); }
    else if (op === 'chamfer') { g.beginPath(); g.moveTo(x, z + a); g.lineTo(x, z); g.lineTo(x + a, z); g.closePath(); g.fill(); }
    else if (op === 'corners') {
      const c = Math.min(a, b) * .32;
      g.beginPath();
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { g.moveTo(x + sx * a, z + sz * (b - c)); g.lineTo(x + sx * a, z + sz * b); g.lineTo(x + sx * (a - c), z + sz * b); }
      g.stroke();
    } else if (op === 'via') { g.strokeStyle = CU; g.lineWidth = a * .7; g.beginPath(); g.arc(x, z, a, 0, TAU); g.stroke(); g.strokeStyle = SILK; g.lineWidth = .028; }
  }
  g.fillStyle = SILK;
  for (const [s, x, z, size, align, family = FONT, color = SILK] of d.text) { g.fillStyle = color; text(g, k, s, x, z, size, align, 600, family); }
}
// The laser marking on a chip top, in face units (canvas y is the face's -y).
function drawMark(g, k, d, kind) {
  const [ex, ey] = d.face.ext;
  g.fillStyle = SILK;
  if (kind === 'project') { text(g, k, d.part, 0, -.86, .12, 'center', 700, FONT, ex * 1.3); return; }
  g.beginPath(); g.arc(-ex + .14, ey - .14, kind === 'sub' ? .07 : .04, 0, TAU); g.fill();
  if (d.notch) { g.beginPath(); ex > ey ? g.arc(-ex, 0, .13, 0, TAU) : g.arc(0, ey, .1, 0, TAU); g.fill(); }
  if (kind === 'sub' || d.face.top) return;
  text(g, k, d.part, 0, -.66, .13, 'center', 700, FONT, ex * 1.3);
  text(g, k, `${d.name} ${d.date}`, 0, .63, .1, 'center', 400, FONT, ex * 1.3);
}

// A screenshot module's board top: solder mask, outline, mounting holes, pads for the parts and the header, and its name.
function drawLcdBoard(g, k, [hx, hz]) {
  const W = LCD_W, D = LCD_D, silk = 'rgba(200, 228, 232, .55)', gold = '#8a6d2c', nz = D / 2 + LCD_Z_REL + SHOT_H / 2 + .12;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = '#0b2b23'; g.fillRect(0, 0, W, D);
  g.strokeStyle = silk; g.lineWidth = .02; g.strokeRect(.07, .07, W - .14, D - .14);
  for (const [x, z] of [[.17, .17], [W - .17, .17], [.17, D - .17], [W - .17, D - .17]]) { g.fillStyle = gold; g.beginPath(); g.arc(x, z, .09, 0, TAU); g.fill(); g.fillStyle = '#020608'; g.beginPath(); g.arc(x, z, .05, 0, TAU); g.fill(); }
  g.fillStyle = gold;
  g.fillRect(W / 2 - 1.05 - .22, nz + .25 - .22, .44, .44); g.fillRect(W / 2 + .55 - .45, nz + .24 - .1, .9, .2);
  for (let i = 0; i < 8; i++) { const t = (i - 3.5) * .16; if (hx) g.fillRect(hx > 0 ? W - .16 : .02, D / 2 + t - .05, .14, .1); else g.fillRect(W / 2 + t - .05, hz > 0 ? D - .16 : .02, .1, .14); }
  g.fillStyle = silk; text(g, k, 'LCD-01', .34, .26, .14, 'left', 600, FONT);
}
// ── Usage cards ──
// A row per window and for spend: label and reset time on the left, the readout on the right, a thin LED bar beneath.
// In card units, origin top left.
function cardLayout(a) {
  const rows = [...a.windows.slice(0, 3).map((w, i) => ({ w: i, label: w.label === 'week' ? 'WEEK' : w.label.toUpperCase() })), ...(a.spend?.limit ? [{ w: -1, label: 'SPEND' }] : [])].slice(0, ROWS);
  const W = CARD_W, D = .74 + rows.length * 1.14 + .08, sp = (W - .6) / LEDS;
  rows.forEach((row, i) => {
    row.z = .74 + i * 1.14; row.note = '';
    const n = row.w < 0 ? 4 : 3, right = row.w < 0 ? W - 1.2 : W - .66;
    row.digits = Array.from({ length: n }, (_, j) => right - (n - j - .5) * (2 * DW + .1));
    row.leds = Array.from({ length: LEDS }, (_, j) => .3 + (j + .5) * sp); row.lw = sp * .36;
  });
  return { rows, W, D };
}
function drawCard(g, lay, a, side) {
  const { W, D } = lay, k = CARD_K, silk = 'rgba(190, 220, 228, .4)';
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, CARD_PX, CARD_H);
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = '#041015'; g.fillRect(0, 0, W, D);
  // Gold fingers on the edge that plugs into the reactor's socket, holes in the corners, an outline and the header.
  g.fillStyle = '#6d5522';
  for (let z = .45; z < D - .3; z += .2) g.fillRect(side < 0 ? W - .14 : .02, z, .12, .12);
  for (const [x, z] of [[.22, .22], [W - .22, .22], [.22, D - .22], [W - .22, D - .22]]) { g.fillStyle = '#7a6229'; g.beginPath(); g.arc(x, z, .09, 0, TAU); g.fill(); g.fillStyle = '#020608'; g.beginPath(); g.arc(x, z, .05, 0, TAU); g.fill(); }
  g.strokeStyle = silk; g.lineWidth = .022; g.strokeRect(.12, .12, W - .24, D - .24);
  g.fillStyle = '#eefbfd';
  text(g, k, a.label.toUpperCase(), .4, .4, .4, 'left', 600, DISPLAY, W - 1.2);
  providerMark(g, a.provider, W - .5, .4, .17, '#9ff2ff');
  g.fillStyle = silk; g.fillRect(.24, .68, W - .48, .025);
  for (const row of lay.rows) {
    const d0 = row.digits[0] - DW - .07, d1 = row.digits[row.digits.length - 1] + DW + .08, cz = row.z + .44;
    g.fillStyle = '#9ff2ff'; text(g, k, row.label, .3, row.z + .3, .34, 'left', 600, DISPLAY, d0 - .55);
    g.fillStyle = '#a9c9d0'; text(g, k, row.w < 0 ? '' : row.note, .3, row.z + .7, .24, 'left', 400, FONT, d0 - .5);
    g.fillStyle = '#010405'; g.fillRect(d0, cz - DH - .07, d1 - d0, 2 * DH + .14); g.fillRect(.24, row.z + .91, W - .48, .14);
    g.fillStyle = '#c8e6ec';
    if (row.w < 0) { text(g, k, '$', d0 - .03, cz, .34, 'right', 400, FONT); text(g, k, row.note, d1 + .06, cz, .28, 'left', 400, FONT, W - .26 - d1); }
    else text(g, k, '%', d1 + .05, cz + .08, .26, 'left', 400, FONT);
  }
}
function providerMark(g, provider, x, z, r, color) {
  g.save(); g.strokeStyle = color; g.lineWidth = .025; g.beginPath();
  if (provider === 'claude') for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.moveTo(x, z); g.lineTo(x + Math.cos(a) * r, z + Math.sin(a) * r); }
  else if (provider === 'codex') for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, z + Math.sin(a) * r); }
  else { g.moveTo(x - r * .3, z - r); g.lineTo(x - r * .8, z - r); g.lineTo(x - r * .8, z + r); g.lineTo(x - r * .3, z + r); g.moveTo(x + r * .3, z - r); g.lineTo(x + r * .8, z - r); g.lineTo(x + r * .8, z + r); g.lineTo(x + r * .3, z + r); }
  g.stroke(); g.restore();
}
const pad2 = v => String(v).padStart(2, '0');
// When a window resets: the clock time within a day, else days.
function resetText(at) {
  if (!at) return '';
  const ms = at - Date.now();
  if (ms <= 0) return 'NOW';
  if (ms < 864e5) { const d = new Date(at); return `↻${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  return `↻${Math.round(ms / 864e5)}D`;
}
const money = v => v >= 1000 ? String(Math.min(9999, Math.round(v))) : v >= 100 ? v.toFixed(1) : v.toFixed(2);

// The decorative copper: trace bundles that turn in 45° steps and end in vias, passives, IC footprints and silkscreen.
// Drawn wrapped so the tile repeats seamlessly.
function drawBoard(g, n, rand) {
  const R = 'rgb(255,0,0)', G = 'rgb(0,255,0)', B = 'rgb(0,0,255)';
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = 'lighter';
  const wrapped = fn => { for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.setTransform(1, 0, 0, 1, ox, oy); fn(); } g.setTransform(1, 0, 0, 1, 0, 0); };
  const D8 = [[1, 0], [.7071, .7071], [0, 1], [-.7071, .7071], [-1, 0], [-.7071, -.7071], [0, -1], [.7071, -.7071]];
  const offset = (pts, o) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], c = pts[i];
    let d0x = c[0] - a[0], d0y = c[1] - a[1], d1x = b[0] - c[0], d1y = b[1] - c[1];
    const l0 = Math.hypot(d0x, d0y) || 1, l1 = Math.hypot(d1x, d1y) || 1;
    d0x /= l0; d0y /= l0; d1x /= l1; d1y /= l1;
    if (i === 0) { d0x = d1x; d0y = d1y; } if (i === pts.length - 1) { d1x = d0x; d1y = d0y; }
    let tx = d0x + d1x, ty = d0y + d1y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, s = 1 / Math.max(.4, nx * -d0y + ny * d0x);
    return [c[0] + nx * s * o, c[1] + ny * s * o];
  });
  for (let b = 0; b < 52; b++) {
    const k = 1 + Math.floor(rand() * 6), pitch = 12, w = rand() < .2 ? 6 : 3;
    let x = rand() * n, y = rand() * n, d = Math.floor(rand() * 4) * 2;
    const pts = [[x, y]], segs = 2 + Math.floor(rand() * 3);
    for (let s = 0; s < segs; s++) {
      const len = d % 2 ? 40 + rand() * 90 : 70 + rand() * 280;
      x += D8[d][0] * len; y += D8[d][1] * len; pts.push([x, y]);
      d = (d + (rand() < .5 ? 1 : 7)) % 8;
    }
    for (let j = 0; j < k; j++) {
      const q = offset(pts, (j - (k - 1) / 2) * pitch);
      wrapped(() => {
        g.strokeStyle = R; g.lineWidth = w; g.lineJoin = 'miter'; g.beginPath();
        q.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.stroke();
        for (const [px, py] of [q[0], q[q.length - 1]]) { g.strokeStyle = G; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, 5.5, 0, TAU); g.stroke(); }
      });
    }
  }
  for (let i = 0; i < 110; i++) {
    const x = rand() * n, y = rand() * n, rot = rand() < .5, L = 14 + rand() * 12, W = 8 + rand() * 4;
    wrapped(() => {
      g.save(); g.translate(x, y); if (rot) g.rotate(Math.PI / 2);
      g.fillStyle = G; g.fillRect(-L / 2 - 3, -W / 2, 7, W); g.fillRect(L / 2 - 4, -W / 2, 7, W);
      g.strokeStyle = B; g.lineWidth = 1.5; g.strokeRect(-L / 2 - 6, -W / 2 - 3, L + 12, W + 6); g.restore();
    });
  }
  for (let i = 0; i < 9; i++) {
    const x = rand() * n, y = rand() * n, cols = 5 + Math.floor(rand() * 8), w = cols * 13 + 22, h = 50 + rand() * 70, label = `U${3 + i * 2}`;
    wrapped(() => {
      g.fillStyle = G;
      for (let c = 0; c < cols; c++) { g.fillRect(x - w / 2 + 14 + c * 13, y - h / 2 - 12, 6, 13); g.fillRect(x - w / 2 + 14 + c * 13, y + h / 2 - 1, 6, 13); }
      g.strokeStyle = B; g.lineWidth = 2; g.strokeRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle = B; g.beginPath(); g.arc(x - w / 2 + 10, y - h / 2 + 10, 3.5, 0, TAU); g.fill();
      g.font = '600 15px monospace'; g.fillText(label, x - w / 2, y - h / 2 - 20);
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = rand() * n, y = rand() * n, label = ['R', 'C', 'L', 'TP', 'D', 'Q', 'J'][Math.floor(rand() * 7)] + (1 + Math.floor(rand() * 64));
    wrapped(() => { g.fillStyle = B; g.font = '500 12px monospace'; g.fillText(label, x, y); });
  }
  for (let i = 0; i < 14; i++) {
    const x0 = rand() * n, y0 = rand() * n, cols = 2 + Math.floor(rand() * 5), rows = 2 + Math.floor(rand() * 4);
    wrapped(() => { g.strokeStyle = G; g.lineWidth = 2; for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) { g.beginPath(); g.arc(x0 + a * 18, y0 + b * 18, 4.5, 0, TAU); g.stroke(); } });
  }
  for (let i = 0; i < 6; i++) {
    const x = rand() * n, y = rand() * n;
    wrapped(() => { g.strokeStyle = G; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 12, 0, TAU); g.stroke(); g.fillStyle = G; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); });
  }
}
