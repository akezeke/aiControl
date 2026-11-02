// Starts and stops the 3D build of Brick Knights, loading three.js only when the theme is picked: one canvas behind the page, and one behind the chat
// panel (which sits above the page and has regions that scroll). Without WebGL the CSS falls back to flat boxes.
let page, panel, canvases = [], watcher, ticket = 0, modules;

async function load() { return modules ??= Promise.all([import('./layer.js'), import('./ui.js')]).then(([layer, ui]) => ({ ...layer, ...ui })); }

async function mountPanel(mine) {
  const el = document.querySelector('#panel'); if (!el || panel) return;
  const { BrickLayer, BrickUi, PANEL } = await load(); if (mine !== ticket || panel) return;
  const canvas = document.createElement('canvas'); canvas.id = 'brick-panel'; canvas.setAttribute('aria-hidden', 'true'); el.before(canvas); canvases.push(canvas);
  panel = new BrickUi(new BrickLayer(canvas), PANEL, el);
}

export async function setBrickUi(on) {
  const mine = ++ticket, root = document.documentElement;
  if (!on) {
    watcher?.disconnect(); watcher = undefined; page?.dispose(); panel?.dispose(); page = panel = undefined; for (const canvas of canvases) canvas.remove(); canvases = []; root.removeAttribute('data-bricks3d'); return;
  }
  if (page) return;
  try {
    const { webglAvailable, BrickLayer, BrickUi, PAGE } = await load();
    if (mine !== ticket || page || !webglAvailable()) return;
    const canvas = document.createElement('canvas'); canvas.id = 'brick-ui'; canvas.setAttribute('aria-hidden', 'true'); document.body.prepend(canvas); canvases.push(canvas);
    page = new BrickUi(new BrickLayer(canvas), PAGE, document.body); root.dataset.bricks3d = '';
    // The panel is built once the signed-in screen exists.
    mountPanel(mine).catch(() => {});
    if (!panel) { watcher = new MutationObserver(() => { if (document.querySelector('#panel')) { watcher.disconnect(); watcher = undefined; mountPanel(mine).catch(() => {}); } }); watcher.observe(document.body, { childList: true, subtree: true }); }
  } catch (error) { console.warn('Brick Knights falls back to flat boxes:', error); for (const canvas of canvases) canvas.remove(); canvases = []; page = panel = undefined; }
}
