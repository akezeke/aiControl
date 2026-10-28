// The back wall's windows: one merged frame (plus its outline) and one merged pane of glass for them all, three draw calls.
// The glass looks out through a shader rather than at a picture: sky, clouds, a skyline and trees stand at set distances
// behind the wall, so the view shifts as you move and runs on from one window to the next. The sky follows the clock.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_H, WALL_T, rounded, mesh, canvasTexture } from './furniture.js';
import { toonMaterial } from './toon.js';

const W = 1.5, H = 1.4, Y = 1.75 - WALL_H / 2, FACE = WALL_T / 2; // glass size, its centre on the wall, the wall's inner face
const CASING = 0.07, DEPTH = 0.14; // the frame's boards stand out from the wall, so its inner sides read as a recess

// [hour, zenith, horizon, what lights the skyline and trees]; between 20:30 and 06:00 the night pictures are drawn already dark.
const SKY = [[0, '#0a1330', '#1b2950', '#5c5872'], [5.5, '#0a1330', '#1b2950', '#5c5872'], [6.5, '#5a74b0', '#f3b48e', '#c9a8a0'], [8, '#3f9be3', '#cbecff', '#ffffff'],
  [17.5, '#3f9be3', '#cbecff', '#ffffff'], [19.5, '#3b4c8c', '#f2996c', '#e09a80'], [20.5, '#0a1330', '#1b2950', '#5c5872'], [24, '#0a1330', '#1b2950', '#5c5872']];
const isNight = hour => hour < 6 || hour >= 20.5;

const random = seed => () => (seed = seed * 16807 % 2147483647) / 2147483647;
// The same for a spot every time, so a lit window stays lit whichever copy of its building is drawn.
const hash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
const pick = (r, list) => list[Math.floor(r() * list.length)];

// Each picture repeats sideways; [depth behind the glass, metres across, lowest and highest world y]. Its edge rows stretch
// beyond that, so the skyline and trees are drawn solid to the bottom and empty along the top.
// Office floors up: the street 12 m below, tall trees just reaching the sills, the skyline mostly under the horizon.
const HIGH = [400, 1200, 20, 200], FAR = [70, 160, -26, 14], NEAR = [14, 32, -6, 2], STREET = -12;

function drawHigh(g, w, h, night) {
  g.clearRect(0, 0, w, h);
  const r = random(3);
  if (night) { for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`; g.fillRect(r() * w, 4 + r() * (h - 8), 1 + r(), 1 + r()); } return; }
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 9; i++) {
    const x = r() * w, y = 20 + r() * (h - 50), s = 10 + r() * 14;
    for (const dx of [0, -w, w]) { g.beginPath(); for (let k = 0; k < 4; k++) g.ellipse(x + dx + (k - 1.5) * s * 0.8, y - Math.sin(k * 1.7) * s * 0.35, s * (0.9 + r() * 0.5), s * 0.45, 0, 0, 7); g.fill(); }
  }
}

function drawFar(g, w, h, night) {
  g.clearRect(0, 0, w, h);
  const r = random(7), m = h / (FAR[3] - FAR[2]), ground = h + (FAR[2] - STREET) * m; // pixels per metre, and where the street is
  g.fillStyle = night ? '#141c33' : '#a9b8c9'; g.fillRect(0, ground - 3 * m, w, h);
  // A paler row behind, then the nearer one, each building with its floors of windows.
  for (const [rows, tall, colors] of [[0, 14, night ? ['#151d36', '#18213c'] : ['#b9c6d4', '#c3ced9']], [1, 20, night ? ['#1a2340', '#202a4a', '#161e38'] : ['#94a7bc', '#a9b7c7', '#8496ad', '#b5c0cd']]]) {
    for (let x = 0; x < w;) {
      const bw = (5 + r() * 12) * m, top = ground - (5 + r() ** 1.4 * tall) * m, body = pick(r, colors), lit = 0.15 + r() * 0.3;
      for (const dx of [0, -w]) {
        g.fillStyle = body; g.fillRect(x + dx, top, bw, h - top);
        if (!rows) continue;
        for (let y = top + 1.2 * m; y < ground; y += 1.6 * m) for (let wx = x + dx + 0.8 * m; wx < x + dx + bw - 1.2 * m; wx += 1.4 * m) {
          if (night && hash(Math.round(wx - dx), Math.round(y)) > lit) continue;
          g.fillStyle = night ? '#ffd27a' : 'rgba(40,60,90,0.28)'; g.fillRect(wx, y, 0.7 * m, 0.8 * m);
        }
      }
      x += bw + r() * 3 * m;
    }
  }
}

function drawNear(g, w, h, night) {
  g.clearRect(0, 0, w, h);
  const r = random(11), m = h / (NEAR[3] - NEAR[2]), ground = h + NEAR[2] * m;
  // Crowns, a darker row behind; their tops stay below the sills' eye line.
  for (const [shades, centre] of [[night ? ['#14201d', '#182622'] : ['#4c8a4f', '#467f4a'], -1], [night ? ['#1b2b25', '#1f3029'] : ['#5f9e5a', '#78b06a', '#6aa862'], -1.6]]) {
    for (let x = 0; x < w; x += (0.8 + r() * 1.2) * m) {
      const radius = (1.1 + r() * 1.3) * m, y = ground - (centre - r() * 0.5) * m;
      g.fillStyle = pick(r, shades);
      for (const dx of [0, -w, w]) { g.beginPath(); g.arc(x + dx, y, radius, 0, 7); g.fill(); g.fillRect(x + dx - radius, y, radius * 2, h - y); }
    }
  }
}

let look;
function glassMaterial() {
  if (look) return look;
  const layer = (width, height, draw) => { const texture = canvasTexture(width, height, draw); texture.wrapS = THREE.RepeatWrapping; return texture; };
  const uniforms = {
    high: { value: layer(512, 128, drawHigh) }, far: { value: layer(1024, 256, drawFar) }, near: { value: layer(1024, 256, drawNear) },
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, drift: { value: 0 },
  };
  const box = ([depth, span, bottom, top]) => `${depth.toFixed(1)}, ${span.toFixed(1)}, ${bottom.toFixed(1)}, ${top.toFixed(1)}`;
  const material = new THREE.ShaderMaterial({
    uniforms, userData: { shared: true },
    vertexShader: `varying vec3 vWorld;
      void main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: `uniform sampler2D high, far, near; uniform vec3 zenith, horizon, shade; uniform float drift; varying vec3 vWorld;
      // Where the ray from the eye meets a picture standing \`depth\` behind the glass (the wall's face is at z = 0).
      vec4 layer(sampler2D map, vec3 ray, float depth, float span, float bottom, float top, float shift) {
        vec3 hit = vWorld + ray * ((vWorld.z + depth) / max(-ray.z, 0.05));
        return texture2D(map, vec2(hit.x / span + shift, (hit.y - bottom) / (top - bottom)));
      }
      void main() {
        vec3 ray = normalize(vWorld - cameraPosition), color = mix(horizon, zenith, smoothstep(0.0, 0.25, ray.y));
        vec4 c = layer(high, ray, ${box(HIGH)}, drift); color = mix(color, c.rgb * shade, c.a);
        c = layer(far, ray, ${box(FAR)}, 0.0); color = mix(color, mix(c.rgb * shade, horizon, 0.25), c.a);
        c = layer(near, ray, ${box(NEAR)}, 0.0); color = mix(color, c.rgb * shade, c.a);
        // A faint diagonal streak of reflection, fixed to the glass.
        float s = fract((vWorld.x + vWorld.y * 0.8) * 0.35);
        gl_FragColor = vec4(color + 0.05 * smoothstep(0.0, 0.05, s) * smoothstep(0.16, 0.08, s), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // The sky is checked once a minute; the pictures are only redrawn when night falls or ends. Clouds drift unless motion is reduced.
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let checked = -Infinity, night = false;
  material.update = () => {
    const now = performance.now();
    if (!motion?.matches) uniforms.drift.value = now / 1000 * 1.5 / HIGH[1] % 1;
    if (now - checked < 60_000) return;
    checked = now;
    const date = new Date(), hour = date.getHours() + date.getMinutes() / 60, i = SKY.findIndex(key => key[0] > hour), [h0, ...a] = SKY[i - 1], [h1, ...b] = SKY[i], k = (hour - h0) / (h1 - h0);
    for (const [j, name] of ['zenith', 'horizon', 'shade'].entries()) uniforms[name].value.set(a[j]).lerp(new THREE.Color(b[j]), k);
    if (isNight(hour)) uniforms.shade.value.set('#ffffff');
    if (night !== isNight(hour)) { night = isNight(hour); for (const name of ['high', 'far', 'near']) uniforms[name].value.redraw(night); }
  };
  return look = material;
}

// Windows centred at each of `xs` along the back wall, as its child (its local x, y about its middle, +z into the room).
export function createWindows(xs) {
  const group = new THREE.Group(), box = (w, h, d, x, y, z) => rounded(w, h, d, 0.012).translate(x, Y + y, FACE + z);
  const frame = mergeGeometries(xs.flatMap(x => [
    ...[-1, 1].map(side => box(CASING, H + 2 * CASING, DEPTH, x + side * (W + CASING) / 2, 0, DEPTH / 2)), // sides
    box(W + 2 * CASING, CASING, DEPTH, x, (H + CASING) / 2, DEPTH / 2), // head
    box(W + 2 * CASING + 0.12, 0.05, DEPTH + 0.1, x, -H / 2 - 0.025, (DEPTH + 0.1) / 2), // sill
    box(0.045, H, 0.04, x, 0, 0.02), // the bar down the middle
  ]));
  group.add(mesh(frame, toonMaterial('#f3f5f8'), 0.008));
  const glass = new THREE.Mesh(mergeGeometries(xs.map(x => new THREE.PlaneGeometry(W, H).translate(x, Y, FACE + 0.004))), glassMaterial());
  glass.onBeforeRender = () => glass.material.update();
  group.add(glass);
  return group;
}
