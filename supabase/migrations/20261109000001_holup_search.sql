-- New search surface. Old clients retain search_all unchanged.
-- All rows are filtered before limits are applied; no client-side sampling is
-- used to decide whether a result is visible. Circle posts stay in their room.
create or replace function public.search_holup(
  p_query text, p_category text default 'top', p_since bigint default 0,
  p_sort text default 'relevance', p_author text default '',
  p_content text default 'all', p_hashtag boolean default false, p_limit integer default 40, p_place text default ''
) returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  me bigint := public.me_id();
  q text := btrim(coalesce(p_query, ''));
  a text := ltrim(btrim(coalesce(p_author, '')), '@');
  n integer := least(greatest(coalesce(p_limit, 40), 1), 50);
  since_ms bigint := greatest(coalesce(p_since, 0), 0);
  tsq tsquery;
  result jsonb;
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.'); end if;
  if length(q) < 2 or length(q) > 120 or length(a) > 60 or length(coalesce(p_place,'')) > 60 then
    return jsonb_build_object('members','[]'::jsonb,'posts','[]'::jsonb,'moments','[]'::jsonb,'sounds','[]'::jsonb,'places','[]'::jsonb,'hashtags','[]'::jsonb);
  end if;
  if p_category not in ('top','clips','photos','people','sounds','places','hashtags','moments')
     or p_sort not in ('relevance','newest') or p_content not in ('all','clip','photo','text') then
    perform public.crushly_fail(400, '', 'Check your search filters.');
  end if;
  tsq := websearch_to_tsquery('simple', q);

  with visible_people as materialized (
    select p.* from public.profiles p join public.privacy pr on pr.user_id=p.id
     where p_category in ('top','people','places') and p.id <> me and p.onboarded and p.status='active' and pr.discoverable and not pr.incognito
       and not public.is_blocked_pair(me,p.id)
       and (pr.profile_visibility='everyone' or public.is_connected_pair(me,p.id))
  ),
  eligible_posts as materialized (
    select po.*, ap.name as author_name, ap.username as author_username,
      case when po.media_url is null then 'text'
           when po.media_url ~* '\.(mp4|webm|mov|m4v)(\?|$)' then 'clip' else 'photo' end as content_kind
    from public.posts po join public.profiles ap on ap.id=po.author_id
    where p_category in ('top','clips','photos','sounds','hashtags') and po.circle_id is null and public.can_view_post(po,me) and po.created_at >= since_ms
      and (a='' or coalesce(ap.name,'') ilike public.search_like(a) or coalesce(ap.username,'') ilike public.search_like(a))
  ),
  matching_posts as (
    select po.* from eligible_posts po where
      ((not p_hashtag and (to_tsvector('simple',coalesce(po.body,'')) @@ tsq or coalesce(po.body,'') ilike public.search_like(q)))
       or (p_hashtag and exists (select 1 from regexp_matches(coalesce(po.body,''), '#([[:alnum:]_]+)', 'g') tags where lower(tags[1])=lower(q))))
      and (p_content='all' or po.content_kind=p_content)
      and (p_category not in ('clips','photos') or po.content_kind=case when p_category='clips' then 'clip' else 'photo' end)
  )
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(item) from (
      select public.public_profile(me,p.id,false) item
      from visible_people p
      where p_category in ('top','people')
        and (coalesce(p_place,'')='' or exists (select 1 from public.privacy pr where pr.user_id=p.id and pr.show_city and lower(btrim(p.city))=lower(btrim(p_place))))
        and (to_tsvector('simple',coalesce(p.name,'')||' '||coalesce(p.username,'')) @@ tsq
          or coalesce(p.name,'') ilike public.search_like(q) or coalesce(p.username,'') ilike public.search_like(q)
          or exists (select 1 from public.privacy pr where pr.user_id=p.id and pr.show_city and coalesce(p.city,'') ilike public.search_like(q))
          or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(p.interests)='array' then p.interests else '[]'::jsonb end) i where i ilike public.search_like(q)))
      order by case when p_sort='newest' then p.created_at else 0 end desc, (coalesce(p.name,'') ilike q||'%') desc, p.name, p.id limit n
    ) x), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(item) from (
      select jsonb_build_object('id',po.id,'body',po.body,'mediaUrl',po.media_url,'mediaKind',case when po.content_kind='clip' then 'video' when po.content_kind='photo' then 'photo' else null end,
        'audience',po.audience,'createdAt',po.created_at,'author',public.public_profile(me,po.author_id,false)) item
      from matching_posts po where p_category in ('top','clips','photos')
      order by case when p_sort='relevance' then ts_rank(to_tsvector('simple',coalesce(po.body,'')),tsq) else 0 end desc, po.created_at desc, po.id desc limit n
    ) x), '[]'::jsonb),
    'moments', coalesce((select jsonb_agg(item) from (
      select jsonb_build_object('id',m.id,'kind',m.kind,'body',m.body,'mediaUrl',m.media_url,'createdAt',m.created_at,'mine',m.user_id=me,'author',public.public_profile(me,m.user_id,false)) item
      from public.moments m join public.profiles ap on ap.id=m.user_id
      where p_category in ('top','moments') and m.expires_at > public.now_ms() and m.created_at>=since_ms and public.can_view_moment(m,me)
        and (a='' or coalesce(ap.name,'') ilike public.search_like(a) or coalesce(ap.username,'') ilike public.search_like(a))
        and (p_content='all' or (p_content='clip' and m.kind='video') or (p_content='photo' and m.kind='photo') or (p_content='text' and m.kind='text'))
        and ((not p_hashtag and (to_tsvector('simple',coalesce(m.body,'')) @@ tsq or coalesce(m.body,'') ilike public.search_like(q))) or (p_hashtag and exists (select 1 from regexp_matches(coalesce(m.body,''), '#([[:alnum:]_]+)', 'g') tags where lower(tags[1])=lower(q))) )
      order by case when p_sort='relevance' then ts_rank(to_tsvector('simple',coalesce(m.body,'')),tsq) else 0 end desc, m.created_at desc, m.id desc limit n
    ) x), '[]'::jsonb),
    'sounds', coalesce((select jsonb_agg(item) from (
      select jsonb_build_object('id',s.id,'title',s.title) item
      from public.sounds s where p_category in ('top','sounds') and s.title ilike public.search_like(q)
        and exists (select 1 from eligible_posts ep where ep.sound_id=s.id and (p_content='all' or ep.content_kind=p_content))
        and exists (select 1 from public.profiles owner join public.privacy pr on pr.user_id=owner.id
          where owner.id=s.owner_id and (owner.id=me or (owner.onboarded and owner.status='active'
            and not public.is_blocked_pair(me,owner.id)
            and (pr.profile_visibility='everyone' or public.is_connected_pair(me,owner.id))
            and (not pr.incognito or public.is_connected_pair(me,owner.id)))))
      order by case when p_sort='relevance' and s.title ilike q||'%' then 0 else 1 end, s.created_at desc, s.id desc limit n
    ) x), '[]'::jsonb),
    'places', coalesce((select jsonb_agg(item) from (
      select jsonb_build_object('name',p.city) item from visible_people p join public.privacy pr on pr.user_id=p.id
      where p_category in ('top','places') and pr.show_city and nullif(btrim(p.city),'') is not null and p.city ilike public.search_like(q)
      group by p.city order by p.city limit n
    ) x), '[]'::jsonb),
    'hashtags', coalesce((select jsonb_agg(item) from (
      select jsonb_build_object('tag',t.tag) item from (
        select lower((regexp_matches(coalesce(ep.body,''), '#([[:alnum:]_]+)', 'g'))[1]) tag, ep.created_at
        from eligible_posts ep where p_category in ('top','hashtags') and (p_content='all' or ep.content_kind=p_content)
      ) t where t.tag ilike public.search_like(q)
      group by t.tag order by case when p_sort='newest' then max(t.created_at) else 0 end desc, t.tag limit n
    ) x), '[]'::jsonb)
  ) into result;
  return result;
end $function$;
revoke all on function public.search_holup(text,text,bigint,text,text,text,boolean,integer,text) from public,anon;
grant execute on function public.search_holup(text,text,bigint,text,text,text,boolean,integer,text) to authenticated,service_role;
