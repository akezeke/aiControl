// The PS1 look on the kind of TV it was played on. The fights are drawn small into `src`, smeared sideways there the way a composite signal smeared them, then put on the screen as glowing scanlines, through an aperture grille when its stripes can land on the device's own pixels, each fight darker toward its own corners. Nothing in it moves, so reduced motion has nothing to stop.
import * as THREE from 'three';

const QUAD = `void main(){ gl_Position = vec4(position.xy, 0., 1.); }`;
// NTSC's YIQ: brightness stays sharp and colour runs a pixel or two, which is what melted the console's dither into flat colour.
const BLEED = `uniform sampler2D uSrc; uniform vec2 uSize;
const mat3 YIQ = mat3(.299, .596, .211, .587, -.274, -.523, .114, -.322, .312), RGB = mat3(1., 1., 1., .956, -.272, -1.106, .621, -.647, 1.703);
void main(){ float y = 0., wy = 0., wc = 0.; vec2 iq = vec2(0.);
  for (int i = -2; i <= 2; i++) { float d = float(i), ky = exp(-d * d * 4.), kc = exp(-d * d * .7); vec3 s = YIQ * texture(uSrc, (gl_FragCoord.xy + vec2(d, 0.)) / uSize).rgb; y += s.x * ky; wy += ky; iq += s.yz * kc; wc += kc; }
  gl_FragColor = vec4(clamp(RGB * vec3(y / wy, iq / wc), 0., 1.), 1.); }`;
// Each row of the small picture is a beam, brighter colours wider, so dark ground shows its lines and a spell's flash fills them in. The beams add up in linear light. Across a row each small pixel stays flat and only its edges blend, so faces and gear keep their pixels.
const SCREEN = `uniform sampler2D uBled; uniform vec2 uSize; uniform vec4 uRect; uniform float uK, uShift, uLines, uMask;
vec3 beam(vec3 c, float d){ vec3 s = mix(vec3(.32), vec3(.52), c); return c * exp(-d * d / (2. * s * s)) / (s * 2.5066); }
void main(){ vec2 p = vec2(gl_FragCoord.x, gl_FragCoord.y - uShift) / uK; float row = floor(p.y) + .5, d = p.y - row, near = d < 0. ? -1. : 1., x = floor(p.x - .5) + .5 + clamp((fract(p.x - .5) - .5) * 2. + .5, 0., 1.);
  vec3 a = pow(texture(uBled, vec2(x, row) / uSize).rgb, vec3(2.2)), b = pow(texture(uBled, vec2(x, row + near) / uSize).rgb, vec3(2.2));
  vec3 c = mix(a, beam(a, d) + beam(b, 1. - abs(d)), uLines);
  vec3 grille = vec3(1. - uMask); grille[int(mod(gl_FragCoord.x, 3.))] = 1.; c *= grille / (1. - uMask * 2. / 3.);
  vec2 at = clamp((p - uRect.xy) / uRect.zw, 0., 1.), edge = at * (1. - at);
  gl_FragColor = vec4(pow(min(c, 1.), vec3(1. / 2.2)) * pow(min(edge.x * edge.y * 16., 1.), .09), 1.); }`;

export function createTv() {
  const small = { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
  const src = new THREE.WebGLRenderTarget(1, 1, { ...small, depthBuffer: true }), bled = new THREE.WebGLRenderTarget(1, 1, { ...small, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const size = new THREE.Vector2(1, 1), flat = { depthTest: false, depthWrite: false, vertexShader: QUAD };
  const bleed = new THREE.ShaderMaterial({ ...flat, fragmentShader: BLEED, uniforms: { uSrc: { value: src.texture }, uSize: { value: size } } });
  const screen = new THREE.ShaderMaterial({ ...flat, fragmentShader: SCREEN, uniforms: { uBled: { value: bled.texture }, uSize: { value: size }, uRect: { value: new THREE.Vector4() }, uK: { value: 1 }, uShift: { value: 0 }, uLines: { value: 0 }, uMask: { value: 0 } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bleed), scene = new THREE.Scene(), camera = new THREE.Camera();
  quad.frustumCulled = false; scene.add(quad);
  const u = screen.uniforms;
  let k = 1;
  const pass = (renderer, material, target, scissors) => {
    renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    renderer.setViewport(0, 0, size.x * (target ? 1 : k), size.y * (target ? 1 : k)); quad.material = material;
    for (const [x, y, w, h, rect] of scissors) { if (rect) u.uRect.value.set(rect.x, rect.y, rect.w, rect.h); renderer.setScissor(x, y, w, h); renderer.render(scene, camera); }
  };
  return {
    // The small picture is `wide` × `tall`, and the screen has `scale` of its pixels for each of those. `grille` when the screen's pixels are the device's.
    size(wide, tall, scale, grille) {
      src.setSize(wide, tall); bled.setSize(wide, tall); size.set(wide, tall); k = scale;
      // An even number of screen rows to a beam puts one on its middle, not two either side of it that would come out alike.
      u.uK.value = k; u.uShift.value = k % 2 ? 0 : .5; u.uLines.value = k >= 3 ? .6 : k >= 2 ? .45 : 0; u.uMask.value = grille && k >= 2 ? .09 : 0;
    },
    // The fights draw into the small picture.
    begin(renderer) { renderer.setRenderTarget(src); },
    // Each fight drawn, `rect` and `clip` in the small picture's pixels, onto the screen.
    show(renderer, drawn) {
      pass(renderer, bleed, bled, drawn.map(({ clip }) => [clip.x, clip.y, clip.w, clip.h]));
      pass(renderer, screen, null, drawn.map(({ rect, clip }) => [clip.x * k, clip.y * k, clip.w * k, clip.h * k, rect]));
    },
    dispose() { src.dispose(); bled.dispose(); bleed.dispose(); screen.dispose(); quad.geometry.dispose(); },
  };
}
