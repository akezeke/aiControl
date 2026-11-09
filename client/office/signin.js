// The slip that comes up from the meetings clipboard by the door (room.js; boards.js writes its page): a meeting code and a
// name to join a meeting at a friend's office, or who you are there and Leave. It's Trickshot's copy line's slip (.office-copyline), so
// the office takes no keys while it's up (scene-keys.js); Esc, its ✕ or a press anywhere else puts it away.
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
// What the slip offers: the form while not in a meeting or once its code was replaced, Leave whenever you're in one (a
// replaced code you'll never get again has to be left somehow), and what to say about the hub.
export const slipMode = state => ({ form: !state?.joined || state.error === 'code', signOut: !!state?.joined, said: state?.error === 'code' ? 'The code was changed' : state?.offline ? 'Off for now' : '' });

export function createSignIn(container, online) {
  const slip = el('div', { className: 'office-copyline office-signin', hidden: true }); container.append(slip);
  const close = () => { if (slip.hidden) return; slip.hidden = true; if (slip.contains(document.activeElement)) document.activeElement.blur(); };
  slip.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); } });
  const away = event => { if (!slip.hidden && !slip.contains(event.target)) close(); };
  document.addEventListener('pointerdown', away, true);
  let typed = { code: '', name: '' };

  // What the slip says now; `error`, what went wrong last. Typed text survives a redraw.
  function render(error = '') {
    const state = online.state(), mode = slipMode(state), said = error || mode.said;
    slip.replaceChildren();
    if (!mode.form) slip.append(el('span', { className: 'office-signin-who', textContent: `${state.name} · at ${state.host}` }));
    else {
      const form = el('form', { className: 'office-signin-form' });
      const code = el('input', { value: typed.code, placeholder: 'Meeting code', autocomplete: 'off', spellcheck: false, required: true });
      const name = el('input', { value: typed.name || state?.name || '', placeholder: 'Name', maxLength: 16, autocomplete: 'nickname', required: true });
      code.setAttribute('aria-label', 'Meeting code'); name.setAttribute('aria-label', 'Your name');
      const go = el('button', { type: 'submit', textContent: 'Join' });
      form.onsubmit = async event => {
        event.preventDefault(); typed = { code: code.value, name: name.value }; go.disabled = true;
        try { await online.signIn(code.value, name.value); typed = { code: '', name: '' }; render(); } catch (e) { render(e.message); }
      };
      form.append(code, name, go); slip.append(form);
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
