-- DISPOSABLE EXPERIMENT ONLY. Requires 01, 04 and 12; never deploy alone.
-- Connect the independent consent guard to legacy RPC entry points. More work
-- remains for UI, receipt privacy, media access, old clients and realtime.
begin;

-- A relationship change is not a Whisper deletion. Block inserts already run
-- the block cleanup trigger, which closes the conversation independently.
create or replace function public.disconnect_pair(a bigint,b bigint) returns void
language sql security definer set search_path=public as $$
 delete from public.connections where user_a=least(a,b) and user_b=greatest(a,b);
 delete from public.crushes where (from_id=a and to_id=b) or (from_id=b and to_id=a);
$$;

-- The existing open and Moment reply RPCs use this helper. A fresh request and
-- its durable counter must be established before either path can insert.
create or replace function public.ensure_conversation(a bigint,b bigint) returns bigint
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); peer bigint; r jsonb;
begin
 if me is null or a is null or b is null or a=b or me not in (a,b) then
  perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 peer:=case when a=me then b else a end;
 r:=public.holup_begin_whisper_request(peer);
 return (r->>'id')::bigint;
end $$;

-- Opening a pending, quota-exhausted thread must still show its history. The
-- sender simply cannot send again until acceptance.
create or replace function public.open_conversation(p_target_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); r jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target_id is null or p_target_id<=0 then perform public.crushly_fail(400,'','Who would you like to message?'); end if;
 r:=public.holup_begin_whisper_request(p_target_id);
 return jsonb_build_object('id',(r->>'id')::bigint,'peer',public.peer_summary(p_target_id,me));
end $$;

-- Messaging eligibility is independent of old connections/follows. An open
-- request has its own per-conversation consent and durable two-message quota.
create or replace function public.messaging_block_reason(p_viewer bigint,p_target bigint) returns text
language plpgsql stable security definer set search_path=public as $$
declare p public.holup_whisper_permissions; c public.conversations;
begin
 if p_viewer is null or p_target is null or p_viewer=p_target then return 'You can''t message yourself.'; end if;
 if public.is_blocked_pair(p_viewer,p_target) then return 'This member is no longer available.'; end if;
 if not exists(select 1 from public.profiles where id=p_target and onboarded and status='active') then return 'This member is no longer available.'; end if;
 select * into c from public.conversations where user_a=least(p_viewer,p_target) and user_b=greatest(p_viewer,p_target);
 if not found then return null; end if;
 select * into p from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or c.closed or p.state in ('declined','blocked') then return 'This Whisper is not available.'; end if;
 if p.state='pending' and p.requester_id=p_viewer and p.request_messages>=2 then
   return 'Wait for this Whisper request to be accepted.'; end if;
 return null;
end $$;

create or replace function public.holup_whisper_status(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; p public.holup_whisper_permissions;
begin
 select * into c from public.conversations where id=p_conversation_id;
 if me is null or not found or me not in(c.user_a,c.user_b) or c.closed or public.is_blocked_pair(c.user_a,c.user_b) then
  perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 select * into p from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or p.state in ('declined','blocked') then perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 return jsonb_build_object('state',p.state,'requester',p.requester_id=me,'sent',p.request_messages,
  'canAccept',p.state='pending' and p.recipient_id=me and p.request_messages>0);
end $$;
revoke all on function public.holup_whisper_status(bigint) from public,anon,authenticated;
grant execute on function public.holup_whisper_status(bigint) to authenticated,service_role;

-- Existing clients continue to receive their established detail fields. New
-- clients additionally receive explicit request/acceptance state.
create or replace function public.load_conversation(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; peer bigint; reason text; consent jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) or c.closed or public.is_blocked_pair(c.user_a,c.user_b) then
  perform public.crushly_fail(404,'','Conversation not found.'); end if;
 peer:=case when c.user_a=me then c.user_b else c.user_a end;
 consent:=public.holup_whisper_status(c.id);
 reason:=public.messaging_block_reason(me,peer);
 return jsonb_build_object('id',c.id,'closed',false,'peer',public.peer_summary(peer,me),
   'canSend',reason is null,'blockReason',reason,'whisperConsent',consent);
end $$;

-- Read acknowledgements are also signals: a blocked or closed peer must not
-- receive one, even if an old client still calls the legacy RPC.
create or replace function public.mark_conversation_read(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in(c.user_a,c.user_b) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into c from public.conversations where id=p_conversation_id;
 if not found or c.closed or public.is_blocked_pair(c.user_a,c.user_b) or not exists
   (select 1 from public.holup_whisper_permissions p where p.conversation_id=c.id and p.state in ('pending','accepted')) then
   perform public.crushly_fail(404,'','Conversation not found.'); end if;
 update public.messages set delivered_at=coalesce(delivered_at,public.now_ms())
  where conversation_id=c.id and sender_id<>me and delivered_at is null;
 update public.messages set read_at=public.now_ms() where conversation_id=c.id and sender_id<>me and read_at is null;
 update public.notifications set read_at=public.now_ms() where user_id=me and kind='message' and ref_id=c.id and read_at is null;
 return true;
end $$;

-- Calls are never permitted for a pending request, including the direct call
-- registration RPC and the Realtime call-channel authorizer.
create or replace function public.register_call_room(p_conversation_id bigint) returns text
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; peer bigint; token text:='call-'||replace(gen_random_uuid()::text,'-','');
begin
 if me is null then perform public.crushly_fail(401,'','Sign in again to make calls.'); end if;
 if not public.holup_feature_enabled('calls') then perform public.crushly_fail(403,'disabled','Calls are currently unavailable.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in(c.user_a,c.user_b) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into c from public.conversations where id=p_conversation_id;
 peer:=case when c.user_a=me then c.user_b else c.user_a end;
 if c.closed or public.is_blocked_pair(me,peer) or not exists(select 1 from public.holup_whisper_permissions p where p.conversation_id=c.id and p.state='accepted') then
  perform public.crushly_fail(403,'','Calling requires an accepted Whisper.'); end if;
 perform pg_advisory_xact_lock(me);
 if (select count(*) from public.call_rooms where caller_id=me and created_at>public.now_ms()-60000)>=5 then
  perform public.crushly_fail(429,'','Too many calls. Wait a minute and try again.'); end if;
 delete from public.call_rooms where expires_at<public.now_ms()-86400000;
 insert into public.call_rooms(channel,conversation_id,caller_id,callee_id) values(token,c.id,me,peer);
 return token;
end $$;
create or replace function public.can_join_call(p_channel text) returns boolean
language sql stable security definer set search_path=public as $$
 select public.holup_feature_enabled('calls') and exists (
  select 1 from public.call_rooms r join public.conversations c on c.id=r.conversation_id
  join public.holup_whisper_permissions p on p.conversation_id=c.id and p.state='accepted'
  where r.channel=p_channel and r.expires_at>public.now_ms() and r.closed_at is null
    and public.me_id() in (r.caller_id,r.callee_id) and not c.closed
    and not public.is_blocked_pair(c.user_a,c.user_b));
$$;

-- Preserve reaction RLS without exposing raw messages merely to evaluate it.
create or replace function public.holup_can_see_whisper_reaction(p_message_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
  join public.holup_whisper_permissions p on p.conversation_id=c.id
  where m.id=p_message_id and public.me_id() in(c.user_a,c.user_b) and not c.closed
  and p.state in ('pending','accepted') and not public.is_blocked_pair(c.user_a,c.user_b));
$$;
revoke all on function public.holup_can_see_whisper_reaction(bigint) from public,anon;
grant execute on function public.holup_can_see_whisper_reaction(bigint) to authenticated;
alter policy message_reactions_pair on public.message_reactions using (public.holup_can_see_whisper_reaction(message_id));

-- Raw message rows reveal receipt metadata even when the other person disabled
-- receipts. Current app uses the guarded get_messages RPC and private signals;
-- old binary and hosted Realtime compatibility still must be validated.
revoke select on public.messages from public,anon,authenticated;
commit;
