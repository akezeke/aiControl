// The back wall's windows: one merged frame (plus its outline) and one merged pane of glass for them all, three draw calls.
// The glass looks out through a shader rather than at a picture: sky, clouds, a skyline and trees stand at set distances
// behind the wall over a street worked out in the shader, so the view shifts as you move, holds up with your nose to the
// glass and runs on from one window to the next. The sky follows the clock.
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

// Each picture repeats sideways; [depth behind the glass, metres across, lowest and highest world y]. Its top row stretches
// above that, so they're drawn empty along the top; below the street the street hides them.
// Office floors up: the street 12 m below, a row of tall trees across it just reaching the sills, the skyline mostly under
// the horizon. Near the glass you look down on the pavement, the road and the park the trees stand in.
const HIGH = [400, 1200, 20, 200], FAR = [70, 160, -26, 14], NEAR = [14, 32, -12, 2], STREET = -12;
// The street's colours, as the shader's linear vec3s.
const rgb = hex => `vec3(${new THREE.Color(hex).toArray().map(v => v.toFixed(3)).join(', ')})`;

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

// A row of trees in the park across the road, one behind the other, over a hedge; one pixel is the same across as up.
function drawNear(g, w, h, night) {
  g.clearRect(0, 0, w, h);
  const r = random(11), m = w / NEAR[1], at = y => h - (y - NEAR[2]) * m; // pixels per metre; a world height's row
  const trunk = night ? '#16130f' : '#5e4633';
  const blob = (x, y, radius) => { for (const dx of [0, -w, w]) { g.beginPath(); g.arc(x + dx, y, radius, 0, 7); g.fill(); } };
  for (const [back, gap, shades, lights] of [[true, 5, night ? ['#121d1a', '#152320'] : ['#3d7643', '#43804a'], null],
    [false, 4, night ? ['#1a2a24', '#1e3029'] : ['#4f9150', '#579a52'], night ? ['#24382f', '#283d33'] : ['#76b267', '#82bc70']]]) {
    for (let x = r() * gap * m; x < w; x += (gap * 0.7 + r() * gap * 0.6) * m) {
      // Its crown's top a little under the sills, at most: a tall cluster of round clumps on a trunk, lit from the upper left.
      const across = (1.5 + r() * 0.8) * m, tall = (2.6 + r() * 1.2) * m, top = at((back ? 0.2 : -0.4) + r() * 1.2), y = top + tall, lean = (r() - 0.5) * 0.4 * m;
      g.fillStyle = trunk; for (const dx of [0, -w, w]) g.fillRect(x + dx - 0.22 * m, y, 0.44 * m, h - y);
      const clumps = Array.from({ length: 8 }, (_, i) => [x + lean + Math.cos(i * 0.8 + r()) * across * 0.5, y + Math.sin(i * 0.8 + r()) * tall * 0.55, across * (0.55 + r() * 0.2)]);
      g.fillStyle = pick(r, shades); for (const dx of [0, -w, w]) { g.beginPath(); g.ellipse(x + lean + dx, y, across * 0.85, tall * 0.8, 0, 0, 7); g.fill(); }
      for (const [cx, cy, s] of clumps) blob(cx, cy, s);
      if (lights) { g.fillStyle = pick(r, lights); for (const [cx, cy, s] of clumps.filter(([cx, cy]) => cx < x + lean + across * 0.2 && cy < y + tall * 0.2)) blob(cx - s * 0.2, cy - s * 0.25, s * 0.6); }
    }
  }
  // The hedge along the park's edge.
  g.fillStyle = night ? '#111a17' : '#3a6d3e';
  for (let x = 0; x < w; x += 0.6 * m) blob(x, at(STREET + 0.8), (0.4 + r() * 0.25) * m);
  g.fillRect(0, at(STREET + 0.8), w, h);
}

let look;
function glassMaterial() {
  if (look) return look;
  const layer = (width, height, draw) => { const texture = canvasTexture(width, height, draw); texture.wrapS = THREE.RepeatWrapping; return texture; };
  const uniforms = {
    high: { value: layer(512, 128, drawHigh) }, far: { value: layer(1024, 256, drawFar) }, near: { value: layer(1024, 448, drawNear) },
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, drift: { value: 0 },
    lit: { value: new THREE.Color() }, lamps: { value: 0 }, // what lights the street; its lamps at night
  };
  const box = ([depth, span, bottom, top]) => `${depth.toFixed(1)}, ${span.toFixed(1)}, ${bottom.toFixed(1)}, ${top.toFixed(1)}`;
  const material = new THREE.ShaderMaterial({
    uniforms, userData: { shared: true },
    vertexShader: `varying vec3 vWorld;
      void main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: `uniform sampler2D high, far, near; uniform vec3 zenith, horizon, shade, lit; uniform float drift, lamps; varying vec3 vWorld;
      // Where the ray from the eye meets a picture standing \`depth\` behind the glass (the wall's face is at z = 0), unless
      // it meets the street first (\`ground\` along the ray).
      vec4 layer(sampler2D map, vec3 ray, float ground, float depth, float span, float bottom, float top, float shift) {
        float t = (vWorld.z + depth) / max(-ray.z, 0.05);
        if (t > ground) return vec4(0.0);
        vec3 hit = vWorld + ray * t;
        return texture2D(map, vec2(hit.x / span + shift, (hit.y - bottom) / (top - bottom)));
      }
      // The street at a point on it, by its distance out from the wall: pavement, a kerb, the road with a dashed middle,
      // pavement again, then the park's grass; lamps pool along the near kerb at night, and it all hazes over with distance.
      vec3 street(vec3 p) {
        float z = -p.z, x = p.x, aa = fwidth(z) + fwidth(x);
        vec2 slab = abs(fract(vec2(x, z) / 1.2) - 0.5);
        vec3 c = mix(${rgb('#bdb7ac')}, ${rgb('#a29c91')}, smoothstep(0.48 - aa, 0.48, max(slab.x, slab.y)) * 0.7);
        if (z > 3.6 && z < 10.4) c = mix(${rgb('#4c4f57')}, ${rgb('#e8e3d5')}, (1.0 - smoothstep(0.08, 0.08 + aa, abs(z - 7.0))) * step(0.5, fract(x / 6.0)));
        if (abs(z - 3.5) < 0.12 || abs(z - 10.5) < 0.12) c = ${rgb('#d6d1c8')};
        if (z > 12.6) c = ${rgb('#6a9655')};
        c *= lit;
        vec2 lamp = vec2(x - floor(x / 14.0 + 0.5) * 14.0, z - 3.2);
        c += lamps * exp(-dot(lamp, lamp) / 7.0) * ${rgb('#a8742c')} * 0.5;
        return mix(c, horizon, smoothstep(10.0, 120.0, z) * 0.7);
      }
      void main() {
        vec3 ray = normalize(vWorld - cameraPosition), color = mix(horizon, zenith, smoothstep(0.0, 0.25, ray.y));
        float ground = ray.y < -0.001 ? (${STREET.toFixed(1)} - vWorld.y) / ray.y : 1e9;
        vec4 c = layer(high, ray, 1e9, ${box(HIGH)}, drift); color = mix(color, c.rgb * shade, c.a);
        color = mix(color, street(vWorld + ray * min(ground, 1e5)), step(ground, 1e8)); // outside the if: it takes fwidth
        c = layer(far, ray, ground, ${box(FAR)}, 0.0); color = mix(color, mix(c.rgb * shade, horizon, 0.25), c.a);
        c = layer(near, ray, ground, ${box(NEAR)}, 0.0); color = mix(color, c.rgb * shade, c.a);
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
    // The pictures are drawn dark for the night already; the street isn't.
    uniforms.lit.value.copy(uniforms.shade.value); uniforms.lamps.value = isNight(hour) ? 1 : 0;
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
