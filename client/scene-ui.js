// The card beside whatever is outlined and the menu that starts an agent, shared by the scenes.
import { providerIcon } from './provider-icons.js';

// A frame's seconds, up to `longest`. A frame the browser stamped before the scene finished mounting would come out negative, by as long as mounting took.
export const frameTime = (now, last, longest) => Math.min(longest, Math.max(0, (now - last) / 1000));

const span = (className, text) => { const node = document.createElement('span'); node.className = className; node.textContent = text; return node; };
// Below and right of a screen point, flipped to stay in the scene.
function placeNear(container, node, at) {
  const box = container.getBoundingClientRect(), x = at.clientX - box.left, y = at.clientY - box.top, w = node.offsetWidth, h = node.offsetHeight;
  const left = x + 18 + w > box.width - 8 ? x - 18 - w : x + 18, top = y + 18 + h > box.height - 8 ? y - 18 - h : y + 18;
  node.style.transform = `translate(${Math.max(8, left).toFixed(0)}px, ${Math.max(8, top).toFixed(0)}px)`;
}

// What the list shows and the scene doesn't: branch, plan steps, permission mode, context, how long in this state.
export function createCard(container) {
  const card = document.createElement('div'); card.className = 'office-card'; card.hidden = true; card.setAttribute('aria-hidden', 'true'); container.append(card);
  const line = (className, ...parts) => { const div = document.createElement('div'); div.className = className; div.append(...parts.filter(part => part || part === 0)); return div; };
  let shown = '';
  return {
    // `facts` from main.js's sessionFacts (or just a title and project, for a pod's sign), or null to hide.
    show(facts) {
      card.hidden = !facts;
      const signature = facts ? JSON.stringify(facts) : '';
      if (!facts || signature === shown) return;
      shown = signature;
      const where = [facts.agent, facts.project, facts.branch && span('branch', facts.branch)].filter(Boolean).flatMap((part, i) => i ? [' · ', part] : [part]);
      const chips = line('chips', facts.plan && span('chip', `${facts.plan[0]}/${facts.plan[1]} steps`), facts.mode && span(`chip ${facts.mode}`, `${facts.mode} mode`),
        facts.context != null && span(`chip${facts.context >= 80 ? ' full' : ''}`, `ctx ${facts.context}%`), facts.state && span('state', facts.state));
      card.replaceChildren(...[
        line('title', facts.provider && providerIcon(facts.provider), facts.title || facts.providerName),
        where.length && line('where', ...where),
        chips.childElementCount && chips,
        facts.detail && line('detail', facts.detail),
      ].filter(Boolean));
    },
    move(at) { if (!card.hidden && at) placeNear(container, card, at); },
    dispose() { card.remove(); },
  };
}

// A pod sign's menu: Claude (once per account, see hire.js) or Codex, started in the pod's folder. It closes on a pick, Esc or a press anywhere else.
export function createMenu(container, onChoose, onClose) {
  const menu = document.createElement('div'); menu.className = 'office-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true; container.append(menu);
  let cwd = null, items = [];
  // Without a folder (the + button) the menu asks for one, suggesting the folders sessions run in.
  const folder = document.createElement('input'); folder.className = 'office-folder'; folder.placeholder = '~/folder'; folder.setAttribute('aria-label', 'Folder'); folder.setAttribute('list', 'office-folders'); folder.autocomplete = 'off'; folder.spellcheck = false;
  const folders = document.createElement('datalist'); folders.id = 'office-folders';
  folder.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); items[0]?.click(); } });
  const build = (choices, known) => {
    items = choices.map(choice => {
      const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.title = `New ${choice.name} in tmux${choice.last ? ' · last used here' : ''}`;
      item.append(providerIcon(choice.provider), choice.label);
      if (choice.last) item.append(span('last', 'last'));
      item.onclick = () => { const at = cwd ?? folder.value.trim(); if (!at) { folder.focus(); return; } result.close(); onChoose(at, choice, item); };
      return item;
    });
    folders.replaceChildren(...known.map(path => Object.assign(document.createElement('option'), { value: path })));
    menu.replaceChildren(...(cwd === null ? [folder, folders] : []), ...items);
  };
  // Keys stay in the menu: the arrows and WASD would otherwise walk or pan the camera behind it.
  menu.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') result.close();
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      items[(items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  const result = {
    get open() { return !menu.hidden; },
    contains: node => menu.contains(node),
    get asking() { return !menu.hidden && cwd === null; },
    // At a screen point; `focus` for the keyboard. A null folder asks for one; `known` are the suggestions.
    show(where, at, focus, choices, known = []) {
      cwd = where; build(choices, known); menu.setAttribute('aria-label', where === null ? 'New agent' : `New agent in ${where}`); menu.hidden = false; if (at) placeNear(container, menu, at);
      if (where === null) { folder.value = ''; folder.focus(); } else if (focus) items[0].focus();
    },
    move(at) { if (!menu.hidden) placeNear(container, menu, at); },
    close() { if (menu.hidden) return; if (menu.contains(document.activeElement)) document.activeElement.blur(); menu.hidden = true; cwd = null; onClose?.(); },
    dispose() { menu.remove(); },
  };
  return result;
}
