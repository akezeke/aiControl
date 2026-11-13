import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';

export const canUsePasskeys = () => !!globalThis.isSecureContext && browserSupportsWebAuthn();
export const cancelPasskey = () => WebAuthnAbortService.cancelCeremony();
export function passkeyError(error) {
  const name = error.cause?.name || error.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Passkey canceled. Try again or use your PIN or password.';
  if (name === 'InvalidStateError') return 'This device already has a passkey.';
  if (name === 'SecurityError') return 'Open the trusted HTTPS address to use passkeys.';
  return error.code ? 'Passkey unavailable. Use your PIN or password.' : error.message;
}
export async function unlockWithPasskey(api) {
  const { options } = await api('passkeys/login/options', {});
  const response = await startAuthentication({ optionsJSON: options });
  return api('passkeys/login/verify', { response });
}

export function passkeySettings({ api, el, button, current }) {
  const section = el('section', 'passkey-settings'), heading = el('div', 'passkey-heading');
  const list = el('div', 'passkey-list'), note = el('p', 'muted passkey-note');
  const error = el('p', 'form-error passkey-error'); error.setAttribute('role', 'alert');
  const add = button('Add passkey', 'quiet-button', () => action(async () => {
    const { options, challengeId } = await api('passkeys/register/options', { password: current.value });
    const response = await startRegistration({ optionsJSON: options });
    await api('passkeys/register/verify', { challengeId, response });
  }), 'key');
  add.title = 'Face ID, Touch ID or your device’s passkey verification'; add.disabled = true;
  heading.append(el('span', '', 'Passkeys'), add); section.append(heading, note, list, error);
  let busy = false, supported = false;
  const setBusy = value => {
    busy = value; section.setAttribute('aria-busy', String(value));
    for (const control of section.querySelectorAll('button')) control.disabled = value;
    add.disabled = value || !supported || !canUsePasskeys();
  };
  async function load() {
    const data = await api('passkeys');
    if (!section.isConnected) return;
    supported = data.supported;
    note.textContent = !supported ? 'Use HTTPS to enable Face ID and passkeys.' : !canUsePasskeys() ? 'This browser cannot create passkeys.' : '';
    note.hidden = !note.textContent;
    list.replaceChildren(...data.passkeys.map(key => {
      const row = el('div', 'passkey-row'), date = new Date(key.createdAt);
      const label = el('span', '', `Passkey · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`); label.title = date.toLocaleString();
      const remove = button('Remove', 'quiet-button', () => action(() => api('passkeys/remove', { id: key.id, password: current.value })), 'close');
      remove.setAttribute('aria-label', 'Remove passkey'); remove.title = `Remove passkey added ${date.toLocaleString()}`;
      row.append(label, remove); return row;
    }));
    setBusy(busy);
  }
  async function action(work) {
    if (busy) return;
    error.textContent = '';
    if (!current.value) { error.textContent = 'Enter your current PIN or password above.'; current.focus(); return; }
    setBusy(true);
    try { await work(); current.value = ''; await load(); }
    catch (e) { if (section.isConnected) error.textContent = passkeyError(e); }
    finally { setBusy(false); }
  }
  load().catch(e => { if (section.isConnected) error.textContent = e.message; });
  return section;
}
