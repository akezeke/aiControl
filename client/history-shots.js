// Screenshots go where they were taken; a run of them from the same side shares one strip. Documents go where they were
// written, in runs of their own. Ones older than the loaded history wait for "Older messages".
export function placeShots(items, images, documents = []) {
  const time = item => (Array.isArray(item) ? item[0] : item).timestamp || 0, start = items.length ? time(items[0]) : 0;
  const when = thing => thing.at || Infinity;
  const placed = [...images, ...documents.map(document => ({ document, at: document.at }))].sort((a, b) => when(a) === when(b) ? 0 : when(a) - when(b));
  const out = []; let next = 0;
  for (const image of placed) {
    if (image.at && start && image.at < start) continue;
    while (next < items.length && (!image.at || time(items[next]) <= image.at)) out.push(items[next++]);
    const last = out.at(-1);
    if (image.document) { if (last?.docs) last.docs.push(image.document); else out.push({ docs: [image.document] }); }
    else if (last?.shots && last.user === !image.tool) last.shots.push(image); else out.push({ shots: [image], user: !image.tool });
  }
  return [...out, ...items.slice(next)];
}
