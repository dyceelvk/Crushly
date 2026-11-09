begin;
do $test$
declare au uuid; bu uuid; cu uuid; a bigint; b bigint; c bigint; r jsonb; denied boolean; before_conversations bigint;
begin
 select id into au from auth.users where email='marcus@crushly.app';
 select id into bu from auth.users where email='daniel@crushly.app';
 select id into cu from auth.users where email='tobi@crushly.app';
 select id into a from profiles where auth_user_id=au;
 select id into b from profiles where auth_user_id=bu;
 select id into c from profiles where auth_user_id=cu;
 assert a is not null and b is not null and c is not null;
 update profiles set onboarded=true,status='active' where id in (a,b,c);
 update privacy set profile_visibility='everyone',incognito=false,who_can_crush='everyone',add_up_list_visibility='private' where user_id in (a,b,c);
 delete from blocks where blocker_id in (a,b,c) and blocked_id in (a,b,c);
 delete from holup_follows where follower_id in (a,b,c) or followed_id in (a,b,c);
 delete from holup_follow_settings where user_id in (a,b,c);
 delete from holup_existing_close_pairs where user_a in(a,b,c) or user_b in(a,b,c);
 delete from connections where user_a in(a,b,c) or user_b in(a,b,c);
 select count(*) into before_conversations from conversations where user_a=least(a,b) and user_b=greatest(a,b);
 -- Follows default to immediate, and create neither a friendship nor Whisper.
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 assert holup_follow_status(b)->>'status' is null;
 r:=holup_follow(b); assert r->>'status'='active' and (r->>'changed')::boolean;
 assert holup_follow_status(b)->>'status'='active';
 r:=holup_follow(b); assert r->>'status'='active' and not (r->>'changed')::boolean;
 assert (holup_follow_stats(a)->>'addedUp')::int=1;
 assert jsonb_array_length(holup_follow_people(a,'addedUp')->'items')=1;
 reset role;
 assert not exists(select 1 from connections where user_a=least(a,b) and user_b=greatest(a,b));
 assert (select count(*) from conversations where user_a=least(a,b) and user_b=greatest(a,b))=before_conversations;
 -- Default private outgoing list hides identities but not total.
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 r:=holup_follow_stats(a); assert (r->>'addedUp')::int=1 and not (r->>'canViewAddedUp')::boolean;
 denied:=false; begin perform holup_follow_people(a,'addedUp'); exception when others then denied:=true; end; assert denied;
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 perform holup_set_follow_settings(true,'everyone');
 reset role;
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 assert (holup_follow_stats(a)->>'canViewAddedUp')::boolean;
 assert jsonb_array_length(holup_follow_people(a,'addedUp')->'items')=1;
 r:=holup_follow(a); assert r->>'status'='pending';
 assert (holup_follow_stats(a)->>'addUps')::int=0, 'pending is not an approved follow';
 denied:=false; begin perform holup_respond_follow(a,true); exception when others then denied:=true; end; assert denied, 'sender accepted own request';
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 assert jsonb_array_length(holup_pending_follow_requests()->'items')=1;
 assert (holup_respond_follow(c,true)->>'status')='active';
 assert jsonb_array_length(holup_pending_follow_requests()->'items')=0;
 assert (holup_follow_stats(a)->>'addUps')::int=1;
 reset role;
 -- Blocks delete both directions; unblocking cannot silently restore either.
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 perform block_member(c); perform unblock_member(c);
 reset role;
 assert not exists(select 1 from holup_follows where (follower_id=a and followed_id=c) or (follower_id=c and followed_id=a));
 -- Private individual member remains hidden even in a public list.
 update privacy set profile_visibility='connections' where user_id=b;
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 assert jsonb_array_length(holup_follow_people(a,'addedUp')->'items')=0, 'private identity leaked';
 denied:=false; begin perform holup_follow_status(b); exception when others then denied:=true; end; assert denied, 'private Space status leaked';
 reset role;
 -- No raw reads/writes and no anonymous execution.
 assert not has_table_privilege('authenticated','public.holup_follows','select');
 assert not has_table_privilege('authenticated','public.holup_follows','insert');
 assert not has_function_privilege('anon','public.holup_follow(bigint)','execute');
 assert not has_function_privilege('anon','public.holup_follow_status(bigint)','execute');
 raise notice 'isolated follow tests passed';
end $test$;
rollback;
