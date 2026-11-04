// Small paper labels follow each visible line and are trimmed to the same clip as its text.
export function labelRects(rectangles, clip) {
  return rectangles.map(r => ({
    left: Math.max(r.left - 2, clip?.left ?? -Infinity), top: Math.max(r.top - 1, clip?.top ?? -Infinity),
    right: Math.min(r.right + 2, clip?.right ?? Infinity), bottom: Math.min(r.bottom + 1, clip?.bottom ?? Infinity),
  })).filter(r => r.right > r.left && r.bottom > r.top);
}

// Keep pale ink on dark labels and dark ink on parchment, regardless of the brick beneath.
export function labelColour(colour) {
  const values = colour.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
  return (values[0] * .299 + values[1] * .587 + values[2] * .114) > 150 ? 'dark' : 'light';
}
