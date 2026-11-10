-- ISOLATED CANDIDATE: disposable database only, NOT a deployment migration.
-- Old RPCs, notification formatting, client transition and concurrency must be
-- reconciled before it can be wired or applied to production.
begin;
-- Add Ups need nobody's approval: there is no approval column, because there is
-- no rule to hold. Only the privacy of the list is a setting.
create table public.holup_follow_settings (
 user_id bigint primary key references public.profiles(id) on delete cascade,
 outgoing_visibility text not null default 'private' check(outgoing_visibility in ('everyone','close','private'))
);
create table public.holup_follows (
 follower_id bigint not null references public.profiles(id) on delete cascade,
 followed_id bigint not null references public.profiles(id) on delete cascade,
 -- Only 'active' is ever written now. 'declined' stays legal so a historic row or
 -- an old client's answer cannot violate the table, but 'pending' is gone: an Add
 -- Up that can wait for permission is not an Add Up.
 status text not null check(status in ('active','declined')),
 created_at bigint not null default public.now_ms(), decided_at bigint,
 primary key(follower_id,followed_id), check(follower_id<>followed_id)
);
create table public.holup_follow_attempts (
 follower_id bigint not null references public.profiles(id) on delete cascade,
 created_at bigint not null default public.now_ms()
);
create index holup_follow_attempts_recent on public.holup_follow_attempts(follower_id,created_at);
alter table public.holup_follow_attempts enable row level security;
revoke all on public.holup_follow_attempts from public,anon,authenticated;
create index holup_follows_incoming on public.holup_follows(followed_id,status,created_at desc);
create index holup_follows_outgoing on public.holup_follows(follower_id,status,created_at desc);
alter table public.holup_follows enable row level security;
alter table public.holup_follow_settings enable row level security;
revoke all on public.holup_follows,public.holup_follow_settings from public,anon,authenticated;

-- Accepted Crushes and Keeps both become active Add Ups: each is a one-way follow
-- that needs nobody's permission. A pending Crush was a request to connect, so it
-- is not an Add Up at all — it goes to the Homie inbox instead.
lock table public.crushes,public.blocks,public.keeps in share row exclusive mode;
insert into public.holup_follows(follower_id,followed_id,status,created_at,decided_at)
 select c.from_id,c.to_id,'active',c.created_at,c.responded_at
 from public.crushes c where c.status='accepted' and not public.is_blocked_pair(c.from_id,c.to_id);
insert into public.holup_follows(follower_id,followed_id,status,created_at,decided_at)
 select k.keeper_id,k.kept_id,'active',k.created_at,k.created_at
 from public.keeps k where not public.is_blocked_pair(k.keeper_id,k.kept_id)
 on conflict(follower_id,followed_id) do nothing;

create or replace function public.holup_follow_pair_lock(a bigint,b bigint) returns void
language sql volatile security definer set search_path=public as $$
 select pg_advisory_xact_lock(hashtextextended('holup-follow:'||least(a,b)||':'||greatest(a,b),0));
$$;
revoke all on function public.holup_follow_pair_lock(bigint,bigint) from public,anon,authenticated;

-- `p_approval` is kept in the signature and ignored. Installed clients still send
-- it, and dropping the argument would turn their settings call into a PGRST202;
-- but there is no state for it to change, and the answer says so every time.
create or replace function public.holup_set_follow_settings(p_approval boolean,p_outgoing_visibility text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); s public.holup_follow_settings;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_outgoing_visibility is not null and p_outgoing_visibility not in ('everyone','close','private') then
  perform public.crushly_fail(400,'','Choose a valid privacy setting.'); end if;
 insert into public.holup_follow_settings(user_id,outgoing_visibility)
   values(me,coalesce(p_outgoing_visibility,'private'))
 on conflict(user_id) do update set outgoing_visibility=coalesce(p_outgoing_visibility,holup_follow_settings.outgoing_visibility)
 returning * into s;
 return jsonb_build_object('approvalRequired',false,'outgoingVisibility',s.outgoing_visibility);
end $$;

create or replace function public.holup_follow(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); r public.holup_follows; target record;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 -- Per-sender lock makes the quota hold even for concurrent different targets.
 perform pg_advisory_xact_lock(hashtextextended('holup-follow-rate:'||me,0));
 perform public.holup_follow_pair_lock(me,p_target);
 if not exists(select 1 from public.profiles where id=me and onboarded and status='active') or
    public.is_blocked_pair(me,p_target) or public.load_visible_profile(me,p_target,false) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 -- This stricter Space gate excludes the legacy historical-request exception.
 perform public.space_relationship_stats(p_target);
 select p.name,pr.who_can_crush into target from public.profiles p join public.privacy pr on pr.user_id=p.id
 where p.id=p_target and p.onboarded and p.status='active';
 if not found then perform public.crushly_fail(404,'','Space not available.'); end if;
 if target.who_can_crush='verified' and not exists(select 1 from public.profiles where id=me and verification='verified') then
   perform public.crushly_fail(403,'verification_required','This member only accepts Add Ups from verified members.'); end if;
 select * into r from public.holup_follows where follower_id=me and followed_id=p_target;
 if found and r.status in ('active','pending') then return jsonb_build_object('status',r.status,'changed',false); end if;
 if found and r.status='declined' and r.decided_at > public.now_ms()-604800000 then
   perform public.crushly_fail(429,'request_cooldown','Please wait before requesting again.'); end if;
 delete from public.holup_follow_attempts where follower_id=me and created_at<=public.now_ms()-86400000;
 if (select count(*) from public.holup_follow_attempts where follower_id=me)>=100 then
   perform public.crushly_fail(429,'rate_limit','Please wait before adding up more people.'); end if;
 insert into public.holup_follow_attempts(follower_id) values(me);
 -- An Add Up is immediate. There is no approval step to wait for, so there is no
 -- pending state to reach: the row is written active, now, and the person added
 -- up is told. Only a Homie asks permission.
 insert into public.holup_follows(follower_id,followed_id,status,created_at,decided_at)
 values(me,p_target,'active',public.now_ms(),public.now_ms())
 on conflict(follower_id,followed_id) do update set status='active',created_at=excluded.created_at,decided_at=excluded.decided_at returning * into r;
 -- An Add Up is announced, once. `notify_to` collapses a repeat into the unread
 -- row that is already there, and the member's own "Add Ups" switch can silence
 -- it without touching anything else.
 perform public.notify_to(p_target,'keep',me,null,'');
 return jsonb_build_object('status',r.status,'changed',true);
end $$;

create or replace function public.holup_respond_follow(p_follower bigint,p_accept boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); r public.holup_follows;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_accept is null or p_follower is null or p_follower=me then perform public.crushly_fail(400,'','Invalid request.'); end if;
 perform public.holup_follow_pair_lock(me,p_follower);
 if public.is_blocked_pair(me,p_follower) or public.load_visible_profile(me,p_follower,false) is null then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.holup_follows set status=case when p_accept then 'active' else 'declined' end,decided_at=public.now_ms()
 where follower_id=p_follower and followed_id=me and status='pending' returning * into r;
 if not found then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 return jsonb_build_object('status',r.status);
end $$;

create or replace function public.holup_unfollow(p_target bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.holup_follow_pair_lock(me,p_target);
 delete from public.holup_follows where follower_id=me and followed_id=p_target and status in ('active','pending');
 return true;
end $$;

-- Blocking removes both directions regardless of which member initiates it.
create or replace function public.holup_remove_follows_on_block() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform public.holup_follow_pair_lock(new.blocker_id,new.blocked_id);
 delete from public.holup_follows where (follower_id=new.blocker_id and followed_id=new.blocked_id)
 or (follower_id=new.blocked_id and followed_id=new.blocker_id);
 return new;
end $$;
revoke all on function public.holup_remove_follows_on_block() from public,anon,authenticated;
create trigger holup_remove_follows_on_block after insert on public.blocks for each row execute function public.holup_remove_follows_on_block();

create or replace function public.holup_follow_stats(p_target bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); base jsonb; outgoing text; incoming text; homies boolean;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 -- Uses the deployed Space authorization gate; a follow never grants access.
 base:=public.space_relationship_stats(p_target);
 select coalesce((select outgoing_visibility from public.holup_follow_settings where user_id=p_target),'private'),
        (select add_up_list_visibility from public.privacy where user_id=p_target),
        public.holup_existing_close(me,p_target) into outgoing,incoming,homies;
 return jsonb_build_object(
  'addUps',(select count(*) from public.holup_follows f join public.profiles p on p.id=f.follower_id where f.followed_id=p_target and f.status='active' and p.onboarded and p.status='active' and not public.is_blocked_pair(p_target,p.id)),
  'addedUp',(select count(*) from public.holup_follows f join public.profiles p on p.id=f.followed_id where f.follower_id=p_target and f.status='active' and p.onboarded and p.status='active' and not public.is_blocked_pair(p_target,p.id)),
  'canViewAddUps',me=p_target or incoming='everyone' or (incoming='close' and homies),
  'canViewAddedUp',me=p_target or outgoing='everyone' or (outgoing='close' and homies),
  'outgoingVisibility',case when me=p_target then outgoing else null end,
  'approvalRequired',false,
  'myStatus',case when me<>p_target then (select status from public.holup_follows where follower_id=me and followed_id=p_target and status in ('active','pending')) else null end,
  'keptClose',base->'keptClose','canViewKeptClose',base->'canViewKeptClose','postLikes',base->'postLikes','addUpVisibility',base->'addUpVisibility');
end $$;

create or replace function public.holup_follow_people(p_target bigint,p_kind text,p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); stats jsonb; result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 if p_kind is null or p_kind not in ('addUps','addedUp') then perform public.crushly_fail(400,'','Unknown list.'); end if;
 stats:=public.holup_follow_stats(p_target);
 if not (stats->>case when p_kind='addUps' then 'canViewAddUps' else 'canViewAddedUp' end)::boolean then
   perform public.crushly_fail(403,'','This list is private.'); end if;
 with ids as (
  select case when p_kind='addUps' then f.follower_id else f.followed_id end person, f.created_at at
  from public.holup_follows f where f.status='active' and ((p_kind='addUps' and f.followed_id=p_target) or (p_kind='addedUp' and f.follower_id=p_target))
 ), readable as (
  select ids.person,ids.at,public.relationship_list_profile(me,ids.person) member from ids join public.profiles p on p.id=ids.person
  where p.onboarded and p.status='active' and not public.is_blocked_pair(p_target,ids.person) and not public.is_blocked_pair(me,ids.person)
 ), page as (select * from readable where member is not null order by at desc,person desc offset off limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(member order by at desc,person desc) from (select * from page order by at desc,person desc limit lim) x),'[]'::jsonb),
 'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;
-- Cheap status-only lookup for buttons in feeds; it cannot grant access to a
-- private Space and never reveals a relationship between two other members.
create or replace function public.holup_follow_status(p_target bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me or public.relationship_list_profile(me,p_target) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 return jsonb_build_object('status',(select status from public.holup_follows where follower_id=me and followed_id=p_target and status in ('active','pending')));
end $$;
revoke all on function public.holup_follow_status(bigint) from public,anon,authenticated;
grant execute on function public.holup_follow_status(bigint) to authenticated,service_role;

-- Only the recipient may enumerate approval requests. Individual profiles still
-- pass the same relationship-list privacy gate; a hidden identity is not sent.
create or replace function public.holup_pending_follow_requests(p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 with readable as (
  select f.follower_id person,f.created_at at,public.relationship_list_profile(me,f.follower_id) member
  from public.holup_follows f join public.profiles p on p.id=f.follower_id
  where f.followed_id=me and f.status='pending' and p.onboarded and p.status='active' and not public.is_blocked_pair(me,f.follower_id)
 ), page as (select * from readable where member is not null order by at desc,person desc offset off limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(member order by at desc,person desc) from (select * from page order by at desc,person desc limit lim) x),'[]'::jsonb),
 'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;
revoke all on function public.holup_pending_follow_requests(integer,integer) from public,anon,authenticated;
grant execute on function public.holup_pending_follow_requests(integer,integer) to authenticated,service_role;
revoke all on function public.holup_set_follow_settings(boolean,text),public.holup_follow(bigint),public.holup_respond_follow(bigint,boolean),public.holup_unfollow(bigint),public.holup_follow_stats(bigint),public.holup_follow_people(bigint,text,integer,integer) from public,anon,authenticated;
grant execute on function public.holup_set_follow_settings(boolean,text),public.holup_follow(bigint),public.holup_respond_follow(bigint,boolean),public.holup_unfollow(bigint),public.holup_follow_stats(bigint),public.holup_follow_people(bigint,text,integer,integer) to authenticated,service_role;
commit;
