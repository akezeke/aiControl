// Asking for the city's intro, without loading the city to do it. It goes on the root because the theme changes before the scene that answers has loaded, and it goes stale: coming back to the city later isn't arriving.
export const ASK_MS = 8000;
export function askForBoot(root, now) { root.dataset.cityBoot = String(now); }
export function takeBootAsk(root, now) {
  const at = Number(root.dataset.cityBoot);
  delete root.dataset.cityBoot;
  return at > 0 && now - at <= ASK_MS;
}
