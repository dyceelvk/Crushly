# Holup work queue — not a release checklist completion claim

## Latest decisions
- Add Up becomes an immediate one-way follow, not a request. Remove the matchmaking/mutual animation.
- Keep Close becomes a request that the other person accepts or declines. Whispers require an approved Keep Close relationship.
- Migration: preserve existing mutual connections as approved Keep Close relationships; old one-way Keep Close entries become pending requests; existing active Add Ups become follows. Never silently approve a one-sided Keep Close.
- Display counts for Add Ups and Kept Close on Spaces. Space owner always sees both identity lists. Any member of an approved Keep Close pair can see the owner's Kept Close identity list. Add Up identity-list visibility is controlled by the Space owner: everyone allowed to see the Space, approved Keep Close members, or only the owner. Enforce all access on the server, including blocked/profile-visibility rules.
- Full Notifications screen: Yours, From Holup, settings; categories including Whisper, post activity (likes/comments/mentions), Add Ups, and Kept Close. Route each to its actual item. Use real messages/announcements, never mock data.

## Earlier requirements still open
- Verify/deploy comment @/emoji placement, Space sharing and links, plain banner, link-enabled captions/messages/comments/bios, Space bio on header, functional post location and link controls.
- Server-backed Whisper delete for me and sender delete for everyone: local code and SQL tests in progress; real-device tests and deployment pending. Already-seen material cannot be recalled.
- Public videos: serve a genuinely truncated 13-second rendition to nonmembers, once per video/browser best-effort, no engagement, then prompt download. Never expose full source; recheck privacy and revocation at every access. Requires secure transcoding/serving design and verification.
- Isolated teen mode 12–17 with server-side prevention of adult contact and dating/romantic features. Do not lower age gate before end-to-end enforcement, moderation/safeguarding and tests.
- User's 21-second video retry and physical Android behavior still unverified. Exact Android 1.0.87 smoke failed; production remains 1.0.86. Do not publish stale/failed builds.
- Preserve privacy, private local drafts, stable feeds and the other existing acceptance criteria. Canonical holupapp.vercel.app; removed mecrushly.vercel.app must stay removed.
