# Admin operations — experimental, not deployed

Provides admin-gated reports, report triage, minimal account search, verification
status queue, and admin action history. These do NOT implement account bans,
complete content moderation, manual verification approval, report media access, realtime
session revocation, or all other requested operations. They are not a complete
moderation console. The SQL depends on admin controls migration 06 and should
not be promoted without an authorization/security and compatibility review.

Reported-post inspection and irreversible deletion are now prototyped: an admin
can only retrieve or delete the post named in `post:<id>` report context when
its author is the reported member, must give a reason, and actions are audited.
The UI requires a second confirmation. Media is not available to the review
panel; no claim is made that deletion recalls downloaded copies or deletes the
original stored bytes. This remains unverified and undeployed; account bans and
evidence-backed verification decisions are still absent.
