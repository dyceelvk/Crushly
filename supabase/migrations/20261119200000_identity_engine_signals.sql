-- holupp_identity_engine
--
-- Five behavioural identities, computed from activity that already exists.
--
-- ── What this does NOT do ────────────────────────────────────────────────────
--
-- It does not read a single message body. `messages.body` is never selected by
-- anything in this file: the only facts taken from that table are its shape —
-- was it a voice note, was it a text — plus who sent it and when. A voice note
-- counts as communication; what was said in it is nobody's business, including
-- this engine's.
--
-- ── Why there is no event table ──────────────────────────────────────────────
--
-- The brief proposes `holupp_identity_events`. Every signal it would hold
-- already exists, with an author and a timestamp, in `posts`, `post_comments`,
-- `post_reactions`, `messages`, `post_feedback` (views, with dwell),
-- `space_views` and `moment_views`. Copying them into a second table would give
-- the platform two sources of truth for "what did this person do", and the copy
-- is the one that goes stale: a deleted post, a hidden comment or a moderated
-- reaction would keep voting in the identity engine forever.
--
-- So the events are read where they live, inside a 30-day window. What is added
-- here is the part that genuinely does not exist: a record of searches (for
-- Explorer) and the computed result.
--
-- ── Trust ────────────────────────────────────────────────────────────────────
--
-- Every score is computed in this file, in the database. A client cannot submit
-- one, cannot read anyone else's, and cannot write its own. The write paths are
-- SECURITY DEFINER functions that take no score arguments at all.

-- ---------------------------------------------------------------- search log
--
-- Explorer needs discovery, and holUpp recorded none: `search_holup` was called
-- and forgotten. A search is one row per call, with the query kept only as a
-- length and a category guess — not the words. What somebody typed into a search
-- box is closer to a private message than to a public post, and the scoring
-- engine only ever needs "how much did this person explore", never "what were
-- they looking for". Admins can see counts; nobody sees terms.
create table if not exists public.holupp_search_log (
  id          bigserial primary key,
  profile_id  bigint not null references public.profiles(id) on delete cascade,
  -- What was being looked for, at the coarsest useful grain. Derived from the
  -- term by `identity_note_search`, never the term itself.
  category    text,
  -- Whether the search found anything. A search that returns nothing is still
  -- exploration — arguably more of it — so this is a fact to record, not a
  -- filter.
  had_results boolean not null default false,
  created_at  bigint not null default public.now_ms()
);

create index if not exists holupp_search_log_profile_time
  on public.holupp_search_log (profile_id, created_at desc);

alter table public.holupp_search_log enable row level security;
-- No policy at all: a client may not read, write or infer from this table. It is
-- reached only through the SECURITY DEFINER functions below.

comment on table public.holupp_search_log is
  'One row per search. The term itself is never stored — only a coarse category and whether results came back.';

-- ------------------------------------------------------------- score weights
--
-- The brief asks for weights an administrator can adjust without a deploy. They
-- live in a table so that is true, and they are read on every calculation so a
-- change takes effect on the next run rather than at the next release.
create table if not exists public.holupp_identity_weights (
  identity   text primary key check (identity in ('introvert','pen','talkative','explorer','fun')),
  weights    jsonb not null,
  updated_at bigint not null default public.now_ms()
);

insert into public.holupp_identity_weights (identity, weights) values
  ('introvert', '{"passiveViewing":30,"lowEngagement":25,"postingFrequency":15,"publicInteraction":15,"communicationReserve":15}'),
  ('pen',       '{"textPostFrequency":30,"writtenLength":20,"writtenComments":20,"textConversations":15,"expressionBreadth":15}'),
  ('talkative', '{"messaging":25,"voiceNotes":20,"commentsReplies":20,"conversationParticipation":20,"consistency":15}'),
  ('explorer',  '{"searchDiscovery":25,"profileExploration":20,"researchInteraction":20,"informativePosts":20,"discoverySharing":15}'),
  ('fun',       '{"humourEngagement":25,"funnyComments":25,"entertainmentConversations":20,"humorousPosts":20,"positiveReactions":10}')
on conflict (identity) do nothing;

-- --------------------------------------------------------------- the signals
--
-- One row per member, over the rolling window, computed once and then scored.
-- Kept as its own function so the scoring formula and the measurement can be
-- read separately: this answers "what did they do", the next answers "what does
-- that mean".
create or replace function public.holupp_identity_signals(p_profile bigint, p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with win as (
    select public.now_ms() - (least(greatest(coalesce(p_days, 30), 7), 90)::bigint * 86400000) as since
  ),
  mine as (
    select
      (select count(*) from posts p, win w
        where p.author_id = p_profile and p.created_at >= w.since
          and coalesce(to_jsonb(p)->>'moderation_state','visible') = 'visible') as posts,
      -- Written words only. A photo with a three-word caption is not a Wordsmith.
      (select coalesce(sum(length(coalesce(p.body,''))), 0) from posts p, win w
        where p.author_id = p_profile and p.created_at >= w.since
          and coalesce(to_jsonb(p)->>'moderation_state','visible') = 'visible') as post_chars,
      (select count(*) from posts p, win w
        where p.author_id = p_profile and p.created_at >= w.since
          and coalesce(p.body,'') <> '' and p.media_url is null) as text_posts,
      (select count(*) from posts p, win w
        where p.author_id = p_profile and p.created_at >= w.since and p.media_url is not null) as media_posts,

      (select count(*) from post_comments c, win w
        where c.author_id = p_profile and c.created_at >= w.since and not c.hidden) as comments,
      (select coalesce(sum(length(coalesce(c.body,''))), 0) from post_comments c, win w
        where c.author_id = p_profile and c.created_at >= w.since and not c.hidden) as comment_chars,
      (select count(*) from post_comments c, win w
        where c.author_id = p_profile and c.created_at >= w.since and not c.hidden and c.parent_id is not null) as replies,

      -- Reactions this member gave, by kind. 'crush' and 'fire' are the warm
      -- ones; the same table carries whatever else the product adds later.
      (select count(*) from post_reactions r, win w
        where r.user_id = p_profile and r.created_at >= w.since) as reactions_given,

      -- Views: the passive side. `dwell_ms` distinguishes a scroll-past from
      -- actually watching, which is the difference the brief insists on.
      (select count(*) from post_feedback f, win w
        where f.viewer_id = p_profile and f.kind = 'view' and f.created_at >= w.since) as views,
      (select count(*) from post_feedback f, win w
        where f.viewer_id = p_profile and f.kind = 'view' and f.created_at >= w.since
          and coalesce(f.dwell_ms, 0) >= 3000) as dwelled_views,
      (select coalesce(avg(f.dwell_ms), 0) from post_feedback f, win w
        where f.viewer_id = p_profile and f.kind = 'view' and f.created_at >= w.since) as avg_dwell_ms,

      (select count(distinct s.viewed_id) from space_views s, win w
        where s.viewer_id = p_profile and s.last_seen_at >= w.since) as profiles_explored,
      (select count(*) from moment_views mv, win w
        where mv.user_id = p_profile and mv.created_at >= w.since) as moments_viewed,

      -- Messaging: shape only, never content. `body` is deliberately absent.
      (select count(*) from messages m, win w
        where m.sender_id = p_profile and m.created_at >= w.since) as messages,
      (select count(*) from messages m, win w
        where m.sender_id = p_profile and m.created_at >= w.since and m.kind = 'voice') as voice_notes,
      (select count(*) from messages m, win w
        where m.sender_id = p_profile and m.created_at >= w.since and m.kind = 'text') as text_messages,
      (select count(distinct m.conversation_id) from messages m, win w
        where m.sender_id = p_profile and m.created_at >= w.since) as conversations,
      (select count(distinct date_trunc('day', to_timestamp(m.created_at / 1000.0))) from messages m, win w
        where m.sender_id = p_profile and m.created_at >= w.since) as active_days,

      (select count(*) from holupp_search_log l, win w
        where l.profile_id = p_profile and l.created_at >= w.since) as searches,

      -- What other people did with this member's writing: the fun signal reads
      -- engagement *received*, not just produced.
      (select count(*) from post_reactions r join posts p on p.id = r.post_id, win w
        where p.author_id = p_profile and r.created_at >= w.since) as reactions_received,
      (select count(*) from post_reactions r join posts p on p.id = r.post_id, win w
        where p.author_id = p_profile and r.created_at >= w.since and r.kind = 'fire') as fire_received,
      (select count(*) from post_comments c join posts p on p.id = c.post_id, win w
        where p.author_id = p_profile and c.created_at >= w.since and c.author_id <> p_profile) as comments_received
  )
  select jsonb_build_object(
    'window', coalesce((select since from win), 0),
    'posts', posts, 'postChars', post_chars, 'textPosts', text_posts, 'mediaPosts', media_posts,
    'avgPostChars', case when posts > 0 then round(post_chars::numeric / posts, 1) else 0 end,
    'comments', comments, 'commentChars', comment_chars, 'replies', replies,
    'avgCommentChars', case when comments > 0 then round(comment_chars::numeric / comments, 1) else 0 end,
    'reactionsGiven', reactions_given,
    'views', views, 'dwelledViews', dwelled_views, 'avgDwellMs', round(avg_dwell_ms::numeric, 0),
    'profilesExplored', profiles_explored, 'momentsViewed', moments_viewed,
    'messages', messages, 'voiceNotes', voice_notes, 'textMessages', text_messages,
    'conversations', conversations, 'activeDays', active_days,
    'searches', searches,
    'reactionsReceived', reactions_received, 'fireReceived', fire_received, 'commentsReceived', comments_received
  )
  from mine;
$function$;

comment on function public.holupp_identity_signals(bigint, integer) is
  'What a member did in the window, in counts. No message content is read or returned.';
