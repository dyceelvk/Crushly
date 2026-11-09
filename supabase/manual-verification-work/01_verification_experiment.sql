-- EXPERIMENT ONLY, NOT A MIGRATION. Do not apply to production.
-- Eligibility uses current, non-deleted post/reaction data and active Add Ups.
-- Classification depends on current media filename conventions; review imports,
-- MIME types and moderation exclusions before production use.
begin;
create table public.manual_verification_cases (
 id bigint generated always as identity primary key,
 member_id bigint not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('creator','person_id')),
 status text not null default 'open' check(status in ('open','approved','rejected','withdrawn')),
 criteria_snapshot jsonb not null,
 created_at bigint not null default public.now_ms(),
 decided_at bigint,
 reviewer uuid references auth.users(id),
 decision_reason text
);
-- One active or approved category per account. Rejected/withdrawn cases do not
-- prevent a later application. Existing legacy badges are not bulk changed.
create unique index manual_verification_one_category on public.manual_verification_cases(member_id) where status in ('open','approved');
create table public.manual_verification_messages (
 id bigint generated always as identity primary key,
 case_id bigint not null references public.manual_verification_cases(id) on delete cascade,
 sender_auth uuid not null references auth.users(id),
 sender_role text not null check(sender_role in ('member','admin')),
 body text not null check(char_length(body) between 1 and 2000),
 created_at bigint not null default public.now_ms()
);
create index manual_verification_message_order on public.manual_verification_messages(case_id,id);
alter table public.manual_verification_cases enable row level security;
alter table public.manual_verification_messages enable row level security;
revoke all on public.manual_verification_cases,public.manual_verification_messages from public,anon,authenticated;
revoke all on sequence public.manual_verification_cases_id_seq,public.manual_verification_messages_id_seq from public,anon,authenticated;

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
grant execute on function public.manual_verification_decide(bigint,text,text) to authenticated;
revoke all on function public.manual_verification_progress(text,bigint),public.manual_verification_apply(text),public.manual_verification_cases_list(boolean,text,integer),public.manual_verification_thread(bigint),public.manual_verification_send(bigint,text) from public,anon,authenticated;
grant execute on function public.manual_verification_progress(text,bigint),public.manual_verification_apply(text),public.manual_verification_cases_list(boolean,text,integer),public.manual_verification_thread(bigint),public.manual_verification_send(bigint,text) to authenticated;
commit;
