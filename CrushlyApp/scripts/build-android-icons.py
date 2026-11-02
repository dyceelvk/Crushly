#!/usr/bin/env python3
"""Build the Android launcher icons from the brand mark.

Why this exists: the brand changed on 2026-10-27/28 (the ribbon C) and only
`assets/icon.png` and `assets/splash-icon.png` were replaced. The adaptive icon
set — `android-icon-foreground.png`, `android-icon-monochrome.png`,
`android-icon-background.png` — and `favicon.png` were left at the 2026-10-08
art, which is the old heart. Android 8 and newer draw the *adaptive* icon, so
every phone showed the heart while the app's own splash showed the C.

Everything here is derived from `assets/icon.png`, which is the brand as the app
already ships it, so the launcher cannot disagree with the app again.

    python3 scripts/build-android-icons.py

An Android adaptive icon is 108dp with only the middle 72dp guaranteed visible
(the launcher masks the rest), so the glyph is drawn at 60% of the canvas and
centred — no part of it can be clipped by a circle, a squircle or a teardrop.
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
BRAND = ROOT / 'public' / 'brand'

SIZE = 1024
GLYPH_FRACTION = 0.60      # of the 108dp canvas; the safe zone is 0.66
LO, HI = 70, 130           # brightness ramp: below LO is plate, above HI is glyph


def glyph_layer(icon: Image.Image) -> np.ndarray:
    """The C on its own, as an alpha mask.

    Brightness alone is not enough. The brand plate carries a glossy highlight
    that follows its own rounded edge and is as bright as the glyph, so a mask
    built on brightness cut a white rounded square out of the plate as well as
    the C — and cutting a fixed border ring to avoid that then took the bottom
    of the C with it.

    So the plate is found first, its outer band (where the highlight lives) is
    removed as a band, and only then is the glyph read out of what is left. A C
    is an open curve, so filling enclosed holes solidifies the ribbon's own
    shading without closing the mouth of the letter.
    """
    rgb = np.asarray(icon.convert('RGB'), dtype=np.float32) / 255.0
    v = rgb.max(axis=2)

    plate = ndimage.binary_fill_holes(v < 0.35)
    labels, count = ndimage.label(plate)
    if count > 1:
        sizes = ndimage.sum(plate, labels, range(1, count + 1))
        plate = labels == (int(np.argmax(sizes)) + 1)
    band = plate & ~ndimage.binary_erosion(plate, iterations=int(SIZE * 0.028))

    glyph = (v > 0.30) & ~band
    glyph = ndimage.binary_opening(glyph, structure=np.ones((5, 5), bool))
    glyph = ndimage.binary_fill_holes(glyph)
    labels, count = ndimage.label(glyph)
    if count > 1:
        sizes = ndimage.sum(glyph, labels, range(1, count + 1))
        glyph = labels == (int(np.argmax(sizes)) + 1)

    soft = Image.fromarray((glyph * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
    return np.asarray(soft, dtype=np.uint8)


def place(alpha: np.ndarray) -> Image.Image:
    """Centre the glyph at the adaptive icon's visible size."""
    img = Image.fromarray(alpha, 'L')
    box = img.getbbox()
    if not box:
        raise SystemExit('the glyph could not be found in assets/icon.png')
    glyph = img.crop(box)
    target = int(SIZE * GLYPH_FRACTION)
    scale = target / max(glyph.size)
    glyph = glyph.resize((max(1, round(glyph.width * scale)), max(1, round(glyph.height * scale))),
                         Image.LANCZOS)
    canvas = Image.new('L', (SIZE, SIZE), 0)
    canvas.paste(glyph, ((SIZE - glyph.width) // 2, (SIZE - glyph.height) // 2))
    return canvas


def plate_radius(icon: Image.Image) -> int:
    """How round the brand plate is, measured rather than assumed."""
    rgb = icon.convert('RGB')
    corner = rgb.getpixel((2, 2))
    px = rgb.load()
    for y in range(0, rgb.height // 2):
        for x in range(0, rgb.width // 2):
            r, g, b = px[x, y]
            if abs(r - corner[0]) + abs(g - corner[1]) + abs(b - corner[2]) > 24:
                return max(x, y)
    return int(SIZE * 0.22)


def square_mark(icon: Image.Image) -> Image.Image:
    """The brand plate on a genuinely transparent background.

    `public/brand/crushly-mark.png` shipped with the transparency checkerboard
    baked into its pixels, so it could not be placed on any colour.
    """
    radius = plate_radius(icon)
    mask = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=radius, fill=255)
    out = icon.convert('RGBA')
    out.putalpha(mask)
    return out


def main() -> int:
    icon = Image.open(ASSETS / 'icon.png').convert('RGB')

    alpha = place(glyph_layer(icon))

    # The foreground keeps the glyph's own colours: the ribbon is the brand, and
    # a white silhouette of it is not.
    foreground = icon.convert('RGBA')
    foreground.putalpha(alpha)
    foreground = foreground.crop(alpha.getbbox() or (0, 0, SIZE, SIZE))
    canvas = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 0))
    canvas.paste(foreground, ((SIZE - foreground.width) // 2, (SIZE - foreground.height) // 2))
    canvas.save(ASSETS / 'android-icon-foreground.png', optimize=True)

    mono = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 0))
    mono.paste((255, 255, 255, 255), (0, 0), alpha)
    mono.save(ASSETS / 'android-icon-monochrome.png', optimize=True)

    # A flat plate colour taken from the brand, so the launcher's mask has
    # nothing to clip. The glyph supplies all the contrast.
    plate = icon.getpixel((SIZE // 2, 40))
    Image.new('RGB', (SIZE, SIZE), plate).save(ASSETS / 'android-icon-background.png', optimize=True)

    mark = square_mark(icon)
    mark.save(BRAND / 'crushly-mark.png', optimize=True)
    mark.resize((128, 128), Image.LANCZOS).save(ASSETS / 'favicon.png', optimize=True)

    print(f'glyph drawn at {GLYPH_FRACTION:.0%} of {SIZE}px, plate #{plate[0]:02x}{plate[1]:02x}{plate[2]:02x}')
    print('wrote assets/android-icon-{foreground,monochrome,background}.png, assets/favicon.png, public/brand/crushly-mark.png')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
