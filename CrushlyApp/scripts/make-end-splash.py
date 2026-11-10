#!/usr/bin/env python3
"""The end card: a seven-second breathing, travelling signature.

Based on the owner's `create_holup_breathing_path_outro.py`, which is the real
design — this file keeps its motion exactly and changes only the parts that
cannot be shared between creators:

  * the handle is passed in, not baked in. The card is appended to every export,
    so a handle in the file would credit whoever it was made for on everybody's
    clip;
  * the background is the clip's own last frame, so the card feels like the video
    exhaling rather than a slide pasted on the end;
  * no address anywhere on it. A URL on an end card is noise on somebody else's
    timeline.

    make-end-splash.py out.mp4 --handle @Amara [--background last-frame.png]

Requires ffmpeg on PATH.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, SECONDS = 1080, 1920, 30, 7.0
HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"
SYMBOL = SHARE / "holup-symbol.png"
WORDMARK = SHARE / "holup-wordmark.png"
CORAL, PINK, WHITE = (255, 135, 142), (240, 53, 180), (250, 247, 250)


def clamp(x): return max(0.0, min(1.0, x))
def smooth(x): x = clamp(x); return x * x * (3 - 2 * x)
def ease(x): return 1 - (1 - clamp(x)) ** 4
def lerp(a, b, p): return a + (b - a) * p


def cover(im, size):
    s = max(size[0] / im.width, size[1] / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.LANCZOS)
    x = (im.width - size[0]) // 2
    y = (im.height - size[1]) // 2
    return im.crop((x, y, x + size[0], y + size[1]))


def paste_center(canvas, asset, x, y, alpha=1, scale=1):
    if scale != 1:
        asset = asset.resize((max(1, round(asset.width * scale)), max(1, round(asset.height * scale))),
                             Image.Resampling.LANCZOS)
    if alpha < 1:
        asset = asset.copy()
        asset.putalpha(asset.getchannel("A").point(lambda a: int(a * clamp(alpha))))
    canvas.alpha_composite(asset, (round(x - asset.width / 2), round(y - asset.height / 2)))


# The signature's route through the screen: down-left -> centre -> top ->
# top-right -> right-centre -> down-left -> down-right. Unchanged from the
# owner's design.
STOPS = [
    (.28, (220, 1640)),
    (1.30, (540, 985)),
    (2.22, (540, 340)),
    (3.14, (848, 375)),
    (4.06, (850, 990)),
    (4.98, (220, 1650)),
    (5.92, (850, 1650)),
]


def signature_position(t):
    if t <= STOPS[0][0]:
        return STOPS[0][1]
    for (ta, a), (tb, b) in zip(STOPS, STOPS[1:]):
        if t <= tb:
            p = ease((t - ta) / (tb - ta))
            return lerp(a[0], b[0], p), lerp(a[1], b[1], p)
    return STOPS[-1][1]


def logo_pieces(symbol_w=106, word_w=246):
    """The mark and the wordmark as separate pieces, on one baseline.

    They are two assets because they are drawn at different sizes relative to
    each other than the supplied lockup: the card puts them side by side at a
    fixed gap, so scaling the pair as one image would leave a gap that depends on
    the size. The wordmark keeps its `p` tails, so it is placed by its ascender —
    line the name up by its box and it floats above the mark beside it.
    """
    symbol = Image.open(SYMBOL).convert("RGBA")
    word = Image.open(WORDMARK).convert("RGBA")
    ascender = json.loads(WORDMARK.with_suffix(".json").read_text())["ascender"]
    symbol = symbol.resize((symbol_w, round(symbol.height * symbol_w / symbol.width)), Image.Resampling.LANCZOS)
    # Measure the line off the source width: after the resize every width is the
    # one that was asked for, and the ascender would come back at full height.
    word_line = round(ascender * word_w / word.width)
    word = word.resize((word_w, round(word.height * word_w / word.width)), Image.Resampling.LANCZOS)
    return symbol, word, word_line


def background_frame(path: Path | None) -> Image.Image:
    """The clip's own last frame, or a plain deep plate when there is none."""
    if path and path.exists():
        return cover(Image.open(path).convert("RGB"), (W, H)).convert("RGBA")
    plate = Image.new("RGBA", (W, H), (18, 6, 16, 255))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((W / 2 - 430, 790, W / 2 + 430, 1650), fill=PINK + (46,))
    return Image.alpha_composite(plate, glow.filter(ImageFilter.GaussianBlur(150)))


def build(out: Path, handle: str | None, background: Path | None) -> None:
    final_frame = background_frame(background)
    blink_blur = final_frame.filter(ImageFilter.GaussianBlur(2.4))
    symbol, wordmark, word_line = logo_pieces()
    font = ImageFont.truetype(str(SHARE / "fonts/Manrope_600SemiBold.ttf"), 30)
    font_micro = ImageFont.truetype(str(SHARE / "fonts/Manrope_800ExtraBold.ttf"), 13)
    tag = (handle or "").strip()
    if tag and not tag.startswith("@"):
        tag = "@" + tag

    with tempfile.TemporaryDirectory() as tmp:
        silent = Path(tmp) / "silent.mp4"
        import imageio.v2 as imageio
        writer = imageio.get_writer(str(silent), format="FFMPEG", fps=FPS, codec="libx264",
                                    pixelformat="yuv420p", macro_block_size=1, quality=8,
                                    ffmpeg_log_level="warning")
        for index in range(round(FPS * SECONDS)):
            t = index / FPS
            # It starts and ends on the creator's own picture.
            blur = smooth((t - .10) / .12) * (1 - smooth((t - 6.50) / .35))
            frame = Image.blend(final_frame, blink_blur, blur * .58)
            if .10 <= t < .27:
                p = (t - .10) / .17
                close = 1 - abs(2 * p - 1)
                lid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                d = ImageDraw.Draw(lid)
                amount = int(H * .34 * close)
                d.rectangle((0, 0, W, amount), fill=(0, 0, 0, int(225 * close)))
                d.rectangle((0, H - amount, W, H), fill=(0, 0, 0, int(225 * close)))
                frame.alpha_composite(lid.filter(ImageFilter.GaussianBlur(22)))
                if .145 < t < .205:
                    flash = 1 - abs(t - .175) / .03
                    beam = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                    ImageDraw.Draw(beam).line((115, 960, 965, 960), fill=(255, 245, 252, int(210 * flash)), width=2)
                    frame.alpha_composite(beam.filter(ImageFilter.GaussianBlur(1)))

            if t >= .25:
                appear = smooth((t - .25) / .16)
                vanish = 1 - smooth((t - 6.32) / .48)
                alpha = appear * vanish
                cx, cy = signature_position(t)
                breath = .5 + .5 * np.sin(2 * np.pi * (t - .25) / 1.30)
                scale = 1 + .042 * breath

                path_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                pd = ImageDraw.Draw(path_layer)
                for stamp, (sx, sy) in STOPS:
                    if stamp + .12 < t < stamp + .58:
                        q = (t - stamp - .12) / .46
                        pd.ellipse((sx - 26 - q * 46, sy - 8 - q * 12, sx + 26 + q * 46, sy + 8 + q * 12),
                                   outline=PINK + (int(30 * (1 - q) * alpha),), width=2)
                frame.alpha_composite(path_layer)

                card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                cd = ImageDraw.Draw(card)
                card_alpha = int((104 + 28 * breath) * alpha)
                cd.rounded_rectangle((cx - 218, cy - 109, cx + 218, cy + 109), radius=35, fill=(7, 5, 10, card_alpha))
                cd.line((cx - 130, cy - 83, cx, cy - 83), fill=CORAL + (int(235 * alpha),), width=3)
                cd.line((cx, cy - 83, cx + 130, cy - 83), fill=PINK + (int(235 * alpha),), width=3)
                frame.alpha_composite(card.filter(ImageFilter.GaussianBlur(.22)))

                # One lockup: mark, then wordmark, with a fixed gap between them.
                gap = 18
                total = symbol.width + gap + wordmark.width
                left = cx - total / 2
                art_top = cy - 31 - symbol.height / 2
                paste_center(frame, symbol, left + symbol.width / 2, art_top + symbol.height / 2, alpha, scale)
                paste_center(frame, wordmark, left + symbol.width + gap + wordmark.width / 2,
                             art_top + (symbol.height - word_line) + wordmark.height / 2, alpha, scale)

                labels = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                ld = ImageDraw.Draw(labels)
                if tag:
                    box = ld.textbbox((0, 0), tag, font=font)
                    ld.text((cx - (box[2] - box[0]) / 2, cy + 40), tag, font=font, fill=WHITE + (int(225 * alpha),))
                ld.text((cx, cy + 80), 'holUpp ORIGINAL', anchor='ma', font=font_micro,
                        fill=(255, 255, 255, int(105 * alpha)))
                frame.alpha_composite(labels)

                halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                hd = ImageDraw.Draw(halo)
                r = 54 + 25 * breath
                hd.ellipse((cx - 117 - r, cy - 31 - r * .18, cx - 117 + r, cy - 31 + r * .18),
                           outline=PINK + (int(35 * (.4 + .6 * breath) * alpha),), width=2)
                frame.alpha_composite(halo)
            writer.append_data(np.asarray(frame.convert("RGB")))
        writer.close()

        # Silent track, so this can follow a clip that already has music.
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(silent),
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", str(out),
        ], check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("output", type=Path)
    ap.add_argument("--handle", default=None, help="the post author's handle, drawn on the card")
    ap.add_argument("--background", type=Path, default=None, help="the clip's last frame")
    args = ap.parse_args()
    build(args.output, args.handle, args.background)
    print(f"end card: {args.output} ({SECONDS:.0f}s, handle {args.handle or 'none'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
