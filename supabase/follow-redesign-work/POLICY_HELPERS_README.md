# RLS helper privacy prototype — not deployed

Two security-definer helpers exposed as RPC accept arbitrary viewer/member IDs:
`can_view_post(posts,bigint)` and `is_circle_member(bigint,bigint)`. Fabricated
arguments may allow inference of another person's relationship or Circle
membership. This has not been tested with another real person's information.
The first helper is also called by four live RLS policies; the second by three.
Blindly revoking grants breaks these policies.

`10_policy_helpers_candidate.sql` replaces those policy calls with
session-bound wrappers, then revokes direct helper access. It is not ready to
ship: verify all deployed clients, API surface, PostgREST behavior, realtime
subscriptions, and RLS behavior with synthetic members and posts on a
**disposable** database, including blocks, Circle membership and old clients.
Evaluate any production transaction only rollback-only, without altering user
data. Preserve service role behavior. No fixture should ever run in production.
