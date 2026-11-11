#!/usr/bin/env python3
"""Delete the files the database has queued for deletion.

Why this exists
---------------
Deleting a post used to remove the row and leave the photo. Deleting a Moment
did the same. Closing an account removed the person and left every file they
ever uploaded, nameless, in the bucket. None of that reclaims space and none of
it keeps the promise the app makes.

Now every one of those paths writes the file's key into `public.media_deletions`
inside the same transaction that makes the change, and this script empties the
queue. It is deliberately a separate process from the thing that deletes rows:
the bytes are in R2 and B2, which the database cannot reach, and the app cannot
be trusted to finish a job it may be killed in the middle of.

It is idempotent and safe to run as often as you like. A path the Worker
confirms is marked done; a path that fails stays pending with its error, so the
next hour tries again and the failure is visible in the table rather than lost.

Environment
-----------
  SUPABASE_DB_URL   postgres connection string with service rights
  ADMIN_TOKEN       the media Worker's admin token
  WORKER_URL        the media Worker origin (optional)

Exit status is always 0 unless the queue could not be read at all — a scheduled
job should not go red because one file would not delete. Those are reported by
name, and counted, on every run.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

BATCH = 200
MAX_PASSES = 10
DEFAULT_WORKER = "https://crushly-media.dyceelvk.workers.dev"


def sql(query: str, variables: dict[str, str] | None = None, capture: bool = True) -> str:
    """Run one statement as the database owner and return its output."""
    db = os.environ["SUPABASE_DB_URL"]
    args = ["psql", db, "-v", "ON_ERROR_STOP=1", "-qtA"]
    for key, value in (variables or {}).items():
        args += ["-v", f"{key}={value}"]
    args += ["-c", query]
    result = subprocess.run(args, capture_output=capture, text=True)
    if capture:
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "psql failed")
        return result.stdout.strip()
    return ""


def pending() -> list[str]:
    """The next batch of queued keys, oldest first."""
    raw = sql(f"select coalesce(json_agg(path), '[]'::json) from public.media_deletion_batch({BATCH});")
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        raise RuntimeError(f"could not read the queue: {raw[:200]!r}")
    return [p for p in data if isinstance(p, str) and p]


def purge(paths: list[str]) -> dict:
    """Ask the Worker to delete these keys from R2 and B2."""
    worker = os.environ.get("WORKER_URL") or DEFAULT_WORKER
    body = json.dumps({"paths": paths}).encode()
    request = urllib.request.Request(
        f"{worker.rstrip('/')}/admin/purge",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['ADMIN_TOKEN']}",
            "Content-Type": "application/json",
            # Named on purpose: Cloudflare's bot protection rejects a request
            # with an empty or generic User-Agent before it ever reaches the
            # Worker, which reads as a 403 from the Worker when it is not.
            "User-Agent": "holupp-drain/1.0 (+https://holupapp.vercel.app)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:200]
        raise RuntimeError(f"worker answered {error.code}: {detail}")
    except urllib.error.URLError as error:
        raise RuntimeError(f"worker unreachable: {error.reason}")


def record(path: str, ok: bool, error: str | None = None) -> None:
    """Mark one key done, or note why it is not."""
    if ok:
        sql("select public.media_deletion_result(:'path', true);", {"path": path})
    else:
        sql(
            "select public.media_deletion_result(:'path', false, :'error');",
            {"path": path, "error": (error or "delete failed")[:300]},
        )


def main() -> int:
    if not os.environ.get("SUPABASE_DB_URL"):
        print("::warning::SUPABASE_DB_URL is not set — nothing to drain.")
        return 0
    if not os.environ.get("ADMIN_TOKEN"):
        print("::warning::ADMIN_TOKEN is not set — deleted files stay in the bucket until it is.")
        return 0

    total_deleted = 0
    total_failed = 0

    for attempt in range(1, MAX_PASSES + 1):
        paths = pending()
        if not paths:
            print("::notice::Deletion queue is empty.")
            break

        try:
            answer = purge(paths)
        except RuntimeError as error:
            # The queue keeps its rows: the next run will try the same keys.
            print(f"::error::Purge failed on pass {attempt}: {error}")
            return 0

        deleted = [p for p in answer.get("deleted", []) if isinstance(p, str)]
        failed = [f for f in answer.get("failed", []) if isinstance(f, dict)]

        for path in deleted:
            record(path, True)
        for item in failed:
            path = item.get("path")
            if not isinstance(path, str):
                continue
            reason = str(item.get("error", "delete failed"))
            record(path, False, reason)
            print(f"::warning::Could not delete {path}: {reason}")

        total_deleted += len(deleted)
        total_failed += len(failed)
        print(f"::notice::Pass {attempt}: {len(deleted)} deleted, {len(failed)} failed.")

        # Nothing went, so another pass would ask for the same keys again.
        if not deleted:
            break

    left = sql("select count(*) from public.media_deletions where deleted_at is null;")
    done = sql("select count(*) from public.media_deletions where deleted_at is not null;")
    print(
        f"::notice::Deletion queue: {done} deleted in total, {left} pending, "
        f"{total_deleted} gone this run, {total_failed} refused."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
