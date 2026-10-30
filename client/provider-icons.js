// A decorative image inside the caller's existing provider label/tooltip.
// CSS selects the artwork, so changing themes also updates already-mounted cards.
export function providerIcon(provider) {
  const icon = document.createElement('span');
  icon.className = 'provider-icon';
  icon.dataset.providerIcon = provider;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
