// The Clipboard API needs HTTPS or localhost; LAN HTTP uses the selection fallback.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Try the selection fallback when clipboard access is denied. */ }
  const focused = document.activeElement, selection = document.getSelection();
  const inputSelection = typeof focused?.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text; field.readOnly = true;
  field.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
  document.body.append(field);
  try {
    field.focus({ preventScroll: true }); field.select();
    if (!document.execCommand('copy')) throw new Error('Copy failed. Select the message and copy it manually.');
  } finally {
    field.remove(); focused?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
    if (inputSelection) focused.setSelectionRange(...inputSelection);
  }
}
