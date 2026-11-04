const images = new Map();

export function image(url, onLoad) {
  let entry = images.get(url);
  if (!entry) {
    const img = new Image(); entry = { img, ready: false, failed: false, waiting: new Set() }; images.set(url, entry);
    img.onload = () => { entry.ready = true; for (const notify of entry.waiting) notify(); entry.waiting.clear(); };
    img.onerror = () => { entry.failed = true; entry.waiting.clear(); };
    img.src = url;
  }
  if (!entry.ready && !entry.failed && onLoad) entry.waiting.add(onLoad);
  return entry.ready ? entry.img : null;
}
