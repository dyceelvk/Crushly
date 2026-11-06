#!/usr/bin/env python3
"""What does this version say it changed?

`release.json` is what a phone reads before it installs anything, and its
`notes` field is the one sentence a member sees under the download button.
Until now that field was simply carried forward: the announce step only ever
passed bytes and a digest, so `notes` kept whatever the release *before* it
had written. 1.0.64 went out that way — a new APK described by an older
release's words — and no check anywhere could see it, because the field was
never wrong for the version that wrote it, only for every version after.

So the note now belongs to the version it describes. `release-notes.json` at
the repository root maps `version` -> one sentence, and the announce step
refuses to tell phones about a build whose version has no entry. A missing
sentence is a release that cannot be explained, and shipping the previous
release's explanation instead is worse than refusing.

The file is named with an underscore because `update_worker_release.py`
imports it; the other scripts here are standalone and use hyphens.
"""

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_JSON = ROOT / 'CrushlyApp' / 'app.json'
NOTES_JSON = ROOT / 'release-notes.json'


def current_version() -> str:
    """The version the app declares about itself, not one passed in a flag."""
    app = json.loads(APP_JSON.read_text())
    version = app.get('expo', {}).get('version')
    if not isinstance(version, str) or not version.strip():
        raise SystemExit('app.json has no expo.version, so no note can be looked up for it.')
    return version.strip()


def notes_file() -> dict:
    if not NOTES_JSON.exists():
        raise SystemExit(f'{NOTES_JSON.relative_to(ROOT)} is missing: no version can say what it changed.')
    try:
        notes = json.loads(NOTES_JSON.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f'{NOTES_JSON.relative_to(ROOT)} is not valid JSON: {exc}')
    if not isinstance(notes, dict):
        raise SystemExit(f'{NOTES_JSON.relative_to(ROOT)} must be an object of version -> sentence.')
    return notes


def note_for(version: str) -> str:
    """The sentence this version says about itself, or a refusal to invent one."""
    note = notes_file().get(version)
    if not isinstance(note, str) or not note.strip():
        raise SystemExit(
            f'{version} has no entry in release-notes.json. A phone that installs it '
            'would be told what some earlier release changed. Write one sentence '
            f'under "{version}" before this build is offered to anyone.'
        )
    return note.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', default=None, help='Defaults to the version in app.json.')
    ap.add_argument('--check', action='store_true', help='Say it out loud and exit 0; still fails when missing.')
    args = ap.parse_args()

    version = args.version or current_version()
    note = note_for(version)
    if args.check:
        print(f'{version} says: {note}')
    else:
        print(note)
    return 0


if __name__ == '__main__':
    sys.exit(main())
