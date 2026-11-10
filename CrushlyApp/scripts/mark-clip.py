#!/usr/bin/env python3
"""Burn the holUpp mark and the breathing-path end card into a clip.

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
DEFAULT_MARK = HERE.parent / "assets/share/holup-mark-lockup.png"
DEFAULT_SPLASH = HERE.parent / "assets/share/holup-end-splash-7s.mp4"

# The mark is small on purpose: it is a signature, not a bumper. It is also not
# in one place — a stamp that never moves is a stamp a re-uploader crops off, and
# the corners it visits are the four a crop cannot take without losing the video.
# Order is top-left, top-right, bottom-right, bottom-left, and the loop closes
# back on top-left.
MARK_SCALE = 0.42          # of the base lockup, so ~60% of the old size
MARK_MARGIN = 46           # px from the edge
TRAVEL_CYCLE = 12.0        # seconds for one full tour
TRAVEL_STEP = 3.0          # seconds parked at each corner
TRAVEL_SHIFT = 0.9         # seconds easing from one corner to the next


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
    font = ImageFont.truetype(str(HERE.parent / "assets/share/fonts/Manrope_600SemiBold.ttf"), 28)
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
    # Written to a temp directory, not next to the artwork: a build that dies
    # halfway would otherwise leave a per-creator file sitting in the assets that
    # are copied around, and one creator's handle would ship with the app.
    out = Path(tempfile.mkdtemp(prefix="holupp-mark-")) / "mark.png"
    taller.save(out)
    return out


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "json", str(path)], capture_output=True, check=True, text=True).stdout
    return float(json.loads(out)["format"]["duration"])


def last_frame(clip: Path, into: Path) -> Path | None:
    """The clip's final frame, which is what the end card opens and closes on."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-0.2", "-i", str(clip),
         "-frames:v", "1", "-q:v", "2", str(into)],
        capture_output=True,
    )
    return into if result.returncode == 0 and into.exists() else None


def make_end_card(clip: Path, shared: Path, handle: str | None) -> Path | None:
    """Generate this clip's end card, or None to fall back to the shared one."""
    script = Path(__file__).resolve().parent / "make-end-splash.py"
    if not script.exists():
        return None
    frame = last_frame(clip, Path(tempfile.gettempdir()) / f"{clip.stem}-lastframe.jpg")
    target = Path(tempfile.gettempdir()) / f"{clip.stem}-endcard.mp4"
    cmd = [sys.executable, str(script), str(target)]
    if handle:
        cmd += ["--handle", handle]
    if frame:
        cmd += ["--background", str(frame)]
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


def build(inp: Path, out: Path, mark: Path, splash: Path | None, handle: str | None) -> None:
    duration = probe_duration(inp)
    sound = has_audio(inp)
    mark = build_mark(mark, handle)
    # Four corners in a fixed order, as absolute pixel targets.
    left = float(MARK_MARGIN)
    top = float(MARK_MARGIN)
    xs = [left, f"main_w-overlay_w-{MARK_MARGIN}", f"main_w-overlay_w-{MARK_MARGIN}", left]
    ys = [top, top, f"main_h-overlay_h-{MARK_MARGIN}", f"main_h-overlay_h-{MARK_MARGIN}"]

    def axis_expr(targets: list) -> str:
        """Ease through the corners, looping seamlessly.

        Written as a running sum of deltas rather than a chain of ifs: at phase 0
        the mark is still where the last cycle left it, then it eases on to the
        first corner, so the tour has no visible seam. Commas inside an ffmpeg
        expression are escaped because the filter parser splits on them.
        """
        span = TRAVEL_CYCLE
        comma = r"\,"
        parts = [f"({targets[-1]})"]
        for index, target in enumerate(targets):
            start = index * TRAVEL_STEP
            u = f"(mod(t{comma}{span})-{start})"
            progress = f"min(max({u}/{TRAVEL_SHIFT}{comma}0){comma}1)"
            eased = f"({progress}*{progress}*(3-2*{progress}))"
            parts.append(f"((({target})-({targets[index - 1]}))*{eased})")
        return "+".join(parts)

    filters = [
        # Normalise first so a vertical 720p clip and a 1080p one both land on
        # the same canvas the end card is cut for.
        "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0]",
        f"[1:v]scale=iw*{MARK_SCALE}:-1,format=rgba[wmk]",
        f"[v0][wmk]overlay=x='{axis_expr(xs)}':y='{axis_expr(ys)}':format=auto[vmarked]",
    ]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(inp), "-i", str(mark)]
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
    cmd += ["-filter_complex", ";".join(filters), *maps,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", *(["-c:a", "aac", "-b:a", "128k"] if sound else []),
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
    if splash:
        # Drawn fresh for this clip, on its own final frame, with its author's
        # handle. The shared .mp4 is only a fallback for when that cannot run.
        made = make_end_card(args.input, splash, args.handle)
        splash = made or (splash if splash.exists() else None)
        if splash is None:
            print("no end card available", file=sys.stderr)
            return 2
    build(args.input, args.output, args.mark, splash, args.handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
