// The slip that comes up from the meetings clipboard by the door (room.js; boards.js writes its page): a meeting code and a
// name to join a meeting at a friend's office, or who you are there and Leave. It's Trickshot's copy line's slip (.office-copyline), so
// the office takes no keys while it's up (scene-keys.js); Esc, its ✕ or a press anywhere else puts it away.
import { FRUITS, COLOURS } from './meeting.js';
import { pickerState } from './live.js';
import { copyText } from './boards.js';
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
// What the slip offers: the form while not in a meeting or once its code was replaced, Leave whenever you're in one (a
// replaced code you'll never get again has to be left somehow), and what to say about the hub.
export const slipMode = state => ({ form: !state?.joined || state.error === 'code', signOut: !!state?.joined, said: state?.error === 'code' ? 'The code was changed' : state?.outdated ? 'Update AI Control' : state?.out ? (state.out === 'away' ? 'Away 2 days' : 'Removed by the host') : state?.refused === 'colour' ? ((state.taken?.length ?? 0) >= COLOURS.length ? 'All colours are taken.' : 'That colour is taken.') : state?.offline ? 'Off for now' : '', code: state?.hosting && state.code ? state.code : '' });

// What the pickers show: what you just picked, else what you wear in the room (`mine`, pickerState's: the hub hands out
// another colour when yours is taken), else what's saved.
export const slipLook = (picked, mine, saved) => ({ fruit: picked?.fruit ?? mine.fruit ?? saved?.fruit ?? FRUITS[0][0], colour: picked?.colour ?? mine.colour ?? saved?.colour ?? COLOURS[0] });

// Short names for the swatches' aria-labels, in COLOURS' order.
export const COLOUR_NAMES = ['pink', 'blue', 'purple', 'mint', 'yellow', 'orange', 'cyan', 'white'];

// `live` (optional): the page's live link, for whose colours are taken. `recheckMs`: how soon after a removal the slip asks for a fresh board.
export function createSignIn(container, online, live = null, { recheckMs = 1000 } = {}) {
  const slip = el('div', { className: 'office-copyline office-signin', hidden: true }); container.append(slip);
  const close = () => { if (slip.hidden) return; slip.hidden = true; if (slip.contains(document.activeElement)) document.activeElement.blur(); };
  slip.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); } });
  const away = event => { if (!slip.hidden && !slip.contains(event.target)) close(); };
  document.addEventListener('pointerdown', away, true);
  let typed = { code: '', name: '' }, picked = null; // a fruit and colour chosen before joining, kept for Join
  let note = '', joinTaken = null, gone = new Map(); // the live link's colour refusal; what a refused Join says is taken; names just removed, with the board then
  const fresh = () => { note = ''; joinTaken = null; }, timers = new Set();
  live?.on?.('refused', m => { if (m?.why === 'colour') { note = 'That colour is taken.'; picked = null; refresh(); } });
  // A removal sent: its chip stays dimmed until a board newer than the click, and the slip asks for one shortly after (the same
  // board back, the remove never got there: the chip comes back).
  const removing = (key, board) => {
    const mark = { board }; gone.set(key, mark);
    const back = () => { if (gone.get(key) === mark) { gone.delete(key); refresh(); } };
    const t = setTimeout(() => { timers.delete(t); Promise.resolve(online.sync?.(true)).then(back, back); }, recheckMs); timers.add(t);
  };

  // What the slip says now; `error`, what went wrong last. Typed text survives a redraw.
  function render(error = '', taken) {
    if (taken) joinTaken = taken;
    const state = online.state(), mode = slipMode(state), said = error || mode.said || note;
    slip.replaceChildren();
    const roster = live?.roster() ?? [], mine = pickerState(roster, live?.id?.()), { fruit, colour } = slipLook(picked, mine, state?.look);
    const pick = next => { fresh(); picked = { fruit, colour, ...next }; if (state?.joined) online.setLook(picked.fruit, picked.colour).then(() => { picked = null; render(); }, e => render(e.message)); else render(); };
    const board = JSON.stringify(state?.board ?? null);
    for (const [key, mark] of gone) if (mark.board !== board) gone.delete(key); // a newer board: the chip follows it
    const me = state?.name?.toLowerCase(), players = (state?.board?.players ?? []).filter(p => p.in && p.name.toLowerCase() !== me);
    const held = new Set([...mine.taken, ...players.map(p => p.colour), ...(joinTaken ?? state?.taken ?? [])]);
    const fruits = el('div', { className: 'office-signin-row office-signin-fruit' }), swatches = el('div', { className: 'office-signin-row office-signin-colours' });
    for (const [id, emoji] of FRUITS) { const b = el('button', { type: 'button', textContent: emoji, className: id === fruit ? 'on' : '', title: id }); b.setAttribute('aria-label', id); b.setAttribute('aria-pressed', String(id === fruit)); b.onclick = () => pick({ fruit: id }); fruits.append(b); }
    COLOURS.forEach((c, i) => { const b = el('button', { type: 'button', className: 'office-signin-swatch' + (c === colour ? ' on' : ''), disabled: held.has(c) && c !== colour, title: COLOUR_NAMES[i] }); b.style.background = c; b.setAttribute('aria-label', COLOUR_NAMES[i]); b.setAttribute('aria-pressed', String(c === colour)); b.onclick = () => pick({ colour: c }); swatches.append(b); });
    slip.append(fruits, swatches);
    if (!mode.form) slip.append(el('span', { className: 'office-signin-who', textContent: `${state.name} · at ${state.host}` }));
    else {
      const form = el('form', { className: 'office-signin-form' });
      const code = el('input', { value: typed.code, placeholder: state?.again ? 'Saved code' : 'Meeting code', autocomplete: 'off', spellcheck: false, required: !state?.again }); // signed out for being away: blank Join uses the code the server kept
      const name = el('input', { value: typed.name || state?.name || '', placeholder: 'Name', maxLength: 16, autocomplete: 'nickname', required: true });
      // Kept as typed: picking a fruit or colour draws the slip again.
      code.oninput = () => { typed.code = code.value; }; name.oninput = () => { typed.name = name.value; };
      code.setAttribute('aria-label', 'Meeting code'); name.setAttribute('aria-label', 'Your name');
      const go = el('button', { type: 'submit', textContent: 'Join' });
      form.onsubmit = async event => {
        event.preventDefault(); typed = { code: code.value, name: name.value }; go.disabled = true;
        try { if (picked) { await online.setLook(picked.fruit, picked.colour); picked = null; } await online.signIn(code.value, name.value); typed = { code: '', name: '' }; fresh(); render(); } catch (e) { render(e.message, e.taken); }
      };
      form.append(code, name, go); slip.append(form);
    }
    if (mode.code) {
      const field = el('input', { value: mode.code, readOnly: true, spellcheck: false, className: 'office-signin-code' }), copy = el('button', { type: 'button', textContent: 'Copy' });
      field.setAttribute('aria-label', 'Meeting code'); field.onfocus = () => field.select();
      const copied = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); };
      copy.onclick = () => copyText(mode.code, copied, () => { field.focus(); field.select(); });
      slip.append(field, copy);
      for (const { name } of players) {
        const key = name.toLowerCase(), dim = gone.has(key);
        const chip = el('button', { type: 'button', className: 'office-signin-chip' + (dim ? ' dim' : ''), disabled: dim, textContent: `${name} ✕`, title: `Remove ${name}` });
        chip.setAttribute('aria-label', chip.title);
        chip.onclick = () => { live?.send?.({ type: 'remove', name }); removing(key, board); chip.disabled = true; chip.className += ' dim'; };
        slip.append(chip);
      }
    }
    if (mode.signOut) {
      const out = el('button', { type: 'button', textContent: 'Leave', title: `Leave the meeting at ${state.host}` });
      out.onclick = async () => { out.disabled = true; try { await online.signOut(); fresh(); render(); } catch (e) { render(e.message); } };
      slip.append(out);
    }
    if (said) slip.append(el('span', { className: 'office-signin-error', textContent: said, role: 'status' }));
    const x = el('button', { type: 'button', className: 'office-signin-close', textContent: '✕', title: 'Close (Esc)' });
    x.setAttribute('aria-label', 'Close'); x.onclick = close; slip.append(x);
  }

  // The board or the room changed while the slip is up (a sync came back, someone took a colour): say so, unless something's
  // being typed. A focused button is focused again after.
  function refresh() {
    const at = document.activeElement, mine = slip.contains(at);
    if (slip.hidden || (mine && at.tagName === 'INPUT')) return;
    const label = mine ? at.getAttribute('aria-label') || at.textContent : null;
    render();
    if (label) [...slip.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent) === label)?.focus();
  }

  return {
    open() { fresh(); render(); slip.hidden = false; (slip.querySelector('input:placeholder-shown') || slip.querySelector('button'))?.focus(); },
    close,
    refresh,
    dispose() { for (const t of timers) clearTimeout(t); document.removeEventListener('pointerdown', away, true); slip.remove(); },
  };
}
