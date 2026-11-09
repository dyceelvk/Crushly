-- EXPERIMENT ONLY. Server-only ingestion of verified Didit webhooks.
-- No raw provider payload, personal data, IDs or images are stored.
begin;
create table public.manual_capture_events (
 event_id text primary key check(length(event_id) between 1 and 200),
 received_at timestamptz not null default now()
);
alter table public.manual_capture_events enable row level security;
revoke all on public.manual_capture_events from public,anon,authenticated;
create or replace function public.manual_capture_apply_event(p_case bigint,p_session text,p_workflow text,p_state text,p_event text,p_observed_at bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_event is null or length(p_event) not between 1 and 200 then raise exception 'Invalid event' using errcode='22023'; end if;
 -- This checks case/session/workflow binding and transactionally updates only
 -- evidence, never the badge. Rollback leaves an event retryable if creation
 -- has not yet committed; replay is safe after success.
 insert into public.manual_capture_events(event_id) values(p_event) on conflict do nothing;
 if not found then return true; end if;
 perform public.manual_capture_result(p_case,p_session,p_workflow,p_state,p_observed_at);
 return true;
end $$;
revoke all on function public.manual_capture_apply_event(bigint,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.manual_capture_apply_event(bigint,text,text,text,text,bigint) to service_role;
commit;
