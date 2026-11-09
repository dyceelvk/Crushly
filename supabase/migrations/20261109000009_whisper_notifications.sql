-- Whispers have their own notification category. Do not duplicate private text:
-- each event is only a signal to open the authorized conversation.
create or replace function public.notify_to(
  p_uid bigint, p_kind text, p_actor_id bigint default null, p_ref_id bigint default null, p_body text default ''
) returns void language plpgsql security definer set search_path=public as $$
declare existing_id bigint;
begin
  if not public.notification_allowed(p_uid,p_kind) then return; end if;
  if p_kind in ('post_mention','keep','message') and p_actor_id is not null then
    select id into existing_id from public.notifications
      where user_id=p_uid and kind=p_kind and actor_id=p_actor_id
        and ref_id is not distinct from p_ref_id and read_at is null limit 1;
    if existing_id is not null then
      update public.notifications set created_at=public.now_ms(), body=case when p_kind='message' then '' else p_body end where id=existing_id;
      return;
    end if;
  end if;
  insert into public.notifications(user_id,kind,actor_id,ref_id,body)
  values(p_uid,p_kind,p_actor_id,p_ref_id,case when p_kind='message' then '' else p_body end);
end $$;
revoke all on function public.notify_to(bigint,text,bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.notify_to(bigint,text,bigint,bigint,text) to service_role;
