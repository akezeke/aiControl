import * as THREE from 'three';
import { CENTER } from './deck.js';

// Bloom, then a gentle tone curve and vignette. The view outside has its own camera, so a far planet doesn't cost the room its depth precision.
const VS = 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}';
const pass = (uniforms, fragmentShader) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader, depthTest: false, depthWrite: false });

export function createPost(renderer) {
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; quadScene.add(quad);
  const spaceCam = new THREE.PerspectiveCamera(62, 1, .5, 7000); spaceCam.rotation.order = 'YXZ';
  const bright = pass({ t: { value: null } }, 'varying vec2 v;uniform sampler2D t;void main(){vec3 c=texture2D(t,v).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.75,1.5,l),1.);}');
  const blur = pass({ t: { value: null }, d: { value: new THREE.Vector2() } }, 'varying vec2 v;uniform sampler2D t;uniform vec2 d;void main(){vec3 c=texture2D(t,v).rgb*.227;c+=(texture2D(t,v+d*1.385).rgb+texture2D(t,v-d*1.385).rgb)*.316;c+=(texture2D(t,v+d*3.231).rgb+texture2D(t,v-d*3.231).rgb)*.07;gl_FragColor=vec4(c,1.);}');
  const final = pass({ t: { value: null }, b: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } }, `varying vec2 v;uniform sampler2D t,b;uniform vec2 uRes;float hash(vec2 p){return fract(sin(dot(p,vec2(12.98,78.23)))*43758.5);}
  void main(){vec3 c=(texture2D(t,v).rgb+texture2D(b,v).rgb*.55)*1.2;c=c/(1.+c*.16);float g=dot(c,vec3(.3,.6,.1));c=mix(vec3(g),c,1.18);c=pow(max(c,0.),vec3(1./2.2));c+=(hash(v*uRes)-.5)*.018;vec2 q=v-.5;c*=1.-dot(q,q)*.3;gl_FragColor=vec4(c,1.);}`);
  const options = { type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const main = new THREE.WebGLRenderTarget(4, 4, { ...options, samples: 4 });
  const a = new THREE.WebGLRenderTarget(4, 4, { ...options, depthBuffer: false }), b = new THREE.WebGLRenderTarget(4, 4, { ...options, depthBuffer: false });
  const blit = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
  return {
    render(roomScene, spaceScene, camera) {
      spaceCam.position.copy(camera.position); spaceCam.position.x -= CENTER; spaceCam.position.z -= CENTER;
      spaceCam.rotation.copy(camera.rotation); spaceCam.fov = camera.fov; spaceCam.aspect = camera.aspect; spaceCam.updateProjectionMatrix();
      renderer.setRenderTarget(main); renderer.clear(); renderer.render(spaceScene, spaceCam); renderer.clearDepth(); renderer.render(roomScene, camera);
      bright.uniforms.t.value = main.texture; blit(bright, a);
      for (let i = 0; i < 2; i++) {
        blur.uniforms.t.value = a.texture; blur.uniforms.d.value.set((1 + i) / a.width, 0); blit(blur, b);
        blur.uniforms.t.value = b.texture; blur.uniforms.d.value.set(0, (1 + i) / a.height); blit(blur, a);
      }
      const u = final.uniforms; u.t.value = main.texture; u.b.value = a.texture;
      blit(final, null);
    },
    // In drawn pixels. Bloom runs at a quarter of that.
    resize(w, h) { main.setSize(w, h); a.setSize(w >> 2, h >> 2); b.setSize(w >> 2, h >> 2); final.uniforms.uRes.value.set(w, h); },
    dispose() { for (const target of [main, a, b]) target.dispose(); for (const material of [bright, blur, final]) material.dispose(); quad.geometry.dispose(); },
  };
}
