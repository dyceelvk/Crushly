-- Disposable-only experiment. Cached Realtime authorizations cannot be revoked
-- per message. For NEW conversations, deny new private Whisper/call channels
-- and use guarded HTTP polling until revocable live signaling is implemented.
-- This does NOT terminate pre-existing sockets: the cutover needs a verified
-- Realtime drain/restart or a bounded and verified expiration strategy.
begin;
create or replace function public.can_join_whisper(p_topic text) returns boolean
language sql stable security definer set search_path=public as $$ select false $$;
create or replace function public.can_join_call(p_channel text) returns boolean
language sql stable security definer set search_path=public as $$ select false $$;
create or replace function public.register_call_room(p_conversation_id bigint) returns text
language plpgsql security definer set search_path=public as $$
begin
 if public.me_id() is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 perform public.crushly_fail(503,'temporarily_unavailable','Calling is temporarily unavailable.');
 return null;
end $$;
commit;
