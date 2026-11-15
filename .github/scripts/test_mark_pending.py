#!/usr/bin/env python3
"""The marking job's rules, tested without a bucket, ffmpeg or a phone.

The bug these pin: every clip posted since media moved to R2 failed to be marked,
with `HTTP Error 404`, because the job only knew how to read Backblaze. The queue
stayed healthy, nothing was ever produced, and the Save button on those clips said
"isn't ready yet" for good.

So: the same store order as the Worker, and one derived key that three places have
to agree on (this script, the SQL, the app).
"""
import importlib.util
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location('mark_pending', ROOT / 'scripts/mark_pending_clips.py')
mark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mark)

failures = []


def check(what, condition, detail=''):
    if condition:
        print(f'ok  {what}')
    else:
        print(f'FAIL {what} {detail}')
        failures.append(what)


def raises(fn) -> bool:
    try:
        fn()
    except Exception:  # noqa: BLE001 - any refusal is the point
        return True
    return False


def worker_read_order() -> list[str]:
    source = (ROOT / 'cloudflare/media-worker/src/mediaStore.ts').read_text()
    match = re.search(r'READ_ORDER[^=]*=\s*\[([^\]]*)\]', source)
    return re.findall(r"'(\w+)'", match.group(1)) if match else []


check(
    'the job reads the stores in the Worker’s order',
    list(mark.STORE_ORDER) == worker_read_order(),
    f'job={mark.STORE_ORDER} worker={worker_read_order()}',
)
check('R2 is read before the metered store', mark.STORE_ORDER[0] == 'r2')

check('a stored address gives its bucket key',
      mark.object_key('https://h.dev/m/posts/41/1-x.mp4') == 'posts/41/1-x.mp4')
check('an address with no media prefix is refused, not guessed',
      raises(lambda: mark.object_key('https://h.dev/posts/41/1.mp4')))

check('an mp4 becomes -marked.mp4', mark.marked_key('posts/41/1-x.mp4') == 'posts/41/1-x-marked.mp4')
check('a webm becomes -marked.mp4', mark.marked_key('posts/41/1-x.webm') == 'posts/41/1-x-marked.mp4')
check('an extension-less key still becomes a file',
      mark.marked_key('posts/41/noext') == 'posts/41/noext-marked.mp4')

# The SQL derives the same key. A mismatch between these two is the original bug,
# so the agreement is asserted rather than assumed.
sql = (ROOT / 'supabase/migrations/20261113120000_own_post_download.sql').read_text()
check('the database also replaces the extension with -marked.mp4',
      'regexp_replace' in sql and "-marked.mp4'" in sql)

# And the job must be given the unconfirmed rows back, or the copy nobody checked
# is never looked at again.
migration = (ROOT / 'supabase/migrations/20261115120000_marked_copy_is_the_uploaded_file.sql').read_text()
check('an unconfirmed copy is put back in the queue', 'pd.bytes is null' in migration)
check('a member cannot register a guessed key', 'if p_marked_url is null' in migration)

if failures:
    print(f'{len(failures)} failed')
    sys.exit(1)
print('mark job contract holds')
