#!/usr/bin/env python3
"""Experimental standalone preview encoder, NOT a serving or upload service.

Only invoke in an isolated transcoding sandbox with an already-authorized local
file. This helper does not fetch inputs, publish outputs, grant access, enforce
view limits, or guarantee privacy on its own. Do not expose it directly to users.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile

SECONDS = 13.0
TIMEOUT = 180
MAX_INPUT = 80 * 1024 * 1024
# Limit probing/decoding to actual video containers. Further OS-level sandboxing
# and unprivileged execution are mandatory for untrusted media in production.
DEMUXERS = 'mov,matroska,webm,avi,mpegts,mpeg'


class PreviewError(Exception):
    pass


def _run(args: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              check=True, timeout=TIMEOUT)
    except (FileNotFoundError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
        raise PreviewError('Preview conversion failed') from exc


def _probe(path: Path, *, source: bool) -> dict:
    args = ['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe']
    if source:
        args += ['-format_whitelist', DEMUXERS]
    args += ['-show_entries', 'format=duration:stream=codec_type,duration:stream_disposition=attached_pic',
             '-of', 'json', str(path)]
    try:
        return json.loads(_run(args).stdout)
    except (ValueError, TypeError) as exc:
        raise PreviewError('Invalid video') from exc


def create_preview(source: str | Path, destination: str | Path) -> None:
    src, dest = Path(source), Path(destination)
    if src.is_symlink() or not src.is_file() or src.stat().st_size > MAX_INPUT or src.stat().st_size == 0:
        raise PreviewError('Invalid source video')
    if dest.suffix.lower() != '.mp4' or src.resolve() == dest.resolve():
        raise PreviewError('Invalid preview destination')
    info = _probe(src, source=True)
    if not any(s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic') for s in info.get('streams', [])):
        raise PreviewError('A real video stream is required')
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Never write a partial output to its eventual name. The caller must upload
    # only after this succeeds and after re-checking the post's current privacy.
    fd, raw = tempfile.mkstemp(prefix='.preview-', suffix='.mp4', dir=dest.parent)
    os.close(fd)
    tmp = Path(raw)
    try:
        _run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
              '-protocol_whitelist', 'file,pipe', '-format_whitelist', DEMUXERS,
              '-i', str(src), '-t', str(SECONDS), '-map', '0:V:0', '-map', '0:a:0?',
              '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
              '-vf', "scale=w='min(720,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=fps=30",
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', str(tmp)])
        out = _probe(tmp, source=False)
        duration = float(out.get('format', {}).get('duration', 0))
        streams = out.get('streams', [])
        if not 0 < duration <= SECONDS + 0.05 or sum(s.get('codec_type') == 'video' for s in streams) != 1:
            raise PreviewError('Preview length or streams failed validation')
        for stream in streams:
            if stream.get('codec_type') not in ('video', 'audio'):
                raise PreviewError('Unexpected preview stream')
            if stream.get('duration') is not None and float(stream['duration']) > SECONDS + 0.05:
                raise PreviewError('Preview stream exceeds limit')
        os.replace(tmp, dest)
    except (ValueError, TypeError, OSError) as exc:
        raise PreviewError('Preview validation failed') from exc
    finally:
        tmp.unlink(missing_ok=True)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Create a local 13-second preview (not a serving service)')
    parser.add_argument('source')
    parser.add_argument('destination')
    args = parser.parse_args()
    create_preview(args.source, args.destination)
