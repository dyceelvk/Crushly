-- 20261102000100 ranked_feed
--
-- The Flow was a timeline: `flow_feed` orders by `created_at desc` and nothing
-- else. That is fine for a small circle of people you already know and useless
-- for a For You feed, because a post's chance of being seen depends only on when
-- it was written.
--
-- This migration gives the feed the two things a ranked stream needs:
--
--   1. somewhere to record what happened — `post_feedback`, one row per view or
--      reaction, with the dwell time that TikTok's own client reports as
--      `play_time`/`dwell`;
--   2. `flow_ranked_feed(p_limit, p_cursor)`, which scores candidates from those
--      signals and returns them in a stable, resumable order.
--
-- The shape of it is copied deliberately from the system observed in
-- `docs/TIKTOK-FYP.md`: an item stream rather than a page of posts, a cursor
-- rather than an offset, a small window per request (a client asks for 8 and
-- keeps 2 of them ahead), diversity enforced server-side, and per-item logging
-- so the reason each post was shown can be read back afterwards.
--
-- What is *not* copied is a ranking model. TikTok's weights are server-side and
-- not in the APK; these weights are a starting point chosen to be explainable,
-- and every one of them is returned with the item so they can be argued with.
--
-- Idempotent: safe to replay, which is what `setup.sql` and the test runner do.

-- ---------------------------------------------------------------- signals ---

create table if not exists public.post_feedback (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  viewer_id  bigint not null references public.profiles(id) on delete cascade,
  -- 'view' is an impression with a duration; the rest are deliberate acts.
  -- 'skip' is a view that ended early, 'hide' is "not interested" and is
  -- permanent for that viewer.
  kind       text not null check (kind in ('view', 'like', 'comment', 'save', 'share', 'skip', 'hide')),
  dwell_ms   integer check (dwell_ms is null or (dwell_ms >= 0 and dwell_ms <= 3600000)),
  completed  boolean not null default false,
  position   integer check (position is null or position >= 0),
  created_at bigint not null default public.now_ms()
);

create index if not exists post_feedback_post_idx
  on public.post_feedback (post_id, created_at desc);
create index if not exists post_feedback_viewer_idx
  on public.post_feedback (viewer_id, created_at desc);
create index if not exists post_feedback_viewer_post_idx
  on public.post_feedback (viewer_id, post_id, kind);

alter table public.post_feedback enable row level security;

-- Your own signal trail is yours to read (it is what "why am I seeing this"
-- will be built on). Writes go through the functions below, which check that the
-- post is visible to you at all.
drop policy if exists post_feedback_select_own on public.post_feedback;
create policy post_feedback_select_own on public.post_feedback
  for select to authenticated using (viewer_id = public.me_id());

-- ---------------------------------------------------------------- writers ---

create or replace function public.record_post_view(
  p_post_id  bigint,
  p_dwell_ms integer,
  p_completed boolean default false,
  p_position integer default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me   bigint := public.me_id();
  post public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into post from posts where id = p_post_id;
  if not found or not public.can_view_post(post, me) then
    perform public.crushly_fail(404, 'not_found', 'That post is no longer available.');
  end if;

  -- A view is recorded at most once every 30 seconds per viewer, so a client
  -- that re-renders a screen cannot inflate its own feed.
  if exists (
    select 1 from post_feedback f
     where f.post_id = p_post_id and f.viewer_id = me and f.kind in ('view', 'skip')
       and f.created_at > public.now_ms() - 30000
  ) then
    return jsonb_build_object('recorded', false, 'reason', 'too_soon');
  end if;

  -- A skip is a glance, a view is a read. The client does not get to decide
  -- which: it reports whether the clip finished and for how long it was held,
  -- and the threshold below is what separates the two. If this lived on the
  -- client, a bug there would silently redefine the ranking signal.
  insert into post_feedback (post_id, viewer_id, kind, dwell_ms, completed, position)
  values (
    p_post_id, me,
    case when coalesce(p_completed, false) or coalesce(p_dwell_ms, 0) >= 1500
         then 'view' else 'skip' end,
    least(greatest(coalesce(p_dwell_ms, 0), 0), 3600000),
    coalesce(p_completed, false),
    p_position
  );

  return jsonb_build_object('recorded', true);
end $$;

create or replace function public.record_post_feedback(p_post_id bigint, p_kind text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me   bigint := public.me_id();
  post public.posts;
  k    text := lower(coalesce(p_kind, ''));
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if k not in ('like', 'comment', 'save', 'share', 'hide') then
    perform public.crushly_fail(400, 'bad_kind', 'Unknown feedback kind.');
  end if;
  select * into post from posts where id = p_post_id;
  if not found or not public.can_view_post(post, me) then
    perform public.crushly_fail(404, 'not_found', 'That post is no longer available.');
  end if;

  -- One row per (post, viewer, kind): saying it twice is saying it once.
  if not exists (
    select 1 from post_feedback f
     where f.post_id = p_post_id and f.viewer_id = me and f.kind = k
  ) then
    insert into post_feedback (post_id, viewer_id, kind) values (p_post_id, me, k);
  end if;

  return jsonb_build_object('recorded', true, 'kind', k);
end $$;

-- --------------------------------------------------------------- the ranker ---
--
-- Score, in words:
--
--   engagement velocity  what has happened to the post, per hour of its life,
--                        weighted so a comment is worth more than a like and a
--                        save is worth more than a view
--   recency              a three-day half-life, so nothing is permanently
--                        buried but nothing stale outranks something fresh
--   affinity             how much this viewer has engaged with this author in
--                        the last 30 days — the same signal TikTok's client
--                        reports and its server acts on
--   exploration          a boost for posts nobody has seen, which is what stops
--                        the feed from being a rich-get-richer loop
--   diversity            the second post from one author in a page is worth
--                        roughly 60% of the first, the third less again
--
-- A post the viewer has already been shown in the last three days is suppressed
-- unless there is not enough fresh material to fill the page, in which case it
-- comes back at 30% of its score. On a small network that matters: an empty feed
-- is a worse failure than a repeat.

create or replace function public.flow_ranked_feed(p_limit integer default 8, p_cursor jsonb default null)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with me_v as (
    select public.me_id() as me, public.now_ms() as t
  ),
  cursor_v as (
    select
      case when p_cursor is null then null else nullif(p_cursor ->> 'score', '')::numeric end as score,
      case when p_cursor is null then null else nullif(p_cursor ->> 'id', '')::bigint    end as id
  ),
  lim as (
    select least(greatest(coalesce(p_limit, 8), 1), 30) as n
  ),
  cand as (
    select
      po.id, po.author_id, po.created_at, po.circle_id,
      (m.t - po.created_at) / 3600000.0 as age_h,
      coalesce(s.likes, 0)    as likes,
      coalesce(s.comments, 0) as comments,
      coalesce(s.saves, 0)    as saves,
      coalesce(s.shares, 0)   as shares,
      coalesce(s.views, 0)    as views,
      coalesce(a.n, 0)        as affinity,
      exists (
        select 1 from post_feedback f
         where f.post_id = po.id and f.viewer_id = m.me and f.kind in ('view', 'skip')
           and f.created_at > m.t - 3 * 86400000
      ) as seen
    from posts po
    cross join me_v m
    left join lateral (
      select
        (select count(*) from post_reactions r where r.post_id = po.id) as likes,
        (select count(*) from post_comments c where c.post_id = po.id) as comments,
        (select count(*) from post_saves   s where s.post_id = po.id) as saves,
        (select count(*) from post_feedback f
          where f.post_id = po.id and f.kind = 'share')              as shares,
        (select count(*) from post_feedback f
          where f.post_id = po.id and f.kind in ('view', 'skip'))    as views
    ) s on true
    left join lateral (
      select count(*) as n
        from post_feedback f
        join posts p2 on p2.id = f.post_id
       where f.viewer_id = m.me
         and p2.author_id = po.author_id
         and f.kind in ('like', 'comment', 'save', 'share')
         and f.created_at > m.t - 2592000000::bigint  -- 30 days, in ms (too big for int4)
    ) a on true
    where po.circle_id is null
      and public.can_view_post(po, m.me)
      and not exists (
        select 1 from post_feedback f
         where f.post_id = po.id and f.viewer_id = m.me and f.kind = 'hide'
      )
  ),
  scored as (
    select c.*,
      -- velocity: engagement per hour, softened so a brand-new post is not
      -- divided by zero and does not win on a single like
      ((c.likes + 3 * c.comments + 3 * c.saves + 2 * c.shares)
        / power(c.age_h + 2, 1.5))                                        as velocity,
      exp(-c.age_h / 72.0)                                                as recency,
      (1 + 0.6 * ln(1 + c.affinity))                                      as affinity_w,
      0.6 * exp(-c.views / 20.0)                                          as explore,
      (count(*) filter (where not c.seen) over ())                        as fresh_total
    from cand c
  ),
  raw_scored as (
    select s.*,
      -- Recency multiplies the whole score, not just the engagement term. Left
      -- outside it, the exploration boost made a six-week-old post with no
      -- engagement score exactly the same as a five-minute-old one — the test
      -- that asks "does fresh beat stale" is what caught it.
      (s.velocity * s.affinity_w + s.explore) * s.recency as raw
    from scored s
  ),
  diversified as (
    select r.*,
      row_number() over (partition by r.author_id order by r.raw desc, r.id desc) as author_rn
    from raw_scored r
  ),
  scored_final as (
    select d.*,
      case when d.seen then 0.3 else 1.0 end * d.raw / (1 + 0.6 * (d.author_rn - 1)) as score
    from diversified d
    -- keep the fresh pool if it can fill the page; otherwise let seen posts back in
    cross join lim l
    where (d.fresh_total >= l.n and not d.seen) or d.fresh_total < l.n
  ),
  page as (
    select f.*,
      row_number() over (order by f.score desc, f.id desc) as position
    from scored_final f
    cross join cursor_v c
    where c.score is null or (f.score, f.id) < (c.score, c.id)
    order by f.score desc, f.id desc
    limit (select n from lim)
  )
  select jsonb_build_object(
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'body', po.body,
          'mediaUrl', po.media_url,
          'mediaKind', case
            when po.media_url is null then null
            when po.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'edit', po.edit,
          'audience', po.audience,
          'circleId', po.circle_id,
          'createdAt', po.created_at,
          'author', public.public_profile(m.me, po.author_id, false),
          'mine', po.author_id = m.me,
          -- the reason this post is here, in numbers, for the client's
          -- "why am I seeing this" and for the tests
          'rank', jsonb_build_object(
            'position', p.position,
            'score', round(p.score::numeric, 6),
            'velocity', round(p.velocity::numeric, 6),
            'recency', round(p.recency::numeric, 6),
            'affinity', p.affinity,
            'explore', round(p.explore::numeric, 6),
            'diversityRank', p.author_rn,
            'seenBefore', p.seen
          )
        ) || public.post_engagement(p.id, m.me)
        order by p.position
      ),
      '[]'::jsonb
    ),
    'nextCursor', (
      select jsonb_build_object('score', last_row.score::numeric, 'id', last_row.id)
        from (
          select p2.score, p2.id
            from page p2
           order by p2.position desc
           limit 1
        ) last_row
    ),
    'ranking', jsonb_build_object(
      'candidates', (select count(*) from raw_scored),
      'fresh', (select max(fresh_total) from scored),
      'returned', (select count(*) from page)
    )
  )
  from page p
  join posts po on po.id = p.id
  cross join me_v m;
$function$;

revoke all on function public.record_post_view(bigint, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.record_post_feedback(bigint, text) from public, anon, authenticated;
revoke all on function public.flow_ranked_feed(integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_post_view(bigint, integer, boolean, integer) to authenticated, service_role;
grant execute on function public.record_post_feedback(bigint, text) to authenticated, service_role;
grant execute on function public.flow_ranked_feed(integer, jsonb) to authenticated, service_role;
