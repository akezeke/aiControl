// The DOM laid over the city: its buttons, and (from the speech bubbles on) everything that names a place.
export function createControls(box, { onRotate, onFit, onNext, onList, onNew }) {
  const bar = document.createElement('div'); bar.className = 'city-controls'; box.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; bar.append(b); return b; };
  const lost = document.createElement('div'); lost.className = 'city-lost'; lost.textContent = 'Connection lost'; lost.hidden = true; bar.append(lost);
  const waiting = button('city-waiting', '', 'Next waiting (N)', () => onNext()); waiting.hidden = true;
  button('', '⟲', 'Turn left (Q)', () => onRotate(-1));
  button('', '⟳', 'Turn right (E)', () => onRotate(1));
  // Drawn, because no font on most machines has a "fit" glyph and an empty box isn't an icon.
  button('', '', 'Fit city (F)', () => onFit()).innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z"/></svg>';
  button('', '+', 'New project', event => onNew(event.currentTarget));
  button('', '☰', 'Show the list', () => onList());
  return {
    setWaiting(n) { waiting.hidden = !n; waiting.textContent = `⚠ ${n}`; },
    setLost(on) { lost.hidden = !on; },
    dispose() { bar.remove(); },
  };
}
