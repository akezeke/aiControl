// iOS Safari keeps the layout viewport full height under the keyboard: interactive-widget=resizes-content
// is in WebKit but not yet in Safari. While a field has focus, fit the panel to the visual viewport, so the
// composer sits on the keyboard. Once a browser resizes the layout viewport this returns null and CSS sizes it.
// Blur restores the CSS size at once, since iOS 26.0 can keep reporting a short viewport after the keyboard.
export function keyboardFrame(viewport, layoutHeight, typing) {
  if (!viewport || !typing || Math.abs(viewport.scale - 1) > 0.01 || layoutHeight - viewport.height < 1) return null;
  return { top: `${Math.round(viewport.offsetTop)}px`, height: `${Math.round(viewport.height)}px` };
}
export function followKeyboard(viewport = globalThis.visualViewport) {
  if (!viewport) return;
  let frame;
  const sync = () => {
    frame = null;
    const panel = document.querySelector('#panel'); if (!panel) return;
    const field = document.activeElement;
    const typing = panel.contains(field) && !!field?.matches?.('input:not([type=file]), textarea, select');
    const { top = '', height = '' } = keyboardFrame(viewport, innerHeight, typing) || {};
    if (panel.style.top !== top || panel.style.height !== height) {
      Object.assign(panel.style, { top, height });
      panel.style.setProperty('--chat-height', height || '100dvh');
      panel.toggleAttribute('data-keyboard', !!height);
    }
  };
  // Focusout's relatedTarget is often null on iOS. Read the settled focus on the
  // next frame, and coalesce keyboard animation/scroll events into one layout.
  const schedule = () => { if (frame == null) frame = requestAnimationFrame(sync); };
  for (const type of ['resize', 'scroll']) viewport.addEventListener(type, schedule);
  for (const type of ['focusin', 'focusout']) document.addEventListener(type, schedule);
  window.addEventListener('resize', schedule);
  schedule();
}

export function sizeComposer(input) {
  let frame, width;
  const resize = () => {
    frame = null;
    if (!input.isConnected || !input.clientWidth) return;
    const scroll = input.scrollTop, style = getComputedStyle(input);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    input.style.height = '0px';
    input.style.height = `${input.scrollHeight + border}px`;
    input.scrollTop = input.selectionStart === input.value.length && input.selectionEnd === input.value.length ? input.scrollHeight : scroll;
  };
  const schedule = () => { if (frame == null) frame = requestAnimationFrame(resize); };
  const observer = new ResizeObserver(entries => {
    const next = entries[0].contentRect.width;
    if (next !== width) { width = next; schedule(); }
    // Opening the keyboard can lower the CSS height cap without changing width.
    // Keep the end caret visible without disturbing an interior selection.
    else if (document.activeElement === input && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) input.scrollTop = input.scrollHeight;
  });
  observer.observe(input); input.addEventListener('input', schedule); schedule();
  return { schedule, destroy() { observer.disconnect(); input.removeEventListener('input', schedule); if (frame != null) cancelAnimationFrame(frame); } };
}

// The textarea owns its text while editing. Polling never writes it back.
export class ComposerInput {
  constructor(input, draft, onControlsChange, {
    delay = 150,
    // Browser timers require the global receiver, even when stored on a helper.
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer),
  } = {}) {
    Object.assign(this, { input, draft, onControlsChange, delay, setTimer, clearTimer });
    this.revision = draft.revision || 0;
    input.value = draft.text;
    this.hasText = !!input.value.trim();
    this.onInput = () => {
      this.dirty = true;
      const hasText = !!input.value.trim(), changed = hasText !== this.hasText || !!draft.notice;
      this.hasText = hasText; draft.notice = '';
      this.cancel();
      if (!this.composing) this.timer = setTimer(() => this.flush(), delay);
      // Ordinary keystrokes need no DOM writes. Only empty/nonempty changes
      // affect the Send button, and typing clears a previous sent notice once.
      if (changed) onControlsChange();
    };
    this.onBlur = () => this.flush();
    this.onCompositionStart = () => { this.composing = true; this.cancel(); };
    this.onCompositionEnd = () => { this.composing = false; this.onInput(); };
    input.addEventListener('input', this.onInput);
    input.addEventListener('blur', this.onBlur);
    input.addEventListener('compositionstart', this.onCompositionStart);
    input.addEventListener('compositionend', this.onCompositionEnd);
  }
  cancel() { if (this.timer != null) this.clearTimer(this.timer); this.timer = null; }
  acceptSuggestion(text) {
    if (!text || this.input.value || this.composing) return false;
    this.input.value = text;
    this.onInput();
    return true;
  }
  flush() {
    this.cancel();
    if (this.dirty) { this.draft.text = this.input.value; this.dirty = false; }
    return this.draft.text;
  }
  syncReset() {
    // Only an explicit send/clear changes the revision, never a status poll.
    if (this.revision === (this.draft.revision || 0)) return;
    this.cancel(); this.dirty = false; this.revision = this.draft.revision || 0;
    this.input.value = this.draft.text;
    this.hasText = !!this.input.value.trim();
  }
  destroy() {
    this.flush();
    this.input.removeEventListener('input', this.onInput);
    this.input.removeEventListener('blur', this.onBlur);
    this.input.removeEventListener('compositionstart', this.onCompositionStart);
    this.input.removeEventListener('compositionend', this.onCompositionEnd);
  }
}
