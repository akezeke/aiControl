export const shotUrl = (id, imageId) => `/api/sessions/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`;

export function takeShotContainer(containers, images, sessionId, preferred) {
  // The leading image (and therefore the container key) changes when history rolls over.
  const ids = new Set(images.map(image => image.id));
  const node = containers.has(preferred) ? preferred : [...containers].find(node =>
    (sessionId === undefined || node.dataset.sessionId === sessionId) &&
    [...node.querySelectorAll('[data-image-id]')].some(thumb => ids.has(thumb.dataset.imageId)));
  if (node) containers.delete(node);
  return node;
}

export function shotStrip(id, { shots: group, user }, previous, open) {
  const strip = previous || document.createElement('div'); strip.className = `history-shots${user ? ' user' : ''}`;
  const existing = new Map([...strip.children].map(node => [node.dataset.imageId, node]));
  const children = group.map(image => {
    let thumb = existing.get(image.id);
    if (!thumb) {
      thumb = document.createElement('button'); thumb.className = 'history-shot'; thumb.type = 'button'; thumb.setAttribute('aria-label', 'Screenshot');
      thumb.dataset.imageId = image.id;
      const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = shotUrl(id, image.id);
      thumb.append(img);
    }
    thumb.title = [image.agent, image.at && new Date(image.at).toLocaleString()].filter(Boolean).join(' · ');
    thumb.onclick = () => open(id, image.id);
    return thumb;
  });
  // Extending a strip must not remount or reset src on already decoded images.
  for (const node of [...strip.children]) if (!children.includes(node)) node.remove();
  children.forEach((node, index) => { if (strip.children[index] !== node) strip.insertBefore(node, strip.children[index] || null); });
  return strip;
}
