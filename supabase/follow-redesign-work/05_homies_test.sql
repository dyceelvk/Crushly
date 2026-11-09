-- Disposable database only; run after fixture + 04_homies_candidate.sql.
begin;
do $test$
declare au uuid; bu uuid; cu uuid; a bigint; b bigint; c bigint; r jsonb; denied boolean; conversations_before bigint;
begin
 select id into au from auth.users where email='marcus@crushly.app';
 select id into bu from auth.users where email='daniel@crushly.app';
 select id into cu from auth.users where email='tobi@crushly.app';
 select id into a from profiles where auth_user_id=au;
 select id into b from profiles where auth_user_id=bu;
 select id into c from profiles where auth_user_id=cu;
 assert holup_homie_pair(a,b), 'grandfathered accepted connection lost';
 assert not holup_homie_pair(a,c), 'legacy Keep wrongly treated as consent';
 assert exists(select 1 from holup_homie_requests where sender_id=a and recipient_id=c and status='pending');
 assert exists(select 1 from holup_homie_requests where sender_id=c and recipient_id=a and status='pending');
 assert not exists(select 1 from holup_homie_requests where sender_id=a and recipient_id=b);
 -- Counts are visible on an authorized Space, identities require accepted Homie.
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 r:=holup_homie_stats(a); assert (r->>'count')::int>=1 and not (r->>'canView')::boolean;
 denied:=false; begin perform holup_homie_people(a); exception when others then denied:=true; end; assert denied;
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 assert (holup_homie_stats(a)->>'canView')::boolean;
 assert jsonb_array_length(holup_homie_people(a)->'items')>=1;
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 assert (holup_homie_stats(a)->>'canView')::boolean;
 assert jsonb_array_length(holup_homie_people(a)->'items')>=1;
 reset role;
 select count(*) into conversations_before from conversations where user_a=least(a,c) and user_b=greatest(a,c);
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 r:=holup_homie_status(c); assert (r->>'outgoingPending')::boolean and (r->>'incomingPending')::boolean and not (r->>'homies')::boolean;
 assert holup_request_homie(c)->>'status'='pending';
 -- A sender cannot accept their own request.
 denied:=false; begin perform holup_respond_homie(b,true); exception when others then denied:=true; end; assert denied;
 assert holup_withdraw_homie(c);
 r:=holup_homie_status(c); assert not (r->>'outgoingPending')::boolean and (r->>'incomingPending')::boolean;
 -- Accept the other person's explicit request. Reciprocal requests alone did not consent.
 assert holup_respond_homie(c,true)->>'status'='accepted';
 r:=holup_homie_status(c); assert (r->>'homies')::boolean and not (r->>'incomingPending')::boolean and not (r->>'outgoingPending')::boolean;
 assert holup_request_homie(c)->>'status'='accepted';
 perform holup_withdraw_homie(c);
 assert (holup_homie_status(c)->>'homies')::boolean, 'withdraw removed accepted friendship';
 reset role;
 assert (select count(*) from conversations where user_a=least(a,c) and user_b=greatest(a,c))=conversations_before, 'Homie action changed Whispers';
 -- Only a safety block removes an accepted friendship; unblocking does not reinstate it.
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 perform block_member(c); perform unblock_member(c);
 reset role;
 assert not holup_homie_pair(a,c);
 assert not exists(select 1 from holup_homie_requests where sender_id in (a,c) and recipient_id in (a,c));
 -- A fresh request requires recipient consent; rejected request is rate-limited.
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 assert holup_request_homie(a)->>'status'='pending';
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 assert holup_respond_homie(c,false)->>'status'='declined';
 reset role;
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 denied:=false; begin perform holup_request_homie(a); exception when others then denied:=true; end; assert denied;
 reset role;
 assert not holup_homie_pair(a,c);
 assert not has_table_privilege('authenticated','public.holup_homies','select');
 assert not has_table_privilege('authenticated','public.holup_homie_requests','select');
 assert not has_table_privilege('authenticated','public.holup_homies','delete');
 assert not has_function_privilege('anon','public.holup_request_homie(bigint)','execute');
 raise notice 'isolated Homies migration and consent tests passed';
end $test$;
rollback;
