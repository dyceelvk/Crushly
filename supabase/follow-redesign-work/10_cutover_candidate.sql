-- CUTOVER CANDIDATE — not a production migration until the release is signed off.
-- A single ordered unit: the Add Up rules, the Homies rules, the Whisper rules,
-- then the guard that closes the eight legacy relationship write endpoints.
-- Everything below runs in one transaction; nothing here belongs in
-- supabase/migrations/ until it is the release that ships with the new client.
begin;
-- ISOLATED CANDIDATE: disposable database only, NOT a deployment migration.
-- Old RPCs, notification formatting, client transition and concurrency must be
-- reconciled before it can be wired or applied to production.
create table public.holup_follow_settings (
 user_id bigint primary key references public.profiles(id) on delete cascade,
 approval_required boolean not null default false,
 outgoing_visibility text not null default 'private' check(outgoing_visibility in ('everyone','close','private'))
);
create table public.holup_follows (
 follower_id bigint not null references public.profiles(id) on delete cascade,
 followed_id bigint not null references public.profiles(id) on delete cascade,
 status text not null check(status in ('active','pending','declined')),
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

-- Preserve only explicitly accepted follows; a pending legacy request remains
-- pending rather than being represented as consent. Keeps are NOT follows.
lock table public.crushes,public.blocks in share row exclusive mode;
insert into public.holup_follows(follower_id,followed_id,status,created_at,decided_at)
 select c.from_id,c.to_id,case c.status when 'accepted' then 'active' else 'pending' end,c.created_at,c.responded_at
 from public.crushes c where c.status in ('pending','accepted') and not public.is_blocked_pair(c.from_id,c.to_id);

create or replace function public.holup_follow_pair_lock(a bigint,b bigint) returns void
language sql volatile security definer set search_path=public as $$
 select pg_advisory_xact_lock(hashtextextended('holup-follow:'||least(a,b)||':'||greatest(a,b),0));
$$;
revoke all on function public.holup_follow_pair_lock(bigint,bigint) from public,anon,authenticated;

create or replace function public.holup_set_follow_settings(p_approval boolean,p_outgoing_visibility text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); s public.holup_follow_settings;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if (p_approval is null and p_outgoing_visibility is null) or (p_outgoing_visibility is not null and p_outgoing_visibility not in ('everyone','close','private')) then
  perform public.crushly_fail(400,'','Choose a valid privacy setting.'); end if;
 insert into public.holup_follow_settings(user_id,approval_required,outgoing_visibility) values(me,coalesce(p_approval,false),coalesce(p_outgoing_visibility,'private'))
 on conflict(user_id) do update set approval_required=coalesce(p_approval,holup_follow_settings.approval_required),outgoing_visibility=coalesce(p_outgoing_visibility,holup_follow_settings.outgoing_visibility) returning * into s;
 return jsonb_build_object('approvalRequired',s.approval_required,'outgoingVisibility',s.outgoing_visibility);
end $$;

create or replace function public.holup_follow(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); r public.holup_follows; needs_approval boolean; target record;
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
 -- Serialize with settings writes. The row exists even for the default.
 insert into public.holup_follow_settings(user_id) values(p_target) on conflict do nothing;
 select approval_required into needs_approval from public.holup_follow_settings where user_id=p_target for update;
 insert into public.holup_follows(follower_id,followed_id,status,created_at,decided_at)
 values(me,p_target,case when needs_approval then 'pending' else 'active' end,public.now_ms(),case when needs_approval then null else public.now_ms() end)
 on conflict(follower_id,followed_id) do update set status=excluded.status,created_at=excluded.created_at,decided_at=excluded.decided_at returning * into r;
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
  'approvalRequired',case when me=p_target then coalesce((select approval_required from public.holup_follow_settings where user_id=p_target),false) else null end,
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

-- DISPOSABLE EXPERIMENT ONLY. Not a production migration. Requires the follow
-- candidate and a reviewed atomic old-client/privacy/Whisper cutover.
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

-- DISPOSABLE EXPERIMENT ONLY, not production. Requires follow + Homies candidate.
-- Must be integrated with all message APIs, read/media/realtime security and
-- old-client migration as a single reviewed cutover before any deployment.
lock table public.conversations,public.blocks,public.privacy,public.messages in share row exclusive mode;
alter table public.privacy add column holup_whisper_open boolean not null default false;
create table public.holup_whisper_permissions (
 conversation_id bigint primary key references public.conversations(id) on delete cascade,
 requester_id bigint not null references public.profiles(id) on delete cascade,
 recipient_id bigint not null references public.profiles(id) on delete cascade,
 state text not null check(state in ('pending','accepted','declined','blocked')),
 request_messages smallint not null default 0 check(request_messages between 0 and 2),
 created_at bigint not null default public.now_ms(),decided_at bigint,
 check(requester_id<>recipient_id)
);
alter table public.holup_whisper_permissions enable row level security;
revoke all on public.holup_whisper_permissions from public,anon,authenticated;
-- Preserve all existing open threads; neither the presence of a Homie nor an
-- Add Up is used as consent. Closed threads remain closed and fail closed.
insert into public.holup_whisper_permissions(conversation_id,requester_id,recipient_id,state)
 select id,user_a,user_b,'accepted' from public.conversations where not closed and not public.is_blocked_pair(user_a,user_b);
update public.privacy set holup_whisper_open=(who_can_message='everyone');
create or replace function public.holup_set_whisper_open(p_open boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_open is null then perform public.crushly_fail(400,'','Choose a setting.'); end if;
 update public.privacy set holup_whisper_open=p_open where user_id=me;
 if not found then perform public.crushly_fail(404,'','Privacy settings not found.'); end if;
 return p_open;
end $$;

create or replace function public.holup_begin_whisper_request(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); cv public.conversations; permission public.holup_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.holup_follow_pair_lock(me,p_target);
 if public.is_blocked_pair(me,p_target) or public.relationship_list_profile(me,p_target) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 select * into cv from public.conversations where user_a=least(me,p_target) and user_b=greatest(me,p_target);
 if not found then
   insert into public.conversations(user_a,user_b) values(least(me,p_target),greatest(me,p_target)) returning * into cv;
   insert into public.holup_whisper_permissions(conversation_id,requester_id,recipient_id,state) values(cv.id,me,p_target,'pending');
 end if;
 select * into permission from public.holup_whisper_permissions where conversation_id=cv.id;
 if not found or permission.state in ('declined','blocked') or cv.closed then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 return jsonb_build_object('id',cv.id,'state',permission.state,'sent',permission.request_messages,
  'requester',permission.requester_id=me,'open',coalesce((select holup_whisper_open from public.privacy where user_id=permission.recipient_id),false));
end $$;

create or replace function public.holup_accept_whisper(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; permission public.holup_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into permission from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or permission.recipient_id<>me or permission.state<>'pending' or permission.request_messages=0 or public.is_blocked_pair(c.user_a,c.user_b)
    or not exists(select 1 from public.conversations where id=c.id and not closed) then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.holup_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
 return true;
end $$;

create or replace function public.holup_decline_whisper(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; permission public.holup_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into permission from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or permission.recipient_id<>me or permission.state<>'pending' or public.is_blocked_pair(c.user_a,c.user_b) then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.holup_whisper_permissions set state='declined',decided_at=public.now_ms() where conversation_id=c.id;
 return true;
end $$;

-- Every inserted Whisper (including Moment replies) uses a durable counter;
-- deleting the original message cannot reset the two-message allowance.
-- Pair lock serializes two simultaneous sends and block/accept races.
create or replace function public.holup_whisper_insert_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; perm public.holup_whisper_permissions; open_now boolean;
begin
 select * into c from public.conversations where id=new.conversation_id;
 if not found or me is null or new.sender_id<>me or me not in (c.user_a,c.user_b) then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into c from public.conversations where id=new.conversation_id;
 select * into perm from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or c.closed or public.is_blocked_pair(c.user_a,c.user_b) or perm.state in ('declined','blocked') then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 if perm.state='accepted' then return new; end if;
 -- Opening an empty composer does not reserve or accept a request. Whichever
 -- participant actually sends the first message becomes the requester.
 if perm.request_messages=0 and me=perm.recipient_id then
   if public.relationship_list_profile(me,perm.requester_id) is null then
     perform public.crushly_fail(404,'','Space not available.'); end if;
   update public.holup_whisper_permissions set requester_id=me,recipient_id=perm.requester_id where conversation_id=c.id;
   select * into perm from public.holup_whisper_permissions where conversation_id=c.id;
 end if;
 -- Serialize with setting updates; a message sent while open starts a lasting conversation.
 select holup_whisper_open into open_now from public.privacy where user_id=perm.recipient_id for update;
 if coalesce(open_now,false) then
   -- An actual message, not simply opening an empty composer, starts an
   -- ongoing conversation. It survives a later change to the open preference.
   if me<>perm.requester_id and perm.request_messages=0 then
     perform public.crushly_fail(403,'request_pending','There is no request to reply to.'); end if;
   update public.holup_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
   return new;
 end if;
 if me=perm.recipient_id then
   if perm.request_messages=0 then perform public.crushly_fail(403,'request_pending','There is no request to reply to.'); end if;
   -- The recipient's reply is consent. The decision and insert commit together.
   update public.holup_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
   return new;
 end if;
 if new.kind='call' then perform public.crushly_fail(403,'request_pending','Calls require an accepted Whisper.'); end if;
 update public.holup_whisper_permissions set request_messages=request_messages+1 where conversation_id=c.id and request_messages<2;
 if not found then perform public.crushly_fail(403,'request_limit','Wait for this Whisper request to be accepted.'); end if;
 return new;
end $$;
revoke all on function public.holup_whisper_insert_guard() from public,anon,authenticated;
drop trigger if exists holup_whisper_insert_guard on public.messages;
create trigger holup_whisper_insert_guard before insert on public.messages for each row execute function public.holup_whisper_insert_guard();

-- The Homies candidate already takes the shared pair lock before a block.
create or replace function public.holup_whisper_cleanup_block() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.holup_whisper_permissions set state='blocked',decided_at=public.now_ms()
  where conversation_id in (select id from public.conversations where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id));
 update public.conversations set closed=true where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id);
 return new;
end $$;
create trigger holup_whisper_cleanup_block after insert on public.blocks for each row execute function public.holup_whisper_cleanup_block();
revoke all on function public.holup_whisper_cleanup_block() from public,anon,authenticated;
revoke all on function public.holup_set_whisper_open(boolean),public.holup_begin_whisper_request(bigint),public.holup_accept_whisper(bigint),public.holup_decline_whisper(bigint) from public,anon,authenticated;
grant execute on function public.holup_set_whisper_open(boolean),public.holup_begin_whisper_request(bigint),public.holup_accept_whisper(bigint),public.holup_decline_whisper(bigint) to authenticated,service_role;

/* --------------------------------------------------------------------------
   Cutover guard — the old write endpoints.

   Every relationship write in the deployed app goes through one of these eight
   routines: member rows in crushes/keeps/connections are not directly writable,
   because the only policies on those tables are SELECT. That is what makes a
   clean cutover possible — close the routines and nothing else can create
   relationship state behind the new model's back.

   They are refused rather than translated. Legacy `crushes` has no concept of a
   one-way Add Up, so "translate a crush into an Add Up" would either invent a
   pending request or claim a connection nobody agreed to — exactly the silent
   mutation the cutover exists to prevent. Refusing names what happened and
   points at the update; the client already renders that message.
   -------------------------------------------------------------------------- */
create or replace function public.holup_legacy_relationship_closed() returns void
language plpgsql security definer set search_path=public as $$
begin
  perform public.crushly_fail(409, 'relationship_upgrade_required',
    'Add Ups and Homies moved. Update Holup to keep using them.');
end $$;
revoke all on function public.holup_legacy_relationship_closed() from public,anon,authenticated;

create or replace function public.crush_member(p_target_id bigint, p_is_deep boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return null;
end $$;

create or replace function public.uncrush_member(p_target_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return false;
end $$;

create or replace function public.accept_connection_request(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return null;
end $$;

create or replace function public.decline_connection_request(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return null;
end $$;

create or replace function public.cancel_connection_request(p_to_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return null;
end $$;

create or replace function public.keep_close(p_member_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return null;
end $$;

create or replace function public.let_go(p_member_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return false;
end $$;

create or replace function public.remove_connection(p_target_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  perform public.holup_legacy_relationship_closed();
  return false;
end $$;

-- The old read endpoints stay open and keep reading the tables the migration
-- filled, so an un-updated client shows the state as of the cutover instead of
-- an empty Space. Read-only and stale is survivable; divergence is not.

/* --------------------------------------------------------------------------
   Answering a Moment is asking for a Whisper.

   A Moment reply used to slip straight into a thread because a connection was
   assumed. It is a message from someone the owner may not know, so it opens a
   request like any other: the reply counts as the first of the two, and the
   owner accepts or declines it in the thread the reply lands in.
   -------------------------------------------------------------------------- */
create or replace function public.reply_to_moment(p_moment_id bigint, p_body text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); m public.moments; reason text; conv_id bigint; clean_body text:=coalesce(p_body,'');
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into m from public.moments where id=p_moment_id;
  if not found or m.expires_at<=public.now_ms() or not public.can_view_moment(m,me) then
    perform public.crushly_fail(404,'','This Moment isn’t available.'); end if;
  if m.user_id=me then perform public.crushly_fail(400,'','You can’t reply to your own Moment.'); end if;
  if btrim(clean_body)='' then perform public.crushly_fail(400,'','Write a reply first.'); end if;
  clean_body:=left(clean_body,1000);
  reason:=public.messaging_block_reason(me,m.user_id);
  if reason is not null then perform public.crushly_fail(403,'messaging_restricted',reason); end if;
  conv_id:=public.ensure_conversation(me,m.user_id);
  -- The request is recorded before the message, so the insert guard has an
  -- answer to count against. Declined and blocked requests stay dead.
  if not exists(select 1 from public.holup_whisper_permissions where conversation_id=conv_id) then
    insert into public.holup_whisper_permissions(conversation_id,requester_id,recipient_id,state)
      values(conv_id,me,m.user_id,'pending');
  elsif exists(select 1 from public.holup_whisper_permissions
                where conversation_id=conv_id and state in ('declined','blocked')) then
    perform public.crushly_fail(404,'','Whisper unavailable.');
  end if;
  insert into public.messages(conversation_id,sender_id,kind,body,meta)
    values(conv_id,me,'moment_reply',clean_body,jsonb_build_object('momentId',m.id));
  update public.conversations set last_message_at=public.now_ms() where id=conv_id;
  perform public.notify_to(m.user_id,'moment_reply',me,conv_id,'');
  return jsonb_build_object('conversationId',conv_id);
end $$;

/* --------------------------------------------------------------------------
   Who may be written to at all.

   The deployed rule was "messages only from crushes / Mutual Crushes", which is
   the rule the Whisper request replaces: you ask, they answer. Keeping the old
   refusal would make the request impossible to send — the request itself is the
   permission to write two messages. What still refuses is a block, or writing
   to yourself; everything else is decided by the request rules in the trigger.
   -------------------------------------------------------------------------- */
create or replace function public.messaging_block_reason(p_viewer bigint, p_target bigint) returns text
language plpgsql stable security definer set search_path=public as $$
declare member_name text;
begin
  if p_viewer = p_target then
    return 'You can''t message yourself.';
  end if;
  if public.is_blocked_pair(p_viewer, p_target) then
    return 'This member is no longer available.';
  end if;
  -- Asking is allowed; answering is the other person's. The two-message limit,
  -- the decline and the open-messaging preference are enforced when a message
  -- is actually written, not here.
  select coalesce(p.name, 'This member') into member_name from profiles p where p.id = p_target;
  if member_name is null then return 'This member is no longer available.'; end if;
  return null;
end $$;

/* --------------------------------------------------------------------------
   The Whisper request, as the chat shows it.

   A Whisper starts as a request, not as an open line. Asking for one opens the
   conversation so both people are looking at the same thread: the sender writes
   (two messages, no more), and the recipient decides inside that thread —
   accept or decline, without leaving the chat. Nothing about this touches
   Add Ups or Homies; a Homie does not get to skip the request, and an Add Up
   grants nothing here.
   -------------------------------------------------------------------------- */
create or replace function public.holup_whisper_state(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  me bigint := public.me_id();
  c public.conversations;
  perm public.holup_whisper_permissions;
  peer bigint;
  open_now boolean;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or me not in (c.user_a,c.user_b) then
    perform public.crushly_fail(404,'','Conversation not found.'); end if;
  peer := case when c.user_a=me then c.user_b else c.user_a end;
  select * into perm from public.holup_whisper_permissions where conversation_id=c.id;
  if not found then
    -- No permission row: a thread that predates the request model. It is open,
    -- which is how it was, and it stays open until somebody closes it or blocks.
    return jsonb_build_object('state','accepted','sent',0,'requester',false,
      'remaining',null,'canSend',not c.closed,'needsDecision',false);
  end if;
  select holup_whisper_open into open_now from public.privacy where user_id=perm.recipient_id;
  return jsonb_build_object(
    'state', perm.state,
    'sent', perm.request_messages,
    -- Whose request this is, from the caller's side.
    'requester', perm.requester_id=me,
    -- How many more they may write before the other person answers.
    'remaining', case when perm.state='pending' and perm.requester_id=me
                      then greatest(0, 2-perm.request_messages) else null end,
    'canSend', not c.closed and perm.state not in ('declined','blocked')
      and (perm.state='accepted'
           -- The sender gets two messages to make their case.
           or (perm.requester_id=me and perm.request_messages<2)
           -- The recipient replying is itself an answer; the guard accepts it.
           or (perm.recipient_id=me and perm.request_messages>0)),
    -- The recipient has something to answer, and can answer it in the thread.
    'needsDecision', perm.state='pending' and perm.recipient_id=me and perm.request_messages>0,
    -- Shown to the sender so "they may reply when they like" is not a mystery.
    'peerOpen', coalesce(open_now,false)
  );
end $$;
revoke all on function public.holup_whisper_state(bigint) from public,anon,authenticated;
grant execute on function public.holup_whisper_state(bigint) to authenticated,service_role;

-- Asking for a Whisper is what creates the pending request. Opening a Space's
-- chat therefore cannot quietly open a line to somebody who never agreed:
-- trading messages needs an answer, whichever page the request began on.
create or replace function public.open_conversation(p_target_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  me bigint := public.me_id();
  conv_id bigint;
  perm public.holup_whisper_permissions;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_target_id is null or p_target_id <= 0 then
    perform public.crushly_fail(400,'','Who would you like to message?'); end if;
  if p_target_id = me then perform public.crushly_fail(400,'','That is your own Space.'); end if;
  -- `who_can_message` is deliberately not consulted. Under the request model the
  -- way to reach someone is to ask, and they answer; a setting that pre-refused
  -- the ask made "request a Whisper" impossible for everyone who had not already
  -- connected. Blocking still refuses, and so does a Space that is not visible.
  if public.is_blocked_pair(me,p_target_id) then
    perform public.crushly_fail(404,'','This Space isn’t available.'); end if;
  if public.relationship_list_profile(me,p_target_id) is null then
    perform public.crushly_fail(404,'','This Space isn’t available.'); end if;

  perform public.holup_follow_pair_lock(me,p_target_id);
  conv_id := public.ensure_conversation(me,p_target_id);
  insert into public.holup_whisper_permissions(conversation_id,requester_id,recipient_id,state)
    values(conv_id,me,p_target_id,'pending')
  on conflict (conversation_id) do nothing;
  select * into perm from public.holup_whisper_permissions where conversation_id=conv_id;
  if perm.state in ('declined','blocked') then
    perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
  return jsonb_build_object('id',conv_id,'whisper',public.holup_whisper_state(conv_id));
end $$;

create or replace function public.load_conversation(p_conversation_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  reason text;
  w jsonb;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into conv from conversations c where c.id=p_conversation_id;
  if not found or (conv.user_a<>me and conv.user_b<>me) then
    perform public.crushly_fail(404,'','Conversation not found.'); end if;
  peer := case when conv.user_a=me then conv.user_b else conv.user_a end;
  if public.is_blocked_pair(me,peer) then
    perform public.crushly_fail(404,'','Conversation not found.'); end if;
  reason := public.messaging_block_reason(me,peer);
  w := public.holup_whisper_state(conv.id);
  return jsonb_build_object(
    'id',conv.id,
    'closed',conv.closed,
    'peer',public.peer_summary(peer,me),
    -- The request decides whether the composer opens, not the connection alone.
    'canSend',(w->>'canSend')::boolean and not conv.closed and reason is null,
    'blockReason',case when conv.closed then 'This connection has ended.' else reason end,
    'whisper',w
  );
end $$;

create or replace function public.list_conversations() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  me bigint := public.me_id();
  items jsonb;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,
    'peer',public.peer_summary(case when c.user_a=me then c.user_b else c.user_a end,me),
    'lastMessage',(
      select public.serialize_message(m,me,false) from messages m
       where m.conversation_id=c.id order by m.id desc limit 1
    ),
    'unread',(
      select count(*)::int from messages m
       where m.conversation_id=c.id and m.sender_id<>me and m.read_at is null
    ),
    'updatedAt',coalesce(c.last_message_at,c.created_at),
    'whisper',public.holup_whisper_state(c.id)
  ) order by coalesce(c.last_message_at,c.created_at) desc),'[]'::jsonb)
  into items
  from conversations c
  where (c.user_a=me or c.user_b=me) and not c.closed
    and not public.is_blocked_pair(me,case when c.user_a=me then c.user_b else c.user_a end);
  return jsonb_build_object('items',items);
end $$;

commit;
