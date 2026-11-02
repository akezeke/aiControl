import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, realpath, rm, writeFile, appendFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { TranscriptDocuments, lineDocuments, itemDocuments, readableDocuments, readDocument } from '../server/documents.mjs';
import { readLines } from '../server/images.mjs';
import { ClaudeAdapter } from '../server/claude.mjs';
import { CodexAdapter } from '../server/codex.mjs';
import { Auth, savePassword } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';
import { documentNames, matchDocument, documentSegments } from '../client/document-links.js';
import { placeShots } from '../client/history-shots.js';
import { renderMessageMarkdown, renderDocument } from '../client/message-markdown.js';

const sessionId = '11111111-2222-3333-4444-555555555555';
const write = (file_path, name = 'Write') => ({ type: 'tool_use', name, input: { file_path } });
const text = text => ({ type: 'text', text });
const row = (cwd, minute, ...content) => JSON.stringify({ type: 'assistant', sessionId, cwd, timestamp: `2026-10-28T12:${String(minute).padStart(2, '0')}:00Z`, message: { role: 'assistant', content } }) + '\n';

async function repo(t) {
  // Real path: macOS's temp folder is a link (/var → /private/var), and documents are found by where they really are.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'ai-control-documents-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'repo'), projects = join(dir, 'projects');
  await mkdir(join(cwd, 'docs'), { recursive: true }); await mkdir(join(projects, 'repo'), { recursive: true });
  return { dir, cwd, projects, path: join(projects, 'repo', `${sessionId}.jsonl`) };
}

test('names in text are Markdown files, not web addresses or other files', () => {
  assert.deepEqual(documentNames('Spec change (in docs/superpowers/specs/2026-10-27-stylized-look-design.md, plus README.md.) see `/abs/plan.md` and ~/notes/a.md:12'),
    ['docs/superpowers/specs/2026-10-27-stylized-look-design.md', 'README.md', '/abs/plan.md', '~/notes/a.md']);
  assert.deepEqual(documentNames('https://example.com/README.md a.mdx a.md.bak b.md/c'), []);
  assert.deepEqual(documentNames('[plan](docs/plan.md#top)'), ['docs/plan.md']);
});

test('a line yields files the assistant wrote and files it named; other rows and sessions yield nothing', () => {
  const line = row('/repo', 1, write('/repo/docs/plan.md'), write('/repo/src/a.js'), write('/repo/notes.md', 'Edit'), write('/repo/x.md', 'Read'), text('See docs/design.md'));
  assert.deepEqual(lineDocuments(line, sessionId).map(({ path, written, root }) => [path, written, root]), [
    ['/repo/docs/plan.md', true, '/repo'], ['/repo/notes.md', true, '/repo'], ['/repo/docs/design.md', false, '/repo'],
  ]);
  assert.deepEqual(lineDocuments(row('/repo', 1, text('docs/a.md')).replace('"assistant","sessionId"', '"user","sessionId"'), sessionId), []);
  assert.deepEqual(lineDocuments(row('/repo', 1, text('docs/a.md')), 'another'), []);
  assert.deepEqual(lineDocuments('not json .md', sessionId), []);
  assert.deepEqual(lineDocuments(row('/repo', 1, write('/home/me/.claude/projects/-repo/memory/note.md')), sessionId), []);
});

test('a scan keeps one entry per path, a write outranks a mention, and only new bytes are read', async t => {
  const { cwd, path } = await repo(t), reader = new TranscriptDocuments({ scanBytes: 4096 });
  await writeFile(path, row(cwd, 1, text('docs/plan.md')));
  assert.deepEqual((await reader.list(path, sessionId)).map(d => d.written), [false]);
  const next = row(cwd, 2, write(join(cwd, 'docs/plan.md')));
  await appendFile(path, next.slice(0, 40));
  assert.deepEqual((await reader.list(path, sessionId)).map(d => d.written), [false]);
  await appendFile(path, next.slice(40) + row(cwd, 3, text('Plan is in docs/plan.md')));
  const [only, ...rest] = await reader.list(path, sessionId);
  assert.equal(rest.length, 0); assert.equal(only.written, true); assert.equal(only.at, Date.parse('2026-10-28T12:02:00Z'));
  const tail = new TranscriptDocuments({ scanBytes: 600 });
  await appendFile(path, row(cwd, 4, text(`${'x'.repeat(800)} other.md`)) + row(cwd, 5, text('last.md')));
  assert.deepEqual((await tail.list(path, sessionId)).map(d => d.path), [join(cwd, 'last.md')]);
});

test('a long transcript is read whole, in pieces, across lines longer than a piece', async t => {
  const { cwd, path } = await repo(t), filler = JSON.stringify({ type: 'progress', text: 'x'.repeat(1024 * 1024) }) + '\n';
  await writeFile(path, row(cwd, 1, write(join(cwd, 'docs/old.md'))) + filler.repeat(20) + row(cwd, 2, text(`${'y'.repeat(9 * 1024 * 1024)} docs/long.md`)) + filler.repeat(4) + row(cwd, 3, text('docs/last.md')));
  await appendFile(path, row(cwd, 4, text('docs/unfinished.md')).slice(0, -1));
  assert.deepEqual((await new TranscriptDocuments().list(path, sessionId)).map(d => d.path), ['old', 'long', 'last'].map(name => join(cwd, `docs/${name}.md`)));
  const handle = await open(path, 'r'), { size } = await handle.stat(), lines = [];
  t.after(() => handle.close());
  const next = await readLines(handle, 0, size, Infinity, (line, offset) => lines.push([offset, line.length]));
  assert.equal(lines.length, 27); assert.ok(lines.every(([offset, length], n) => n ? offset === lines[n - 1][0] + lines[n - 1][1] + 1 : offset === 0 && length));
  assert.equal(next, lines.at(-1)[0] + lines.at(-1)[1] + 1); assert.ok(next < size);
});

test('a name from the top of a repository is found from a folder inside it, and goes no further', async t => {
  const { dir, cwd } = await repo(t), inner = join(cwd, 'packages/game');
  await mkdir(join(cwd, '.git')); await mkdir(inner, { recursive: true });
  await writeFile(join(cwd, 'docs/plan.md'), '# plan'); await writeFile(join(inner, 'near.md'), '# near'); await writeFile(join(cwd, 'near.md'), '# far'); await writeFile(join(dir, 'above.md'), '# above');
  const entry = name => ({ path: resolve(inner, name), root: inner, at: 1, written: false });
  const docs = await readableDocuments([entry('docs/plan.md'), entry('near.md'), entry('above.md'), entry('../../../above.md'), entry(join(cwd, 'docs/plan.md'))]);
  assert.deepEqual(docs.map(d => d.path), [join(cwd, 'docs/plan.md'), join(inner, 'near.md')]);
  assert.deepEqual(await readDocument(docs[0]), { name: 'plan.md', path: join(cwd, 'docs/plan.md'), text: '# plan' });
  await rm(join(cwd, '.git'), { recursive: true });
  assert.deepEqual((await readableDocuments([entry('docs/plan.md'), entry('near.md')])).map(d => d.path), [join(inner, 'near.md')]);
});

test('only real Markdown files are readable; a name must stay inside the session folder, a write need not', async t => {
  const { dir, cwd } = await repo(t);
  await writeFile(join(cwd, 'in.md'), '# in'); await writeFile(join(dir, 'out.md'), '# out'); await writeFile(join(cwd, 'big.md'), 'x'.repeat(1024 * 1024 + 1));
  await writeFile(join(dir, 'secret.txt'), 'no'); await symlink(join(dir, 'secret.txt'), join(cwd, 'link.md')); await symlink(join(dir, 'out.md'), join(cwd, 'escape.md'));
  await mkdir(join(cwd, 'folder.md')); execFileSync('mkfifo', [join(cwd, 'pipe.md')]);
  const entry = (name, written = false) => ({ path: join(cwd, name), root: cwd, at: 1, written });
  const docs = await readableDocuments([entry('in.md'), entry('gone.md'), entry('big.md'), entry('link.md'), entry('escape.md'), entry('folder.md'), entry('pipe.md'), entry('../out.md'), entry('link.md', true), { path: join(dir, 'out.md'), root: cwd, at: 2, written: true }]);
  assert.deepEqual(docs.map(d => [d.name, d.written]), [['in.md', false], ['out.md', true]]);
  assert.ok(docs.every(d => /^[a-f0-9]{16}$/.test(d.id)));
  assert.deepEqual(await readDocument(docs[0]), { name: 'in.md', path: join(cwd, 'in.md'), text: '# in' });
  await rm(join(cwd, 'in.md'));
  assert.equal(await readDocument(docs[0]), null);
});

test('the same file under two names is one document, written if either was', async t => {
  const { cwd } = await repo(t);
  await writeFile(join(cwd, 'a.md'), 'a'); await symlink(join(cwd, 'a.md'), join(cwd, 'b.md'));
  const docs = await readableDocuments([{ path: join(cwd, 'a.md'), root: cwd, at: 1, written: false }, { path: join(cwd, 'b.md'), root: cwd, at: 2, written: true }]);
  assert.deepEqual(docs.map(d => [d.path, d.written]), [[join(cwd, 'b.md'), true]]);
});

test('the Claude adapter lists a session and its subagents, and reads by id only', async t => {
  const { dir, cwd, projects, path } = await repo(t), agents = join(path.slice(0, -6), 'subagents');
  await mkdir(agents, { recursive: true });
  await writeFile(join(cwd, 'docs/plan.md'), '# Plan'); await writeFile(join(cwd, 'docs/agent.md'), '# Agent'); await writeFile(join(cwd, 'docs/said.md'), '# Said');
  await writeFile(path, row(cwd, 1, write(join(cwd, 'docs/plan.md')), text('Also docs/missing.md')));
  await writeFile(join(agents, 'agent-abc123.jsonl'), row(cwd, 2, write(join(cwd, 'docs/agent.md')), text('docs/said.md')));
  await writeFile(join(agents, 'agent-abc123.meta.json'), JSON.stringify({ description: 'Write it up' }));
  const claude = new ClaudeAdapter(new RequestStore(), join(dir, 'hook.sock'), { accounts: [{ label: '', sessionsDir: join(dir, 'sessions'), projectsDir: projects }] });
  await assert.rejects(claude.documentList(`claude:${sessionId}`), { status: 409 });
  claude.paths.set(`claude:${sessionId}`, path);
  const { documents } = await claude.documentList(`claude:${sessionId}`);
  assert.deepEqual(documents.map(d => [d.name, d.agent]), [['plan.md', undefined], ['agent.md', 'Write it up']]);
  assert.equal((await claude.document(`claude:${sessionId}`, documents[1].id)).text, '# Agent');
  await assert.rejects(claude.document(`claude:${sessionId}`, '../../etc/passwd'), { status: 404 });
  await assert.rejects(claude.document(`claude:${sessionId}`, join(cwd, 'docs/plan.md')), { status: 404 });
});

test('Codex documents come from its thread items', async t => {
  const { cwd } = await repo(t);
  await writeFile(join(cwd, 'docs/plan.md'), '# Plan'); await writeFile(join(cwd, 'said.md'), '# Said'); await writeFile(join(cwd, 'failed.md'), '# Failed');
  const adapter = new CodexAdapter(new RequestStore(), { createSocket: () => { throw new Error('offline'); }, log: () => {} });
  await assert.rejects(adapter.documentList('thread'), { status: 409 });
  adapter.sessions.set('thread', { id: 'codex:thread', cwd });
  const pages = [
    { data: [{ item: { type: 'agentMessage', text: 'Wrote docs/plan.md and said.md' }, completedAtMs: 30 }, { item: { type: 'fileChange', status: 'failed', changes: [{ path: 'failed.md' }] }, completedAtMs: 20 }], nextCursor: 'more' },
    { data: [{ item: { type: 'fileChange', status: 'completed', changes: [{ path: 'docs/plan.md' }, { path: 'src/a.js' }] }, completedAtMs: 10 }] },
  ], calls = [];
  adapter.rpc = async (method, params) => { calls.push([method, params.threadId, params.cursor]); return pages[params.cursor ? 1 : 0]; };
  const { documents } = await adapter.documentList('thread');
  assert.deepEqual(documents.map(d => [d.name, d.written, d.at]), [['plan.md', true, 10], ['said.md', false, 30]]);
  assert.deepEqual(calls, [['thread/items/list', 'thread', undefined], ['thread/items/list', 'thread', 'more']]);
  assert.equal((await adapter.document('thread', documents[0].id)).text, '# Plan');
  await assert.rejects(adapter.document('thread', 'nope'), { status: 404 });
  adapter.rpc = async () => { throw new Error('gone'); };
  assert.deepEqual(await adapter.documentList('thread'), { documents: [] });
  assert.deepEqual(itemDocuments({ type: 'plan', text: 'x.md' }, cwd, 1).map(d => d.written), [false]);
});

test('document routes need a login and pass the ids on', async t => {
  const { dir } = await repo(t), file = join(dir, 'auth.json'), password = 'correct horse testing battery';
  await savePassword(file, password);
  const origin = 'https://control.test:47841', calls = [];
  const handler = createHandler({ auth: new Auth(file), origin, store: new RequestStore(), snapshot: () => ({}), vite: () => {}, messages: {
    documents: async id => { calls.push(id); return { documents: [{ id: 'abc' }] }; },
    document: async (id, documentId) => { calls.push([id, documentId]); return { name: 'a.md', path: '/a.md', text: '# A' }; },
  } });
  const request = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { url: path, method, headers: { host: 'control.test:47841', ...headers }, socket: { remoteAddress: '100.80.0.2' } });
    const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return res;
  };
  const path = `/api/sessions/claude%3A${sessionId}/documents`;
  assert.equal((await request(path)).statusCode, 401);
  assert.equal((await request(`${path}/abc`)).statusCode, 401);
  assert.equal(calls.length, 0);
  const login = await request('/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal(JSON.parse((await request(path, { headers: { cookie } })).raw).documents[0].id, 'abc');
  const res = await request(`${path}/abc`, { headers: { cookie } });
  assert.equal(JSON.parse(res.raw).text, '# A');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [`claude:${sessionId}`, [`claude:${sessionId}`, 'abc']]);
});

test('a name finds its document by exact path, session folder or a unique ending', () => {
  const docs = ['/repo/docs/superpowers/specs/design.md', '/repo/README.md', '/repo/sub/README.md', '/home/me/.claude/plans/plan.md', '/other/x/same.md', '/other/y/same.md'].map(path => ({ id: path, path }));
  const found = (name, cwd = '/repo') => matchDocument(name, docs, cwd)?.path;
  assert.equal(found('docs/superpowers/specs/design.md'), docs[0].path);
  assert.equal(found('specs/design.md'), docs[0].path);
  assert.equal(found('./docs/superpowers/specs/design.md'), docs[0].path);
  assert.equal(found('README.md'), docs[1].path);
  assert.equal(found('README.md', '/elsewhere'), undefined);
  assert.equal(found('same.md'), undefined);
  assert.equal(found('~/.claude/plans/plan.md'), docs[3].path);
  assert.equal(found('/home/me/.claude/plans/plan.md'), docs[3].path);
  assert.equal(found('/specs/design.md'), undefined);
  assert.equal(found('sign.md'), undefined);
});

test('segments split text around the names that match', () => {
  const doc = { id: 'a', path: '/repo/docs/plan.md' };
  assert.deepEqual(documentSegments('See docs/plan.md, not other.md.', [doc], '/repo'), [{ text: 'See ' }, { text: 'docs/plan.md', document: doc }, { text: ', not other.md.' }]);
  assert.deepEqual(documentSegments('Nothing', [doc], '/repo'), [{ text: 'Nothing' }]);
});

test('written documents sit in history where they were written, in runs of their own', () => {
  const item = (id, timestamp) => ({ id, timestamp }), doc = (id, at) => ({ id, at }), shot = (id, at) => ({ id, at, tool: true });
  const placed = placeShots([item('a', 10), item('b', 20), item('c', 30)], [shot('s', 25)], [doc('old', 5), doc('d1', 15), doc('d2', 16), doc('d3', 26), doc('undated', null)]);
  assert.deepEqual(placed.map(entry => entry.docs ? entry.docs.map(d => d.id) : entry.shots ? entry.shots.map(s => s.id) : entry.id), ['a', ['d1', 'd2'], 'b', ['s'], ['d3'], 'c', ['undated']]);
  assert.deepEqual(placeShots([], [], [doc('only', 5)]).map(entry => entry.docs.length), [1]);
});

test('a link to a Markdown file carries its path; other relative links stay plain text', () => {
  const { html } = renderMessageMarkdown('[the plan](docs/plan.md:12) [src](src/a.js) [web](https://x.test/a.md)');
  assert.match(html, /<span data-doc-path="docs\/plan\.md">the plan<\/span>/);
  assert.match(html, /<a href="https:\/\/x\.test\/a\.md"/);
  assert.ok(!html.includes('src/a.js'));
  assert.match(renderMessageMarkdown('[a](docs/"><b>.md)').html, /^(?!.*<b>)/s);
});

test('a document renders as a whole, with its own line breaks, and HTML stays literal', () => {
  const html = renderDocument('# Plan\n\nOne\nline <script>alert(1)</script>\n\n```js\nconst a = 1;\n```');
  assert.match(html, /<h1>Plan<\/h1>/);
  assert.ok(!html.includes('<br>'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /<pre>/);
});
