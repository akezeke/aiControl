import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { imageLimit, imageType, maxImageBytes } from './images.mjs';

function inline(data) {
  if (typeof data !== 'string' || !data || data.length * 0.75 > maxImageBytes) return null;
  const type = imageType(Buffer.from(data.slice(0, 24), 'base64'));
  return type ? { data, type } : null;
}
function dataUrl(url) {
  if (typeof url !== 'string' || !/^data:image\/[\w.+-]+;base64,/.test(url)) return null;
  return inline(url.slice(url.indexOf(',') + 1));
}
function localFile(path, cwd) {
  if (typeof path !== 'string' || !path || path.length > 8192 || path.includes('\0')) return null;
  return isAbsolute(path) ? { path } : isAbsolute(cwd || '') ? { path: resolve(cwd, path) } : null;
}

// Only image-bearing protocol fields are accepted, never paths or URLs found in arbitrary tool text.
function sources(item, cwd) {
  const parts = value => Array.isArray(value) ? value : [];
  switch (item.type) {
    case 'imageView': return [localFile(item.path, cwd)];
    case 'userMessage': return parts(item.content).map(part => part?.type === 'localImage' ? localFile(part.path, cwd) : part?.type === 'image' ? dataUrl(part.url) : null);
    case 'mcpToolCall': return parts(item.result?.content).map(part => part?.type === 'image' ? inline(part.data) : null);
    case 'dynamicToolCall': return parts(item.contentItems).map(part => part?.type === 'inputImage' ? dataUrl(part.imageUrl) : null);
    case 'imageGeneration': return [inline(item.result) || localFile(item.savedPath, cwd)];
    default: return [];
  }
}

// A tool may refer to a deleted file, a directory, or a pipe. Read only bounded regular raster files;
// NONBLOCK lets the stat reject a pipe without hanging. The browser never supplies a filesystem path.
async function fileImage(path, full) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxImageBytes || stat.size < 4) return null;
    const header = Buffer.alloc(12);
    await handle.read(header, 0, header.length, 0);
    const type = imageType(header);
    if (!type) return null;
    if (!full) return { type };
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    return imageType(data) === type ? { type, data } : null;
  } catch { return null; } finally { await handle?.close(); }
}

// Captured from the small history pages we already read and from completed live items. The public
// snapshot stays text-only; inline payloads have a separate global budget and files are read on demand.
export class CodexImages {
  threads = new Map();
  retainedBytes = 0;
  constructor({ maxInlineBytes = 64 * 1024 * 1024 } = {}) { this.maxInlineBytes = maxInlineBytes; }
  remember(threadId, entry, cwd) {
    const item = entry.item ?? entry;
    if (typeof item.id !== 'string' || ['failed', 'declined', 'inProgress'].includes(item.status) || item.success === false || item.error) return;
    const at = entry.completedAtMs ?? entry.startedAtMs ?? item.completedAtMs ?? item.startedAtMs ?? null;
    for (const [index, source] of sources(item, cwd).entries()) {
      if (!source) continue;
      let images = this.threads.get(threadId);
      if (!images) this.threads.set(threadId, images = new Map());
      const id = createHash('sha256').update(`${item.id}\0${index}`).digest('hex');
      const previous = images.get(id), bytes = (source.data?.length || 0) * 2;
      if (bytes > this.maxInlineBytes) continue;
      this.retainedBytes += bytes - (previous?.bytes || 0);
      images.set(id, { id, at: at ?? previous?.at ?? null, tool: item.type !== 'userMessage', source, bytes });
      const ordered = [...images.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
      for (const old of ordered.slice(0, Math.max(0, ordered.length - imageLimit))) this.remove(threadId, old.id);
    }
    // Evict the oldest inline images across sessions; local paths do not consume the payload budget.
    if (this.retainedBytes > this.maxInlineBytes) {
      const all = [...this.threads].flatMap(([thread, images]) => [...images.values()].filter(image => image.bytes).map(image => ({ thread, ...image }))).sort((a, b) => (a.at || 0) - (b.at || 0));
      for (const image of all) { if (this.retainedBytes <= this.maxInlineBytes) break; this.remove(image.thread, image.id); }
    }
  }
  remove(threadId, id) {
    const images = this.threads.get(threadId), image = images?.get(id);
    if (image) { this.retainedBytes -= image.bytes; images.delete(id); }
    if (!images?.size) this.threads.delete(threadId);
  }
  delete(threadId) { for (const id of this.threads.get(threadId)?.keys() || []) this.remove(threadId, id); }
  clear() { this.threads.clear(); this.retainedBytes = 0; }
  async list(threadId) {
    const images = [...(this.threads.get(threadId)?.values() || [])].sort((a, b) => (a.at || 0) - (b.at || 0));
    return (await Promise.all(images.map(async ({ id, at, tool, source }) => {
      const found = source.path ? await fileImage(source.path, false) : source;
      return found ? { id, at, tool, type: found.type } : null;
    }))).filter(Boolean);
  }
  async get(threadId, id) {
    const image = this.threads.get(threadId)?.get(id);
    if (!image) return null;
    if (image.source.path) return fileImage(image.source.path, true);
    return { type: image.source.type, data: Buffer.from(image.source.data, 'base64') };
  }
}
