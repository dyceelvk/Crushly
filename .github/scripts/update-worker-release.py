#!/usr/bin/env python3
"""
Tell the media Worker which Android build is current.

Run after a build has passed its tests. It reads the version the app declares
about itself and rewrites `release.json`, which is the only place the Worker
looks when a phone asks what to install.

Without this the release is a two-step, easy-to-forget job: publish the APK,
then remember to edit the Worker by hand. Forget the second step and the app
keeps offering the old build, or offers a file that is not there.

The version code is the one Gradle actually stamped into the APK, read from
the file with aapt, never derived here. An earlier version of this script made
the number up from the version string (1.0.2 -> 100002), which disagreed with
what the phone was running (1.0.7 shipped as code 7, while this script
advertised 100018). The app offers an update when the published code is greater
than the installed one, so a made-up code meant every installed copy was told an
update was waiting forever, and reinstalling never cleared it.

`minVersionCode` is deliberately left alone. Raising it tells every phone below
that number it *must* update rather than merely may, which is a decision a
person makes, not a build.
"""

import argparse
import glob
import json
import os
import pathlib
import re
import struct
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_JSON = ROOT / 'CrushlyApp' / 'app.json'
RELEASE_JSON = ROOT / 'cloudflare' / 'media-worker' / 'src' / 'release.json'

REPO = 'dyceelvk/Crushly'


def _string_pool(d, pos):
    """The string table of a binary Android XML document."""
    _typ, _hsize, _size = struct.unpack('<HHI', d[pos:pos + 8])
    count, _styles, flags, strings_start, _ss = struct.unpack('<IIIII', d[pos + 8:pos + 28])
    utf8 = bool(flags & 0x100)
    base = pos + strings_start
    out = []
    for _ in range(count):
        if utf8:
            n = d[base]; base += 1
            if n & 0x80:
                n = ((n & 0x7F) << 8) | d[base]; base += 1
            m = d[base]; base += 1
            if m & 0x80:
                m = ((m & 0x7F) << 8) | d[base]; base += 1
            out.append(d[base:base + n].decode('utf-8', 'replace'))
            base += m + 1
        else:
            n = struct.unpack('<H', d[base:base + 2])[0]; base += 2
            out.append(d[base:base + n * 2].decode('utf-16le', 'replace'))
            base += n * 2 + 2
    return out, _size


def manifest_attributes(apk: pathlib.Path) -> dict:
    """The `<manifest>` attributes, read straight out of the APK.

    Deliberately does not shell out: a release step must not depend on the
    Android SDK happening to be on PATH, and this is forty lines of struct
    unpacking against a format that has not changed in a decade.
    """
    with zipfile.ZipFile(apk) as z:
        d = z.read('AndroidManifest.xml')
    if len(d) < 8 or struct.unpack('<H', d[0:2])[0] != 0x0003:
        raise ValueError('AndroidManifest.xml is not binary XML')
    strings, pool_size = _string_pool(d, 8)
    pos = 8 + pool_size
    while pos + 8 <= len(d):
        typ, hsize, size = struct.unpack('<HHI', d[pos:pos + 8])
        if size < 8:
            break
        if typ == 0x0102:  # START_ELEMENT
            ext = pos + hsize
            _ns, name_i, attr_start, attr_size, attr_count = struct.unpack('<IIHHH', d[ext:ext + 14])
            if strings[name_i] == 'manifest':
                attrs = {}
                a = ext + attr_start
                for _ in range(attr_count):
                    _a_ns, a_name, a_raw = struct.unpack('<III', d[a:a + 12])
                    _vsize, _res0, v_type, v_data = struct.unpack('<HBBI', d[a + 12:a + 20])
                    name = strings[a_name]
                    if a_raw != 0xFFFFFFFF:
                        attrs[name] = strings[a_raw]
                    elif v_type == 0x10:
                        attrs[name] = v_data
                    elif v_type == 0x12:
                        attrs[name] = bool(v_data)
                    elif v_type == 0x03:
                        attrs[name] = strings[v_data]
                    else:
                        attrs[name] = v_data
                    a += attr_size
                return attrs
        pos += size
    raise ValueError('no <manifest> element in AndroidManifest.xml')


def version_code(apk: pathlib.Path) -> int:
    """The version code Gradle stamped into this APK — the number a phone runs."""
    code = manifest_attributes(apk).get('versionCode')
    if not isinstance(code, int):
        raise SystemExit(f'AndroidManifest.xml in {apk.name} carries no versionCode.')
    return code
    raise SystemExit(
        f'Could not read the version code out of {apk.name}. aapt is needed to '
        'publish a release: the number a phone compares against has to be the '
        'one inside the file, not one we guessed.'
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', default=None, help='What the update says about itself.')
    ap.add_argument('--bytes', type=int, default=None, help='Exact size of the APK, so a member can check the download.')
    ap.add_argument('--sha256', default=None, help='SHA-256 of the APK, published on the download page.')
    ap.add_argument('--apk', default=None, help='The APK just built; its version code is what is published.')
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

    # The code has to come out of the file that was actually built. If app.json
    # was bumped but the build used the old one, this is what notices.
    if args.apk is None:
        raise SystemExit('--apk is required: the published versionCode is read from the build.')
    apk = pathlib.Path(args.apk)
    if not apk.is_file():
        raise SystemExit(f'{apk} does not exist, so there is nothing to measure.')
    code = version_code(apk)
    stamped = app['expo'].get('android', {}).get('versionCode')
    if stamped is not None and int(stamped) != code:
        raise SystemExit(
            f'app.json says versionCode {stamped} but the APK reports {code}. '
            'The next build would hand phones a number that does not match the '
            'file they install, which is how updates go missing.'
        )

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
