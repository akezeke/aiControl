export const maxImages = 4;
const direct = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const imageFiles = list => [...list || []].filter(file => file?.type?.startsWith('image/'));
export function fitSize(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

// Small PNG, JPEG, WebP and GIF files go as they are. Anything bigger, or in another format the browser can decode
// (HEIC on Safari), is redrawn as a JPEG that fits `limit` bytes: the providers shrink large images anyway.
export async function prepareImage(file, { limit = 2.5 * 1024 * 1024, edges = [2000, 1400, 1000] } = {}) {
  if (direct.has(file.type) && file.size <= limit) return { name: file.name, type: file.type, blob: file };
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image could not be read.'); }
  try {
    for (const edge of edges) {
      const [width, height] = fitSize(bitmap.width, bitmap.height, edge);
      const canvas = Object.assign(document.createElement('canvas'), { width, height }), context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', edge > 1000 ? .85 : .7));
      if (blob && (blob.size <= limit || edge === edges.at(-1))) return { name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', blob };
    }
  } finally { bitmap.close?.(); }
  throw new Error('This image could not be read.');
}

export const toBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
  reader.onerror = () => reject(new Error('This image could not be read.'));
  reader.readAsDataURL(blob);
});

export async function attachment(file) {
  const { name, type, blob } = await prepareImage(file);
  return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: name || 'image', type, data: await toBase64(blob), url: URL.createObjectURL(blob), size: blob.size };
}

export const releaseImages = images => { for (const image of images) URL.revokeObjectURL(image.url); };
