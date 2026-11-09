-- Pause automatic badge assignment while manual, category-specific verification
-- is being completed. Existing badges are preserved. Old in-flight provider
-- sessions can still be recorded, but a provider approval is not an admin award.
create or replace function public.apply_didit_status(
  p_session_id text, p_status text, p_decision jsonb default null, p_event_id text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id bigint;
  v_row public.verification_requests%rowtype;
  v_latest bigint;
  v_rank int;
  v_old_rank int;
  v_status text;
begin
  select user_id into strict v_user_id from public.verification_requests
    where didit_session_id = p_session_id order by id desc limit 1;
  perform 1 from public.profiles where id = v_user_id for update;
  select * into strict v_row from public.verification_requests
    where didit_session_id = p_session_id order by id desc limit 1 for update;
  if p_event_id is not null then
    insert into public.didit_events (event_id, session_id) values (p_event_id, p_session_id)
      on conflict do nothing;
    if not found then return; end if;
  end if;
  select max(id) into v_latest from public.verification_requests where user_id = v_user_id;
  if v_row.id <> v_latest or v_row.status in ('superseded','approved','rejected') then return; end if;
  -- Provider documentation uses both upper case and title case. Unknown
  -- statuses never change a request or profile.
  v_status := case upper(trim(coalesce(p_status,'')))
    when 'NOT STARTED' then 'Not Started' when 'IN PROGRESS' then 'In Progress'
    when 'IN REVIEW' then 'In Review' when 'APPROVED' then 'Approved'
    when 'DECLINED' then 'Declined' when 'EXPIRED' then 'Expired'
    when 'ABANDONED' then 'Abandoned' else null end;
  if v_status is null then return; end if;
  v_rank := case v_status when 'Not Started' then 0 when 'In Progress' then 1
    when 'In Review' then 2 else 3 end;
  v_old_rank := case upper(coalesce(v_row.didit_status,''))
    when 'IN PROGRESS' then 1 when 'IN REVIEW' then 2
    when 'APPROVED' then 3 when 'DECLINED' then 3
    when 'EXPIRED' then 3 when 'ABANDONED' then 3 else 0 end;
  if v_rank < v_old_rank or v_old_rank = 3 then return; end if;
  update public.verification_requests set
    status = case v_status when 'Declined' then 'rejected'
      when 'Expired' then 'superseded' when 'Abandoned' then 'superseded' else 'pending' end,
    didit_status = v_status, decision = coalesce(p_decision, decision),
    didit_event_id = coalesce(p_event_id, didit_event_id)
    where id = v_row.id;
  update public.profiles set verification = case v_status
    when 'Declined' then 'rejected' when 'In Progress' then 'pending'
    when 'In Review' then 'pending' when 'Approved' then 'pending' else 'none' end
    where id = v_user_id and verification <> 'verified';
end $$;
-- Preserve service-only access and explicitly close default grants.
revoke all on function public.apply_didit_status(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_didit_status(text,text,jsonb,text) to service_role;
notify pgrst, 'reload schema';
