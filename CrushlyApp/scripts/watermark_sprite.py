#!/usr/bin/env python3
"""Build the holUpp watermark: a skeleton icon with the creator's handle under it.

One 7-second cycle, rendered once as a looping sprite and then placed by ffmpeg:

    0.0s   the mark appears, plain white, in one spot
    5.0s   it starts taking its colour
    7.0s   fully coloured — and it is gone, somewhere else next

The colour load lives in the last two seconds of each stop, so a mark that has
just arrived is always still white, and the thing that disappears is always the
coloured one. The sprite loops, so the whole rhythm repeats without any timing
being written into the filter graph.

Nothing here is drawn with text: no name, no address. The only word on screen is
the creator's own handle, and it is small, quiet and barely there.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"

# The mark's width as a share of the frame, not a fixed number of pixels.
#
# It was 86 px at 1080 wide — 8% of the frame — and the owner asked for it a
# little larger. "+2%" is read as two percentage points of the frame rather than
# two percent of the icon, because two percent of 86 px is half a pixel and
# would change nothing anybody could see. 10% of 1080 is 108 px.
ICON_W_PCT = 0.10
FRAME_W = 1080          # the canvas every marked clip is drawn at
ICON_W = round(FRAME_W * ICON_W_PCT)   # 108 px — a signature, not a bumper
HANDLE_SIZE = 26
HANDLE_GAP = 10         # px between icon and handle
# Transparency was the other complaint. Still a signature — the point is that it
# is noticed, not that it is faint — so this is a modest lift, not a jump to
# something opaque.
ICON_ALPHA = 0.27       # white skeleton
COLOUR_ALPHA = 0.34     # colour needs a touch more to read at the same weight
DWELL = 7.0             # seconds in one spot
LOAD = 2.0              # seconds of the dwell spent taking colour
FADE_IN = 0.12          # it lands, it does not glide
FADE_OUT = 0.10
CYCLE_FPS = 30

FONT = SHARE / "fonts/Manrope_600SemiBold.ttf"


def sprite_size(handle: str) -> tuple[int, int]:
    font = ImageFont.truetype(str(FONT), HANDLE_SIZE)
    probe = ImageDraw.Draw(Image.new("L", (8, 8)))
    text = handle.strip()
    if text and not text.startswith("@"):
        text = "@" + text
    width = max(ICON_W + 6, int(probe.textlength(text, font=font)))
    return width, icon_height() + HANDLE_GAP + HANDLE_SIZE + 6


def icon_height() -> int:
    icon = Image.open(SHARE / "holup-skeleton-white.png")
    return round(ICON_W * icon.height / icon.width)


def one_frame(handle: str, elapsed: float, size: tuple[int, int]) -> Image.Image:
    """A single frame of the cycle, already at the right opacity."""
    width, height = size
    frame = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    colour = 0.0
    if elapsed > DWELL - LOAD:
        colour = min(1.0, (elapsed - (DWELL - LOAD)) / LOAD)

    fade = 1.0
    if elapsed < FADE_IN:
        fade = elapsed / FADE_IN
    if elapsed > DWELL - FADE_OUT:
        fade = min(fade, (DWELL - elapsed) / FADE_OUT)
    fade = max(0.0, min(1.0, fade))

    for name, alpha in (("holup-skeleton-white.png", ICON_ALPHA),
                        ("holup-skeleton-colour.png", COLOUR_ALPHA)):
        if name.endswith("colour.png") and colour <= 0:
            continue
        piece = Image.open(SHARE / name).convert("RGBA")
        piece = piece.resize((ICON_W, icon_height()), Image.Resampling.LANCZOS)
        weight = alpha * fade * (colour if name.endswith("colour.png") else 1 - colour)
        if weight <= 0.001:
            continue
        channel = piece.split()[3].point(lambda value, w=weight: int(value * w))
        piece.putalpha(channel)
        frame.alpha_composite(piece, ((width - ICON_W) // 2, 0))

    text = (handle or "").strip()
    if text:
        if not text.startswith("@"):
            text = "@" + text
        font = ImageFont.truetype(str(FONT), HANDLE_SIZE)
        pen = ImageDraw.Draw(frame)
        ink = Image.new("RGBA", (width, HANDLE_SIZE + 8), (0, 0, 0, 0))
        ImageDraw.Draw(ink).text((width / 2, 0), text, anchor="ma", font=font,
                                 fill=(255, 255, 255, int(255 * ICON_ALPHA * fade * 1.15
                                                          + 255 * COLOUR_ALPHA * fade * colour * 0.9)))
        frame.alpha_composite(ink, (0, icon_height() + HANDLE_GAP))
    return frame


def build_sprite(handle: str) -> tuple[Path, tuple[int, int]]:
    """Render the whole cycle once, as an RGBA movie that loops."""
    size = sprite_size(handle)
    work = Path(tempfile.mkdtemp(prefix="holupp-wm-"))
    frames = round(DWELL * CYCLE_FPS)
    for index in range(frames):
        one_frame(handle, index / CYCLE_FPS, size).save(work / f"f{index:04d}.png")

    target = work / "watermark.mov"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(CYCLE_FPS),
         "-i", str(work / "f%04d.png"), "-c:v", "qtrle", "-pix_fmt", "rgba",
         str(target)],
        check=True,
    )
    return target, size


def clean(path: Path) -> None:
    shutil.rmtree(path.parent, ignore_errors=True)
