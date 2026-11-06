#!/usr/bin/env python3
"""
Tell the media Worker which Android build is current.

Run after a build has passed its tests. It reads the version the app declares
about itself and rewrites `release.json`, which is the only place the Worker
looks when a phone asks what to install.

Without this the release is a two-step, easy-to-forget job: publish the APK,
then remember to edit the Worker by hand. Forget the second step and the app
keeps offering the old build, or offers a file that is not there.

The version code is `android.versionCode` from `app.json`, because that is the
number compiled into the APK's manifest and the only one a phone compares
against. It used to be derived from the version string (`1.0.20` became
100020), which meant `/version` advertised 100020 while the APK it pointed at
declared 20 — so a phone already running that build was told an update existed,
forever, and installing it changed nothing. A code must still only rise; that
is enforced against the previous *manifest* code, and the fix for a regression
is to bump `android.versionCode`, not to invent a bigger number here.

The note a phone reads is never inherited: it is looked up in
`release-notes.json` by the version being announced (see `update_notes.py`),
and an announcement without one refuses to run rather than carrying the
previous release's sentence forward.

`minVersionCode` is deliberately left alone. Raising it tells every phone below
that number it *must* update rather than merely may, which is a decision a
person makes, not a build.
"""

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from update_notes import note_for  # noqa: E402  (sibling script, same directory)

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_JSON = ROOT / 'CrushlyApp' / 'app.json'
RELEASE_JSON = ROOT / 'cloudflare' / 'media-worker' / 'src' / 'release.json'

REPO = 'dyceelvk/Crushly'


def version_code(app: dict) -> int:
    """The code a phone actually compares: the one in the APK's manifest."""
    code = (app.get('expo', {}).get('android') or {}).get('versionCode')
    if not isinstance(code, int):
        raise SystemExit(
            'app.json has no integer android.versionCode. A phone compares that '
            'number against /version, so there is nothing to publish without it.'
        )
    return code


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', default=None, help='Overrides release-notes.json; rarely right.')
    ap.add_argument('--bytes', type=int, default=None, help='Exact size of the APK, so a member can check the download.')
    ap.add_argument('--sha256', default=None, help='SHA-256 of the APK, published on the download page.')
    ap.add_argument('--check', action='store_true', help='Report whether it is up to date without writing.')
    args = ap.parse_args()

    app = json.loads(APP_JSON.read_text())
    version = app['expo']['version']
    release = json.loads(RELEASE_JSON.read_text())
    # Looked up before anything is written: a version that cannot describe
    # itself must fail here, while nothing has been told to anyone.
    notes = args.notes if args.notes is not None else note_for(version)

    if (
        version == release['version']
        and notes in (None, release['notes'])
        and args.bytes in (None, release.get('bytes'))
        and args.sha256 in (None, release.get('sha256'))
    ):
        print(f"release.json already describes {version} — nothing to do.")
        print('changed=false')
        return 0

    code = version_code(app)
    # A code that went backwards would make an update invisible to a phone that
    # already had the newer one. Values of 100000 and up are from the retired
    # scheme that multiplied the version out; they were never a manifest code,
    # so they say nothing about what a phone is running.
    previous = int(release['versionCode'])
    if version != release['version'] and code <= previous < 100_000:
        raise SystemExit(
            f'android.versionCode is {code} but {previous} was published for '
            f'{release["version"]}. Bump android.versionCode in app.json; it must '
            'only ever go up.'
        )

    file_name = f'Crushly-{version}-Android9plus.apk'

    release = {
        'version': version,
        'versionCode': code,
        'minVersionCode': release['minVersionCode'],
        'file': file_name,
        'notes': notes,
        'upstream': f'https://github.com/{REPO}/releases/download/android-test-{version}/{file_name}',
        # Kept when not supplied, so a release can be re-announced without
        # losing the fingerprint already published for it.
        'bytes': args.bytes if args.bytes is not None else release.get('bytes'),
        'sha256': args.sha256 if args.sha256 is not None else release.get('sha256'),
    }

    if args.check:
        print(f"Would publish {version} as versionCode {code}.")
        print('changed=true')
        return 0

    RELEASE_JSON.write_text(json.dumps(release, indent=2) + '\n')
    print(f"release.json now describes {version} (versionCode {code}).")
    print(f"it says: {notes}")
    print('changed=true')
    return 0


if __name__ == '__main__':
    sys.exit(main())
