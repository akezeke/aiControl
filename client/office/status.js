// What a session looks like in the office: its pose, face, speech bubble and monitor, and its fixed fruit identity. Pure.
export const FRUITS = ['apple', 'pear', 'banana', 'orange', 'lemon', 'eggplant', 'strawberry'];
const palettes = {
  apple: ['#d62828', '#7cb518', '#f2c14e'], pear: ['#b5c934', '#e0b73f'], banana: ['#f7d23e'], orange: ['#f28c28'],
  lemon: ['#f9e04b'], eggplant: ['#5b2a86', '#7a3ea8'], strawberry: ['#e63946'],
};
const ACCESSORIES = ['glasses', 'tie', 'none'], PROPS = ['plant', 'mug', 'duck', 'frame', 'cactus', 'books'];
const MAX_TEXT = 48;

const looks = {
  working: ['typing', 'smile', '⌨️', 'green'],
  thinking: ['thinking', 'thinking', '💭', 'green'],
  compacting: ['squeezing', 'squeezed', '🗜️', 'green'],
  permission: ['waving', 'worried', '✋', 'amber'],
  question: ['raising', 'curious', '❓', 'amber'],
  idle: ['sleeping', 'asleep', '💤', 'dark'],
  error: ['slumped', 'frown', '⚠️', 'red'],
};
// A working bubble's icon follows the running call's tool: "Edit · office/room.js" gets a pencil. Shells and the rest type.
const toolIcons = [[/^(Edit|Write|MultiEdit|NotebookEdit)\b/, '✏️'], [/^Read\b/, '📖'], [/^(Grep|Glob|Search|WebSearch|ToolSearch)\b/, '🔍'], [/^WebFetch\b/, '🌐'], [/^(Agent|Task)\b/, '👥']];
const toolIcon = detail => toolIcons.find(([pattern]) => pattern.test(detail || ''))?.[1] || looks.working[2];
const oneLine = text => {
  const line = String(text || '').split('\n').find(part => part.trim())?.trim() || '';
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
};

// `activity` is 'thinking' while the model works out its next step (Codex reasoning, or a quiet Claude transcript),
// and 'compacting' while it squeezes its context down to a summary.
export function officeStatus(session, now = Date.now()) {
  const activity = session.status === 'working' && ['thinking', 'compacting'].includes(session.activity) ? session.activity : '', look = looks[activity || session.status];
  if (!look) return { pose: 'still', expression: 'neutral', bubble: null, screen: 'off', wear: 0, cups: 0 };
  const [pose, expression, icon, screen] = look, request = session.requests?.[0]?.title;
  const text = activity ? { thinking: 'Thinking', compacting: 'Compacting' }[activity] : {
    working: session.detail || 'Working',
    permission: request || 'Needs permission',
    question: request || session.asks || 'Has a question',
    idle: '',
    error: session.detail || 'Error',
  }[session.status];
  // Helpers on a desk only chat while working, but always speak up when they need you.
  const talks = !session.parentId || session.status === 'working' || screen === 'amber';
  const shown = !activity && session.status === 'working' ? toolIcon(session.detail) : icon;
  return { pose, expression, screen, bubble: talks ? { icon: shown, text: oneLine(text), highlight: screen === 'amber' } : null, ...tiredness(session, now) };
}

// Minutes since the latest prompt (or the oldest message still in view), up to now while working, else to the last message.
function turnMinutes(session, now) {
  const messages = (session.messages || []).filter(message => message.timestamp);
  const start = messages.findLast(message => message.role === 'user' && !message.tool) || messages[0];
  if (!start) return 0;
  return Math.max(0, (session.status === 'working' ? now : messages.at(-1).timestamp) - start.timestamp) / 60_000;
}
// Wear (0..1, in tenths so it changes rarely) builds up over the last stretch before auto-compact (at about 83% of the window;
// a compaction leaves about a third), and a little over a long turn; a coffee cup joins the desk at each of CUPS minutes into the turn.
const CUPS = [3, 10, 20, 35, 60, 90];
export function tiredness(session, now = Date.now()) {
  const { used = 0, window } = session.context || {}, fill = used / (window || (used > 200_000 ? 1_000_000 : 200_000)), minutes = turnMinutes(session, now);
  const clamp = value => Math.min(1, Math.max(0, value));
  const wear = Math.max(clamp((fill - 0.5) / 0.33), 0.6 * clamp(minutes / 120));
  return { wear: Math.round(wear * 10) / 10, cups: CUPS.filter(at => minutes >= at).length };
}

// 32-bit FNV-1a; each trait salts the id so traits don't move together.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function identity(id) {
  const pick = (list, salt) => list[hash(`${salt}:${id}`) % list.length];
  const fruit = pick(FRUITS, 'fruit');
  return {
    fruit, color: pick(palettes[fruit], 'color'), accessory: pick(ACCESSORIES, 'accessory'),
    props: PROPS.filter(prop => hash(`${prop}:${id}`) % 3 === 0).slice(0, 3), notes: Math.min(3, hash(`notes:${id}`) % 5), // post-its on the monitor
  };
}

// What the session's monitor shows: its title and last few message lines, newest at the bottom.
export function monitorLines(session, count = 6) {
  const lines = (session.messages || []).slice(-count).map(message => ({
    kind: message.tool ? 'tool' : message.role === 'user' ? 'user' : 'assistant',
    text: oneLine(message.text).replace(/[`*_#>]/g, ''),
  }));
  return { title: session.title || session.project || 'Session', lines };
}

export function isTypingTarget(element) {
  if (!element) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || !!element.isContentEditable || !!element.closest?.('#panel');
}
