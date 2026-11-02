"""Pre-rendered treasure sprites for the Heroes and Sanctuary spend panels, in the manner of late-90s games:
a tiny ray-marcher renders each object at 4x, then it is boxed down to a small palette, outlined and saved.
Run: python3 scripts/spend-art.py   (needs Pillow and numpy; writes client/public/spend-{heroes,diablo}.webp, 48x40 pixels)"""
import numpy as np
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'client' / 'public'
W, H, SS = 48, 40, 4
V = lambda *a: np.array(a, float)

# ---- signed distance helpers; p is (N, 3)
def length(v): return np.sqrt((v * v).sum(-1))
def box(p, c, b, r=0.): q = np.abs(p - c) - b; return length(np.maximum(q, 0)) + np.minimum(q.max(-1), 0) - r
def ell(p, c, r): k = length((p - c) / r); return (k - 1) * r.min()
def cyl(p, c, r, h, axis=1):
    q = p - c; ax = q[:, axis]; rad = np.sqrt((q[:, [i for i in range(3) if i != axis]] ** 2).sum(-1))
    d = np.stack([rad - r, np.abs(ax) - h], -1); return np.minimum(d.max(-1), 0) + length(np.maximum(d, 0))
def torus(p, c, R, r): q = p - c; return np.sqrt((np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - R) ** 2 + q[:, 1] ** 2) - r
def smin(a, b, k): h = np.clip(.5 + .5 * (b - a) / k, 0, 1); return b * (1 - h) + a * h - k * h * (1 - h)

def tilt(p, c, ax, ay):
    """Rotate points about c so a shape can lean (x then z)."""
    q = p - c; cx, sx, cz, sz = np.cos(ax), np.sin(ax), np.cos(ay), np.sin(ay)
    q = np.stack([q[:, 0], q[:, 1] * cx - q[:, 2] * sx, q[:, 1] * sx + q[:, 2] * cx], -1)
    return np.stack([q[:, 0] * cz - q[:, 1] * sz, q[:, 0] * sz + q[:, 1] * cz, q[:, 2]], -1)

class Scene:
    def __init__(self): self.parts = []
    def add(self, fn, mat): self.parts.append((fn, mat))
    def __call__(self, p):
        d = np.full(len(p), 1e9); m = np.zeros(len(p), int)
        for fn, mat in self.parts:
            e = fn(p); better = e < d; d = np.where(better, e, d); m = np.where(better, mat, m)
        return d, m

def coin_stack(cx, cz, n, y0=0.0, r=.42, t=.075, jitter=0):
    rng = np.random.default_rng(int(abs(cx) * 10 + abs(cz) * 7 + n))
    out = []
    for i in range(n):
        out.append((V(cx + rng.uniform(-jitter, jitter), y0 + t + i * t * 2, cz + rng.uniform(-jitter, jitter)), r, t))
    return out

def render(scene, mats, light, floor=0.0, ortho_w=5.4, tiltdeg=24, cam_shift=(0, 1.1)):
    w, h = W * SS, H * SS
    el = np.radians(tiltdeg)
    fwd = V(0, -np.sin(el), -np.cos(el)); right = V(1, 0, 0); up = V(0, np.cos(el), -np.sin(el))
    sc = ortho_w / w
    xs = (np.arange(w) - w / 2 + .5) * sc + cam_shift[0]; ys = -(np.arange(h) - h / 2 + .5) * sc + cam_shift[1]
    X, Y = np.meshgrid(xs, ys)
    ro = (X[..., None] * right + Y[..., None] * up - fwd * 14).reshape(-1, 3); rd = np.tile(fwd, (len(ro), 1))
    t = np.zeros(len(ro)); hit = np.zeros(len(ro), bool); mid = np.zeros(len(ro), int)
    for _ in range(90):
        p = ro + rd * t[:, None]; d, m = scene(p)
        newly = (d < .004) & ~hit; hit |= newly; mid = np.where(newly, m, mid)
        t = np.where(hit, t, t + d * .9)
        if hit.all() or (t > 40).all(): break
    p = ro + rd * t[:, None]; e = .01
    n = np.stack([scene(p + V(e, 0, 0))[0] - scene(p - V(e, 0, 0))[0], scene(p + V(0, e, 0))[0] - scene(p - V(0, e, 0))[0], scene(p + V(0, 0, e))[0] - scene(p - V(0, 0, e))[0]], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    # soft shadow toward the key light, plus a cheap ambient occlusion along the normal
    def shadow(k=12):
        s = np.ones(len(p)); tt = np.full(len(p), .06)
        for _ in range(26):
            d, _m = scene(p + n * .02 + light * tt[:, None]); s = np.minimum(s, np.clip(k * d / tt, 0, 1)); tt += np.clip(d, .05, .5)
        return s
    sh = shadow()
    ao = np.ones(len(p))
    for i in range(1, 5):
        d, _m = scene(p + n * .12 * i); ao -= (.12 * i - d).clip(0, 1) * .5 / i
    ao = ao.clip(.25, 1)
    col = np.zeros((len(p), 3)); view = -rd
    for mid_i, mat in mats.items():
        sel = mid == mid_i
        if not sel.any(): continue
        base = mat['color'](p[sel], n[sel]) if callable(mat['color']) else np.tile(mat['color'], (sel.sum(), 1))
        diff = np.clip((n[sel] * light).sum(-1), 0, 1) * sh[sel]
        hv = light + view[sel]; hv /= np.linalg.norm(hv, axis=-1, keepdims=True)
        spec = np.clip((n[sel] * hv).sum(-1), 0, 1) ** mat['gloss'] * mat['spec'] * sh[sel]
        sky = (n[sel][:, 1] * .5 + .5)[:, None] * mat.get('sky', V(.12, .13, .2)) * 1.0
        rim = (1 - np.clip((n[sel] * view[sel]).sum(-1), 0, 1)) ** 3 * mat.get('rim', 0)
        c = base * (diff[:, None] * mat.get('key', V(1.05, .98, .86)) + sky * 1.1 + .13) * ao[sel][:, None]
        c += base * mat.get('glow', 0)
        c += spec[:, None] * mat.get('speccol', V(1, .95, .8)) + rim[:, None] * mat.get('rimcol', V(.5, .3, .25))
        col[sel] = c
    img = np.clip(col, 0, 1).reshape(h, w, 3); alpha = hit.reshape(h, w).astype(float)
    return img, alpha

def downsample(img, alpha):
    h, w = alpha.shape
    a = alpha.reshape(H, SS, W, SS).mean((1, 3)); c = (img * alpha[..., None]).reshape(H, SS, W, SS, 3).sum((1, 3)) / (alpha.reshape(H, SS, W, SS).sum((1, 3))[..., None] + 1e-9)
    return c, a

def finish(c, a, name, colors, outline, shadow=None):
    rgb = Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8))
    mask = a > .5
    pal = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    arr = np.array(pal); out = np.zeros((H, W, 4), np.uint8); out[..., :3] = arr; out[..., 3] = np.where(mask, 255, 0)
    # one-pixel outline, and a soft contact shadow below the sprite
    grown = mask.copy(); padded = np.pad(mask, 1)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)): grown |= np.roll(np.roll(padded, dy, 0), dx, 1)[1:-1, 1:-1]
    ring = grown & ~mask
    out[ring] = (*outline, 255)
    if shadow is not None:
        sh = np.roll(grown, 1, 0) & ~grown & ~ring
        sh2 = np.zeros_like(sh); sh2[1:] = ring[:-1] & ~mask[1:] & ~ring[1:]
        for y, x in zip(*np.where(sh2)): out[y, x] = (*shadow, 150)
    Image.fromarray(out).save(OUT / name, lossless=True, quality=100, method=6)

def wood(p, n):
    g = np.sin(p[:, 1] * 38 + np.sin(p[:, 0] * 3) * .6) * .5 + .5
    plank = (np.abs((p[:, 1] * 3.2 % 1) - .5) > .46) * .5
    base = np.array([.50, .28, .12]); return base[None] * (.78 + .3 * g[:, None]) * (1 - plank[:, None])

def leather(p, n):
    g = np.sin(p[:, 1] * 11 + np.sin(p[:, 0] * 7 + p[:, 2] * 5) * 1.6) * .5 + .5
    return np.array([.34, .19, .11])[None] * (.7 + .5 * g[:, None])

def velvet(p, n):
    return np.array([.5, .05, .1])[None] * (.8 + .2 * (np.sin(p[:, 0] * 30) * .5 + .5))[:, None]

def coins(p, n, base=(.98, .74, .24)):
    seam = ((p[:, 1] % .18) < .03)[:, None] * .5
    return np.array(base)[None] * (1 - seam)

GOLD = dict(spec=.9, gloss=22, sky=V(.2, .15, .06))

def coin(c, r=.36, t=.09, ax=0., az=0.):
    return lambda p: cyl(tilt(p, c, ax, az), V(0, 0, 0), r, t) - .012

# ---- Heroes: an oak chest bound in gold, lid thrown open on a heap of coins and gems, more coins and a sapphire at its feet.
def heroes():
    s = Scene(); cx, cz = 0., 0.
    outer = lambda p: box(p, V(cx, .6, cz), V(1.2, .6, .8), .06)
    inner = lambda p: box(p, V(cx, .95, cz), V(1.04, .75, .64))
    s.add(lambda p: np.maximum(outer(p), -inner(p)), 1)
    for bx in (-.72, .72):
        s.add(lambda p, bx=bx: np.maximum(box(p, V(bx, .6, cz), V(.13, .62, .86), .03), -inner(p)), 2)
    s.add(lambda p: box(p, V(cx, .7, .84), V(.2, .26, .06), .03), 2)
    s.add(lambda p: box(p, V(cx, .64, .9), V(.04, .1, .02)), 3)
    # lid: a slab hinged on the back top edge, swung past vertical
    hinge = V(cx, 1.2, -.78)
    th = 2.15
    u, nrm = V(0, np.sin(th), np.cos(th)), V(0, np.cos(th), -np.sin(th))
    def lid_local(p): q = p - hinge; return np.stack([q[:, 0], q @ nrm, q @ u], -1)
    s.add(lambda p: box(lid_local(p), V(0, .0, .8), V(1.14, .04, .74), .06), 1)
    for bx in (-.72, .72):
        s.add(lambda p, bx=bx: box(lid_local(p), V(bx, .0, .8), V(.1, .1, .8), .03), 2)
    s.add(lambda p: box(lid_local(p), V(cx, -.12, .8), V(1.1, .03, .7)), 8)
    s.add(lambda p: box(lid_local(p), V(cx, .0, 1.45), V(.17, .11, .15), .03), 2)
    # gold heaped inside
    s.add(lambda p: np.maximum(smin(ell(p, V(0, 1.1, .0), V(1.05, .62, .6)), ell(p, V(.4, 1.2, .1), V(.5, .5, .4)), .2), -(p[:, 1] - 1.7)), 4)
    for (x, y, z, a, b) in ((-.5, 1.42, .05, .2, .3), (.1, 1.55, -.05, -.2, .1), (.55, 1.38, .2, .3, -.2), (-.1, 1.4, .3, .1, .4)):
        s.add(coin(V(x, y, z), .3, .07, a, b), 4)
    s.add(lambda p: ell(tilt(p, V(.45, 1.6, 0), .3, .5), V(0, 0, 0), V(.2, .27, .2)), 5)
    s.add(lambda p: ell(tilt(p, V(-.45, 1.58, -.1), .2, -.4), V(0, 0, 0), V(.17, .24, .17)), 7)
    # floor: a stack, a few flat coins, a standing one, and a sapphire
    for k in range(6): s.add(coin(V(1.75, .09 + k * .18, .55), .36, .09), 4)
    for k in range(3): s.add(coin(V(1.55, .09 + k * .18, 1.15), .36, .09), 4)
    s.add(coin(V(.95, .09, 1.35), .36, .09, 0, .1), 4)
    s.add(coin(V(2.25, .4, 1.1), .36, .09, 1.35, .2), 4)
    s.add(lambda p: ell(tilt(p, V(-1.75, .3, .75), 0, .5), V(0, 0, 0), V(.26, .33, .26)), 5)
    mats = {1: dict(color=wood, spec=.08, gloss=8, sky=V(.1, .12, .2)), 2: dict(color=V(.9, .66, .22), **GOLD), 3: dict(color=V(.1, .06, .03), spec=0, gloss=1),
            4: dict(color=coins, **GOLD, rim=.5, rimcol=V(.6, .4, .1)), 5: dict(color=V(0., .25, 1.), spec=.5, gloss=40, sky=V(.05, .1, .3), rim=.4, rimcol=V(.2, .4, 1), glow=.9),
            7: dict(color=V(.9, .05, .1), spec=1.1, gloss=40, rim=.6, rimcol=V(.9, .2, .2), glow=.4), 8: dict(color=velvet, spec=.2, gloss=8, sky=V(.2, .06, .1))}
    light = V(-.45, .75, .5); light /= np.linalg.norm(light)
    c, a = downsample(*render(s, mats, light, ortho_w=5.5, cam_shift=(.35, 1.12), tiltdeg=32))
    finish(c, a, 'spend-heroes.webp', 44, (14, 10, 22), (4, 8, 28))

# ---- Sanctuary: a stitched leather purse tied with a bone-white cord and a red wax seal, coins spilling out in front.
def diablo():
    s = Scene()
    def purse(p):
        b = ell(p, V(0, 1.0, 0), V(1.2, 1.0, 1.08))
        neck = cyl(p, V(0, 2.0, 0), .42 + .1 * np.clip(p[:, 1] - 2.0, 0, 1), .45)
        mouth = ell(p, V(0, 2.5, 0), V(.74, .3, .74))
        return smin(smin(b, neck, .45), mouth, .25)
    s.add(purse, 1)
    s.add(lambda p: torus(p, V(0, 2.1, 0), .52, .1), 2)
    s.add(lambda p: ell(p, V(.62, 1.86, .5), V(.2, .1, .5)), 2)
    s.add(lambda p: ell(p, V(-.2, 1.84, .56), V(.1, .1, .45)), 2)
    s.add(lambda p: cyl(tilt(p, V(0, 1.1, 1.08), 1.5708, 0), V(0, 0, 0), .38, .07), 3)
    s.add(lambda p: ell(p, V(0, 1.1, 1.16), V(.2, .2, .08)), 6)
    s.add(lambda p: ell(p, V(0, 1.08, 1.2), V(.09, .09, .05)), 7)
    for k in range(6): s.add(coin(V(-1.7, .09 + k * .18, .9), .38, .09), 4)
    for k in range(3): s.add(coin(V(1.55, .09 + k * .18, .95), .38, .09), 4)
    s.add(coin(V(.55, .09, 1.7), .38, .09, 0, .15), 4)
    s.add(coin(V(-.4, .09, 1.8), .38, .09), 4)
    s.add(coin(V(.1, .2, 1.85), .38, .09, 1.2, .1), 4)
    s.add(coin(V(1.0, .09, 1.5), .38, .09), 4)
    mats = {1: dict(color=leather, spec=.12, gloss=10, sky=V(.14, .1, .1), rim=.6, rimcol=V(.45, .1, .06)), 2: dict(color=V(.76, .7, .54), spec=.2, gloss=12),
            3: dict(color=V(.62, .08, .06), spec=.7, gloss=25, rim=.5, rimcol=V(.6, .1, .05)), 4: dict(color=coins, **GOLD, rim=.6, rimcol=V(.55, .12, .06)),
            6: dict(color=V(.82, .75, .6), spec=.2, gloss=10), 7: dict(color=V(.9, .1, .08), spec=.9, gloss=30)}
    light = V(-.5, .7, .6); light /= np.linalg.norm(light)
    c, a = downsample(*render(s, mats, light, ortho_w=5.2, cam_shift=(0, .9), tiltdeg=32))
    finish(c, a, 'spend-diablo.webp', 36, (8, 5, 4), (0, 0, 0))

if __name__ == '__main__':
    heroes(); diablo()
