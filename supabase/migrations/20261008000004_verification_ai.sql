-- AI-assisted verification: multi-selfie submissions + machine verdicts.
-- The edge function `verify-identity` (service role) writes ai_verdict and
-- settles the request; without an AI key it stays pending for human review.

alter table public.verification_requests
  add column if not exists selfies jsonb not null default '[]'::jsonb,
  add column if not exists ai_verdict jsonb,
  add column if not exists ai_reviewed_at bigint;

comment on column public.verification_requests.selfies is 'Extra selfie storage paths (beyond selfie_path) for the illustrated pose steps.';
comment on column public.verification_requests.ai_verdict is 'Raw JSON verdict from the AI review ({real_person, pose_ok, same_person, confidence, reason}).';
