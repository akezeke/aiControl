"""Sizes the Sanctuary UI art for where it is shown, so the browser never has to shrink it.
Run: python3 scripts/diablo-art.py   (needs Pillow and numpy; reads docs/art/src, writes client/public/diablo-*.webp)
- diablo-panel / diablo-button: the generated iron-and-bronze borders, resampled so the band is the CSS border width (button also has a -lit twin for hover).
  Each source has its band inset from the canvas edge (spikes in the corners), hence border-image-outset.
- diablo-stone: the generated dungeon wall made seamless and sized to tile at 2 CSS px per drawn pixel.
- diablo-socket (recessed field, and a -lit twin for focus) and diablo-rule(-vertical) (divider) are drawn in code at 2 CSS px per pixel."""
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent; out = root / 'client' / 'public'; src = root / 'docs' / 'art' / 'src'

def resample(im, factor, sharpen=100):
    size = (round(im.width * factor), round(im.height * factor))
    return im.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA').filter(ImageFilter.UnsharpMask(radius=.7, percent=sharpen, threshold=0))

def frame(name, source, crop, band, inset, corner, widths):
    """Writes diablo-<name>-<band>.webp for each band width in CSS pixels and prints the border-image values.
    band/inset/corner are measured in the source image: border thickness, how far it starts inside the canvas, corner extent."""
    im = Image.open(src / source).convert('RGBA').crop(crop)
    for w in widths:
        f = w / band; img = resample(im, f)
        img.save(out / f'diablo-{name}-{w}.webp', lossless=True, method=6)
        if name == 'button':  # a warmer, brighter twin for hover
            px = np.array(img).astype(float); px[..., :3] = np.clip(px[..., :3] * np.array([1.5, 1.2, .95]) + np.array([22, 0, 0]), 0, 255)
            Image.fromarray(px.astype(np.uint8)).save(out / f'diablo-{name}-{w}-lit.webp', lossless=True, method=6)
        print(f'{name} {w}: border {w}px; border-image: url(/diablo-{name}-{w}.webp) {round(corner * f)} / {round(corner * f)}px / {round(inset * f)}px round; size {img.size}')

frame('panel', 'diablo-panel.webp', (0, 0, 1254, 1254), band=98, inset=47, corner=200, widths=(8, 12, 16))
frame('button', 'diablo-button.webp', (0, 0, 1254, 1224), band=97, inset=0, corner=150, widths=(8, 10))

def seamless(a, f):
    """Cross-fades the wrapped edge so the picture tiles without a seam; shrinks each axis by f pixels."""
    for axis in (1, 0):
        a = np.moveaxis(a, axis, 0); n = a.shape[0] - f
        t = (np.arange(f) / f).reshape(-1, *([1] * (a.ndim - 1)))
        a = np.concatenate([a[n:n + f] * (1 - t) + a[:f] * t, a[f:n]]); a = np.moveaxis(a, 0, axis)
    return a

stone = np.array(Image.open(src / 'diablo-stone.webp').convert('RGB'), float)
tile = Image.fromarray(seamless(stone, 48).round().astype(np.uint8)).resize((512, 512), Image.Resampling.LANCZOS)
tile.save(out / 'diablo-stone.webp', quality=92, method=6)

hexrgb = lambda v: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5))
K, I, SH, ST, SL, LT, HI, BZ, BZD, BZH = (hexrgb(v) for v in ('#050403', '#0d0a07', '#211b14', '#332c22', '#42392b', '#5d5240', '#82735a', '#7b5e2f', '#3a2a14', '#cfac66'))

def bevel(size, rows):
    """rows[d] = (lit side, shaded side); the centre stays transparent; corners are mitred."""
    px = np.zeros((size, size, 4), np.uint8)
    for y in range(size):
        for x in range(size):
            d, edge = min((x, 0), (y, 1), (size - 1 - x, 2), (size - 1 - y, 3))
            if d < len(rows): px[y, x] = (*rows[d][0 if edge < 2 else 1], 255)
    return Image.fromarray(px)

bevel(16, [(K, K), (SH, LT), (I, SL), (I, ST)]).save(out / 'diablo-socket.webp', lossless=True)
# The same field with the rim lit like an ember, for focus.
bevel(16, [(K, K), (hexrgb('#f0b469'), hexrgb('#c8692f')), (hexrgb('#4a1d10'), hexrgb('#5b2615')), (I, ST)]).save(out / 'diablo-socket-lit.webp', lossless=True)

rule = Image.new('RGBA', (8, 4), (0, 0, 0, 0))
for x in range(8):
    for y, c in enumerate((K, BZH if x != 3 else BZD, BZ if x != 3 else BZD, K)): rule.putpixel((x, y), (*c, 255))
rule.save(out / 'diablo-rule.webp', lossless=True)
rule.transpose(Image.Transpose.ROTATE_90).transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(out / 'diablo-rule-vertical.webp', lossless=True)
