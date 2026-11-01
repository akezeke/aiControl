const catalogs = new Map();
const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text != null) node.textContent = text; return node; };

export function agentSettings(session, { api, changed, failed, disabled = false }) {
  const row = element('div', 'agent-settings');
  const model = element('select', 'setting-select model-select'), effort = element('select', 'setting-select effort-select');
  model.setAttribute('aria-label', 'Model'); effort.setAttribute('aria-label', 'Reasoning effort');
  model.title = 'Model · remembered for new sessions'; effort.title = 'Reasoning effort · remembered for new sessions';
  const retry = element('button', 'quiet-button settings-retry', 'Retry'); retry.type = 'button'; retry.hidden = true;
  const error = element('span', 'settings-error'); error.setAttribute('role', 'alert');
  const field = (label, select) => { const node = element('label', 'setting-field'); node.append(element('span', 'setting-label', label), select); return node; };
  row.append(field('Model', model), field('Effort', effort), error, retry);
  let options = [], busy = false, loading = true;
  const option = (value, name) => { const node = element('option', '', name); node.value = value; return node; };
  const paint = () => {
    const current = options.find(item => item.id === session.model) || options.find(item => item.resolvedModel === session.model);
    model.replaceChildren(...options.map(item => option(item.id, item.name)));
    if (!current) model.prepend(option(session.model || '', session.model || (loading ? 'Loading models…' : 'Model unavailable')));
    model.value = current?.id || session.model || '';
    const levels = current?.efforts || session.efforts || [];
    effort.replaceChildren(option('', 'Default effort'), ...levels.map(level => option(level, level)));
    effort.value = levels.includes(session.effort) ? session.effort : '';
    model.disabled = disabled || busy || loading || !options.length || !session.messaging?.model;
    effort.disabled = disabled || busy || loading || !levels.length || !session.messaging?.effort;
    // Providers whose protocol cannot reset effort only offer their supported named levels.
    effort.firstChild.disabled = session.provider !== 'opencode';
  };
  const load = async () => {
    loading = true; retry.hidden = true; error.textContent = ''; paint();
    let entry = catalogs.get(session.id);
    if (!entry || Date.now() - entry.at > 60_000) {
      entry = { at: Date.now(), promise: api(`sessions/${encodeURIComponent(session.id)}/models`).then(result => {
        if (!Array.isArray(result.models)) throw new Error('Model catalog unavailable.'); return result.models;
      }) }; catalogs.set(session.id, entry);
      if (catalogs.size > 100) catalogs.delete(catalogs.keys().next().value);
    }
    try { options = await entry.promise; }
    catch (e) { error.textContent = 'Models unavailable'; error.title = e.message; retry.hidden = false; }
    finally { loading = false; paint(); }
  };
  const update = async (kind, value) => {
    if (busy) return; busy = true; row.dataset.busy = 'true'; paint();
    try {
      const result = await api(`sessions/${encodeURIComponent(session.id)}/${kind}`, { [kind]: value });
      Object.assign(session, { model: result.model || session.model, effort: result.effort ?? session.effort });
      changed(result, kind);
    } catch (e) { failed(e); }
    finally { busy = false; delete row.dataset.busy; paint(); }
  };
  model.onchange = () => update('model', model.value); effort.onchange = () => update('effort', effort.value);
  retry.onclick = () => { catalogs.delete(session.id); load(); };
  load(); return row;
}
