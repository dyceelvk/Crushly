-- Viewer counts are distinct real accounts with a qualifying view; author
-- self-views are excluded. No viewer identities are included in post payloads.
create index if not exists post_feedback_view_unique_lookup
  on public.post_feedback(post_id, viewer_id, created_at desc) where kind = 'view';

create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- A direct RPC caller cannot forge p_viewer to learn a restricted count.
    'viewCount', case when exists (select 1 from posts po where po.id=p_post_id and public.can_view_post(po, public.me_id())) then (select count(distinct pf.viewer_id) from post_feedback pf join posts po on po.id=pf.post_id where pf.post_id=p_post_id and pf.kind='view' and pf.viewer_id<>po.author_id) else null end,
    'likeCount', (select count(*) from post_reactions r where r.post_id = p_post_id),
    'commentCount', (
      select count(*) from post_comments c
       where c.post_id = p_post_id
         and not c.hidden
         and not public.is_blocked_pair(p_viewer, c.author_id)
    ),
    'liked', exists (
      select 1 from post_reactions r where r.post_id = p_post_id and r.user_id = p_viewer
    ),
    'myReaction', (
      select r.kind from post_reactions r
       where r.post_id = p_post_id and r.user_id = p_viewer
    ),
    'reactionKinds', coalesce((
      select jsonb_object_agg(s.kind, s.n)
        from (select r.kind, count(*) as n
                from post_reactions r
               where r.post_id = p_post_id
               group by r.kind) s
    ), '{}'::jsonb),
    'saved', exists (
      select 1 from post_saves s where s.post_id = p_post_id and s.user_id = p_viewer
    ),
    'sound', (
      select jsonb_build_object('id', s.id, 'title', s.title, 'ownerId', s.owner_id)
        from posts po join sounds s on s.id = po.sound_id
       where po.id = p_post_id
    )
  );
$$;


-- Viewers may read their own Moment view marker, but cannot forge views by
-- directly inserting rows for Moments they cannot see. view_moment validates.
drop policy if exists moment_views_own on public.moment_views;
drop policy if exists moment_views_select_own on public.moment_views;
create policy moment_views_select_own on public.moment_views
  for select to authenticated using (user_id=public.me_id());

-- Post owners alone receive identities. All other authorized readers get only
-- the count already in post_engagement, never an array of names or pictures.
create or replace function public.post_viewers(p_post_id bigint, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me bigint := public.me_id(); po public.posts; items jsonb;
begin
  select * into po from public.posts where id=p_post_id;
  if me is null or not found or po.author_id<>me then
    perform public.crushly_fail(404, 'not_found', 'That post is not available.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile', v.profile, 'viewedAt', v.viewed_at) order by v.viewed_at desc, v.viewer_id desc), '[]'::jsonb)
  into items from (
    select x.viewer_id,x.viewed_at, public.load_visible_profile(me,x.viewer_id,false) as profile
    from (select f.viewer_id,max(f.created_at) as viewed_at
          from post_feedback f where f.post_id=p_post_id and f.kind='view' and f.viewer_id<>me
          group by f.viewer_id) x
    order by x.viewed_at desc,x.viewer_id desc
    limit least(greatest(coalesce(p_limit,100),1),100) offset greatest(coalesce(p_offset,0),0)
  ) v;
  return jsonb_build_object('items',items);
end $$;

-- Moment viewers and the count are both strictly owner-only, independently of
-- whether the caller is otherwise permitted to see the Moment.
create or replace function public.moment_viewers(p_moment_id bigint, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me bigint := public.me_id(); mo public.moments; items jsonb;
begin
  select * into mo from public.moments where id=p_moment_id;
  if me is null or not found or mo.user_id<>me then
    perform public.crushly_fail(404, 'not_found', 'That Moment is not available.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile', v.profile, 'viewedAt', v.created_at) order by v.created_at desc, v.user_id desc), '[]'::jsonb)
  into items from (
    select mv.user_id, mv.created_at, public.load_visible_profile(me,mv.user_id,false) as profile
    from moment_views mv where mv.moment_id=p_moment_id and mv.user_id<>me
    order by mv.created_at desc,mv.user_id desc
    limit least(greatest(coalesce(p_limit,100),1),100) offset greatest(coalesce(p_offset,0),0)
  ) v;
  return jsonb_build_object('count',(select count(*) from moment_views where moment_id=p_moment_id and user_id<>me),'items',items);
end $$;

revoke all on function public.post_viewers(bigint,integer,integer) from public, anon, authenticated;
revoke all on function public.moment_viewers(bigint,integer,integer) from public, anon, authenticated;
grant execute on function public.post_viewers(bigint,integer,integer) to authenticated, service_role;
grant execute on function public.moment_viewers(bigint,integer,integer) to authenticated, service_role;
notify pgrst, 'reload schema';
