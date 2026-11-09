-- A manually entered place name, never device coordinates. It has the same
-- audience and visibility as the post itself.
alter table public.posts add column if not exists location text;
alter table public.posts drop constraint if exists posts_location_length;
alter table public.posts add constraint posts_location_length check (location is null or (length(btrim(location)) between 1 and 80));

create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'location', (select po.location from public.posts po where po.id=p_post_id and public.can_view_post(po, public.me_id())),
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
revoke all on function public.post_engagement(bigint,bigint) from public, anon, authenticated;
grant execute on function public.post_engagement(bigint,bigint) to service_role;

create or replace function public.create_post_with_location(
  p_body text, p_media_url text, p_audience text, p_circle_id bigint,
  p_edit jsonb, p_comments_enabled boolean, p_location text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; place text := nullif(btrim(coalesce(p_location,'')),'');
begin
  if length(coalesce(place,''))>80 or coalesce(place,'') ~ '[[:cntrl:]]' then
    perform public.crushly_fail(400, '', 'Choose a place name of at most 80 characters.');
  end if;
  result := public.create_post_with_options(p_body,p_media_url,p_audience,p_circle_id,p_edit,p_comments_enabled);
  update public.posts set location=place where id=(result->>'id')::bigint and author_id=public.me_id();
  if not found then perform public.crushly_fail(500, '', 'Could not save the location.'); end if;
  return result || jsonb_build_object('location',place);
end $$;
revoke all on function public.create_post_with_location(text,text,text,bigint,jsonb,boolean,text) from public, anon, authenticated;
grant execute on function public.create_post_with_location(text,text,text,bigint,jsonb,boolean,text) to authenticated, service_role;
notify pgrst, 'reload schema';
