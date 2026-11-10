#!/usr/bin/env python3
"""Give every video post a marked copy, ready to be saved to a device.

Runs outside the request path, on purpose. Marking a clip means a full ffmpeg
re-encode, and doing that while somebody is uploading would make them wait for it;
doing it in a batch keeps uploads instant and clears a backlog in one run.

For each post with no copy yet:

  1. ask the database what is missing (`posts_needing_download`);
  2. pull the original out of the private bucket;
  3. burn in the mark and the creator's handle, append the end splash
     (`CrushlyApp/scripts/mark-clip.py`);
  4. put the marked file next to the original, under a `-marked` key;
  5. record the key (`register_post_download`).

Nothing here touches `posts.media_url`. The clip that plays inside Holup is never
re-encoded, and the marked copy is only ever served through the Worker's
`/d/<post id>` route, which asks the database whether this member may see the
post.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

MARKER = Path(__file__).resolve().parent.parent / "CrushlyApp/scripts/mark-clip.py"
PYTHON = sys.executable


def psql(sql: str) -> str:
    """Run one statement and return its single value."""
    out = subprocess.run(
        ["psql", os.environ["SUPABASE_DB_URL"], "-tAc", sql],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def rpc(name: str, args: dict) -> object:
    """Call a function through psql, so the job needs no REST key."""
    payload = json.dumps(args)
    sql = f"select public.{name}({','.join(f'{k} => %s' for k in args)})"
    # psql has no parameter binding; the values here are an int, a text key and a
    # byte count, all produced by this script or by the database.
    values = ", ".join(literal(v) for v in args.values())
    out = psql(f"select public.{name}({values});")
    return out


def literal(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def pending(limit: int, wanted: list[int]) -> list[dict]:
    if wanted:
        ids = ",".join(str(int(i)) for i in wanted)
        rows = psql(
            "select coalesce(json_agg(json_build_object('id', id, 'mediaUrl', media_url, 'authorId', author_id)), '[]') "
            f"from posts where id in ({ids}) and media_url is not null;"
        )
        return json.loads(rows)
    rows = psql(f"select public.posts_needing_download({int(limit)});")
    return json.loads(rows or "[]")


class B2:
    """Backblaze B2's native API — the same one the Worker uses."""

    def __init__(self) -> None:
        key_id = os.environ["B2_KEY_ID"]
        key = os.environ["B2_APPLICATION_KEY"]
        credentials = base64.b64encode(f"{key_id}:{key}".encode()).decode()
        request = urllib.request.Request(
            "https://api.backblazeb2.com/b2api/v3/b2_authorize_account",
            headers={"Authorization": f"Basic {credentials}"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read())
        self.auth = data["authorizationToken"]
        self.api = data["apiInfo"]["storageApi"]["apiUrl"]
        self.bucket_name = os.environ["B2_BUCKET"]
        self.bucket_id = self._bucket_id()

    def _bucket_id(self) -> str:
        listing = self._call("b2_list_buckets", {"accountId": None, "bucketName": self.bucket_name})
        return listing["buckets"][0]["bucketId"]

    def _call(self, endpoint: str, body: dict) -> dict:
        if body.get("accountId") is None:
            body.pop("accountId", None)
        request = urllib.request.Request(
            f"{self.api}/b2api/v3/{endpoint}",
            data=json.dumps(body).encode(),
            headers={"Authorization": self.auth, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read())

    def download(self, key: str, target: Path) -> None:
        url = f"{self.api}/file/{self.bucket_name}/{urllib.parse.quote(key)}"
        request = urllib.request.Request(url, headers={"Authorization": self.auth})
        with urllib.request.urlopen(request, timeout=300) as response, target.open("wb") as handle:
            handle.write(response.read())

    def upload(self, key: str, source: Path) -> None:
        ticket = self._call("b2_get_upload_url", {"bucketId": self.bucket_id})
        data = source.read_bytes()
        request = urllib.request.Request(
            ticket["uploadUrl"],
            data=data,
            headers={
                "Authorization": ticket["authorizationToken"],
                "X-Bz-File-Name": urllib.parse.quote(key),
                "Content-Type": "video/mp4",
                "Content-Length": str(len(data)),
                # B2 rejects an upload without a digest unless the bucket is set
                # to allow it; sha1 is what its native API still asks for.
                "X-Bz-Content-Sha1": __import__("hashlib").sha1(data).hexdigest(),
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=600) as response:
            response.read()


def object_key(media_url: str) -> str:
    """`https://…/m/posts/41/x.mp4` -> `posts/41/x.mp4`."""
    path = urllib.parse.urlparse(media_url).path
    if "/m/" not in path:
        raise ValueError(f"not a media url: {media_url}")
    return urllib.parse.unquote(path.split("/m/", 1)[1]).lstrip("/")


def marked_key(key: str) -> str:
    stem, dot, _ext = key.rpartition(".")
    if not dot:
        return key + "-marked.mp4"
    return f"{stem}-marked.mp4"


def handle_for(author_id: int) -> str:
    row = psql(f"select coalesce(nullif(handle, ''), name, 'Holup') from profiles where id = {int(author_id)};")
    return row or "Holup"


def main() -> int:
    limit = int(os.environ.get("LIMIT", "20") or 20)
    wanted = [int(x) for x in os.environ.get("POST_IDS", "").replace(" ", "").split(",") if x]
    if not MARKER.exists():
        print(f"missing marker script: {MARKER}", file=sys.stderr)
        return 2

    posts = pending(limit, wanted)
    print(f"posts to consider: {len(posts)}")
    if not posts:
        return 0

    b2 = B2()
    done = failed = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for post in posts:
            post_id = int(post["id"])
            try:
                key = object_key(post["mediaUrl"])
                handle = handle_for(int(post["authorId"]))
                print(f"post {post_id}: {key} (handle @{handle})")

                source = tmpdir / f"{post_id}-original"
                target = tmpdir / f"{post_id}-marked.mp4"
                b2.download(key, source)

                result = subprocess.run(
                    [PYTHON, str(MARKER), str(source), str(target), "--handle", f"@{handle.lstrip('@')}"],
                    capture_output=True, text=True,
                )
                print("  " + (result.stdout.strip() or result.stderr.strip()[-400:]))
                if result.returncode != 0 or not target.exists():
                    failed += 1
                    continue

                out_key = marked_key(key)
                b2.upload(out_key, target)
                bytes_written = target.stat().st_size
                ok = rpc("register_post_download", {
                    "p_post_id": post_id,
                    "p_object_key": out_key,
                    "p_bytes": bytes_written,
                })
                print(f"  uploaded {out_key} ({bytes_written / 1e6:.2f} MB), registered: {ok}")
                done += 1
            except Exception as error:  # one bad clip must not stop the batch
                failed += 1
                print(f"  failed: {type(error).__name__}: {error}", file=sys.stderr)
            finally:
                for leftover in tmpdir.glob(f"{post_id}-*"):
                    leftover.unlink(missing_ok=True)

    print(f"marked {done}, failed {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
