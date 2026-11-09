// The slip that comes up from the meetings clipboard by the door (room.js; boards.js writes its page): a meeting code and a
// name to join a meeting at a friend's office, or who you are there and Leave. It's Trickshot's copy line's slip (.office-copyline), so
// the office takes no keys while it's up (scene-keys.js); Esc, its ✕ or a press anywhere else puts it away.
import { FRUITS, COLOURS } from './meeting.js';
import { pickerState } from './live.js';
import { copyText } from './boards.js';
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
// What the slip offers: the form while not in a meeting or once its code was replaced, Leave whenever you're in one (a
// replaced code you'll never get again has to be left somehow), and what to say about the hub.
export const slipMode = state => ({ form: !state?.joined || state.error === 'code', signOut: !!state?.joined, said: state?.error === 'code' ? 'The code was changed' : state?.offline ? 'Off for now' : '', code: state?.hosting && state.code ? state.code : '' });

// Short names for the swatches' aria-labels, in COLOURS' order.
export const COLOUR_NAMES = ['pink', 'blue', 'purple', 'mint', 'yellow', 'orange', 'cyan', 'white'];

// `live` (optional): the page's live link, for whose colours are taken.
export function createSignIn(container, online, live = null) {
  const slip = el('div', { className: 'office-copyline office-signin', hidden: true }); container.append(slip);
  const close = () => { if (slip.hidden) return; slip.hidden = true; if (slip.contains(document.activeElement)) document.activeElement.blur(); };
  slip.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); } });
  const away = event => { if (!slip.hidden && !slip.contains(event.target)) close(); };
  document.addEventListener('pointerdown', away, true);
  let typed = { code: '', name: '' }, picked = null; // a fruit and colour chosen before joining, kept for Join

  // What the slip says now; `error`, what went wrong last. Typed text survives a redraw.
  function render(error = '') {
    const state = online.state(), mode = slipMode(state), said = error || mode.said;
    slip.replaceChildren();
    const roster = live?.roster() ?? [], mine = pickerState(roster, live?.id?.()), look = picked ?? state?.look ?? {};
    const fruit = look.fruit ?? mine.fruit ?? FRUITS[0][0], colour = look.colour ?? mine.colour ?? COLOURS[0];
    const pick = next => { picked = { fruit, colour, ...next }; if (state?.joined) online.setLook(picked.fruit, picked.colour).then(() => { picked = null; render(); }, e => render(e.message)); else render(); };
    const fruits = el('div', { className: 'office-signin-row office-signin-fruit' }), swatches = el('div', { className: 'office-signin-row office-signin-colours' });
    for (const [id, emoji] of FRUITS) { const b = el('button', { type: 'button', textContent: emoji, className: id === fruit ? 'on' : '', title: id }); b.setAttribute('aria-label', id); b.setAttribute('aria-pressed', String(id === fruit)); b.onclick = () => pick({ fruit: id }); fruits.append(b); }
    COLOURS.forEach((c, i) => { const b = el('button', { type: 'button', className: 'office-signin-swatch' + (c === colour ? ' on' : ''), disabled: mine.taken.has(c) && c !== colour, title: COLOUR_NAMES[i] }); b.style.background = c; b.setAttribute('aria-label', COLOUR_NAMES[i]); b.setAttribute('aria-pressed', String(c === colour)); b.onclick = () => pick({ colour: c }); swatches.append(b); });
    slip.append(fruits, swatches);
    if (!mode.form) slip.append(el('span', { className: 'office-signin-who', textContent: `${state.name} · at ${state.host}` }));
    else {
      const form = el('form', { className: 'office-signin-form' });
      const code = el('input', { value: typed.code, placeholder: 'Meeting code', autocomplete: 'off', spellcheck: false, required: true });
      const name = el('input', { value: typed.name || state?.name || '', placeholder: 'Name', maxLength: 16, autocomplete: 'nickname', required: true });
      // Kept as typed: picking a fruit or colour draws the slip again.
      code.oninput = () => { typed.code = code.value; }; name.oninput = () => { typed.name = name.value; };
      code.setAttribute('aria-label', 'Meeting code'); name.setAttribute('aria-label', 'Your name');
      const go = el('button', { type: 'submit', textContent: 'Join' });
      form.onsubmit = async event => {
        event.preventDefault(); typed = { code: code.value, name: name.value }; go.disabled = true;
        try { if (picked) { await online.setLook(picked.fruit, picked.colour); picked = null; } await online.signIn(code.value, name.value); typed = { code: '', name: '' }; render(); } catch (e) { render(e.message); }
      };
      form.append(code, name, go); slip.append(form);
    }
    if (mode.code) {
      const field = el('input', { value: mode.code, readOnly: true, spellcheck: false, className: 'office-signin-code' }), copy = el('button', { type: 'button', textContent: 'Copy' });
      field.setAttribute('aria-label', 'Meeting code'); field.onfocus = () => field.select();
      const copied = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); };
      copy.onclick = () => copyText(mode.code, copied, () => { field.focus(); field.select(); });
      slip.append(field, copy);
    }
    if (mode.signOut) {
      const out = el('button', { type: 'button', textContent: 'Leave', title: `Leave the meeting at ${state.host}` });
      out.onclick = async () => { out.disabled = true; try { await online.signOut(); render(); } catch (e) { render(e.message); } };
      slip.append(out);
    }
    if (said) slip.append(el('span', { className: 'office-signin-error', textContent: said, role: 'status' }));
    const x = el('button', { type: 'button', className: 'office-signin-close', textContent: '✕', title: 'Close (Esc)' });
    x.setAttribute('aria-label', 'Close'); x.onclick = close; slip.append(x);
  }

  return {
    open() { render(); slip.hidden = false; (slip.querySelector('input:placeholder-shown') || slip.querySelector('button'))?.focus(); },
    close,
    // The board changed while the slip is up (a sync came back): say so, unless something's being typed.
    refresh() { if (!slip.hidden && !slip.contains(document.activeElement)) render(); },
    dispose() { document.removeEventListener('pointerdown', away, true); slip.remove(); },
  };
}
