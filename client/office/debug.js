// The office's debug view, F3, kept on or off per browser: frames a second and the longest gap between two, the CPU time a
// frame's updates and its render take, what the GPU was asked to draw, and the per-frame jobs that took longest (each by its
// name, or the start of its code). The CPU times are only the frame's: with them well under 16 ms and the frame rate still
// short of 60, the GPU (or the page's layout and style) is what's slow. Off, a frame is just its jobs and the render.
const KEY = 'ai-control-office-debug', EVERY = 500, TOP = 8; // ms between refreshes; jobs listed

export function createDebug(container, renderer, render) {
  const el = document.createElement('pre'); el.className = 'office-debug';
  let on = false; try { on = localStorage.getItem(KEY) === '1'; } catch { /* no storage here */ }
  el.hidden = !on; container.append(el);
  const spent = new Map(); // job → ms since the last refresh
  let count = 0, from = performance.now(), prev = from, worst = 0, update = 0, draw = 0;
  const reset = t => { spent.clear(); count = 0; from = prev = t; worst = update = draw = 0; };
  const label = fn => typeof fn === 'string' ? fn : fn.name || String(fn).replace(/\s+/g, ' ').slice(0, 52);
  const ms = (v, n) => (v / n).toFixed(2).padStart(6);
  function show(t) {
    const { render: r, memory, programs } = renderer.info, c = renderer.domElement;
    el.textContent = [
      `${(count * 1000 / (t - from)).toFixed(0)} fps · longest gap ${worst.toFixed(0)} ms`,
      `CPU ${ms(update, count)} update · ${ms(draw, count).trim()} render ms`,
      `${r.calls} draw calls · ${(r.triangles / 1000).toFixed(0)}k triangles`,
      `${memory.geometries} geometries · ${memory.textures} textures · ${programs?.length ?? 0} shaders`,
      `${c.width}×${c.height} at ${renderer.getPixelRatio()}×`,
      ...[...spent].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([fn, v]) => `${ms(v, count)}  ${label(fn)}`),
    ].join('\n');
    reset(t);
  }
  const key = event => {
    if (event.code !== 'F3' || event.repeat) return;
    event.preventDefault(); on = !on; el.hidden = !on; reset(performance.now());
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* no storage here */ }
  };
  document.addEventListener('keydown', key);

  return {
    // Each part's `update` (and `tick`) timed under its name too, while the view's on: the jobs call most of them.
    watch(parts) {
      for (const [name, part] of Object.entries(parts)) for (const method of ['update', 'tick']) {
        const fn = part?.[method]; if (typeof fn !== 'function') continue;
        part[method] = (a, b, c, d, e, f) => {
          if (!on) return fn.call(part, a, b, c, d, e, f);
          const t = performance.now(), out = fn.call(part, a, b, c, d, e, f);
          spent.set(name, (spent.get(name) || 0) + performance.now() - t); return out;
        };
      }
    },
    // One frame: each job, then the render.
    frame(jobs, dt, now) {
      if (!on) { for (const fn of jobs) fn(dt, now); render(); return; }
      const t0 = performance.now();
      for (const fn of jobs) { const a = performance.now(); fn(dt, now); spent.set(fn, (spent.get(fn) || 0) + performance.now() - a); }
      const t1 = performance.now(); render(); const t2 = performance.now();
      count++; update += t1 - t0; draw += t2 - t1; worst = Math.max(worst, t0 - prev); prev = t0;
      if (t2 - from >= EVERY) show(t2);
    },
    dispose() { document.removeEventListener('keydown', key); el.remove(); },
  };
}
