-- Raw message reads must apply the same block check as the message RPC.
create or replace function public.session_can_select_whisper(p_conversation_id bigint)
returns boolean language sql stable security definer set search_path=public as $$
 select exists (
   select 1 from public.conversations c
   where c.id=p_conversation_id and public.me_id() in (c.user_a,c.user_b)
     and not public.is_blocked_pair(c.user_a,c.user_b)
 );
$$;
revoke all on function public.session_can_select_whisper(bigint) from public,anon,authenticated;
grant execute on function public.session_can_select_whisper(bigint) to authenticated,service_role;
alter policy messages_pair on public.messages using (public.session_can_select_whisper(conversation_id));
