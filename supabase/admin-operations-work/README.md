# Admin operations — experimental, not deployed

Provides admin-gated reports, report triage, minimal account search, verification
status queue, and admin action history. These do NOT implement account bans,
content takedown, manual verification approval, report evidence access, realtime
session revocation, or all other requested operations. They are not a complete
moderation console. The SQL depends on admin controls migration 06 and should
not be promoted without an authorization/security and compatibility review.
