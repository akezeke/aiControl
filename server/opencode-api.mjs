import { fail } from './requests.mjs';
import { openCodeMessages } from './opencode-data.mjs';

const array = value => { if (!Array.isArray(value)) throw fail('OpenCode returned an unsupported response. Update OpenCode and reconnect.', 503); return value; };
const infoV2 = (info, version) => ({ ...info, directory: info.location?.directory, version });

// Keep the dashboard's existing transcript representation across the two wire protocols.
export function messagesV2(rows) {
  return rows.map(message => {
    const info = { ...message, role: message.type, providerID: message.model?.providerID, modelID: message.model?.id,
      ...(message.error ? { error: { name: message.error.type, data: { message: message.error.message } } } : {}) };
    let parts = [];
    if (message.type === 'user') parts = [{ type: 'text', text: message.text }, ...(message.files || []).map(file => ({ type: 'file', mime: file.mime, filename: file.name }))];
    if (message.type === 'assistant') parts = (message.content || []).map(part => ({ ...part, ...(part.type === 'tool' ? { tool: part.name } : {}) }));
    if (message.type === 'compaction') { info.role = 'assistant'; parts = [{ type: 'compaction' }]; }
    if (message.type === 'shell') { info.role = 'assistant'; parts = [{ type: 'tool', tool: 'shell', state: { input: { command: message.command }, status: message.exit ? 'error' : message.status } }]; }
    return { info, parts: parts.map((part, i) => ({ ...part, id: `${message.id}:${part.id || i}` })) };
  });
}

function formV2(form) {
  const supported = form.fields?.length && form.fields.every(field => ['string', 'multiselect', 'boolean', 'number', 'integer'].includes(field.type) && !field.hidden && !field.when?.length
    && new Set(field.options?.map(option => option.label)).size === (field.options?.length || 0));
  return { ...form, unsupported: !supported, questions: supported ? form.fields.map(field => ({
    question: field.title || field.description || field.key, multiple: field.type === 'multiselect',
    options: field.type === 'boolean' ? [{ label: 'Yes' }, { label: 'No' }] : field.options || [],
    custom: field.type !== 'boolean' && (!field.options?.length || field.custom === true),
  })) : [] };
}

export class OpenCodeAPI {
  constructor(client) { this.client = client; }
  async detect() {
    if (this.version) return;
    try {
      const info = await this.client.request('/api/info');
      if (!/^2\./.test(info?.version)) throw fail('This OpenCode API version is not supported.', 503);
      this.version = info.version; this.v2 = true;
    } catch (error) {
      if (error.upstreamStatus !== 404 && !error.notJSON) throw error;
      const info = await this.client.request('/global/health');
      if (!/^1\./.test(info?.version)) throw fail('This OpenCode API version is not supported.', 503);
      this.version = info.version; this.v2 = false;
    }
  }
  async models(directory) {
    if (this.v2) {
      const result = await this.client.request('/api/model', { query: { 'location[directory]': directory } });
      return array(result.data).filter(model => model.enabled).map(model => ({ id: `${model.providerID}/${model.id}`, name: `${model.name} · ${model.providerID}`, efforts: (model.variants || []).map(variant => variant.id).filter(Boolean), defaultEffort: '' }));
    }
    const result = await this.client.request('/provider', { directory });
    return array(result.all).filter(provider => result.connected?.includes(provider.id)).flatMap(provider => Object.values(provider.models || {}).map(model => ({ id: `${provider.id}/${model.id}`, name: `${model.name || model.id} · ${provider.id}`, efforts: Object.keys(model.variants || {}), defaultEffort: '' })));
  }
  modelRef(model, effort) {
    const slash = model.indexOf('/');
    if (slash < 1 || slash === model.length - 1) throw fail('Invalid OpenCode model.');
    return { providerID: model.slice(0, slash), id: model.slice(slash + 1), ...(effort ? { variant: effort } : {}) };
  }
  async selectModel(id, model, effort) {
    if (this.v2) await this.client.request(`/api/session/${id}/model`, { method: 'POST', body: { model: this.modelRef(model, effort) } });
    return { pending: !this.v2 };
  }
  async inbox(id) { return array((await this.client.request(`/api/session/${id}/inbox`)).data); }
  async terminals(id) { return array((await this.client.request(`/api/experimental/session/${id}/terminal`)).data); }
  archive(id) { return this.client.request(`/api/session/${id}`, { method: 'PATCH', body: { archived: true } }); }
  async sessions(limit) {
    await this.detect();
    if (!this.v2) return array(await this.client.request('/experimental/session', { query: { limit, archived: true } }));
    // Omitting archived includes both active and archived sessions in V2.
    const rows = [], seen = new Set(); let cursor;
    do {
      const result = await this.client.request('/api/session', { query: { limit: Math.min(200, limit - rows.length), ...cursor ? { cursor } : { order: 'desc' } } });
      rows.push(...array(result.data)); cursor = result.cursor?.next;
      if (cursor && seen.has(cursor)) throw fail('OpenCode returned an invalid session cursor.', 503);
      seen.add(cursor);
    } while (cursor && rows.length < limit);
    return rows.map(info => infoV2(info, this.version));
  }
  async session(id, directory) {
    const result = await this.client.request(`${this.v2 ? '/api' : ''}/session/${id}`, { ...!this.v2 ? { directory } : {} });
    return this.v2 ? infoV2(result.data, this.version) : result;
  }
  async status(directory) {
    const result = await this.client.request(this.v2 ? '/api/session/active' : '/session/status', { ...!this.v2 ? { directory } : {} });
    return this.v2 ? Object.fromEntries(Object.entries(result.data).map(([id]) => [id, { type: 'busy' }])) : result;
  }
  async requests(kind, directory) {
    if (!this.v2) return array(await this.client.request(`/${kind}`, { directory }));
    const result = await this.client.request(kind === 'permission' ? '/api/permission/request' : '/api/form', { query: { 'location[directory]': directory } });
    return array(result.data).map(request => kind === 'permission' ? { ...request, permission: request.action, patterns: request.resources } : formV2(request));
  }
  async reply(kind, request, directory, answer, questions) {
    let body, path;
    if (kind === 'permission') {
      const decision = answer.decision === 'accept' ? 'once' : 'reject';
      body = { [this.v2 ? 'decision' : 'reply']: decision, ...(answer.message ? { message: answer.message } : {}) };
    } else if (!this.v2) body = { answers: questions.map(q => answer.answers[q.id]) };
    else {
      if (request.unsupported) throw fail('Answer this form in OpenCode.');
      const values = request.fields.map((field, i) => {
        const selected = answer.answers[questions[i].id];
        const mapped = selected.map(label => field.options?.find(option => option.label === label)?.value ?? label);
        let value = field.type === 'multiselect' ? mapped : field.type === 'boolean' ? selected[0] === 'Yes' : mapped[0];
        if (['number', 'integer'].includes(field.type)) {
          value = Number(value);
          if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw fail(`Enter a ${field.type}: ${field.title || field.key}`);
        }
        return [field.key, value];
      });
      body = { answer: Object.fromEntries(values) };
    }
    path = this.v2 ? `/api/session/${request.sessionID}/${kind === 'question' ? 'form' : 'permission'}/${request.id}/reply` : `/${kind}/${request.id}/reply`;
    return this.client.request(path, { method: 'POST', body, ...!this.v2 ? { directory } : {} });
  }
  async messages(id, directory, limit) {
    if (!this.v2) return array(await this.client.request(`/session/${id}/message`, { directory, query: limit ? { limit } : {} }));
    const rows = [], seen = new Set(); let cursor;
    do {
      const page = await this.client.request(`/api/session/${id}/message`, { query: { limit: limit || 200, ...cursor ? { cursor } : { order: 'desc' } } });
      rows.push(...array(page.data));
      cursor = page.cursor?.next;
      if (limit) break;
      // Avoid silently presenting partial usage as complete on malformed or enormous histories.
      if (cursor && (seen.has(cursor) || rows.length >= 100_000)) throw fail('OpenCode history is too large to read. Usage may be incomplete.', 503);
      seen.add(cursor);
    } while (cursor);
    return messagesV2(rows.reverse());
  }
  // Fetch by visible conversation messages rather than raw assistant/tool records.
  async history(id, directory, limit) {
    const maxRows = Math.max(2000, limit * 10);
    let rows = [], more = false;
    if (!this.v2) {
      rows = await this.messages(id, directory, maxRows + 1);
      more = rows.length > maxRows;
      if (more) rows = rows.slice(-maxRows);
    } else {
      let cursor, count = 0; const seen = new Set();
      do {
        const page = await this.client.request(`/api/session/${id}/message`, { query: { limit: 100, ...cursor ? { cursor } : { order: 'desc' } } });
        const data = array(page.data); rows.push(...data); cursor = page.cursor?.next;
        count += openCodeMessages(messagesV2(data), Infinity).filter(message => !message.tool).length;
        if (cursor && seen.has(cursor)) throw fail('OpenCode returned an invalid history cursor.', 503);
        seen.add(cursor);
      } while (cursor && count <= limit && rows.length < maxRows);
      more = !!cursor; rows = messagesV2(rows.reverse());
    }
    const all = openCodeMessages(rows, Infinity), messages = openCodeMessages(rows, limit);
    return { rows, messages, more: more || messages.length < all.length };
  }
  send(id, directory, text, settings) {
    const model = settings?.model && this.modelRef(settings.model, settings.effort);
    return this.client.request(this.v2 ? `/api/session/${id}/prompt` : `/session/${id}/prompt_async`,
      { method: 'POST', body: this.v2 ? { text } : { parts: [{ type: 'text', text }], ...model ? { model: { providerID: model.providerID, modelID: model.id }, ...(model.variant ? { variant: model.variant } : {}) } : {} }, ...!this.v2 ? { directory } : {} });
  }
  interrupt(id, directory) { return this.client.request(this.v2 ? `/api/session/${id}/interrupt` : `/session/${id}/abort`, { method: 'POST', ...!this.v2 ? { directory } : {} }); }
  async create(directory, settings = {}) {
    const result = await this.client.request(this.v2 ? '/api/session' : '/session', { method: 'POST', body: this.v2 ? { location: { directory }, ...settings.model ? { model: this.modelRef(settings.model, settings.effort) } : {} } : {}, ...!this.v2 ? { directory } : {} });
    return this.v2 ? infoV2(result.data, this.version) : result;
  }
}
