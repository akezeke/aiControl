#!/usr/bin/env python3
# Finishes raw Fantasy bakes into the plates the theme loads: smooth WebP, plus a low-res, 128-colour dithered PNG for the PS1 look.
# python3 scripts/fantasy-plates.py <rawDir> client/public/fantasy
import glob, os, sys
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

raw_dir, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for raw in sorted(glob.glob(os.path.join(raw_dir, '*.ppm'))):
    im = Image.open(raw).convert('RGB')
    name = os.path.basename(raw)[:-4]
    back = name.endswith('-back')
    if back:
        bright = im.point(lambda v: max(0, v - 190) * 2)
        scale = im.width / 4096
        im = ImageChops.add(im, bright.filter(ImageFilter.GaussianBlur(16 * scale)).point(lambda v: v // 2))
    im = ImageEnhance.Contrast(im).enhance(1.05)
    im = ImageEnhance.Color(im).enhance(1.06)
    path = os.path.join(out, name + '.webp')
    im.save(path, quality=80, method=6)
    w = im.width // 2 if back else im.width // 3
    low = im.resize((max(8, w), max(8, round(im.height * w / im.width))), Image.LANCZOS).quantize(colors=128, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    lpath = os.path.join(out, name + '-low.png')
    low.save(lpath, optimize=True)
    print(name, im.size, os.path.getsize(path) // 1024, 'kB;', low.size, os.path.getsize(lpath) // 1024, 'kB')
