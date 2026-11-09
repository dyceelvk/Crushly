-- Ephemeral Moment references inside Whispers; disposable database only.
begin;
do $test$
declare owner_uuid uuid; reply_uuid uuid; third_uuid uuid; owner_id bigint; reply_id bigint; third_id bigint;
  mid bigint; cid bigint; msgid bigint; r jsonb; denied boolean;
begin
  select id into owner_uuid from auth.users where email='marcus@crushly.app';
  select id into reply_uuid from auth.users where email='daniel@crushly.app';
  select id into third_uuid from auth.users where email='tobi@crushly.app';
  select id into owner_id from profiles where auth_user_id=owner_uuid;
  select id into reply_id from profiles where auth_user_id=reply_uuid;
  select id into third_id from profiles where auth_user_id=third_uuid;
  assert owner_id is not null and reply_id is not null and third_id is not null;
  delete from blocks where blocker_id in (owner_id,reply_id,third_id) and blocked_id in (owner_id,reply_id,third_id);
  update profiles set onboarded=true,status='active' where id in(owner_id,reply_id,third_id);
  update privacy set profile_visibility='everyone', incognito=false where user_id in(owner_id,reply_id,third_id);
  perform public.connect_pair(owner_id,reply_id);
  insert into moments(user_id,kind,body,audience,created_at,expires_at) values(owner_id,'text','private moment words','connections',now_ms(),now_ms()+3600000) returning id into mid;
  perform set_config('request.jwt.claim.sub',reply_uuid::text,true); set local role authenticated;
  r:=public.reply_to_moment(mid,'Love this'); cid:=(r->>'conversationId')::bigint;
  reset role;
  select id into msgid from messages where conversation_id=cid and kind='moment_reply' and sender_id=reply_id order by id desc limit 1;
  assert msgid is not null;
  assert (select meta = jsonb_build_object('momentId',mid) from messages where id=msgid), 'Moment snapshot retained';
  assert exists(select 1 from notifications where user_id=owner_id and kind='moment_reply' and ref_id=cid and body=''), 'reply notification exposed text';
  perform set_config('request.jwt.claim.sub',reply_uuid::text,true); set local role authenticated;
  r:=public.whisper_moment_target(msgid); assert (r->>'momentId')::bigint=mid and (r->>'userId')::bigint=owner_id and not (r->>'mine')::boolean, 'sender cannot open original';
  reset role;
  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  r:=public.whisper_moment_target(msgid); assert (r->>'momentId')::bigint=mid and (r->>'mine')::boolean, 'owner cannot open own Moment';
  reset role;
  perform set_config('request.jwt.claim.sub',third_uuid::text,true); set local role authenticated;
  assert public.whisper_moment_target(msgid) is null, 'nonparticipant can open message reference';
  denied:=false; begin perform 1 from public.hidden_whispers; exception when insufficient_privilege then denied:=true; end; assert denied, 'hidden-whisper records exposed';
  reset role;
  -- Individual deletion for me prevents the hidden message from resolving.
  insert into public.hidden_whispers(message_id,user_id) values(msgid,reply_id);
  perform set_config('request.jwt.claim.sub',reply_uuid::text,true); set local role authenticated;
  assert public.whisper_moment_target(msgid) is null, 'hidden reply remains openable';
  reset role;
  delete from hidden_whispers where message_id=msgid and user_id=reply_id;
  -- Audience revocation is checked for the sender even if the thread survives.
  delete from connections where user_a=least(owner_id,reply_id) and user_b=greatest(owner_id,reply_id);
  perform set_config('request.jwt.claim.sub',reply_uuid::text,true); set local role authenticated;
  assert public.whisper_moment_target(msgid) is null, 'revoked audience still openable';
  reset role;
  perform public.connect_pair(owner_id,reply_id);
  insert into blocks(blocker_id,blocked_id) values(owner_id,reply_id);
  perform set_config('request.jwt.claim.sub',reply_uuid::text,true); set local role authenticated;
  assert public.whisper_moment_target(msgid) is null, 'blocked pair still openable';
  reset role;
  delete from blocks where blocker_id=owner_id and blocked_id=reply_id;
  -- Even the owner cannot open an expired Moment through an old reply.
  update moments set expires_at=now_ms()-1 where id=mid;
  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  assert public.whisper_moment_target(msgid) is null, 'expired Moment exposed to owner';
  reset role;
  update moments set expires_at=now_ms()+3600000 where id=mid;
  delete from moments where id=mid;
  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  assert public.whisper_moment_target(msgid) is null, 'deleted Moment still openable';
  reset role;
  raise notice 'Whisper Moment links tests passed';
end $test$;
rollback;
