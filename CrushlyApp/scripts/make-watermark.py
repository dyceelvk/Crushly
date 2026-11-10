#!/usr/bin/env python3
"""Draw the holUpp mark as a skeleton — the line version of the logo.

The supplied artwork is two flat filled circles. A watermark made of that is a
solid blob sitting on top of somebody's footage; a line version reads as a
signature and leaves the picture alone. So the geometry of the real logo is
measured off `holup-symbol.png` (not redrawn by eye) and stroked instead of
filled: both circles, plus the hole that makes the pair read as a knot rather
than two dots.

    make-watermark.py            # writes the white and brand-coloured strokes

Everything is drawn at 4x and reduced, so the curve of a 44 px icon is smooth
rather than a staircase.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"
SOURCE = SHARE / "holup-symbol.png"
TOLD = SHARE / "holup-symbol-geometry.json"

SUPERSAMPLE = 4
STROKE = 9.5        # px of the 383 px-tall artwork: the weight of the outline
COLOURS = {
    "coral": (252, 133, 138),
    "pink": (251, 70, 163),
}


def measure(source: Path) -> dict:
    """Read the circles out of the artwork instead of guessing them.

    Two rows and two columns are enough: the silhouette's extremes give each
    circle's diameter and centre, and the dark disc inside the right circle
    gives the hole.
    """
    rgba = np.array(Image.open(source).convert("RGBA")).astype(int)
    rgb, alpha = rgba[:, :, :3], rgba[:, :, 3]
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    ink = (alpha > 120) & (sat > 45)

    def span(axis_values):
        return int(axis_values.min()), int(axis_values.max())

    left_top, left_bottom = span(np.where(ink[:, 191])[0])          # left circle, vertical
    right_top, right_bottom = span(np.where(ink[:, 436])[0])        # right circle, vertical
    left_edge, right_edge = span(np.where(ink[191, :])[0])          # silhouette, horizontal

    hole = (sat < 45) & (alpha > 120)
    hole_x = span(np.where(hole)[1])
    hole_y = span(np.where(hole)[0])

    def circle(t, b, x_edge, from_left: bool):
        radius = (b - t) / 2
        centre_y = (t + b) / 2
        centre_x = x_edge + radius if from_left else x_edge - radius
        return {"x": round(centre_x, 2), "y": round(centre_y, 2), "r": round(radius, 2)}

    return {
        "size": [int(rgba.shape[1]), int(rgba.shape[0])],
        "left": circle(left_top, left_bottom, left_edge, from_left=True),
        "right": circle(right_top, right_bottom, right_edge, from_left=False),
        "hole": {
            "x": (hole_x[0] + hole_x[1]) / 2,
            "y": (hole_y[0] + hole_y[1]) / 2,
            "r": (hole_x[1] - hole_x[0]) / 2,
        },
    }


def draw(geometry: dict, stroke_colours: dict[str, tuple[int, int, int]]) -> Image.Image:
    """The skeleton at full artwork size, transparent everywhere else."""
    width, height = geometry["size"]
    big = Image.new("RGBA", (width * SUPERSAMPLE, height * SUPERSAMPLE), (0, 0, 0, 0))
    pen = ImageDraw.Draw(big)
    weight = STROKE * SUPERSAMPLE

    def ring(x, y, r, colour):
        pen.ellipse(
            ((x - r) * SUPERSAMPLE, (y - r) * SUPERSAMPLE,
             (x + r) * SUPERSAMPLE, (y + r) * SUPERSAMPLE),
            outline=colour + (255,), width=round(weight),
        )

    ring(geometry["left"]["x"], geometry["left"]["y"], geometry["left"]["r"], stroke_colours["left"])
    ring(geometry["right"]["x"], geometry["right"]["y"], geometry["right"]["r"], stroke_colours["right"])
    ring(geometry["hole"]["x"], geometry["hole"]["y"], geometry["hole"]["r"], stroke_colours["hole"])
    return big.resize((width, height), Image.Resampling.LANCZOS)


def main() -> None:
    geometry = measure(SOURCE)
    TOLD.write_text(json.dumps(geometry, indent=2) + "\n")

    white = draw(geometry, {"left": (255, 255, 255), "right": (255, 255, 255), "hole": (255, 255, 255)})
    white.save(SHARE / "holup-skeleton-white.png")

    # The coloured skeleton: the same strokes in the brand pair, so the mark can
    # arrive as a line drawing and then take its colours without changing shape.
    brand = draw(geometry, {"left": COLOURS["coral"], "right": COLOURS["pink"], "hole": COLOURS["pink"]})
    brand.save(SHARE / "holup-skeleton-colour.png")

    for name in ("holup-skeleton-white.png", "holup-skeleton-colour.png"):
        size = Image.open(SHARE / name).size
        print(f"{name}: {size[0]}x{size[1]}")
    print("geometry:", json.dumps(geometry))


if __name__ == "__main__":
    main()
