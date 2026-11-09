-- EXPERIMENT ONLY. To be coordinated with the app and edge deployment.
-- Old provider callbacks and legacy clients must not auto-award badges after
-- manual review is introduced. Preserve existing badges and historical rows.
begin;
create or replace function public.record_didit_session(p_user_id bigint,p_session_id text,p_url text)
returns void language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Legacy verification has been retired; use the review application' using errcode='55000';
end $$;
create or replace function public.apply_didit_status(p_session_id text,p_status text,p_decision jsonb default null,p_event_id text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 -- Acknowledge late legacy webhook/poll without recording raw identity data
 -- or changing any profile, regardless of provider status.
 return;
end $$;
revoke all on function public.record_didit_session(bigint,text,text),public.apply_didit_status(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_didit_session(bigint,text,text),public.apply_didit_status(text,text,jsonb,text) to service_role;
commit;
