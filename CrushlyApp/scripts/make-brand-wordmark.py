#!/usr/bin/env python3
"""Draw the holUpp wordmark, so the name on screen is spelled the way it is

The supplied logo artwork spells the name in all caps, which is a lockup, not the
brand: the product is `holUpp` — capital H, capital U, the rest lowercase. A
video that stamps HOLUP on every download undoes the rename on the one surface
most people will ever see it. So the wordmark is drawn from type rather than
cropped from the artwork, and the type is Manrope ExtraBold — the same face the
app renders the wordmark in, vendored into `assets/share/fonts` (SIL OFL, the
licence travels with it) so this script does not depend on whatever fonts a build
machine happens to have.

    make-brand-wordmark.py           # writes assets/share/holup-wordmark.png

The symbol (two overlapping circles) is untouched: it has no letters in it.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"
FONT = SHARE / "fonts/Manrope_800ExtraBold.ttf"

WORD = "holUpp"
TARGET_H = 383      # the height the previous wordmark was drawn at; the splash
                    # and the lockup both scale from it
TRACKING = -0.035   # em. ExtraBold at display size wants slightly tight spacing
                    # or the counters read as gaps between letters.


def build(word: str = WORD) -> tuple[Image.Image, int]:
    # Draw big, then trim to the ink: a text image has to be cut to what was
    # actually drawn, otherwise the optical height depends on the font's
    # ascender and every placement downstream inherits a stray offset.
    size = 400
    font = ImageFont.truetype(FONT, size)
    tracking = int(size * TRACKING)

    probe = ImageDraw.Draw(Image.new("L", (10, 10)))
    widths = [probe.textlength(ch, font=font) for ch in word]
    box = probe.textbbox((0, 0), word, font=font)
    width = int(sum(widths) + tracking * (len(word) - 1)) + 40
    height = (box[3] - box[1]) + 40

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    x = 20.0
    for ch, adv in zip(word, widths):
        draw.text((x, 20 - box[1]), ch, font=font, fill=(255, 255, 255, 255))
        x += adv + tracking

    ink = canvas.getbbox()
    trimmed = canvas.crop(ink)

    # Optical height. The `p` tails hang below the baseline, so the box is taller
    # than the letter line: scale by the ascender (top of the `h` down to the
    # baseline) and let the tails hang, instead of shrinking the whole word to
    # make room for them. The numbers are written next to the PNG so whoever
    # places it can line it up on the baseline rather than on a box edge.
    ascender = probe.textbbox((0, 0), "holU", font=font)[3] - box[1]
    scale = TARGET_H / ascender
    image = trimmed.resize((round(trimmed.width * scale), round(trimmed.height * scale)), Image.Resampling.LANCZOS)
    return image, round(ascender * scale)


def metrics(image: Image.Image, ascender: int) -> dict:
    return {"width": image.width, "height": image.height, "ascender": ascender}


def main() -> None:
    wordmark, ascender = build()
    out = SHARE / "holup-wordmark.png"
    wordmark.save(out)
    told = SHARE / "holup-wordmark.json"
    told.write_text(json.dumps(metrics(wordmark, ascender), indent=2) + "\n")
    print(f"{out.name}: {wordmark.width}x{wordmark.height}, ascender {ascender}")


if __name__ == "__main__":
    main()
