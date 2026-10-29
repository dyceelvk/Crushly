# Crushly — database and RLS

**Owner and official credit: Odoh chiagoziem isreal.**
Schema state at 1.0.10. 37 migrations under `supabase/migrations/`.

---

## 1. Shape of the backend

Supabase: Postgres + row-level security + RPC functions + Auth + Storage. There
is **no application server**. The app talks to Supabase directly, and the only
other moving part is the Cloudflare media Worker, which handles bytes.

Because there is no server to hide behind, **RLS and the RPC guards are the
whole authorization model.** A modified client can call anything.

## 2. Tables

35 tables, every one of them with RLS enabled:

```
profiles  preferences  privacy  reserved_usernames  verification_requests
didit_events  notification_settings  notifications

crushes  passes  connections  keeps  blocks  reports

photos  moments  moment_views  moment_reactions
vibes  vibe_views
posts  post_comments  post_comment_likes  post_reactions

circles  circle_members  circle_messages
conversations  messages  message_reactions  call_rooms

media_upload_reservations  media_cleanup_log
```

Destructive operations are never done by the client directly: account deletion
is `delete_account()`, and expired media is reclaimed by the scheduled
`cleanup_expired_media()`, `cleanup_expired_moments()`, `cleanup_expired_vibes()`.

## 3. The media ticket — the single gate for uploads

`media_upload_ticket(p_kind, p_content_type, p_bytes)` is a `security definer`
function and the only thing that can authorize a write to the `media` bucket.

```
me_id()                              → 401 if no session
p_kind in (photos, moments, messages,
           posts, circles, vibes)    → 400 otherwise
media_extension(p_content_type)      → NULL → 415 "That file type is not supported."
media_kind_allows(kind, ext)         → false → 415 with a kind-specific sentence
p_bytes <= 0                         → 400 "That file looks empty…"
p_bytes > ceiling                    → 413 "That file is too large to send."
hourly published count > ceiling     → 429
```

Ceilings: 80 MB for `posts`, `messages`, `circles`, `vibes`; 8 MB for `photos`
and `moments`.

The hourly ceiling counts **published** rows across photos, moments, messages,
posts, circle messages and vibes. It deliberately does **not** count
`media_upload_reservations` — a moment with no file books no reservation, so a
reservation-only count can be walked past. This was rewritten once during 1.0.10
and reverted because the smoke suite proved it broke the ceiling; the current
predicate is the correct one and **must not be replaced**.

On success the ticket inserts a reservation row and returns the object path, so
the Worker can check that the bytes arriving belong to a booked upload.

## 4. Reads are RPCs, not table selects

The client does not build queries against tables. Every list is a function with
its own visibility rules:

| Surface | Function |
|---|---|
| Flow | `flow_feed`, `public_flow_feed` |
| Post detail | `load_post` |
| Comments | `post_comments_feed`, `post_engagement` |
| Moments | `visible_moments`, `view_moment`, `react_to_moment` |
| Vibes | `vibes_feed`, `space_vibes`, `view_vibe` |
| Circles | `circle_feed`, `circle_space`, `read_circle` |
| Space | `space_posts`, `space_vibes` |
| Discovery | `discover_feed`, `search_all` |
| Messaging | `list_conversations`, `load_conversation`, `get_messages` |
| Profiles | `load_profile`, `load_visible_profile`, `public_profile` |

Guards used by all of them: `can_view_media`, `can_view_moment`,
`can_view_post`, `can_view_vibe`, `can_manage_media`, `is_blocked_pair`,
`is_connected_pair`, `close_ones`, `receipts_visible`.

## 5. Storage

| Bucket | Public | Purpose |
|---|---|---|
| `media` | **no** | all member media, served only through the Worker |
| `verification` | **no** | verification selfies, service-role only |

`media` has a bucket-level `file_size_limit` of 80 MB as a backstop under the
per-kind ceilings in the ticket. `can_manage_media` decides read access; the
Worker is the only reader in practice and it re-checks the caller's session.

There is no `upsert` on the media bucket — `upsert: true` is refused by policy.
An earlier bug hid here: a failed upload used to fall back to a Supabase Storage
write, which was rejected by RLS, and that rejection is what members saw as a
blocked post. The fallback is gone.

## 6. Testing the database

The suite runs an ephemeral Postgres and applies, in order:

```
stubs.sql → all migrations → all migrations again → seed.sql → comments.sql → smoke.sql
```

Applying migrations **twice** is intentional: it proves every migration is
idempotent, which is what makes a re-run on production safe. `smoke.sql` asserts
the ticket's matrix, the ceilings, the hourly limit and the RLS reachability of
each feed.

Current result: **0 failures.**

## 7. Notes for whoever comes next

- Never make a schema change that is not idempotent; the double-apply in CI is
  a real gate, not a formality.
- `crushly_fail(status, code, message)` is how RPCs raise readable errors. The
  Worker unwraps `__CRUSHLY__<status>__<code>__<message>` so members see the
  sentence, not the marker.
- `get_post` does not exist. Use `load_post` plus `post_engagement`.
- The Supabase connector rejects `do $$ … raise exception … $$` bodies; use a
  plain function or a direct statement instead.
- Do not delete rows to "fix" a test. Probe accounts used during verification
  were created, used and removed explicitly, and their ids are recorded in
  `PROJECT_CONTINUITY.md`.
