#!/usr/bin/env python3
"""Build the travelling watermark from the two brand pieces.

One file rather than two, because the overlay has to scale and place the whole
lockup as a unit; the handle is drawn on top of this at mark time, per creator.

The two pieces are aligned on the **baseline**, not on their bounding boxes: the
wordmark's `p` tails hang below the line and the symbol is a pair of circles, so
matching box heights would sit the name on a different line than the mark beside
it. `holup-wordmark.json` carries the ascender height that makes this possible.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"
TARGET_H = 78      # height of the artwork line, before padding
GAP = 18           # between the mark and the wordmark
HANDLE_ROOM = 46   # empty space underneath, where the creator's handle goes


def main() -> None:
    symbol = Image.open(SHARE / "holup-symbol.png").convert("RGBA")
    word = Image.open(SHARE / "holup-wordmark.png").convert("RGBA")
    ascender = json.loads((SHARE / "holup-wordmark.json").read_text())["ascender"]

    symbol = symbol.resize((round(symbol.width * TARGET_H / symbol.height), TARGET_H), Image.Resampling.LANCZOS)
    word = word.resize((round(word.width * TARGET_H / ascender), round(word.height * TARGET_H / ascender)), Image.Resampling.LANCZOS)
    descender = word.height - TARGET_H

    width = symbol.width + GAP + word.width
    height = TARGET_H + descender + HANDLE_ROOM
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(symbol, (0, 0))
    canvas.alpha_composite(word, (symbol.width + GAP, 0))
    out = SHARE / "holup-mark-lockup.png"
    canvas.save(out)
    print(f"{out.name}: {canvas.width}x{canvas.height} (art {TARGET_H}, tails {descender})")


if __name__ == "__main__":
    main()
