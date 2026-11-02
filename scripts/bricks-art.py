"""Sizes the Brick Knights art (sources in docs/art/src, prompts in docs/art/bricks.txt) for where it is shown. The bricks themselves are not art: they are
geometry built live by client/bricks3d.
Run: python3 scripts/bricks-art.py   (needs Pillow and numpy; writes client/public/bricks-*.webp, spend-bricks.webp and providers/bricks-*.webp)
- bricks-bg: the castle diorama, as generated.
- bricks-theme: the lion crest, trimmed and square.
- providers/bricks-{codex,claude,opencode}: the printed round tiles cut from the 2 x 2 atlas.
- bricks-portraits: the four minifigure busts as one 2 x 2 atlas, used by CSS as a sprite (knight, dragon knight, ranger, king).
- bricks-dragon: a transparent sprite that crosses the wallpaper now and then.
- spend-bricks: the treasure chest."""
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent; pub = root / 'client' / 'public'; src = root / 'docs' / 'art' / 'src'

def load(name): return Image.open(src / f'bricks-{name}.webp').convert('RGBA')

def trim(im, floor=16):
    alpha = np.array(im)[..., 3]; ys, xs = np.where(alpha > floor)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def shrink(im, box):
    """Resample into a box, keeping the aspect ratio; premultiplied, so edges stay clean."""
    f = min(box[0] / im.width, box[1] / im.height); size = (max(1, round(im.width * f)), max(1, round(im.height * f)))
    out = im.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')
    return out.filter(ImageFilter.UnsharpMask(radius=.6, percent=60, threshold=0))

def square(im, size, pad):
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); fit = shrink(trim(im), (size - 2 * pad, size - 2 * pad))
    out.paste(fit, ((size - fit.width) // 2, (size - fit.height) // 2), fit); return out

def largest(im, floor=16):
    """Drops what is not part of the biggest piece (a neighbour's sword tip), looking at a quarter-size mask so thin joins hold."""
    alpha = np.array(im)[..., 3] > floor; h, w = alpha.shape; small = alpha[:h // 4 * 4, :w // 4 * 4].reshape(h // 4, 4, w // 4, 4).any(axis=(1, 3))
    label = np.zeros(small.shape, int); sizes = {}
    for y, x in zip(*np.nonzero(small)):
        if label[y, x]: continue
        n = len(sizes) + 1; stack = [(y, x)]; label[y, x] = n; count = 0
        while stack:
            cy, cx = stack.pop(); count += 1
            for ny in range(max(cy - 1, 0), min(cy + 2, small.shape[0])):
                for nx in range(max(cx - 1, 0), min(cx + 2, small.shape[1])):
                    if small[ny, nx] and not label[ny, nx]: label[ny, nx] = n; stack.append((ny, nx))
        sizes[n] = count
    keep = np.kron(label == max(sizes, key=sizes.get), np.ones((4, 4), bool)); mask = np.zeros((h, w), bool); mask[:keep.shape[0], :keep.shape[1]] = keep
    out = np.array(im); out[~mask, 3] = 0; return Image.fromarray(out)

def save(im, path, **kw): im.save(path, 'WEBP', method=6, **kw)

save(load('bg').convert('RGB'), pub / 'bricks-bg.webp', quality=86)
save(square(load('emblem'), 320, 4), pub / 'bricks-theme.webp', quality=94)

icons = load('icons'); half = icons.width // 2
for name, (col, row) in {'codex': (0, 0), 'claude': (1, 0), 'opencode': (0, 1)}.items():
    save(square(icons.crop((col * half, row * half, (col + 1) * half, (row + 1) * half)), 192, 8), pub / 'providers' / f'bricks-{name}.webp', quality=92)

# Portraits are opaque squares: no trimming, only the atlas scaled so each bust is 2.8x the 50 px it is shown at.
portraits = load('portraits').convert('RGB'); cell = 144
save(portraits.resize((cell * 2, cell * 2), Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=.8, percent=60, threshold=0)), pub / 'bricks-portraits.webp', quality=92)

save(shrink(trim(load('dragon')), (480, 480)), pub / 'bricks-dragon.webp', quality=90)
save(square(load('chest'), 192, 0), pub / 'spend-bricks.webp', quality=92)


# Sprites: the four minifigures stand on the session map (ranger working, herald waiting for you, knight idle, dragon knight failed);
# the torch and banner decorate the sidebar; the gate is split down the seam for the start-up.
figs = Image.open(src / 'bricks-figs.webp').convert('RGBA'); a = np.array(figs)[..., 3]
# The figures' weapons and capes touch, so cut where least is drawn near each quarter of the sheet.
cuts = [0] + [q + int(np.argmin((a[:, q - 60:q + 60] > 16).sum(axis=0))) - 60 for q in (390, 770, 1145)] + [figs.width]
for name, x0, x1 in zip(['ranger', 'herald', 'knight', 'dragon'], cuts, cuts[1:]):
    save(shrink(trim(largest(figs.crop((x0, 0, x1, figs.height)))), (200, 220)), pub / f'bricks-fig-{name}.webp', quality=92)
save(shrink(trim(load('torch')), (300, 150)), pub / 'bricks-torch.webp', quality=92)
save(shrink(trim(load('banner')), (200, 300)), pub / 'bricks-banner.webp', quality=92)
gate = load('gate').convert('RGB'); mid = gate.width // 2
save(gate.crop((0, 0, mid, gate.height)), pub / 'bricks-gate-left.webp', quality=84); save(gate.crop((mid, 0, gate.width, gate.height)), pub / 'bricks-gate-right.webp', quality=84)
