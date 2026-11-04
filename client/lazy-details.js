// Closed tool runs may contain hundreds of rows. Create them only if read.
export function populateOnOpen(details, build) {
  const populate = () => {
    if (!details.open) return;
    details.removeEventListener('toggle', populate);
    details.append(...build());
  };
  if (details.open) populate(); else details.addEventListener('toggle', populate);
}
