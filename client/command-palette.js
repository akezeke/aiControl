import { matchCommands } from './workspace-navigation.js';

const node = (tag, className, text) => { const result = document.createElement(tag); result.className = className; if (text != null) result.textContent = text; return result; };

export function showCommandPalette({ commands, trigger = document.activeElement, onClose }) {
  if (document.querySelector('.command-palette')) return null;
  const dialog = node('dialog', 'command-palette'); dialog.setAttribute('aria-label', 'Commands');
  const heading = node('div', 'command-heading'), input = node('input', 'command-search');
  input.type = 'search'; input.placeholder = 'Sessions, themes, commands…'; input.setAttribute('aria-label', 'Search commands');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', 'command-results');
  const dismiss = node('button', 'command-dismiss', 'Esc'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Close commands'); dismiss.onclick = () => dialog.close();
  heading.append(input, dismiss);
  const list = node('div', 'command-results'); list.id = 'command-results'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Commands');
  const empty = node('p', 'command-empty', 'No matches'); empty.hidden = true; empty.setAttribute('role', 'status');
  const footer = node('div', 'command-footer', '↑ ↓ navigate · Enter open');
  dialog.append(heading, list, empty, footer);
  let all = commands, matches = [], selectedId, action, closed = false, signature = '';
  const select = id => {
    selectedId = id;
    for (const option of list.children) option.setAttribute('aria-selected', String(option.dataset.commandId === id));
    const selected = [...list.children].find(option => option.dataset.commandId === id);
    if (selected) { input.setAttribute('aria-activedescendant', selected.id); selected.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const execute = id => {
    const command = all.find(c => c.id === id);
    if (!command || command.disabled) return;
    action = command.run; dialog.close();
  };
  const render = () => {
    matches = matchCommands(all, input.value).filter(c => !c.disabled).slice(0, 60);
    const nextSignature = JSON.stringify(matches.map(({ id, label, detail, shortcut }) => [id, label, detail, shortcut]));
    // Polling updates callbacks without replacing unchanged options or stealing keyboard focus.
    if (signature !== nextSignature) {
      signature = nextSignature;
      list.replaceChildren(...matches.map((command, index) => {
        const option = node('button', 'command-option'); option.type = 'button'; option.tabIndex = -1; option.id = `command-option-${index}`;
        option.dataset.commandId = command.id; option.setAttribute('role', 'option');
        const text = node('span', 'command-copy'); text.append(node('strong', '', command.label));
        if (command.detail) text.append(node('span', 'command-detail', command.detail));
        option.append(text); if (command.shortcut) option.append(node('kbd', '', command.shortcut));
        option.onclick = () => execute(command.id); option.onpointermove = () => select(command.id);
        return option;
      }));
    }
    empty.hidden = !!matches.length;
    select(matches.some(c => c.id === selectedId) ? selectedId : matches[0]?.id);
  };
  input.oninput = () => { selectedId = null; render(); };
  input.onkeydown = event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = matches.findIndex(c => c.id === selectedId), count = matches.length;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
      select(matches[index]?.id);
    } else if (event.key === 'Enter') { event.preventDefault(); execute(selectedId); }
  };
  dialog.onkeydown = event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); dialog.close(); }
  };
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom); };
  let pressedOutside = false;
  dialog.onpointerdown = event => { pressedOutside = outside(event); };
  dialog.onclick = event => { if (pressedOutside && outside(event)) dialog.close(); };
  dialog.onclose = () => {
    if (closed) return; closed = true; dialog.remove();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    onClose?.(); action?.();
  };
  document.body.append(dialog); dialog.showModal(); render(); input.focus();
  return { update: commands => { all = commands; render(); }, close: () => dialog.close() };
}
