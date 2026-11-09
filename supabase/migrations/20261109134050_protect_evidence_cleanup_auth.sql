create table public.manual_evidence_cleanup_auth_state (
 singleton boolean primary key default true check(singleton),
 secret_digest text not null check(secret_digest ~ '^[0-9a-f]{64}$')
);
alter table public.manual_evidence_cleanup_auth_state enable row level security;
revoke all on public.manual_evidence_cleanup_auth_state from public,anon,authenticated;
create function public.manual_evidence_cleanup_authenticate(p_digest text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.manual_evidence_cleanup_auth_state where singleton and secret_digest=p_digest)
$$;
revoke all on function public.manual_evidence_cleanup_authenticate(text) from public,anon,authenticated;
grant execute on function public.manual_evidence_cleanup_authenticate(text) to service_role;
