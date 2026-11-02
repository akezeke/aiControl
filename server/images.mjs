import { open } from 'node:fs/promises';

// Screenshots a Claude session has looked at: images pasted into a prompt or returned by a tool (Read on a .png, a
// browser screenshot). The transcript holds them inline as base64, so they are served from there by id and no file
// path ever comes from a request. Images are full size; the client scales them down.
const marker = '"type":"image"';
export const imageLimit = 40;
export const maxImageBytes = 10 * 1024 * 1024;

// The bytes decide the type, not the transcript's media_type; anything else (SVG, say) is never served.
export function imageType(bytes) {
  const hex = bytes.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp';
  return null;
}

// A prompt's own images and those in its tool results, in order; the number in an id counts them.
export function lineImages(line, sessionId) {
  let row; try { row = JSON.parse(line); } catch { return []; }
  if (row.type !== 'user' || typeof row.uuid !== 'string' || (row.sessionId && row.sessionId !== sessionId) || !Array.isArray(row.message?.content)) return [];
  const blocks = row.message.content.flatMap(block => block.type === 'image' ? [[block, false]] : block.type === 'tool_result' && Array.isArray(block.content) ? block.content.filter(inner => inner.type === 'image').map(inner => [inner, true]) : []);
  const at = Date.parse(row.timestamp) || null;
  return blocks.flatMap(([block, tool], n) => {
    const data = block.source?.type === 'base64' && typeof block.source.data === 'string' ? block.source.data : '';
    const type = data && data.length * 0.75 <= maxImageBytes && imageType(Buffer.from(data.slice(0, 24), 'base64'));
    return type ? [{ id: `${row.uuid}:${n}`, type, at, tool, data }] : [];
  });
}

// Each complete line after `end` (at most `scanBytes` back from `size`); returns where the next read starts.
const pieceBytes = 8 * 1024 * 1024;
export async function readLines(handle, end, size, scanBytes, onLine) {
  let start = end, aligned = true, length = pieceBytes;
  if (size - start > scanBytes) { start = size - scanBytes; aligned = false; }
  // In pieces, so a long transcript isn't all in memory at once; a line longer than a piece is read again with a bigger one.
  while (start < size) {
    const buffer = Buffer.alloc(Math.min(size - start, length)), { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    if (!bytesRead) break;
    const piece = buffer.subarray(0, bytesRead);
    let from = 0, to;
    // A tail read starts mid-line; the first full line follows the first newline.
    if (!aligned) { from = piece.indexOf(10) + 1; if (!from) { start += bytesRead; continue; } aligned = true; }
    while ((to = piece.indexOf(10, from)) >= 0) { onLine(piece.subarray(from, to), start + from); from = to + 1; }
    if (from) { start += from; length = pieceBytes; continue; }
    // A line still being written is read again next time.
    if (start + bytesRead >= size) break;
    length *= 2;
  }
  return start;
}

export class TranscriptImages {
  cache = new Map();
  // `scanBytes` bounds the first look at a transcript (and a burst of output since the last one) to its tail.
  constructor({ scanBytes = 8 * 1024 * 1024 } = {}) { this.scanBytes = scanBytes; }

  // Newest last. Transcripts only grow, so after the first scan only the appended bytes are read.
  async list(path, sessionId) {
    const handle = await open(path, 'r');
    try { return (await this.scan(handle, path, sessionId)).images.map(({ offset, length, ...image }) => image); } finally { await handle.close(); }
  }

  async get(path, sessionId, id) {
    const handle = await open(path, 'r');
    try {
      const found = (await this.scan(handle, path, sessionId)).images.find(image => image.id === id);
      if (!found) return null;
      const line = Buffer.alloc(found.length);
      await handle.read(line, 0, found.length, found.offset);
      const image = lineImages(line.toString('utf8'), sessionId).find(image => image.id === id);
      const data = image && Buffer.from(image.data, 'base64');
      return data && imageType(data) === found.type ? { type: found.type, data } : null;
    } finally { await handle.close(); }
  }

  async scan(handle, path, sessionId) {
    const { size } = await handle.stat(), cached = this.cache.get(path);
    // A copy, so two requests scanning at once can't both append the same images.
    const entry = cached && cached.end <= size ? { end: cached.end, images: [...cached.images] } : { end: 0, images: [] };
    entry.end = await readLines(handle, entry.end, size, this.scanBytes, (line, offset) => {
      if (line.includes(marker)) for (const { data, ...image } of lineImages(line.toString('utf8'), sessionId)) entry.images.push({ ...image, offset, length: line.length });
    });
    entry.images = entry.images.slice(-imageLimit);
    this.cache.delete(path); this.cache.set(path, entry);
    if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value);
    return entry;
  }
}
