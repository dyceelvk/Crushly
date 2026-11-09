-- Disposable test database, after 01_core.sql and 06_whisper_access.sql.
begin;
do $test$
declare a bigint:=1; b bigint:=2; stranger bigint:=3; au uuid; bu uuid; xu uuid;
  cv bigint; text_id bigint; photo_id bigint; reply_id bigint; moment_id bigint; url text; call_token text; r jsonb; denied boolean;
begin
  select auth_user_id into au from profiles where id=a;
  select auth_user_id into bu from profiles where id=b;
  select auth_user_id into xu from profiles where id=stranger;
  delete from blocks where blocker_id in (a,b,stranger) and blocked_id in (a,b,stranger);
  delete from hidden_whispers where message_id in (select id from messages where conversation_id in (select id from conversations where user_a=least(a,b) and user_b=greatest(a,b)));
  delete from connections where user_a=least(a,b) and user_b=greatest(a,b);
  insert into connections(user_a,user_b) values(least(a,b),greatest(a,b));
  update privacy set profile_visibility='everyone',incognito=false where user_id in (a,b,stranger);
  update holup_features set enabled=true where key='calls';
  insert into moments(user_id,kind,body,audience,created_at,expires_at) values(b,'text','a moment','everyone',now_ms(),now_ms()+3600000) returning id into moment_id;
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  cv:=(public.open_conversation(b)->>'id')::bigint;
  text_id:=(public.send_message(cv,'text','private hello',null,'{}')->>'id')::bigint;
  url:='messages/'||a||'/security-test.jpg';
  photo_id:=(public.send_message(cv,'photo','',url,'{}')->>'id')::bigint;
  perform public.reply_to_moment(moment_id,'moment reply');
  reset role;
  select id into reply_id from messages where conversation_id=cv and kind='moment_reply' and sender_id=a and meta->>'momentId'=moment_id::text order by id desc limit 1;
  assert reply_id is not null;
  perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
  assert public.whisper_thread_allowed(cv) and public.whisper_can_read(text_id);
  assert not has_column_privilege('authenticated','public.messages','read_at','SELECT') and not has_column_privilege('authenticated','public.messages','delivered_at','SELECT'), 'raw receipt columns are exposed';
  denied:=false; begin perform read_at from public.messages where id=text_id; exception when insufficient_privilege then denied:=true; end; assert denied, 'raw read receipt can be queried';
  assert (public.can_view_media(url,url)->>'allowed')::boolean;
  assert public.whisper_moment_target(reply_id) is not null;
  assert jsonb_array_length(public.get_messages(cv,0,0,100)->'items')>=3;
  assert exists(select 1 from messages where id=text_id) and exists(select 1 from conversations where id=cv), 'approved RLS reads denied';
  call_token:=public.register_call_room(cv);
  assert public.can_join_call(call_token), 'approved call unavailable';
  perform public.toggle_message_reaction(text_id,'laugh');
  assert exists(select 1 from message_reactions where message_id=text_id), 'approved reaction hidden';
  perform public.delete_whisper(text_id,false);
  assert not public.whisper_can_read(text_id) and not exists(select 1 from messages where id=text_id), 'hidden message leaked via RLS';
  assert not exists(select 1 from message_reactions where message_id=text_id), 'hidden reaction leaked via RLS';
  perform public.mark_messages_delivered(cv,null);
  perform public.mark_conversation_read(cv);
  reset role;
  assert (select delivered_at is null and read_at is null from messages where id=text_id), 'hidden message acknowledged';
  assert (select delivered_at is not null and read_at is not null from messages where id=photo_id), 'visible message not acknowledged';

  perform set_config('request.jwt.claim.sub',xu::text,true); set local role authenticated;
  assert not public.whisper_thread_allowed(cv) and not public.whisper_can_read(photo_id), 'outsider thread access';
  assert not (public.can_view_media(url,url)->>'allowed')::boolean, 'outsider media access';
  assert public.whisper_moment_target(reply_id) is null;
  assert not exists(select 1 from messages where id=photo_id) and not exists(select 1 from conversations where id=cv), 'outsider direct RLS access';
  denied:=false; begin perform public.peer_presence(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'outsider saw presence';
  reset role;

  -- End relationship, preserving rows while removing every read/interaction path.
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  perform public.let_go(b);
  reset role;
  perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
  assert not public.whisper_thread_allowed(cv) and not public.whisper_can_read(photo_id), 'ended thread open';
  assert not (public.can_view_media(url,url)->>'allowed')::boolean and not (public.can_view_media(url)->>'allowed')::boolean, 'ended thread media leaked';
  assert public.whisper_moment_target(reply_id) is null and not public.can_join_whisper('whisper:'||cv), 'ended thread Moment/realtime leaked';
  assert not public.can_join_call(call_token), 'ended call can still be joined';
  denied:=false; begin perform public.register_call_room(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended call creation allowed';
  assert (public.badges()->>'messages')::int=0, 'ended thread unread badge leaked';
  assert not exists(select 1 from messages where id=photo_id) and not exists(select 1 from conversations where id=cv) and not exists(select 1 from message_reactions where message_id=text_id), 'ended thread direct RLS leaked';
  assert not exists(select 1 from jsonb_array_elements(public.list_conversations()->'items') x where (x->>'id')::bigint=cv), 'ended thread listed';
  denied:=false; begin perform public.get_messages(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended history leaked';
  denied:=false; begin perform public.sync_whispers(cv,array[photo_id]); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended sync leaked';
  denied:=false; begin perform public.load_conversation(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended conversation metadata leaked';
  denied:=false; begin perform public.peer_presence(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended presence leaked';
  denied:=false; begin perform public.mark_messages_delivered(cv,null); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended delivery receipt allowed';
  denied:=false; begin perform public.mark_conversation_read(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended read receipt allowed';
  denied:=false; begin perform public.toggle_message_reaction(photo_id,'laugh'); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'ended reaction allowed';
  -- Removing your own copy is not a contact signal and remains available.
  assert public.delete_whisper(photo_id,false), 'own-copy deletion should remain possible after separation';
  reset role;

  -- History becomes readable only after fresh explicit consent and opening.
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  perform public.keep_close(b);
  reset role;
  perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
  perform public.accept_keep_close(a);
  assert not public.whisper_thread_allowed(cv), 'closed thread reopened without intent';
  perform public.open_conversation(a);
  assert public.whisper_thread_allowed(cv) and public.whisper_moment_target(reply_id) is not null, 'reapproved thread did not reopen';
  assert not public.whisper_can_read(photo_id) and not (public.can_view_media(url,url)->>'allowed')::boolean, 'personal deletion lost on reapproval';
  reset role;

  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  insert into blocks(blocker_id,blocked_id) values(a,b);
  reset role;
  perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
  assert not public.whisper_thread_allowed(cv) and not public.whisper_can_read(reply_id), 'blocked thread leaked';
  denied:=false; begin perform public.mark_conversation_read(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'blocked read receipt allowed';
  denied:=false; begin perform public.peer_presence(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'blocked presence allowed';
  reset role;
  raise notice 'Whisper end-to-end access tests passed';
end $test$;
rollback;
