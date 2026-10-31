// Getting the renderer ready between frames: each next() is a slice, and what it yields is to be waited for.

// Shaders only where the browser can say they're finished without being asked outright. Elsewhere a program's first use blocks till its link is done, up
// to a second each on software GL, and that's better at the doors, when you're going in, than in the middle of a walk that may never get there.
export function* shaders(renderer, root, camera, scene) {
  if (!renderer.extensions.has('KHR_parallel_shader_compile')) return;
  const known = new Set(renderer.info.programs);
  yield renderer.compileAsync(root, camera, scene);
  for (const program of renderer.info.programs) if (!known.has(program)) { program.getUniforms(); program.getAttributes(); yield; }
}

// Each texture under `root` the renderer has never seen. One it has is left to whoever draws on it (a board mid-redraw, screens.js's pages, which it sets up itself);
// a version of 0 has no picture yet. A shader's own are in its uniforms (windows.js).
export function* textures(renderer, root) {
  const maps = new Set();
  root.traverse(node => { for (const material of [node.material].flat()) for (const value of [...Object.values(material ?? {}), ...Object.values(material?.uniforms ?? {}).map(uniform => uniform.value)]) if (value?.isTexture) maps.add(value); });
  for (const map of maps) if (map.version > 0 && !renderer.properties.has(map)) { renderer.initTexture(map); yield; }
}

// Runs `steps` a slice per whenIdle, starting once the office is up and has drawn `after` frames, and not after stopped().
export function inSlices(frames, steps, { whenIdle, stopped, up, after = 10 }) {
  let left = after;
  const slice = async () => { if (stopped()) return; const { done, value } = steps.next(); await value; if (!done) whenIdle(slice); };
  const drawn = () => { if (up() && !--left) { frames.delete(drawn); whenIdle(slice); } };
  frames.add(drawn);
}
