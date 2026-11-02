import { createHash } from 'node:crypto';
import { fail } from './requests.mjs';
import { imageType } from './images.mjs';

export const maxUploads = 4;
export const maxUploadBytes = 8 * 1024 * 1024;
export const uploadBodyLimit = Math.ceil(maxUploads * maxUploadBytes * 4 / 3) + 256 * 1024;
export const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Images attached to a message arrive as base64. The bytes decide the type, never the browser's claim,
// and a name is only a label: no path ever comes from the request.
export function uploadedImages(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxUploads) throw fail(`Attach up to ${maxUploads} images.`);
  return value.map((item, index) => {
    const text = typeof item?.data === 'string' ? item.data : '';
    if (!text || text.length * 0.75 > maxUploadBytes + 3 || text.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw fail('One of the images could not be read.');
    const bytes = Buffer.from(text, 'base64'), type = imageType(bytes);
    if (!type || bytes.length > maxUploadBytes) throw fail('Attach PNG, JPEG, GIF or WebP images up to 8 MB.');
    const name = typeof item.name === 'string' ? item.name.replace(/[^\w. -]/g, '').slice(0, 80) : '';
    return { type, bytes, base64: text, name: name || `image-${index + 1}.${extensions[type]}`, url: `data:${type};base64,${text}` };
  });
}

// Two submissions with one message ID are the same only if their images are too.
export const uploadDigest = images => images.map(image => createHash('sha256').update(image.bytes).digest('hex')).join();
