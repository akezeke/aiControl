// The Office theme: a 3D office where each session is a fruit at a desk. main.js mounts it in place of the list.
import * as THREE from 'three';
import './office.css';

export function webglAvailable() {
  try { const canvas = document.createElement('canvas'); return !!(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; }
}

export function mountOffice(container, hooks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6e7c8');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.position.set(0, 1.5, 6);
  scene.add(new THREE.HemisphereLight('#fff6e0', '#b8a68a', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(4, 8, 3); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshToonMaterial({ color: '#e9c896' }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  const frames = new Set();
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  let raf = 0, last = performance.now();
  const loop = now => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const fn of frames) fn(dt, now);
    renderer.render(scene, office.camera);
  };
  // Nothing renders while the tab is hidden; polling stops then too.
  const visibility = () => { cancelAnimationFrame(raf); raf = 0; if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', visibility); visibility();

  const office = {
    scene, renderer, camera, hooks, container,
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    update(snapshot, { error = '' } = {}) { office.snapshot = snapshot; office.error = error; },
    unmount() {
      cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
      for (const fn of office.disposers) fn();
      scene.traverse(object => {
        object.geometry?.dispose();
        for (const material of [object.material].flat().filter(Boolean)) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); }
      });
      renderer.dispose(); renderer.domElement.remove();
    },
    disposers: [],
  };
  return office;
}
