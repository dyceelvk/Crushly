-- EXPERIMENT ONLY. Aggregate operational state only, with no object paths,
-- document data, applicant identities or secrets exposed to the admin client.
-- This does not install a scheduler or verify backups/provider deletion.
begin;
create table public.manual_evidence_cleanup_health_state (
 singleton boolean primary key default true check(singleton),
 last_attempt_at bigint,
 last_success_at bigint,
 last_failed integer not null default 0 check(last_failed>=0)
);
insert into public.manual_evidence_cleanup_health_state(singleton) values(true);
alter table public.manual_evidence_cleanup_health_state enable row level security;
revoke all on public.manual_evidence_cleanup_health_state from public,anon,authenticated;
create or replace function public.manual_evidence_cleanup_heartbeat(p_failed integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_failed is null or p_failed<0 then raise exception 'Invalid count' using errcode='22023'; end if;
 update public.manual_evidence_cleanup_health_state
 set last_attempt_at=public.now_ms(),
     last_success_at=case when p_failed=0 then public.now_ms() else last_success_at end,
     last_failed=p_failed where singleton;
end $$;
create or replace function public.manual_evidence_cleanup_health() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.manual_evidence_cleanup_health_state; pending bigint; overdue bigint;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select * into s from public.manual_evidence_cleanup_health_state where singleton;
 select count(*) into pending from public.manual_verification_file_deletions;
 select count(*) into overdue from public.manual_verification_files f join public.manual_verification_cases c on c.id=f.case_id
 where f.state<>'deleted' and ((c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000))
   or (f.state='reserved' and f.created_at<=public.now_ms()-86400000));
 return jsonb_build_object('lastAttemptAt',s.last_attempt_at,'lastSuccessAt',s.last_success_at,'lastFailed',s.last_failed,
   'queuedObjects',pending,'overdueImages',overdue,
   'attention',s.last_success_at is null or s.last_success_at<public.now_ms()-3600000 or s.last_failed>0 or pending>0 or overdue>0);
end $$;
revoke all on function public.manual_evidence_cleanup_heartbeat(integer),public.manual_evidence_cleanup_health() from public,anon,authenticated;
grant execute on function public.manual_evidence_cleanup_heartbeat(integer) to service_role;
grant execute on function public.manual_evidence_cleanup_health() to authenticated;
commit;
