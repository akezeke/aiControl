// Whether a key belongs to the scene or to whatever else is open.
import { isTypingTarget } from './office/status.js';

// A dialog or a toolbar menu is open (not the panel's own expanders, which stay open while it's hidden), or the Office's copy line, wherever focus went.
export const menuOpen = () => !!document.querySelector('dialog[open], details[open].theme-menu, #agent-filter-menu[open], .office-copyline:not([hidden])');
// Keys belong to the office only when nothing else wants them: no focused input, no open panel, dialog or menu.
export function officeHasKeys(event) {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target) && !isTypingTarget(document.activeElement)
    && !document.body.classList.contains('panel-open') && !menuOpen();
}
// Nothing focused but the scene: on a button or link, Tab and Space keep their usual meaning.
export const sceneFocused = canvas => [document.body, canvas, null].includes(document.activeElement);
