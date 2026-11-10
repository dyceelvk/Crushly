#!/usr/bin/env python3
"""The end card: darkness, a drop, the name, and a logo that fills in.

Seven seconds after every clip:

    0.0s  darkness, and one second of sound — a drop, and a voice saying
          `holup` so low it is half understood
    0.2s  the mark arrives as a skeleton, bouncing gently, like a ball
    1.0s  it starts taking colour, left to right, over two and a half seconds
    3.5s  fully coloured, still bouncing, and it stays that way until the end

The name sits above the mark and the creator's handle below it. No address, no
product strings, nothing else: the card is the last thing somebody sees of a clip
that has already left the app.

    make-end-splash.py out.mp4 --handle @Sativva

Sound is `make-end-sound.py`; the skeleton is `make-watermark.py`.
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"

W, H, FPS, SECONDS = 1080, 1920, 30, 7.0

SYMBOL = SHARE / "holup-skeleton-white.png"
SYMBOL_COLOUR = SHARE / "holup-skeleton-colour.png"
WORDMARK = SHARE / "holup-wordmark.png"
SOUND = SHARE / "holup-end-sound.wav"
FONT_HANDLE = SHARE / "fonts/Manrope_600SemiBold.ttf"

# The owner asked for the card a little smaller. Everything on it is scaled
# together rather than one element alone, or the name would stop sitting on the
# mark the way it was composed to: 8% off each piece, which reads as quieter
# without becoming small.
CARD_W = 276            # the name, above the mark
ICON_W = 175            # the mark, under the name
HANDLE_SIZE = 31

APPEAR = 0.22           # the skeleton is there by here, fading in just before
APPEAR_FADE = 0.28
COLOUR_START = 1.00
COLOUR_LOAD = 2.50      # the brief: two to three seconds
BOUNCE = 12.0           # px. A ball on a floor, not a trampoline
BOUNCE_PERIOD = 0.88


def smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def darkness() -> Image.Image:
    """Near-black, with the faintest glow behind where the mark will be.

    Not a background: the brief says the card opens in darkness, and a plate with
    a visible gradient in it is not darkness.
    """
    plate = Image.new("RGBA", (W, H), (6, 4, 10, 255))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((W / 2 - 330, H / 2 - 330, W / 2 + 330, H / 2 + 330),
                                 fill=(96, 26, 84, 26))
    return Image.alpha_composite(plate, glow.filter(ImageFilter.GaussianBlur(170)))


def pieces() -> tuple[Image.Image, Image.Image, Image.Image, Image.Image]:
    symbol = Image.open(SYMBOL).convert("RGBA")
    symbol = symbol.resize((ICON_W, round(symbol.height * ICON_W / symbol.width)),
                           Image.Resampling.LANCZOS)
    colour = Image.open(SYMBOL_COLOUR).convert("RGBA").resize(symbol.size, Image.Resampling.LANCZOS)
    word = Image.open(WORDMARK).convert("RGBA")
    word = word.resize((CARD_W, round(word.height * CARD_W / word.width)), Image.Resampling.LANCZOS)
    return symbol, colour, word, word


def fade(piece: Image.Image, amount: float) -> Image.Image:
    out = piece.copy()
    out.putalpha(piece.split()[3].point(lambda value: int(value * amount)))
    return out


def colour_mask(size: tuple[int, int], progress: float) -> Image.Image:
    """Left-to-right fill with a soft edge, so the colour arrives, not cuts."""
    width, height = size
    edge = width * 0.22
    reach = progress * (width + edge)
    columns = np.arange(width, dtype=np.float32)[None, :]
    row = np.clip((reach - columns) / edge, 0, 1)
    ramp = np.repeat(row, height, axis=0)      # one row broadcast to the height
    return Image.fromarray((ramp * 255).astype(np.uint8), mode="L")


def build(out: Path, handle: str | None) -> None:
    plate = darkness()
    symbol, colour, word, _ = pieces()
    tag = (handle or "").strip()
    if tag and not tag.startswith("@"):
        tag = "@" + tag

    handle_font = ImageFont.truetype(str(FONT_HANDLE), HANDLE_SIZE)
    handle_layer = None
    handle_y = 0
    if tag:
        handle_layer = Image.new("RGBA", (W, HANDLE_SIZE + 12), (0, 0, 0, 0))
        ImageDraw.Draw(handle_layer).text((W / 2, 0), tag, anchor="ma",
                                          font=handle_font, fill=(255, 255, 255, 150))

    word_y = H // 2 - 186
    icon_y = H // 2 - 34
    handle_y = icon_y + symbol.height + 26

    with tempfile.TemporaryDirectory() as tmp:
        silent = Path(tmp) / "card.mp4"
        import imageio.v2 as imageio
        writer = imageio.get_writer(str(silent), format="FFMPEG", fps=FPS, codec="libx264",
                                    pixelformat="yuv420p", macro_block_size=1, quality=8,
                                    ffmpeg_log_level="warning")
        for index in range(round(FPS * SECONDS)):
            t = index / FPS
            frame = plate.copy()

            appear = smooth((t - APPEAR) / APPEAR_FADE)
            if appear > 0:
                colour_progress = smooth((t - COLOUR_START) / COLOUR_LOAD)
                # Bounce: a raised cosine, rectified, so the mark leaves the floor
                # fast, hangs at the top and lands — the shape of a ball.
                beat = (t % BOUNCE_PERIOD) / BOUNCE_PERIOD
                lift = abs(np.sin(np.pi * beat)) ** 0.85 * BOUNCE
                lift *= min(1.0, appear)  # it settles in with the bounce
                rise = round(-lift)

                lockup = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                lockup.alpha_composite(fade(word, appear), ((W - word.width) // 2, word_y + rise))

                mark = fade(symbol, appear)
                if colour_progress > 0:
                    tinted = colour.copy()
                    tinted.putalpha(Image.composite(tinted.split()[3], Image.new("L", tinted.size, 0),
                                                    colour_mask(tinted.size, colour_progress)))
                    tinted = fade(tinted, appear)
                    plate_mark = mark.copy()
                    plate_mark.alpha_composite(tinted)
                    mark = plate_mark
                lockup.alpha_composite(mark, ((W - symbol.width) // 2, icon_y + rise))

                if handle_layer is not None:
                    lockup.alpha_composite(fade(handle_layer, appear),
                                           (0, handle_y + round(-lift * 0.35)))
                frame = Image.alpha_composite(frame, lockup)
            writer.append_data(np.asarray(frame.convert("RGB")))
        writer.close()

        # The one second of sound, then six of nothing: the card opens on a noise
        # and holds in silence, which is what makes the noise land.
        audio = Path(tmp) / "card.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(SOUND),
             "-af", f"apad=whole_dur={SECONDS}", "-ar", "48000", "-ac", "2", str(audio)],
            check=True,
        ) if SOUND.exists() else None

        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent)]
        cmd += ["-i", str(audio)] if audio.exists() else [
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        cmd += ["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-shortest", "-movflags", "+faststart", str(out)]
        subprocess.run(cmd, check=True)

    print(f"end card: {out} ({SECONDS:.0f}s, handle {handle or 'none'})")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the holUpp end card.")
    ap.add_argument("output", type=Path)
    ap.add_argument("--handle", default=None, help="the creator's @username")
    ap.add_argument("--background", type=Path, default=None,
                    help="accepted for older callers; the card opens in darkness now")
    args = ap.parse_args()
    build(args.output, args.handle)


if __name__ == "__main__":
    main()
