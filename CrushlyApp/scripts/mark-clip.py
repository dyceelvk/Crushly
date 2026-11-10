#!/usr/bin/env python3
"""Burn the holUpp mark and the end card into a clip.

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
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SPLASH = HERE.parent / "assets/share/holup-end-splash-7s.mp4"

# The mark does not travel: it appears in one place, holds, and is suddenly
# somewhere else. A stamp that slides is a stamp the eye follows; one that
# teleports is gone before the eye catches it, and one that moves at all is
# harder to crop out than one that sits still.
#
# There are three places, not one per corner: upper left, middle right, lower
# left. Seven seconds in each, in that order, looped. The colour arrives in the
# last two seconds of a stop (see `watermark_sprite`), so what vanishes is always
# the coloured one and what arrives is always plain.
SPOTS = [
    (0.20, 0.17),   # upper left
    (0.80, 0.50),   # middle right
    (0.32, 0.80),   # lower left
]
DWELL = 7.0
CANVAS = (1080, 1920)


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "json", str(path)], capture_output=True, check=True, text=True).stdout
    return float(json.loads(out)["format"]["duration"])


def make_end_card(clip: Path, shared: Path, handle: str | None) -> Path | None:
    """Generate this clip's end card, or None to fall back to the shared one."""
    script = Path(__file__).resolve().parent / "make-end-splash.py"
    if not script.exists():
        return None
    target = Path(tempfile.gettempdir()) / f"{clip.stem}-endcard.mp4"
    cmd = [sys.executable, str(script), str(target)]
    if handle:
        cmd += ["--handle", handle]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not target.exists():
        print("  end card fell back to the shared file:", result.stderr.strip()[-200:], file=sys.stderr)
        return None
    return target


def has_audio(path: Path) -> bool:
    """Whether the clip carries a sound track at all.

    A silent clip is legal — somebody can post one — and the concat chain that
    joins the end card's silent track to the clip's would otherwise fail the
    whole batch on `-map [aout]` for a stream that was never there.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return bool(out.stdout.strip())


def build(inp: Path, out: Path, splash: Path | None, handle: str | None) -> None:
    duration = probe_duration(inp)
    sound = has_audio(inp)

    from watermark_sprite import build_sprite, clean, icon_height

    sprite, size = build_sprite(handle or "")
    icon_h = icon_height()

    def axis(targets: list[float]) -> str:
        """Which of the three places, decided by how many stops have gone by.

        Written against `floor(t / DWELL)` rather than against a fade or a key
        frame, so the mark is simply elsewhere on the next frame: no movement,
        nothing to follow.
        """
        comma = r"\,"
        index = f"mod(floor(t/{DWELL}){comma}3)"
        expression = f"{targets[2]}"
        for spot in (1, 0):
            expression = f"if(eq({index}{comma}{spot}){comma}{targets[spot]}{comma}{expression})"
        return expression

    xs = [round(CANVAS[0] * fx - size[0] / 2) for fx, _ in SPOTS]
    ys = [round(CANVAS[1] * fy - icon_h / 2) for _, fy in SPOTS]

    filters = [
        # Normalise first so a vertical 720p clip and a 1080p one both land on
        # the same canvas the end card is cut for.
        "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0]",
        "[1:v]format=rgba[wmk]",
                # shortest=1 and the output -t below are both load-bearing: the sprite
        # input is looped forever on purpose, and without them the overlay keeps
        # asking for frames after the clip ends — the first run of this produced a
        # 27-minute file for a 3-second clip.
        f"[v0][wmk]overlay=x='{axis(xs)}':y='{axis(ys)}':format=auto:eval=frame:shortest=1[vmarked]",
    ]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(inp),
           "-stream_loop", "-1", "-i", str(sprite)]
    if splash:
        filters.append("[2:v]scale=1080:1920,setsar=1,fps=30[v1]")
        filters.append("[vmarked][v1]concat=n=2:v=1:a=0[vout]")
        if sound:
            filters.append("[0:a]aresample=48000,aformat=channel_layouts=stereo[a0]")
            filters.append("[2:a]aresample=48000,aformat=channel_layouts=stereo[a1]")
            filters.append("[a0][a1]concat=n=2:v=0:a=1[aout]")
        cmd += ["-i", str(splash)]
        maps = ["-map", "[vout]", "-map", "[aout]"] if sound else ["-map", "[vout]"]
    else:
        filters.append("[vmarked]null[vout]")
        maps = ["-map", "[vout]", "-map", "0:a?"] if sound else ["-map", "[vout]"]
    total = duration + (probe_duration(splash) if splash else 0)
    cmd += ["-filter_complex", ";".join(filters), *maps, "-t", f"{total:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", *(["-c:a", "aac", "-b:a", "128k"] if sound else []),
            "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    print(f"{out.name}: {duration:.1f}s clip + "
          f"{(probe_duration(splash) if splash else 0):.1f}s card, "
          f"{out.stat().st_size / 1e6:.2f} MB, handle {handle or 'none'}, "
          f"{max(1, -(-int(duration) // int(DWELL)))} stop(s)")
    clean(sprite)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--handle", default=None,
                    help="the creator's @username, drawn under the mark for this clip only")
    ap.add_argument("--splash", type=Path, default=DEFAULT_SPLASH)
    ap.add_argument("--no-splash", action="store_true", help="mark only, do not append the end splash")
    args = ap.parse_args()
    for p in (args.input,):
        if not p.exists():
            print(f"missing: {p}", file=sys.stderr)
            return 2
    splash = None if args.no_splash else args.splash
    if splash:
        # Drawn fresh for this clip with its author's handle. The shared .mp4 is
        # only a fallback for when that cannot run.
        made = make_end_card(args.input, splash, args.handle)
        splash = made or (splash if splash.exists() else None)
        if splash is None:
            print("no end card available", file=sys.stderr)
            return 2
    build(args.input, args.output, splash, args.handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
