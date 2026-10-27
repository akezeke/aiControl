import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMessageMarkdown } from '../client/message-markdown.js';

const render = text => { const { html, more } = renderMessageMarkdown(text); return html + more; };

test('messages render headings, emphasis, nested lists, quotes and line breaks', () => {
  const html = render('# Update\n\n**Done** and *ready* with ~~old~~ text.\nNext line.\n\n- First\n  - Nested\n\n3. Third\n4. Fourth\n\n> Quoted');
  for (const output of ['<h1>Update</h1>', '<strong>Done</strong>', '<em>ready</em>', '<del>old</del>', '<br>Next line.', '<ul>', '<li>Nested</li>', '<ol start="3">', '<blockquote>']) assert.ok(html.includes(output), output);
});

test('fenced code stays literal and tables and task lists render', () => {
  const html = render('Use `a < b`.\n\n```js\nconst html = "<script>**literal**</script>";\n```\n\n| Name | State |\n| --- | ---: |\n| A | ready |\n\n- [x] Done\n- [ ] Next');
  assert.match(html, /<code>a &lt; b<\/code>/);
  assert.match(html, /<pre><code class="language-js">const html = &quot;&lt;script&gt;\*\*literal\*\*&lt;\/script&gt;&quot;;\n<\/code><\/pre>/);
  assert.match(html, /<div class="message-table"[^>]*><table>/);
  assert.match(html, /<td align="right">ready<\/td>/);
  assert.match(html, /<input checked="" disabled="" type="checkbox">/);
});

test('tables include labeled mobile rows with formatting and empty cells preserved', () => {
  const html = render('| **Name** | State |\n| --- | --- |\n| `worker` | [Ready](https://example.com) |\n| Other | |');
  assert.match(html, /<div class="message-table-cards">/);
  assert.equal((html.match(/class="message-table-card"/g) || []).length, 2);
  assert.match(html, /<dt><strong>Name<\/strong><\/dt><dd><code>worker<\/code><\/dd>/);
  assert.match(html, /<dt>State<\/dt><dd><a href="https:\/\/example.com\/"/);
  assert.match(html, /<dt>State<\/dt><dd>—<\/dd>/);
  assert.doesNotMatch(render('| Column |\n| --- |\n| <img src=x onerror=alert(1)> |'), /<img/);
});

test('message HTML is inert, including raw-text tags and encoded markup', () => {
  for (const text of [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'Before <code><img src=x onerror=alert(1)></code> after',
    '<svg><a onmouseover="alert(1)">hello</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '&lt;img src=x onerror=alert(1)&gt;',
  ]) {
    const html = render(text);
    assert.doesNotMatch(html, /<(script|img|svg|iframe|a)\b/i, text);
    assert.match(html, /&lt;/, text);
  }
});

test('links allow web and mail destinations with safe attributes', () => {
  const html = render('[**Docs**](https://example.com/docs?q=1&x=2 "Reference") and <hello@example.com>');
  assert.match(html, /href="https:\/\/example.com\/docs\?q=1&amp;x=2" title="Reference" target="_blank" rel="noopener noreferrer"><strong>Docs<\/strong>/);
  assert.match(html, /href="mailto:hello@example.com"/);
  assert.match(render('[Search](https://example.com/?a=1&amp;b=2)'), /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(render('[Title](https://example.com "&quot; onmouseover=alert(1)")'), /title="&quot; onmouseover=alert\(1\)" target=/);
  for (const url of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,test', 'vbscript:msgbox(1)', '/api/logout', 'file:///tmp/example', '//example.com']) assert.doesNotMatch(render(`[link](${url})`), /<a\b/, url);
  assert.doesNotMatch(render('![image](https://example.com/tracker.png)'), /<img\b/);
  assert.doesNotMatch(render('![<img src=x onerror=alert(1)>](x)'), /<img\b/);
});

test('long messages expand between whole blocks without losing code or reference links', () => {
  const text = `${'Intro '.repeat(100)}\n\n\`\`\`js\n${'const x = 1;\n'.repeat(20)}\`\`\`\n\nSee [docs][ref].\n\n[ref]: https://example.com/docs`;
  const { html, more } = renderMessageMarkdown(text);
  assert.match(html, /<pre><code class="language-js">[\s\S]*<\/code><\/pre>/);
  assert.match(more, /href="https:\/\/example.com\/docs"/);
  assert.doesNotMatch(more, /<pre>/);
  assert.equal((html + more).match(/const x = 1;/g).length, 20);
});

test('unfinished Markdown and long single blocks remain readable', () => {
  assert.match(render('```js\nconst x = 1;'), /<pre><code class="language-js">const x = 1;/);
  const text = 'A long paragraph. '.repeat(100);
  const { html, more } = renderMessageMarkdown(text);
  assert.equal(more, '');
  assert.ok(html.includes(text.trim()));
  assert.match(render('Fish & chips &amp; salsa'), /Fish &amp; chips &amp; salsa/);
});
