#!/usr/bin/env python3
"""
Tell the media Worker which Android build is current.

Run after a build has passed its tests. It reads the version the app declares
about itself and rewrites `release.json`, which is the only place the Worker
looks when a phone asks what to install.

Without this the release is a two-step, easy-to-forget job: publish the APK,
then remember to edit the Worker by hand. Forget the second step and the app
keeps offering the old build, or offers a file that is not there.

The version code is derived from the version itself, so it only ever rises:
1.0.2 becomes 100002, and 1.0.3 becomes 100003. A code that went backwards
would make an update invisible to a phone that already had the newer one.

`minVersionCode` is deliberately left alone. Raising it tells every phone below
that number it *must* update rather than merely may, which is a decision a
person makes, not a build.
"""

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_JSON = ROOT / 'CrushlyApp' / 'app.json'
RELEASE_JSON = ROOT / 'cloudflare' / 'media-worker' / 'src' / 'release.json'

REPO = 'dyceelvk/Crushly'


def version_code(version: str) -> int:
    """A monotonic integer derived from a semver-ish version."""
    parts = (version.split('-')[0] + '.0.0').split('.')[:3]
    out = []
    for part in parts:
        m = re.match(r'\d+', part.strip())
        out.append(int(m.group()) if m else 0)
    major, minor, patch = out
    return major * 100_000 + minor * 1_000 + patch


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', default=None, help='What the update says about itself.')
    ap.add_argument('--bytes', type=int, default=None, help='Exact size of the APK, so a member can check the download.')
    ap.add_argument('--sha256', default=None, help='SHA-256 of the APK, published on the download page.')
    ap.add_argument('--check', action='store_true', help='Report whether it is up to date without writing.')
    args = ap.parse_args()

    app = json.loads(APP_JSON.read_text())
    version = app['expo']['version']
    release = json.loads(RELEASE_JSON.read_text())

    if (
        version == release['version']
        and args.notes in (None, release['notes'])
        and args.bytes in (None, release.get('bytes'))
        and args.sha256 in (None, release.get('sha256'))
    ):
        print(f"release.json already describes {version} — nothing to do.")
        print('changed=false')
        return 0

    code = version_code(version)
    # Never go backwards, and never reuse a code.
    if code <= int(release['versionCode']):
        code = int(release['versionCode']) + 1

    file_name = f'Crushly-{version}-Android9plus.apk'

    release = {
        'version': version,
        'versionCode': code,
        'minVersionCode': release['minVersionCode'],
        'file': file_name,
        'notes': args.notes if args.notes is not None else release['notes'],
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
    print('changed=true')
    return 0


if __name__ == '__main__':
    sys.exit(main())
