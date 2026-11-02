import { compareSessions } from './session-order.js';

// The live feed: every session's recent messages, tool calls and screenshots on one timeline, newest last. Back-to-back
// items from one session share a group; tool calls in a row fold into one run, screenshots from one side into one strip.
export const feedLimit = 160;
export function feedGroups(sessions, imagesFor, { subagents = true, tools = true, limit = feedLimit } = {}) {
  const items = [];
  for (const session of sessions) {
    if (session.parentId && !subagents) continue;
    for (const message of session.messages || []) if (message.timestamp && (tools || !message.tool)) items.push({ session, message, at: message.timestamp });
    for (const image of imagesFor(session) || []) if (image.at) items.push({ session, image, at: image.at });
  }
  // Stable, so a session's own order holds for equal times.
  items.sort((a, b) => a.at - b.at);
  const groups = [];
  for (const { session, message, image, at } of items.slice(-limit)) {
    let group = groups.at(-1);
    if (group?.session.id !== session.id) groups.push(group = { session, key: `${session.id}|${image ? `shot:${image.id}` : message.id}`, entries: [], at });
    group.at = at;
    const last = group.entries.at(-1);
    if (image) { if (last?.shots && last.user === !image.tool) last.shots.push(image); else group.entries.push({ shots: [image], user: !image.tool }); }
    else if (message.tool && Array.isArray(last)) last.push(message);
    else group.entries.push(message.tool ? [message] : message);
  }
  return groups;
}

// Along the feed's top: who needs you, who's working and whose finished work you haven't seen, in the list's order.
export function feedNow(sessions, { subagents = true, unread = () => false } = {}) {
  return sessions.filter(session => (subagents || !session.parentId) && (['permission', 'question', 'working'].includes(session.status) || unread(session))).sort(compareSessions);
}
