import './theme-gallery.css';
import './atmosphere.css';
import { themes } from './themes.js';
import { groupThemes, createThemeFavourites } from './theme-gallery-model.js';
import { atmosphereLevels, atmospherePreference, effectiveAtmosphere, onAtmosphereChange, setAtmosphere, systemReducedMotion } from './atmosphere.js';

const favourites = createThemeFavourites(themes);
const el = (tag, className = '', text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (className, label, action) => { const node = el('button', className, label); node.type = 'button'; node.onclick = action; return node; };
export const themePreview = id => `/theme-previews/${id === 'modern' ? 'modern-light' : id}.webp`;

export function showThemeGallery({ trigger, current, onChoose, outlined, onOutlinesChange, onClose } = {}) {
  if (document.querySelector('.theme-picker')) return;
  current ||= document.documentElement.dataset.themeChoice;
  const focusRegion = trigger?.closest('.chat-header, .login-screen, .top-actions');
  const dialog = el('dialog', 'theme-picker theme-gallery'); dialog.setAttribute('aria-label', 'Themes');
  const heading = el('div', 'theme-picker-heading');
  const close = button('theme-picker-close', '×', () => dialog.close()); close.setAttribute('aria-label', 'Close themes'); close.title = 'Close (Esc)';
  heading.append(el('h2', '', 'Themes'), close);
  const body = el('div', 'theme-picker-body'), settings = el('div', 'theme-gallery-settings');
  const atmosphere = el('fieldset', 'theme-atmosphere'); atmosphere.append(el('legend', '', 'Atmosphere'));
  const choices = el('div', 'theme-segments'), system = el('span', 'theme-atmosphere-system', 'System: Still');
  system.title = 'Reduced motion is enabled in your system settings. Your saved preference applies when it is turned off.';
  const syncAtmosphere = () => {
    for (const node of choices.children) node.setAttribute('aria-pressed', String(node.dataset.level === atmospherePreference()));
    system.hidden = !systemReducedMotion();
    atmosphere.title = `${themes.find(theme => theme.id === current)?.name || 'Current theme'} · ${effectiveAtmosphere()}`;
  };
  for (const level of atmosphereLevels) {
    const choice = button('', level[0].toUpperCase() + level.slice(1), () => { setAtmosphere(level); syncAtmosphere(); }); choice.dataset.level = level; choices.append(choice);
  }
  atmosphere.append(choices, system); settings.append(atmosphere);
  syncAtmosphere(); const stopMotion = onAtmosphereChange(syncAtmosphere);
  if (current === 'office') {
    const label = el('label', 'theme-picker-setting');
    const input = el('input'); input.type = 'checkbox'; input.checked = !!outlined;
    input.onchange = () => onOutlinesChange?.(input.checked);
    label.append(input, el('span', '', 'Office outlines')); label.title = 'Off: only on what you point at'; settings.append(label);
  }
  const grid = el('div', 'theme-picker-grid');
  const draw = focus => {
    grid.replaceChildren();
    for (const group of groupThemes(themes, current, favourites.list())) {
      const tile = el('article', 'theme-gallery-tile'); tile.dataset.group = group.id;
      const choice = button('theme-picker-choice', '', () => dialog.close(group.choice.id));
      choice.dataset.themeChoice = group.choice.id; choice.setAttribute('aria-label', group.name); choice.setAttribute('aria-pressed', String(group.selected));
      const image = el('img', 'theme-gallery-preview'); image.src = themePreview(group.choice.id); image.alt = ''; image.width = 360; image.height = 225; image.loading = 'lazy';
      choice.append(image, el('span', 'theme-gallery-name', group.name));
      const favourite = button('theme-favourite', group.favourite ? '★' : '☆', () => { favourites.toggle(group.id); draw(group.id); });
      favourite.setAttribute('aria-label', `Favourite ${group.name}`); favourite.setAttribute('aria-pressed', String(group.favourite)); favourite.title = group.favourite ? 'Remove favourite' : 'Add favourite';
      tile.append(choice, favourite);
      if (group.id === 'modern') {
        const variants = el('div', 'theme-segments theme-variants'); variants.setAttribute('aria-label', 'Orbit appearance');
        for (const theme of group.variants) { const variant = button('', ({ modern: 'Auto', 'modern-light': 'Light', 'modern-dark': 'Dark' })[theme.id], () => dialog.close(theme.id)); variant.setAttribute('aria-pressed', String(theme.id === current)); variants.append(variant); }
        tile.append(variants);
      } else if (group.id === 'nodes') {
        const select = el('select', 'theme-variants'); select.setAttribute('aria-label', 'Nodes look');
        for (const theme of group.variants) { const option = el('option', '', theme.node); option.value = theme.id; select.append(option); }
        select.value = group.choice.id; select.onchange = () => dialog.close(select.value); tile.append(select);
      }
      grid.append(tile);
    }
    if (focus) grid.querySelector(`[data-group="${focus}"] .theme-favourite`)?.focus({ preventScroll: true });
  };
  draw(); body.append(settings, grid); dialog.append(heading, body);
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom); };
  let pressedOutside = false;
  dialog.onpointerdown = event => { pressedOutside = outside(event); };
  dialog.onclick = event => { if (pressedOutside && outside(event)) dialog.close(); };
  dialog.onclose = () => {
    stopMotion(); dialog.remove();
    if (dialog.returnValue) onChoose?.(dialog.returnValue);
    onClose?.();
    if (trigger) {
      const next = trigger.isConnected ? trigger : (focusRegion?.isConnected && focusRegion.querySelector('[aria-label="Change theme"]')) || document.querySelector('.top-actions [aria-label="Change theme"], .login-screen [aria-label="Change theme"]');
      next?.focus({ preventScroll: true });
    }
  };
  document.body.append(dialog); dialog.showModal();
  const selected = grid.querySelector('.theme-picker-choice[aria-pressed=true]'); selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  return dialog;
}
