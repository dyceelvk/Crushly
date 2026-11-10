-- Synthetic tests; disposable DB only. Run after candidates 01,04,12,13,19.
begin;
do $test$
declare a bigint; b bigint; z bigint; au uuid; bu uuid; zu uuid; c bigint; m1 bigint; m2 bigint; m3 bigint; path text; v jsonb; failed boolean;
begin
 select id,auth_user_id into a,au from public.profiles where name='Daniel';
 select id,auth_user_id into b,bu from public.profiles where name='Ryan';
 select id,auth_user_id into z,zu from public.profiles where name='Jayden';
 update public.profiles set onboarded=true,status='active' where id in(a,b,z);
 update public.privacy set profile_visibility='everyone',incognito=false,holup_whisper_open=false where user_id in(a,b,z);
 delete from public.blocks where blocker_id in(a,b,z) and blocked_id in(a,b,z);
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 c:=(public.open_conversation(b)->>'id')::bigint;
 m1:=(public.send_message(c,'text','private sample')->>'id')::bigint;
 path:='messages/'||a||'/fixture.jpg';
 m2:=(public.send_message(c,'photo','',path,'{}')->>'id')::bigint;
 perform set_config('request.jwt.claim.sub',bu::text,true);
 assert (public.can_view_media(path,null)->>'allowed')::boolean, 'recipient sees photo before hiding';
 failed:=false; begin perform public.holup_delete_whisper(m1,true); exception when others then failed:=true; end;
 assert failed, 'recipient cannot delete sender message for everyone';
 assert public.holup_delete_whisper(m1,false);
 assert public.holup_delete_whisper(m2,false);
 assert cardinality(public.holup_visible_whisper_ids(c,array[m1,m2]))=0, 'hidden ids must be removed from device';
 assert jsonb_array_length(public.get_messages(c)->'items')=0, 'hidden messages must disappear';
 assert jsonb_array_length(public.get_messages(c,0,m2+1,1)->'items')=0, 'before pagination must respect hiding';
 assert jsonb_array_length(public.get_messages(c,m1-1,0,1)->'items')=0, 'after pagination must respect hiding';
 assert (public.can_view_media(path,null)->>'allowed')::boolean=false, 'hidden photo access denied';
 assert (public.badges()->>'messages')::int=0, 'hidden unread messages not counted';
 v:=public.list_conversations();
 assert exists(select 1 from jsonb_array_elements(v->'items') x where (x->>'id')::bigint=c and x->'lastMessage'='null'::jsonb and (x->>'unread')::int=0), 'list must not leak hidden messages';
 failed:=false; begin perform public.toggle_message_reaction(m1,'crush'); exception when others then failed:=true; end;
 assert failed, 'hidden messages cannot be reacted to';
 perform set_config('request.jwt.claim.sub',au::text,true);
 assert jsonb_array_length(public.get_messages(c)->'items')=2, 'hiding affects one member only';
 assert cardinality(public.holup_visible_whisper_ids(c,array[m1,m2]))=2, 'other member still sees both ids';
 assert (public.can_view_media(path,null)->>'allowed')::boolean, 'sender retains photo access';
 -- Deletion must never restore the two-message request allowance.
 assert public.holup_delete_whisper(m1,false);
 failed:=false; begin perform public.send_message(c,'text','third attempt'); exception when others then failed:=true; end;
 assert failed, 'deleting for me must not reset the request quota';
 perform set_config('request.jwt.claim.sub',zu::text,true);
 failed:=false; begin perform public.holup_delete_whisper(m1,false); exception when others then failed:=true; end;
 assert failed, 'outsider cannot hide or delete';
 perform set_config('request.jwt.claim.sub',bu::text,true);
 -- Replying accepts; a malicious request may refer to a hidden message, but
 -- serialization must not expose its text to the member who hid it.
 m3:=(public.send_message(c,'text','reply',null,jsonb_build_object('replyTo',jsonb_build_object('id',m1)))->>'id')::bigint;
 v:=public.get_messages(c);
 assert not ((v->'items'->0->'meta') ? 'replyTo'), 'hidden reply quote leaks content';
 perform set_config('request.jwt.claim.sub',au::text,true);
 assert public.holup_delete_whisper(m1,true);
 v:=public.get_messages(c);
 assert not exists(select 1 from jsonb_array_elements(v->'items') x where (x->>'id')::bigint=m1), 'delete everyone leaves message visible';
 assert not exists(select 1 from jsonb_array_elements(v->'items') x where (x->'meta') ? 'replyTo'), 'stored quote survives deletion';
 assert public.holup_delete_whisper(m2,true);
 assert not (public.can_view_media(path,null)->>'allowed')::boolean, 'deleted photo no longer authorized';
 raise notice 'Whisper deletion isolation tests passed';
end $test$;
rollback;
