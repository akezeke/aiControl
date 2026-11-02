"""Sizes the Heroes UI art (sources in docs/art/src) for where it is shown, so nothing is shrunk by the browser at display time.
Run: python3 scripts/heroes-art.py   (needs Pillow and numpy; writes client/public/heroes-*.webp)
- heroes-frame-<S>.webp: the gold-and-sapphire frame with its corner flourish S pixels wide (border-image-slice: S).
- heroes-scroll-<S>.webp: the illuminated parchment, likewise (slice S, fill).
- heroes-button / heroes-card / heroes-sink: generated gold borders resampled so the band is the CSS border width; sink also has a -lit twin for focus.
- heroes-stone: one generated blue slab, seam to seam, repeated by CSS with `round`."""
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

def band(name, source, band_px, inset, corner, widths, lit=False):
    """Writes heroes-<name>-<w>.webp so the border band is w CSS px wide; prints the border-image to use.
    band_px / inset / corner are measured in the source: band thickness, its distance from the canvas edge (corner spikes), corner extent."""
    im = Image.open(src / source).convert('RGBA')
    for w in widths:
        f = w / band_px; img = fit_scale(im, f)
        img.save(pub / f'heroes-{name}-{w}.webp', lossless=True, method=6)
        c, o = round(corner * f), round(inset * f)
        print(f'{name} {w}: border {w}px; border-image: url(/heroes-{name}-{w}.webp) {c} / {c}px / {o}px round')
        if lit:  # the same frame brighter, for a focused field
            px = np.array(img).astype(float); px[..., :3] = np.clip(px[..., :3] * 1.45 + 18, 0, 255)
            Image.fromarray(px.astype(np.uint8)).save(pub / f'heroes-{name}-{w}-lit.webp', lossless=True, method=6)

def fit_scale(im, f):
    size = (round(im.width * f), round(im.height * f))
    return im.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA').filter(ImageFilter.UnsharpMask(radius=.7, percent=90, threshold=0))

band("button", "heroes-button.webp", band_px=66, inset=16, corner=130, widths=(6,))
band('card', 'heroes-card.webp', band_px=63, inset=24, corner=170, widths=(12,))
band('sink', 'heroes-sink.webp', band_px=89, inset=0, corner=110, widths=(8,), lit=True)

# The source is a 4 x 4 grid of slabs (313.5 px each, 1254 px in all). One slab, cut from seam centre to seam centre, tiles exactly;
# CSS then repeats it with `round` from the border box, so a whole number of slabs always fits and the seams meet the frame.
stone = Image.open(src / 'heroes-stone.webp').convert('RGB')
stone.resize((128, 128), Image.Resampling.LANCZOS, box=(313.5, 313.5, 627, 627)).save(pub / 'heroes-stone.webp', quality=95, method=6)
