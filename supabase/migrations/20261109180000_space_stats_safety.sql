-- Until approved Keep Close requests are in production, a pair of legacy
-- one-way Keeps is not evidence of an accepted friendship. Fail closed on
-- Close Ones-only identity lists rather than disclosing them prematurely.
create or replace function public.space_relationship_stats(p_target_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); visibility text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if (me <> p_target_id and not exists (select 1 from public.profiles p join public.privacy pr on pr.user_id=p.id
     where p.id=p_target_id and p.onboarded and p.status='active' and not public.is_blocked_pair(me,p_target_id)
       and pr.profile_visibility='everyone' and not pr.incognito))
     or public.load_visible_profile(me,p_target_id,false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  select add_up_list_visibility into visibility from public.privacy where user_id=p_target_id;
  return jsonb_build_object(
    'addUps', (select count(*) from public.crushes c join public.profiles p on p.id=c.from_id
      where c.to_id=p_target_id and c.status in ('pending','accepted') and p.onboarded and p.status='active'
        and not public.is_blocked_pair(c.from_id,p_target_id)),
    -- Legacy Keeps are requests/subscriptions, not approved friendships.
    'keptClose', null,
    'postLikes', (select count(*) from public.post_reactions r join public.posts po on po.id=r.post_id
      where po.author_id=p_target_id and (me=p_target_id or (po.audience='everyone' and public.can_view_post(po,me)))),
    'canViewAddUps', me=p_target_id or visibility='everyone',
    'canViewKeptClose', false,
    'addUpVisibility', case when me=p_target_id then visibility else null end
  );
end $$;
revoke all on function public.space_relationship_stats(bigint) from public,anon,authenticated;
grant execute on function public.space_relationship_stats(bigint) to authenticated,service_role;
notify pgrst,'reload schema';

-- A legacy reciprocal Keep is not an approved Close One. Directory identities
-- must still be public to the requesting viewer until approval is implemented.
create or replace function public.relationship_list_profile(p_viewer bigint,p_person bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select case when p_viewer=p_person or exists (
    select 1 from public.profiles p join public.privacy pr on pr.user_id=p.id
    where p.id=p_person and p.onboarded and p.status='active'
      and not public.is_blocked_pair(p_viewer,p_person)
      and pr.profile_visibility='everyone' and not pr.incognito
  ) then public.load_visible_profile(p_viewer,p_person,false) else null end
$$;
revoke all on function public.relationship_list_profile(bigint,bigint) from public,anon,authenticated;
