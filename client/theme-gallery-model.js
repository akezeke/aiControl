const groupId = theme => theme.node ? 'nodes' : /^modern(?:-|$)/.test(theme.id) ? 'modern' : theme.id;
export function groupThemes(themes, current, favourites = []) {
  const groups = new Map();
  for (const theme of themes) {
    const id = groupId(theme);
    if (!groups.has(id)) groups.set(id, { id, name: id === 'modern' ? 'Orbit' : id === 'nodes' ? 'Nodes' : theme.name, variants: [] });
    groups.get(id).variants.push(theme);
  }
  return [...groups.values()].map(group => ({ ...group, choice: group.variants.find(theme => theme.id === current) || group.variants[0], selected: group.variants.some(theme => theme.id === current), favourite: favourites.includes(group.id) }))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite));
}

const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
export function createThemeFavourites(themes, storage = browserStorage()) {
  const key = 'ai-control-theme-favourites', groups = new Map(themes.map(theme => [theme.id, groupId(theme)]));
  let favourites = [];
  try { const raw = JSON.parse(storage?.getItem(key) || '[]'); if (Array.isArray(raw)) favourites = [...new Set(raw.map(id => groups.get(id)).filter(Boolean))]; } catch { /* Keep favourites for this tab. */ }
  return {
    list: () => [...favourites],
    toggle(choice) {
      const id = groups.get(choice); if (!id) return;
      favourites = favourites.includes(id) ? favourites.filter(value => value !== id) : [...favourites, id];
      try { storage?.setItem(key, JSON.stringify(favourites)); } catch { /* Storage is optional. */ }
    },
  };
}
