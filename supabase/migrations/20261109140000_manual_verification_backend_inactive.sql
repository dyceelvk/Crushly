-- Inactive review migration draft; do not deploy without complete cutover review.
-- Depends on production migrations 20261109133904 and 20261109134050.
-- Authenticated grants are withheld until all integrations are deployed.
begin;
create table public.manual_verification_messages (
 id bigint generated always as identity primary key,
 case_id bigint not null references public.manual_verification_cases(id) on delete cascade,
 sender_auth uuid not null references auth.users(id),
 sender_role text not null check(sender_role in ('member','admin')),
 body text not null check(char_length(body) between 1 and 2000),
 created_at bigint not null default public.now_ms()
);
create index manual_verification_message_order on public.manual_verification_messages(case_id,id);
alter table public.manual_verification_messages enable row level security;
revoke all on public.manual_verification_messages from public,anon,authenticated;
revoke all on sequence public.manual_verification_messages_id_seq from public,anon,authenticated;

-- Aggregate numbers are visible only to the member or a server-authorized admin.
-- Count current post reactions the same way the app displays its Crushes. Count
-- current posts: deleted posts no longer count. Four consecutive rolling,
-- nonoverlapping seven-day periods, from now going backwards (not total/4).
create or replace function public.manual_verification_progress(p_kind text,p_member bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me bigint:=public.me_id(); who bigint:=coalesce(p_member,me); adds bigint; media bigint; texts bigint; likes bigint; video_likes bigint;
 weeks bigint[]; exempt boolean; ready boolean;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Sign in.'); end if;
 if who<>me and not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Not available.'); end if;
 if p_kind not in ('creator','person_id') or p_kind is null then perform public.crushly_fail(400,'','Choose a verification type.'); end if;
 if not exists(select 1 from public.profiles p where p.id=who) then perform public.crushly_fail(404,'','Member unavailable.'); end if;
 select exists(select 1 from public.profiles p join public.holup_admins a on a.auth_user_id=p.auth_user_id where p.id=who) into exempt;
 select count(*) into adds from public.crushes c join public.profiles p on p.id=c.from_id
  where c.to_id=who and c.status in ('pending','accepted') and p.onboarded and p.status='active' and not public.is_blocked_pair(c.from_id,who);
 select count(*) filter(where media_url is not null),count(*) filter(where media_url is null and btrim(body)<>'') into media,texts
  from public.posts where author_id=who and circle_id is null;
 select count(*),count(*) filter(where po.media_url ~* '[.](mp4|webm|mov|m4v)([?]|$)') into likes,video_likes
  from public.posts po join public.post_reactions r on r.post_id=po.id
  where po.author_id=who and po.circle_id is null;
 select array_agg((select count(*) from public.posts p where p.author_id=who and p.circle_id is null
   and p.created_at<=public.now_ms()-i*604800000::bigint and p.created_at>public.now_ms()-(i+1)*604800000::bigint) order by i)
 into weeks from generate_series(0,3) i;
 ready:=exempt or (case when p_kind='creator' then adds>=10000 and media>=1000 and texts>=100 and likes>=500000 and (select bool_and(w>=3) from unnest(weeks) w)
  else adds>=5000 and media>=1000 and texts>=50 and video_likes>=50000 end);
 return jsonb_build_object('kind',p_kind,'eligible',ready,'adminExempt',exempt,'addUps',adds,'mediaPosts',media,'textPosts',texts,
 'crushes',case when p_kind='creator' then likes else video_likes end,'weeklyPosts',to_jsonb(weeks));
end $$;

create or replace function public.manual_verification_apply(p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me bigint:=public.me_id(); progress jsonb; new_id bigint; existing public.manual_verification_cases; current_tier text;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Sign in.'); end if;
 perform pg_advisory_xact_lock(hashtextextended('verification:'||me::text,0));
 progress:=public.manual_verification_progress(p_kind);
 if not coalesce((progress->>'eligible')::boolean,false) then perform public.crushly_fail(403,'not_eligible','Meet the requirements before applying.'); end if;
 select * into existing from public.manual_verification_cases where member_id=me and status in ('open','approved') limit 1;
 if existing.id is not null then
  if existing.kind=p_kind and existing.status='open' then return jsonb_build_object('id',existing.id); end if;
  perform public.crushly_fail(409,'one_category','An account can have only one verification category.');
 end if;
 select badge_tier into current_tier from public.profiles where id=me for update;
 if current_tier in ('gold','diamond') then perform public.crushly_fail(409,'one_category','This account already has a verification badge.'); end if;
 insert into public.manual_verification_cases(member_id,kind,criteria_snapshot) values(me,p_kind,progress) returning id into new_id;
 return jsonb_build_object('id',new_id);
end $$;
create or replace function public.manual_verification_cases_list(p_admin boolean default false,p_kind text default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me bigint:=public.me_id(); out_json jsonb;
begin
 if me is null or (p_admin and not public.holup_is_admin()) then perform public.crushly_fail(403,'forbidden','Not available.'); end if;
 if p_kind is not null and p_kind not in ('creator','person_id') then perform public.crushly_fail(400,'','Choose a verification type.'); end if;
 if p_admin then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_manual_verification_queue','{}'::jsonb); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'memberId',q.member_id,'memberName',q.name,'kind',q.kind,'status',q.status,'createdAt',q.created_at) order by q.id desc),'[]'::jsonb) into out_json
 from (select c.*,p.name from public.manual_verification_cases c join public.profiles p on p.id=c.member_id
 where ((p_admin and public.holup_is_admin()) or (not p_admin and c.member_id=me)) and (p_kind is null or c.kind=p_kind)
 order by c.id desc offset greatest(coalesce(p_offset,0),0) limit 51) q;
 return out_json;
end $$;
create or replace function public.manual_verification_thread(p_case bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me bigint:=public.me_id(); c public.manual_verification_cases; messages jsonb; is_admin boolean:=public.holup_is_admin();
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if me is null or not found or (c.member_id<>me and not is_admin) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 if is_admin and c.member_id<>me then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_verification_case',jsonb_build_object('caseId',c.id)); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'role',m.sender_role,'body',m.body,'createdAt',m.created_at) order by m.id),'[]'::jsonb) into messages
 from public.manual_verification_messages m where m.case_id=c.id;
 return jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'memberId',c.member_id,'criteria',c.criteria_snapshot,'messages',messages);
end $$;
create or replace function public.manual_verification_send(p_case bigint,p_body text) returns boolean
language plpgsql security definer set search_path='' as $$
declare me bigint:=public.me_id(); c public.manual_verification_cases; text_body text:=btrim(coalesce(p_body,'')); sender text;
begin
 if me is null or char_length(text_body) not between 1 and 2000 then perform public.crushly_fail(400,'','Enter a message of up to 2,000 characters.'); end if;
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or (c.member_id<>me and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 if c.status<>'open' then perform public.crushly_fail(409,'','This application is closed.'); end if;
 sender:=case when c.member_id=me then 'member' else 'admin' end;
 if (select count(*) from public.manual_verification_messages where sender_auth=auth.uid() and created_at>public.now_ms()-3600000)>=30 then perform public.crushly_fail(429,'','Please try again later.'); end if;
 insert into public.manual_verification_messages(case_id,sender_auth,sender_role,body) values(c.id,auth.uid(),sender,text_body);
 if sender='admin' then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_message',jsonb_build_object('caseId',c.id)); end if;
 return true;
end $$;
-- A separate trusted provider-integration layer must bind a Didit session to
-- this case and record a verified outcome. No authenticated user can write
-- evidence, and the old identity-verification callback is NOT evidence here.
create table public.manual_verification_capture_evidence (
 case_id bigint primary key references public.manual_verification_cases(id) on delete cascade,
 provider_session_id text not null unique,
 approved boolean not null default false,
 completed_at bigint not null,
 recorded_at bigint not null default public.now_ms()
);
alter table public.manual_verification_capture_evidence enable row level security;
revoke all on public.manual_verification_capture_evidence from public,anon,authenticated;

-- The live badge-tier guard is provided by migration
-- 20261109131025_protect_profile_badge_tier. No badges are changed here.

create or replace function public.manual_verification_decide(p_case bigint,p_decision text,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; reason text:=btrim(coalesce(p_reason,'')); tier text;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 if p_decision is null or p_decision not in ('approve','reject') or char_length(reason) not between 10 and 500 then
  perform public.crushly_fail(400,'','Choose a decision and provide a reason of 10 to 500 characters.'); end if;
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' then perform public.crushly_fail(404,'','Open application unavailable.'); end if;
 if p_decision='approve' and not exists(select 1 from public.manual_verification_capture_evidence e join public.manual_verification_captures d on d.case_id=e.case_id and d.state='approved' and d.provider_session_id=e.provider_session_id where e.case_id=c.id and e.approved) then
  perform public.crushly_fail(409,'capture_required','Approved Didit live capture is required before a badge can be assigned.'); end if;
 tier:=case when c.kind='creator' then 'gold' else 'diamond' end;
 if p_decision='approve' then
  perform 1 from public.profiles where id=c.member_id and badge_tier not in ('gold','diamond') for update;
  if not found then perform public.crushly_fail(409,'one_category','This account already has a verification badge.'); end if;
  update public.profiles set verification='verified',badge_tier=tier where id=c.member_id;
 end if;
 insert into public.manual_verification_messages(case_id,sender_auth,sender_role,body) values(c.id,auth.uid(),'admin',case when p_decision='approve' then 'Application approved. ' else 'Application not approved. ' end || reason);
 update public.manual_verification_cases set status=case when p_decision='approve' then 'approved' else 'rejected' end,
  reviewer=auth.uid(),decided_at=public.now_ms(),decision_reason=reason where id=c.id;
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_decision',jsonb_build_object('caseId',c.id,'memberId',c.member_id,'decision',p_decision,'badge',case when p_decision='approve' then tier else null end,'reason',reason));
 return true;
end $$;
revoke all on function public.manual_verification_decide(bigint,text,text) from public,anon,authenticated;

revoke all on function public.manual_verification_progress(text,bigint),public.manual_verification_apply(text),public.manual_verification_cases_list(boolean,text,integer),public.manual_verification_thread(bigint),public.manual_verification_send(bigint,text) from public,anon,authenticated;


create table public.manual_verification_captures (
 case_id bigint primary key references public.manual_verification_cases(id) on delete cascade,
 state text not null check(state in ('requested','creating','created','approved','declined','review','expired')),
 lease uuid, lease_until timestamptz,
 provider_session_id text unique, provider_url text, workflow_id text,
 last_observed_at bigint not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.manual_verification_captures enable row level security;
revoke all on public.manual_verification_captures from public,anon,authenticated;

create or replace function public.manual_capture_request(p_case bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; state text;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' then perform public.crushly_fail(404,'','Open verification application unavailable.'); end if;
 select cap.state into state from public.manual_verification_captures cap where cap.case_id=p_case for update;
 if state in ('requested','creating','created','approved','review') then perform public.crushly_fail(409,'','Capture is already requested or in progress.'); end if;
 delete from public.manual_verification_capture_evidence where case_id=p_case;
 insert into public.manual_verification_captures(case_id,state) values(p_case,'requested')
 on conflict(case_id) do update set state='requested',lease=null,lease_until=null,provider_session_id=null,provider_url=null,workflow_id=null,last_observed_at=0,updated_at=now();
 insert into public.manual_verification_messages(case_id,sender_auth,sender_role,body)
 values(p_case,auth.uid(),'admin','Please complete the secure Didit live ID and selfie capture using the button in this review. Never share a password or sign-in code.');
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_capture_requested',jsonb_build_object('caseId',p_case));
 return true;
end $$;

-- This service-only function trusts p_actor only after an edge function has
-- verified its JWT using Auth. Never expose a service key to a client.
create or replace function public.manual_capture_claim(p_case bigint,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; cap public.manual_verification_captures; tok uuid;
begin
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or not exists(select 1 from public.profiles p where p.id=c.member_id and p.auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 select * into cap from public.manual_verification_captures where case_id=p_case for update;
 if not found then raise exception 'A reviewer must request capture first' using errcode='42501'; end if;
 if cap.state in ('created','review','approved') then return jsonb_build_object('state',cap.state,'url',cap.provider_url); end if;
 if cap.state='creating' and cap.lease_until>now() then raise exception 'Capture is being prepared; try again shortly' using errcode='55000'; end if;
 if cap.state not in ('requested','creating') then raise exception 'Ask your reviewer for another capture' using errcode='55000'; end if;
 tok:=gen_random_uuid();
 update public.manual_verification_captures set state='creating',lease=tok,lease_until=now()+interval '2 minutes',updated_at=now() where case_id=p_case;
 return jsonb_build_object('state','creating','lease',tok);
end $$;
create or replace function public.manual_capture_record(p_case bigint,p_actor uuid,p_lease uuid,p_session text,p_url text,p_workflow text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases;
begin
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or not exists(select 1 from public.profiles p where p.id=c.member_id and p.auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 if p_session is null or p_url is null or p_workflow is null or p_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_url !~ '^https://verify[.]didit[.]me/' or length(p_url)>2000 or p_workflow is null or length(p_workflow)>100 then raise exception 'Invalid provider session' using errcode='22023'; end if;
 update public.manual_verification_captures set state='created',provider_session_id=p_session,provider_url=p_url,workflow_id=p_workflow,lease=null,lease_until=null,updated_at=now()
 where case_id=p_case and state='creating' and lease=p_lease and lease_until>now();
 if not found then raise exception 'Capture reservation expired' using errcode='55000'; end if;
 return true;
end $$;

create or replace function public.manual_capture_lookup(p_case bigint,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; cap public.manual_verification_captures; allowed boolean;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or c.status<>'open' then raise exception 'Application unavailable' using errcode='42501'; end if;
 select exists(select 1 from public.profiles p where p.id=c.member_id and p.auth_user_id=p_actor) or exists(select 1 from public.holup_admins a where a.auth_user_id=p_actor) into allowed;
 if not allowed then raise exception 'Application unavailable' using errcode='42501'; end if;
 select * into cap from public.manual_verification_captures where case_id=p_case;
 if not found then return jsonb_build_object('state','not_requested'); end if;
 return jsonb_build_object('state',cap.state,'session',cap.provider_session_id,'workflow',cap.workflow_id);
end $$;

-- Called only with server-fetched provider results. We store the minimum
-- decision, not raw document images, face data, extracted IDs or full response.
create or replace function public.manual_capture_result(p_case bigint,p_session text,p_workflow text,p_state text,p_observed_at bigint default public.now_ms()) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; cap public.manual_verification_captures;
begin
 select * into c from public.manual_verification_cases where id=p_case for update;
 select * into cap from public.manual_verification_captures where case_id=p_case for update;
 if c.id is null or c.status<>'open' or cap.provider_session_id is distinct from p_session or cap.workflow_id is distinct from p_workflow then raise exception 'Capture changed' using errcode='55000'; end if;
 if p_state is null or p_state not in ('created','approved','declined','review','expired') or p_observed_at is null or p_observed_at<0 or p_observed_at>public.now_ms()+300000 then raise exception 'Invalid result' using errcode='22023'; end if;
 -- Ignore out-of-order events; concurrent same-millisecond conflicting
 -- results may never promote a case to approved. A fresh poll can reconcile.
 if p_observed_at<cap.last_observed_at or (p_observed_at=cap.last_observed_at and p_state='approved' and cap.state<>'approved') then return true; end if;
 -- Do not revive terminal declined/expired attempts. If a later provider
 -- decision withdraws approval, fail closed and revoke evidence.
 if cap.state in ('declined','expired') then return true; end if;
 if cap.state='approved' and p_state='created' then return true; end if;
 if p_state in ('declined','expired','review') then delete from public.manual_verification_capture_evidence where case_id=p_case; end if;
 update public.manual_verification_captures set state=p_state,last_observed_at=p_observed_at,updated_at=now() where case_id=p_case;
 if p_state='approved' then
  insert into public.manual_verification_capture_evidence(case_id,provider_session_id,approved,completed_at)
  values(p_case,p_session,true,public.now_ms()) on conflict(case_id) do update set provider_session_id=excluded.provider_session_id,approved=true,completed_at=excluded.completed_at,recorded_at=public.now_ms();
 end if;
 return true;
end $$;
create or replace function public.manual_capture_state(p_case bigint) returns text
language plpgsql stable security definer set search_path='' as $$
declare c public.manual_verification_cases; s text;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or public.me_id() is null or (c.member_id<>public.me_id() and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 select state into s from public.manual_verification_captures where case_id=p_case;
 return coalesce(s,'not_requested');
end $$;
revoke all on function public.manual_capture_request(bigint),public.manual_capture_state(bigint) from public,anon,authenticated;

revoke all on function public.manual_capture_claim(bigint,uuid),public.manual_capture_record(bigint,uuid,uuid,text,text,text),public.manual_capture_lookup(bigint,uuid),public.manual_capture_result(bigint,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.manual_capture_claim(bigint,uuid),public.manual_capture_record(bigint,uuid,uuid,text,text,text),public.manual_capture_lookup(bigint,uuid),public.manual_capture_result(bigint,text,text,text,bigint) to service_role;

create or replace function public.manual_evidence_reserve(p_case bigint,p_actor uuid,p_mime text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; fid uuid:=gen_random_uuid(); suffix text; path text;
begin
 if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Unsupported image type' using errcode='22023'; end if;
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 if (select count(*) from public.manual_verification_files where case_id=p_case and created_at>public.now_ms()-3600000)>=12 then raise exception 'Please try again later' using errcode='54000'; end if;
 if (select count(*) from public.manual_verification_files where case_id=p_case and state in ('reserved','ready'))>=6 then raise exception 'Maximum of six images per application' using errcode='54000'; end if;
 suffix:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 path:='cases/'||p_case::text||'/'||fid::text||'.'||suffix;
 insert into public.manual_verification_files(id,case_id,storage_path,mime_type) values(fid,p_case,path,p_mime);
 return jsonb_build_object('id',fid,'path',path);
end $$;
create or replace function public.manual_evidence_finish(p_file uuid,p_actor uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases;
begin
 select * into f from public.manual_verification_files where id=p_file for update;
 if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id for update;
 if c.status<>'open' or not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 update public.manual_verification_files set state=case when p_success then 'ready' else 'deleted' end where id=p_file and state='reserved';
 if not found then raise exception 'Image already processed' using errcode='55000'; end if;
 return true;
end $$;
create or replace function public.manual_evidence_list(p_case bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; result jsonb;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or public.me_id() is null or (c.member_id<>public.me_id() and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 if public.holup_is_admin() and c.member_id<>public.me_id() then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_verification_file_list',jsonb_build_object('caseId',p_case)); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by created_at,id),'[]'::jsonb) into result from public.manual_verification_files where case_id=p_case and state='ready';
 return result;
end $$;
create or replace function public.manual_evidence_authorize(p_file uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases; reviewer boolean;
begin
 select * into f from public.manual_verification_files where id=p_file and state='ready';
 if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id;
 reviewer:=exists(select 1 from public.holup_admins where auth_user_id=p_actor);
 if not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) and not reviewer then raise exception 'Image unavailable' using errcode='42501'; end if;
 if reviewer then insert into public.holup_admin_events(actor,kind,details) values(p_actor,'open_verification_file',jsonb_build_object('caseId',c.id,'fileId',f.id)); end if;
 return jsonb_build_object('path',f.storage_path,'mime',f.mime_type);
end $$;
revoke all on function public.manual_evidence_list(bigint) from public,anon,authenticated;

revoke all on function public.manual_evidence_reserve(bigint,uuid,text),public.manual_evidence_finish(uuid,uuid,boolean),public.manual_evidence_authorize(uuid,uuid) from public,anon,authenticated;
grant execute on function public.manual_evidence_reserve(bigint,uuid,text),public.manual_evidence_finish(uuid,uuid,boolean),public.manual_evidence_authorize(uuid,uuid) to service_role;

create or replace function public.manual_evidence_hide(p_file uuid,p_actor uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases;
begin
 select * into f from public.manual_verification_files where id=p_file for update;
 if not found or f.state='deleted' then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id;
 if not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) then raise exception 'Image unavailable' using errcode='42501'; end if;
 update public.manual_verification_files set state='deleted' where id=p_file;
 return f.storage_path;
end $$;
-- Release a reservation after a failed/incomplete upload even if the case was
-- closed while the object was being transferred. Account ownership still wins.
create or replace function public.manual_evidence_abort(p_file uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files;
begin
 select * into f from public.manual_verification_files where id=p_file for update;
 if not found then return; end if;
 if not exists(select 1 from public.manual_verification_cases c join public.profiles p on p.id=c.member_id where c.id=f.case_id and p.auth_user_id=p_actor) then raise exception 'Image unavailable' using errcode='42501'; end if;
 update public.manual_verification_files set state='deleted' where id=p_file and state='reserved';
end $$;

revoke all on function public.manual_evidence_hide(uuid,uuid),public.manual_evidence_abort(uuid,uuid) from public,anon,authenticated;
grant execute on function public.manual_evidence_hide(uuid,uuid),public.manual_evidence_abort(uuid,uuid) to service_role;

create or replace function public.manual_verification_ready_counts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare creator_count bigint; person_count bigint;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select count(*) filter(where c.kind='creator'),count(*) filter(where c.kind='person_id') into creator_count,person_count
 from public.manual_verification_cases c
 join public.manual_verification_capture_evidence e on e.case_id=c.id and e.approved
 join public.manual_verification_captures d on d.case_id=c.id and d.state='approved' and d.provider_session_id=e.provider_session_id
 join public.profiles p on p.id=c.member_id and p.badge_tier not in ('gold','diamond')
 where c.status='open';
 return jsonb_build_object('creator',creator_count,'personId',person_count,'total',creator_count+person_count);
end $$;

-- One confirmed admin action decides every case ready at execution. The query
-- rechecks the provider result and category under locks; counts are advisory,
-- not the source of truth. Cases arriving after the query snapshot wait for the
-- next action. Two concurrent batch actions serialize. No unready case changes.
create or replace function public.manual_verification_award_ready() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; chosen text; creator_count int:=0; person_count int:=0; reason text:='Verified after completed Didit identity checks and Holup review.';
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 perform pg_advisory_xact_lock(hashtextextended('holup-verification-batch',0));
 for c in select v.* from public.manual_verification_cases v
  join public.manual_verification_capture_evidence e on e.case_id=v.id and e.approved
  join public.manual_verification_captures d on d.case_id=v.id and d.state='approved' and d.provider_session_id=e.provider_session_id
  join public.profiles p on p.id=v.member_id and p.badge_tier not in ('gold','diamond')
  where v.status='open' order by v.id for update of v loop
  -- Case locks serialize this decision against provider-result and individual
  -- reviewer actions. The provider result is checked again after the lock.
  if not exists(select 1 from public.manual_verification_capture_evidence e
    join public.manual_verification_captures d on d.case_id=e.case_id and d.state='approved' and d.provider_session_id=e.provider_session_id
    where e.case_id=c.id and e.approved) then continue; end if;
  perform 1 from public.profiles p where p.id=c.member_id and p.badge_tier not in ('gold','diamond') for update;
  if not found then continue; end if;
  chosen:=case when c.kind='creator' then 'gold' else 'diamond' end;
  update public.profiles set verification='verified',badge_tier=chosen where id=c.member_id;
  update public.manual_verification_cases set status='approved',reviewer=auth.uid(),decided_at=public.now_ms(),decision_reason=reason where id=c.id and status='open';
  insert into public.manual_verification_messages(case_id,sender_auth,sender_role,body) values(c.id,auth.uid(),'admin','Application approved. '||reason);
  insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_decision',jsonb_build_object('caseId',c.id,'memberId',c.member_id,'decision','approve','badge',chosen,'method','batch'));
  if c.kind='creator' then creator_count:=creator_count+1; else person_count:=person_count+1; end if;
 end loop;
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_batch',jsonb_build_object('creator',creator_count,'personId',person_count));
 return jsonb_build_object('creator',creator_count,'personId',person_count,'total',creator_count+person_count);
end $$;
revoke all on function public.manual_verification_ready_counts(),public.manual_verification_award_ready() from public,anon,authenticated;


create table public.manual_capture_events (
 event_id text primary key check(length(event_id) between 1 and 200),
 received_at timestamptz not null default now()
);
alter table public.manual_capture_events enable row level security;
revoke all on public.manual_capture_events from public,anon,authenticated;
create or replace function public.manual_capture_apply_event(p_case bigint,p_session text,p_workflow text,p_state text,p_event text,p_observed_at bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_event is null or length(p_event) not between 1 and 200 then raise exception 'Invalid event' using errcode='22023'; end if;
 -- This checks case/session/workflow binding and transactionally updates only
 -- evidence, never the badge. Rollback leaves an event retryable if creation
 -- has not yet committed; replay is safe after success.
 insert into public.manual_capture_events(event_id) values(p_event) on conflict do nothing;
 if not found then return true; end if;
 perform public.manual_capture_result(p_case,p_session,p_workflow,p_state,p_observed_at);
 return true;
end $$;
revoke all on function public.manual_capture_apply_event(bigint,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.manual_capture_apply_event(bigint,text,text,text,text,bigint) to service_role;

create or replace function public.manual_evidence_list(p_case bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; result jsonb;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or public.me_id() is null or (c.member_id<>public.me_id() and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 if public.holup_is_admin() and c.member_id<>public.me_id() then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_verification_file_list',jsonb_build_object('caseId',p_case)); end if;
 if c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000) then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by created_at,id),'[]'::jsonb) into result from public.manual_verification_files where case_id=p_case and state='ready';
 return result;
end $$;
create or replace function public.manual_evidence_authorize(p_file uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases; reviewer boolean;
begin
 select * into f from public.manual_verification_files where id=p_file and state='ready';
 if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id;
 if not found or (c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000)) then raise exception 'Image unavailable' using errcode='42501'; end if;
 reviewer:=exists(select 1 from public.holup_admins where auth_user_id=p_actor);
 if not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) and not reviewer then raise exception 'Image unavailable' using errcode='42501'; end if;
 if reviewer then insert into public.holup_admin_events(actor,kind,details) values(p_actor,'open_verification_file',jsonb_build_object('caseId',c.id,'fileId',f.id)); end if;
 return jsonb_build_object('path',f.storage_path,'mime',f.mime_type);
end $$;

create or replace function public.manual_evidence_cleanup_health() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.manual_evidence_cleanup_health_state; pending bigint; overdue bigint;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select * into s from public.manual_evidence_cleanup_health_state where singleton;
 select count(*) into pending from public.manual_verification_file_deletions;
 select count(*) into overdue from public.manual_verification_files f join public.manual_verification_cases c on c.id=f.case_id
 where f.state<>'deleted' and ((c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000))
   or (f.state='reserved' and f.created_at<=public.now_ms()-86400000));
 return jsonb_build_object('lastAttemptAt',s.last_attempt_at,'lastSuccessAt',s.last_success_at,'lastFailed',s.last_failed,
   'queuedObjects',pending,'overdueImages',overdue,
   'attention',s.last_success_at is null or s.last_success_at<public.now_ms()-3600000 or s.last_failed>0 or pending>0 or overdue>0);
end $$;

revoke all on function public.manual_evidence_cleanup_health() from public,anon,authenticated;

commit;
