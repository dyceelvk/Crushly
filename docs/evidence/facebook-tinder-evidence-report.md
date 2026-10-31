# Facebook and Tinder — reverse-engineering report

Captured 2026-10-31 with `rea` 6.8.0 against public, logged-out surfaces at a
390×844 mobile viewport. This closes the two runs left open after TikTok
(`tiktok-evidence-report.md`).

Same boundary as before: public web surfaces only, no APK/IPA extraction, no
protection bypass. Everything below is either read out of the served page or
statically parsed out of the served JavaScript.

---

## What was actually captured

| | Facebook | Tinder |
|---|---|---|
| Surface | `m.facebook.com/watch/?v=1826292051583905` | `tinder.com/` |
| Logged out | yes | yes |
| Raw capture | `facebook-watch-raw.json` (256 KB, 57 inline scripts) | `tinder-landing-raw.json` (296 KB inline) + 5 external bundles |
| REA evidence | — | `ev_5947c215ba023ad0f8eb99df43cff4224f9d12d911613a999fc21c4a713d83f5` |
| Static coverage | serialized media model read out of the page | **41/41 scripts parsed, 683,398 AST nodes**, 193 unique route paths |

Two limits worth stating plainly, because they bound the conclusions:

1. **Neither comment composer is reachable logged out.** Tapping "View comments"
   on Facebook opened a "Get the full experience / Log in" dialog, not a thread.
   So the comment *ordering and nesting* claims below rest on the payload and
   labels, not on poking a live thread.
2. **Tinder's swipe gesture code never loaded.** The landing page ships the
   marketing shell; `/app/recs` is behind auth and its chunk was not served. REA
   parsed everything the page *did* ship (which is where the API routes and the
   string catalogue live), but the drag-threshold maths is in a chunk we could
   not obtain. I did not guess at it.

---

## Facebook

### The player keeps a pool, not a single element

Five `<video>` elements on one post:

| # | src | paused | muted | preload | readyState | parent |
|---|---|---|---|---|---|---|
| 0 | fbcdn mp4 | **false** | true | metadata | 4 | div |
| 1–3 | *(empty)* | true | true | metadata | 0 | div |
| 4 | fbcdn mp4 | true | **false** | **auto** | 0 | **body** |

This is the opposite of TikTok, which runs exactly one `<video>` for the entire
feed (`loop:false`, `muted:true`, no pool). Facebook keeps one live player, three
empty placeholder shells it can swap a source into, and one unmuted
`preload="auto"` element parked on `<body>` — a speculative preloader for the
next clip.

For Crushly this validates the choice already made in `playerFocus.ts`: one live
player, focus follows scroll. Facebook's pool is a performance trick for a
*pool of visible cards*; Crushly's viewer only ever shows one post at a time, so
a pool would be three wasted decoders. The one idea worth stealing is the
body-level `preload="auto"` for the next item — cheap, and it would cut the
first-frame delay when you swipe on.

Also note `controls: false` and `disablePictureInPicture: false`: Facebook does
not use the native control bar but *does* allow PiP. Crushly's viewer draws its
own controls; allowing PiP is a free win on a video app.

### Rail order: like · comment · share, and nothing else

Identical to TikTok. No save button, no view count, on the mobile rail:

```
Like 10K   ·   Comment 5K   ·   Share 7K
```

Facebook *does* track saves and views, they are simply not on the rail. That is
the third confirming datapoint for Crushly's rail order, and it supports the
decision already taken: Whisper and Keep stay, because Crushly is not a
broadcast app, but they belong in a secondary sheet rather than diluting the
three primary actions.

### The media model, verbatim from the page

The serialized payload inside the page's inline script carries the whole
engagement contract. Fields that matter, quoted exactly:

```
playable_url: "https://video-sea5-1.xx.fbcdn.net/....mp4?...",
video_versions: [{url: "...", type: 1}],
video_duration: 38520,          // milliseconds, not seconds
aspect_ratio: 0.5625,           // 9:16
finite_loop_count_reels: null,  // loop is a per-surface setting, not a bool
finite_loop_count_tab: null,
has_liked: false,
can_comment: false,             // ← server-decided, independent of the count
like_count: 10000,
comment_count: 5142,
reshare_count: 7929,
cover_image_url: "https://scontent-sea5-1.xx.fbcdn.net/...jpg",
privacy_description: "Public",
viewer_reaction: 0,             // enum int; 0 = none
reaction_count: 10000,
show_reaction_count: true,      // ← display is a server decision too
```

Four things here are worth more than the rest:

**`can_comment` is a capability, not an inference.** The post has 5,142 comments
and still ships `can_comment: false` for this viewer. The composer's availability
is decided server-side and sent as a flag, so the client never has to derive "may
I comment here?" from audience rules that might have changed. Crushly currently
infers it from `audience` in the comment sheet. That is the same class of bug the
repo already fixed once with `can_view_post` — the client should be told.

**`show_reaction_count` is also server-side.** Whether a count is *displayed* is
decided independently of whether it exists. That is the clean way to hide a
lonely "1" without lying about the number.

**`like_count` and `reaction_count` are separate numbers.** They were identical
here (10,000) because `like_count` is the Like slice of the full reaction tally.
Facebook kept the LIKE-only count as its own field for years of compatibility.
Crushly made the opposite and better call: `post_reactions.kind` with a single
`likeCount` plus a `reactionKinds` breakdown. Do not add a parallel
like-only counter.

**`viewer_reaction` is an enum, not a boolean.** One reaction per person, stored
as an int, with `has_liked` alongside it as a convenience. This is exactly the
shape Crushly now has (`myReaction` + `liked`), reached independently — worth
recording as corroboration rather than as something to change.

### Count shortening: Facebook and TikTok disagree, and we follow TikTok

| Count | Facebook pixels | TikTok pixels |
|---|---|---|
| 799 | `799` | `799` |
| 2,037 | — | `2037` |
| 5,142 | `5K` | — |
| 10,000 | `10K` | `10K` |
| 93,794 | `93K` | — |
| 110,288 | `110K` | — |

Facebook switches to `K` at **1,000** and **truncates without a decimal**.
TikTok switches at **10,000** and keeps one decimal.

`lib/counts.ts` follows TikTok deliberately, and the reason survives contact with
this evidence: Crushly's railway is narrow and the counts are small at the scale
the app is at. "2037" is more useful than "2K", and there is room for it. This is
a recorded choice, not an oversight.

### What the accessibility labels carry — and what we did about it

Every Facebook rail button announces the **exact** number while displaying the
shortened one:

| Visible | `aria-label` |
|---|---|
| `10K` | `Like, 10000 reactions, Double tap to li…` |
| `5K` | `Comment on reel by Sarah McAllister, 514…` |
| `7K` | `Share reel by Sarah McAllister, 7929 sha…` |
| `799` | `Comment on reel by Itsphoebegirl, 799 co…` |

Crushly's rail had only the verb — `accessibilityLabel="Comments"` — so a screen
reader got the action and none of the information. That is fixed in this change;

see "Applied to Crushly" below.

---

## Tinder

### The engagement vocabulary is four verbs, and one of them is a note

Every swipe-shaped route the bundle declares:

```
/like/{userId}
/like/{userId}/super
/pass/{userId}
/v2/like/{userId}/swipenote
```

Plus, around them: `/v2/recs/core` and `/v2/explore/recs` (the deck),
`/v2/fast-match` with `/count`, `/teaser`, `/teasers` (the Liked-You grid),
`/boost` and `/boost/result`, and the match/message family
`/v2/matches`, `/v2/matches/{matchId}`, `/v2/matches/{matchId}/messages`,
`/message/{messageId}/like`, `/v2/readreceipt/{matchId}`, `/v2/seen/{matchId}`,
`/v1/match-expiration/archived-matches`.

**There is no comment route at all.** In Tinder's entire 193-path inventory, not
one `comment` segment appears. A dating product does not have a comment layer;
it has reactions on messages (`/message/{messageId}/like`) and a chat. That is a
useful corrective to the assumption that "social app ⇒ comments everywhere":
Crushly has both surfaces, and they should not be built by the same abstraction.
Post comments are public-ish threads under a post; the message reaction is a
per-message toggle inside a private conversation. Crushly already models these
separately (`post_comments` + `post_comment_likes` vs `message_reactions`), which
is right.

**`/swipenote` is the interesting one.** A like can carry text. In the product
this surfaces as "Swipe Note": the thing you attach when a photo deserves a
sentence rather than a heart. Crushly has the same idea in
`crush_member(p_target_id, p_is_deep, p_note)` — a crush with an optional note —
and the evidence says that pairing is a real product pattern, not an invention.

### Swipe provenance is a first-class enum

```
{ button: "BUTTON", profileButton: "PROFILE_BUTTON",
  swipe: "SWIPE", keyboard: "KEYBOARD", profileKeyboard: "PROFILE_KEYBOARD" }
```

Where a like came from is tracked as an enum, not collapsed into "the user liked
this". The same gesture vocabulary appears again in the bundle as separate
strings — `swipe_left`, `swipe_right`, `swipe_up`, and a flag
`priority_likes_swipe_right_threshold` — and in per-surface counters
(`swipeCount`, `swipedMediaIndex`, `swipeDemoShown`).

Crushly records that a crush happened but not how: a tap on a card, a tap on a
profile, and a keyboard shortcut are indistinguishable in `crushes`. Adding a
`source` column would cost one nullable text column and would let the product
answer "which surface produces connections?" This is written up as a follow-up
rather than applied, because it needs a migration and the user has not asked for
schema change on the strength of a Tinder observation.

### Three outcomes, three confirmations

The bundle ships a dedicated overlay animation per swipe direction:

```
swipeOverlayRecCardSparksLike
swipeOverlayRecCardSparksNope
swipeOverlayRecCardSparksSuperLike
```

and matching profile-scoped variants (`overlayProfileSparksSuperLike`,
`overlayRecCardSuperLike`, `overlaySuperLike`, `textSuperLike`,
`backgroundSuperLike`, `iconSuperlike`).

So: right / left / up each get their own visual confirmation, and the same
outcome gets a differently-scoped treatment depending on whether you swiped a
card in the deck or acted on a profile. Crushly has three outcome verbs —
`crush_member` (crush), `crush_member(…, p_is_deep := true)` (deep crush),
`pass_member` (pass) — and the lesson transfers directly: they should not all
land on the same toast.

### "It's a Match" is a two-action moment, not a notification

From the shipped string catalogue:

```
ItsAMatch.itsAMatch        = "It's a Match!"
ItsAMatch.likesYouToo      = "{name} likes you too!"
ItsAMatch.goToChat         = "Go to chat"
ItsAMatch.keepSwiping      = "Back to Tinder"
ItsAMatch.saySomethingNice = "Say something nice!"
ItsAMatch.ReplyToUser      = "Reply to {name}…"
ItsAMatch.sendAMessageSuccess / sendAMessageFailure
```

The whole design is in those seven strings. The moment is full-screen and it
offers exactly **two** exits — go to the chat, or go back to swiping — plus an
optional first message ("Say something nice!") with its own success and failure
strings, i.e. sending that opener is a real network action that can fail, and the
failure is shown rather than swallowed.

**Crushly has no match moment.** `crush_member` returns jsonb and the connection
is made, but nothing in `CrushlyApp/src` renders an "it's mutual" surface — a
grep for `isMatch|matched` finds only an unrelated "Face match" settings string.
Given Crushly's whole premise is mutual crushes, this is the largest product gap
this round of evidence turned up. Written up as the top follow-up.

### The rest of the vocabulary, for tone-matching

```
nope            = "Nope"          nopeUppercase = "NOPE"
superlike       = "Super Like"    superlikeUppercase = "SUPER LIKE"
rewind          = "Rewind"
likesYou        = "Likes You"
numMore         = "+{num} more"
```

Single-word verbs, the uppercase form reserved for the swipe overlay itself, and
`+{num} more` for the overflow. Crushly's rail already uses single-word capitals
(`Keep`, `Share`) which is consistent.

---

## Applied to Crushly in this change

**Exact counts in the accessibility labels** (`counts.ts`, `PostViewer.tsx`),
straight from the Facebook evidence:

* new `spokenCount(n, singular, plural?)` in `lib/counts.ts` returns
  `"12417 reactions"`, `"1 comment"`, or `""` for zero — the visible rail keeps
  `formatCount`'s `12.4K`.
* `RailAction` gained an optional `spoken` prop; the label is now
  `"Open comments, 514 comments"` and
  `"React to this post, hold for more, 10000 reactions"`.
* four new tests; the suite is **42/42** (was 38), `tsc --noEmit` clean.

Nothing else was changed on the strength of this evidence. The three findings
below need a decision or a migration, so they are parked, not silently applied.

## Follow-ups this evidence justifies

| # | Change | Why | Cost |
|---|---|---|---|
| 1 | **A match moment.** Full-screen, two exits (`Go to chat`, `Keep browsing`), optional opener. | Mutual crush is the product; today the moment is invisible. Tinder's seven strings are a complete spec. | one screen + an event from `crush_member` |
| 2 | **`can_comment` as a server flag** in the post payload instead of inferring from `audience`. | Facebook ships it as a boolean even when the count is 5,142. Same class of bug as `can_view_post`. | one jsonb field in `post_engagement`/feed serializers |
| 3 | **`crushes.source` enum** (`card` / `profile` / `keyboard` / `button`). | Tinder tracks provenance; Crushly cannot answer "which surface converts". | one nullable column + passing it through `crush_member` |
| 4 | **Per-outcome confirmations** — crush, deep crush and pass should not share one toast. | Tinder ships three distinct overlay animations. | UI only |
| 5 | **Preload the next item's video** with a body-level `preload="auto"` element. | Facebook's one good pool trick; cuts first-frame delay. | small, but touches the player |

Items 1 and 2 also cover the two "built but not wired" items already on the list
(optimistic `useSavePost` / `useLikePostComment`, and windowing into
`Circle`/`FeedHub`), so they are the natural next slice.
