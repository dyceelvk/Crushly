# Manual verification — local experiment, NOT deployed

User decisions: creator = gold; person ID = diamond blue; company/admin retains
its existing badge and is exempt from thresholds. Both kinds need a human admin
review. Didit is **not** an ordinary signup or creator flow; it will be
admin-directed live capture for person ID, and successful capture is mandatory
before person ID approval.

Current prototype: member/admin RPCs for eligibility, applications, text
review conversations and manual decisions. The admin decision checks
`holup_is_admin()` server-side and records an audit; person ID approval rejects
unless a case-specific trusted capture evidence record exists. No component can
create such evidence yet. Admin cannot approve person ID in this prototype until
a signed-provider integration is implemented. Rejected cases do not alter an
existing badge. Admin account badge is untouched. This is not production-ready.

Counts as currently proposed: current, non-Circle posts; media means any current
post with a media URL; text means no media and nonempty body; Crushes mean only
`kind='crush'` reactions still present, not other reactions. Video classification
uses file extension, matching existing app behavior, and may misclassify imports
or unusual URLs. Add Ups use active, onboarded, unblocked incoming accounts and
pending/accepted rows. The four weeks are four rolling non-overlapping seven-day
periods, each requiring three posts. Eligibility is checked at application and
stored as a snapshot; final decision is manual. The meaning of "returned 3 posts"
was clarified as four weeks of 3 posts/week. Should private/nonpublic or Circle
posts count? The current experiment excludes Circle posts but includes other
private posts. Align media classification, block rules, fraudulent engagement,
post audiences and moderation before deployment.

Important release blockers:
- No private document upload/download, consent notice, access logging on file
  reads, malware scanning, retention/deletion or data-subject deletion pipeline.
  Never use the existing public media bucket for IDs or selfies. Do not solicit
  documents until a private evidence store and retention policy exist.
- No admin-directed Didit session or trusted result binding to a case yet;
  a new signed webhook/decision verifier must validate provider/session binding
  and idempotency. Do not treat an arbitrary URL or member assertion as proof.
- Existing deployed Didit endpoints automatically award ordinary verification,
  including via outstanding signed webhooks and status polls. They must be
  safely retired or redirected to evidence-only, with a migration plan for
  existing pending requests, before this design can ship. Merely deleting a UI
  button is insufficient. Legacy badge meaning and client compatibility need
  a plan; an earned creator badge must not falsely claim ID verification.
- No alert/notification, admin document viewer, application withdrawal,
  appeal/reapplication policy or content-based anti-fraud controls. Account
  deletion/retention and reviewer access must be designed. Text can contain
  sensitive data despite warnings; policies and retention must cover it.
- SQL is experimental and has not been executed, checked against production,
  or migrated. User requested no tests; nevertheless privacy-critical release
  must not bypass security review and necessary validation. No changes have
  been made to Supabase or live web/android during this task.
