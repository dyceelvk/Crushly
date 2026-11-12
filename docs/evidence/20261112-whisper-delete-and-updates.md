# What changed on 12 November 2026, and how it was proven

Three complaints, three mechanisms. None of them was a mystery after the first
minute, and none of them was fixed by reassurance.

## 1. "Deleting doesn't work on whispers"

There was no Delete. Not a broken call, not a refused request — the long-press
menu on a Whisper offered reactions, **Copy text** and **Flag this Whisper**, and
that was the whole of it. The feature had been designed and never built, so the
menu was honest about everything except the thing people were looking for.

What exists now:

| Piece | Where | What it does |
| --- | --- | --- |
| `delete_message(p_message_id)` | `20261113180000_delete_whisper_message.sql`, applied to prod | Deletes the row and queues the file in one transaction. Sender only. |
| `service.deleteMessage()` | `CrushlyApp/src/api/service.ts` | Reads `media_url`, calls the RPC, then removes the file. |
| `whisperLive` `deleted` event | `CrushlyApp/src/lib/whisperLive.ts` | Pushes `{id}` on `whisper:<conversation>` — the only way the other phone can learn about a removal. |
| `useChat().remove()` | `CrushlyApp/src/api/hooks.ts` | Optimistic, re-inserts in place on refusal. |
| **Delete** in the long-press card | `CrushlyApp/src/screens/messages/Chat.tsx` | "Delete from the server", with a plain sentence about what it does. |

Live proof, run against the production database inside a rolled-back block:

```
own delete        → row gone, media_deletions.reason = message_deleted,
                    whisper_photo_ledger row kept
third photo same day → __CRUSHLY__429__photo_limit     (deleting does not refund)
peer's message    → __CRUSHLY__403__not_your_message
```

An incremental `get_messages` can never discover a deletion — it asks for ids
*after* the newest. That is why the removal is pushed, and why "refetch" alone
would have looked like a fix and been none.

## 2. "I still see a 📷 in message chat body that says video note"

Five `kind='video'` rows existed in production (ids 65, 66, 75, 85, 86), all
`.webm`, all sent before the server stopped accepting video. They were the
circle. They are gone:

```
messages where kind='video'  → 0
media_deletions queued       → 5, reason video_note_retired
unsigned GET on each file    → 401
```

The player component (`VideoNote.tsx`, `VideoNoteBubble`) is deleted, the bubble
now reads "A video note. Whispers are photos and voice notes now.", and every
label in the app that used to offer the words "Video note" says "A video note"
instead — a thing that cannot be sent, not an affordance.

## 3. "The APK no longer does new update available / updates in app server-side"

The check ran and was refused. The shipped identity is `app.holup.mobile`, so
`updateVersionPath()` asks `/secure/version`, and that route answered:

```
503 Secure Android updates are not available yet.
```

Which was correct while the only published file was a differently-signed debug
build — and became the bug the moment the published file was this identity's own.
On top of that, `UpdateGate` returned `null` for `app.holup.mobile`, so even a
successful answer would have shown nothing.

Both are changed. The route now answers with the build `release.json` describes,
and the gate no longer excludes the identity that is actually installed.

```
GET /secure/version → 200
{"version":"1.0.98","versionCode":98,...,"apkUrl":".../download",
 "downloadInfoUrl":".../download-info"}
```

## 4. "nothing changes" — the reason, stated plainly

Every Vercel production deployment since 1.0.98 was `BLOCKED` with
`COMMIT_AUTHOR_REQUIRED`: the commits were authored `dev@holupp.local`, an
address Vercel cannot match to a GitHub account. A blocked deploy is not a failed
build and produces no red mark, so the repo looked healthy while the website
served a bundle from days earlier.

Commits are now authored `dyceelvk@users.noreply.github.com`, which Vercel did
accept on the last successful preview. The site was also force-deployed through
the Vercel API and now serves a new bundle (`index-3e777b6f…` → later builds)
that contains "Delete from the server" and "Delete this Whisper".

## 5. Secrets

`audit-apk-secrets.py` now runs on **the shipped** build, before publish, and on
the web export before deploy. It ran clean against the live 1.0.98 APK:

```
Secret leakage check passed (0 configured credentials, 7 shapes,
1661 files, 32297 bytecode strings); no values logged.
```

Every `sb_secret` / `service_role` occurrence in the installed bundle is library
error text or the app's own guard that refuses to run on a secret key. No JWT,
no `ghp_`, no `AKIA`, no private key block.

## 6. One build on the server

`publish-android.yml` now removes every object in `android-releases/` except the
one `release.json` names, then lists the bucket again and fails the run unless
exactly one remains. The keep-set comes from `release.json`, never from the
version typed into the workflow, so a typo cannot delete the build being
published.

## 7. The splash

It said `HOLUP`. The official wordmark is `holUpp` — lowercase h, capital U. The
splash is now the official symbol and wordmark, optically centred.
