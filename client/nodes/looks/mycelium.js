// Mycelium: a forest floor at dusk. Projects are clusters of glowing mushrooms, sessions single mushrooms, subagents pinheads,
// and You an old stump in a fairy ring. Every project and session grows its own species from its seed.
// One mycelium ties it together. Every hypha, from a cord's strands to the felt round a foot, is the same thin glowing thread:
// a cord is a twisted bundle of them that fans out of its mushroom's bulb, merges into its parent's cord and fades into it, and
// the trunks climb the stump's roots into its bark. A soft ribbon under each cord lights the soil.
// Read without the labels: cap glow is status, cap size and falling spores are context, pinheads round the foot are plan steps,
// the ring on the stem is the mode, an amber hypha grows to the stump while a session needs you, and the fairy ring lights up
// with each usage window's use. Threads and cords are fixed meshes that the vertex shader lays along each cord's centre line, which
// the CPU works out from the springs and keeps in a float texture, uploading only what changed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL, Pulses, Tube, statusColor, clamp, smoothstep, easeOutBack, rng, vignettePass } from '../kit.js';

const CSS = `
body[data-look="mycelium"] { --bg: #060705; --fg: #ecf2e2; --muted: #93a08a; --panel: rgba(12, 15, 10, .84); --line: rgba(200, 236, 176, .14); --accent: #a4f0a0;
  --need: #ffb24a; --work: #6dffa8; --err: #ff6a4a; --wait: #82aaff; --font: "Figtree", system-ui, sans-serif; --mono: "JetBrains Mono", ui-monospace, monospace;
  --display: "Fraunces", Georgia, serif; --radius: 12px; --label: #f3f7ea; --label-sub: #aebba4; --label-halo: rgba(3, 5, 2, .9); --shadow: 0 10px 34px rgba(0, 0, 0, .55); }
body[data-look="mycelium"] .lbl.project b { font-size: 15px; font-style: italic; font-weight: 500; letter-spacing: .01em; }
body[data-look="mycelium"] .lbl.you b { font-style: italic; font-weight: 500; }
body[data-look="mycelium"] :is(.lbl.session, .lbl.sub) b { font-family: var(--font); font-weight: 600; }
/* Labels are little tags of loam, edged with a faint glow; amber when it needs you, ember when it failed. */
body[data-look="mycelium"] .lbl { padding: 2px 9px 3px; border-radius: 10px 10px 10px 3px; text-shadow: none;
  background: radial-gradient(130% 160% at 0% 0%, rgba(46, 72, 34, .45), transparent 55%), rgba(7, 10, 6, .86);
  box-shadow: inset 0 0 0 1px rgba(164, 240, 160, .15), 0 0 10px -3px rgba(110, 240, 150, .28), 0 3px 8px -3px #000; }
body[data-look="mycelium"] .lbl b { font-size: 12.5px; line-height: 1.25; }
body[data-look="mycelium"] .lbl span { font-size: 10.5px; line-height: 1.35; }
body[data-look="mycelium"] .lbl.project { padding: 0 8px 1px; border-radius: 9px; background: rgba(7, 10, 6, .72); box-shadow: inset 0 0 0 1px rgba(164, 240, 160, .1); }
body[data-look="mycelium"] .lbl.project b { font-size: 13.5px; color: var(--label-sub); }
body[data-look="mycelium"] .lbl.need { background: radial-gradient(130% 160% at 0% 0%, rgba(130, 78, 18, .5), transparent 60%), rgba(12, 9, 4, .9);
  box-shadow: inset 0 0 0 1px rgba(255, 178, 74, .6), 0 0 14px -3px rgba(255, 168, 60, .55), 0 3px 8px -3px #000; }
body[data-look="mycelium"] .lbl.error { background: radial-gradient(130% 160% at 0% 0%, rgba(120, 30, 14, .5), transparent 60%), rgba(12, 6, 4, .9);
  box-shadow: inset 0 0 0 1px rgba(255, 106, 74, .55), 0 3px 8px -3px #000; }
body[data-look="mycelium"] .lbl.sub { padding: 0 3px; background: none; box-shadow: none; text-shadow: 0 0 6px var(--label-halo), 0 0 2px var(--label-halo); }
body[data-look="mycelium"] .lbl.sub b { font-size: 11px; font-weight: 500; }
body[data-look="mycelium"] .lbl.sub:not(.need, .error) b { color: var(--label-sub); }
body[data-look="mycelium"] .nodes-tip { border-color: rgba(164, 240, 160, .16); box-shadow: 0 0 0 1px rgba(0, 0, 0, .4), 0 14px 40px rgba(0, 0, 0, .6), inset 0 1px 0 rgba(220, 255, 200, .05); }
body[data-look="mycelium"] .nodes-tip b { font-style: italic; font-weight: 500; }
body[data-look="mycelium"] .nodes-overlay button { border-radius: 999px; }
`;

// Bioluminescent status colours; kit.statusColor blends them by the smoothed signals.
const PAL = { work: '#6dffa8', think: '#4fe3ff', compact: '#b98cff', need: '#ffaa3c', wait: '#7aa2ff', idle: '#a9b89e', error: '#ff4a2a', off: '#4b4540' };
const TOOL = { edit: '#c8ff6a', read: '#62e2ff', search: '#c39bff', bash: '#ffa25a', web: '#7aa8ff', agent: '#ff7ad9', '': '#d8ffe8' };
const HUES = ['#4dffc8', '#5ac2ff', '#b4ff5a', '#9c8cff', '#ffe066'];
// Cap colours of the species, before the status glow: rust, tan, cream, heather, umber, fox, olive, rose, ochre.
const CAPS = ['#9a5a3a', '#b8925e', '#d9c9a6', '#6f5f80', '#5a4434', '#b0683c', '#7d8a5e', '#c49aa0', '#a08048'];
const C = k => new THREE.Color(k), BUSY = new Set(['working', 'thinking', 'compacting']);
const INST_ATTRS = ['aCol', 'aP', 'aQ'], KIND = { proj: 0, sess: 1, sub: 2, need: 3 };
// The palette as colours: kit.statusColor would parse the strings on every call.
const PALC = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, new THREE.Color(v)]));
const TOOL_C = Object.fromEntries(Object.entries(TOOL).map(([k, v]) => [k, C(v)]));
const AMBER = C(PAL.need), EMBER = C('#ff5a24'), FOX = C('#7dffcf'), REPLY = C('#eaffd8'), WHITE = C('#f2ffe8'), SPORE = C('#e8dcc0');
const PUFF = { work: C(PAL.work), compact: C(PAL.compact), soil: C('#8a6a48'), ash: C('#b8b0a0'), rot: C('#7a2a14') };

const TETH = 6, BR = 7, FEED = 5; // samples in a cluster tether, an anastomosis bridge and a pinhead's feeding thread
const PK = 1.3; // how much larger a project's cluster grows than its species' base size
// Per kind of cord: centre-line samples, glow width, strands in the bundle, bundle half-width, strand half-width, side branches,
// meander, branch scale, samples carried on past the join, and how far the strands carry on into the parent before fading.
const CFG = {
  proj: { segs: 48, width: .1, strands: 7, bundle: .085, thread: .016, branches: 14, amp: .07, scale: 1.5, cont: 16 },
  sess: { segs: 32, width: .07, strands: 5, bundle: .05, thread: .012, branches: 8, amp: .09, scale: 1, cont: 10, carry: 2.6 },
  sub: { segs: 16, width: .04, strands: 3, bundle: .028, thread: .009, branches: 3, amp: .1, scale: .6, cont: 6, carry: 1.3 },
  need: { segs: 44, width: .06, strands: 4, bundle: .035, thread: .014, branches: 5, amp: .035, scale: .9, cont: 0 },
};
// Cap profiles (radius 1 at the rim): convex, conical, flat with a boss, funnel, bell. Caps are widened to taste per shape.
const CAP_SHAPES = [
  [[0, .07], [.3, .075], [.62, .055], [.88, .02], [1, 0], [1.03, .07], [.99, .2], [.91, .36], [.77, .5], [.57, .61], [.32, .67], [0, .69]],
  [[0, .15], [.35, .12], [.75, .04], [1, 0], [.95, .12], [.8, .38], [.6, .66], [.4, .92], [.22, 1.15], [.08, 1.32], [0, 1.36]],
  [[0, .06], [.35, .06], [.75, .035], [1, 0], [1.04, .06], [.98, .13], [.8, .19], [.55, .23], [.3, .26], [.13, .31], [0, .34]],
  [[0, 0], [.3, .01], [.6, .06], [.85, .14], [1, .22], [1.04, .3], [.98, .33], [.8, .26], [.55, .18], [.28, .13], [0, .11]],
  [[0, .1], [.4, .08], [.8, .02], [1, 0], [.98, .08], [.87, .26], [.7, .5], [.5, .74], [.3, .93], [.13, 1.05], [0, 1.09]],
];
// Cords are sampled densely at both ends, where they fan out of a bulb and fold into another cord, and sparsely between.
const warp = t => t - .62 * Math.sin(2 * Math.PI * t) / (2 * Math.PI);
const near = (L, t) => { let i = 0; while (i < L.segs && L.tt[i + 1] <= t) i++; return i < L.segs && t - L.tt[i] > L.tt[i + 1] - t ? i + 1 : i; };
const SHAPE_R = [1, .8, 1.1, 1, .86], SHAPE_SEAT = CAP_SHAPES.map(p => p[0][1] + .04), SHAPE_TOP = CAP_SHAPES.map(p => Math.max(...p.map(q => q[1])));
// A species from a seed: cap shape and colour, pattern on top (none, warts, scales, fibrils) plus 4 for pores under it
// instead of gills, stem colour and build.
function speciesOf(r, shapes = [0, 1, 2, 3, 4]) {
  const shape = shapes[Math.floor(r() * shapes.length)], alb = C(CAPS[Math.floor(r() * CAPS.length)]).offsetHSL((r() - .5) * .05, (r() - .5) * .1, (r() - .5) * .08);
  return { shape, alb, stem: alb.clone().lerp(C('#e4dac4'), .55 + r() * .35), pat: Math.floor(r() * 4) + (r() < .3 ? 4 : 0),
    tall: .82 + r() * .45, wide: (.86 + r() * .3) * SHAPE_R[shape], ys: .85 + r() * .3, thick: .8 + r() * .45, lean: .5 + r() * 1.1 };
}

export default { id: 'mycelium', name: 'Mycelium', css: CSS, create };

function create(ctx) {
  const { scene, root, camera, renderer, world, size } = ctx;
  const reduced = () => ctx.reduced;
  ctx.setView({ tilt: .9, fov: 30 });
  ctx.setPost({ bloom: { strength: .8, radius: .55, threshold: .6 }, exposure: 1 });
  ctx.addPass(vignettePass({ darkness: .62, offset: 1, grain: .022, tint: '#f6f1e6' }));
  scene.background = C('#050604');
  // Sessions are the bodies to look at; a project is only the knot where their cords meet.
  ctx.setSizes({ project: .7 * PK, session: 1.5, sub: .55 });
  // Below the foot, or when that's taken, above the crown of the cap.
  ctx.setLabelAnchor((n, out) => { out.y = 0; out.z += n.kind === 'you' ? 4.1 : n.kind === 'project' ? .95 * PK : n.kind === 'session' ? 1.6 : .75; },
    (n, out) => { const m = n.kind === 'you' ? null : n.kind === 'project' ? clusters.get(n)?.[0] : mushOf.get(n); if (m) out.set(m.top.x, m.crown + .12, m.top.z); else out.y = 1.5; });

  // T is the look's clock; T0, the shaders', stands still in reduced motion, so nothing on the GPU moves by itself then.
  // busy and springy gather, each frame, what update's pace needs: something fading or flowing, or a spring still bouncing.
  const T0 = { value: 0 };
  let T = 0, busy = false, springy = false;

  // ── Soil: leaf litter lit by the glow pools around every mushroom ──
  // The pools are splatted as soft quads into a small light map over the box they cover, redrawn only when one changes, so the
  // ground reads one texel a pixel.
  const EXTENT = 110, LIGHTS = 40, LM = 512;
  const lData = new Float32Array(LIGHTS * 4), lCol = new Float32Array(LIGHTS * 3), lSeenD = new Float32Array(LIGHTS * 4), lSeenC = new Float32Array(LIGHTS * 3);
  let lSeenN = -1;
  const lmRT = new THREE.WebGLRenderTarget(LM, LM, { type: THREE.HalfFloatType, depthBuffer: false });
  lmRT.texture.userData.keep = true; // disposed with its render target, in dispose()
  const LB = new THREE.Vector4(0, 0, 1, 1); // the light map's box: x and z of its corner, 1 / its width and depth
  const lmGeo = new THREE.InstancedBufferGeometry();
  lmGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
  lmGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const aL = new THREE.InstancedBufferAttribute(lData, 4).setUsage(THREE.DynamicDrawUsage), aLC = new THREE.InstancedBufferAttribute(lCol, 3).setUsage(THREE.DynamicDrawUsage);
  lmGeo.setAttribute('aL', aL); lmGeo.setAttribute('aLC', aLC); lmGeo.instanceCount = 0;
  const lmMat = new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide, uniforms: { uLB: { value: LB } },
    vertexShader: 'attribute vec4 aL; attribute vec3 aLC; uniform vec4 uLB; varying vec2 vD; varying vec3 vC; void main(){ vD = position.xy * 3.2; vC = aLC * aL.w; vec2 w = aL.xy + vD * aL.z; gl_Position = vec4((w - uLB.xy) * uLB.zw * 2.0 - 1.0, 0.0, 1.0); }',
    fragmentShader: 'varying vec2 vD; varying vec3 vC; void main(){ gl_FragColor = vec4(vC * exp(-dot(vD, vD)), 1.0); }' });
  const lmScene = new THREE.Scene(), lmCam = new THREE.Camera(), lmMesh = new THREE.Mesh(lmGeo, lmMat);
  lmMesh.frustumCulled = false; lmScene.add(lmMesh);
  const groundMat = new THREE.ShaderMaterial({
    uniforms: { uSoil: { value: soilTexture() }, uLM: { value: lmRT.texture }, uLB: { value: LB }, uExtent: { value: EXTENT }, uCenter: { value: new THREE.Vector2(0, 1.5) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${NOISE_GLSL}
      uniform sampler2D uSoil, uLM; uniform float uExtent; uniform vec4 uLB; uniform vec2 uCenter; varying vec3 vW;
      void main(){
        vec3 soil = texture2D(uSoil, vW.xz / uExtent + .5).rgb;
        soil *= .82 + .36 * (snoise(vec3(vW.xz * 2.7, 0.0)) * .5 + .5);
        vec3 light = texture2D(uLM, (vW.xz - uLB.xy) * uLB.zw).rgb;
        vec3 col = soil * (vec3(.46, .5, .6) + light * 2.3) + light * .03;
        col *= smoothstep(58.0, 24.0, length(vW.xz - uCenter));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(170, 170).rotateX(-Math.PI / 2), groundMat));

  // ── Mushrooms: five cap shapes and one stem, all instanced, shaded by hand ──
  const lathe = pts => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 36);
  const capGeo = CAP_SHAPES.map(lathe);
  // The foot swells into a bulb that sinks into the soil, so the stem sits in its mat rather than standing on it.
  const stemGeo = lathe([[0, -.04], [1.62, -.04], [1.7, .02], [1.5, .1], [1.2, .2], [.98, .36], [.85, .65], [.79, .92], [.77, 1], [0, 1]]);
  const skirtGeo = lathe([[.95, .05], [1.45, -.08], [1.8, -.3], [1.74, -.35], [1.36, -.17], [.95, -.03]]);

  // Nothing here is a rigid solid. Caps get wavy, lopsided rims that ripple slowly, and curl up when the session's context is
  // nearly full. Stems stay rooted at the foot and bend along a curve: aB.xy is where the top swings to (lean, sway, drag, wilt)
  // and aB.zw a bow through the middle. Shading reads the unbent shape (vL), so patterns stay put.
  // aCol status colour, aA the species' own colour; aP (glow, context or -1, rot, wither);
  // caps aQ (seed, rim light, small, pattern), stems aQ (seed, -, has a cord, the cord's heading round the stem).
  const MOVE = { value: 1 };
  const mushMat = (cap) => new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: T0, uMove: MOVE },
    vertexShader: `attribute vec3 aCol, aA; attribute vec4 aP, aQ;${cap ? '' : ' attribute vec4 aB;'}
      uniform float uTime, uMove;
      varying vec3 vN, vW, vL, vCol, vA; varying vec4 vP, vQ;
      void main(){ vL = position; mat4 m = modelMatrix * instanceMatrix; vec3 p = position; float seed = aQ.x, t = uTime * uMove;
        ${cap ? `
        float rad = length(p.xz), ang = atan(p.x, -p.z - 1e-5), rimW = smoothstep(.3, 1.0, rad);
        float wav = .5 * sin(ang * 5.0 + seed * 3.1) + .3 * sin(ang * 8.0 + seed * 7.3 + t * .6) + .45 * sin(ang * 2.0 + seed * 1.7);
        p.xz *= (1.0 + rimW * .06 * wav) * vec2(1.0 + .07 * sin(seed * 4.1), 1.0 + .07 * cos(seed * 2.3));
        p.y += rimW * rimW * (.05 * sin(ang * 6.0 + seed * 5.0 + t * .8) + .07 * sin(ang + seed * 2.0) + .16 * smoothstep(.8, 1.0, aP.y));` : `
        p.xz *= 1.0 + .08 * sin(p.y * 8.0 + seed * 3.0) * (1.0 - p.y) + .04 * sin(p.y * 3.0 + seed);`}
        vec4 w = m * vec4(p, 1.0); vec3 N = normalize(mat3(m) * normal);
        ${cap ? '' : `
        float y = position.y, q = 1.0 - y, hh = max(length(m[1].xyz), .001);
        w.xz += aB.xy * y * y + aB.zw * 16.0 * y * y * q * q;
        vec2 fp = (aB.xy * 2.0 * y + aB.zw * 32.0 * y * q * (1.0 - 2.0 * y)) / hh;
        N.y -= dot(fp, N.xz); N = normalize(N);`}
        vW = w.xyz; vN = N; vCol = aCol; vA = aA; vP = aP; vQ = aQ; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uTime; varying vec3 vN, vW, vL, vCol, vA; varying vec4 vP, vQ;
      void main(){
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW), Ld = normalize(vec3(-.35, .85, .45));
        float glow = vP.x, ctx = vP.y, rot = vP.z, wither = vP.w, seed = vQ.x, rim = vQ.y;
        float rad = length(vL.xz), ang = atan(vL.x, -vL.z), fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.0);
        float diff = max(dot(N, Ld), 0.0) * .6 + .22 + .18 * max(N.y, 0.0);
        ${cap ? `
        float under = smoothstep(.15, -.35, N.y), pores = step(3.5, vQ.w), pat = vQ.w - 4.0 * pores, ripe = max(ctx, 0.0);
        vec3 alb = mix(vA, vCol * .55 + .05, .3) * mix(.7, 1.05, smoothstep(.0, .75, rad));
        float spot = 0.0;
        if (pat > 2.5) alb *= 1.0 - .4 * smoothstep(.2, 1.0, sin(ang * 64.0 + 4.0 * snoise(vec3(vL.xz * 2.5, seed)))) * smoothstep(.25, .95, rad);
        else if (pat > 1.5) alb *= 1.0 - .6 * smoothstep(.1, .45, snoise(vec3(ang * 4.0, rad * 10.0, seed))) * smoothstep(.2, .55, rad);
        else if (pat > .5) spot = smoothstep(.5, .6, snoise(vec3(vL.xz * 4.6, seed * 7.0))) * (1.0 - under) * (1.0 - vQ.z);
        alb = mix(alb, vec3(.88, .84, .74), spot * .85);
        // Gills or pores underneath, darkening as spores ripen: the session's context.
        float gill = pores > .5 ? smoothstep(.4, .14, length(fract(vL.xz * 14.0) - .5)) : .5 + .5 * sin(ang * 48.0);
        alb = mix(alb, mix(vec3(.66, .6, .5), vec3(.2, .12, .15), ripe) * (.65 + .35 * gill), under);
        vec3 col = alb * diff * vec3(.6, .66, .8);
        float e = glow * (.08 + .3 * smoothstep(.55, 1.0, rad) + .26 * fres) * (1.0 - spot * .85);
        e += glow * under * (1.2 - .65 * ripe) * (.35 + .65 * gill);
        vec3 em = vCol * e;` : `
        vec3 alb = vA * (.82 + .18 * snoise(vec3(ang * 3.0, vL.y * 14.0, seed)));
        vec3 col = alb * diff * vec3(.58, .64, .78);
        vec3 em = vCol * glow * (.08 + .7 * smoothstep(.55, 1.0, vL.y));
        // Mycelial felt creeping up the foot, ragged at its top edge, and the cord's own strands running up the bulb where it leaves.
        float felt = smoothstep(.2 + .08 * snoise(vec3(ang * 4.0, seed, 1.0)), .02, vL.y) * (.7 + .3 * snoise(vec3(ang * 9.0, vL.y * 40.0, seed)));
        float da = abs(mod(ang - vQ.w + 3.14159, 6.28318) - 3.14159);
        float cord = vQ.z * exp(-da * da * .9) * smoothstep(.34, .0, vL.y) * (.45 + .55 * smoothstep(-.2, .6, snoise(vec3(ang * 11.0, vL.y * 22.0, seed))));
        col = mix(col, vec3(.62, .64, .58) * diff * vec3(.6, .66, .76), felt * .8);
        em += mix(vec3(.8, 1.0, .82), vCol, .6) * (felt * (.03 + .07 * glow) + cord * (.1 + .32 * glow));`}
        float rn = snoise(vL * 2.6 + seed * 5.0) + .18 * snoise(vL * 7.0 + vec3(0.0, uTime * .4, 0.0));
        float blot = smoothstep(-.22, .1, rn) * rot, edge = smoothstep(-.4, -.25, rn) * (1.0 - smoothstep(-.25, -.12, rn)) * rot;
        float flick = .6 + .4 * sin(uTime * 13.0 + seed * 20.0) * sin(uTime * 7.3 + seed);
        col = mix(col, vec3(.09, .04, .02), blot);
        em = em * (1.0 - blot * .92) + vec3(1.0, .18, .05) * edge * flick * 1.6;
        float g = dot(col, vec3(.33));
        col = mix(col, vec3(g) * vec3(.95, .85, .72) * .75, wither);
        em *= 1.0 - wither * .95;
        em += vec3(.7, 1.0, .75) * rim * (fres * .55 + .04);
        gl_FragColor = vec4(col + em, 1.0);
      }`,
  });
  const capMat = mushMat(true), stemMat = mushMat(false);

  const mush = [];
  const counts = CAP_SHAPES.map(() => 0);
  // Each mushroom keeps a seeded bow in its stem, its own sway, and a squash-and-stretch spring that events kick.
  // Stiffness varies per mushroom so a whole cluster jiggles out of step.
  function addMushroom(rec) {
    const small = rec.role !== 'session' && rec.role !== 'cluster', a = rec.seed * 2.39996, bow = (small ? .04 : .07) + ((rec.seed * 7.31) % 1) * (small ? .05 : .1);
    // Every mushroom, whatever its role, is one literal with every field, given the role's own values after: objects of mixed
    // shapes (or fields added later) make the per-frame code that reads them megamorphic, and every number it writes an allocation.
    const m = { node: null, role: '', shape: 0, alb: null, stem: null, pat: 0, tall: 1, wide: 1, lean: 0, ys: 1, thick: 1, h: 0, R: 0, seed: 0,
      ox: 0, oz: 0, dx: 1, dz: 0, lx: 0, lz: 0, rise: 1, step: 0, grown: 0, hue: null, phase: 0, dist: 0, angle: 0, fi: 0, lit: 1, run: -2, rk: 0, rn: 1, body: null,
      capSlot: 0, stemSlot: mush.length, col: new THREE.Color(), flash: 0, top: new THREE.Vector3(), R0: 0, bulb: 0, crown: 0, exit: null,
      bowX: Math.cos(a) * bow, bowZ: Math.sin(a) * bow, sway: { session: .05, sub: .075, cluster: .04, fairy: .06, plan: .03, shot: .03 }[rec.role],
      sq: 0, sqv: 0, kv: 0, kt: 0, k: 105 + ((rec.seed * 5.3) % 1) * 70, hovOn: false, selOn: false, bx: 0, bz: 0, wx: 0, wz: 0, hh: 0, swx: 0, swz: 0 };
    for (const k in rec) m[k] = rec[k];
    m.capSlot = counts[m.shape]++;
    mush.push(m); return m;
  }

  const linkOf = new Map(), needOf = new Map(), mushOf = new Map(), plans = new Map();
  const PALE = C('#d8d2bc');
  // Sessions, their plan's pinheads and their subagents
  for (const s of world.sessions) {
    const r = rng(s.seed), sp = speciesOf(r);
    const a = (r() < .5 ? 0 : Math.PI) + (r() - .5) * .7; // offline caps flop sideways, so the silhouette stays readable
    // Sessions are the big bodies; a cap never grows into a neighbour's.
    let room = 1.45;
    for (const o of world.nodes) if (o !== s && o.kind !== 'you') { const d = Math.hypot(o.rest.x - s.rest.x, o.rest.z - s.rest.z); room = Math.min(room, o.kind === 'session' ? d * .5 : d - (o.kind === 'sub' ? .6 : .5)); }
    mushOf.set(s, addMushroom({ node: s, role: 'session', ...sp, h: 2.3 * sp.tall, R: Math.max(.9, Math.min(1.4 * sp.wide, room / 1.08)), seed: r() * 10, dx: Math.cos(a), dz: Math.sin(a), lx: (r() - .5) * .3 * sp.lean, lz: (r() - .5) * .3 * sp.lean, rise: s.present ? 1 : 0 }));
    if (s.plan?.total) {
      const list = [], n = s.plan.total;
      // Pinheads round the back of the foot, one per step from left to right, grown and lit when done; the label sits in front.
      for (let i = 0; i < n; i++) { const pa = Math.PI * (1.06 + .88 * (i + .5) / n), d = 1.4 + (r() - .5) * .12; list.push(addMushroom({ node: s, role: 'plan', shape: 0, alb: PALE, stem: PALE, pat: 0, ox: Math.cos(pa) * d, oz: Math.sin(pa) * d, h: .3, R: .1, ys: 1.3, seed: r() * 10, lx: Math.cos(pa) * .2, lz: Math.sin(pa) * .2, step: i, grown: 0 })); }
      plans.set(s, list);
    }
    for (const k of s.subs) {
      const rk = rng(k.seed), sk = speciesOf(rk, [0, 1, 4]), a2 = rk() * 6.28;
      mushOf.set(k, addMushroom({ node: k, role: 'sub', ...sk, h: .85 * sk.tall, R: .44 * sk.wide, ys: 1.15, seed: rk() * 10, dx: Math.cos(a2), dz: Math.sin(a2), lx: (rk() - .5) * .36, lz: (rk() - .5) * .36, rise: k.present ? 1 : 0 }));
    }
  }
  // Screenshots: a pale fruiting body beside each session whose round cap holds its newest screenshot, a spore on it for
  // each one taken, fed by a few threads from the session's foot. It grows beside or behind the session wherever there's most room
  // from other nodes and the session's own cord, and only while there's a screenshot; a click opens them.
  const SPOTS = [[2.9, -.4], [-2.9, -.4], [2.2, -2.2], [-2.2, -2.2]], shotBodies = [], LENS_W = 2.3, LENS_H = LENS_W * 400 / 512;
  for (const s of world.sessions) {
    const toKnot = new THREE.Vector3().subVectors(s.parent.rest, s.rest).setY(0).normalize(), r = rng(s.seed ^ 0x51);
    let best = SPOTS[0], room = -Infinity;
    for (const [ox, oz] of SPOTS) {
      const x = s.rest.x + ox, z = s.rest.z + oz;
      let near = Math.hypot(x - s.rest.x - toKnot.x * 1.8, z - s.rest.z - toKnot.z * 1.8);
      for (const o of world.nodes) if (o !== s) near = Math.min(near, Math.hypot(o.rest.x - x, o.rest.z - z) - (o.kind === 'you' ? 3 : o.kind === 'session' ? .6 : 0));
      if (near > room + .05) { room = near; best = [ox, oz]; }
    }
    const m = addMushroom({ node: s, role: 'shot', shape: 2, alb: C('#d6d0bd'), stem: C('#e2dccb'), pat: 0, ox: best[0], oz: best[1], h: 1.25, R: .14, ys: .7, seed: r() * 10, lx: -Math.sign(best[0]) * .1, lz: -.05, rise: 0 });
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 400;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(LENS_W, LENS_H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: .03 }));
    lens.visible = false; root.add(lens);
    const pos = new THREE.Vector3();
    ctx.addTarget?.({ node: s, pos, radius: LENS_W * .45, action: 'shots' });
    m.body = { s, m, lens, canvas, tex, pos, shot: null, wob: [r() * 6.28, r() * 6.28], threads: [] };
    shotBodies.push(m.body);
  }
  // Projects are knots where the cords meet: a fat-footed primordium of the project's own species on a felted mound, and a
  // tuft, crescent or ring of pinheads round it, all lit in the project's colour and grown PK times larger: it is
  // the button for a new session.
  const clusters = new Map();
  world.projects.forEach((p, pi) => {
    const r = rng(p.seed ^ 0x9e37), sp = speciesOf(r, [0, 1, 4]), list = [], hue = C(HUES[pi % HUES.length]);
    list.push(addMushroom({ node: p, role: 'cluster', ...sp, ox: 0, oz: 0, h: .62 * PK * Math.sqrt(sp.tall), R: .34 * PK * sp.wide, seed: r() * 10, lx: 0, lz: 0, hue, thick: 1.5 }));
    const form = Math.floor(r() * 3), n = 3 + Math.floor(r() * 3), a0 = r() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = form === 0 ? a0 + (r() - .5) * 1.4 : form === 1 ? a0 + (i / Math.max(1, n - 1) - .5) * 2.4 : a0 + i / n * Math.PI * 2 + (r() - .5) * .6, d = (.3 + r() * .22) * PK, big = r();
      list.push(addMushroom({ node: p, role: 'cluster', ...sp, alb: sp.alb.clone().offsetHSL(0, 0, (r() - .5) * .08), ox: Math.cos(a) * d, oz: Math.sin(a) * d, h: (.14 + big * .24) * PK * sp.tall, R: (.06 + big * .08) * PK * sp.wide, seed: r() * 10, lx: Math.cos(a) * .45 * PK, lz: Math.sin(a) * .45 * PK, hue, phase: r() * 6.28, dist: d }));
    }
    clusters.set(p, list);
  });
  // Fairy ring round the stump: the usage gauge, starting and ending at the front (see updateUsage).
  const fairy = [], FAIRY = 48;
  for (let i = 0; i < FAIRY; i++) {
    const r = rng(9001 + i), a = Math.PI / 2 + (i + .5) / FAIRY * Math.PI * 2 + (r() - .5) * .03, d = 2.75 + (r() - .5) * .16;
    fairy.push(addMushroom({ node: world.you, role: 'fairy', shape: 0, alb: C('#cfc6ac'), stem: C('#ddd6c2'), pat: 0, ox: Math.cos(a) * d, oz: Math.sin(a) * d, h: .24 + r() * .12, R: .1 + r() * .04, ys: 1.15, seed: r() * 10, lx: Math.cos(a) * .12, lz: Math.sin(a) * .12, angle: a, fi: i, lit: 1, run: -2, rk: 0, rn: 1 }));
  }

  function instAttrs(mesh, count) {
    const g = mesh.geometry;
    for (const [name, n] of [['aCol', 3], ['aP', 4], ['aQ', 4], ['aA', 3]]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * n), n).setUsage(THREE.DynamicDrawUsage));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; return mesh;
  }
  const caps = capGeo.map((g, i) => instAttrs(new THREE.InstancedMesh(g, capMat, Math.max(1, counts[i])), Math.max(1, counts[i])));
  const stems = instAttrs(new THREE.InstancedMesh(stemGeo, stemMat, mush.length), mush.length);
  const bendAttr = new THREE.InstancedBufferAttribute(new Float32Array(mush.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
  stems.geometry.setAttribute('aB', bendAttr);
  caps.forEach((m, i) => { m.count = counts[i]; root.add(m); });
  for (const m of mush) { m.alb.toArray(caps[m.shape].geometry.attributes.aA.array, m.capSlot * 3); m.stem.toArray(stems.geometry.attributes.aA.array, m.stemSlot * 3); }
  const instMeshes = [...caps, stems], pstat = new Map(world.projects.map(p => [p, { act: 0 }]));

  root.add(stems);
  const modeSessions = world.sessions.filter(s => s.mode);
  const skirts = new THREE.InstancedMesh(skirtGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), Math.max(1, modeSessions.length));
  skirts.frustumCulled = false; skirts.count = modeSessions.length; root.add(skirts);
  const MODE_C = { bypass: C('#ff5a2a').multiplyScalar(2.2), plan: C('#8cc8ff').multiplyScalar(1.8) };
  modeSessions.forEach((s, i) => skirts.setColorAt(i, MODE_C[s.mode]));

  // ── The stump and its roots (You) ──
  // Roots are built pointing along +x and swung round in the vertex shader: one buttress per project, whose trunk cord climbs
  // its back into the stump, and a smaller root between each pair. On the stump each trunk shows as a vein up the bark and
  // across the cut top in the project's colour, and each hypha that needs you lights the bark amber where it grips.
  const NP = world.projects.length, NR = NP * 2, NT = Math.max(1, NP), NEEDS = 8;
  const rootDir = Array.from({ length: NR }, () => new THREE.Vector2(1, 0)), rootCol = Array.from({ length: NR }, () => new THREE.Color(0, 0, 0)), rootFlash = new Float32Array(NP);
  const veinDir = Array.from({ length: NT }, () => new THREE.Vector2(1, 0)), veinCol = Array.from({ length: NT }, () => new THREE.Color(0, 0, 0));
  const gripAt = Array.from({ length: NEEDS }, () => new THREE.Vector3(1, 0, 0)), gripCol = new THREE.Color();
  const barkMat = (top, nr = 0) => new THREE.ShaderMaterial({
    uniforms: { uTime: T0, uWait: { value: 0 }, uTop: { value: top ? 1 : 0 }, uFlash: { value: new THREE.Color(0, 0, 0) },
      ...(nr ? { uRA: { value: rootDir }, uRC: { value: rootCol } } : { uVA: { value: veinDir }, uVC: { value: veinCol }, uGA: { value: gripAt }, uGC: { value: gripCol } }) },
    vertexShader: nr ? `#define NR ${nr}
      attribute vec2 aR; uniform vec2 uRA[NR]; uniform vec3 uRC[NR]; varying vec3 vN, vW, vL, vRC; varying float vRT;
      void main(){ int i = int(aR.x + .5); vec2 cs = uRA[i]; vL = position + vec3(0.0, 0.0, aR.x * 4.7);
        vec3 p = vec3(position.x * cs.x - position.z * cs.y, position.y, position.x * cs.y + position.z * cs.x);
        vec3 n = vec3(normal.x * cs.x - normal.z * cs.y, normal.y, normal.x * cs.y + normal.z * cs.x);
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * n); vRC = uRC[i]; vRT = aR.y;
        gl_Position = projectionMatrix * viewMatrix * w; }`
      : 'varying vec3 vN, vW, vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${NOISE_GLSL}
      uniform float uTime, uWait, uTop; uniform vec3 uFlash; varying vec3 vN, vW, vL;${nr ? ' varying vec3 vRC; varying float vRT;' : ` uniform vec2 uVA[${NT}]; uniform vec3 uVC[${NT}]; uniform vec3 uGA[${NEEDS}]; uniform vec3 uGC;`}
      void main(){
        vec3 N = normalize(vN), Ld = normalize(vec3(-.35, .85, .45));
        float diff = max(dot(N, Ld), 0.0) * .6 + .25;
        float ang = atan(vL.z, vL.x), r = length(vL.xz);
        float ridge = abs(snoise(vec3(ang * 6.0, vL.y * 1.3, 3.0))) + .5 * abs(snoise(vec3(ang * 19.0, vL.y * 4.0, 1.0)));
        vec3 bark = vec3(.19, .13, .085) * (.55 + .7 * ridge);
        float moss = smoothstep(.3, .75, snoise(vec3(vL.xz * 4.5, vL.y * 6.0 + 4.0))) * smoothstep(-.2, .4, snoise(vec3(vL.xz * 1.2, 2.0))) * (1.0 - smoothstep(.1, .7, vL.y));
        vec3 col = bark, em = vec3(.25, 1.0, .7) * moss * (.3 + .15 * sin(uTime * .8 + vL.x * 2.0));
        float isTop = uTop * smoothstep(.55, .8, N.y) * smoothstep(.55, .72, vL.y);
        float rings = fract(r * 8.5 + .35 * snoise(vec3(vL.xz * 1.4, 1.0)));
        float line = smoothstep(.0, .1, rings) * (1.0 - smoothstep(.75, 1.0, rings));
        float crack = smoothstep(.93, 1.0, abs(sin(ang * 3.0 + snoise(vec3(vL.xz * 2.0, 5.0)) * 1.5))) * smoothstep(.15, .9, r);
        vec3 wood = mix(vec3(.17, .11, .065), vec3(.31, .22, .13), line) * (1.0 - crack * .7) * (1.0 - .4 * smoothstep(.15, .0, r));
        float ripple = pow(max(.5 + .5 * sin(r * 5.0 - uTime * 2.6), 0.), 3.0);
        vec3 woodEm = vec3(1.0, .5, .12) * uWait * (.25 + 1.4 * ripple) * (1.0 - line * .7) + uFlash * (1.0 - line) * .8;
        col = mix(col, wood, isTop); em = mix(em, woodEm, isTop);${nr ? `
        float back = smoothstep(.2, .85, N.y), fib = snoise(vec3(vL.x * 2.4, vL.z * 7.0, 9.0)) * .5 + .5;
        em += vRC * back * (.04 + .14 * fib) * (.4 + .6 * smoothstep(.0, .5, 1.0 - vRT));` : `
        vec2 dir = vL.xz / max(r, 1e-4);
        for (int i = 0; i < ${NT}; i++) {
          float da = acos(clamp(dot(dir, uVA[i]), -1.0, 1.0)) + .12 * snoise(vec3(vL.y * 3.0 + r * 2.5, float(i) * 3.1, 7.0));
          float vein = exp(-da * da * mix(70.0, 26.0, isTop)) * (.5 + .5 * smoothstep(-.3, .5, snoise(vec3(ang * 26.0, vL.y * 10.0 + r * 7.0, float(i)))));
          em += uVC[i] * vein * mix(smoothstep(.05, .8, vL.y), smoothstep(.35, 1.4, r), isTop);
        }
        for (int i = 0; i < ${NEEDS}; i++) {
          vec3 a = uGA[i]; if (a.z <= 0.0) continue;
          float da = acos(clamp(dot(dir, a.xy), -1.0, 1.0)) + .1 * snoise(vec3(vL.y * 4.0, float(i) * 2.3, 3.0));
          em += uGC * a.z * exp(-da * da * 40.0) * smoothstep(.15 + .75 * a.z, .0, vL.y) * (1.0 - isTop) * (.55 + .45 * snoise(vec3(ang * 22.0, vL.y * 9.0, 1.0)));
        }`}
        gl_FragColor = vec4(col * diff * vec3(.55, .6, .75) + em, 1.0);
      }`,
  });
  const stumpMat = barkMat(true), you = new THREE.Group(); root.add(you);
  you.add(new THREE.Mesh(stumpGeometry(), stumpMat));
  const rootSpecs = [];
  if (NP) { const roots = new THREE.Mesh(rootsGeometry(NP, rootSpecs), barkMat(false, NR)); roots.frustumCulled = false; you.add(roots); }

  // ── Hyphae: per-link seeded shapes ──
  const links = [];
  for (const p of world.projects) links.push(buildLink('proj', p, world.you, p.seed));
  for (const s of world.sessions) {
    const l = buildLink('sess', s, s.parent, s.seed); l.grow = s.present ? 1 : 0; linkOf.set(s, l); links.push(l);
    const n = buildLink('need', s, world.you, s.seed ^ 0x5bd1); needOf.set(s, n); links.push(n);
    for (const k of s.subs) { const kl = buildLink('sub', k, s, k.seed); kl.grow = k.present ? 1 : 0; linkOf.set(k, kl); links.push(kl); }
  }
  for (const p of world.projects) linkOf.set(p, links.find(l => l.child === p));
  for (const L of links) { L.H = L.kind === 'sess' || L.kind === 'sub' ? linkOf.get(L.parent) : null; L.foot = L.kind === 'proj' ? clusters.get(L.child)[0] : mushOf.get(L.child); }
  // Session cords run into their project's trunk, which thickens at every join on its way to the stump.
  for (const s of world.sessions) linkOf.get(s.parent).joins.push(linkOf.get(s));
  const trunks = world.projects.map(p => linkOf.get(p));

  // ── Threads: every hypha is a thin ribbon turned to face the camera, one mesh for all of them ──
  // Each thread is a run of samples; a sample is two vertices. Threads never get thinner than a pixel on screen: below that they
  // widen and dim instead, so far-off threads stay continuous lines.
  // The mesh never changes. A sample holds which record it reads and its place in it (aA: record, kind of thread, index, count)
  // and its own seeded shape (aB, aC); the vertex shader lays it out from the records in a float texture, uD. Per cord: a header,
  // its centre line (two texels a sample) and where its strands carry on, then its joins; per felt mat, tether, feeding thread
  // or cross-thread: its ends and colour. The CPU writes the records and uploads only the rows that changed (flushData).
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const TW = 1024; // texels in a row of uD (the shaders' i & 1023, i >> 10)
  let texN = 0;
  const dAlloc = n => { const s = texN; texN += n; return s; };
  for (const L of links) L.tb = dAlloc(6 + 2 * (L.segs + 1) + 2 * L.c.cont + L.joins.length);
  const tA = [], tB = [], tC = [], ranges = [];
  let thrN = 0;
  const run = n => { ranges.push(thrN, n); thrN += n; };
  const smp = (a0, a1, a2, a3, b0, b1, b2, b3, c0, c1, c2, c3) => { for (let e = 0; e < 2; e++) { tA.push(a0, a1, a2, a3); tB.push(b0, b1, b2, b3); tC.push(c0, c1, c2, c3); } };
  // A thread across a record's span (kind 2, or 3 for a cross-thread): aB.x bow, aB.yzw a wave, aC height, width, brightness, offset.
  const span = (rb, ty, N, b0, b1, b2, b3, c0, c1, c2, c3) => { run(N + 1); for (let i = 0; i <= N; i++) smp(rb, ty, i, N, b0, b1, b2, b3, c0, c1, c2, c3); };
  // A thread of fixed points (a branch or felt): each sample keeps its point and the step across its neighbours, for its heading.
  const walk = (rb, ty, pts, c0, c1, c2) => {
    const n = pts.length / 2 - 1; run(n + 1);
    for (let j = 0; j <= n; j++) { const a = Math.max(0, j - 1) * 2, b = Math.min(n, j + 1) * 2; smp(rb, ty, j, n, pts[j * 2], pts[j * 2 + 1], pts[b] - pts[a], pts[b + 1] - pts[a + 1], c0, c1, c2, 0); }
  };
  for (const L of links) {
    for (const st of L.strands) { const n = L.segs + L.c.cont; run(n + 1); for (let k = 0; k <= n; k++) smp(L.tb, 0, k, st.ph, st.a, st.f, st.p, st.sp, st.b, st.y, st.ca, st.sa); }
    for (const br of L.branches) walk(L.tb, 1, br.pts, br.b, br.i0, br.t0);
  }
  // Felt: a mat of short, curling rhizoids round every foot. Ring mushrooms in a cluster get a little felt and a thread back to
  // the mother's foot, and each plan pinhead a thread from its session's foot, so each reads as one organism.
  const fuzz = [];
  for (const m of mush) {
    if (m.role === 'fairy' || m.role === 'plan' || m.role === 'shot') continue;
    const ring = m.role === 'cluster' && m.ox !== 0, r = rng((m.node.seed ^ 0x77) + Math.floor(m.seed * 997));
    const n = ring ? 4 : m.role === 'cluster' ? 22 : m.role === 'session' ? 24 : 10, len = ring ? .3 * PK : m.role === 'cluster' ? .9 * PK : m.role === 'session' ? .95 : .42, F = { m, rb: dAlloc(2), teth: -1 };
    // Two kinds: short curling felt scattered over a disc round the foot, and a few longer rhizoids reaching out from it.
    for (let i = 0; i < n; i++) {
      const felt = i % 5 < 3; let a = r() * 6.28, x, z;
      const r0 = felt ? len * .42 * Math.sqrt(r()) : len * (.05 + r() * .08), a0 = r() * 6.28; x = Math.cos(a0) * r0; z = Math.sin(a0) * r0;
      if (!felt) a = a0;
      const pts = [x, z], step = len * (felt ? .05 + r() * .07 : .16 + r() * .14), curl = (r() - .5) * (felt ? 2.4 : 1);
      for (let k = 0; k < 4; k++) { a += curl + (r() - .5) * .9; x += Math.cos(a) * step; z += Math.sin(a) * step; pts.push(x, z); }
      walk(F.rb, 4, pts, (felt ? .5 + .5 * (1 - r0 / (len * .42)) : .55) * (.5 + r() * .5), 0, 0);
    }
    if (ring) { const bow = (r() - .5) * .7, ph = r() * 6.28; F.teth = dAlloc(3); span(F.teth, 2, TETH, bow * .35, .05, 8, ph, .03, .009, 1, 0); }
    fuzz.push(F);
  }
  const SHOT_SEG = 10;
  for (const B of shotBodies) { B.rb = dAlloc(3); for (let j = 0; j < 3; j++) { const ph = j * 2.1 + B.wob[0]; span(B.rb, 2, SHOT_SEG, 0, .07, 5, ph, .03, .009, .5 + .25 * j, .12 * Math.sin(ph)); } }
  const feeders = [];
  for (const [s, list] of plans) for (const m of list) { const r = rng(s.seed + m.step * 31), F = { s, m, rb: dAlloc(3) }; span(F.rb, 2, FEED, (r() - .5) * .5 * .4, 0, 0, 0, .03, .008, 1, 0); feeders.push(F); }
  // Anastomosis: neighbouring cords fuse through a few fine cross-threads.
  const bridges = [];
  const bridge = (A, B, k, r) => {
    for (let i = 0; i < k; i++) {
      const ta = .3 + r() * .55, tb = clamp(ta + (r() - .5) * .25, .2, .92), bow = (r() - .5) * .7, b = .35 + r() * .35, ph = r() * 6.28;
      const X = { A, B, ta, tb, ia: near(A, ta), ib: near(B, tb), b, rb: dAlloc(3) };
      span(X.rb, 3, BR, bow * .3, .06, 9, ph, .032, .007, 1, 0); bridges.push(X);
    }
  };
  for (const p of world.projects) {
    const r = rng(p.seed ^ 0xa11);
    for (let i = 0; i + 1 < p.sessions.length; i++) bridge(linkOf.get(p.sessions[i]), linkOf.get(p.sessions[i + 1]), 2 + (r() < .5 ? 1 : 0), r);
    for (const s of p.sessions) for (let i = 0; i + 1 < s.subs.length; i++) bridge(linkOf.get(s.subs[i]), linkOf.get(s.subs[i + 1]), 1, r);
  }
  // The records: Wd is what this frame wrote, Dd what the texture last got (its image). Fixed fields are written once here: a
  // cord's kind, samples, carried samples, carry, bundle, thread and glow widths and joins (texels 4 and 5 of its header), and
  // the far end (1) of every span that runs all the way.
  const rows = Math.max(1, Math.ceil(texN / TW)), Wd = new Float32Array(rows * TW * 4), Dd = new Float32Array(rows * TW * 4);
  for (const L of links) { const o = L.tb * 4 + 16, c = L.c; Wd[o] = KIND[L.kind]; Wd[o + 1] = L.segs; Wd[o + 2] = c.cont; Wd[o + 3] = c.carry || 0; Wd[o + 4] = c.bundle; Wd[o + 5] = c.thread; Wd[o + 6] = c.width; Wd[o + 7] = L.joins.length; }
  for (const F of fuzz) if (F.teth >= 0) Wd[F.teth * 4 + 9] = 1;
  for (const F of feeders) Wd[F.rb * 4 + 9] = 1;
  for (const X of bridges) Wd[X.rb * 4 + 9] = 1;
  let dataUp = false;
  const dataTex = new THREE.DataTexture(Dd, TW, rows, THREE.RGBAFormat, THREE.FloatType);
  dataTex.onUpdate = () => { dataUp = true; };
  const fSide = new Float32Array(thrN * 2);
  for (let i = 0; i < thrN * 2; i++) fSide[i] = i % 2 ? 1 : -1;
  let quads = 0; for (let k = 1; k < ranges.length; k += 2) quads += ranges[k] - 1;
  const thrIdx = new Uint32Array(quads * 6);
  for (let k = 0, o = 0; k < ranges.length; k += 2) for (let i = 0; i < ranges[k + 1] - 1; i++, o += 6) { const a = (ranges[k] + i) * 2; thrIdx[o] = a; thrIdx[o + 1] = thrIdx[o + 4] = a + 1; thrIdx[o + 2] = thrIdx[o + 3] = a + 2; thrIdx[o + 5] = a + 3; }
  const thrGeo = new THREE.BufferGeometry();
  thrGeo.setAttribute('aA', new THREE.Float32BufferAttribute(tA, 4));
  thrGeo.setAttribute('aB', new THREE.Float32BufferAttribute(tB, 4));
  thrGeo.setAttribute('aC', new THREE.Float32BufferAttribute(tC, 4));
  thrGeo.setAttribute('aSide', new THREE.BufferAttribute(fSide, 1));
  thrGeo.setIndex(new THREE.BufferAttribute(thrIdx, 1));
  // A cord's header: H0 colour × brightness, grow; H1 width where it joins, width at the bulb, twist, searching tip (or -1);
  // H2 bulb, lift, prune, error; H3 length, seed, twist rate, the stump's height; H4 kind, samples, carried, carry; H5 bundle,
  // thread, glow width, joins. A sample is (x, z, normal) and (distance along, pulse colour); a carried one (x, y, z, nx) and
  // (nz, root radius or the parent's t); a join (where on the trunk, how far grown).
  const CORD_GLSL = `uniform highp sampler2D uD; vec4 H0, H1, H2, H3, H4, H5;
    vec4 tx(int i) { return texelFetch(uD, ivec2(i & 1023, i >> 10), 0); }
    float warpT(float u) { return u - .62 * sin(6.2831853 * u) / 6.2831853; }
    float maskT(float t) { float g = H0.w; if (g >= .999) return 1.0; if (g <= .001) return 0.0;
      return H4.x > 2.5 ? 1.0 - smoothstep(g - .05, g + .005, t) : smoothstep(1.0 - g - .005, 1.0 - g + .05, t); }
    float liftT(float t) { return H4.x > 2.5 ? H2.y * pow(max(sin(3.14159265 * t), 0.0), 1.5) : 0.0; }`;
  // Threads lie in the soil, not on it: in patches fixed to the ground they dip under the litter (vB: how much they may).
  // A strand gathers from the bulb into its cord's twisted bundle, narrows into the cord it joins and carries on along it, fading;
  // a branch is a fixed walk turned with the cord; felt is fixed round its foot; a span bows across between its two ends.
  const threadMat = new THREE.ShaderMaterial({ ...additive, side: THREE.DoubleSide, uniforms: { uPx: { value: 400 }, uMin: { value: .7 }, uD: { value: dataTex }, uTime: T0, uMove: MOVE },
    vertexShader: `${CORD_GLSL}
      attribute vec4 aA, aB, aC; attribute float aSide; uniform float uPx, uMin, uTime, uMove; varying vec3 vC; varying float vS, vB; varying vec2 vW;
      int tb;
      vec3 strandAt(int k, out vec3 col, out float bury) {
        int segs = int(H4.y + .5); float ph = aA.w, Y = (H4.x > 2.5 ? .036 : .03) + aC.y;
        vec4 A = tx(tb + 6 + 2 * k), B = tx(tb + 7 + 2 * k);
        if (k <= segs) {
          float t = warpT(float(k) / H4.y), d = B.x, fk = exp(-d / .3), bundle = H5.x;
          float W = bundle + (H1.x - bundle) * smoothstep(.55, 1.0, t) + (H1.y - bundle) * fk * .4;
          float o = W * sin(ph + d * H3.z + H1.z * aB.w) + aB.x * sin(6.2831853 * aB.y * t + aB.z) * sin(3.14159265 * t) * (1.0 + uMove * .3 * sin(uTime * .6 + ph)) * (1.0 - fk);
          if (H1.w >= 0.0) o += .25 * sin(uTime * 2.3 + ph) * smoothstep(H1.w - .12, H1.w, t);
          vec2 p = A.xy + A.zw * o;
          float bulb = H2.x, Df = max(.4, bulb * 3.2);
          if (d < Df) {
            vec4 F = tx(tb + 6); vec2 h = vec2(F.w, -F.z), c = F.xy + vec2(h.x * aC.z - h.y * aC.w, h.x * aC.w + h.y * aC.z) * (bulb * .5 + d * 1.1);
            p = c + (p - c) * smoothstep(0.0, Df, d);
          }
          float gap = H2.w > .01 && sin(t * H3.x * 2.3 + H3.y * 3.0) > .2 ? 1.0 - H2.w * .85 : 1.0;
          col = H0.rgb * (aC.x * (1.0 + .5 * fk) * maskT(t) * gap) + B.yzw;
          bury = (H4.x > 2.5 ? .3 : 1.0) * min(1.0, min(t, 1.0 - t) / .12);
          return vec3(p.x, Y + liftT(t), p.y);
        }
        float e = float(k - segs) / H4.z, sp = H1.z * aB.w, end = maskT(1.0);
        if (H4.x < .5) {
          // Up the root's back, spread over as much of it as there is, and fading as it reaches the bark of the stump.
          float R = B.y, o = max(.035, R * .55) * sin(ph + (H3.x + e * 2.5) * H3.z + sp);
          col = H0.rgb * (aC.x * smoothstep(.04, .3, 1.0 - e * .93) * end); bury = 0.0;
          return vec3(A.x + A.w * o, max(Y, A.y + sqrt(max(0.0, R * R - o * o)) * H3.w + .014), A.z + B.x * o);
        }
        float o = H1.x * sin(ph + (H3.x + H4.w * e) * H3.z + sp), tp = B.y;
        col = H0.rgb * (aC.x * (1.0 - e) * (1.0 - e) * end); bury = min(1.0, min(tp, 1.0 - tp) / .12);
        return vec3(A.x + A.w * o, Y, A.z + B.x * o);
      }
      vec3 spanAt(vec4 R0, vec4 R2, float u) {
        float d = length(R0.zw); d = d > 0.0 ? d : 1.0;
        float o = (aB.x * d + aC.w + aB.y * sin(aB.z * u + aB.w)) * sin(3.14159265 * u);
        vec2 q = R0.xy + R0.zw * (R2.x + (R2.y - R2.x) * u) + vec2(-R0.w, R0.z) / d * o;
        return vec3(q.x, aC.x, q.y);
      }
      void main(){
        tb = int(aA.x + .5); int ty = int(aA.y + .5), i = int(aA.z + .5);
        vec3 p, tg, col, c2; float w, bury, b2;
        if (ty <= 1) {
          H0 = tx(tb);
          if (H0.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          H1 = tx(tb + 1); H2 = tx(tb + 2); H3 = tx(tb + 3); H4 = tx(tb + 4); H5 = tx(tb + 5);
          if (ty == 0) {
            int last = int(H4.y + .5) + int(H4.z + .5);
            p = strandAt(i, col, bury);
            tg = strandAt(min(i + 1, last), c2, b2) - strandAt(max(i - 1, 0), c2, b2);
            w = H5.y;
          } else {
            int i0 = int(aC.y + .5); vec4 A = tx(tb + 6 + 2 * i0), B = tx(tb + 7 + 2 * i0);
            float n = aA.w, m = maskT(warpT(aC.y / H4.y)), s = max(0.0, H2.z) * (.25 + .75 * m), t0 = aC.z;
            float wa = uMove * .16 * sin(uTime * .5 + t0 * 11.0 + H3.y); mat2 rot = mat2(cos(wa), sin(wa), -sin(wa), cos(wa));
            vec2 d = rot * (aB.xy * s), g = rot * (aB.zw * s), T = vec2(A.w, -A.z);
            p = vec3(A.x + T.x * d.x + A.z * d.y, (H4.x > 2.5 ? .036 : .03) + .004 + liftT(t0), A.y + T.y * d.x + A.w * d.y);
            tg = vec3(T.x * g.x + A.z * g.y, 0.0, T.y * g.x + A.w * g.y);
            float f = (1.0 - .65 * float(i) / n) * m * min(1.0, H2.z * 1.5 + .05);
            col = (H0.rgb * aC.x + B.yzw * .9) * f; w = H5.y * .6 * (1.0 - .5 * float(i) / n); bury = .5;
          }
        } else {
          vec4 R0 = tx(tb), R1 = tx(tb + 1);
          if (R1.r == 0.0 && R1.g == 0.0 && R1.b == 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          if (ty == 4) {
            p = vec3(R0.x + aB.x * R0.z, .028, R0.y + aB.y * R0.z); tg = vec3(aB.z * R0.z, 0.0, aB.w * R0.z);
            col = R1.rgb * ((1.0 - float(i) / 6.0) * aC.x); w = .007; bury = 0.0;
          } else {
            vec4 R2 = tx(tb + 2); int N = int(aA.w + .5); float u = float(i) / aA.w;
            p = spanAt(R0, R2, u);
            tg = spanAt(R0, R2, float(min(i + 1, N)) / aA.w) - spanAt(R0, R2, float(max(i - 1, 0)) / aA.w);
            col = R1.rgb * (aC.z * (ty == 3 ? .55 + .45 * sin(3.14159265 * u) : 1.0)); w = aC.y; bury = ty == 3 ? .6 : 0.0;
          }
        }
        vec3 e = cameraPosition - p; float dist = length(e);
        vec3 sd = cross(tg, e); float l = length(sd); sd = l > 1e-6 ? sd / l : vec3(1.0, 0.0, 0.0);
        float k = max(1.0, uMin * dist / max(w * uPx, 1e-5));
        p += sd * aSide * w * k; vC = col / k; vB = bury; vS = aSide; vW = p.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec3 vC; varying float vS, vB; varying vec2 vW;
      void main(){ float bury = mix(1.0, .25 + .75 * smoothstep(-.5, .25, snoise(vec3(vW * .5, 4.0))), vB);
        float a = 1.0 - smoothstep(.15, 1.0, abs(vS)); gl_FragColor = vec4(vC * a * (.6 + .4 * a) * bury, 1.0); }` });
  const threads = new THREE.Mesh(thrGeo, threadMat); threads.frustumCulled = false; root.add(threads);

  // ── Cord glow: one soft ribbon on the soil under each bundle, laid out from the same records ──
  let cordV = 0; const cordIdx = [], cordK = [];
  for (const L of links) {
    for (let i = 0; i < L.segs; i++) { const a = cordV + i * 2; cordIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i <= L.segs; i++) cordK.push(L.tb, i, L.tb, i);
    cordV += (L.segs + 1) * 2;
  }
  const cordSide = new Float32Array(cordV);
  for (let i = 0; i < cordV; i++) cordSide[i] = i % 2 ? 1 : -1;
  const cordGeo = new THREE.BufferGeometry();
  cordGeo.setAttribute('aK', new THREE.Float32BufferAttribute(cordK, 2));
  cordGeo.setAttribute('aSide', new THREE.BufferAttribute(cordSide, 1));
  cordGeo.setIndex(cordIdx);
  // Wide at the foot, fading out before the join so two never pile up there; a trunk steps up at every session that joins it.
  const cords = new THREE.Mesh(cordGeo, new THREE.ShaderMaterial({ ...additive, side: THREE.DoubleSide, uniforms: { uD: { value: dataTex } },
    vertexShader: `${CORD_GLSL}
      attribute vec2 aK; attribute float aSide; varying vec3 vC; varying float vS;
      void main(){
        int tb = int(aK.x + .5), i = int(aK.y + .5); H0 = tx(tb);
        if (H0.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        H2 = tx(tb + 2); H4 = tx(tb + 4); H5 = tx(tb + 5);
        vec4 A = tx(tb + 6 + 2 * i), B = tx(tb + 7 + 2 * i);
        int segs = int(H4.y + .5); float t = warpT(float(i) / H4.y), d0 = B.x, lift = liftT(t);
        float w = H5.z * (1.0 + 1.4 * exp(-d0 / .35)), k = .48 * (1.0 + .6 * exp(-d0 / .4));
        if (H4.x < .5) {
          float bw = 1.0; int nj = int(H5.w + .5), jb = tb + 6 + 2 * (segs + 1) + 2 * int(H4.z + .5);
          for (int j = 0; j < nj; j++) { vec4 J = tx(jb + j); bw += .22 * J.y * smoothstep(J.x - .02, J.x + .06, t); }
          w *= bw * (1.0 - .5 * smoothstep(.8, 1.0, t)); k *= 1.0 - .7 * smoothstep(.75, 1.0, t);
        } else if (H4.x > 2.5) k *= 1.5 * (1.0 - smoothstep(.04, .2, lift));
        else k *= 1.0 - smoothstep(.6, .97, t);
        vC = (H0.rgb * k + B.yzw * .9) * maskT(t); vS = aSide;
        vec2 p = A.xy - A.zw * (w * aSide);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, (H4.x < .5 ? .018 : .024) + lift, p.y, 1.0); }`,
    fragmentShader: 'varying vec3 vC; varying float vS; void main(){ gl_FragColor = vec4(vC * exp(-vS * vS * 3.2) * (1.0 - vS * vS), 1.0); }' }));
  cords.frustumCulled = false; root.add(cords);

  // A faint, static mycelial mat under the whole floor, shimmering slowly
  root.add(matLines());

  // ── Points: drifting spores, puffs, and glints (need tips, cap halos) ──
  // Spores and puffs move in their vertex shader, in closed form, so the CPU writes a puff once, when it's let go: spores drift on
  // uTau (which stands still in reduced motion), and a puff ages on uPT from its birth (aV.w), slowing as it goes.
  const TAU = { value: 0 }, PT = { value: 0 };
  const pointMat = (head, body) => new THREE.ShaderMaterial({ ...additive,
    uniforms: { uScale: { value: 400 }, uTime: T0, uTau: TAU, uPT: PT },
    vertexShader: `attribute vec3 aColor; ${head} uniform float uScale, uTime, uTau, uPT; varying vec3 vC;
      void main(){ vec3 p = position; float tw = 1.0, sz; ${body}
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = sz * uScale / -mv.z; vC = aColor * tw; }`,
    fragmentShader: 'varying vec3 vC; void main(){ float r = length(gl_PointCoord - .5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vC * (exp(-r * r * 5.0) + .6 * exp(-r * r * 40.0)), 1.0); }' });
  function points(n, attrs, head, body) {
    const g = new THREE.BufferGeometry(), a = {};
    for (const [name, k, dyn] of attrs) { const at = a[name] = new THREE.BufferAttribute(new Float32Array(n * k), k); if (dyn) at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, at); }
    const p = new THREE.Points(g, pointMat(head, body)); p.frustumCulled = false; root.add(p);
    return { p, g, a, n };
  }
  // aSp: the phases of the drift's x, y and z waves, and the spore's speed. Each wave is integrated, so where a spore is follows from uTau.
  const spores = points(520, [['position', 3], ['aColor', 3], ['aSize', 1], ['aPhase', 1], ['aSp', 4]], 'attribute float aSize, aPhase; attribute vec4 aSp;', `
    float sp = aSp.w, w1 = .23 * sp, w3 = .19 * sp, t = uTau;
    p += vec3(.05 * t - .12 / w1 * (cos(w1 * t + aSp.x) - cos(aSp.x)), sp * (.06 * t - .1 * (cos(.5 * t + aSp.y) - cos(aSp.y))), .12 / w3 * (sin(w3 * t + aSp.z) - sin(aSp.z)));
    p.x = mod(p.x + 35.0, 70.0) - 35.0; p.y = .15 + mod(p.y - .15, 4.65);
    tw = .9 + .6 * sin(uTime * 2.1 + aPhase * 6.283); sz = aSize;`);
  // aV: the puff's velocity when let go and its birth; aS: its size and life. Drag slows it, and it rises a little as it goes.
  const puffs = points(1100, [['position', 3, 1], ['aColor', 3, 1], ['aV', 4, 1], ['aS', 2, 1]], 'attribute vec4 aV; attribute vec2 aS;', `
    float age = uPT - aV.w;
    if (age < 0.0 || age >= aS.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float q = (1.0 - exp(-1.8 * age)) / 1.8, f = 1.0 - age / aS.y;
    p += aV.xyz * q + vec3(0.0, (age - q) * .12 / 1.8, 0.0);
    tw = f > .85 ? (1.0 - f) / .15 : f / .85; sz = aS.x * (1.4 - .4 * f);`);
  const glints = points(220, [['position', 3, 1], ['aColor', 3, 1], ['aSize', 1, 1]], 'attribute float aSize;', 'sz = aSize;');
  const clouds = [spores, puffs, glints], puffAttrs = [puffs.a.position, puffs.a.aColor, puffs.a.aV, puffs.a.aS];

  { const r = rng(4242), P = spores.a.position.array, K = spores.a.aColor.array, Z = spores.a.aSize.array, F = spores.a.aPhase.array, V = spores.a.aSp.array, SC = [C('#d9ffd0'), C('#ffe9b0'), C('#a8f4ff')];
    for (let i = 0; i < spores.n; i++) {
      P[i * 3] = (r() - .5) * 70; P[i * 3 + 1] = .2 + r() * 4.5; P[i * 3 + 2] = (r() - .5) * 56 + 1.5;
      const c = SC[Math.floor(r() * 3)], b = .25 + r() * .5;
      K[i * 3] = c.r * b; K[i * 3 + 1] = c.g * b; K[i * 3 + 2] = c.b * b; Z[i] = .05 + r() * .09; F[i] = r();
      const ph = r() * 6.28, sp = .5 + r(), ph3 = r() * 6.28; V[i * 4] = V[i * 4 + 1] = ph; V[i * 4 + 2] = ph3; V[i * 4 + 3] = sp;
    } }
  // Where the spores are now becomes their start, every ten minutes, so uTau stays small enough to keep its precision.
  function rebaseSpores() {
    const t = TAU.value, P = spores.a.position.array, V = spores.a.aSp.array, TAU2 = Math.PI * 2;
    for (let i = 0; i < spores.n; i++) {
      const k = i * 3, o = i * 4, sp = V[o + 3], w1 = .23 * sp, w3 = .19 * sp, a = V[o], b = V[o + 1], c = V[o + 2];
      const x = P[k] + .05 * t - .12 / w1 * (Math.cos(w1 * t + a) - Math.cos(a)), y = P[k + 1] + sp * (.06 * t - .1 * (Math.cos(.5 * t + b) - Math.cos(b)));
      P[k] = ((x + 35) % 70 + 70) % 70 - 35; P[k + 1] = .15 + ((y - .15) % 4.65 + 4.65) % 4.65; P[k + 2] += .12 / w3 * (Math.sin(w3 * t + c) - Math.sin(c));
      V[o] = (a + w1 * t) % TAU2; V[o + 1] = (b + .5 * t) % TAU2; V[o + 2] = (c + w3 * t) % TAU2;
    }
    TAU.value = 0; spores.a.position.needsUpdate = spores.a.aSp.needsUpdate = true;
  }
  // Puffs are written once, when let go; the slots written since the last upload go up together. puffEnd is when the last puff
  // dies, fastEnd the last of a burst (not the slow spores a ripe cap sheds), for the pace.
  let pNext = 0, emitLo = puffs.n, emitHi = -1, puffEnd = 0, fastEnd = 0;
  const prand = rng(777);
  function emit(x, y, z, col, count, { speed = 1.6, up = .9, size = .16, life = 1.8, spread = .5 } = {}) {
    const still = reduced(), P = puffs.a.position.array, K = puffs.a.aColor.array, V = puffs.a.aV.array, S = puffs.a.aS.array, now = PT.value;
    if (still) count = Math.ceil(count / 4);
    for (let j = 0; j < count; j++) {
      const i = pNext; pNext = (pNext + 1) % puffs.n;
      const a = prand() * 6.28, e = prand() * 2 - 1, sp = speed * (.3 + prand() * .7) * (still ? .15 : 1), h = Math.sqrt(1 - e * e);
      P[i * 3] = x + Math.cos(a) * spread * prand(); P[i * 3 + 1] = y; P[i * 3 + 2] = z + Math.sin(a) * spread * prand();
      V[i * 4] = Math.cos(a) * h * sp; V[i * 4 + 1] = Math.abs(e) * sp * up + up * .4; V[i * 4 + 2] = Math.sin(a) * h * sp; V[i * 4 + 3] = now;
      const max = life * (.6 + prand() * .6), b = .3 + prand() * .45;
      K[i * 3] = col.r * b; K[i * 3 + 1] = col.g * b; K[i * 3 + 2] = col.b * b; S[i * 2] = size * (.5 + prand()); S[i * 2 + 1] = max;
      if (i < emitLo) emitLo = i;
      if (i > emitHi) emitHi = i;
      puffEnd = Math.max(puffEnd, now + max);
      if (speed > .5) fastEnd = Math.max(fastEnd, now + max);
    }
  }
  function rebasePuffs() {
    const t = PT.value, V = puffs.a.aV;
    for (let i = 3; i < V.array.length; i += 4) V.array[i] -= t;
    puffEnd -= t; fastEnd -= t; PT.value = 0;
    V.clearUpdateRanges(); V.needsUpdate = true; // all of it
  }
  let glintN = 0;
  const gP = glints.a.position.array, gC = glints.a.aColor.array, gS = glints.a.aSize.array;
  function glint(x, y, z, col, k, s) {
    if (glintN >= glints.n || k <= .002) return; const i = glintN++;
    gP[i * 3] = x; gP[i * 3 + 1] = y; gP[i * 3 + 2] = z;
    gC[i * 3] = col.r * k; gC[i * 3 + 1] = col.g * k; gC[i * 3 + 2] = col.b * k; gS[i] = s;
  }

  // Hover and selection rings on the soil
  const ringMat = () => new THREE.MeshBasicMaterial({ color: C('#9dffb0'), ...additive, opacity: 0 });
  const hoverRing = new THREE.Mesh(new THREE.RingGeometry(.95, 1, 72).rotateX(-Math.PI / 2), ringMat());
  const selRing = new THREE.Mesh(new THREE.RingGeometry(.94, 1, 72).rotateX(-Math.PI / 2), ringMat());
  hoverRing.position.y = selRing.position.y = .04; root.add(hoverRing, selRing);

  // ── Per-frame ──
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qc = new THREE.Quaternion(), axis = new THREE.Vector3(), sc = new THREE.Vector3(), base = new THREE.Vector3(), up = new THREE.Vector3(), tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), tmpV = new THREE.Vector3(), clearC = new THREE.Color();
  let lightN = 0, waitAmt = 0;
  const fairyFlash = new THREE.Color(0, 0, 0);
  function light(x, z, r, k, col) {
    if (lightN >= LIGHTS || k <= .002) return;
    const o = lightN * 4, c = lightN * 3; lData[o] = x; lData[o + 1] = z; lData[o + 2] = r; lData[o + 3] = k; lCol[c] = col.r; lCol[c + 1] = col.g; lCol[c + 2] = col.b; lightN++;
  }
  // Uploads what changed of the first n values of a buffer since it was last sent: one range, from the first change to the last.
  function sync(attr, n) {
    const a = attr.array, s = attr.sent ||= new Float32Array(a.length).fill(NaN); let i = 0; // NaN: all of it, the first time
    while (i < n && a[i] === s[i]) i++;
    if (i >= n) return false;
    let j = n - 1; while (a[j] === s[j]) j--;
    for (let k = i; k <= j; k++) s[k] = a[k];
    upRange(attr, i, j + 1); return true;
  }
  // Adds [i, e) to what a buffer uploads next, in one reused range.
  function upRange(attr, i, e) {
    const ur = attr.updateRanges, R = attr.r1 ||= { start: 0, count: 0 };
    if (ur.length) { const end = Math.max(R.start + R.count, e); R.start = Math.min(R.start, i); R.count = end - R.start; }
    else { R.start = i; R.count = e - i; ur.push(R); }
    attr.needsUpdate = true;
  }
  // The soil's light map: redrawn only when a pool of light moved or changed, over the box the pools cover (snapped, so it holds still).
  function renderLights() {
    const n = lightN;
    if (n === lSeenN) {
      let i = 0; while (i < n * 4 && lData[i] === lSeenD[i]) i++;
      let j = 0; while (j < n * 3 && lCol[j] === lSeenC[j]) j++;
      if (i === n * 4 && j === n * 3) return;
    }
    lSeenN = n; lSeenD.set(lData); lSeenC.set(lCol);
    let x0 = 0, z0 = 0, x1 = 2, z1 = 2;
    if (n) {
      x0 = z0 = Infinity; x1 = z1 = -Infinity;
      for (let i = 0; i < n; i++) { const o = i * 4, e = lData[o + 2] * 3.2; x0 = Math.min(x0, lData[o] - e); x1 = Math.max(x1, lData[o] + e); z0 = Math.min(z0, lData[o + 1] - e); z1 = Math.max(z1, lData[o + 1] + e); }
      x0 = Math.floor(x0 / 2) * 2; z0 = Math.floor(z0 / 2) * 2; x1 = Math.max(x0 + 2, Math.ceil(x1 / 2) * 2); z1 = Math.max(z0 + 2, Math.ceil(z1 / 2) * 2);
      upRange(aL, 0, n * 4); upRange(aLC, 0, n * 3);
    }
    LB.set(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)); lmGeo.instanceCount = n;
    const rt = renderer.getRenderTarget(), auto = renderer.autoClear, alpha = renderer.getClearAlpha();
    renderer.getClearColor(clearC);
    renderer.setRenderTarget(lmRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    if (n) { renderer.autoClear = false; renderer.render(lmScene, lmCam); }
    renderer.autoClear = auto; renderer.setRenderTarget(rt); renderer.setClearColor(clearC, alpha);
  }

  function glowOf(n) {
    const s = n.s, ph = (n.seed % 1000) / 159, still = reduced();
    const breath = still ? .5 : .5 + .5 * Math.sin(T * 2.1 + ph), throb = still ? .7 : .5 + .5 * Math.sin(T * (2.6 + s.urgency * 5) + ph), slow = still ? .6 : .5 + .5 * Math.sin(T * 1.25 + ph);
    return s.work * (.85 + s.heat * .5) + s.think * (.4 + .55 * breath) + s.compact * .85 + s.need * (.7 + .35 * throb + .35 * s.urgency) + s.wait * (.3 + .5 * slow) + s.idle * .14 + s.error * .3;
  }

  // Lean (lx, lz, in radians) doesn't tip the mushroom over as a stick: the foot stays rooted and the stem curves so its top
  // swings out, and the cap follows the tip's tangent. sq is the squash-and-stretch spring: taller and narrower, or shorter and wider.
  // place takes its numbers in PL rather than as arguments, which would be boxed on every call.
  const capPos = new THREE.Vector3(), PL = { bx: 0, bz: 0, h: 0, R: 0, lx: 0, lz: 0, droop: 0, glow: 0, ctx: 0, rot: 0, wither: 0, rim: 0, sq: 0 };
  const stA = stems.geometry.attributes;
  function place(m) {
    const P = PL, h = P.h, R = P.R, sq = P.sq, col = m.col;
    base.set(P.bx, 0, P.bz);
    const bxv = P.lx * h * .8, bzv = P.lz * h * .8, bl = Math.sqrt(bxv * bxv + bzv * bzv) / Math.max(h, .01);
    const hh = h * (1 - .3 * Math.min(1, bl * bl)) * (1 + sq);
    const r = .11 * Math.max(.6, R / .6) ** .5 * (m.role === 'session' || m.role === 'cluster' ? 1 : .7) * m.thick * Math.min(1, h / Math.max(.01, m.h)) * (1 - .35 * sq);
    m.bulb = r * 1.6;
    m4.compose(base, q.identity(), sc.set(Math.max(.001, r), Math.max(.001, hh), Math.max(.001, r)));
    let k = m.stemSlot;
    stems.setMatrixAt(k, m4);
    stA.aCol.array[k * 3] = col.r; stA.aCol.array[k * 3 + 1] = col.g; stA.aCol.array[k * 3 + 2] = col.b;
    let a = stA.aP.array; a[k * 4] = P.glow; a[k * 4 + 1] = -1; a[k * 4 + 2] = P.rot; a[k * 4 + 3] = P.wither;
    a = stA.aQ.array; a[k * 4] = m.seed; a[k * 4 + 1] = 0; a[k * 4 + 2] = m.exit ? 1 : 0; a[k * 4 + 3] = m.exit ? Math.atan2(m.exit.x, -m.exit.y) : 0;
    m.bx = bxv; m.bz = bzv; m.wx = m.bowX * h; m.wz = m.bowZ * h; m.hh = hh;
    const b = bendAttr.array, o = m.stemSlot * 4; b[o] = bxv; b[o + 1] = bzv; b[o + 2] = m.wx; b[o + 3] = m.wz;
    m.top.set(P.bx + bxv, hh, P.bz + bzv);
    // The bow is flat at both ends, so the tip's direction comes from the lean alone.
    const tx = 2 * bxv, tz = 2 * bzv, tl = Math.sqrt(tx * tx + tz * tz), tilt = Math.atan2(tl, Math.max(hh, .001)) + P.droop;
    let dx = m.dx ?? 1, dz = m.dz ?? 0; if (tl > 1e-4) { dx = tx / tl; dz = tz / tl; }
    if (tilt > 1e-4) qc.setFromAxisAngle(axis.set(dz, 0, -dx).normalize(), tilt); else qc.identity();
    up.set(0, 1, 0).applyQuaternion(qc);
    const cr = R * (1 - .3 * sq), cy = R * m.ys * (1 + .45 * sq);
    capPos.copy(m.top).addScaledVector(up, -SHAPE_SEAT[m.shape] * cy);
    m4.compose(capPos, qc, sc.set(Math.max(.001, cr), Math.max(.001, cy), Math.max(.001, cr)));
    m.crown = capPos.y + SHAPE_TOP[m.shape] * cy;
    const cap = caps[m.shape], g = cap.geometry.attributes; k = m.capSlot;
    cap.setMatrixAt(k, m4);
    g.aCol.array[k * 3] = col.r; g.aCol.array[k * 3 + 1] = col.g; g.aCol.array[k * 3 + 2] = col.b;
    a = g.aP.array; a[k * 4] = P.glow; a[k * 4 + 1] = P.ctx; a[k * 4 + 2] = P.rot; a[k * 4 + 3] = P.wither;
    a = g.aQ.array; a[k * 4] = m.seed; a[k * 4 + 1] = P.rim; a[k * 4 + 2] = m.role === 'session' || m.role === 'cluster' ? 0 : 1; a[k * 4 + 3] = m.pat;
  }
  // Point on the bent stem at height fraction y, and the direction it runs there.
  function stemAt(m, y, out, dir) {
    const q2 = (1 - y) * (1 - y), w = 16 * y * y * q2;
    out.set(m.bx * y * y + m.wx * w, m.hh * y, m.bz * y * y + m.wz * w);
    const d = 32 * y * (1 - y) * (1 - 2 * y);
    dir.set(m.bx * 2 * y + m.wx * d, m.hh, m.bz * 2 * y + m.wz * d).normalize();
  }
  function kick(m, v, delay = 0) { if (reduced()) return; if (delay > 0) { m.kv = v; m.kt = T + delay; } else m.sqv += v; }
  // A spring still moving keeps the board at full rate (springy); one that has all but settled is put to rest.
  function spring(m, dt) {
    if (reduced()) { m.sq = m.sqv = m.kv = 0; return 0; }
    if (m.kv && T >= m.kt) { m.sqv += m.kv; m.kv = 0; }
    m.sqv += (-m.k * m.sq - 7 * m.sqv) * dt; m.sq = clamp(m.sq + m.sqv * dt, -.32, .4);
    if (m.kv || Math.abs(m.sq) > .002 || Math.abs(m.sqv) > .02) springy = true; else m.sq = m.sqv = 0;
    return m.sq;
  }
  // Hover and select give a little hop the moment they start; delay staggers a group into a wave.
  function pokes(m, s, delay = 0) {
    const hv = s.hover > .5, sl = s.select > .5;
    if (hv && !m.hovOn) kick(m, 1.7 * (.75 + .5 * ((m.seed * 3.7) % 1)), delay);
    if (sl && !m.selOn) kick(m, 2.3, delay);
    m.hovOn = hv; m.selOn = sl;
  }
  // Slow, out-of-step sway, added to the lean (m.swx, m.swz).
  function swayOf(m) {
    if (reduced()) { m.swx = m.swz = 0; return; }
    m.swx = m.sway * (Math.sin(T * .8 + m.seed * 1.9) + .45 * Math.sin(T * 1.37 + m.seed * 4.1));
    m.swz = m.sway * (Math.cos(T * .66 + m.seed * 2.3) + .45 * Math.sin(T * 1.21 + m.seed * 3.3));
  }
  // ── Usage round the stump ──
  // The fairy ring is the gauge: an arc per account and in it a run of mushrooms per window (a spend limit counts as one), runs split
  // by a bud and accounts by two. A run is grown and lit as far as its window is used: green, amber past 70%, ember past 90%. Beside
  // the ring a sign in glowing spores names each account and reads its windows out; a sign redraws only when its text changes.
  // All of it is worked out again only when world.usage changes (it is replaced, never edited) or the fonts arrive.
  const usageCol = new THREE.Color(), signs = [], mids = [], SIGN_W = 512, SIGN_H = 150, TC = Math.cos(.9);
  let runs = [], accts = [], cols = [[], []], usageShape = null, usageRef = null, usageStale = true, layHs = NaN, layX = NaN, layZ = NaN;
  const refont = () => { usageStale = true; for (const S of signs) S.text = null; ctx.wake?.(); };
  document.fonts?.addEventListener?.('loadingdone', refont);
  function fairyState(m) {
    if (m.run === -2) { m.lit = 1; return FOX; }
    if (m.run < 0) { m.lit = -1; return FOX; }
    const used = runs[m.run].used;
    m.lit = clamp(used * m.rn - m.rk);
    return usageCol.copy(FOX).lerp(AMBER, smoothstep(.6, .75, used)).lerp(EMBER, smoothstep(.85, .95, used));
  }
  function signFor(j) {
    if (!signs[j]) {
      const c = document.createElement('canvas'); c.width = SIGN_W; c.height = SIGN_H;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      // Kept under the bloom threshold, so the text stays sharp.
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, color: C('#c4c4c4') })); s.renderOrder = 3; root.add(s);
      signs[j] = { s, c, tex, text: null, H: SIGN_H };
    }
    return signs[j];
  }
  const money = v => `$${v < 10 ? v.toFixed(2) : Math.round(v)}`;
  const NAME_FONT = px => `italic 500 ${px}px Fraunces, Georgia, serif`, PART_FONT = px => `${px}px "JetBrains Mono", ui-monospace, monospace`;
  // Words (or readings) w wide, gap apart, in a box W wide: one row, shrunk to no less than 85%; failing that two rows, split
  // as evenly as they go and shrunk as far as the longer needs, again to no less than 85%. Text is only ever scaled evenly.
  function fitRows(items, gap, W) {
    const n = items.length; let total = gap * (n - 1);
    for (const it of items) total += it.w;
    const k1 = Math.min(1, W / total);
    if (k1 >= .85 || n < 2) return { k: Math.max(.85, k1), rows: [items] };
    let best = 1, bestW = Infinity, left = -gap;
    for (let i = 1; i < n; i++) { left += items[i - 1].w + gap; const m = Math.max(left, total - left - gap); if (m < bestW) { bestW = m; best = i; } }
    return { k: Math.max(.85, Math.min(1, W / bestW)), rows: [items.slice(0, best), items.slice(best)] };
  }
  const rowWidth = (g, row, gap) => { let w = gap * (row.length - 1); for (const it of row) w += g.measureText(it.t).width; return w; };
  // A row that still doesn't fit ends in an ellipsis, cutting into as many of its last words as it must.
  function clip(g, row, gap, W) {
    if (rowWidth(g, row, gap) <= W + 4) return;
    for (;;) {
      const it = row[row.length - 1]; let t = it.t; it.t = t + '…';
      while (t && rowWidth(g, row, gap) > W) { t = t.slice(0, -1).trimEnd(); it.t = t + '…'; }
      if (t || row.length < 2) return;
      row.pop();
    }
  }
  // Measures and fits items at size px with the given font; returns the rows, the font to draw them in and the gap between words.
  function fit(g, font, px, items, gap, W) {
    g.font = font(px);
    for (const it of items) it.w = g.measureText(it.t).width;
    if (gap < 0) gap = g.measureText(' ').width;
    const { k, rows } = fitRows(items, gap, W), f = font(px * k);
    g.font = f;
    for (const row of rows) clip(g, row, gap * k, W);
    return { rows, font: f, gap: gap * k };
  }
  function drawRow(g, row, gap, y) {
    let x = (SIGN_W - rowWidth(g, row, gap)) / 2;
    for (const it of row) { g.fillStyle = it.col; g.fillText(it.t, x, y); x += g.measureText(it.t).width + gap; }
  }
  function drawSign(S, a) {
    const parts = a.wins.map(w => [w.spend ? `${money(w.spend.spent)} / ${money(w.spend.limit)}` : `${w.label} ${Math.round(w.used * 100)}%`, w.used > .9 ? '#ff7a52' : w.used > .7 ? '#ffbe5c' : '#a8f5b4']);
    const text = a.name + parts.map(p => p[0]).join();
    if (S.text === text) return;
    S.text = text;
    const g = S.c.getContext('2d');
    const name = fit(g, NAME_FONT, 48, (a.name.match(/\S+/g) || ['']).map(t => ({ t, col: '#eef4e4' })), -1, SIGN_W - 60);
    const read = fit(g, PART_FONT, 40, parts.map(([t, col]) => ({ t, col })), 30, SIGN_W - 64);
    // The sign grows a line taller for each row past the first of either.
    const nameY = 64, partY = nameY + 54 * (name.rows.length - 1) + 52, H = partY + 48 * (read.rows.length - 1) + 34;
    if (H !== S.H) { S.c.height = H; S.H = H; S.tex.dispose(); } else g.clearRect(0, 0, SIGN_W, H);
    // A tag of loam like the labels', edged with a faint glow.
    g.shadowColor = 'rgba(110, 240, 150, .3)'; g.shadowBlur = 14;
    g.beginPath(); g.roundRect(12, 12, SIGN_W - 24, H - 24, [30, 30, 30, 10]); g.fillStyle = 'rgba(7, 10, 6, .88)'; g.fill();
    g.shadowBlur = 0; g.strokeStyle = 'rgba(164, 240, 160, .3)'; g.lineWidth = 2.5; g.stroke(); g.textAlign = 'left';
    g.font = name.font; name.rows.forEach((row, i) => drawRow(g, row, name.gap, nameY + 54 * i));
    g.font = read.font; read.rows.forEach((row, i) => drawRow(g, row, read.gap, partY + 48 * i));
    S.tex.needsUpdate = true;
  }
  // The screenshot body's cap, its underside turned to face you: pale flesh with fine gills round its edge and a faint bioluminescent rim, the
  // screenshot set into its middle like a pool, darkened towards the lip; a spore on the flesh below it for each screenshot, up to
  // nine. Everything but the rim stays under the bloom, so the picture stays sharp.
  function drawLens(B, shot) {
    const g = B.canvas.getContext('2d'), W = 512, H = 400, cx = 256, cy = 200, rx = 244, ry = 190, ix = 206, iy = 156, bm = shot.bitmap;
    const oval = (ax, ay, wob) => { const p = new Path2D(); for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2, k = 1 + wob * (Math.sin(a * 7 + B.wob[0]) * .6 + Math.sin(a * 11 + B.wob[1]) * .4); const x = cx + Math.cos(a) * ax * k, y = cy + Math.sin(a) * ay * k; if (i) p.lineTo(x, y); else p.moveTo(x, y); } return p; };
    const cap = oval(rx - 8, ry - 8, .018), pool = oval(ix, iy, .008);
    g.clearRect(0, 0, W, H);
    g.save(); g.clip(cap);
    const flesh = g.createRadialGradient(cx - 40, cy - 70, 20, cx, cy, rx); flesh.addColorStop(0, '#b9b09a'); flesh.addColorStop(.7, '#9a8f78'); flesh.addColorStop(1, '#6e6552');
    g.fillStyle = flesh; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(40, 32, 22, .28)'; g.lineWidth = 1.4;
    for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); g.beginPath(); g.moveTo(cx + c * ix * 1.04, cy + sn * iy * 1.04); g.lineTo(cx + c * rx, cy + sn * ry); g.stroke(); }
    g.restore();
    g.save(); g.clip(pool); g.fillStyle = '#0a0d08'; g.fillRect(0, 0, W, H);
    const sc = Math.min(ix * 2 * .9 / bm.width, iy * 2 * .9 / bm.height), dw = bm.width * sc, dh = bm.height * sc;
    g.drawImage(bm, cx - dw / 2, cy - dh / 2, dw, dh);
    g.fillStyle = 'rgba(0, 0, 0, .2)'; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(cx, cy, iy * .75, cx, cy, ix * 1.02); vg.addColorStop(0, 'rgba(6, 10, 5, 0)'); vg.addColorStop(1, 'rgba(6, 10, 5, .7)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H); g.restore();
    g.shadowColor = 'rgba(0, 0, 0, .8)'; g.shadowBlur = 8; g.strokeStyle = 'rgba(52, 40, 26, .9)'; g.lineWidth = 4; g.stroke(pool);
    g.shadowColor = 'rgba(130, 255, 160, .85)'; g.shadowBlur = 18; g.strokeStyle = 'rgba(200, 255, 210, .7)'; g.lineWidth = 3; g.stroke(cap); g.shadowBlur = 0;
    const n = Math.min(9, shot.count);
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i % 2 ? 1 : -1) * (.16 + Math.floor(i / 2) * .15), x = cx + Math.cos(a) * (ix + rx) / 2, y = cy + Math.sin(a) * (iy + ry) / 2 - 4;
      const sg = g.createRadialGradient(x, y, 0, x, y, 10); sg.addColorStop(0, 'rgba(235, 255, 235, 1)'); sg.addColorStop(.35, 'rgba(140, 240, 160, .9)'); sg.addColorStop(1, 'rgba(140, 240, 160, 0)');
      g.fillStyle = sg; g.fillRect(x - 10, y - 10, 20, 20);
    }
    B.tex.needsUpdate = true;
  }
  function updateUsage() {
    if (usageStale || world.usage !== usageRef) {
      usageStale = false; usageRef = world.usage; layHs = NaN;
      accts = world.usage.map(a => ({ name: String(a.label || a.provider).replace(/ Code\b/, ''), wins: [...a.windows.map(w => ({ label: w.label === 'week' ? 'wk' : w.label, used: w.used })),
        ...(a.spend?.limit > 0 ? [{ used: Math.min(1, a.spend.spent / a.spend.limit), spend: a.spend }] : [])] })).filter(a => a.wins.length);
      runs = accts.flatMap(a => a.wins);
      const shape = accts.map(a => a.wins.length).join();
      if (shape !== usageShape) {
        usageShape = shape;
        const n = Math.max(1, Math.floor((FAIRY - 1 - accts.reduce((g, a) => g + a.wins.length + 1, 0)) / Math.max(1, runs.length))), seq = [-1];
        let w = 0;
        accts.forEach((a, j) => { const from = seq.length; for (const _ of a.wins) { for (let k = 0; k < n; k++) seq.push(w); seq.push(-1); w++; } mids[j] = Math.PI / 2 + ((from + seq.length - 2) / 2 + .5) / FAIRY * Math.PI * 2; seq.push(-1); });
        for (const m of fairy) { const v = accts.length ? seq[m.fi] ?? -1 : -2; m.run = v; m.rk = v >= 0 ? m.fi - seq.indexOf(v) : 0; m.rn = n; }
      }
      cols = [[], []];
      accts.forEach((a, j) => { cols[Math.cos(mids[j]) < 0 ? 0 : 1].push(j); const S = signFor(j); drawSign(S, a); S.s.visible = true; });
      for (const col of cols) col.sort((p, q) => Math.sin(mids[p]) - Math.sin(mids[q]));
      for (let j = accts.length; j < signs.length; j++) signs[j].s.visible = false;
    }
    // Signs in two columns beside the ring, each on the side of its arc, kept between a readable and a modest size on screen,
    // stacked by their heights as they show on screen (TC: how much the tilted ground shortens depth there).
    const Y = world.you.pos, ppu = size.h / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.distanceTo(tmpV.set(Y.x, 0, Y.z)));
    const hs = Math.min(Math.max(.95, (size.w < 700 ? 24 : 34) / ppu), 56 / ppu);
    if (hs === layHs && Y.x === layX && Y.z === layZ) return;
    layHs = hs; layX = Y.x; layZ = Y.z;
    const ws = hs * SIGN_W / SIGN_H, G = 1.65 * TC * hs - hs;
    for (let side = 0; side < 2; side++) {
      const col = cols[side]; let E = G * (col.length - 1), s = 0;
      for (let r = 0; r < col.length; r++) E += hs * signs[col[r]].H / SIGN_H;
      for (let r = 0; r < col.length; r++) {
        const S = signs[col[r]], hj = hs * S.H / SIGN_H;
        S.s.scale.set(ws, hj, 1);
        S.s.position.set(Y.x + (side ? 1 : -1) * (3.3 + ws / 2), hs * .55, Y.z + (s + hj / 2 - E / 2) / TC);
        s += hj + G;
      }
    }
  }

  const SHED = { speed: .25, up: -.15, size: .09, life: 3.2, spread: 0 };
  function updateMushrooms(dt) {
    const still = reduced(), ss = world.sessions, ps = world.projects, P = PL;
    let waiting = 0, urg = 0;
    for (let i = 0; i < ss.length; i++) { const s = ss[i]; if (s.present && (s.status === 'permission' || s.status === 'question')) { waiting++; urg = Math.max(urg, s.s.urgency); } }
    const wt = waiting ? 1 : 0;
    if (Math.abs(wt - waitAmt) < .001) waitAmt = wt; else { waitAmt += (wt - waitAmt) * (1 - Math.exp(-dt * 3)); busy = true; }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], st = pstat.get(p), xs = p.sessions; let live = 0, act = 0;
      for (let j = 0; j < xs.length; j++) { const x = xs[j]; if (x.present) { live++; act += x.s.work + x.s.think * .7 + x.s.compact * .7; } }
      st.act = live ? act / live : 0;
    }
    for (let mi = 0; mi < mush.length; mi++) {
      const m = mush[mi], n = m.node, s = n.s;
      if (m.role === 'session' || m.role === 'sub') {
        const L = linkOf.get(n), target = n.present ? 1 : 0, was = m.rise;
        if (still) m.rise = s.alive;
        else if (target) { if (!L || L.grow > .8) m.rise = Math.min(1, m.rise + dt * 1.8); }
        else m.rise = Math.max(0, m.rise - dt * 2.4);
        if (m.rise !== was) busy = true;
        if (was < 1 && m.rise >= 1) kick(m, -2.6); // lands from the pop with a squash
        if (m.rise > .5) pokes(m, s);
        swayOf(m);
        const sq = spring(m, dt);
        const rs = m.rise <= 0 ? 0 : easeOutBack(m.rise, 2.4);
        statusColor(n, PALC, m.col);
        const glow = (glowOf(n) + m.flash * 1.4) * Math.min(1, m.rise * 1.5);
        if (m.flash > 0) { m.flash = Math.max(0, m.flash - dt * 2.5); busy = true; }
        const hop = clamp(n.pos.y * .3, -.3, .7), bob = still ? 0 : s.need * .05 * Math.sin(T * 3.2 + m.seed);
        const h = m.h * rs * (1 + hop + .24 * s.need + bob + .12 * s.hover + .08 * s.select - .3 * s.off);
        // Context fills the cap out.
        const R = m.R * rs * (m.role === 'session' ? .88 + .2 * s.ctx : 1) * (1 - .1 * s.compact - .04 * hop) * (1 + (still ? 0 : s.think * .035 * Math.sin(T * 2.1 + m.seed)));
        // Offline stems wilt: they bend right over and the cap hangs.
        P.bx = n.pos.x; P.bz = n.pos.z; P.h = h; P.R = R;
        P.lx = clamp(n.vel.x * .045, -.6, .6) + m.lx + m.dx * s.off * .65 + m.swx * (1 - .7 * s.off);
        P.lz = clamp(n.vel.z * .045, -.6, .6) + m.lz + m.dz * s.off * .65 + m.swz * (1 - .7 * s.off);
        P.droop = .5 * s.off; P.glow = glow; P.ctx = m.role === 'session' ? s.ctx : -1; P.rot = s.error; P.wither = s.off; P.rim = Math.max(s.hover, s.select); P.sq = sq;
        place(m);
        m.R0 = R;
        if (rs > .05) {
          light(n.pos.x, n.pos.z, m.role === 'session' ? 2.1 : 1.1, glow * (m.role === 'session' ? .26 : .16) * Math.min(1, rs), m.col);
          glint(m.top.x, m.top.y + R * .35, m.top.z, m.col, glow * .03, R * 4);
          // A ripe cap sheds spores, amber when it's nearly full.
          if (!still && m.role === 'session' && s.ctx > .55 && Math.random() < dt * (s.ctx - .5) * 7) { SHED.spread = R * .8; emit(m.top.x, m.top.y - .05, m.top.z, s.ctx > .85 ? AMBER : SPORE, 1, SHED); }
        }
      } else if (m.role === 'shot') {
        const B = m.body, shot = ctx.shot ? ctx.shot(n) : null, sm = mushOf.get(n), was = m.rise;
        if (shot && shot !== B.shot) drawLens(B, shot);
        B.shot = shot;
        m.rise = still ? (shot ? 1 : 0) : clamp(m.rise + (shot && n.present ? dt * 1.4 : -dt * 2.5));
        if (m.rise !== was) busy = true;
        const e = Math.min(m.rise <= 0 ? 0 : easeOutBack(m.rise, 1.6), sm.rise);
        m.col.copy(sm.col).lerp(WHITE, .6);
        swayOf(m);
        P.bx = n.pos.x + m.ox; P.bz = n.pos.z + m.oz; P.h = m.h * e; P.R = m.R * e; P.lx = m.lx + m.swx * .5; P.lz = m.lz + m.swz * .5;
        P.droop = 0; P.glow = .18 * e; P.ctx = -1; P.rot = 0; P.wither = n.s.off * .6; P.rim = 0; P.sq = 0;
        place(m);
        m.exit ||= new THREE.Vector2(); m.exit.set(-m.ox, -m.oz);
        B.lens.visible = e > .02;
        // The cap leans right over to show you its face: centred on the stalk's tip, which disappears up behind it.
        if (B.lens.visible) { B.lens.position.copy(camera.position).sub(m.top).setLength(.2).add(m.top); B.lens.quaternion.copy(camera.quaternion); B.lens.rotateZ(still ? 0 : m.swx * .25); B.lens.scale.setScalar(e); }
        B.pos.copy(B.lens.position);
      } else if (m.role === 'plan') {
        const sm = mushOf.get(n), done = n.plan ? m.step < n.plan.done : false, cur = n.plan && m.step === n.plan.done, gt = done ? 1 : cur ? .5 : .18;
        if (Math.abs(gt - m.grown) < .002) m.grown = gt; else { m.grown += (gt - m.grown) * (1 - Math.exp(-dt * 3)); busy = true; }
        const rs = sm.rise <= 0 ? 0 : easeOutBack(sm.rise, 2.4), pulse = cur && !still ? .5 + .5 * Math.sin(T * 3 + m.step) : .5;
        m.col.copy(done ? WHITE : sm.col);
        swayOf(m);
        P.bx = n.pos.x + m.ox; P.bz = n.pos.z + m.oz; P.h = m.h * m.grown * rs; P.R = m.R * (.45 + .55 * m.grown) * rs;
        P.lx = m.lx + m.swx + clamp(n.vel.x * .04, -.5, .5); P.lz = m.lz + m.swz + clamp(n.vel.z * .04, -.5, .5); P.droop = 0;
        P.glow = (done ? .55 : cur ? .3 + .4 * pulse : .06) * Math.min(1, sm.rise * 1.5); P.ctx = -1; P.rot = 0; P.wither = n.s.off; P.rim = 0; P.sq = spring(m, dt);
        place(m);
      } else if (m.role === 'cluster') {
        const act = pstat.get(n).act, ph = m.phase ?? 0;
        const breath = still ? .5 : .5 + .5 * Math.sin(T * 1.6 + ph + m.seed);
        m.col.copy(m.hue);
        const glow = (.42 + .6 * act + .35 * s.hover + .25 * s.select) * (.85 + .2 * breath) + m.flash;
        if (m.flash > 0) { m.flash = Math.max(0, m.flash - dt * 2); busy = true; }
        const hop = clamp(n.pos.y * .25, -.3, .6);
        pokes(m, s, m.ox === 0 ? 0 : .05 + m.dist * .07);
        swayOf(m);
        P.sq = spring(m, dt);
        P.bx = n.pos.x + m.ox; P.bz = n.pos.z + m.oz; P.h = m.h * (1 + hop + .1 * s.hover); P.R = m.R * (1 - .04 * hop);
        P.lx = m.lx + m.swx + clamp(n.vel.x * .045, -.6, .6); P.lz = m.lz + m.swz + clamp(n.vel.z * .045, -.6, .6); P.droop = 0;
        P.glow = glow; P.ctx = -1; P.rot = 0; P.wither = 0; P.rim = m.ox === 0 ? Math.max(s.hover, s.select) : s.hover * .5;
        place(m);
        if (m.ox === 0) { light(n.pos.x, n.pos.z, 1.7, .22 + .3 * act + .15 * s.hover, m.col); glint(m.top.x, m.top.y + .2, m.top.z, m.col, glow * .06, 2.5); }
      } else {
        const a = m.angle, wave = still ? .6 : .5 + .5 * Math.sin(a * 3 - T * 1.6);
        m.col.copy(fairyState(m)).add(tmpC.copy(fairyFlash).multiplyScalar(.6));
        const lit = Math.max(0, m.lit), bud = m.lit < 0 ? .25 : .45 + .55 * lit;
        const glow = (.08 + .8 * lit * (.85 + .15 * wave)) + Math.min(1, fairyFlash.r) * .6;
        // A hop on You runs round the ring as a wave.
        pokes(m, n.s, (m.fi / FAIRY) * .6);
        swayOf(m);
        P.sq = spring(m, dt);
        P.bx = n.pos.x + m.ox; P.bz = n.pos.z + m.oz; P.h = m.h * bud * (1 + clamp(n.pos.y * .2, -.3, .5)); P.R = m.R * (.6 + .4 * bud);
        P.lx = m.lx + m.swx; P.lz = m.lz + m.swz; P.droop = 0; P.glow = glow; P.ctx = -1; P.rot = 0; P.wither = m.lit < 0 ? .6 : 0; P.rim = 0;
        place(m);
      }
    }
    // Only what changed goes up.
    for (let i = 0; i < instMeshes.length; i++) {
      const mesh = instMeshes[i], at = mesh.geometry.attributes;
      sync(mesh.instanceMatrix, mesh.count * 16);
      for (let k = 0; k < INST_ATTRS.length; k++) { const a = at[INST_ATTRS[k]]; sync(a, mesh.count * a.itemSize); }
    }
    sync(bendAttr, mush.length * 4);
    // Skirts mark the mode
    for (let i = 0; i < modeSessions.length; i++) {
      const s = modeSessions[i], m = mushOf.get(s), rs = m.rise <= 0 ? 0 : easeOutBack(m.rise, 2.4), r = .17 * Math.max(.001, rs) * m.thick;
      // The skirt rides the bent stem at 58% of its height and tilts with it.
      stemAt(m, .58, base, up); base.x += s.pos.x; base.z += s.pos.z;
      q.setFromUnitVectors(axis.set(0, 1, 0), up);
      m4.compose(base, q, sc.set(r, r, r)); skirts.setMatrixAt(i, m4);
    }
    sync(skirts.instanceMatrix, modeSessions.length * 16);
    // The stump
    you.position.set(world.you.pos.x, 0, world.you.pos.z);
    you.scale.set(1, 1 + clamp(world.you.pos.y * .2, -.2, .4), 1);
    stumpMat.uniforms.uWait.value = waitAmt * (.6 + .6 * urg);
    stumpMat.uniforms.uFlash.value.copy(fairyFlash);
    gripCol.copy(AMBER).lerp(EMBER, urg * .6).multiplyScalar(1.4);
    if (fairyFlash.r + fairyFlash.g + fairyFlash.b > .005) { fairyFlash.multiplyScalar(Math.exp(-dt * 2.5)); busy = true; } else fairyFlash.r = fairyFlash.g = fairyFlash.b = 0;
    light(world.you.pos.x, world.you.pos.z, 4.2, .35 + waitAmt * .35, tmpC2.copy(FOX).lerp(AMBER, waitAmt));
  }

  // Each cord is a Hermite curve from its child's foot, leaving it along a seeded heading, to where it joins its parent: a session
  // cord merges into its project's trunk, a subagent's into its session's cord, both running the same way at the join; a trunk
  // runs to the tip of its stump root, and a need hypha leaves along its session's cord and turns for the stump's flank.
  // A small meander rides on top. Writes L.P = [x, z, ...], L.N (left normals), L.S (distance along) and L.len; t stays the
  // curve parameter, which is close to even in distance.
  const J = { x: 0, z: 0, tx: 1, tz: 0, t: 0 };
  function along(L, d) {
    const S = L.S, n = L.segs, P = L.P; d = clamp(d, 0, S[n]);
    let i = 0; while (i < n - 1 && S[i + 1] < d) i++;
    const f = (d - S[i]) / Math.max(1e-6, S[i + 1] - S[i]);
    J.x = P[i * 2] + (P[i * 2 + 2] - P[i * 2]) * f; J.z = P[i * 2 + 1] + (P[i * 2 + 3] - P[i * 2 + 1]) * f;
    J.tx = L.N[i * 2 + 1]; J.tz = -L.N[i * 2]; J.t = L.tt[i] + (L.tt[i + 1] - L.tt[i]) * f;
  }
  function frame(L) {
    const P = L.P, N = L.N, S = L.S, n = L.segs; S[0] = 0;
    for (let i = 0; i <= n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n, i + 1), tx = P[i1 * 2] - P[i0 * 2], tz = P[i1 * 2 + 1] - P[i0 * 2 + 1], tl = Math.sqrt(tx * tx + tz * tz) || 1;
      N[i * 2] = -tz / tl; N[i * 2 + 1] = tx / tl;
      if (i) { const dx = P[i * 2] - P[i * 2 - 2], dz = P[i * 2 + 1] - P[i * 2 - 1]; S[i] = S[i - 1] + Math.sqrt(dx * dx + dz * dz); }
    }
    L.len = Math.max(.3, S[n]);
  }
  function layoutLink(L) {
    const A = L.child.pos, Y = world.you.pos, still = reduced(), segs = L.segs, P = L.P, N = L.N;
    const sx = A.x, sz = A.z; let ex, ez, etx, etz;
    if (L.kind === 'proj' || L.kind === 'need') {
      let ux = A.x - Y.x, uz = A.z - Y.z; const ul = Math.sqrt(ux * ux + uz * uz) || 1; ux /= ul; uz /= ul;
      if (L.kind === 'proj') { L.u.set(ux, uz); const d = ROOT_IN + ROOT_LEN; ex = Y.x + ux * d; ez = Y.z + uz * d; }
      else { const a = L.bend * .3, c = Math.cos(a), s = Math.sin(a), rx = ux * c - uz * s; uz = ux * s + uz * c; ux = rx; ex = Y.x + ux * 1.45; ez = Y.z + uz * 1.45; L.u.set(ux, uz); }
      etx = -ux; etz = -uz;
    } else {
      const H = L.H, pp = L.parent.pos, hx = H.N[1], hz = -H.N[0], sub = L.kind === 'sub';
      const ahead = (A.x - pp.x) * hx + (A.z - pp.z) * hz, d = Math.min(Math.max(sub ? .35 : .4, ahead + .5) + L.dj * (sub ? .45 : .7), H.len * .5);
      along(H, d); ex = J.x; ez = J.z; etx = J.tx; etz = J.tz; L.jt = J.t; L.jd = d;
    }
    let cx = ex - sx, cz = ez - sz; const cl = Math.sqrt(cx * cx + cz * cz) || 1; cx /= cl; cz /= cl;
    let stx, stz;
    if (L.kind === 'need') { const S = linkOf.get(L.child).P; stx = S[2] - S[0]; stz = S[3] - S[1]; const l = Math.sqrt(stx * stx + stz * stz) || 1; stx /= l; stz /= l; }
    else {
      // Never arrive against the flow of the cord being joined.
      const back = etx * cx + etz * cz; if (back < .25) { etx += cx * (.25 - back) * 2; etz += cz * (.25 - back) * 2; const l = Math.sqrt(etx * etx + etz * etz) || 1; etx /= l; etz /= l; }
      const ca = Math.cos(L.bend), sa = Math.sin(L.bend); stx = cx * ca - cz * sa; stz = cx * sa + cz * ca;
    }
    const k0 = cl * (L.kind === 'need' ? .5 : .9), k1 = cl * (L.kind === 'need' ? .7 : .9);
    for (let i = 0; i <= segs; i++) {
      const t = L.tt[i], t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = 3 * t2 - 2 * t3, h11 = t3 - t2;
      P[i * 2] = h00 * sx + h10 * k0 * stx + h01 * ex + h11 * k1 * etx; P[i * 2 + 1] = h00 * sz + h10 * k0 * stz + h01 * ez + h11 * k1 * etz;
    }
    frame(L);
    // The meander, and a slow drift like a thread in water: two waves running opposite ways, flat at both ends.
    const amp = Math.min(cl, 8), drift = still ? 0 : Math.min(.25, .025 * cl + .04);
    for (let i = 1; i < segs; i++) {
      const t = L.tt[i], sp = Math.sin(Math.PI * t), o = L.off[i] * amp + drift * (.65 * Math.sin(T * .42 + t * 3.1 + L.seed) + .35 * Math.sin(T * .27 - t * 5.3 + L.seed * 1.7)) * sp * sp;
      P[i * 2] += N[i * 2] * o; P[i * 2 + 1] += N[i * 2 + 1] * o;
    }
    frame(L);
  }
  const mask = (L, t) => {
    const g = L.grow; if (g >= .999) return 1; if (g <= .001) return 0;
    return L.kind === 'need' ? 1 - smoothstep(g - .05, g + .005, t) : smoothstep(1 - g - .005, 1 - g + .05, t);
  };
  // Pulses near each sample, once per cord per frame: every strand and branch reads them. Cleared once when the last one ends.
  function pulses(L) {
    const n = L.segs, PR = L.pc, list = L.pulses.list;
    if (!list.length && !L.pcOn) return;
    PR.fill(0); L.pcOn = list.length > 0;
    for (let j = 0; j < list.length; j++) {
      const p = list[j], f = p.data.from || 0, pt = p.data.rev ? 1 - p.t : f + (1 - f) * p.t, c = p.data.col;
      for (let i = 0; i <= n; i++) { const d = (L.tt[i] - pt) * L.len; if (d < -2 || d > 2) continue; const w = p.strength * Math.exp(-d * d * 3.5); PR[i * 3] += c.r * w; PR[i * 3 + 1] += c.g * w; PR[i * 3 + 2] += c.b * w; }
    }
  }
  // Half-width of a cord's bundle at t: a trunk steps up at every session that joins it.
  function bundleAt(L, t) {
    let w = L.c.bundle;
    if (L.kind === 'proj') { const js = L.joins; for (let i = 0; i < js.length; i++) { const sl = js[i]; if (sl.grow > 0) w += L.c.bundle * .22 * Math.min(1, sl.grow * 2) * smoothstep(sl.jt - .02, sl.jt + .06, t); } }
    return w;
  }
  // The arch of a need hypha: it leaves the soil to reach across, higher as the wait grows.
  const liftOf = (L, t) => L.kind === 'need' ? L.lift * Math.sin(Math.PI * t) ** 1.5 : 0;
  function updateLinks(dt) {
    const still = reduced();
    let grips = 0;
    for (let li = 0; li < links.length; li++) {
      const L = links[li], c = L.child, s = c.s, g0 = L.grow;
      // State: how far grown, how bright, what colour, how pruned
      if (L.kind === 'need') {
        const target = s.need > .5 && c.present ? 1 : 0;
        if (still) L.grow = target;
        else if (target) L.grow = Math.min(1, Math.max(L.grow + dt * (.32 + s.urgency * .9), (c.waitSec - .5) * .4));
        else L.grow = Math.max(0, L.grow - dt * 1.4);
        if (L.grow !== g0) busy = true;
        if (L.grow <= 0 && !L.pulses.list.length) { Wd[L.tb * 4 + 3] = 0; continue; }
        const throb = still ? .7 : .5 + .5 * Math.sin(T * (3 + s.urgency * 5) + L.seed);
        L.col.copy(AMBER).lerp(EMBER, s.urgency * .6);
        L.bright = (.75 + .35 * throb + .5 * s.urgency) * Math.max(s.need, .25);
        L.prune = 1; L.lift = Math.min(.7, .025 * L.len) * (.6 + .6 * s.urgency);
        if (!still && L.grow >= 1 && target) { L.beat = (L.beat ?? 0) - dt; if (L.beat <= 0) { L.beat = 1.5 - s.urgency * .9; L.pulses.add(5 / L.len, .9 + s.urgency * .6, { col: AMBER, rev: false }); } }
        if (L.grow > .9 && grips < NEEDS) gripAt[grips++].set(L.u.x, L.u.y, (L.grow - .9) * 10 * (.55 + .45 * s.urgency) * Math.min(1, L.bright));
      } else if (L.kind === 'proj') {
        const act = pstat.get(c).act;
        L.grow = 1; L.col.copy(L.foot.hue); L.bright = .2 + .5 * act + .3 * s.hover; L.prune = 1;
      } else {
        const target = c.present ? 1 : 0;
        if (still) L.grow = s.alive; else L.grow = target ? Math.min(1, L.grow + dt * 1.1) : (L.foot.rise <= .25 ? Math.max(0, L.grow - dt * 1.4) : L.grow);
        if (L.grow !== g0) busy = true;
        statusColor(c, PALC, L.col);
        const breath = still ? .5 : .5 + .5 * Math.sin(T * 2.1 + L.seed);
        L.bright = s.work * .72 + s.think * (.38 + .25 * breath) + s.compact * .5 + s.need * .5 + s.wait * .14 + s.idle * .13 + s.error * .4 + s.off * .07 + s.heat * .45 + s.hover * .35 + s.select * .25;
        L.prune = 1 - .88 * s.compact - .6 * s.off;
      }
      // The bundle's twist turns only while something flows through it.
      if (!still) L.spin += dt * .35 * (L.kind === 'need' ? 1 : L.kind === 'proj' ? pstat.get(c).act : Math.min(1, s.work + s.think + s.compact));
      const done = L.pulses.update(dt);
      for (let j = 0; j < done.length; j++) {
        const p = done[j];
        // A pulse that reaches a join carries on down the cord it joined, from the join.
        if (L.kind === 'sess' && !p.data.rev) { const pl = L.H; if (pl) pl.pulses.add(6 / (pl.len * (1 - L.jt)), p.strength * .75, { col: p.data.col, rev: false, from: L.jt }); const mom = clusters.get(c.parent)?.[0]; if (mom) { mom.flash = .6; kick(mom, -.9); } }
        if (L.kind === 'proj') { fairyFlash.add(tmpC.copy(p.data.col).multiplyScalar(.5)); if (fairyFlash.r + fairyFlash.g + fairyFlash.b > 2.4) fairyFlash.multiplyScalar(.8); rootFlash[c.index] = Math.min(1.5, rootFlash[c.index] + p.strength * .8); }
        if (L.kind === 'sub' && !p.data.rev) { const m = mushOf.get(c.parent), sl = L.H; if (m) m.flash = Math.max(m.flash, .4); if (sl && sl.grow > .5) sl.pulses.add(6 / (sl.len * (1 - L.jt)), p.strength * .7, { col: p.data.col, rev: false, from: L.jt }); }
        if (L.kind === 'need' && p.data.rev) { const m = mushOf.get(c); if (m) { m.flash = 1; kick(m, 1.8); } }
      }
      // A need hypha's heartbeat runs at the ambient pace; anything else in flight wants every frame.
      if (L.pulses.list.length && L.kind !== 'need') busy = true;
      layoutLink(L); // even when unseen: others may join it
      // The cord leaves its foot this way; the stem's shader runs the strands up the bulb there.
      if (L.kind !== 'need' && L.foot) { L.foot.exit ||= new THREE.Vector2(); L.foot.exit.set(L.P[2] - L.P[0], L.P[3] - L.P[1]); }
      if (L.grow <= 0) { Wd[L.tb * 4 + 3] = 0; continue; }
      writeLinkData(L);
      // Growing tips
      if (L.grow < .999) {
        const t = L.kind === 'need' ? L.grow : 1 - L.grow, i = near(L, t);
        const col = L.kind === 'need' ? AMBER : L.col;
        glint(L.P[i * 2], .12 + liftOf(L, t), L.P[i * 2 + 1], col, L.kind === 'need' ? 1.6 + s.urgency : .8, L.kind === 'need' ? .9 + s.urgency * .5 : .5);
        if (L.kind === 'need') light(L.P[i * 2], L.P[i * 2 + 1], 1.4, .45, AMBER);
      }
    }
    for (let i = grips; i < NEEDS; i++) gripAt[i].z = 0;
  }
  // The places a cord's strands carry on through after its own end: along the parent cord past the join for sessions and
  // subagents, and up the back of its stump root for a trunk. Q = [x, y, z, nx, nz, room]: room is the root's radius there.
  function carryOn(L) {
    const C = L.c.cont, Q = L.Q;
    if (L.H) {
      for (let j = 1; j <= C; j++) { along(L.H, L.jd + L.c.carry * j / C); const o = j * 6; Q[o] = J.x; Q[o + 1] = 0; Q[o + 2] = J.z; Q[o + 3] = -J.tz; Q[o + 4] = J.tx; Q[o + 5] = J.t; }
    } else if (L.kind === 'proj') {
      const spec = rootSpecs[L.child.index], ux = L.u.x, uz = L.u.y, Y = world.you.pos, sy = you.scale.y;
      for (let j = 1; j <= C; j++) {
        const rt = 1 - .93 * j / C, o = j * 6; rootAt(rt, spec, tmpV);
        Q[o] = Y.x + tmpV.x * ux - tmpV.z * uz; Q[o + 1] = tmpV.y * sy; Q[o + 2] = Y.z + tmpV.x * uz + tmpV.z * ux; Q[o + 3] = uz; Q[o + 4] = -ux; Q[o + 5] = rootRadius(rt, spec);
      }
    }
  }
  // A cord's record (see CORD_GLSL): its header, centre line with pulses, the samples its strands carry on through, and for a
  // trunk where each session joins it. The shaders build its glow, strands and branches from it.
  function writeLinkData(L) {
    const segs = L.segs, P = L.P, N = L.N, S = L.S, kind = L.kind, c = L.c, H = L.H, foot = L.foot, col = L.col, b = L.bright, W = Wd, PC = L.pc;
    pulses(L); carryOn(L);
    const jw = H ? bundleAt(H, L.jt) * .7 : kind === 'proj' ? .045 : c.bundle, fan = foot ? Math.max(c.bundle, foot.bulb * .85) : c.bundle;
    const tip = kind === 'need' && L.grow < 1 && !reduced() ? L.grow : -1, o0 = L.tb * 4;
    W[o0] = col.r * b; W[o0 + 1] = col.g * b; W[o0 + 2] = col.b * b; W[o0 + 3] = L.grow;
    W[o0 + 4] = jw; W[o0 + 5] = fan; W[o0 + 6] = L.spin; W[o0 + 7] = tip;
    W[o0 + 8] = foot ? foot.bulb : .05; W[o0 + 9] = L.lift; W[o0 + 10] = L.prune; W[o0 + 11] = L.child.s.error || 0;
    W[o0 + 12] = L.len; W[o0 + 13] = L.seed; W[o0 + 14] = L.tw; W[o0 + 15] = you.scale.y;
    let o = o0 + 24;
    for (let i = 0; i <= segs; i++, o += 8) {
      W[o] = P[i * 2]; W[o + 1] = P[i * 2 + 1]; W[o + 2] = N[i * 2]; W[o + 3] = N[i * 2 + 1];
      W[o + 4] = S[i]; W[o + 5] = PC[i * 3]; W[o + 6] = PC[i * 3 + 1]; W[o + 7] = PC[i * 3 + 2];
    }
    const Q = L.Q;
    for (let j = 1; j <= c.cont; j++, o += 8) { const q = j * 6; W[o] = Q[q]; W[o + 1] = Q[q + 1]; W[o + 2] = Q[q + 2]; W[o + 3] = Q[q + 3]; W[o + 4] = Q[q + 4]; W[o + 5] = Q[q + 5]; }
    if (kind === 'proj') { const js = L.joins; for (let j = 0; j < js.length; j++, o += 4) { const sl = js[j]; W[o] = sl.jt; W[o + 1] = sl.grow > 0 ? Math.min(1, sl.grow * 2) : 0; } }
  }
  function updateBridges() {
    for (let i = 0; i < bridges.length; i++) {
      const X = bridges[i], LA = X.A, LB = X.B, o = X.rb * 4;
      if (LA.grow <= 0 || LB.grow <= 0) { Wd[o + 4] = Wd[o + 5] = Wd[o + 6] = 0; continue; }
      const ax = LA.P[X.ia * 2], az = LA.P[X.ia * 2 + 1], dx = LB.P[X.ib * 2] - ax, dz = LB.P[X.ib * 2 + 1] - az, d = Math.sqrt(dx * dx + dz * dz) || 1;
      const f = mask(LA, X.ta) * mask(LB, X.tb) * smoothstep(4, 1.6, d) * Math.min(LA.prune, LB.prune) * X.b * .5;
      Wd[o] = ax; Wd[o + 1] = az; Wd[o + 2] = dx; Wd[o + 3] = dz;
      Wd[o + 4] = (LA.col.r * LA.bright + LB.col.r * LB.bright) * f; Wd[o + 5] = (LA.col.g * LA.bright + LB.col.g * LB.bright) * f; Wd[o + 6] = (LA.col.b * LA.bright + LB.col.b * LB.bright) * f;
    }
  }
  function updateRoots(dt) {
    for (let i = 0; i < trunks.length; i++) {
      const L = trunks[i];
      rootDir[i].copy(L.u); veinDir[i].copy(L.u);
      if (rootFlash[i] > .005) { rootFlash[i] *= Math.exp(-dt * 2.5); busy = true; } else rootFlash[i] = 0;
      rootCol[i].copy(L.col).multiplyScalar(.3 + L.bright * .7 + rootFlash[i]);
      veinCol[i].copy(L.col).multiplyScalar((.25 + L.bright * .6 + rootFlash[i]) * .8);
      const M = trunks[(i + 1) % NP].u; let mx = L.u.x + M.x, mz = L.u.y + M.y; const ml = Math.sqrt(mx * mx + mz * mz);
      if (NP < 2 || ml < 1e-3) { mx = -L.u.y; mz = L.u.x; } else { mx /= ml; mz /= ml; }
      rootDir[NP + i].set(mx, mz);
    }
  }
  // Felt, tethers, the screenshot body's threads and feeding threads: where their ends are and how bright.
  function updateFuzz() {
    const W = Wd;
    for (let i = 0; i < fuzz.length; i++) {
      const F = fuzz[i], m = F.m, n = m.node, s = n.s, cl = m.role === 'cluster', rise = cl ? 1 : m.rise, L = linkOf.get(n);
      // The felt is the foot's own strands: the same colour and brightness as the cord where it leaves.
      const col = tmpC.copy(m.col).lerp(WHITE, .2), ox = n.pos.x + (m.ox || 0), oz = n.pos.z + (m.oz || 0), sc = cl ? 1 : Math.min(1, rise * 1.3);
      const b = rise * (cl ? .55 : .35 + .45 * Math.min(1.4, L ? L.bright * 1.3 : .5)) * (cl ? .5 + .5 * (m.ox === 0 ? 1 : .6) : 1 - .7 * s.off);
      let o = F.rb * 4;
      W[o] = ox; W[o + 1] = oz; W[o + 2] = sc; W[o + 4] = col.r * b; W[o + 5] = col.g * b; W[o + 6] = col.b * b;
      if (F.teth >= 0) {
        const f = b * .8; o = F.teth * 4;
        W[o] = ox; W[o + 1] = oz; W[o + 2] = n.pos.x - ox; W[o + 3] = n.pos.z - oz; W[o + 4] = m.col.r * f; W[o + 5] = m.col.g * f; W[o + 6] = m.col.b * f;
      }
    }
    // From inside the session's bulb to inside the stalk's, drawn out as the body grows, gathered at both ends.
    for (let i = 0; i < shotBodies.length; i++) {
      const B = shotBodies[i], s = B.s, m = B.m, sm = mushOf.get(s), L = linkOf.get(s), e = Math.min(m.rise, sm.rise), dx = m.ox, dz = m.oz, d = Math.sqrt(dx * dx + dz * dz) || 1;
      const col = tmpC.copy(sm.col).lerp(WHITE, .25), f = e * (.2 + .45 * Math.min(1.2, L.bright)) * (1 - .7 * s.s.off), o = B.rb * 4;
      W[o] = s.pos.x; W[o + 1] = s.pos.z; W[o + 2] = dx; W[o + 3] = dz; W[o + 4] = col.r * f; W[o + 5] = col.g * f; W[o + 6] = col.b * f;
      W[o + 8] = sm.bulb * .45 / d; W[o + 9] = e - m.bulb * .45 / d;
    }
    for (let i = 0; i < feeders.length; i++) {
      const F = feeders[i], s = F.s, m = F.m, sm = mushOf.get(s), o = F.rb * 4;
      const f = sm.rise * (.12 + .3 * m.grown) * (1 - .7 * s.s.off), col = tmpC.copy(sm.col).lerp(WHITE, .35);
      W[o] = s.pos.x; W[o + 1] = s.pos.z; W[o + 2] = m.ox; W[o + 3] = m.oz; W[o + 4] = col.r * f; W[o + 5] = col.g * f; W[o + 6] = col.b * f;
    }
  }
  // Sends the records that changed: per row of the texture, each run of changes as a range (runs fewer than GAP floats apart go
  // as one). Until the texture has gone up once it goes whole (its first upload allocates it).
  const rowR = [], GAP = 256; let rUsed = 0;
  function flushData() {
    if (!dataTex.updateRanges.length) rUsed = 0;
    if (!dataUp || rUsed > rows * 32) { dataTex.clearUpdateRanges(); rUsed = 0; Dd.set(Wd); dataTex.needsUpdate = true; return; }
    const n = texN * 4, n0 = rUsed;
    for (let lo = 0; lo < n; lo += TW * 4) {
      const hi = Math.min(n, lo + TW * 4); let a = -1, e = 0;
      for (let k = lo; k < hi; k++) {
        if (Wd[k] === Dd[k]) continue;
        Dd[k] = Wd[k];
        if (a >= 0 && k - e > GAP) { addRange(a, e); a = -1; }
        if (a < 0) a = k;
        e = k;
      }
      if (a >= 0) addRange(a, e);
    }
    if (rUsed > n0) dataTex.needsUpdate = true;
  }
  // Floats a to e, widened to whole texels.
  function addRange(a, e) { const R = rowR[rUsed++] ||= { start: 0, count: 0 }; R.start = a - (a & 3); R.count = (e | 3) + 1 - R.start; dataTex.updateRanges.push(R); }
  function updatePoints() {
    if (TAU.value > 600) rebaseSpores();
    if (emitHi >= emitLo) {
      for (let i = 0; i < puffAttrs.length; i++) { const a = puffAttrs[i]; upRange(a, emitLo * a.itemSize, (emitHi + 1) * a.itemSize); }
      emitLo = puffs.n; emitHi = -1;
    }
    if (PT.value > 4000) rebasePuffs();
    const ga = glints.a; sync(ga.position, glintN * 3); sync(ga.aColor, glintN * 3); sync(ga.aSize, glintN);
    glints.g.setDrawRange(0, glintN);
    const scale = renderer.getPixelRatio() * size.h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (let i = 0; i < clouds.length; i++) clouds[i].p.material.uniforms.uScale.value = scale;
    threadMat.uniforms.uPx.value = scale;
  }
  function updateRings(dt) {
    let h = null, sel = null; const ns = world.nodes;
    for (let i = 0; i < ns.length; i++) { const n = ns[i]; if (n.hovered) h = n; if (n.selected) sel = n; }
    for (let i = 0; i < 2; i++) {
      const ring = i ? selRing : hoverRing, n = i ? sel : h, target = n ? (i ? .7 : .35) : 0, mat = ring.material;
      if (Math.abs(target - mat.opacity) > .002) { mat.opacity += (target - mat.opacity) * (1 - Math.exp(-dt * 10)); busy = true; } else mat.opacity = target;
      if (n) { const r = n.kind === 'you' ? 3.2 : n.kind === 'project' ? .8 * PK : n.kind === 'session' ? 1.35 : .55; ring.position.x = n.pos.x; ring.position.z = n.pos.z; ring.scale.setScalar(r * (1 + (reduced() ? 0 : .04 * Math.sin(T * 3)))); }
    }
  }

  return {
    // The pace: every frame while a spring bounces, 60 fps while something fades, flows or grows, and otherwise 30 for the sway
    // and drift; in reduced motion nothing moves by itself, so it rests (0) unless something is fading (30).
    update(dt) {
      const still = reduced();
      T += dt; if (!still) { T0.value += dt; TAU.value += dt; }
      MOVE.value = still ? 0 : 1; PT.value += dt;
      busy = springy = false; lightN = 0; glintN = 0;
      updateUsage();
      updateMushrooms(dt);
      updateLinks(dt);
      updateBridges();
      updateRoots(dt);
      updateFuzz();
      flushData();
      renderLights();
      updatePoints();
      updateRings(dt);
      if (PT.value < (still ? puffEnd : fastEnd)) busy = true;
      return springy ? Infinity : busy ? (still ? 30 : 60) : still ? 0 : 30;
    },
    event(type, n, data) {
      const m = mushOf.get(n), still = reduced();
      if (type === 'tool') {
        // Only real work sends anything up the cord; an idle or waiting session's cord rests.
        if (!BUSY.has(n.status)) return;
        if (m) { m.flash = Math.max(m.flash, .5); kick(m, -1.1); }
        if (still) return;
        const col = TOOL_C[data.kind] || TOOL_C[''];
        const L = linkOf.get(n);
        if (L && L.grow > .5) L.pulses.add(6.5 / L.len, 1, { col, rev: false });
        if (n.kind === 'session' && data.kind === 'agent') for (const k of n.subs) { const kl = linkOf.get(k); if (k.present && kl) kl.pulses.add(4 / kl.len, 1, { col, rev: true }); }
      } else if (type === 'finish' && m) { kick(m, -2.4); emit(m.top.x, m.top.y + .1, m.top.z, n.kind === 'sub' ? WHITE : PUFF.work, n.kind === 'sub' ? 22 : 56, { speed: 2.2, up: 1, size: .2 }); }
      else if (type === 'compacted' && m) { emit(m.top.x, m.top.y + .1, m.top.z, PUFF.compact, 70, { speed: 2.6, up: 1.1, size: .22, life: 2.2 }); m.flash = 1; kick(m, -2.8); }
      else if (type === 'spawn' && m) { emit(n.pos.x, .1, n.pos.z, PUFF.soil, 26, { speed: 2.4, up: 1.6, size: .14, life: 1 }); emit(n.pos.x, .2, n.pos.z, PUFF.work, 14, { speed: 1, up: .8, size: .14 }); }
      else if (type === 'despawn' && m) emit(m.top.x, m.top.y, m.top.z, PUFF.ash, 24, { speed: 1.2, up: .6, size: .16 });
      else if (type === 'need' && m) { emit(m.top.x, m.top.y + .1, m.top.z, AMBER, 30, { speed: 1.8, up: 1.2, size: .16 }); m.flash = 1; kick(m, 2.4); }
      else if (type === 'answer') { const L = needOf.get(n); if (L && L.grow > .2 && !still) L.pulses.add(7 / L.len, 1.8, { col: REPLY, rev: true }); else if (m) { m.flash = 1; kick(m, 1.6); } }
      else if (type === 'state' && data.to === 'error' && m) { kick(m, -1.8); emit(m.top.x, m.top.y, m.top.z, PUFF.rot, 34, { speed: 1.4, up: .5, size: .2, life: 2.4 }); }
    },
    dispose() { document.fonts?.removeEventListener?.('loadingdone', refont); lmRT.dispose(); lmGeo.dispose(); lmMat.dispose(); dataTex.dispose(); },
  };

  // ── Builders ──
  function buildLink(kind, child, parent, seed) {
    const c = CFG[kind], r = rng(seed ^ { proj: 11, sess: 23, sub: 37, need: 51 }[kind]), segs = c.segs;
    const L = { kind, child, parent, c, segs, pulses: new Pulses(), grow: kind === 'need' ? 0 : 1, col: new THREE.Color(), bright: 0, prune: 1, len: 1, seed: r() * 100, lift: 0, spin: 0,
      off: new Float32Array(segs + 1), strands: [], branches: [], P: new Float32Array((segs + 1) * 2), N: new Float32Array((segs + 1) * 2), S: new Float32Array(segs + 1),
      tt: Float32Array.from({ length: segs + 1 }, (_, i) => warp(i / segs)), pc: new Float32Array((segs + 1) * 3), Q: new Float32Array((c.cont + 1) * 6), jt: 1, jd: 0, joins: [], pcOn: false, tb: 0, u: new THREE.Vector2(1, 0) };
    // How the cord leaves its foot (radians off the straight line), how far along its parent's cord it joins, and how tight its twist is.
    L.bend = kind === 'need' ? (r() < .5 ? -1 : 1) * (.45 + r() * .3) : (r() * 2 - 1) * .5;
    L.dj = r(); L.tw = (r() < .5 ? -1 : 1) * (1.6 + r() * 1.4);
    const waves = [0, 1, 2].map(i => [1 + i * 1.7 + r() * 1.5, r() * 6.28, (r() * 2 - 1) * c.amp / (1 + i * .6)]);
    // sin² keeps the meander flat at both ends, so the cord leaves its foot and enters its parent without a kink.
    for (let i = 0; i <= segs; i++) { const t = L.tt[i], env = Math.sin(Math.PI * t) ** 2; let o = 0; for (const [f, p, a] of waves) o += a * Math.sin(Math.PI * f * t + p); L.off[i] = o * env; }
    for (let s = 0; s < c.strands; s++) {
      const f = 1.5 + r() * 3, p = r() * 6.28, a = (.02 + r() * .05) * c.scale;
      const fa = ((s + .5) / c.strands - .5) * 2 * (kind === 'need' ? .8 : 1.75) + (r() - .5) * .3;
      L.strands.push({ a, f, p, ph: s / c.strands * Math.PI * 2 + (r() - .5) * .6, sp: .6 + r() * .8, b: .45 + r() * .35, y: s * .0015, ca: Math.cos(fa), sa: Math.sin(fa) });
    }
    // Side branches along the cord; a in the cord's local frame (0 is along it toward the parent).
    const sprout = (t0, a, n, step, b, fork) => {
      const side = Math.sign(a) || 1; let x = 0, y = 0; const pts = [0, 0];
      for (let k = 0; k < n; k++) { a += (r() - .5) * .8; x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push(x, y); }
      L.branches.push({ t0, i0: near(L, t0), pts, b });
      if (fork && r() < .55) {
        const mi = 1 + Math.floor(r() * (n - 1)), sp = [pts[mi * 2], pts[mi * 2 + 1]]; let b2 = a - side * (.7 + r() * .6), x2 = sp[0], y2 = sp[1];
        for (let k = 0; k < 3; k++) { b2 += (r() - .5) * .7; x2 += Math.cos(b2) * step * .8; y2 += Math.sin(b2) * step * .8; sp.push(x2, y2); }
        L.branches.push({ t0, i0: near(L, t0), pts: sp, b: b * .65 });
      }
    };
    for (let i = 0; i < c.branches; i++) { const side = r() < .5 ? -1 : 1; sprout(.08 + r() * .8, side * (.4 + r() * .9) + (r() < .25 ? side * 1.2 : 0), 4 + Math.floor(r() * 4), (.13 + r() * .14) * c.scale, .3 + r() * .35, true); }
    // Root hairs all round the foot, gripping the soil.
    const fan0 = { proj: 8, sess: 7, sub: 4, need: 0 }[kind];
    for (let i = 0; i < fan0; i++) { const side = i % 2 ? 1 : -1; sprout(0, side * (.6 + 2.4 * (i + r()) / fan0), 3 + Math.floor(r() * 3), (.06 + r() * .08) * c.scale, .35 + r() * .35, false); }
    return L;
  }

  function matLines() {
    const { pos, col, ph } = matCache ||= matWalks();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({ ...additive, uniforms: { uTime: T0 },
      vertexShader: 'attribute vec3 aCol; attribute float aPh; uniform float uTime; varying vec3 vC; void main(){ vC = aCol * (.65 + .55 * sin(uTime * .7 - aPh)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }' });
    const l = new THREE.LineSegments(g, mat); l.frustumCulled = false; return l;
  }
}

// The faint mycelial mat under the whole floor: random walks that branch, the same on every build.
let matCache = null;
function matWalks() {
  const r = rng(31337), pos = [], col = [], ph = [];
  for (let w = 0; w < 140; w++) {
    const x = (r() - .5) * 64, z = (r() - .5) * 52 + 1.5, a = r() * 6.28, steps = 10 + Math.floor(r() * 22), b = .014 + r() * .03, p = r() * 6.28;
    const walk = (x, z, a, steps, b) => { for (let k = 0; k < steps; k++) { a += (r() - .5) * .9; const nx = x + Math.cos(a) * .35, nz = z + Math.sin(a) * .35; pos.push(x, .012, z, nx, .012, nz); for (let e = 0; e < 2; e++) { col.push(b * .75, b, b * .7); ph.push(p + k * .3); }
      x = nx; z = nz; if (r() < .12 && steps > 4) walk(x, z, a + (r() < .5 ? -1 : 1) * (.6 + r() * .6), Math.floor(steps * .5), b * .8); } };
    walk(x, z, a, steps, b);
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), ph: new Float32Array(ph) };
}

// Leaf litter, twigs and grit, drawn once into a big canvas covering the board and kept for every rebuild.
let soilCanvas = null, soilTex = null; // the texture is shared by every build too, so a rebuild doesn't dispose it (userData.keep)
function soilTexture() {
  if (!soilCanvas) {
    const S = 2048, c = soilCanvas = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), r = rng(2718);
    g.fillStyle = '#140e09'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const x = r() * S, y = r() * S, rad = 14 + r() * 70, grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, r() < .5 ? 'rgba(46,32,20,.35)' : 'rgba(6,4,3,.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const leaf = ['#3d2a17', '#4c3119', '#2f2414', '#3e3b1e', '#5a3a1b', '#2b2b16', '#5e3018', '#45401f'];
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, L = 9 + r() * 20, W = L * (.32 + r() * .2), a = r() * Math.PI * 2;
      g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = .45 + r() * .5;
      g.fillStyle = leaf[Math.floor(r() * leaf.length)];
      g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(-L * .2, -W * 1.3, L, 0); g.quadraticCurveTo(-L * .2, W * 1.3, -L, 0); g.fill();
      g.globalAlpha *= .5; g.strokeStyle = 'rgba(120,96,60,.6)'; g.lineWidth = .8; g.beginPath(); g.moveTo(-L * 1.15, 0); g.lineTo(L * .9, 0); g.stroke();
      g.restore();
    }
    g.globalAlpha = 1; g.lineCap = 'round';
    for (let i = 0; i < 160; i++) {
      let x = r() * S, y = r() * S, a = r() * 6.28; g.strokeStyle = `rgba(${40 + r() * 30},${28 + r() * 16},${16 + r() * 10},.9)`; g.lineWidth = 1 + r() * 2.5;
      g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { a += (r() - .5) * .5; x += Math.cos(a) * (10 + r() * 22); y += Math.sin(a) * (10 + r() * 22); g.lineTo(x, y); } g.stroke();
    }
    for (let i = 0; i < 9000; i++) { const v = 30 + r() * 60; g.fillStyle = `rgba(${v},${v * .85},${v * .7},${.2 + r() * .4})`; g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5); }
  }
  if (!soilTex) { soilTex = new THREE.CanvasTexture(soilCanvas); soilTex.colorSpace = THREE.SRGBColorSpace; soilTex.anisotropy = 8; soilTex.userData.keep = true; }
  return soilTex;
}

function stumpGeometry() {
  const R0 = 1.42, R1 = 1.76, H = .9, g = new THREE.CylinderGeometry(R0, R1, H, 84, 6, false);
  g.translate(0, H / 2 - .08, 0);
  const p = g.attributes.position, top = H - .08;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z); if (r < 1e-5) { if (y > 0) p.setY(i, top + .05); continue; }
    const a = Math.atan2(z, x), f = 1 + .055 * Math.sin(a * 17 + 2.1 * Math.sin(a * 3)) + .035 * Math.sin(a * 31 + 1) + .14 * Math.pow(Math.max(0, 1 - (y + .08) / H), 3) * (1 + .5 * Math.sin(a * 5));
    p.setX(i, x * f); p.setZ(i, z * f);
    if (Math.abs(y - top) < 1e-4 && r < R0 * .999) p.setY(i, y + .05 * (1 - r / R0) + .02 * Math.sin(a * 4 + r * 6) * (1 - r / R0));
  }
  g.computeVertexNormals();
  return g;
}

// Roots leave the stump along +x: t runs 0 at the stump to 1 at the tip. Main roots (the first np) end pointing straight out and
// diving into the soil, so a trunk cord arriving along that line can climb straight onto the tip; the rest are shorter and bent.
// The trunk's strands ride the same curve, so they lie on the bark. aR = (root index, t).
const ROOT_IN = 1.15, ROOT_LEN = 2.7;
function rootAt(t, R, out) {
  const aa = R.bend * t * t + R.wig * Math.sin(Math.PI * t) ** 2, d = ROOT_IN + t * R.len;
  return out.set(Math.cos(aa) * d, R.lift * (1 - t) * (1 - t) - .08 * t + R.hump * Math.sin(t * Math.PI), Math.sin(aa) * d);
}
const rootRadius = (t, R) => R.thick * Math.pow(1 - t, 1.1) + .025;
function rootsGeometry(np, specs) {
  const r = rng(555), parts = [];
  for (let i = 0; i < np * 2; i++) {
    const main = i < np, spec = main ? { len: ROOT_LEN, bend: 0, wig: (r() < .5 ? -1 : 1) * (.06 + r() * .08), lift: .38, hump: .1, thick: .36 } : { len: .9 + r() * .7, bend: (r() - .5) * 1.1, wig: 0, lift: .26, hump: .05, thick: .2 };
    specs.push(spec);
    const tube = new Tube({ segments: 24, radial: 10, radius: t => rootRadius(t, spec) });
    tube.update((t, out) => rootAt(t, spec, out));
    const g = tube.geometry, n = g.attributes.position.count, aR = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) { aR[k * 2] = i; aR[k * 2 + 1] = g.attributes.uv.getX(k); }
    g.setAttribute('aR', new THREE.BufferAttribute(aR, 2));
    parts.push(g);
  }
  return mergeGeometries(parts);
}
