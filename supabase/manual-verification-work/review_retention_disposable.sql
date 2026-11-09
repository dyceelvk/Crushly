-- Isolated database only. Does not establish physical object/backup deletion.
begin;
do $review$
declare a uuid:=gen_random_uuid(); aid bigint; c bigint; fid uuid; abandoned uuid; path text; result jsonb; denied boolean; changed integer;
begin
 insert into auth.users(id,email) values(a,'review-retention@example.invalid');
 select id into aid from public.profiles where auth_user_id=a;
 insert into public.manual_verification_cases(member_id,kind,criteria_snapshot) values(aid,'creator','{}') returning id into c;
 set local role service_role;
 result:=public.manual_evidence_reserve(c,a,'image/jpeg'); fid:=(result->>'id')::uuid; path:=result->>'path';
 perform public.manual_evidence_finish(fid,a,true);
 result:=public.manual_evidence_reserve(c,a,'image/jpeg'); abandoned:=(result->>'id')::uuid;
 reset role;
 update public.manual_verification_files set created_at=public.now_ms()-86400001 where id=abandoned;
 update public.manual_verification_cases set status='rejected',decided_at=public.now_ms()-2592000000+60000 where id=c;
 set local role service_role;
 result:=public.manual_evidence_authorize(fid,a); assert result->>'path'=path,'review image expired too early';
 changed:=public.manual_evidence_expire(100); assert changed=1,'abandoned reservation not queued';
 reset role;
 update public.manual_verification_cases set decided_at=public.now_ms()-2592000000-1000 where id=c;
 set local role service_role;
 denied:=false; begin perform public.manual_evidence_authorize(fid,a); exception when insufficient_privilege then denied:=true; end; assert denied,'30-day image remained accessible';
 changed:=public.manual_evidence_expire(100); assert changed=1,'expired image not queued';
 reset role;
 assert exists(select 1 from public.manual_verification_file_deletions q where q.storage_path=path),'expired image not in deletion queue';
 raise notice 'Isolated 30-day access cutoff and queue review passed';
end $review$;
rollback;
