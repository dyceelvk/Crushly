-- Synthetic fixture for disposable Postgres ONLY. Exercises the public RPCs,
-- not direct message inserts. A completed run does not prove hosted Realtime.
begin;
do $test$
declare au uuid; bu uuid; cu uuid; a bigint; b bigint; c bigint; conv bigint; conv2 bigint; conv3 bigint;
 r jsonb; s jsonb; failed boolean; token text; mid bigint;
begin
 select id into au from auth.users where email='marcus@crushly.app';
 select id into bu from auth.users where email='daniel@crushly.app';
 select id into cu from auth.users where email='tobi@crushly.app';
 select id into a from public.profiles where auth_user_id=au;
 select id into b from public.profiles where auth_user_id=bu;
 select id into c from public.profiles where auth_user_id=cu;
 assert a is not null and b is not null and c is not null;
 assert not exists(select 1 from public.conversations), 'reset must remove old conversations';
 update public.profiles set onboarded=true,status='active' where id in(a,b,c);
 update public.privacy set profile_visibility='everyone',incognito=false,holup_whisper_open=false where user_id in(a,b,c);
 delete from public.blocks where blocker_id in(a,b,c) and blocked_id in(a,b,c);
 update public.holup_features set enabled=true where key='calls';

 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 r:=public.open_conversation(b); conv:=(r->>'id')::bigint;
 s:=public.holup_whisper_status(conv); assert s->>'state'='pending' and (s->>'requester')::boolean;
 failed:=false; begin perform public.register_call_room(conv); exception when others then failed:=true; end;
 assert failed, 'pending Whisper must not start a call';
 r:=public.send_message(conv,'text','first'); mid:=(r->>'id')::bigint;
 r:=public.send_message(conv,'text','second');
 s:=public.holup_whisper_status(conv); assert (s->>'sent')::int=2;
 failed:=false; begin perform public.send_message(conv,'text','third'); exception when others then failed:=true; end;
 assert failed, 'sender must be limited to two before acceptance';
 r:=public.open_conversation(b); assert (r->>'id')::bigint=conv, 'quota must not prevent reopening';
 assert jsonb_array_length(public.get_messages(conv)->'items')=2;
 -- Raw receipt rows must not bypass serialized RPC protections.
 assert not has_table_privilege('authenticated','public.messages','select');
 perform set_config('request.jwt.claim.sub',bu::text,true);
 s:=public.holup_whisper_status(conv); assert (s->>'canAccept')::boolean;
 perform public.holup_accept_whisper(conv);
 perform set_config('request.jwt.claim.sub',au::text,true);
 perform public.send_message(conv,'text','third after accept');
 token:=public.register_call_room(conv); assert public.can_join_call(token);
 -- Removing an old relationship must not close this independent Whisper.
 reset role;
 perform public.disconnect_pair(a,b);
 set local role authenticated;
 assert jsonb_array_length(public.get_messages(conv)->'items')=3;
 assert (public.holup_whisper_status(conv)->>'state')='accepted';
 -- A recipient's reply is acceptance without a separate button.
 r:=public.open_conversation(c); conv2:=(r->>'id')::bigint;
 perform public.send_message(conv2,'text','hello');
 perform set_config('request.jwt.claim.sub',cu::text,true);
 perform public.send_message(conv2,'text','reply');
 assert (public.holup_whisper_status(conv2)->>'state')='accepted';
 perform set_config('request.jwt.claim.sub',au::text,true);
 perform public.send_message(conv2,'text','after reply');
 -- The recipient can permit eligible first messages without acceptance, and
 -- changing that setting later does not close a conversation that began open.
 perform set_config('request.jwt.claim.sub',bu::text,true);
 perform public.holup_set_whisper_open(true);
 perform set_config('request.jwt.claim.sub',cu::text,true);
 r:=public.open_conversation(b); conv3:=(r->>'id')::bigint;
 perform public.send_message(conv3,'text','open first');
 assert (public.holup_whisper_status(conv3)->>'state')='accepted';
 perform set_config('request.jwt.claim.sub',bu::text,true);
 perform public.holup_set_whisper_open(false);
 perform set_config('request.jwt.claim.sub',cu::text,true);
 perform public.send_message(conv3,'text','open second');
 perform public.send_message(conv3,'text','open third');
 assert (public.holup_whisper_status(conv3)->>'state')='accepted';
 -- A legacy "everyone" choice must never silently opt in to auto-accept.
 reset role;
 update public.privacy set who_can_message='everyone' where user_id=b;
 assert not (select holup_whisper_open from public.privacy where user_id=b);
 set local role authenticated;
 -- Block closes messaging and call auth. Two-way checks still apply.
 perform set_config('request.jwt.claim.sub',bu::text,true);
 perform public.block_member(a);
 perform set_config('request.jwt.claim.sub',au::text,true);
 failed:=false; begin perform public.send_message(conv,'text','blocked'); exception when others then failed:=true; end;
 assert failed, 'blocked member must not send';
 assert not public.can_join_call(token), 'blocked member must not join calls';
 failed:=false; begin perform public.get_messages(conv); exception when others then failed:=true; end;
 assert failed, 'blocked member must not fetch messages';
 failed:=false; begin perform public.mark_conversation_read(conv); exception when others then failed:=true; end;
 assert failed, 'blocked member must not send read acknowledgements';
 raise notice 'reset Whisper public RPC checks passed';
end $test$;
rollback;
