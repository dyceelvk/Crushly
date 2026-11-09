-- DISPOSABLE EXPERIMENT ONLY. Not a production migration. Requires the follow
-- candidate and a reviewed atomic old-client/privacy/Whisper cutover.
begin;
lock table public.connections,public.keeps,public.blocks,public.holup_existing_close_pairs in share row exclusive mode;
create table public.holup_homies (
  user_a bigint not null references public.profiles(id) on delete cascade,
  user_b bigint not null references public.profiles(id) on delete cascade,
  accepted_at bigint not null default public.now_ms(),
  primary key(user_a,user_b), check(user_a<user_b)
);
create table public.holup_homie_requests (
  sender_id bigint not null references public.profiles(id) on delete cascade,
  recipient_id bigint not null references public.profiles(id) on delete cascade,
  status text not null check(status in ('pending','declined','withdrawn')),
  created_at bigint not null default public.now_ms(), decided_at bigint,
  primary key(sender_id,recipient_id), check(sender_id<>recipient_id)
);
create index holup_homie_requests_inbox on public.holup_homie_requests(recipient_id,status,created_at desc);
create table public.holup_homie_attempts (
  sender_id bigint not null references public.profiles(id) on delete cascade,
  created_at bigint not null default public.now_ms()
);
create index holup_homie_attempts_recent on public.holup_homie_attempts(sender_id,created_at);
alter table public.holup_homies enable row level security;
alter table public.holup_homie_requests enable row level security;
alter table public.holup_homie_attempts enable row level security;
revoke all on public.holup_homies,public.holup_homie_requests,public.holup_homie_attempts from public,anon,authenticated;

-- The previously deployed bridge defines the precise grandfathered snapshot;
-- later legacy connections are not mistaken for explicit Homie acceptance.
insert into public.holup_homies(user_a,user_b,accepted_at)
 select e.user_a,e.user_b,c.created_at from public.holup_existing_close_pairs e
 join public.connections c using(user_a,user_b)
 where not public.is_blocked_pair(e.user_a,e.user_b);
-- A Keep is a request, not consent; reciprocal Keeps are two pending requests.
insert into public.holup_homie_requests(sender_id,recipient_id,status,created_at)
 select k.keeper_id,k.kept_id,'pending',k.created_at from public.keeps k
 where not public.is_blocked_pair(k.keeper_id,k.kept_id)
 and not exists(select 1 from public.holup_homies h where h.user_a=least(k.keeper_id,k.kept_id) and h.user_b=greatest(k.keeper_id,k.kept_id));

create or replace function public.holup_homie_pair(a bigint,b bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select a is not null and b is not null and a<>b and not public.is_blocked_pair(a,b)
 and exists(select 1 from public.holup_homies where user_a=least(a,b) and user_b=greatest(a,b))
$$;
revoke all on function public.holup_homie_pair(bigint,bigint) from public,anon,authenticated;

create or replace function public.holup_homie_status(p_target bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me or public.is_blocked_pair(me,p_target) or public.relationship_list_profile(me,p_target) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 return jsonb_build_object('homies',public.holup_homie_pair(me,p_target),
   'outgoingPending',exists(select 1 from public.holup_homie_requests where sender_id=me and recipient_id=p_target and status='pending'),
   'incomingPending',exists(select 1 from public.holup_homie_requests where sender_id=p_target and recipient_id=me and status='pending'));
end $$;

create or replace function public.holup_request_homie(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); old_request public.holup_homie_requests;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform pg_advisory_xact_lock(hashtextextended('holup-homie-rate:'||me,0));
 perform public.holup_follow_pair_lock(me,p_target);
 if not exists(select 1 from public.profiles where id=me and onboarded and status='active') or
    public.is_blocked_pair(me,p_target) or public.relationship_list_profile(me,p_target) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 if public.holup_homie_pair(me,p_target) then return jsonb_build_object('status','accepted','changed',false); end if;
 select * into old_request from public.holup_homie_requests where sender_id=me and recipient_id=p_target;
 if found and old_request.status='pending' then return jsonb_build_object('status','pending','changed',false); end if;
 if found and old_request.status='declined' and old_request.decided_at>public.now_ms()-604800000 then
   perform public.crushly_fail(429,'request_cooldown','Please wait before requesting again.'); end if;
 delete from public.holup_homie_attempts where sender_id=me and created_at<=public.now_ms()-86400000;
 if (select count(*) from public.holup_homie_attempts where sender_id=me)>=100 then
   perform public.crushly_fail(429,'rate_limit','Please wait before sending more requests.'); end if;
 insert into public.holup_homie_attempts(sender_id) values(me);
 insert into public.holup_homie_requests(sender_id,recipient_id,status,created_at,decided_at)
 values(me,p_target,'pending',public.now_ms(),null)
 on conflict(sender_id,recipient_id) do update set status='pending',created_at=excluded.created_at,decided_at=null;
 return jsonb_build_object('status','pending','changed',true);
end $$;

create or replace function public.holup_respond_homie(p_sender bigint,p_accept boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_sender is null or p_sender=me or p_accept is null then perform public.crushly_fail(400,'','Invalid request.'); end if;
 perform public.holup_follow_pair_lock(me,p_sender);
 if public.is_blocked_pair(me,p_sender) or public.relationship_list_profile(me,p_sender) is null then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 if not exists(select 1 from public.holup_homie_requests where sender_id=p_sender and recipient_id=me and status='pending') then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 if p_accept then
   insert into public.holup_homies(user_a,user_b) values(least(me,p_sender),greatest(me,p_sender)) on conflict do nothing;
   delete from public.holup_homie_requests where (sender_id=me and recipient_id=p_sender) or (sender_id=p_sender and recipient_id=me);
   return jsonb_build_object('status','accepted');
 end if;
 update public.holup_homie_requests set status='declined',decided_at=public.now_ms() where sender_id=p_sender and recipient_id=me;
 return jsonb_build_object('status','declined');
end $$;

create or replace function public.holup_withdraw_homie(p_target bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.holup_follow_pair_lock(me,p_target);
 update public.holup_homie_requests set status='withdrawn',decided_at=public.now_ms()
 where sender_id=me and recipient_id=p_target and status='pending';
 return true;
end $$;

create or replace function public.holup_homie_requests_inbox(p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 with readable as (
 select r.sender_id person,r.created_at at,public.relationship_list_profile(me,r.sender_id) member
 from public.holup_homie_requests r join public.profiles p on p.id=r.sender_id
 where r.recipient_id=me and r.status='pending' and p.onboarded and p.status='active' and not public.is_blocked_pair(me,r.sender_id)
 ), page as (select * from readable where member is not null order by at desc,person desc offset off limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(member order by at desc,person desc) from (select * from page order by at desc,person desc limit lim) x),'[]'::jsonb),
 'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;


-- Identity lists are owner-and-accepted-Homies only, even for public Spaces.
-- Reuses the deployed stricter Space/profile gates. Wiring new Homies into all
-- privacy semantics is deliberately postponed to the atomic cutover review.
create or replace function public.holup_homie_stats(p_target bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); base jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 base:=public.space_relationship_stats(p_target);
 return jsonb_build_object('count',(
  select count(*) from public.holup_homies h join public.profiles p on p.id=case when h.user_a=p_target then h.user_b else h.user_a end
  where (h.user_a=p_target or h.user_b=p_target) and p.onboarded and p.status='active' and not public.is_blocked_pair(p_target,p.id)
 ),'canView',me=p_target or public.holup_homie_pair(me,p_target));
end $$;
create or replace function public.holup_homie_people(p_target bigint,p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); stats jsonb; result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 stats:=public.holup_homie_stats(p_target);
 if not (stats->>'canView')::boolean then perform public.crushly_fail(403,'','This list is private.'); end if;
 with readable as (
  select p.id person,h.accepted_at at,public.relationship_list_profile(me,p.id) member
  from public.holup_homies h join public.profiles p on p.id=case when h.user_a=p_target then h.user_b else h.user_a end
  where (h.user_a=p_target or h.user_b=p_target) and p.onboarded and p.status='active'
   and not public.is_blocked_pair(p_target,p.id) and not public.is_blocked_pair(me,p.id)
 ), page as (select * from readable where member is not null order by at desc,person desc offset off limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(member order by at desc,person desc) from (select * from page order by at desc,person desc limit lim) x),'[]'::jsonb),
 'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;
revoke all on function public.holup_homie_stats(bigint),public.holup_homie_people(bigint,integer,integer) from public,anon,authenticated;
grant execute on function public.holup_homie_stats(bigint),public.holup_homie_people(bigint,integer,integer) to authenticated,service_role;

-- Block acquires the same pair lock *before* inserting. Accept/send then either
-- completes first and is removed by block, or sees the committed block.
create or replace function public.holup_homie_lock_block() returns trigger
language plpgsql security definer set search_path=public as $$
begin perform public.holup_follow_pair_lock(new.blocker_id,new.blocked_id); return new; end $$;
create trigger holup_homie_lock_block before insert on public.blocks for each row execute function public.holup_homie_lock_block();
create or replace function public.holup_homie_cleanup_block() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 delete from public.holup_homies where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id);
 delete from public.holup_homie_requests where (sender_id=new.blocker_id and recipient_id=new.blocked_id) or (sender_id=new.blocked_id and recipient_id=new.blocker_id);
 return new;
end $$;
create trigger holup_homie_cleanup_block after insert on public.blocks for each row execute function public.holup_homie_cleanup_block();
revoke all on function public.holup_homie_lock_block(),public.holup_homie_cleanup_block() from public,anon,authenticated;
revoke all on function public.holup_homie_status(bigint),public.holup_request_homie(bigint),public.holup_respond_homie(bigint,boolean),public.holup_withdraw_homie(bigint),public.holup_homie_requests_inbox(integer,integer) from public,anon,authenticated;
grant execute on function public.holup_homie_status(bigint),public.holup_request_homie(bigint),public.holup_respond_homie(bigint,boolean),public.holup_withdraw_homie(bigint),public.holup_homie_requests_inbox(integer,integer) to authenticated,service_role;
commit;
