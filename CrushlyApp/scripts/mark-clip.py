#!/usr/bin/env python3
"""Burn the Holup mark and the 6-second end splash into a clip.

The marked copy is what leaves the app; the original keeps playing inside it
untouched. That split is the whole point: nobody has to watch a corner stamp
during playback, and every copy that gets reposted somewhere else carries the
mark and the creator's handle whether or not whoever reposted it wanted that.

    mark-clip.py in.mp4 out.mp4 --handle @Sativva
    mark-clip.py in.mp4 out.mp4 --handle @Sativva --no-splash

Requires ffmpeg on PATH. This is a pipeline step, not app code: it runs once per
clip on a machine with ffmpeg, and the app only ever downloads the result.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_MARK = HERE.parent / "assets/share/holup-mark-base.png"
DEFAULT_SPLASH = HERE.parent / "assets/share/holup-end-splash-6s.mp4"

# Where the mark sits: horizontal centre, a little above the bottom, which is
# clear of the caption area on TikTok and Instagram alike and never covers a
# face in the middle of the frame.
MARK_Y_OFFSET = 250
# The mark drifts a few pixels either side over six seconds. A stamp pinned to
# one pixel is easy to crop out; a stamp that moves is not.
DRIFT_PX = 14
DRIFT_PERIOD = 6


def build_mark(base: Path, handle: str | None) -> Path:
    """The mark for one creator: the shared logo lockup, plus their handle.

    The handle is drawn here rather than baked into the artwork, because the
    artwork is shared by every export. A handle in the asset would credit whoever
    it was made for on everybody's clip.
    """
    if not handle:
        return base
    from PIL import Image, ImageDraw, ImageFont

    mark = Image.open(base).convert("RGBA")
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    text = handle if handle.startswith("@") else f"@{handle}"
    # The base carries ~20 px of empty margin under the lockup for its own soft
    # shadow, so the handle starts below that rather than on top of it: an
    # overlap there reads as a smear, not a shadow.
    top = mark.height + 16
    taller = Image.new("RGBA", (mark.width, top + 40), (0, 0, 0, 0))
    taller.alpha_composite(mark)
    draw = ImageDraw.Draw(taller)
    draw.text((taller.width / 2 + 1, top + 3), text, anchor="ma", font=font, fill=(0, 0, 0, 160))
    draw.text((taller.width / 2, top + 1), text, anchor="ma", font=font, fill=(255, 255, 255, 255))
    out = base.parent / "._holup-mark-tmp.png"
    taller.save(out)
    return out


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "json", str(path)], capture_output=True, check=True, text=True).stdout
    return float(json.loads(out)["format"]["duration"])


def build(inp: Path, out: Path, mark: Path, splash: Path | None, handle: str | None) -> None:
    duration = probe_duration(inp)
    mark = build_mark(mark, handle)
    filters = [
        # Normalise first so a vertical 720p clip and a 1080p one both land on
        # the same canvas the splash is cut for.
        "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0]",
        "[1:v]format=rgba[wmk]",
        f"[v0][wmk]overlay=x='(main_w-overlay_w)/2+{DRIFT_PX}*sin(2*PI*t/{DRIFT_PERIOD})':"
        f"y=main_h-overlay_h-{MARK_Y_OFFSET}:format=auto[vmarked]",
    ]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(inp), "-i", str(mark)]
    if splash:
        filters.append("[2:v]scale=1080:1920,setsar=1,fps=30[v1]")
        filters.append("[vmarked][v1]concat=n=2:v=1:a=0[vout]")
        filters.append("[0:a]aresample=48000,aformat=channel_layouts=stereo[a0]")
        filters.append("[2:a]aresample=48000,aformat=channel_layouts=stereo[a1]")
        filters.append("[a0][a1]concat=n=2:v=0:a=1[aout]")
        cmd += ["-i", str(splash)]
        maps = ["-map", "[vout]", "-map", "[aout]"]
    else:
        filters.append("[vmarked]null[vout]")
        maps = ["-map", "[vout]", "-map", "0:a?"]
    cmd += ["-filter_complex", ";".join(filters), *maps,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    print(f"{out.name}: {duration:.1f}s clip + "
          f"{(probe_duration(splash) if splash else 0):.1f}s splash, "
          f"{out.stat().st_size / 1e6:.2f} MB, handle {handle or 'none'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--handle", default=None,
                    help="creator handle already burned into the watermark asset; recorded here for the log")
    ap.add_argument("--mark", type=Path, default=DEFAULT_MARK)
    ap.add_argument("--splash", type=Path, default=DEFAULT_SPLASH)
    ap.add_argument("--no-splash", action="store_true", help="mark only, do not append the end splash")
    args = ap.parse_args()
    for p in (args.input, args.mark):
        if not p.exists():
            print(f"missing: {p}", file=sys.stderr)
            return 2
    splash = None if args.no_splash else args.splash
    if splash and not splash.exists():
        print(f"missing splash: {splash}", file=sys.stderr)
        return 2
    build(args.input, args.output, args.mark, splash, args.handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
