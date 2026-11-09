-- A Moment reply points to the Moment, not a permanent copy of its content.
-- Each tap rechecks the current Moment, expiry, audience, and thread access.
-- Remove legacy snapshots from raw rows as well as RPC results: participants can
-- otherwise select their own message rows directly through RLS.
update public.messages
   set meta=coalesce(meta,'{}'::jsonb) - array['momentKind','momentBody','momentMedia','momentStyle']::text[]
 where kind='moment_reply'
   and coalesce(meta,'{}'::jsonb) ?| array['momentKind','momentBody','momentMedia','momentStyle'];
update public.notifications set body='' where kind='moment_reply' and body<>'';

create or replace function public.reply_to_moment(p_moment_id bigint,p_body text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); m public.moments; reason text; conv_id bigint; clean_body text:=coalesce(p_body,'');
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into m from public.moments where id=p_moment_id;
  if not found or m.expires_at<=public.now_ms() or not public.can_view_moment(m,me) then
    perform public.crushly_fail(404,'','This Moment isn’t available.'); end if;
  if m.user_id=me then perform public.crushly_fail(400,'','You can’t reply to your own Moment.'); end if;
  if btrim(clean_body)='' then perform public.crushly_fail(400,'','Write a reply first.'); end if;
  clean_body:=left(clean_body,1000);
  reason:=public.messaging_block_reason(me,m.user_id);
  if reason is not null then perform public.crushly_fail(403,'messaging_restricted',reason); end if;
  conv_id:=public.ensure_conversation(me,m.user_id);
  insert into public.messages(conversation_id,sender_id,kind,body,meta)
    values(conv_id,me,'moment_reply',clean_body,jsonb_build_object('momentId',m.id));
  update public.conversations set last_message_at=public.now_ms() where id=conv_id;
  perform public.notify_to(m.user_id,'moment_reply',me,conv_id,'');
  return jsonb_build_object('conversationId',conv_id);
end $$;

create or replace function public.whisper_moment_target(p_message_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); msg public.messages; conv public.conversations; mo public.moments; raw_id text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into msg from public.messages where id=p_message_id and kind='moment_reply'
    and not exists(select 1 from public.hidden_whispers h where h.message_id=p_message_id and h.user_id=me);
  if not found then return null; end if;
  select * into conv from public.conversations where id=msg.conversation_id;
  if not found or (conv.user_a<>me and conv.user_b<>me) or public.is_blocked_pair(conv.user_a,conv.user_b) then return null; end if;
  raw_id:=msg.meta->>'momentId';
  if raw_id is null or raw_id !~ '^[1-9][0-9]{0,17}$' then return null; end if;
  select * into mo from public.moments where id=raw_id::bigint;
  if not found or mo.expires_at<=public.now_ms() or mo.user_id=msg.sender_id
     or mo.user_id not in (conv.user_a,conv.user_b) or not public.can_view_moment(mo,me) then return null; end if;
  return jsonb_build_object('momentId',mo.id,'userId',mo.user_id,'mine',mo.user_id=me);
end $$;
revoke all on function public.whisper_moment_target(bigint) from public,anon,authenticated;
grant execute on function public.whisper_moment_target(bigint) to authenticated,service_role;
notify pgrst,'reload schema';
