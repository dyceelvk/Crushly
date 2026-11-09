begin;
do $test$
declare au uuid; vu uuid; aid bigint; vid bigint; rid bigint; denied boolean; result jsonb;
begin
 select id into au from auth.users where email='marcus@crushly.app';
 select id into vu from auth.users where email='daniel@crushly.app';
 select id into aid from public.profiles where auth_user_id=au;
 select id into vid from public.profiles where auth_user_id=vu;
 insert into public.holup_admins(auth_user_id) values(au) on conflict do nothing;
 insert into public.reports(reporter_id,reported_id,reason,details,context) values(vid,aid,'other','synthetic report','profile') returning id into rid;
 perform set_config('request.jwt.claim.sub',vu::text,true); set local role authenticated;
 denied:=false; begin perform public.holup_admin_reports(false,50,0); exception when others then denied:=true; end; assert denied,'non-admin read reports';
 denied:=false; begin perform public.holup_admin_accounts('Marcus',30); exception when others then denied:=true; end; assert denied,'non-admin searched accounts';
 denied:=false; begin perform public.holup_admin_set_report_handled(rid,true); exception when others then denied:=true; end; assert denied,'non-admin altered reports';
 denied:=false; begin perform public.holup_admin_analytics(); exception when others then denied:=true; end; assert denied,'non-admin read analytics';
 denied:=false; begin perform public.holup_admin_audit(50); exception when others then denied:=true; end; assert denied,'non-admin read audit';
 perform set_config('request.jwt.claim.sub',au::text,true);
 result:=public.holup_admin_analytics(); assert result ? 'members' and result ? 'seenLast7Days' and result ? 'whispersLast7Days', 'analytics missing data';
 result:=public.holup_admin_reports(false,50,0); assert exists(select 1 from jsonb_array_elements(result) item where (item->>'id')::bigint=rid), 'admin cannot see report';
 assert public.holup_admin_set_report_handled(rid,true),'admin cannot mark report';
 result:=public.holup_admin_reports(true,50,0); assert exists(select 1 from jsonb_array_elements(result) item where (item->>'id')::bigint=rid), 'reviewed report missing';
 result:=public.holup_admin_accounts('Marcus',30); assert jsonb_array_length(result)>0,'admin cannot search';
 result:=public.holup_admin_audit(50); assert exists(select 1 from jsonb_array_elements(result) item where item->>'kind'='report_status'), 'report action not audited';
 reset role;
end $test$;
rollback;
