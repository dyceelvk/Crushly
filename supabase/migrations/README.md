# Migrations

`supabase/migrations/` now contains **41 files whose versions and names match
the 41 rows recorded in `supabase_migrations.schema_migrations` on production**
(project `yzcssyebozfkmojqqdhc`). That means `supabase db push` sees production
as fully up to date, and a fresh project can be brought to the same schema by
replaying the directory in order.

Until 2026-10-30 it could not: 12 applied migrations had no file in the repo,
and four files carried the wrong version number. Both are fixed.

## What changed on 2026-10-30

### Renames (same content, corrected version)

| Was | Now | Why |
|---|---|---|
| `20261028000026_vibes_insert_policy.sql` | `20261028000028_vibes_insert_policy.sql` | Production recorded `20261028000028`; the file said `000026`, so push tried to re-run it. |
| `20261028000027_load_post.sql` | `20261028000029_load_post.sql` | Same, `000029`. Body verified identical to production. |
| `20261030220000_post_reaction_kinds.sql` | `20261030203938_post_reaction_kinds.sql` | The migration tool stamped `20261030203938` in production. |
| `20261030221000_post_comment_likes.sql` | `20261030204007_post_comment_likes_write_path.sql` | Production recorded both a different version and a longer name. |

Nothing else about those four files changed.

### Reconstructed files (12)

```
20261013000026  media_security
20261013000027  feed_pagination
20261029084055  space_posts
20261029084324  profile_moment_ring
20261029122045  post_comment_threads        (+ post_comment_likes, see below)
20261029141213  fix_comment_on_post_overload
20261029162942  restore_media_upload_policy
20261029195516  video_container_support
20261029205829  post_saves
20261030000045  media_upload_reservations
20261030090936  restore_message_media_kind
20261030134900  vibe_reactions
```

These were applied to production but never committed. The original authoring
text is gone, so each file was rebuilt from the live catalog:

* function bodies from `pg_get_functiondef()`
* tables, columns and checks from `information_schema` / `pg_constraint`
* indexes from `pg_indexes`
* policies from `pg_policy`
* execution grants from `pg_proc.proacl`

Each file carries a header saying so, and each is written idempotently
(`create or replace`, `if not exists`, `drop ... if exists` before `create`) so
it is safe against a database that already has the objects — which is the case
for production itself.

**They are not the original migrations.** They reproduce the *current* state,
not the intermediate states the original files went through. If you need the
true history, it is not recoverable from here and the honest record is this
README plus the `distinct` column of the applied-versions list.

### A gap the reconstruction found

`post_comment_likes` had **no `create table` anywhere in the repo** — not in the
12 missing migrations and not in a committed one — even though
`20261030203938`-era code writes to it and `post_comments_feed()` counts it.
The table is created in `20261029122045_post_comment_threads.sql` alongside the
rest of the comment-thread work, with its three RLS policies and the original
`react_to_post_comment()` write path.

## Verification performed

* Every file parses with `libpg_query` (`pglast.parse_sql`).
* All 21 PL/pgSQL bodies pass `pglast.parse_plpgsql` — the real PostgreSQL
  procedural parser, not a regex.
* All 5 SQL-language bodies parse as standalone SQL.
* File versions/names diff clean against the production applied-versions list
  (41/41 identical).

What that does **not** prove: that a full replay from an empty database
succeeds. The repo also ships `supabase/setup.sql` and `supabase/setup/`, and
the early migrations assume the Supabase-managed `auth`, `storage` and
`extensions` schemas plus the `anon` / `authenticated` / `service_role` roles,
which only exist on a Supabase-provisioned database. The first end-to-end
`supabase db reset` against a real project is still owed.

## Conventions these files follow

* One migration per change, timestamped, never edited after being applied —
  fix forward with a new file.
* `security definer` plus an explicit `set search_path` on anything that reads
  another user's rows.
* `revoke all ... from public, anon, authenticated` then a targeted
  `grant execute` — the ACLs here were matched to production, and functions a
  client must never call directly are granted to `service_role` only
  (`cleanup_expired_media`), or left with no grant at all.
* End with `notify pgrst, 'reload schema'` when a function signature or table
  is added, so PostgREST picks it up without a restart.

## Known looseness, left alone deliberately

`can_view_vibe()`, `serialize_vibe()`, `media_kind_allows()` and
`post_comments_guard()` still carry the default `PUBLIC` execute grant in
production, so `anon` can execute them. None of them can be usefully reached
over RPC (they take a composite row type or are trigger helpers), so this is
not exploitable, but it is inconsistent with the rest of the directory and is
worth a deliberate follow-up rather than a silent change smuggled into a
reconstruction commit.
