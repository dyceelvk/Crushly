-- ============================================================================
-- Top Crushes This Week, for real — 1.0.69
--
-- The rail on that page is called "Top Crushes This Week" and it was not
-- showing that. The ranking was:
--
--     (created_at > now - 7 days) desc,     -- recency, first
--     (crushes + 3 * comments) desc         -- engagement, second
--
-- Two things were wrong with it, and both are the kind that a person can see
-- from the outside:
--
--   1. Recency came *before* engagement, so every clip posted this week
--      outranked every older clip no matter what it had earned. A clip with no
--      Crushes and no comments sat at the top of a rail promising the opposite.
--   2. Comments were weighted three times as heavily as Crushes, on a rail whose
--      entire name is Crushes.
--
-- So the ordering becomes the one the title claims, and the claim becomes
-- something the query can keep:
--
--     · only the last seven days — "This Week" is not decoration;
--     · at least one Crush — a post nobody has crushed is not a top Crush, and
--       an empty rail is a more honest thing to draw than a full wrong one;
--     · Crushes, then comments as the tiebreak, then newest, then id so two
--       calls a millisecond apart agree;
--     · one clip per author, and it is that author's *most crushed* clip of the
--       week rather than simply their newest one.
--
-- Picking per author now happens after the engagement sort, which is the point:
-- previously a member's newest clip won the slot even if a different clip of
-- theirs had been crushed a hundred times.
-- ============================================================================

create or replace function public.trending_clips(p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  me     bigint := public.me_id();
  cap    int := least(greatest(coalesce(p_limit, 12), 1), 24);
  items  jsonb := '[]'::jsonb;
  r      record;
  post   public.posts;
  window_start bigint := public.now_ms() - 7 * 86400000;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    with clip as (
      select po.id,
             po.author_id,
             po.created_at,
             coalesce((select count(*) from post_reactions re where re.post_id = po.id), 0) as crushes,
             coalesce((select count(*) from post_comments pc where pc.post_id = po.id), 0) as comments
        from posts po
       where po.media_url is not null
         and po.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)'
         and po.circle_id is null
         and po.audience = 'everyone'
         and po.created_at > window_start
    ),
    -- The clip that carries each author this week: theirs, if it earned anything.
    per_author as (
      select distinct on (c.author_id) c.*
        from clip c
       where c.crushes > 0
       order by c.author_id, c.crushes desc, c.comments desc, c.created_at desc, c.id desc
    )
    select c.id
      from per_author c
     order by c.crushes desc,
              c.comments desc,
              c.created_at desc,
              c.id desc
     limit cap
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', post.id,
          'body', post.body,
          'mediaUrl', post.media_url,
          'mediaKind', 'video',
          'edit', post.edit,
          'audience', post.audience,
          'createdAt', post.created_at,
          'author', public.public_profile(me, post.author_id, false),
          'mine', post.author_id = me
        ) || public.post_engagement(post.id, me)
      );
    end if;
  end loop;

  return items;
end $function$;

grant execute on function public.trending_clips(integer) to authenticated, service_role;

-- ============================================================================
-- A video note is ten seconds — enforced where it is stored
-- ============================================================================

/*
 * The recorder stops at ten seconds, and the camera app is told the same. This
 * is the line that holds when an older build — or a client that is not ours —
 * tries to upload a minute under the same message kind. Ten seconds plus two, for
 * the rounding a duration goes through on the way here.
 *
 * It is deliberately a trigger rather than a change to `send_message`: the rule
 * belongs to the message, not to one way of writing it, and a trigger catches
 * every writer there will ever be.
 *
 * INSERT only, and that is not an oversight. Notes recorded before this release
 * are already in threads; checking on UPDATE would make an old minute-long note
 * impossible to mark as read — a rule about storage would break reading.
 */
create or replace function public.validate_video_note_length() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  secs numeric;
begin
  if new.kind <> 'video' then
    return new;
  end if;
  if (new.meta ->> 'duration') ~ '^[0-9]+(\.[0-9]+)?$' then
    secs := (new.meta ->> 'duration')::numeric;
  end if;
  if secs is not null and secs > 12 then
    perform public.crushly_fail(400, 'video_too_long', 'A video note is 10 seconds. Record a shorter one and send that.');
  end if;
  return new;
end $$;

drop trigger if exists validate_video_note_length on public.messages;
create trigger validate_video_note_length before insert on public.messages
  for each row execute function public.validate_video_note_length();

notify pgrst, 'reload schema';

-- ============================================================================
-- The same lie, one rail over: a Circle tile captioned "Most Crushed Post"
-- ============================================================================

/*
 * `circle_highlights` picked each room's newest-or-most-reacted post and admitted
 * the room whenever that post existed — no reactions, no comments, nothing
 * needed. A room whose most recent post nobody touched still got a tile, and the
 * tile's caption is chosen by the client from `likes` and `comments`: zero of
 * both falls through to "Most Crushed Post". The same sentence the rail got
 * wrong, in a different place.
 *
 * So a post becomes a candidate for the tile only once somebody has crushed it or
 * answered it. A room with nothing crushed and nothing said this week is not a
 * highlight; it is a room, and it is still on Connections, one tap away.
 *
 * Nothing else changes: the score, the seven days, the ordering, the one-post-
 * per-room rule, and the fact that a room that has only been talking is still a
 * highlight — for the conversation, which is what it earned.
 */
create or replace function public.circle_highlights(p_limit integer default 8)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  n  int := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  return coalesce((
    select jsonb_agg(item order by score desc, circle_id)
      from (
        select
               (coalesce(best.likes, 0) * 3) + coalesce(best.comments, 0) * 2 + coalesce(week.messages, 0) as score,
               c.id as circle_id,
               jsonb_build_object(
                 'circleId', c.id,
                 'circleName', c.name,
                 'theme', c.theme,
                 'coverUrl', c.cover_url,
                 'memberCount', (select count(*) from circle_members cm where cm.circle_id = c.id),
                 'postId', best.post_id,
                 'body', best.body,
                 'mediaUrl', best.media_url,
                 'likes', coalesce(best.likes, 0),
                 'comments', coalesce(best.comments, 0),
                 'messages', coalesce(week.messages, 0),
                 'kind', case when best.post_id is not null and coalesce(best.likes, 0) > 0 then 'post'
                              when coalesce(week.messages, 0) > 0 then 'conversation'
                              else 'quiet' end,
                 'score', (coalesce(best.likes, 0) * 3) + coalesce(best.comments, 0) * 2 + coalesce(week.messages, 0),
                 'totalMessages', (select count(*) from circle_messages m where m.circle_id = c.id)
               ) as item
          from circles c
          join circle_members mine on mine.circle_id = c.id and mine.member_id = me
          left join lateral (
            select po.id as post_id, po.body, po.media_url,
                   (select count(*) from post_reactions pr where pr.post_id = po.id) as likes,
                   (select count(*) from post_comments pc where pc.post_id = po.id) as comments
              from posts po
             where po.circle_id = c.id
               and (exists (select 1 from post_reactions pr where pr.post_id = po.id)
                    or exists (select 1 from post_comments pc where pc.post_id = po.id))
             order by (select count(*) from post_reactions pr where pr.post_id = po.id) desc,
                      po.created_at desc
             limit 1
          ) best on true
          left join lateral (
            select count(*) as messages
              from circle_messages m
             where m.circle_id = c.id
               and m.created_at > public.now_ms() - 7 * 24 * 60 * 60 * 1000
          ) week on true
         where best.post_id is not null or coalesce(week.messages, 0) > 0
         order by score desc, c.id
         limit n
      ) ranked
  ), '[]'::jsonb);
end $function$;

grant execute on function public.circle_highlights(integer) to authenticated, service_role;
