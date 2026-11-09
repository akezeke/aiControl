const key = 'ai-control-atmosphere';
export const atmosphereLevels = ['still', 'subtle', 'full'];
const valid = value => atmosphereLevels.includes(value);
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

// Each choice keeps its own preference; OS reduced motion changes the effective value only.
export function createAtmosphere({ storage = browserStorage() } = {}) {
  let saved = {}, theme = '', reduced = false;
  try { const raw = JSON.parse(storage?.getItem(key) || '{}'); if (raw && !Array.isArray(raw) && typeof raw === 'object') saved = Object.fromEntries(Object.entries(raw).filter(([, value]) => valid(value))); } catch { /* Keep tab-local preferences when storage is blocked or malformed. */ }
  const listeners = new Set();
  const preference = () => valid(saved[theme]) ? saved[theme] : 'full';
  const effective = () => reduced ? 'still' : preference();
  const change = action => { const before = effective(), wasReduced = reduced; action(); if (effective() !== before || reduced !== wasReduced) for (const listener of listeners) listener(effective()); };
  return {
    selectTheme(id) { change(() => { theme = id; }); },
    preference, effective,
    set(value) {
      if (!valid(value) || !theme) return;
      change(() => { saved = { ...saved, [theme]: value }; });
      try { storage?.setItem(key, JSON.stringify(saved)); } catch { /* Keep the selection for this tab. */ }
    },
    reduce(on) { change(() => { reduced = !!on; }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

const atmosphere = createAtmosphere();
const systemMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
export const atmospherePreference = () => atmosphere.preference();
export const effectiveAtmosphere = () => atmosphere.effective();
export const reducedAtmosphere = () => effectiveAtmosphere() === 'still';
export const atmosphereScale = () => ({ still: 0, subtle: .35, full: 1 })[effectiveAtmosphere()];
export const onAtmosphereChange = listener => atmosphere.subscribe(listener);
export const systemReducedMotion = () => !!systemMotion?.matches;
const syncRoot = () => {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset.atmosphere = effectiveAtmosphere();
  root.dataset.atmospherePreference = atmospherePreference();
};
export function selectThemeAtmosphere(id) { atmosphere.selectTheme(id); syncRoot(); }
export function setAtmosphere(value) { atmosphere.set(value); syncRoot(); }
atmosphere.subscribe(syncRoot);
atmosphere.reduce(systemReducedMotion());
systemMotion?.addEventListener?.('change', () => { atmosphere.reduce(systemReducedMotion()); syncRoot(); });
