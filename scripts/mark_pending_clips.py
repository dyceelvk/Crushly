#!/usr/bin/env python3
"""Give every video post a marked copy, ready to be saved to a device.

Runs outside the request path, on purpose. Marking a clip means a full ffmpeg
re-encode, and doing that while somebody is uploading would make them wait for it;
doing it in a batch keeps uploads instant and clears a backlog in one run.

For each post the database says needs attention:

  1. ask what is missing (`posts_needing_download` — no copy at all, or a copy
     the app registered but nobody confirmed);
  2. if a copy was registered but unconfirmed, check it is really in the bucket;
     if it is, record its size and move on. Nothing is re-encoded;
  3. otherwise pull the original out of the private bucket;
  4. burn in the mark and the creator's handle, append the end splash
     (`CrushlyApp/scripts/mark-clip.py`);
  5. put the marked file next to the original, under a `-marked` key;
  6. record the key and its size (`register_post_download`).

Both stores are read, R2 first and Backblaze second, in the same order the Worker
serves media in — a clip posted since the move to R2 lives only there, and a job
that can only read B2 cannot mark it, which is how a Save button stayed broken
with a healthy queue behind it.

Nothing here touches `posts.media_url`. The clip that plays inside holUpp is never
re-encoded, and the marked copy is only ever served through the Worker's
`/d/<post id>` route, which asks the database whether this member may see the
post.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MARKER = Path(__file__).resolve().parent.parent / "CrushlyApp/scripts/mark-clip.py"

#: The stores a clip may live in, in the order they are tried — the same order
#: the media Worker serves in (`READ_ORDER` in
#: `cloudflare/media-worker/src/mediaStore.ts`). A job that reads one store and a
#: Worker that serves the other is how a healthy clip looked missing: every post
#: made since the move to R2 failed here with `HTTP Error 404`, so no marked copy
#: was ever produced for it.
STORE_ORDER = ("r2", "b2")
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
    """Backblaze B2's native API, mirroring the Worker's working path exactly."""

    def __init__(self) -> None:
        # Trimmed, like the Worker does: a stray space or newline picked up while
        # pasting a secret is invisible in the GitHub UI and enough for Backblaze
        # to answer 401. Cost an hour once; not twice.
        key_id = os.environ["B2_KEY_ID"].strip()
        key = os.environ["B2_APPLICATION_KEY"].strip()
        credentials = base64.b64encode(f"{key_id}:{key}".encode()).decode()
        request = urllib.request.Request(
            "https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
            headers={"Authorization": f"Basic {credentials}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise SystemExit(
                    "B2 refused the application key (401). Check B2_KEY_ID and "
                    "B2_APPLICATION_KEY: the key id, not the account id, and no "
                    "surrounding whitespace."
                ) from error
            raise
        self.auth = data["authorizationToken"]
        self.api = data["apiUrl"]
        self.download_url = data["downloadUrl"]
        self.account_id = data["accountId"]
        self.bucket_name = os.environ["B2_BUCKET"].strip()
        self.bucket_id = self._bucket_id()

    def _bucket_id(self) -> str:
        listing = self._call("b2_list_buckets", {"accountId": self.account_id})
        for bucket in listing.get("buckets", []):
            if bucket["bucketName"] == self.bucket_name:
                return bucket["bucketId"]
        raise SystemExit(f"bucket {self.bucket_name!r} is not visible to this key")

    def _call(self, endpoint: str, body: dict) -> dict:
        request = urllib.request.Request(
            f"{self.api}/b2api/v2/{endpoint}",
            data=json.dumps(body).encode(),
            headers={"Authorization": self.auth, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read())

    def size(self, key: str) -> int | None:
        """Bytes of `key`, or None when B2 does not have it.

        `b2_list_file_names` with a prefix and an exact-name match: B2 has no
        HEAD that answers 404 the way S3 does, and treating an auth error as
        "missing" would silently re-mark clips that are fine.
        """
        try:
            answer = self._call("b2_list_file_names", {
                "bucketId": self.bucket_id,
                "startFileName": key,
                "maxFileCount": 1,
                "prefix": key,
            })
        except urllib.error.HTTPError:
            return None
        for item in answer.get("files", []):
            if item.get("fileName") == key:
                return int(item.get("contentLength") or 0)
        return None

    def download(self, key: str, target: Path) -> None:
        url = f"{self.download_url}/file/{self.bucket_name}/{urllib.parse.quote(key)}"
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
                # Same rule as the Worker: hash what is small enough to hash, and
                # be explicit rather than silent when it is not.
                "X-Bz-Content-Sha1": hashlib.sha1(data).hexdigest()
                if len(data) <= 4 * 1024 * 1024
                else "do_not_verify",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=600) as response:
            response.read()



class R2:
    """Cloudflare R2, through the S3 API and the release bucket's own key pair.

    Same credentials the APK channel uses (`r2-releases.py`), scoped to the one
    bucket, so a job needs no wider access than an upload does. `boto3` is not
    installed everywhere this script runs, so a missing library or missing
    credentials leave `available` false and the job continues on Backblaze —
    which is what it did before R2 existed.
    """

    def __init__(self) -> None:
        self.available = False
        self.bucket = os.environ.get("R2_BUCKET", "holupp").strip() or "holupp"
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
        key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        secret = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        if not (account and key and secret):
            return
        try:
            import boto3
            from botocore.config import Config
        except ImportError:
            print("boto3 not installed: R2 reads are skipped this run", file=sys.stderr)
            return
        self.s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=key,
            aws_secret_access_key=secret,
            region_name="auto",
            config=Config(retries={"max_attempts": 3}, signature_version="s3v4"),
        )
        self.available = True

    def size(self, key: str) -> int | None:
        try:
            head = self.s3.head_object(Bucket=self.bucket, Key=key)
        except Exception:  # noqa: BLE001 - absence is the answer, not an error
            return None
        return int(head.get("ContentLength") or 0)

    def download(self, key: str, target: Path) -> None:
        self.s3.download_file(self.bucket, key, str(target))

    def upload(self, key: str, source: Path) -> None:
        self.s3.upload_file(str(source), self.bucket, key, ExtraArgs={"ContentType": "video/mp4"})


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
    # `username` is the column; `handle` does not exist on profiles.
    row = psql(
        "select coalesce(nullif(username, ''), nullif(name, ''), 'holUpp') "
        f"from profiles where id = {int(author_id)};"
    )
    return row or "holUpp"


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
    r2 = R2()
    print(f"stores: r2={'yes' if r2.available else 'no'}, b2=yes")
    done = failed = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for post in posts:
            post_id = int(post["id"])
            try:
                key = object_key(post["mediaUrl"])
                out_key = marked_key(key)
                print(f"post {post_id}: {key}")

                # A copy the app registered but nobody confirmed. Look before
                # re-encoding: the object is very often already there, and an
                # ffmpeg pass over footage that needs nothing is the most
                # expensive way to write one number into a row.
                if post.get("unverified"):
                    size_here = r2.size(out_key) if r2.available else None
                    if not size_here:
                        size_here = b2.size(out_key)
                    if size_here:
                        ok = rpc("register_post_download", {
                            "p_post_id": post_id,
                            "p_object_key": out_key,
                            "p_bytes": size_here,
                        })
                        print(f"  copy confirmed at {out_key} ({size_here / 1e6:.2f} MB), registered: {ok}")
                        done += 1
                        continue
                    print("  registered copy is not in either store: making it")

                handle = handle_for(int(post["authorId"]))
                print(f"  handle @{handle}")

                source = tmpdir / f"{post_id}-original"
                target = tmpdir / f"{post_id}-marked.mp4"
                # R2 first, exactly as the Worker reads. A clip posted since the
                # move is only in R2, and a job that looks in B2 alone reports
                # "not found" for a file that is right there.
                fetched = False
                if r2.available and r2.size(key):
                    r2.download(key, source)
                    fetched = True
                elif b2.size(key):
                    b2.download(key, source)
                    fetched = True
                if not fetched:
                    raise FileNotFoundError(f"original {key} is in neither store")

                result = subprocess.run(
                    [PYTHON, str(MARKER), str(source), str(target), "--handle", f"@{handle.lstrip('@')}"],
                    capture_output=True, text=True,
                )
                print("  " + (result.stdout.strip() or result.stderr.strip()[-400:]))
                if result.returncode != 0 or not target.exists():
                    failed += 1
                    continue

                # Written to R2 when it is reachable, beside the original; the
                # Worker reads R2 first, so this is the copy it will serve.
                if r2.available:
                    r2.upload(out_key, target)
                else:
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
