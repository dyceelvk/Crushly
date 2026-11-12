#!/usr/bin/env python3
"""Record the exact Android asset the public download endpoint may serve.

This runs only after GitHub has published the APK release. The Worker stores
GitHub's release-download endpoint and asks it for a fresh, short-lived CDN
redirect for each cache window. That avoids relaying a ~95 MB APK through the
Worker and ensures a proxy error cannot be saved as a bogus `.apk` file for
Android's package parser.

The release note belongs to its Android version in ``release-notes.json``. A
release without one refuses to be announced rather than reusing an old note.
"""

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from update_notes import note_for  # noqa: E402 (sibling script, same directory)

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_JSON = ROOT / 'CrushlyApp' / 'app.json'
RELEASE_JSON = ROOT / 'cloudflare' / 'media-worker' / 'src' / 'release.json'
REPO = 'dyceelvk/Crushly'


def version_code(app: dict) -> int:
    code = (app.get('expo', {}).get('android') or {}).get('versionCode')
    if not isinstance(code, int):
        raise SystemExit('app.json has no integer android.versionCode.')
    return code


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', default=None, help='Overrides release-notes.json; rarely right.')
    ap.add_argument('--bytes', type=int, required=True, help='Exact APK byte count.')
    ap.add_argument('--sha256', required=True, help='Exact SHA-256 fingerprint.')
    ap.add_argument('--check', action='store_true', help='Report whether the manifest would change without writing.')
    args = ap.parse_args()

    app = json.loads(APP_JSON.read_text())
    current = json.loads(RELEASE_JSON.read_text())
    version = app['expo']['version']
    code = version_code(app)
    notes = args.notes if args.notes is not None else note_for(version)
    release = {
        'version': version,
        'versionCode': code,
        'minVersionCode': current.get('minVersionCode', 1),
        'file': f'holUpp-{version}-RielOS.apk',
        'releaseUrl': f'https://github.com/{REPO}/releases/download/android-test-{version}/holUpp-{version}-RielOS.apk',
        'notes': notes,
        'bytes': args.bytes,
        'sha256': args.sha256.lower(),
    }

    # This keeps a re-run idempotent. A different asset or any new version must
    # still advance Android's manifest versionCode.
    if release == current:
        print(f'release.json already describes {version} — nothing to do.')
        print('changed=false')
        return 0
    previous = int(current['versionCode'])
    if code <= previous:
        raise SystemExit(
            f'android.versionCode is {code}; it must be higher than the published {previous}. '
            'Bump app.json before creating an update.'
        )
    if args.check:
        print(f'Would publish {version} as versionCode {code}.')
        print('changed=true')
        return 0

    RELEASE_JSON.write_text(json.dumps(release, indent=2) + '\n')
    print(f'release.json now describes {version} (versionCode {code}).')
    print(f'it says: {notes}')
    print('changed=true')
    return 0


if __name__ == '__main__':
    sys.exit(main())
