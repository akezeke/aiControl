// The City theme: a pixel-art city on a 2D canvas.
export function webglAvailable() {
  try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
}
export function mountCity() { throw new Error('City is not built yet'); }
