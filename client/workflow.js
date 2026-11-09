import { DraftSync, needsReview, reviewStamp, lastObservedActivity, quietSession, handoffText } from './workflow-data.js';
import { setNotificationPolicy } from './alerts.js';

const node = (tag, cls = '', text) => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
const action = (label, run, title = label) => { const b = node('button', 'quiet-button', label); b.type = 'button'; b.title = title; b.onclick = run; return b; };
const field = (label, value = '', type = 'text') => { const wrap = node('label', 'wf-field'), input = node(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type; input.value = value; input.setAttribute('aria-label', label); wrap.append(node('span', '', label), input); return { wrap, input }; };
const select = (label, choices, value = '') => { const wrap = node('label', 'wf-field'), input = node('select'); input.setAttribute('aria-label', label); for (const [id, name] of choices) { const opt = node('option', '', name); opt.value = id; input.append(opt); } input.value = value; wrap.append(node('span', '', label), input); return { wrap, input }; };
const emptyWorkspace = () => ({ version: -1, sessions: {}, drafts: {}, views: {}, snippets: {}, presets: {}, preferences: {} });
const id = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const date = value => value ? new Date(value).toLocaleString() : 'Not observed';

export class Workflow {
  constructor(options) {
    Object.assign(this, options); this.saved = emptyWorkspace(); this.timers = new Map(); this.dialogs = new Set(); this.epoch = 0;
    this.drafts = new DraftSync(async (key, text, baseRevision) => {
      const saved = await this.patch('drafts', key, { text }, baseRevision);
      return saved.drafts[key];
    });
    try { this.shortcuts = localStorage.getItem('ai-control-shortcuts') !== 'off'; } catch { this.shortcuts = true; }
    document.addEventListener('keydown', event => {
      if (!this.getState().csrf) return;
      if (event.key === '?' && this.shortcuts && !event.target.closest?.('input,textarea,select,[contenteditable]') && !document.querySelector('dialog[open]')) { event.preventDefault(); this.settings(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushDrafts(); });
    window.addEventListener('pagehide', () => this.flushDrafts());
    window.addEventListener('message', event => {
      if (event.origin !== location.origin) return;
      const ownFrame = event.source === this.splitFrame?.contentWindow, parentFrame = window.parent !== window && event.source === window.parent;
      if (ownFrame && event.data?.type === 'ai-control-close-pane') this.closeSplit();
      if ((ownFrame || parentFrame) && event.data?.type === 'ai-control-pane-activity') this.onPaneActivity?.();
    });
  }
  activity() {
    if (Date.now() - (this.lastActivityBroadcast || 0) < 1000) return;
    this.lastActivityBroadcast = Date.now();
    if (window.parent !== window) window.parent.postMessage({ type: 'ai-control-pane-activity' }, location.origin);
    this.splitFrame?.contentWindow.postMessage({ type: 'ai-control-pane-activity' }, location.origin);
  }
  sessions() { return this.getState().snapshot?.sessions || []; }
  meta(session) { return this.saved.sessions[session.id] || {}; }
  title(session) { return this.meta(session).alias || session.originalTitle || session.title; }
  review(session) { return needsReview(session, this.meta(session)); }
  async patch(section, key, value, baseRevision) {
    const epoch = this.epoch;
    const result = await this.api('workspace', { section, key, value, ...(baseRevision != null ? { baseRevision } : {}) }, section === 'drafts' ? { keepalive: true } : {});
    if (epoch === this.epoch) { this.adopt(result); this.changed(); } return result;
  }
  adopt(saved) {
    if (!saved || (saved.version ?? 0) < (this.saved.version ?? 0)) return;
    this.saved = { ...emptyWorkspace(), ...saved }; this.drafts.adopt(this.saved.drafts);
    setNotificationPolicy(this.saved.preferences.notifications || {});
  }
  async load() { const epoch = this.epoch; try { const saved = await this.api('workspace'); if (epoch === this.epoch) { this.adopt(saved); this.changed(); } } catch (error) { if (epoch === this.epoch) this.toast(error.message); } }
  async patchSafe(...args) { try { return await this.patch(...args); } catch (error) { this.toast(error.message); return null; } }
  draft(id) { return this.drafts.get(id); }
  editDraft(id, text) {
    this.drafts.edit(id, text); clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.drafts.flush(id).then(() => this.draftFeedback?.()); }, 300));
  }
  async flushDrafts() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); await this.drafts.flushAll(); }
  async clearDraft(id) {
    this.editDraft(id, ''); await this.drafts.flush(id);
    const draft = this.draft(id);
    if (draft.saveError) {
      // Sending acknowledged one revision. A newer draft on another device stays intact.
      try {
        const latest = await this.api('workspace'), remote = latest.drafts[id];
        if (remote && remote.revision > draft.remoteRevision) {
          Object.assign(draft, { text: remote.text, remoteRevision: remote.revision, dirty: false, saveError: '' }); draft.revision++;
          this.adopt(latest);
        }
      } catch { /* Show the save error; never retry or resend the acknowledged message. */ }
    }
  }
  reset() { this.epoch++; for (const dialog of this.dialogs) dialog.close(); this.dialogs.clear(); this.closeSplit(); this.saved = emptyWorkspace(); this.drafts.entries.clear(); for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }
  async putDraft(session, text) {
    const draft = this.draft(session.id);
    if (draft.text.trim()) text = `${draft.text}\n\n${text}`;
    if (text.length > 12000) throw new Error('Draft exceeds 12,000 characters. Shorten the selection.');
    this.editDraft(session.id, text); draft.revision++; await this.drafts.flush(session.id);
    if (draft.saveError) throw new Error(draft.saveError);
    this.openSession(session.id); this.changed();
  }
  dialog(title, { wide = false } = {}) {
    const dialog = node('dialog', `wf-dialog${wide ? ' wf-wide' : ''}`), header = node('header', 'wf-heading'), body = node('div', 'wf-body'), error = node('p', 'form-error');
    error.setAttribute('role', 'alert');
    const close = action('×', () => dialog.close(), 'Close'); close.setAttribute('aria-label', 'Close');
    const heading = node('h2', '', title); heading.id = `wf-${id()}`; dialog.setAttribute('aria-labelledby', heading.id); header.append(heading, close); dialog.append(header, error, body);
    const previous = document.activeElement;
    dialog.addEventListener('close', () => { this.dialogs.delete(dialog); dialog.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); });
    dialog.run = async (fn, button) => { if (button) button.disabled = true; error.textContent = ''; try { return await fn(); } catch (e) { error.textContent = e.message; } finally { if (button?.isConnected) button.disabled = false; } };
    document.body.append(dialog); this.dialogs.add(dialog); dialog.showModal(); return { dialog, body, error };
  }
  mount(toolbar) {
    toolbar.append(action('Inbox', () => this.inbox()), action('Review', () => this.reviewQueue()), action('Workspace', () => this.menu()));
  }
  update() {
    const snapshot = this.getState().snapshot;
    if (snapshot?.workspace) this.adopt(snapshot.workspace);
    this.inboxUpdate?.();
    this.reviewUpdate?.();
  }
  header(container, session) {
    const row = node('div', 'wf-session-actions');
    row.append(action(this.meta(session).pinned ? '★' : '☆', () => this.patchSafe('sessions', session.id, { pinned: !this.meta(session).pinned }), 'Pin session'), action('Rename', () => this.rename(session)));
    if (this.review(session)) row.append(action('Reviewed ✓', async () => { await this.patchSafe('sessions', session.id, { reviewedThrough: reviewStamp(session) }); }, 'Mark this completion reviewed'));
    row.append(action('Changes', () => this.repository(session)), action('Handoff', () => this.handoff(session)), action('Decisions', () => this.decisions(session.id)));
    if (!new URLSearchParams(location.search).has('pane')) row.append(action('Split', () => this.split(session)));
    const quiet = quietSession(session, Number(this.saved.preferences.quietMinutes ?? 15));
    if (quiet) { const info = node('span', 'wf-quiet', `No activity · ${Math.floor((Date.now() - lastObservedActivity(session)) / 60000)}m`); info.title = `Last observed event: ${date(lastObservedActivity(session))}`; row.append(info); }
    const overlaps = (this.getState().snapshot?.overlaps || []).filter(o => o.sessionIds.includes(session.id));
    if (overlaps.length) row.append(action(`Edits overlap · ${overlaps.length}`, () => this.overlaps(session), overlaps.map(o => o.path).join('\n')));
    container.append(row);
  }
  composer(container, session, insert) {
    const row = node('div', 'wf-composer-tools'); row.append(action('Snippets', () => this.snippets(text => insert(text))), action('Presets', () => this.presets(session)));
    const state = node('span', 'wf-draft-state'), resolve = action('Resolve draft', () => this.resolveDraft(session)); row.append(state, resolve); container.prepend(row);
    row.sync = () => { const draft = this.draft(session.id); state.textContent = draft.saveError || (draft.dirty || draft.saving ? 'Saving draft…' : ''); state.classList.toggle('form-error', !!draft.saveError); resolve.hidden = !draft.saveError; };
    row.sync(); return row;
  }
  async resolveDraft(session) {
    const { dialog, body } = this.dialog('Draft conflict'), draft = this.draft(session.id);
    await dialog.run(async () => {
      const saved = await this.api('workspace'), remote = saved.drafts[session.id] || { text: '', revision: 0 }, local = field('This device', draft.text, 'textarea'), other = field('Saved draft', remote.text, 'textarea');
      other.input.readOnly = true;
      const keep = action('Save this device', () => dialog.run(async () => { draft.remoteRevision = remote.revision; draft.text = local.input.value; draft.dirty = true; draft.revision++; await this.drafts.flush(session.id); if (draft.saveError) throw new Error(draft.saveError); dialog.close(); this.changed(); }, keep));
      body.append(local.wrap, other.wrap, keep, action('Use saved draft', () => { draft.text = remote.text; draft.remoteRevision = remote.revision; draft.dirty = false; draft.saveError = ''; draft.revision++; dialog.close(); this.changed(); }));
    });
  }
  rename(session) {
    const { dialog, body } = this.dialog('Session name'), name = field('Name', this.meta(session).alias || ''); name.input.maxLength = 160;
    const save = action('Save', () => dialog.run(async () => { await this.patch('sessions', session.id, { alias: name.input.value.trim() }); dialog.close(); }, save));
    body.append(name.wrap, save); name.input.focus();
  }
  menu() {
    const { dialog, body } = this.dialog('Workspace');
    const items = [['Search history', () => this.search()], ['Saved views', () => this.views()], ['Prompt snippets', () => this.snippets()], ['Launch presets', () => this.presets()], ['Decisions', () => this.decisions()], ['Connections', () => this.health()], ['Preferences', () => this.settings()]];
    body.classList.add('wf-menu'); for (const [label, run] of items) body.append(action(label, () => { dialog.close(); run(); }));
  }
  commands() {
    return [
      ['inbox', 'Answer inbox', () => this.inbox()], ['review', 'Ready to review', () => this.reviewQueue()],
      ['history', 'Search history', () => this.search()], ['views', 'Saved views', () => this.views()],
      ['presets', 'Launch presets', () => this.presets()], ['snippets', 'Prompt snippets', () => this.snippets()],
      ['health', 'Connections', () => this.health()], ['preferences', 'Preferences and shortcuts', () => this.settings()],
      ['decisions', 'Decision history', () => this.decisions()],
      ...Object.entries(this.saved.views).map(([key, view]) => [`view-${key}`, `View: ${view.name}`, () => this.applyView(view)]),
      ...this.sessions().filter(s => s.id === this.getState().selected).flatMap(s => [
        ['changes', 'Repository changes', () => this.repository(s)], ['handoff', 'Prepare handoff', () => this.handoff(s)],
        ['model', 'Model and effort', () => { const details = document.querySelector('.chat-info'); if (details) { details.open = true; details.querySelector('select,button')?.focus(); } }],
      ]),
    ].map(([key, label, run]) => ({ id: `workflow:${key}`, label, run }));
  }
  inbox() {
    const { dialog, body } = this.dialog('Needs you', { wide: true }); let signature = '', current;
    const render = () => {
      const sessions = this.sessions().filter(s => ['permission', 'question'].includes(s.status)).sort((a, b) => (a.requests?.[0]?.createdAt || a.statusSince || 0) - (b.requests?.[0]?.createdAt || b.statusSince || 0));
      const session = sessions.find(s => s.id === current) || sessions[0]; current = session?.id;
      const nextSignature = JSON.stringify([current, session?.requests?.map(({ sending, ...request }) => request), session?.asks]);
      const tabsSignature = JSON.stringify(sessions.map(s => [s.id, this.title(s), s.id === current]));
      const updateTabs = tabs => {
        if (tabs.dataset.signature === tabsSignature) return;
        tabs.dataset.signature = tabsSignature; tabs.replaceChildren();
        for (const s of sessions) { const b = action(this.title(s), () => { current = s.id; signature = ''; render(); }); b.setAttribute('aria-pressed', String(s.id === current)); tabs.append(b); }
      };
      if (signature === nextSignature) {
        const tabs = body.querySelector('.wf-tabs'); if (tabs) updateTabs(tabs);
        for (const [index, box] of [...body.querySelectorAll('.request-box')].entries()) if (!box.matches('[data-busy]') && !box.querySelector('[data-busy]')) {
          for (const control of box.querySelectorAll('button,input')) control.disabled = !!this.getState().error || !!session?.requests?.[index]?.sending;
        }
        return;
      }
      signature = nextSignature;
      body.replaceChildren(); if (!session) { body.append(node('p', 'muted', 'All caught up.')); return; }
      const tabs = node('div', 'wf-tabs'); updateTabs(tabs);
      const info = node('div', 'wf-row'); info.append(node('strong', '', `${session.project} · ${session.provider}`), action('Open session', () => { dialog.close(); this.openSession(session.id); }));
      const context = (session.messages || []).findLast(m => m.role === 'assistant' && !m.tool), requests = node('div', 'chat-requests');
      body.append(tabs, info); if (context) { const details = node('details'); details.append(node('summary', '', 'Context'), node('p', 'wf-prewrap', context.text)); body.append(details); }
      body.append(requests); this.renderRequests(requests, session);
      if (session.asks && !session.requests?.length) { const answer = field('Reply', '', 'textarea'), send = action('Send', () => dialog.run(async () => { await this.api(`sessions/${encodeURIComponent(session.id)}/messages`, { text: answer.input.value, mode: 'send', clientMessageId: id() }); current = sessions.find(s => s.id !== session.id)?.id; signature = ''; await this.refresh(); render(); }, send)); answer.input.maxLength = 12000; body.append(node('p', 'wf-prewrap', session.asks), answer.wrap, send); }
    };
    this.inboxUpdate = render; dialog.addEventListener('close', () => { if (this.inboxUpdate === render) this.inboxUpdate = null; }); render();
  }
  reviewQueue() {
    const { dialog, body } = this.dialog('Ready to review'); let signature;
    const render = () => { const sessions = this.sessions().filter(s => this.review(s)).sort((a, b) => reviewStamp(a) - reviewStamp(b)); const sig = JSON.stringify(sessions.map(s => [s.id, reviewStamp(s), this.title(s)])); if (signature === sig) return; signature = sig;
      body.replaceChildren(); for (const session of sessions) { const row = node('div', 'wf-record'); row.append(action(this.title(session), () => { dialog.close(); this.openSession(session.id); }), node('span', 'muted', session.project), action('Reviewed ✓', () => dialog.run(async () => { await this.patch('sessions', session.id, { reviewedThrough: reviewStamp(session) }); render(); }))); body.append(row); } if (!sessions.length) body.append(node('p', 'muted', 'All reviewed.')); };
    this.reviewUpdate = render; dialog.addEventListener('close', () => { if (this.reviewUpdate === render) this.reviewUpdate = null; }); render();
  }
  applyView(view) { this.setView(view); }
  views() {
    const { dialog, body } = this.dialog('Saved views'), name = field('View name'); name.input.maxLength = 100;
    const save = action('Save current view', () => dialog.run(async () => { if (!name.input.value.trim()) throw new Error('Enter a view name.'); const { project, provider, filter, search } = this.getState(); await this.patch('views', id(), { name: name.input.value.trim(), project, provider, filter, search }); render(); }, save));
    const records = node('div'); const render = () => { records.replaceChildren(); for (const [key, view] of Object.entries(this.saved.views)) { const row = node('div', 'wf-record'); row.append(action(view.name, () => { dialog.close(); this.applyView(view); }), action('×', () => dialog.run(async () => { await this.patch('views', key, null); render(); }), 'Delete view')); records.append(row); } };
    body.append(records, name.wrap, save); render();
  }
  snippets(insert) {
    const { dialog, body } = this.dialog('Prompt snippets'), records = node('div'), name = field('Name'), text = field('Prompt', '', 'textarea'); name.input.maxLength = 100; text.input.maxLength = 12000; let editing = null;
    const render = () => { records.replaceChildren(); for (const [key, snippet] of Object.entries(this.saved.snippets)) { const row = node('div', 'wf-record'); row.append(action(snippet.name, () => { if (insert) { if (insert(snippet.text) !== false) dialog.close(); } else { editing = key; name.input.value = snippet.name; text.input.value = snippet.text; } }), action('Edit', () => { editing = key; name.input.value = snippet.name; text.input.value = snippet.text; }), action('×', () => dialog.run(async () => { await this.patch('snippets', key, null); render(); }), 'Delete snippet')); records.append(row); } };
    const save = action('Save', () => dialog.run(async () => { if (!name.input.value.trim() || !text.input.value.trim()) throw new Error('Enter a name and prompt.'); await this.patch('snippets', editing || id(), { name: name.input.value.trim(), text: text.input.value }); editing = null; name.input.value = ''; text.input.value = ''; render(); }, save));
    body.append(records, name.wrap, text.wrap, save); render();
  }
  presets(session) {
    const { dialog, body } = this.dialog('Launch presets'), records = node('div'); let editing = null;
    const fields = { name: field('Name'), cwd: field('Folder', session?.cwd || this.getState().project), provider: select('Agent', [['codex', 'Codex'], ['claude', 'Claude'], ['opencode', 'OpenCode']], session?.provider || 'codex'), account: field('Claude account', session?.account || ''), model: field('Model', session?.model || ''), effort: field('Effort', session?.effort || ''), prompt: field('Starting draft', '', 'textarea') };
    fields.prompt.input.maxLength = 12000;
    const render = () => { records.replaceChildren(); for (const [key, preset] of Object.entries(this.saved.presets)) { const row = node('div', 'wf-record'); const launch = action(`▶ ${preset.name}`, () => dialog.run(async () => { const result = await this.api('spawn', { presetId: key }); await this.refresh(); this.toast(result.warning || 'Session started'); if (result.sessionId) { dialog.close(); this.openSession(result.sessionId); } }, launch)); row.append(launch, action('Edit', () => { editing = key; for (const [k, f] of Object.entries(fields)) f.input.value = preset[k] || ''; }), action('×', () => dialog.run(async () => { await this.patch('presets', key, null); render(); }), 'Delete preset')); records.append(row); } };
    const save = action('Save preset', () => dialog.run(async () => { const value = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.input.value.trim()])); if (!value.name || !value.cwd) throw new Error('Enter a name and folder.'); await this.patch('presets', editing || id(), value); editing = null; render(); }, save));
    body.append(records, ...Object.values(fields).map(f => f.wrap), save); render();
  }
  search() {
    const { dialog, body } = this.dialog('Search history', { wide: true }), query = field('Search messages', '', 'search'), provider = select('Agent', [['', 'All agents'], ['codex', 'Codex'], ['claude', 'Claude'], ['opencode', 'OpenCode']]), results = node('div');
    let serial = 0;
    const search = action('Search', () => dialog.run(async () => { const ticket = ++serial; results.textContent = 'Searching…'; const data = await this.api(`history/search?${new URLSearchParams({ q: query.input.value, provider: provider.input.value })}`); if (ticket !== serial || !dialog.open) return; results.replaceChildren();
      for (const result of data.results || []) { const row = node('article', 'wf-search-result'); row.append(action(`${result.session.title} · ${result.session.project}${result.archived ? ' · History' : ''}`, () => this.transcript(result.sessionId, result.messageId)), node('p', 'wf-prewrap', Array.isArray(result.context) ? result.context.map(m => `${m.role}: ${m.text}`).join('\n\n') : result.text)); results.append(row); }
      if (!data.results?.length) results.append(node('p', 'muted', 'No matches.')); if (data.truncated || data.partial) results.append(node('p', 'muted', 'Some history is outside the current search window. Refine your search.'));
    }, search)); query.input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search.click(); } }; body.append(query.wrap, provider.wrap, search, results); query.input.focus();
  }
  async transcript(sessionId, messageId) {
    const { dialog, body } = this.dialog('History', { wide: true }); body.textContent = 'Loading…';
    await dialog.run(async () => { const session = await this.api(`history/session?${new URLSearchParams({ id: sessionId })}`); if (!dialog.open) return; body.replaceChildren(node('strong', '', `${session.title} · ${session.project}`)); const live = this.sessions().find(s => s.id === sessionId); if (live) body.append(action('Open session', () => { dialog.close(); this.openSession(sessionId); }));
      for (const message of session.messages || []) { const article = node('article', `wf-transcript${message.id === messageId ? ' wf-match' : ''}`); article.append(node('small', 'muted', `${message.role || 'Tool'} · ${date(message.timestamp)}`), node('pre', 'wf-prewrap', message.text)); body.append(article); } body.querySelector('.wf-match')?.scrollIntoView({ block: 'center' });
    });
  }
  async decisions(sessionId = '') {
    const { dialog, body } = this.dialog('Decisions'), query = field('Search decisions', '', 'search'), results = node('div'); let serial = 0;
    const render = async () => { const ticket = ++serial; const data = await this.api(`decisions?${new URLSearchParams({ session: sessionId, q: query.input.value })}`); if (ticket !== serial || !dialog.open) return; results.replaceChildren(); for (const entry of data.decisions) { const row = node('div', 'wf-record'); const session = this.sessions().find(s => s.id === entry.sessionId); row.append(node('time', 'muted', date(entry.at)), node('strong', '', entry.decision), node('span', '', session ? this.title(session) : entry.sessionId)); results.append(row); } if (!data.decisions.length) results.append(node('p', 'muted', 'No decisions.')); if (data.truncated) results.append(node('p', 'muted', 'Showing recent decisions.')); };
    query.input.oninput = () => dialog.run(render); body.append(query.wrap, results); await dialog.run(render);
  }
  async repository(session) {
    const { dialog, body } = this.dialog('Repository changes', { wide: true }); body.textContent = 'Loading…';
    await dialog.run(async () => { const repo = await this.api(`sessions/${encodeURIComponent(session.id)}/repository`); if (!dialog.open) return; body.replaceChildren(); if (!repo.available) { body.append(node('p', 'muted', repo.error || 'No repository.')); return; }
      const label = node('p', 'muted', `${repo.branch || 'Detached'} · Shared working directory`); label.title = repo.root; body.append(label);
      for (const file of repo.files) { const details = node('details', 'wf-file'); details.append(node('summary', '', `${file.status} ${file.path}  +${file.added || 0} −${file.removed || 0}${file.binary ? ' · binary' : ''}`)); details.ontoggle = () => { if (!details.open || details.dataset.loaded) return; details.dataset.loaded = 'true'; dialog.run(async () => { const diff = await this.api(`sessions/${encodeURIComponent(session.id)}/repository?${new URLSearchParams({ path: file.path })}`); details.append(node('pre', 'wf-diff', diff.text || (diff.binary ? 'Binary file' : 'No textual changes.'))); if (diff.truncated) details.append(node('p', 'muted', 'Diff shortened.')); }).then(() => { if (details.children.length === 1) delete details.dataset.loaded; }); }; body.append(details); }
      if (!repo.files.length) body.append(node('p', 'muted', 'Working directory clean.'));
    });
  }
  overlaps(session) {
    const { dialog, body } = this.dialog('Observed overlapping edits');
    for (const overlap of (this.getState().snapshot?.overlaps || []).filter(o => o.sessionIds.includes(session.id))) { const row = node('div', 'wf-record'); row.append(node('code', '', overlap.path)); for (const key of overlap.sessionIds) { const s = this.sessions().find(s => s.id === key); if (s) row.append(action(this.title(s), () => { dialog.close(); this.openSession(key); })); } body.append(row); }
  }
  split(session) {
    const { dialog, body } = this.dialog('Open beside this session');
    for (const target of this.sessions().filter(s => s.id !== session.id)) body.append(action(`${this.title(target)} · ${target.project}`, () => { dialog.close(); this.closeSplit(); const frame = node('iframe', 'wf-split'); frame.title = `Session: ${this.title(target)}`; frame.src = `${location.pathname}?pane=1#${new URLSearchParams({ session: target.id })}`; document.body.append(frame); this.splitFrame = frame; document.body.classList.add('wf-split-open'); document.querySelector('#panel')?.setAttribute('aria-modal', 'false'); }));
  }
  closeSplit() { this.splitFrame?.remove(); this.splitFrame = null; document.body.classList.remove('wf-split-open'); document.querySelector('#panel')?.setAttribute('aria-modal', 'true'); }
  async handoff(session) {
    const { dialog, body } = this.dialog('Handoff', { wide: true });
    const messages = (session.messages || []).filter(m => m.text), selectedMessages = new Set(), selectedDecisions = new Set(), selectedFiles = new Set(); let decisions = [];
    const choices = node('div', 'wf-handoff-choices'), preview = field('Briefing draft', '', 'textarea'); preview.input.maxLength = 12000;
    const targets = this.sessions().filter(s => s.id !== session.id && s.messaging?.send), target = select('Send draft to', [['', 'Choose a session'], ...targets.map(s => [s.id, `${this.title(s)} · ${s.provider}`])]);
    const update = () => { preview.input.value = handoffText(session, [...selectedMessages], [...selectedDecisions], [...selectedFiles]); };
    const addChoice = (label, value, selected) => { const wrap = node('label', 'wf-choice'), check = node('input'); check.type = 'checkbox'; check.onchange = () => { if (check.checked) selected.add(value); else selected.delete(value); update(); }; wrap.append(check, node('span', 'wf-prewrap', label)); choices.append(wrap); };
    for (const message of messages) addChoice(`${message.role || 'Tool'} · ${message.text.slice(0, 240)}`, message, selectedMessages);
    const save = action('Use draft', () => dialog.run(async () => { const destination = targets.find(s => s.id === target.input.value); if (!destination) throw new Error('Choose a connected destination session.'); await this.putDraft(destination, preview.input.value); dialog.close(); }, save));
    body.append(choices, preview.wrap, target.wrap, save); update();
    await dialog.run(async () => { const [audit, repo] = await Promise.all([this.api(`decisions?${new URLSearchParams({ session: session.id })}`), this.api(`sessions/${encodeURIComponent(session.id)}/repository`).catch(() => ({ files: [] }))]); if (!dialog.open) return; decisions = audit.decisions; for (const entry of decisions.slice(0, 30)) addChoice(`Decision · ${entry.decision} · ${date(entry.at)}`, entry, selectedDecisions); for (const file of repo.files || []) addChoice(`File · ${file.path}`, file.path, selectedFiles); });
  }
  async health() {
    const { dialog, body } = this.dialog('Connections');
    const render = async () => { const { providers } = await this.api('providers/health'); if (!dialog.open) return; body.replaceChildren(); for (const provider of providers) { const row = node('section', 'wf-connection'); row.append(node('strong', '', `${provider.name} · ${provider.connected ? 'Connected' : 'Disconnected'}`), node('p', 'wf-prewrap', provider.detail), node('small', 'muted', `Last connected: ${date(provider.lastSuccessAt)}`)); const retry = action('Retry now', () => dialog.run(async () => { await this.api(`providers/${encodeURIComponent(provider.id)}/retry`, {}); await render(); }, retry)); row.append(retry); body.append(row); } };
    await dialog.run(render);
  }
  settings() {
    const { dialog, body } = this.dialog('Preferences');
    const shortcut = node('label', 'wf-choice'), enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = this.shortcuts; enabled.onchange = () => { this.shortcuts = enabled.checked; try { localStorage.setItem('ai-control-shortcuts', this.shortcuts ? 'on' : 'off'); } catch {} }; shortcut.append(enabled, node('span', '', 'Single-key shortcuts'));
    const help = node('p', 'muted', 'Ctrl/Cmd+K commands · / search · j/k move · n next · f feed · ? preferences');
    const quiet = field('No activity after (minutes)', this.saved.preferences.quietMinutes ?? 15, 'number'); quiet.input.min = '1'; quiet.input.max = '240';
    const policy = this.saved.preferences.notifications || {}, categories = {}, categoryRow = node('div', 'wf-checks');
    for (const [key, label] of [['permissions', 'Permissions'], ['questions', 'Questions'], ['completions', 'Completions'], ['errors', 'Errors']]) { const wrap = node('label', 'wf-choice'), input = node('input'); input.type = 'checkbox'; input.checked = policy.categories?.[key] !== false; categories[key] = input; wrap.append(input, node('span', '', label)); categoryRow.append(wrap); }
    const quietEnabled = node('input'); quietEnabled.type = 'checkbox'; quietEnabled.checked = !!policy.quietHours?.enabled; const quietLabel = node('label', 'wf-choice'); quietLabel.append(quietEnabled, node('span', '', 'Quiet hours'));
    const start = field('From', policy.quietHours?.start || '22:00', 'time'), end = field('Until', policy.quietHours?.end || '07:00', 'time'), zone = field('Time zone', policy.quietHours?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone), muted = new Set(policy.mutedProjects || []), projects = node('details'); projects.append(node('summary', '', 'Muted projects'));
    for (const cwd of new Set([...this.sessions().map(s => s.cwd).filter(Boolean), ...muted])) { const label = node('label', 'wf-choice'), input = node('input'); input.type = 'checkbox'; input.checked = muted.has(cwd); input.onchange = () => input.checked ? muted.add(cwd) : muted.delete(cwd); label.append(input, node('span', '', cwd)); projects.append(label); }
    const save = action('Save', () => dialog.run(async () => { const minutes = Number(quiet.input.value); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new Error('Use 1–240 minutes.'); try { new Intl.DateTimeFormat('en', { timeZone: zone.input.value }); } catch { throw new Error('Enter a valid time zone.'); } await this.patch('preferences', 'quietMinutes', minutes); await this.patch('preferences', 'notifications', { categories: Object.fromEntries(Object.entries(categories).map(([key, input]) => [key, input.checked])), mutedProjects: [...muted], quietHours: { enabled: quietEnabled.checked, start: start.input.value, end: end.input.value, timeZone: zone.input.value } }); dialog.close(); }, save));
    body.append(shortcut, help, quiet.wrap, node('strong', '', 'Alerts'), categoryRow, quietLabel, start.wrap, end.wrap, zone.wrap, projects, save);
  }
}
