#!/usr/bin/env python3
"""Keep exactly one release in the bucket, and prove it.

One build lives on the server: the one release.json describes. Anything else
there is a file no member can be served — /download only ever answers with the
current version — while still occupying the storage allowance, and an old copy
found through a shared link installs a version we have already replaced.

Reads `wrangler r2 object list` JSON on stdin.

  (no flag)            print the keys to remove, one per line
  --verify             print the keys still in android-releases/ and exit 1
                       unless the only one is the build release.json names

The keep-set comes from release.json, never from the version typed into the
workflow, so a mistyped version cannot delete the build being published.
"""
import json
import pathlib
import sys


def keys(stdin: str) -> list:
    start = stdin.find('[')
    if start < 0:
        raise SystemExit('could not read the bucket listing')
    try:
        objects = json.loads(stdin[start:])
    except json.JSONDecodeError as exc:
        raise SystemExit('could not parse the bucket listing: %s' % exc)
    return [i.get('key', '') for i in objects if (i.get('key') or '').startswith('android-releases/')]


def main() -> int:
    release_file = pathlib.Path('cloudflare/media-worker/src/release.json')
    keep = 'android-releases/' + json.loads(release_file.read_text())['file']
    present = keys(sys.stdin.read())

    if '--verify' in sys.argv:
        for key in present:
            print(key)
        if present == [keep]:
            return 0
        print('the bucket should hold only %s; it holds %s' % (keep, present or 'nothing'), file=sys.stderr)
        return 1

    for key in present:
        if key != keep:
            print(key)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
