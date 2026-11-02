// Markdown files named in message text: `docs/plan.md`, not a web address or plan.mdx. The server looks for the same names.
export const documentPattern = /(?<![\w/:.@+~-])(?:[\w.~@+-]*\/)*[\w.@+-]+\.md(?!\.?[\w/-])/g;
export const documentNames = text => text.match(documentPattern) || [];

// The document a name means: its exact path, a path under the session's folder, or else the one path ending that way.
export function matchDocument(name, documents, cwd) {
  if (name.startsWith('/')) return documents.find(({ path }) => path === name) || null;
  const relative = name.replace(/^~\//, '').replace(/^(?:\.{1,2}\/)+/, '');
  const inFolder = cwd && documents.find(({ path }) => path === `${cwd}/${relative}`);
  if (inFolder) return inFolder;
  const ending = documents.filter(({ path }) => path.endsWith(`/${relative}`));
  return ending.length === 1 ? ending[0] : null;
}

// Text split around the names that match; a `document` marks each of those.
export function documentSegments(text, documents, cwd) {
  const segments = []; let at = 0;
  for (const found of text.matchAll(documentPattern)) {
    const document = matchDocument(found[0], documents, cwd);
    if (!document) continue;
    if (found.index > at) segments.push({ text: text.slice(at, found.index) });
    segments.push({ text: found[0], document }); at = found.index + found[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
