# Where the four fixes stand

**Written 2026-10-29 22:10 UTC.** Every claim below was checked against the
running system in this session; the check is named next to it.

---

## The short version

| The fix | Code | Database | In a build members have |
|---|---|---|---|
| Save writes a real row | done, tested | **live** | **no** |
| Circle posts show counts | done, tested | **live** | **not yet** — needed no app change |
| Vibe captions are drawn | done, tested | n/a | **no** |
| Chat composer clears the keyboard | done | n/a | **no** |

The database is ahead of the app. That is deliberate and safe for these two
changes, and it is written down here so nobody has to guess which half is where.

---

## 1. Save — database live, app not shipped

**What was wrong.** `PostViewer.tsx` held `const [isSaved, setIsSaved] =
useState(false)`. Tapping it flipped the flag, showed "Post saved", and the save
was gone when the viewer closed. There was no table to write to, so no amount
of UI work could have made it true.

**What exists now.**

- `public.post_saves (user_id, post_id, created_at)`, primary key on the pair,
  `on delete cascade` from both `profiles` and `posts`.
- RLS enabled, three policies, all `user_id = me_id()` — verified in production
  by reading `pg_policies`: `post_saves_select_own`,
  `post_saves_insert_own`, `post_saves_delete_own`. There is no policy under
  which a post's author can enumerate who saved it.
- `save_post(post, saved)` returns `{saved}` from the database's own state, so
  a double tap cannot leave the icon ahead of the truth.
  `post_saved(post)` answers one post. `saved_posts(limit, after)` is the
  drawer, shaped like `flow_feed`, filtered through `can_view_post`.
- App: `usePostSaved`, `useSavePost` (optimistic with rollback), `useSavedPosts`,
  a `SavedPosts` screen reusing `PostCard`, a bookmark in the Flow header, and
  "Saved posts" in Settings.

**Proof it is live** (`supabase__execute_query` against production):

```
table_exists = true · policies = 3 · rls_on = true · functions = 3
authenticated: EXECUTE granted on all three · anon: denied
call saved_posts(1, null) with no identity -> __CRUSHLY__401__unauthorized
set role authenticated, no member  -> me_id() = null, post_saves rows visible = 0
```

**Proof it is not shipped.** The production web bundle
`index-834e34ff65c5383efd0bde20f4d05a67.js` contains **zero** occurrences of
`save_post`, `saved_posts` or `post_saved`. The 1.0.10 APK predates the work.
Vercel builds this branch as `STAGED` previews (production is pinned to `main`),
and the preview URLs are behind SSO, so they are not reachable anonymously.

## 2. Circle posts — live, and members get it without updating

`circle_feed` was the only post-returning function that built its JSON by hand
without merging `post_engagement`, so inside a Circle `likeCount`,
`commentCount` and `liked` were **absent** — not zero. The Feed and the Circle
disagreed about the same post.

Replaced in production with the previous function plus one clause:

```
-        )
+        ) || public.post_engagement(r.id, me)
```

A line-by-line diff against the previous definition shows explicit whitespace
and that one line, nothing else. An earlier draft of the replacement had also
changed the non-member error from `404 Circle not found.` to a 403 with new
wording; that was reverted before deploy, in `b646a9b`, because nobody asked
for a change in what a non-member is told.

Verified live: `pg_get_functiondef(circle_feed) LIKE '%post_engagement%'` is
now `true`, and it still contains `Circle not found.`.

## 3. Vibe captions — code only

`Vibe.edit` was declared `VideoEdit`. The server stores a `LiveEdit`. Both types
spell `filter`, `brightness`, `contrast`, `saturation` and `aspect` the same
way, which is why the look survived and the **captions and stickers silently
did not**. The full-screen Vibe feed played a bare `VideoView`, never a canvas.

Now the type is `LiveEdit`, and `VibeClip` renders through `VideoEditCanvas`
using the existing `editFromLive()`. Three tests pin it: a stored edit reaches
the canvas with its caption text, an untouched clip yields a neutral empty edit
rather than `null`, and an overlay only appears inside its own time window.

## 4. Chat keyboard — code only

`KeyboardAvoidingView` had `behavior={undefined}` on Android. That does nothing
once the app draws edge to edge (the same thing that made `CommentsSheet`
measure the keyboard), so the composer sat underneath it. Now `height` on
Android and `padding` on iOS, and opening the attachment tray dismisses the
keyboard first.

---

## What would ship them

| Target | Action | Effect |
|---|---|---|
| Web | promote `dpl_38dZ324L227FrEMmNg38swv8WYsg`, or merge to `main` | Save, Vibe captions, keyboard fix reach browser users |
| Phones | `workflow_dispatch` on `build-android.yml` | cuts an APK from this branch; the job only auto-runs on `arena/**` |

Neither was done, because shipping to members is the owner's call.

---

## Tests

| Suite | Result |
|---|---|
| `CrushlyApp` `npm test` | **121 pass, 0 fail** (was 118) |
| `tsc --noEmit` | exit 0 |
| `npm run build:web` | exports clean |
| `supabase/tests/run.py` — smoke, comments, saves, post_shape | **all pass** on a fresh database |
| GitHub Actions on `f54e820` | CI **success**, Deploy media Worker **success**, Deploy web app **failure** (missing `VERCEL_TOKEN`, pre-existing) |

Two of the new tests were checked against a deliberately broken build to prove
they can fail: removing the save insert makes `saves.sql` report *"save_post
reports saved"*, and deleting the `circle_feed` migration makes `post_shape.sql`
report *"circle_feed returns likeCount"*. A test that has never failed is not
evidence.

## Not verified

- **Nothing here has been exercised on a phone.** The save flow, the Vibe
  captions and the keyboard behaviour are all proven at the type, unit and
  database level and by a clean bundle; none has been tapped on a device.
- **A `.mov` from a real iPhone or Samsung** remains untested — unchanged from
  the 1.0.10 report.
- The SSO-protected preview builds were verified from their build logs
  (`Web Bundled 51529ms index.ts (940 modules)`, state `READY`) and from a clean
  local `build:web`, not by loading the preview site.
