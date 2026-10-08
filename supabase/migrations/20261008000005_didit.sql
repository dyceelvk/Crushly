-- Didit identity verification: hosted sessions + signed webhooks.
--
-- The member flow no longer uses AI selfie checks: Didit runs the ID document,
-- liveness and face-match steps, and we store the session + decision here.
-- The AI reviewer (verify-identity edge function) is now an ADMIN-ONLY assist
-- for manual review — the member app never calls it.

alter table public.verification_requests
  add column if not exists didit_session_id text,
  add column if not exists didit_status text,
  add column if not exists decision jsonb,
  add column if not exists didit_event_id text;

-- Didit sessions carry no selfies: relax the legacy not-null columns so a
-- Didit request row is just a session handle + decision.
alter table public.verification_requests alter column selfie_path drop not null;
alter table public.verification_requests alter column pose drop not null;

comment on column public.verification_requests.didit_session_id is 'Didit v3 session UUID (POST /v3/session/).';
comment on column public.verification_requests.didit_status is 'Raw Didit status string ("Approved", "Declined", "In Review", ...).';
comment on column public.verification_requests.decision is 'Didit decision payload (feature arrays) from the webhook or the decision poll.';

-- Webhook idempotency: Didit reuses the same event_id across retries, so the
-- receiver dedupes on it. Service role only — no RLS policies on purpose.
create table if not exists public.didit_events (
  event_id    text primary key,
  session_id  text,
  received_at bigint not null default public.now_ms()
);
alter table public.didit_events enable row level security;

create index if not exists verification_requests_didit_session_idx
  on public.verification_requests (didit_session_id);
