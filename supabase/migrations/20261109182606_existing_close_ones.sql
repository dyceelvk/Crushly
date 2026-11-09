begin;
-- Existing connections were explicitly confirmed as accepted Close Ones.
-- An unapproved legacy Keep is still not an accepted friendship. This change
-- exposes counts and identities only for existing accepted connections.
-- Only pairs existing at the time of this migration are grandfathered.
-- A later legacy Add Up acceptance is NOT a Keep Close approval.
create table if not exists public.holup_existing_close_pairs (
  user_a bigint not null references public.profiles(id) on delete cascade,
  user_b bigint not null references public.profiles(id) on delete cascade,
  primary key(user_a,user_b), check(user_a < user_b)
);
alter table public.holup_existing_close_pairs enable row level security;
revoke all on public.holup_existing_close_pairs from public,anon,authenticated;
create table if not exists public.holup_close_conversion_markers (name text primary key);
alter table public.holup_close_conversion_markers enable row level security;
revoke all on public.holup_close_conversion_markers from public,anon,authenticated;
lock table public.connections in share row exclusive mode;
do $$ begin
  if not exists(select 1 from public.holup_close_conversion_markers where name='existing-connections-v1') then
    insert into public.holup_existing_close_pairs(user_a,user_b) select user_a,user_b from public.connections on conflict do nothing;
    insert into public.holup_close_conversion_markers(name) values('existing-connections-v1');
  end if;
end $$;
create or replace function public.holup_existing_close(a bigint,b bigint) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.holup_existing_close_pairs e join public.connections c using(user_a,user_b)
    where e.user_a=least(a,b) and e.user_b=greatest(a,b)) and not public.is_blocked_pair(a,b)
$$;
revoke all on function public.holup_existing_close(bigint,bigint) from public,anon,authenticated;

create or replace function public.space_relationship_stats(p_target_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); visibility text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if (me <> p_target_id and not exists (select 1 from public.profiles p join public.privacy pr on pr.user_id=p.id
     where p.id=p_target_id and p.onboarded and p.status='active' and not public.is_blocked_pair(me,p_target_id)
       and ((pr.profile_visibility='everyone' and not pr.incognito) or public.holup_existing_close(me,p_target_id))))
     or public.load_visible_profile(me,p_target_id,false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  select add_up_list_visibility into visibility from public.privacy where user_id=p_target_id;
  return jsonb_build_object(
    'addUps', (select count(*) from public.crushes c join public.profiles p on p.id=c.from_id
      where c.to_id=p_target_id and c.status in ('pending','accepted') and p.onboarded and p.status='active'
        and not public.is_blocked_pair(c.from_id,p_target_id)),
    'keptClose', (select count(*) from public.connections c join public.holup_existing_close_pairs e using(user_a,user_b) join public.profiles p
      on p.id=case when c.user_a=p_target_id then c.user_b else c.user_a end
      where (c.user_a=p_target_id or c.user_b=p_target_id) and p.onboarded and p.status='active'
        and not public.is_blocked_pair(c.user_a,c.user_b)),
    'postLikes', (select count(*) from public.post_reactions r join public.posts po on po.id=r.post_id
      where po.author_id=p_target_id and (me=p_target_id or (po.audience='everyone' and public.can_view_post(po,me)))),
    'canViewAddUps', me=p_target_id or visibility='everyone' or (visibility='close' and public.holup_existing_close(me,p_target_id)),
    'canViewKeptClose', me=p_target_id or public.holup_existing_close(me,p_target_id),
    'addUpVisibility', case when me=p_target_id then visibility else null end
  );
end $$;
revoke all on function public.space_relationship_stats(bigint) from public,anon,authenticated;
grant execute on function public.space_relationship_stats(bigint) to authenticated,service_role;
notify pgrst,'reload schema';

create or replace function public.relationship_list_profile(p_viewer bigint,p_person bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select case when p_viewer=p_person or exists (
    select 1 from public.profiles p join public.privacy pr on pr.user_id=p.id
    where p.id=p_person and p.onboarded and p.status='active'
      and not public.is_blocked_pair(p_viewer,p_person)
      and ((pr.profile_visibility='everyone' and not pr.incognito) or public.holup_existing_close(p_viewer,p_person))
  ) then public.load_visible_profile(p_viewer,p_person,false) else null end
$$;
revoke all on function public.relationship_list_profile(bigint,bigint) from public,anon,authenticated;

create or replace function public.space_relationship_people(p_target_id bigint, p_kind text, p_offset integer default 0, p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); stats jsonb; result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
  if p_kind is null or p_kind not in ('addUps','keptClose') then perform public.crushly_fail(400,'','Unknown list.'); end if;
  stats:=public.space_relationship_stats(p_target_id);
  if (p_kind='addUps' and not (stats->>'canViewAddUps')::boolean) or (p_kind='keptClose' and not (stats->>'canViewKeptClose')::boolean) then
    perform public.crushly_fail(403,'','This list is private.'); end if;
  with ids as (
    select c.from_id as person, c.created_at as at from public.crushes c
      where p_kind='addUps' and c.to_id=p_target_id and c.status in ('pending','accepted')
    union all
    select case when c.user_a=p_target_id then c.user_b else c.user_a end, c.created_at from public.connections c
      join public.holup_existing_close_pairs e using(user_a,user_b) where p_kind='keptClose' and (c.user_a=p_target_id or c.user_b=p_target_id)
  ), readable as (
    select ids.person, ids.at, public.relationship_list_profile(me,ids.person) as member
      from ids join public.profiles p on p.id=ids.person
     where p.onboarded and p.status='active' and not public.is_blocked_pair(p_target_id,ids.person)
       and not public.is_blocked_pair(me,ids.person)
  ), page as (
    select member,at,person from readable where member is not null order by at desc,person desc offset off limit lim+1
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(member order by at desc,person desc) from (select * from page order by at desc,person desc limit lim) x),'[]'::jsonb),
    'hasMore',(select count(*)>lim from page)) into result;
  return result;
end $$;


notify pgrst,'reload schema';

create or replace function public.holup_forget_existing_close_on_disconnect() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  delete from public.holup_existing_close_pairs where user_a=old.user_a and user_b=old.user_b;
  return old;
end $$;
revoke all on function public.holup_forget_existing_close_on_disconnect() from public,anon,authenticated;
drop trigger if exists holup_forget_existing_close_on_disconnect on public.connections;
create trigger holup_forget_existing_close_on_disconnect after delete on public.connections
for each row execute function public.holup_forget_existing_close_on_disconnect();

-- Grandfathered accepted Close Ones are permanent except when a member blocks.
-- The existing block/report flows insert a block then call disconnect_pair.
create or replace function public.remove_connection(p_target_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  lock table public.connections in share row exclusive mode;
  if public.holup_existing_close(me,p_target_id) then
    perform public.crushly_fail(409,'permanent_close','Accepted Close Ones are permanent. You can block someone if you need to.');
  end if;
  perform public.disconnect_pair(me,p_target_id);
  insert into public.passes(from_id,to_id) values(me,p_target_id)
    on conflict(from_id,to_id) do update set created_at=public.now_ms();
  return true;
end $$;

create or replace function public.let_go(p_member_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  lock table public.connections in share row exclusive mode;
  if public.holup_existing_close(me,p_member_id) then
    perform public.crushly_fail(409,'permanent_close','Accepted Close Ones are permanent. You can block someone if you need to.');
  end if;
  delete from public.keeps where keeper_id=me and kept_id=p_member_id;
  return true;
end $$;

commit;
