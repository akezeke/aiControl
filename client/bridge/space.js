import * as THREE from 'three';
import { LIGHT_SCALE } from './lights.js';
import { C, STD, add, box, canvas, canvasTexture, lit, seeded } from './parts.js';
import { STATION_ANGLES } from './deck.js';

const NOISE = `float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+7.1;a*=.5;}return s;}`;
const PLANET_R = 470, RING_R = 28, FIELD = C('#8fdcff');

function loft(stations, profile, tile = 10) {
  const pos = [], uv = [], P = profile.length;
  const point = (s, j) => [(s.x || 0) + s.w * profile[j % P][0], s.y + s.h * profile[j % P][1], s.z];
  for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < P; j++) {
    const a = point(stations[i], j), b = point(stations[i], j + 1), c = point(stations[i + 1], j + 1), d = point(stations[i + 1], j);
    const uA = (j / P) * stations[i].w / tile * 8, uB = ((j + 1) / P) * stations[i].w / tile * 8, uC = ((j + 1) / P) * stations[i + 1].w / tile * 8, uD = (j / P) * stations[i + 1].w / tile * 8;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(uA, a[2] / tile, uB, b[2] / tile, uC, c[2] / tile, uA, a[2] / tile, uC, c[2] / tile, uD, d[2] / tile);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals();
  return geometry;
}
function hullMaps() {
  const size = 1024, rnd = seeded('hull'), glow = canvas(size, size), e = glow.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  const base = canvas(size, size, g => {
    g.fillStyle = '#eef1f6'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 60; i++) { const v = 214 + rnd() * 26; g.fillStyle = `rgb(${v},${v + 2},${v + 8})`; g.fillRect(Math.floor(rnd() * 8) * 128, Math.floor(rnd() * 8) * 128, 128 * (1 + Math.floor(rnd() * 3)), 128); }
    g.strokeStyle = '#a0a8b8'; g.lineWidth = 3; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, size); g.moveTo(0, i * 128); g.lineTo(size, i * 128); g.stroke(); }
    for (let r = 0; r < 4; r++) { const y = 64 + r * 256; for (let x = 32; x < size; x += 64) { if (rnd() < .3) continue; g.fillStyle = '#26414f'; g.beginPath(); g.arc(x, y, 15, 0, 7); g.fill(); e.fillStyle = '#cfe4ff'; e.beginPath(); e.arc(x, y, 11, 0, 7); e.fill(); } }
  });
  return [base, glow].map(el => { const t = canvasTexture(el); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; });
}

// Our own ship ahead of the window and everything beyond it. `warpLevel` eases toward what the sessions say.
export function createSpace(still = false) {
  const scene = new THREE.Scene(), SUN = new THREE.Vector3(.86, .36, .36).normalize();
  const sun = new THREE.DirectionalLight(C('#f2f5ff'), 2.2 * LIGHT_SCALE); sun.position.copy(SUN).multiplyScalar(100); scene.add(sun);
  scene.add(new THREE.AmbientLight(C('#31405a'), .55 * LIGHT_SCALE));
  const sky = new THREE.Group(); scene.add(sky);
  const tint = Array.from({ length: 6 }, () => ({ value: new THREE.Color() }));
  const nebulaU = { uGain: { value: 1 }, uBlue: { value: 0 }, uWash: tint[0], uCloudDark: tint[1], uCloudBright: tint[2] };
  add(new THREE.SphereGeometry(5200, 32, 20), new THREE.ShaderMaterial({ uniforms: nebulaU, side: THREE.BackSide, depthWrite: false, vertexShader: 'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 v;uniform float uGain,uBlue;uniform vec3 uWash,uCloudDark,uCloudBright;${NOISE}void main(){float n=fbm(v*3.4+1.7),m=fbm(v*7.+n*2.);float a=smoothstep(.42,.78,n);vec3 c=mix(uCloudDark,uCloudBright,m)*a+uWash*.5*smoothstep(.3,.7,m);c=mix(c,uWash*(.5+n),uBlue);gl_FragColor=vec4(c*uGain+vec3(.002,.002,.005),1.);}` }), sky);
  {
    const n = 3600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), rnd = seeded('stars'), tint = new THREE.Color();
    for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, a = rnd() * 6.283, r = Math.sqrt(1 - u * u); pos.set([r * Math.cos(a) * 4800, u * 4800, r * Math.sin(a) * 4800], i * 3); tint.setHSL(rnd() > .7 ? .75 : .6, .5, .5 + rnd() * .5).multiplyScalar(.25 + Math.pow(rnd(), 4) * 2.6); col.set([tint.r, tint.g, tint.b], i * 3); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sky.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2.1, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
  }
  const planet = new THREE.Group(); planet.position.set(-640, -150, -1500); sky.add(planet);
  add(new THREE.SphereGeometry(PLANET_R, 64, 44), new THREE.ShaderMaterial({ uniforms: { uSun: { value: SUN }, uLow: tint[3], uHigh: tint[4], uBand: tint[5] }, vertexShader: 'varying vec3 vN,vW,vO;void main(){vO=position/470.;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: `varying vec3 vN,vW,vO;uniform vec3 uSun,uLow,uHigh,uBand;${NOISE}void main(){vec3 N=normalize(vN),V=normalize(cameraPosition-vW);float wob=fbm(vO*vec3(3.,10.,3.))*1.6,b=sin((vO.y*.92+.1)*17.+wob*2.4);
    vec3 c=mix(uLow,uHigh,smoothstep(-.7,.7,b));c=mix(c,uBand,smoothstep(.55,.95,sin(vO.y*6.+wob*1.2)));c=mix(c,vec3(.9,.94,1.),smoothstep(.62,.8,fbm(vO*vec3(5.,22.,5.)+3.))*.7);
    float l=dot(N,uSun),d=smoothstep(-.06,.5,l),rim=pow(1.-max(dot(N,V),0.),3.2);gl_FragColor=vec4(c*d*1.15+uHigh*.7*rim*smoothstep(-.2,.35,l)*1.3,1.);}` }), planet);
  add(new THREE.RingGeometry(PLANET_R * 1.32, PLANET_R * 2.3, 128, 4), new THREE.ShaderMaterial({ uniforms: { uSun: { value: SUN }, uHigh: tint[4] }, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: 'varying float r;varying vec3 vL;void main(){r=length(position.xy)/470.;vL=mat3(modelMatrix)*position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying float r;varying vec3 vL;uniform vec3 uSun,uHigh;float h(float x){return fract(sin(x*91.7)*437.5);}float n1(float x){float i=floor(x),f=fract(x);return mix(h(i),h(i+1.),f);}void main(){float t=(r-1.32)/.98;float d=n1(r*38.)*.55+n1(r*11.)*.45,gap=smoothstep(.42,.45,t)*(1.-smoothstep(.5,.53,t));float a=d*smoothstep(0.,.05,t)*(1.-smoothstep(.93,1.,t))*(1.-gap*.92);
    vec3 p=vL/470.;float along=dot(p,uSun),off=length(p-uSun*along),shadow=along<0.?smoothstep(.97,1.03,off):1.;gl_FragColor=vec4(mix(uHigh*.85,vec3(.92,.95,1.),d)*(.1+.95*shadow),a*.9);}` }), planet, 0, 0, 0, Math.PI / 2 - .22, .1, .32).renderOrder = 2;
  const moon = canvasTexture(canvas(512, 256, (g, w, h) => { const rnd = seeded('moon'); g.fillStyle = '#8a8d94'; g.fillRect(0, 0, w, h); for (let i = 0; i < 180; i++) { const x = rnd() * w, y = rnd() * h, r = 2 + Math.pow(rnd(), 3) * 26; g.fillStyle = rnd() > .5 ? '#696c74' : '#a2a5ac'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }));
  add(new THREE.SphereGeometry(58, 32, 20), new THREE.MeshStandardMaterial({ map: moon, roughness: 1 }), planet, 1120, 410, 80);

  // A short enamel bow, an open lattice boom, tanks and radiators, and a drive ring far out with an arc per station.
  const [hullMap, hullGlow] = hullMaps();
  const hullMat = new THREE.MeshStandardMaterial({ map: hullMap, emissiveMap: hullGlow, emissive: new THREE.Color(1.3, 1.3, 1.3), roughness: .5, metalness: .05, side: THREE.DoubleSide, flatShading: true });
  const ship = new THREE.Group(); scene.add(ship);
  const enamel = (color, emissive = '#000') => STD(color, .42, .05, { side: THREE.DoubleSide, emissive: C(emissive) });
  const stripeMat = enamel('#2a5a9e', '#0a1630'), latticeMat = enamel('#b4bccc', '#10141c'), metal = STD('#9aa4b8', .38, .55);
  const BOW = [{ z: -3, w: 8.5, y: -1.2, h: 3.4 }, { z: -28, w: 8.2, y: -1.2, h: 3.4 }, { z: -50, w: 6.6, y: -1.6, h: 3.2 }, { z: -66, w: 4.2, y: -2, h: 2.6 }, { z: -76, w: 2.2, y: -2.3, h: 1.8 }, { z: -80, w: .7, y: -2.4, h: .9 }];
  add(loft(BOW, [[-1, -.5], [-.8, -.1], [-.45, .1], [0, .16], [.45, .1], [.8, -.1], [1, -.5], [.7, -1], [-.7, -1]]), hullMat, ship);
  const STRIPE = [[-1, 0], [-.5, 1], [.5, 1], [1, 0]], onBow = (x, w) => BOW.slice(0, 5).map(b => ({ z: b.z, x: x * b.w / 8.5, w: w * b.w / 8.5, y: b.y + b.h * (.16 - Math.abs(x) / 8.5 * .13) - .07, h: .16 }));
  add(loft(onBow(0, .55), STRIPE), stripeMat, ship);
  for (const k of [-1, 1]) add(loft(onBow(k * 1.35, .22), STRIPE), stripeMat, ship);
  for (const [x, z, r] of [[-3.5, -32, 1.5], [3.5, -32, 1.5], [0, -60, 1]]) {
    add(new THREE.CylinderGeometry(.1, .14, 1.2, 8), metal, ship, x, -1.4 + (z + 28) * -.018 + .9, z);
    add(new THREE.SphereGeometry(r, 18, 8, 0, 6.283, 2.25, .89), enamel('#eef1f6'), ship, x, -1.4 + (z + 28) * -.018 + .55 + r, z, .35);
  }
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(.2, 10, 8), lit('#eef1ff', 1.6), ship, s * 8.3, -2.8, -22);
  // The boom is one instanced draw for every strut, rising gently so the ring sits in the middle of the window.
  const boomY = z => -2.2 + (-72 - z) * .118, HUB_Z = -206, HUB_Y = boomY(HUB_Z), struts = [];
  const corner = (k, z, r = 1.8) => { const a = k * 2.094 + 1.571; return [Math.cos(a) * r, boomY(z) + Math.sin(a) * r, z]; };
  for (let i = 0; i <= 30; i++) { const z = -72 - i * 4.4; for (let k = 0; k < 3; k++) { struts.push([corner(k, z), corner(k + 1, z), .11]); if (i < 30) { struts.push([corner(k, z), corner(k, z - 4.4), .15]); struts.push([corner(k, z), corner(k + 1, z - 4.4), .08]); } } }
  const tank = canvasTexture(canvas(256, 128, (g, w, h) => { g.fillStyle = '#eef1f6'; g.fillRect(0, 0, w, h); g.fillStyle = '#1450c8'; g.fillRect(0, 50, w, 28); }));
  const tankMat = new THREE.MeshStandardMaterial({ map: tank, roughness: .4, metalness: .05 });
  for (const [z, r] of [[-98, 3.2], [-130, 2.8], [-162, 2.4]]) for (const s of [-1, 1]) { const y = boomY(z); add(new THREE.SphereGeometry(r, 24, 16), tankMat, ship, s * (r + 3.2), y, z); struts.push([[s * 1.4, y, z], [s * 3.4, y, z], .24]); }
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 1.571; struts.push([[0, HUB_Y, HUB_Z], [Math.cos(a) * RING_R, HUB_Y + Math.sin(a) * RING_R, HUB_Z], .42]); }
  {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), latticeMat, struts.length), o = new THREE.Object3D(), A = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    struts.forEach(([a, b, r], i) => { A.set(...a); B.set(...b); o.position.copy(A).lerp(B, .5); o.scale.set(r, A.distanceTo(B), r); o.quaternion.setFromUnitVectors(up, B.sub(A).normalize()); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); });
    mesh.frustumCulled = false; ship.add(mesh);
  }
  add(new THREE.SphereGeometry(2.6, 18, 12), hullMat, ship, 0, HUB_Y, HUB_Z);
  // Radiators swept toward us, so their tips pass close by the side panes.
  const panelMap = canvasTexture(canvas(512, 128, g => { g.fillStyle = '#16244a'; g.fillRect(0, 0, 512, 128); for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { const v = (x * 7 + y * 3) % 5 * 8; g.fillStyle = `rgb(${56 + v / 2},${88 + v / 2},${150 + v / 2})`; g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28); } }));
  const panelMat = STD('#ffffff', .4, .05, { map: panelMap, emissive: C('#0c1014') });
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * 1.6, boomY(-122), -122); g.rotation.y = -s * .52; ship.add(g);
    add(box(46, .3, .3).translate(s * 23, 0, 0), latticeMat, g);
    for (let i = 0; i < 4; i++) add(box(9.5, .16, 6), panelMat, g, s * (5.6 + i * 11.2), 0, 0, .75);
  }
  // A lit arc per station between enamel clamps, and a field across the ring that shows at warp.
  const step = 2 * Math.PI / STATION_ANGLES.length;
  const arcs = STATION_ANGLES.map((_, i) => {
    const m = lit('#000'); add(new THREE.TorusGeometry(RING_R, 1.05, 8, 14, step * .86), m, ship, 0, HUB_Y, HUB_Z, 0, 0, i * step + step * .07 + 1.571);
    add(new THREE.TorusGeometry(RING_R, 1.7, 10, 6, .13), hullMat, ship, 0, HUB_Y, HUB_Z, 0, 0, i * step + 1.571 - .065);
    return m;
  });
  const fieldMap = canvasTexture(canvas(256, 256, (g, w) => { const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128); grad.addColorStop(0, '#223a4a'); grad.addColorStop(.72, '#1c3040'); grad.addColorStop(.97, '#fff'); grad.addColorStop(1, '#000'); g.fillStyle = grad; g.fillRect(0, 0, w, w); }), false);
  const fieldMat = new THREE.MeshBasicMaterial({ color: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: fieldMap });
  add(new THREE.CircleGeometry(RING_R, 64), fieldMat, ship, 0, HUB_Y, HUB_Z).renderOrder = 2;
  // The streaks of warp: long quads running past on both sides, hidden by the hull where they go behind it.
  const streakU = { uT: { value: 0 }, uLen: { value: 1 }, uAlpha: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
  {
    const n = 460, rnd = seeded('streak'), stars = new Float32Array(n * 3), rands = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = rnd() * 6.283, r = 7 + Math.pow(rnd(), .7) * 90; stars.set([Math.cos(a) * r * 1.5, Math.sin(a) * r + 8, rnd() * 620], i * 3); rands[i] = rnd(); }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3)); geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aStar', new THREE.InstancedBufferAttribute(stars, 3)); geometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1)); geometry.instanceCount = n;
    const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms: streakU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aStar;attribute float aRand;uniform float uT,uLen;uniform vec2 uRes;varying float vA;void main(){float z=30.-mod(aStar.z-uT*(.7+.6*aRand)*520.,620.),len=uLen*(.5+aRand);
      vec4 a=viewMatrix*vec4(aStar.xy,z,1.),b=viewMatrix*vec4(aStar.xy,z-len,1.);a.z=min(a.z,-1.);b.z=min(b.z,-1.);vec4 pa=projectionMatrix*a,pb=projectionMatrix*b;
      vec2 d=normalize((pb.xy/pb.w-pa.xy/pa.w)*uRes+vec2(1e-5,0.)),n=vec2(-d.y,d.x);vec4 p=mix(pa,pb,position.y);p.xy+=n*position.x*(.5+aRand*.55)/uRes*2.*p.w;gl_Position=p;
      vA=smoothstep(590.,330.,30.-z)*(1.-position.y*.85)*(.45+aRand*.8);}`,
      fragmentShader: 'varying float vA;uniform float uAlpha;void main(){gl_FragColor=vec4(vec3(.72,.86,1.)*vA*uAlpha*1.7,1.);}' }));
    mesh.frustumCulled = false; mesh.renderOrder = 3; scene.add(mesh);
  }

  let goal = 0, limit = false, warpT = 0, started = false;
  return {
    scene, arcs, warpLevel: 0,
    setMode(state) {
      limit = state.mode === 'limit';
      goal = limit || state.offline || !state.warp ? 0 : Math.min(1, .55 + state.warp * .12);
      if (!started) { started = true; this.warpLevel = goal; }
    },
    repaint(palette) { stripeMat.color.copy(C(palette.console)); palette.space.forEach((hex, i) => tint[i].value.set(hex)); },
    resize(w, h) { streakU.uRes.value.set(w, h); },
    tick(dt) {
      this.warpLevel += (goal - this.warpLevel) * (still ? 1 : 1 - Math.pow(.25, dt));
      const w = this.warpLevel;
      if (!still) warpT += dt * w * w;
      streakU.uT.value = warpT; streakU.uLen.value = 2 + w * w * 95; streakU.uAlpha.value = Math.min(1, Math.max(0, (w - .04) / .3));
      // Slipping into warp, the planet falls away behind the stars; dropping out, it's there again.
      const fall = 1 / (1 + Math.pow(w * 6, 3)); planet.scale.setScalar(fall); planet.visible = fall > .004;
      if (!still) sky.rotation.y += dt * (.0035 + w * .002);
      nebulaU.uGain.value = limit ? .55 : 1 + w * .5; nebulaU.uBlue.value = w * .7;
      fieldMat.color.copy(FIELD).multiplyScalar(limit ? 0 : w * 1.15);
      hullMat.emissive.setScalar(limit ? .25 : 1.25);
    },
  };
}
