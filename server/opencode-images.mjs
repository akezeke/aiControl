import { fileURLToPath } from 'node:url';
import { CodexImages } from './codex-images.mjs';

// OpenCode supplies image bytes as data URLs in typed file parts. Older versions may
// report only the successful Read input, so retain that local path as a fallback.
function source(file) {
  const uri = file?.uri || file?.url;
  if (typeof uri !== 'string' || !/^image\//i.test(file.mime || '')) return null;
  if (/^data:image\/[\w.+-]+;base64,/i.test(uri)) return { url: uri };
  if (uri.startsWith('file:')) { try { return { path: fileURLToPath(uri) }; } catch { return null; } }
  return null;
}

export class OpenCodeImages extends CodexImages {
  rememberRows(sessionId, rows, cwd) {
    for (const { info, parts = [] } of rows) {
      const at = info?.time?.created || null;
      for (const part of parts) {
        if (typeof part.id !== 'string') continue;
        if (info.role === 'user' && part.type === 'file') {
          const image = source(part); if (!image) continue;
          this.remember(sessionId, { item: { id: part.id, type: 'userMessage', content: [image.url ? { type: 'image', url: image.url } : { type: 'localImage', path: image.path }] }, startedAtMs: at }, cwd);
        }
        if (info.role !== 'assistant' || part.type !== 'tool' || part.state?.status !== 'completed') continue;
        const files = [...(Array.isArray(part.state.content) ? part.state.content : []), ...(Array.isArray(part.state.attachments) ? part.state.attachments : [])].filter(file => file.type === 'file').map(source).filter(Boolean);
        if (files.length) {
          files.forEach((image, index) => {
            const item = image.url ? { type: 'dynamicToolCall', contentItems: [{ type: 'inputImage', imageUrl: image.url }] } : { type: 'imageView', path: image.path };
            this.remember(sessionId, { item: { id: `${part.id}:${index}`, ...item }, startedAtMs: at }, cwd);
          });
        } else if (part.tool?.toLowerCase() === 'read') {
          const path = part.state.input?.filePath || part.state.input?.path;
          this.remember(sessionId, { item: { id: part.id, type: 'imageView', path }, startedAtMs: at }, cwd);
        }
      }
    }
  }
}
