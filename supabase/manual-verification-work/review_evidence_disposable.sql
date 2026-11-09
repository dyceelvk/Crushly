-- Isolated PostgreSQL only. Exercises database authorization and cleanup;
-- not a storage service, browser, provider, concurrency or malware test.
begin;
do $review$
declare admin_auth uuid:=gen_random_uuid(); owner_auth uuid:=gen_random_uuid(); other_auth uuid:=gen_random_uuid();
 owner_id bigint; v_case bigint; fid uuid; path text; result jsonb; denied boolean; current_ms bigint:=public.now_ms(); session_id text:=gen_random_uuid()::text; lease jsonb;
begin
 insert into auth.users(id,email) values(admin_auth,'review-admin-2@example.invalid'),(owner_auth,'review-owner-2@example.invalid'),(other_auth,'review-other-2@example.invalid');
 insert into public.holup_admins(auth_user_id) values(admin_auth);
 select id into owner_id from public.profiles where auth_user_id=owner_auth;
 insert into public.manual_verification_cases(member_id,kind,criteria_snapshot) values(owner_id,'creator','{}') returning id into v_case;
 perform set_config('request.jwt.claim.sub',owner_auth::text,true); set local role authenticated;
 denied:=false; begin perform public.manual_evidence_reserve(v_case,owner_auth,'image/jpeg'); exception when insufficient_privilege then denied:=true; end; assert denied,'member could invoke service-only reserve directly';
 reset role; set local role service_role;
 result:=public.manual_evidence_reserve(v_case,owner_auth,'image/jpeg'); fid:=(result->>'id')::uuid; path:=result->>'path';
 perform public.manual_evidence_finish(fid,owner_auth,true);
 denied:=false; begin perform public.manual_evidence_authorize(fid,other_auth); exception when others then denied:=true; end; assert denied,'non-owner read evidence';
 result:=public.manual_evidence_authorize(fid,owner_auth); assert result->>'path'=path,'owner cannot authorize evidence';
 result:=public.manual_evidence_authorize(fid,admin_auth); assert result->>'path'=path,'admin cannot authorize evidence';
 reset role; perform set_config('request.jwt.claim.sub',other_auth::text,true); set local role authenticated;
 denied:=false; begin perform public.manual_evidence_list(v_case); exception when others then denied:=true; end; assert denied,'non-owner listed evidence';
 reset role; perform set_config('request.jwt.claim.sub',admin_auth::text,true); set local role authenticated;
 perform public.manual_capture_request(v_case);
 reset role; set local role service_role;
 lease:=public.manual_capture_claim(v_case,owner_auth);
 perform public.manual_capture_record(v_case,owner_auth,(lease->>'lease')::uuid,session_id,'https://verify.didit.me/session/fake','workflow');
 perform public.manual_capture_result(v_case,session_id,'workflow','approved',current_ms);
 perform public.manual_capture_result(v_case,session_id,'workflow','review',current_ms+1);
 perform public.manual_capture_result(v_case,session_id,'workflow','approved',current_ms);
 reset role;
 assert not exists(select 1 from public.manual_verification_capture_evidence where manual_verification_capture_evidence.case_id=v_case),'stale result promoted review';
 assert exists(select 1 from public.holup_admin_events where kind='open_verification_file' and actor=admin_auth),'evidence access not audited';
 delete from auth.users where id=owner_auth;
 assert exists(select 1 from public.manual_verification_file_deletions q where q.storage_path=path),'account deletion did not queue object cleanup';
 raise notice 'Isolated evidence authorization and deletion-queue review passed';
end $review$;
rollback;
