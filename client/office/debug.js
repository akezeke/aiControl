// The office's debug view, F3, kept on or off per browser: frames a second and the longest gap between two, the CPU time a
// frame's updates and its render take, what the GPU was asked to draw, and the per-frame jobs that took longest (each by its
// name, or the start of its code). The CPU times are only the frame's: with them well under 16 ms and the frame rate still
// short of 60, the GPU (or the page's layout and style) is what's slow. Copy puts all of it on the clipboard (over plain
// http, where there's no clipboard API, by the old copy command). Rec keeps every refresh till Stop, which copies the lot: a
// summary (which GPU, the frame rate's average and low, the worst gap, each part's average and worst) and a line a refresh.
// A meeting's messages are timed too, by type ("msg pos"), though they're handled between frames.
// Off, a frame is just its jobs and the render.
import { copyText } from './boards.js';

const KEY = 'ai-control-office-debug', EVERY = 500, TOP = 8, KEEP = 1200; // ms between refreshes; jobs listed; refreshes kept recording (10 min)

export function createDebug(container, renderer, render) {
  const el = document.createElement('div'), text = document.createElement('pre'), tools = document.createElement('span');
  const button = label => { const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.textContent = label; b.onmousedown = event => event.preventDefault(); tools.append(b); return b; };
  const rec = button('Rec'), copy = button('Copy');
  el.className = 'office-debug'; tools.className = 'tools'; el.append(text, tools);
  let on = false; try { on = localStorage.getItem(KEY) === '1'; } catch { /* no storage here */ }
  el.hidden = !on; container.append(el);
  // The office keeps the keys: pressing a button doesn't take the focus.
  let copied = 0;
  const put = (value, b, label) => {
    const done = () => { b.textContent = 'Copied'; clearTimeout(copied); copied = setTimeout(() => { b.textContent = label; }, 1200); };
    copyText(value, done, () => { const area = document.createElement('textarea'); area.value = value; el.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); if (ok) done(); });
  };
  copy.onclick = () => put(text.textContent, copy, 'Copy');
  let tape = null, taped = 0; // the refreshes recorded, and when it started; null when not recording
  rec.onclick = () => { if (tape) { rec.textContent = 'Rec'; put(report(tape, (performance.now() - taped) / 1000), rec, 'Rec'); tape = null; } else { tape = []; taped = performance.now(); rec.textContent = 'Stop 0s'; } };
  const spent = new Map(); // job → ms since the last refresh
  let count = 0, from = performance.now(), prev = from, worst = 0, update = 0, draw = 0;
  const reset = t => { spent.clear(); count = 0; from = prev = t; worst = update = draw = 0; };
  const label = fn => typeof fn === 'string' ? fn : fn.name || String(fn).replace(/\s+/g, ' ').slice(0, 52);
  const ms = (v, n) => (v / n).toFixed(2).padStart(6);
  function show(t) {
    const { render: r, memory, programs } = renderer.info, c = renderer.domElement, parts = [...spent].sort((a, b) => b[1] - a[1]);
    text.textContent = [
      `${(count * 1000 / (t - from)).toFixed(0)} fps · longest gap ${worst.toFixed(0)} ms`,
      `CPU ${ms(update, count)} update · ${ms(draw, count).trim()} render ms`,
      `${r.calls} draw calls · ${(r.triangles / 1000).toFixed(0)}k triangles`,
      `${memory.geometries} geometries · ${memory.textures} textures · ${programs?.length ?? 0} shaders`,
      `${c.width}×${c.height} at ${renderer.getPixelRatio()}×`,
      ...parts.slice(0, TOP).map(([fn, v]) => `${ms(v, count)}  ${label(fn)}`),
    ].join('\n');
    if (tape) {
      tape.push({ at: (t - taped) / 1000, fps: count * 1000 / (t - from), gap: worst, update: update / count, draw: draw / count, calls: r.calls, tris: r.triangles, parts: parts.map(([fn, v]) => [label(fn), v / count]) });
      if (tape.length > KEEP) tape.shift();
      rec.textContent = `Stop ${((t - taped) / 1000).toFixed(0)}s`;
    }
    reset(t);
  }
  // The recording as text: what it ran on, a summary, then a line a refresh with its three slowest parts.
  function report(tape, secs) {
    if (!tape.length) return 'Nothing recorded: the debug view was off.';
    const n = tape.length, sum = k => tape.reduce((a, s) => a + s[k], 0), top = k => Math.max(...tape.map(s => s[k]));
    const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2), short = name => name.length > 28 ? `${name.slice(0, 27)}…` : name;
    const parts = new Map(); for (const s of tape) for (const [name, v] of s.parts) { const p = parts.get(name) ?? parts.set(name, { sum: 0, max: 0 }).get(name); p.sum += v; p.max = Math.max(p.max, v); }
    const gl = renderer.getContext(), named = gl.getExtension('WEBGL_debug_renderer_info'), c = renderer.domElement;
    return [
      `Office debug recording: ${f1(secs)} s, a line every ${EVERY} ms${n === KEEP ? ` (the last ${n})` : ''} · ${gl.getParameter(named ? named.UNMASKED_RENDERER_WEBGL : gl.RENDERER)} · ${c.width}×${c.height} at ${renderer.getPixelRatio()}× · ${navigator.userAgent}`,
      `fps average ${f1(sum('fps') / n)}, lowest ${f1(Math.min(...tape.map(s => s.fps)))} · longest gap ${top('gap').toFixed(0)} ms · CPU ms a frame, average/worst: update ${f2(sum('update') / n)}/${f2(top('update'))}, render ${f2(sum('draw') / n)}/${f2(top('draw'))} · draw calls up to ${top('calls')}, triangles up to ${(top('tris') / 1000).toFixed(0)}k`,
      `Parts, ms a frame, average/worst: ${[...parts].sort((a, b) => b[1].sum - a[1].sum).map(([name, p]) => `${short(name)} ${f2(p.sum / n)}/${f2(p.max)}`).join(' · ')}`,
      '',
      ...tape.map(s => `${f1(s.at).padStart(6)}s ${s.fps.toFixed(0).padStart(3)} fps  gap ${s.gap.toFixed(0).padStart(4)}  cpu ${f2(s.update)}+${f2(s.draw)}  ${s.calls} calls ${(s.tris / 1000).toFixed(0)}k  | ${s.parts.slice(0, 3).map(([name, v]) => `${short(name)} ${f2(v)}`).join(' · ')}`),
    ].join('\n');
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
    // Each handler `live.on` is given (live.js), timed as "msg <type>": a meeting's messages, between frames.
    messages(live) {
      const listen = live.on;
      live.on = (type, fn) => listen(type, m => {
        if (!on) return fn(m);
        const t = performance.now(), name = `msg ${type}`; fn(m); spent.set(name, (spent.get(name) || 0) + performance.now() - t);
      });
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
    dispose() { document.removeEventListener('keydown', key); clearTimeout(copied); el.remove(); },
  };
}
