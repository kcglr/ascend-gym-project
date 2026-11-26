#!/usr/bin/env python3
"""Turns the transfer files in art/src into the web assets in assets/.

Run from the project folder:  python3 art/process.py

art/src holds what came back from the image generator, already cut into even grids:
  emblems.jpg + emblems.a.png   six rank crests, 384 px cells, colour premultiplied over black
  objects.jpg + objects.a.png   chest closed/open, essence, flame, token, rune, 400 px cells
  hero.jpg + hero.a.png         the hunter, seen from behind
  glyphs.png                    twenty icon masks, 128 px cells, white on black
  aura.jpg                      flame ring, white on black
  banner.jpg, bg.jpg            the gate scene and the tall backdrop
Colour with alpha travels as "colour over black" plus a separate alpha image, so it is
divided back out here before the WebP files are written.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT = os.path.join(os.path.dirname(HERE), 'assets')
os.makedirs(OUT, exist_ok=True)

RANKS = ['e', 'd', 'c', 'b', 'a', 's']
OBJECTS = ['chest-closed', 'chest-open', 'essence', 'flame', 'token', 'rune']
GLYPHS = ['pushups', 'situps', 'squats', 'run', 'str',
          'end', 'agi', 'quest', 'hunter', 'log',
          'hall', 'system', 'lock', 'clear', 'skull',
          'trial', 'shield', 'rest', 'time', 'star']
sizes = {}


def rgba(colour, alpha):
    """colour is premultiplied over black; returns a straight-alpha RGBA image."""
    c = np.asarray(Image.open(os.path.join(SRC, colour)).convert('RGB')).astype(np.float32)
    a = np.asarray(Image.open(os.path.join(SRC, alpha)).convert('L')).astype(np.float32)
    a = np.where(a < 5, 0, a)                      # JPEG noise in the empty parts of the sheet
    rgb = np.clip(c * 255.0 / np.maximum(a, 1)[..., None], 0, 255)
    rgb[a == 0] = 0
    return Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), 'RGBA')


def save(im, name, q=86, **kw):
    path = os.path.join(OUT, name)
    im.save(path, 'WEBP', quality=q, method=6, **kw)
    sizes[name] = os.path.getsize(path)


def trim(im, pad=0):
    box = im.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
    if not box:
        return im
    l, t, r, b = box
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def square(im, size):
    """Centres the trimmed art in a square canvas, keeping its proportions."""
    im = trim(im)
    k = (size - 8) / max(im.size)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


# Rank crests: one square file per rank.
sheet = rgba('emblems.jpg', 'emblems.a.png')
for i, r in enumerate(RANKS):
    x, y = (i % 3) * 384, (i // 3) * 384
    save(square(sheet.crop((x, y, x + 384, y + 384)), 384), 'rank-%s.webp' % r, q=88)

# Reward objects. The chests are shown large, the rest as small icons.
sheet = rgba('objects.jpg', 'objects.a.png')
for i, name in enumerate(OBJECTS):
    x, y = (i % 3) * 400, (i // 3) * 400
    cell = sheet.crop((x, y, x + 400, y + 400))
    save(square(cell, 400 if name.startswith('chest') else 200), name + '.webp', q=88)

# The hunter.
hero = trim(rgba('hero.jpg', 'hero.a.png'), 2)
save(hero, 'hero.webp', q=84)

# Icon masks: one sprite, five columns by four rows, white with the shape in the alpha
# channel. CSS paints them with mask-image and background: currentColor.
g = Image.open(os.path.join(SRC, 'glyphs.png')).convert('L')
g = g.point(lambda v: 0 if v < 24 else min(255, int((v - 24) * 255 / 200)))
white = Image.new('L', g.size, 255)
save(Image.merge('RGBA', (white, white, white, g)), 'glyphs.webp', lossless=True)

# Aura: brightness becomes alpha, so CSS can paint the flames in the wearer's colours.
a = Image.open(os.path.join(SRC, 'aura.jpg')).convert('L')
arr = np.asarray(a).astype(np.float32) / 255.0
arr = np.clip((arr - 0.04) / 0.80, 0, 1) ** 0.85
alpha = Image.fromarray((arr * 255).astype(np.uint8), 'L')
white = Image.new('L', a.size, 255)
save(Image.merge('RGBA', (white, white, white, alpha)), 'aura.webp', q=80, alpha_quality=80)

# Gate scene and backdrop.
save(Image.open(os.path.join(SRC, 'banner.jpg')).convert('RGB'), 'banner.webp', q=80)
bg = Image.open(os.path.join(SRC, 'bg.jpg')).convert('RGB')
# The lower half shows a faint grid from the generator when it is brightened: soften it.
soft = bg.filter(ImageFilter.GaussianBlur(5))
mask = Image.linear_gradient('L').resize(bg.size)          # black at the top, white at the bottom
mask = mask.point(lambda v: 0 if v < 96 else min(255, int((v - 96) * 255 / 70)))
bg = Image.composite(soft, bg, mask)
save(bg, 'bg.webp', q=78)

manifest = {
    'ranks': {r: 'rank-%s.webp' % r for r in RANKS},
    'objects': {o: o + '.webp' for o in OBJECTS},
    'hero': 'hero.webp', 'aura': 'aura.webp', 'banner': 'banner.webp', 'bg': 'bg.webp',
    'glyphs': {'file': 'glyphs.webp', 'cols': 5, 'rows': 4, 'cell': 128, 'order': GLYPHS},
    'bytes': sizes,
}
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('\n'.join('%-18s %7d' % kv for kv in sorted(sizes.items())))
print('total', sum(sizes.values()))
