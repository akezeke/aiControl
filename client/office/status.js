// What a session looks like in the office: its pose, face, speech bubble and monitor, and its fixed fruit identity. Pure.
export const FRUITS = ['apple', 'pear', 'banana', 'orange', 'lemon', 'eggplant', 'strawberry'];
const palettes = {
  apple: ['#d62828', '#7cb518', '#f2c14e'], pear: ['#b5c934', '#e0b73f'], banana: ['#f7d23e'], orange: ['#f28c28'],
  lemon: ['#f9e04b'], eggplant: ['#5b2a86', '#7a3ea8'], strawberry: ['#e63946'],
};
const ACCESSORIES = ['glasses', 'tie', 'none'], PROPS = ['plant', 'mug', 'duck'];
const MAX_TEXT = 48;

const looks = {
  working: ['typing', 'smile', '⌨️', 'green'],
  permission: ['waving', 'worried', '✋', 'amber'],
  question: ['raising', 'curious', '❓', 'amber'],
  idle: ['sleeping', 'asleep', '💤', 'dark'],
  error: ['slumped', 'frown', '⚠️', 'red'],
};
const oneLine = text => {
  const line = String(text || '').split('\n').find(part => part.trim())?.trim() || '';
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
};

export function officeStatus(session) {
  const look = looks[session.status];
  if (!look) return { pose: 'still', expression: 'neutral', bubble: null, screen: 'off' };
  const [pose, expression, icon, screen] = look, request = session.requests?.[0]?.title;
  const text = {
    working: session.detail || 'Working',
    permission: request || 'Needs permission',
    question: request || 'Has a question',
    idle: '',
    error: session.detail || 'Error',
  }[session.status];
  const talks = !session.parentId || session.status === 'working';
  return { pose, expression, screen, bubble: talks ? { icon, text: oneLine(text), highlight: screen === 'amber' } : null };
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
    props: PROPS.filter(prop => hash(`${prop}:${id}`) % 3 === 0).slice(0, 2),
  };
}

export function isTypingTarget(element) {
  if (!element) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || !!element.isContentEditable || !!element.closest?.('#panel');
}
