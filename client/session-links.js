// The sessions a message names as Claude does ("tankgame-e4"), by name; null where two share one. A message that gives
// one such name in full also means its siblings by "-c6" (not "-10", which reads as a number).
export function sessionNames(text, sessions) {
  const names = new Map(), known = [];
  const add = (name, session) => names.set(name, names.has(name) && names.get(name) !== session ? null : session);
  // A name that is a plain word or a phrase (one the user typed) would match ordinary text.
  for (const session of sessions) for (const name of session.peerNames || []) if (/^\S*[-\d]\S*$/.test(name)) known.push([name, session]);
  for (const [name, session] of known) if (text.includes(name)) add(name, session);
  const stems = new Set([...names.keys()].map(name => name.slice(0, name.lastIndexOf('-') + 1)));
  for (const [name, session] of known) {
    const at = name.lastIndexOf('-'), short = name.slice(at);
    if (at > 0 && /^-(?=.*[a-f])[\da-f]{2}$/.test(short) && stems.has(name.slice(0, at + 1)) && text.includes(short)) add(short, session);
  }
  return names;
}

// Text split after each name ("tankgame-e4's" included); `session` is the one a segment ends on. Paths and longer words are no match.
export function sessionSegments(text, names) {
  if (!names.size) return [{ text }];
  const any = [...names.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const segments = []; let at = 0;
  for (const found of text.matchAll(new RegExp(`(?<![\\w/.-])(${any})(?:['’]s)?(?![\\w/-]|\\.\\w)`, 'g'))) {
    const session = names.get(found[1]), end = found.index + found[0].length;
    if (session) { segments.push({ text: text.slice(at, end), session }); at = end; }
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
