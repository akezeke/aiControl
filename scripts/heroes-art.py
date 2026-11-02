"""Sizes the Heroes UI art (sources in docs/art/src) for where it is shown, so nothing is shrunk by the browser at display time.
Run: python3 scripts/heroes-art.py   (needs Pillow and numpy; writes client/public/heroes-*.webp)
- heroes-frame-<S>.webp: the gold-and-sapphire frame with its corner flourish S pixels wide (border-image-slice: S).
- heroes-scroll-<S>.webp: the illuminated parchment, likewise (slice S, fill).
- heroes-bevel / heroes-socket: small raised and recessed gold bevels drawn in code at 2 CSS px per pixel."""
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent; pub = root / 'client' / 'public'; src = root / 'docs' / 'art' / 'src'

def fit(src, slice_fraction, corner, sharpen):
    """Resample so the corner region (slice_fraction of the source) is `corner` pixels wide."""
    n = round(corner / slice_fraction)
    im = src.convert('RGBa').resize((n, n), Image.Resampling.LANCZOS).convert('RGBA')
    return im.filter(ImageFilter.UnsharpMask(radius=.7, percent=sharpen, threshold=0))

frame = Image.open(src / 'heroes-ornate-frame.webp'); scroll = Image.open(src / 'heroes-parchment.webp')
for s in (24, 32, 36, 40, 48, 64): fit(frame, .34, s, 110).save(pub / f'heroes-frame-{s}.webp', lossless=True, method=6)
for s in (24, 32, 40): fit(scroll, .24, s, 90).save(pub / f'heroes-scroll-{s}.webp', lossless=True, method=6)

h = lambda v: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5))
K, GH, G, GM, GD, N1, N2 = (h(v) for v in ('#0b0805', '#f6dc8c', '#d3a843', '#a98030', '#5a3f16', '#0b1631', '#18284a'))

def bevel(size, rows):
    """rows[d] = (lit side colour, shaded side colour); the centre stays transparent. Corners are mitred."""
    px = np.zeros((size, size, 4), np.uint8)
    for y in range(size):
        for x in range(size):
            d, edge = min((x, 0), (y, 1), (size - 1 - x, 2), (size - 1 - y, 3))
            if d < len(rows): px[y, x] = (*rows[d][0 if edge < 2 else 1], 255)
    return Image.fromarray(px)

# Raised: black rim, bright gold lit edge / deep gold shaded edge, a navy inner shadow. 12px, slice 3.
bevel(12, [(K, K), (GH, GM), (GD, GD)]).save(pub / 'heroes-bevel.webp', lossless=True)
# Recessed: the same turned over, for text fields.
bevel(12, [(K, K), (GD, G), (N1, N2)]).save(pub / 'heroes-socket.webp', lossless=True)
