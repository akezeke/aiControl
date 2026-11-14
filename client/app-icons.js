import { faviconBadge } from './alerts.js';

export function applyThemeIcons(id, dark) {
  const choice = id.startsWith('modern') ? `modern-${dark ? 'dark' : 'light'}` : id;
  const base = `/app-icons/${choice}`;
  for (const [rel, file] of [['manifest', 'manifest.webmanifest'], ['apple-touch-icon', 'apple-touch-icon.png']]) {
    const link = document.querySelector(`link[rel="${rel}"]`), href = `${base}/${file}`;
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
  const link = document.querySelector('link[rel=icon]');
  if (!link || link.dataset.baseIcon === `${base}/favicon.svg`) return;
  link.dataset.baseIcon = `${base}/favicon.svg`;
  link.href = link.dataset.baseIcon;
  // Keep the current attention state while changing the artwork underneath it.
  void faviconBadge(link.dataset.badge === 'true' ? 1 : 0);
}
