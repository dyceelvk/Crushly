#!/usr/bin/env python3
"""Put the release APK in R2, read it back, and leave only the current build.

Why this exists instead of `wrangler r2 object put`: wrangler authenticates with
CLOUDFLARE_API_TOKEN, and that token carries no R2 write scope, so every release
up to 1.0.98 had to be uploaded by hand. The R2 key pair in
R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY is scoped to the one bucket.

Subcommands
  upload <local-file> <key>   size-limited, streamed upload; refuses > 250 MB
  fetch  <key> <local-file>   read it back so the bytes can be hashed
  prune                       delete every android-releases/ object that is not
                              the file release.json names
  verify                      exit non-zero unless exactly one release remains,
                              and it is that file

The keep-set is read from release.json, never from a version typed into the
workflow, so a typo cannot delete the build being published.
"""
import json
import os
import pathlib
import sys

import boto3
from botocore.config import Config

BUCKET = os.environ.get('R2_BUCKET', 'holupp')
PREFIX = 'android-releases/'
MAX_BYTES = 250 * 1024 * 1024
RELEASE = pathlib.Path('cloudflare/media-worker/src/release.json')


def client():
    account = os.environ['CLOUDFLARE_ACCOUNT_ID']
    key = os.environ['R2_ACCESS_KEY_ID']
    secret = os.environ['R2_SECRET_ACCESS_KEY']
    return boto3.client(
        's3',
        endpoint_url='https://%s.r2.cloudflarestorage.com' % account,
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        region_name='auto',
        config=Config(retries={'max_attempts': 3}, signature_version='s3v4'),
    )


def keep_key() -> str:
    return PREFIX + json.loads(RELEASE.read_text())['file']


def release_keys(s3) -> list:
    keys = []
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=PREFIX):
        for item in page.get('Contents', []):
            keys.append(item['Key'])
    return keys


def upload(local: str, key: str) -> int:
    path = pathlib.Path(local)
    size = path.stat().st_size
    if size <= 0:
        sys.exit('%s is empty' % path)
    if size > MAX_BYTES:
        sys.exit('%s is %d bytes, over the %d-byte ceiling for a release' % (path, size, MAX_BYTES))
    s3 = client()
    s3.upload_file(
        str(path), BUCKET, key,
        ExtraArgs={'ContentType': 'application/vnd.android.package-archive'},
    )
    head = s3.head_object(Bucket=BUCKET, Key=key)
    if head['ContentLength'] != size:
        sys.exit('the bucket holds %d bytes, the file is %d' % (head['ContentLength'], size))
    print('uploaded %s (%d bytes)' % (key, size))
    return 0


def fetch(key: str, local: str) -> int:
    client().download_file(BUCKET, key, local)
    print('read back %s' % key)
    return 0


def prune() -> int:
    s3 = client()
    keep = keep_key()
    for key in release_keys(s3):
        if key == keep:
            continue
        s3.delete_object(Bucket=BUCKET, Key=key)
        print('removed older release: %s' % key)
    return 0


def verify() -> int:
    left = release_keys(client())
    keep = keep_key()
    if left == [keep]:
        print('one build on the server: %s' % keep)
        return 0
    print('expected only %s, found %s' % (keep, left or 'nothing'), file=sys.stderr)
    return 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    command = sys.argv[1]
    if command == 'upload' and len(sys.argv) == 4:
        raise SystemExit(upload(sys.argv[2], sys.argv[3]))
    if command == 'fetch' and len(sys.argv) == 4:
        raise SystemExit(fetch(sys.argv[2], sys.argv[3]))
    if command == 'prune':
        raise SystemExit(prune())
    if command == 'verify':
        raise SystemExit(verify())
    raise SystemExit(__doc__)
