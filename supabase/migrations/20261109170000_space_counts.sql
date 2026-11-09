-- Identity lists are private unless their owner deliberately grants access.
-- Counts include active relationships; individual Spaces still obey their own
-- privacy and block rules, so a list can contain fewer identities than a count.
alter table public.privacy add column if not exists add_up_list_visibility text not null default 'private';
alter table public.privacy drop constraint if exists privacy_add_up_list_visibility_check;
alter table public.privacy add constraint privacy_add_up_list_visibility_check check (add_up_list_visibility in ('everyone','close','private'));

create or replace function public.space_relationship_stats(p_target_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); visibility text; allowed_close boolean;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if (me <> p_target_id and not exists (select 1 from public.profiles p join public.privacy pr on pr.user_id=p.id
     where p.id=p_target_id and p.onboarded and p.status='active' and not public.is_blocked_pair(me,p_target_id)
       and ((pr.profile_visibility='everyone' and not pr.incognito) or
            (exists(select 1 from public.keeps where keeper_id=me and kept_id=p_target_id) and exists(select 1 from public.keeps where keeper_id=p_target_id and kept_id=me)))))
     or public.load_visible_profile(me,p_target_id,false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  select add_up_list_visibility into visibility from public.privacy where user_id=p_target_id;
  allowed_close := me=p_target_id or (exists (select 1 from public.keeps where keeper_id=me and kept_id=p_target_id) and exists (select 1 from public.keeps where keeper_id=p_target_id and kept_id=me));
  return jsonb_build_object(
    'addUps', (select count(*) from public.crushes c join public.profiles p on p.id=c.from_id
      where c.to_id=p_target_id and c.status in ('pending','accepted') and p.onboarded and p.status='active'
        and not public.is_blocked_pair(c.from_id,p_target_id)),
    'keptClose', (select count(*) from public.keeps k join public.profiles p on p.id=k.keeper_id
      where k.kept_id=p_target_id and p.onboarded and p.status='active'
        and not public.is_blocked_pair(k.keeper_id,k.kept_id)),
    'canViewAddUps', me=p_target_id or visibility='everyone' or (visibility='close' and allowed_close),
    'canViewKeptClose', allowed_close,
    'addUpVisibility', case when me=p_target_id then visibility else null end
  );
end $$;

-- A directory list must never use the legacy profile exception that treats an
-- old declined/cancelled Add Up as enough to view a connections-only profile.
-- Treat incognito as private here as well: the list is a discoverability surface.
create or replace function public.relationship_list_profile(p_viewer bigint,p_person bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select case when p_viewer=p_person or exists (
    select 1 from public.profiles p join public.privacy pr on pr.user_id=p.id
    where p.id=p_person and p.onboarded and p.status='active'
      and not public.is_blocked_pair(p_viewer,p_person)
      and ((pr.profile_visibility='everyone' and not pr.incognito) or (exists(select 1 from public.keeps where keeper_id=p_viewer and kept_id=p_person) and exists(select 1 from public.keeps where keeper_id=p_person and kept_id=p_viewer)))
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
    select k.keeper_id, k.created_at from public.keeps k
      where p_kind='keptClose' and k.kept_id=p_target_id
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

create or replace function public.set_add_up_list_visibility(p_visibility text) returns text
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_visibility is null or p_visibility not in ('everyone','close','private') then perform public.crushly_fail(400,'','Choose who can see the list.'); end if;
  update public.privacy set add_up_list_visibility=p_visibility where user_id=me;
  if not found then perform public.crushly_fail(404,'','Privacy settings not found.'); end if;
  return p_visibility;
end $$;
revoke all on function public.space_relationship_stats(bigint) from public,anon,authenticated;
revoke all on function public.space_relationship_people(bigint,text,integer,integer) from public,anon,authenticated;
revoke all on function public.set_add_up_list_visibility(text) from public,anon,authenticated;
grant execute on function public.space_relationship_stats(bigint),public.space_relationship_people(bigint,text,integer,integer),public.set_add_up_list_visibility(text) to authenticated,service_role;
notify pgrst,'reload schema';
