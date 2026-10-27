import { Marked, Renderer, Tokenizer } from './vendor/marked/marked.js';

const escapeHtml = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const escapeAttribute = text => text.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);)|[<>"']/gi, escapeHtml);

class MessageTokenizer extends Tokenizer {
  // Treat HTML as literal text, including text inside script/pre/code tags.
  html() {}
  tag() {}
}

class MessageRenderer extends Renderer {
  html({ text }) { return escapeHtml(text); }
  link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    // Absolute web/mail links only: file paths must not become dashboard routes,
    // and message content must never introduce executable URL schemes.
    if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return label;
    try {
      const url = new URL(href);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return label;
      return `<a href="${escapeAttribute(url.href)}"${title ? ` title="${escapeAttribute(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`;
    } catch { return label; }
  }
  // Keep messages text-only; do not fetch images embedded in session content.
  image({ text }) { return text; }
  table(token) {
    const labels = token.header.map((cell, index) => this.parser.parseInline(cell.tokens) || `Column ${index + 1}`);
    const cards = token.rows.map(row => `<dl class="message-table-card">${row.map((cell, index) => `<div><dt>${labels[index]}</dt><dd>${this.parser.parseInline(cell.tokens) || '—'}</dd></div>`).join('')}</dl>`).join('');
    return `<div class="message-table" tabindex="0" role="region" aria-label="Table">${super.table(token)}</div>${cards ? `<div class="message-table-cards">${cards}</div>` : ''}`;
  }
}

const markdown = new Marked();
markdown.setOptions({ gfm: true, breaks: true, tokenizer: new MessageTokenizer(), renderer: new MessageRenderer() });

export function renderMessageMarkdown(text, previewLength = 650) {
  // Parse the whole message before splitting so reference links and fenced code
  // retain their context. Expand only between complete Markdown blocks.
  const tokens = markdown.lexer(text);
  let length = 0, split = 0;
  while (split < tokens.length && length < previewLength) length += tokens[split++].raw.length;
  return { html: markdown.parser(tokens.slice(0, split)), more: markdown.parser(tokens.slice(split)) };
}
