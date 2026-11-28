-- R10: per-video search suggestions + strict sound pages.
--
-- 1) flow_suggestions returns one row per post (top 2 terms per post, from the
--    last 30 days of that post's body and comments) so every Flow clip carries
--    the term trending around it. It supersedes the flat term list.
--
-- 2) A sound page shows only the videos that actually carry that sound. The
--    old posts_attach_original_sound trigger force-attached every video to its
--    author's "Original sound", so one sound page could list several videos
--    that never used it. The trigger is gone and the faked links are cleared.

create or replace function public.flow_suggestions(p_limit integer default 24)
returns jsonb
language sql stable security definer set search_path = public as $function$
  with src as (
    select p.id as post_id, lower(coalesce(p.body, '')) as b
      from posts p
     where p.created_at > public.now_ms() - 30 * 86400000::bigint
       and p.circle_id is null
       and public.can_view_post(p, public.me_id())
    union all
    select p.id, lower(coalesce(c.body, ''))
      from post_comments c join posts p on p.id = c.post_id
     where c.created_at > public.now_ms() - 30 * 86400000::bigint
       and not c.hidden
       and public.can_view_post(p, public.me_id())
  ),
  words as (
    select post_id, w
      from src, lateral regexp_split_to_table(src.b, '[^a-z]{2,}') as w
     where length(w) between 4 and 14
  ),
  stops(w) as (values
    ('about'),('after'),('again'),('also'),('been'),('being'),('because'),('before'),
    ('between'),('could'),('didnt'),('doesnt'),('dont'),('every'),('from'),('going'),
    ('have'),('here'),('just'),('know'),('like'),('more'),('never'),('only'),('other'),
    ('over'),('really'),('said'),('should'),('some'),('still'),('such'),('take'),
    ('than'),('that'),('their'),('them'),('then'),('there'),('these'),('they'),
    ('this'),('those'),('through'),('very'),('want'),('wasnt'),('well'),('were'),
    ('what'),('when'),('where'),('which'),('while'),('with'),('would'),('your')
  ),
  filtered as (select post_id, w from words where w not in (select w from stops)),
  ranked as (
    select post_id, w, row_number() over (partition by post_id order by count(*) desc, w) as rn
      from filtered group by post_id, w
  )
  select coalesce(jsonb_agg(jsonb_build_object('postId', post_id, 'term', w)), '[]'::jsonb)
    from ranked where rn <= 2
$function$;

-- A video carries a sound only when it was made with one.
drop trigger if exists posts_attach_original_sound on public.posts;

update public.posts p
   set sound_id = null
  from public.sounds s
 where p.sound_id = s.id
   and s.title = 'Original sound'
   and s.owner_id = p.author_id;
