# Crushly — deploy record for `0aef894`

Date: 2026-10-30
Branch: `feat/flow-engine-and-viewer`
Commit: `0aef894445834d24e41379e0de00f6617ee15f96`

## Production

| Field | Value |
|---|---|
| Deployment | `dpl_AXvXyw21S5YUNdehBbDi9ptXntu7` |
| State | `READY` / `PROMOTED` |
| Ready in | 71,713 ms |
| Primary alias | https://mecrushly.vercel.app (HTTP 200) |
| Bundle | 992 modules, 55 assets |
| Build command | `npm run typecheck && npm run build:web` |

Type gate: `tsc` exited 0 in the Vercel build log before `build:web` ran — the 9 pre-existing
type errors are fixed, so the chain no longer fails the build.

## Artifact and backups

| Store | Location |
|---|---|
| Dropbox | `/Crushly/backups/crushly-0aef894-20261030.zip` (17,973,084 bytes, rev `0165f1588b1872800000002c3178703`) |
| Google Drive | `Crushly-Backups/crushly-0aef894-20261030.zip` (id `1yoizapzIfdYQDXoSM0SLPQAZywTqHely`) |
| Local | `/home/user/out/crushly-0aef894-20261030.zip` (18 MB, 339 files, `git archive` of `0aef894`) |

Both remote copies were written this session; the earlier `crushly-source-20261030.zip` copies
are superseded (they predate the typecheck fixes).

## Security housekeeping

- `git remote origin` reset to `https://github.com/dyceelvk/Crushly.git`. The PAT is no longer
  embedded in the remote, and no file in the workspace contains it. (The only `ghp_`/`github_pat_`
  matches are the literal pattern strings inside `audit-apk-secrets.py`, a scanner.)

## Governance item: RESOLVED in `2aa73df`

Fixed the same day — see `supabase/migrations/README.md` in the repo for the
full account. Summary:

* the 12 missing migrations were rebuilt from the live catalog and committed;
* `post_comment_likes` had no `create table` anywhere in the repo at all and is
  now created with its policies;
* four files carried version numbers that did not match production and were
  renamed (`…000026`→`…000028`, `…000027`→`…000029`, `20261030220000`→
  `20261030203938`, `20261030221000`→`20261030204007_post_comment_likes_write_path`);
* repo versions now diff clean against the production applied-versions list,
  **41/41 identical**;
* verification: `pglast.parse_sql` on all 41 files, `pglast.parse_plpgsql` on
  all 21 PL/pgSQL bodies, standalone parse on all 5 SQL bodies.

Not yet proven: a full `supabase db reset` from empty. The early migrations
assume Supabase-managed `auth`/`storage`/`extensions` schemas and the
`anon`/`authenticated`/`service_role` roles, which only exist on a
Supabase-provisioned database.

### Historical note (the gap as it stood before the fix)

`supabase/migrations/` has 29 files; production has 41 applied versions. 12 applied migrations
have no file in the repo:

```
20261013000026  media_security
20261013000027  feed_pagination
20261029084055  space_posts          -> functions space_posts(), space_vibes()
20261029084324  profile_moment_ring
20261029122045  post_comment_threads -> post_comments.parent_id, thread feed
20261029141213  fix_comment_on_post_overload
20261029162942  restore_media_upload_policy
20261029195516  video_container_support
20261029205829  post_saves           -> post_saves table, save_post(), saved_posts(), post_saved()
20261030000045  media_upload_reservations -> media_upload_reservations table, media_upload_ticket()
20261030090936  restore_message_media_kind
20261030134900  vibe_reactions       -> vibe_reactions table, react_to_vibe()
```

Also two version-number drifts — same names, different timestamps:

```
repo 20261028000026_vibes_insert_policy.sql   prod 20261028000028 vibes_insert_policy
repo 20261028000027_load_post.sql             prod 20261028000029 load_post
```

Consequence: `supabase db reset` on a fresh project would produce a database that is missing
`post_saves`, `vibe_reactions`, `media_upload_reservations`, `post_comments.parent_id`,
the space feed functions, and the media security policies. **Production is the only source of
truth for schema right now.**

Two ways to close it, both needing a decision:
1. Reconstruct the 12 files from the live catalog (`pg_proc`, `pg_policy`, `pg_constraint`) —
   restores rebuildability, but the file bodies are approximations of the original history.
2. Treat production as authoritative and capture an authoritative dump (`pg_dump --schema-only`)
   into `supabase/schema-snapshot/` as reference, with the migrations directory clearly marked
   incomplete until someone regenerates it locally.

### State of `main`

Local `main` was fast-forwarded to `2aa73df` (the full deploy branch history plus
both fix commits), per the decision to make this branch the new main. Origin
`main` is still `567fd9d` and holds a revert of an earlier merge, so publishing
this needs `git push --force-with-lease origin main` — a rewrite of shared
history, not a merge. PR #10 stays open until that happens; closing it and
pushing `main` are one operation, not two.
