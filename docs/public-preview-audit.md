# Public preview — audit and fixes

**Scope:** the public, logged-out surface of Holup: the share landing at `/v/:id`, the
home page's link card, `robots.txt`, `sitemap.xml`, and the deep links those pages offer.

**Checked live against production** `https://holupapp.vercel.app` on 2026-11-07. Nothing
in this document was deployed; the code changes are in the draft branch only.

## What is live and correct

| Check | Evidence |
| --- | --- |
| A public post renders its own card | `/v/86` → `200`, `<title>Holupyall on Holup</title>`, `og:title`, `og:description`, `og:url`, `og:image`, `twitter:card`, `<link rel="canonical" href="…/v/86">` |
| Visibility is re-checked on every request | handler calls `public_post_preview` per request with `cache: 'no-store'`; response carries `Cache-Control: private, no-store, max-age=0`, `X-Vercel-Cache: MISS` |
| A non-public or removed post leaks nothing | `/v/1` → `404` with the generic "Open in Holup" page, `noindex`, no `og:description` or `og:image`, no author name, no body |
| Malformed ids are not looked up | `/v/0`, `/v/`, `/v/notanid`, `/v/999999999999999` → `404` |
| The preview query itself cannot over-return | `public_post_preview` returns only `id`, `left(body,300)`, author `name`, and requires `audience='everyone'`, no Circle, onboarded, active author, `profile_visibility='everyone'`, not incognito, and the `public_post_sharing` feature on. No media URL, no ids, no coordinates, no birthdate |
| The database agrees with the page | production has 1 post with `audience='everyone'` and exactly 1 previewable row; 0 previewable rows are non-public |
| The card image is real and the right shape | `/brand/share-card.png` → `200 image/png`, 1200×630, 21,688 bytes |
| The home page card is complete | `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` + `width/height/alt`, `twitter:*`, `canonical`, JSON-LD, `google-site-verification`, `<noscript>` body |
| Crawler files are honest | `robots.txt` allows the shell and points at the sitemap; `sitemap.xml` parses and lists one URL on purpose (the app is a single-page shell) |

## Defects found, fixed in the draft branch

1. **The share page offered a scheme the secure app does not answer.** `api/post-share.mjs`
   hardcoded `crushly://v/<id>`, which is the *older debug* build's scheme. The secure build
   registers `holup` and relies on a verified App Link for `https://holupapp.vercel.app/v/`.
   On a secure install the "Open in the Holup app" button therefore did nothing whenever the
   App Link did not intercept (iOS, desktop, unverified install). The page now offers
   `holup://v/<id>` first and keeps `crushly://v/<id>` as an explicitly labelled fallback for
   older installs. Both are covered by tests.
2. **In-app links carrying the secure scheme were not recognised.** `sharedPostId()` in
   `src/lib/postShare.ts` accepted only `crushly:`. It now accepts `holup:` and `crushly:`,
   still validates the host and the id shape, and still rejects a lookalike scheme
   (`holupx://`) or a foreign host.
3. **The `/v/:id` card was missing fields the home page already had.** Added
   `og:site_name`, `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:image:alt`
   and `theme-color`. Without the explicit image dimensions some unfurlers render a
   short, badly-cropped or placeholder card.
4. **The unavailable page is a page, but not a card.** It keeps its intentional `noindex`
   and generic wording (a test asserts it never gains `og:description`/`og:image`, so a
   private post cannot be described by its own metadata), and now carries the same
   `theme-color` and the same two app links so a member with the link can still open the app.

5. **Member posts were indexable.** `/v/:id` now sends `<meta name="robots" content="noindex, follow">`.
   Reachable by link, not listed by a search engine; messenger unfurls ignore the
   robots meta, so cards keep working. This is the conservative default and is a
   one-line reversal if the product decision changes.
6. **Public brand artwork carried the old name.** Organization JSON-LD pointed at
   `/brand/crushly-mark.png`. `public/brand/holup-mark.png` and
   `assets/brand/holup-mark.png` now exist and both the structured data and
   `Logo.tsx` reference them. The old files are left in place so any already-shared
   URL or cached card does not 404.

Tests: `tests/post-share.test.mjs` (5) and `src/lib/postShare.test.ts` (2) pass; the full
app suite passes (303 + 5 + 7); `tsc --noEmit` is clean.

Rendered samples of the changed pages, for review without deploying:
`/home/user/holup-public-preview-available.html` and
`/home/user/holup-public-preview-unavailable.html`.

## Decisions taken

- **Search indexing of member posts: off, reversibly.** An available `/v/:id` page used to
  be indexable, so a member's display name and up to 300 characters of their post could be
  listed in a search engine. That is a larger step than being reachable by link, so the
  landing now sends `noindex, follow`. Unfurl cards are unaffected. Reversing it is one
  meta tag in `api/post-share.mjs`.

## Not fixed — needs a product decision
- **Space links have no preview.** `spaceShareUrl()` produces `/?space=<id>`, which serves
  the app shell, so a shared Space unfurls as the generic Holup card with no name, cover or
  member count. Post links have a real landing page; Space links do not. Building one needs
  a public Space preview RPC that respects Space visibility, which is a feature, not a fix.
- **Blocks cannot be applied to the public landing page.** It is served to anonymous
  visitors through a server-side call with no viewer identity, so a blocked member who has
  the link still sees the excerpt. This is inherent to public sharing rather than a coding
  error; the app itself enforces the block. Worth stating in the product copy if link
  sharing is promoted.
