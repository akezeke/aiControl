// The boss PC's Notepad: a salaries.txt made up from the live agent sessions. Codex and Claude agents are treated alike
// (`provider` is never read). Nothing runs on its own: the text is rebuilt only when opened or when the office pushes sessions.
import { hash, identity, tiredness } from './status.js';
import { clockOf } from './pc-windows.js';

export const TITLES = [
  'Senior Vibe Engineer', 'Junior Senior Developer', 'Chief Synergy Officer', 'Head of Tabs vs Spaces', 'Principal Copy-Paster',
  'VP of Semicolons', 'Associate Rubber Duck', 'Director of Merge Conflicts', 'Lead Bug Breeder', 'Regional Manager of Null',
  'Staff Prompt Whisperer', 'Intern Emeritus',
];
const NOTES = {
  working: 'raise pending', thinking: 'paid to stare', compacting: 'shredding old memos', waiting: 'paid by the hour, sadly',
  permission: 'asks too many questions', question: 'asks too many questions', idle: 'docked for napping', error: 'under review by HR',
};
const BOSS = ['The Boss', 'Everything', 'Chief Executive Everything', '$9,999,999,999', 'bonus approved'];
const cap = s => s[0].toUpperCase() + s.slice(1);
const money = n => '$' + n.toLocaleString('en-US');

function noteOf(s, now) {
  const key = s.status === 'working' && (s.activity === 'thinking' || s.activity === 'compacting') ? s.activity
    : s.status === 'idle' && s.waitingOn ? 'waiting' : s.status;
  const { cups, wear } = tiredness(s, now);
  return [NOTES[key], cups > 0 && `−${cups} ${cups === 1 ? 'coffee' : 'coffees'}`, wear >= 0.5 && 'overtime',
    s.permissionMode === 'bypassPermissions' && 'security clearance: none'].filter(Boolean).join(', ');
}

export function salariesText(sessions, now) {
  const fruitOf = id => cap(identity(id).fruit);
  const rows = sessions.map(s => {
    const helper = s.parentId != null;
    const project = String(s.project ?? '');
    return {
      id: String(s.id), name: fruitOf(s.id), project: project.length > 16 ? project.slice(0, 15) + '…' : project,
      title: helper ? `Unpaid intern of ${fruitOf(s.parentId)}` : TITLES[hash('title:' + s.id) % 12],
      pay: helper ? 0 : 12000 + (hash('pay:' + s.id) % 89) * 1000, note: noteOf(s, now.getTime()),
    };
  }).sort((a, b) => b.pay - a.pay || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const table = [['Name', 'Project', 'Title', 'Salary', 'Notes'], ...rows.map(r => [r.name, r.project, r.title, money(r.pay), r.note]), BOSS];
  const w = [0, 1, 2, 3].map(i => Math.max(...table.map(r => r[i].length)));
  const line = r => [r[0].padEnd(w[0]), r[1].padEnd(w[1]), r[2].padEnd(w[2]), r[3].padStart(w[3]), r[4]].join('  ').trimEnd();
  const width = w.reduce((a, b) => a + b, 0) + 6;
  return [
    'SALARIES.TXT' + 'CONFIDENTIAL'.padStart(width - 12), `Updated ${clockOf(now)} by HR`, '',
    line(table[0]), ...(rows.length ? table.slice(1, -1).map(line) : ['Everyone fired. Budget: balanced.']), line(BOSS),
  ].join('\n');
}

export function createNotepad({ doc = document, ui } = {}) {
  const node = doc.createElement('textarea');
  node.className = 'pc-notepad'; node.setAttribute('spellcheck', 'false'); node.setAttribute('wrap', 'off'); // wide rows scroll, as with Word Wrap off
  let dirty = false, closeHandler = null;
  node.addEventListener('input', () => { dirty = true; });
  const set = text => { node.value = text; };
  return {
    node,
    open(sessions, now) { set(salariesText(sessions, now)); dirty = false; },
    update(sessions, now, visible) { if (visible && !dirty) set(salariesText(sessions, now)); },
    dirty: () => dirty,
    onClose(fn) { closeHandler = fn; },
    title: () => 'salaries.txt - Notepad',
    menus: () => [{ label: '&File', items: [
      { label: '&Save', run: () => ui.dialog({ icon: 'error', text: 'Access is denied. Only HR may change salaries.', buttons: ['OK'] }) },
      { label: '&Close', run: () => closeHandler?.() },
    ] }],
  };
}

// Canvas stand-in while the window is seen from the 3D desk: the first lines that fit.
export function draw(g, box, { text }) {
  const { x, y, w, h } = box, size = 13, step = 15;
  g.fillStyle = '#fff'; g.fillRect(x, y, w, h);
  g.fillStyle = '#000'; g.font = `${size}px 'Courier Prime', ui-monospace, monospace`; g.textBaseline = 'top';
  const lines = String(text ?? '').split('\n'), count = Math.max(0, Math.floor((h - 4) / step));
  for (let i = 0; i < Math.min(count, lines.length); i++) g.fillText(lines[i], x + 4, y + 2 + i * step, w - 8);
}
