-- Destructive disposable DB only; run after 01, 04 and 08.
begin;
do $test$
declare own bigint:=4; friend bigint:=5; one_sided bigint:=6; ou uuid; fu uuid; su uuid; po public.posts; mo public.moments; cv bigint; denied boolean; r jsonb;
begin
 select auth_user_id into ou from profiles where id=own; select auth_user_id into fu from profiles where id=friend; select auth_user_id into su from profiles where id=one_sided;
 delete from blocks where blocker_id in (own,friend,one_sided) and blocked_id in (own,friend,one_sided);
 delete from keeps where keeper_id in (own,friend,one_sided) and kept_id in (own,friend,one_sided);
 delete from connections where user_a in (own,friend,one_sided) and user_b in (own,friend,one_sided);
 delete from crushes where from_id in (own,friend,one_sided) and to_id in (own,friend,one_sided);
 delete from conversations where user_a=least(own,friend) and user_b=greatest(own,friend);
 update privacy set profile_visibility='everyone',incognito=false,add_up_list_visibility='close',v3_whisper_open=false where user_id in (own,friend,one_sided);
 insert into keeps(keeper_id,kept_id) values(friend,own),(one_sided,own);
 insert into crushes(from_id,to_id,status) values(friend,own,'accepted'),(one_sided,own,'pending');
 insert into posts(author_id,body,audience) values(own,'Close post','connections') returning * into po;
 insert into moments(user_id,kind,body,audience,created_at,expires_at) values(own,'text','Close Moment','connections',public.now_ms(),public.now_ms()+3600000) returning * into mo;
 assert not public.is_connected_pair(own,friend), 'one-sided Keep became a connection';
 assert not public.can_view_post(po,friend) and not public.can_view_moment(mo,friend), 'one-sided Keep opened Close content';
 perform set_config('request.jwt.claim.sub',fu::text,true); set local role authenticated;
 r:=public.space_relationship_stats(own);
 assert (r->>'keptClose')::int=2 and not (r->>'canViewKeptClose')::boolean and not (r->>'canViewAddUps')::boolean, 'incoming count or one-way list permission wrong';
 denied:=false; begin perform public.space_relationship_people(own,'addUps'); exception when sqlstate 'P0001' then denied:=true; end; assert denied;
 denied:=false; begin perform public.space_relationship_people(own,'keptClose'); exception when sqlstate 'P0001' then denied:=true; end; assert denied;
 -- Independent Whisper may start before becoming Close Ones.
 cv:=(public.open_conversation(own)->>'id')::bigint; perform public.send_message(cv,'text','Hello',null,'{}');
 reset role;
 -- Reciprocal add creates a connection without an approval step.
 perform set_config('request.jwt.claim.sub',ou::text,true); set local role authenticated;
 r:=public.keep_close(friend); assert (r->>'keeps')::boolean and (r->>'keepsYou')::boolean;
 perform public.send_message(cv,'text','Reply accepts',null,'{}');
 reset role;
 assert public.is_connected_pair(own,friend), 'reciprocal Keep not a connection';
 assert public.can_view_post(po,friend) and public.can_view_moment(mo,friend), 'mutual Close Ones denied Close content';
 perform set_config('request.jwt.claim.sub',fu::text,true); set local role authenticated;
 r:=public.space_relationship_stats(own);
 assert (r->>'canViewAddUps')::boolean and (r->>'canViewKeptClose')::boolean and (r->>'keptClose')::int=2;
 assert jsonb_array_length(public.space_relationship_people(own,'addUps')->'items')=2;
 assert jsonb_array_length(public.space_relationship_people(own,'keptClose')->'items')=2, 'list must contain incoming adds, not only mutuals';
 reset role;
 -- Even an old Add Up in either direction cannot expose a private Space.
 update privacy set profile_visibility='connections' where user_id=own;
 insert into crushes(from_id,to_id,status) values(own,one_sided,'accepted');
 perform set_config('request.jwt.claim.sub',su::text,true); set local role authenticated;
 assert public.load_profile(own) is null, 'historical Add Up exposed a Close-only Space';
 reset role;
 perform set_config('request.jwt.claim.sub',fu::text,true); set local role authenticated;
 assert public.load_profile(own) is not null, 'mutual Close One could not see Space';
 denied:=false; begin perform public.remove_connection(own); exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__409__upgrade_required%'; end; assert denied, 'legacy removal did not fail closed';
 denied:=false; begin perform public.accept_connection_request(own); exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__409__upgrade_required%'; end; assert denied, 'legacy acceptance did not fail closed';
 denied:=false; begin perform public.decline_connection_request(own); exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__409__upgrade_required%'; end; assert denied, 'legacy decline did not fail closed';
 denied:=false; begin perform public.cancel_connection_request(own); exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__409__upgrade_required%'; end; assert denied, 'legacy cancellation did not fail closed';
 assert public.let_go(own), 'one-sided legacy removal failed';
 -- Ending a Close connection must never close the independent accepted Whisper.
 assert jsonb_array_length(public.get_messages(cv)->'items')=2, 'accepted Whisper lost after Close ended';
 perform public.send_message(cv,'text','Still open',null,'{}');
 reset role;
 assert not public.is_connected_pair(own,friend), 'connection survived one-sided removal';
 assert not public.can_view_post(po,friend) and not public.can_view_moment(mo,friend), 'Close content remained after removal';
 perform set_config('request.jwt.claim.sub',fu::text,true); set local role authenticated;
 assert public.load_profile(own) is null, 'Close-only Space remained visible after removal';
 reset role;
 raise notice 'mutual Close audience and independent Whisper tests passed';
end $test$;
rollback;
