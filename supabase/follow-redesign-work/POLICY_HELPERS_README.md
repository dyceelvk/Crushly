# RLS helper privacy repair

Two security-definer helpers exposed as RPC accepted arbitrary viewer/member IDs: `can_view_post(posts,bigint)` and `is_circle_member(bigint,bigint)`. Fabricated arguments could allow relationship or Circle membership inference. These helpers are used by seven RLS policies, so blindly revoking grants would have broken those policies.

Production migration `20261110033516_restrict_identity_sensitive_policy_helpers` replaces policy calls with session-bound wrappers and revokes direct helper access. On a disposable seeded database, the full SQL suite passed with the candidate and synthetic positive/negative member, private-post, RLS and direct-execution tests passed. A production rollback-only preflight and post-deployment checks showed matching admin-visible comment/reaction/Circle counts, working own profile/Discover, and revoked helper access. Source search found no direct helper RPC calls in the current app or the 1.0.87 tag. This is not a complete privacy or old-client certification; real members and Realtime were not tested.

The matching test lives in `supabase/tests/policy_helpers.sql` and must only run on a disposable database. The candidate file remains as historical context; do not apply it separately.
