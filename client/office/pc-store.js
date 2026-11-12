// The boss PC's saved desktop, as the client holds it: the last server reply plus the ops still in flight, applied as previews.
// The server's reply always wins, so a preview is only a best guess and never validates.
import { recentCarts, CARTS_KEY } from './carts.js';
import { defaults, GRID } from './pc-windows.js';

export const EMPTY_DESKTOP = { version: 1, icons: [], spots: { browser: [0, 0], salaries: [0, 1] }, ...defaults(), imported: true };
const BUILTINS = ['browser', 'salaries'];

// Never throws: anything it can't make sense of leaves the desktop as it was.
export function preview(desktop, op) {
  try { return guess(structuredClone(desktop), op); } catch { return desktop; }
}

function guess(d, op) {
  switch (op?.op) {
    case 'remove':
      if (BUILTINS.includes(op.id)) return d;
      d.icons = d.icons.filter(i => i.id !== op.id); delete d.spots[op.id]; return d;
    case 'rename': {
      const icon = d.icons.find(i => i.id === op.id);
      if (icon) icon.name = String(op.name ?? '').trim();
      return d;
    }
    case 'move': if (Array.isArray(op.spot)) d.spots[op.id] = [...op.spot]; return d;
    case 'arrange': { // column by column from the top left, built-ins first
      const ids = [...BUILTINS, ...d.icons.map(i => i.id)];
      d.spots = Object.fromEntries(ids.map((id, n) => [id, [Math.floor(n / GRID.rows), n % GRID.rows]]));
      return d;
    }
    case 'windows': if (op.windows && op.order) { d.windows = structuredClone(op.windows); d.order = [...op.order]; } return d;
    default: return d; // add and import need the server (ids, cart info)
  }
}

export function createPcStore({ api, storage, onChange, onError }) {
  let base = EMPTY_DESKTOP, ready = false, loading = null, lastError = 'Desktop unavailable.';
  const queued = []; // ops sent or waiting, oldest first
  const view = () => queued.reduce(preview, base);
  const say = (fn, ...args) => { try { fn(...args); } catch { /* a broken callback must not break the queue */ } };
  const fail = e => { lastError = e?.message || 'Desktop unavailable.'; return false; };

  async function first() {
    try { base = await api('office/pc'); } catch (e) { return fail(e); }
    const recent = recentCarts(storage);
    if (!base.imported && recent.length) {
      try {
        base = await api('office/pc', { op: 'import', pids: [...recent].reverse() });
        try { storage?.removeItem(CARTS_KEY); } catch { /* stays; the server ignores a second import */ }
      } catch { /* the list stays in storage */ }
    }
    ready = true; // only once the import settled, so nothing is sent while it is in flight
    say(onChange, view());
    return true;
  }
  const load = () => ready ? Promise.resolve(true) : loading ??= first().finally(() => { loading = null; });

  let tail = Promise.resolve();
  function apply(op) {
    queued.push(op); say(onChange, view());
    const drop = () => { const at = queued.indexOf(op); if (at >= 0) queued.splice(at, 1); };
    const run = async () => {
      let error = null;
      try {
        if (!await load()) throw new Error(lastError);
        base = await api('office/pc', op);
      } catch (e) { error = e?.message || 'Desktop unavailable.'; }
      drop(); say(onChange, view());
      if (error !== null) { say(onError, error); return null; }
      return view();
    };
    return tail = tail.then(run);
  }

  return { load, apply, desktop: view, loaded: () => ready };
}
