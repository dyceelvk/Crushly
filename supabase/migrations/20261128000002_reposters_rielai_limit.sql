-- 20261128000002 — reposters list, RielAi's daily thirteen, and the record of
-- the sound-page stats extension from the same round.
--
-- Every statement here is re-run-safe (IF NOT EXISTS / OR REPLACE / guarded),
-- because it was applied live first and must survive a later `db push` without
-- clobbering data.

-- Who reposted a post: one entry per person, with the moment they did it.
create or replace function public.post_reposters(p_post_id bigint, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'author', public.public_profile(public.me_id(), r.reposter_id, false),
    'at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  from (
    select reposter_id, created_at from post_reposts
     where original_post_id = p_post_id
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) r
  where public.me_id() is not null
    and public.can_view_post((select po from posts po where po.id = p_post_id), public.me_id())
    and not public.is_blocked_pair(public.me_id(), r.reposter_id)
$fn$;

-- RielAi: thirteen conversations per member per day, then the day is done.
create table if not exists public.rielai_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n integer not null default 0,
  primary key (user_id, day)
);
alter table public.rielai_daily enable row level security;
drop policy if exists rielai_daily_own on public.rielai_daily;
create policy rielai_daily_own on public.rielai_daily
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.rielai_tick()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare
  me uuid := auth.uid();
  v integer;
begin
  if me is null then return -1; end if;
  insert into public.rielai_daily (user_id, day, n) values (me, current_date, 1)
    on conflict (user_id, day) do update set n = rielai_daily.n + 1
    returning n into v;
  return v;
end $fn$;

-- Relatable search terms: words the week's posts and comments keep using,
-- stopword-filtered, for the slideshow box above the videos.
create or replace function public.flow_suggestions(p_limit integer default 8)
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
with src as (
  select lower(coalesce(p.body, '')) as b from posts p
   where p.created_at > public.now_ms() - 30 * 86400000::bigint
     and p.circle_id is null
     and public.can_view_post(p, public.me_id())
  union all
  select lower(coalesce(c.body, '')) from post_comments c join posts p on p.id = c.post_id
   where c.created_at > public.now_ms() - 30 * 86400000::bigint and not c.hidden
     and public.can_view_post(p, public.me_id())
), words as (
  select w from src, lateral regexp_split_to_table(src.b, '[^a-z]{2,}') as w
   where length(w) between 4 and 14
), stops(w) as (values
  ('about'),('after'),('again'),('also'),('been'),('being'),('because'),('before'),
  ('between'),('could'),('didnt'),('doesnt'),('dont'),('every'),('from'),('going'),
  ('have'),('here'),('just'),('know'),('like'),('more'),('never'),('only'),('other'),
  ('over'),('really'),('said'),('should'),('some'),('still'),('such'),('take'),('than'),
  ('that'),('their'),('them'),('then'),('there'),('these'),('they'),('this'),('those'),
  ('through'),('very'),('want'),('wasnt'),('well'),('were'),('what'),('when'),('where'),
  ('which'),('while'),('with'),('would'),('your')
)
select coalesce(jsonb_agg(jsonb_build_object('term', x.t) order by x.n desc), '[]'::jsonb)
  from (select w as t, count(*) as n from words where w not in (select w from stops)
        group by w order by n desc limit least(greatest(coalesce(p_limit, 8), 1), 16)) x
$fn$;

-- Chats are not kept by default. A conversation either gets backed up — one
-- row per member — or its messages expire at 30 days, media queued for
-- permanent deletion through the same queue a delete uses.
create table if not exists public.chat_backups (
  conversation_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  backed_up_at bigint not null default public.now_ms(),
  primary key (conversation_id, user_id)
);
alter table public.chat_backups enable row level security;
drop policy if exists chat_backups_own on public.chat_backups;
create policy chat_backups_own on public.chat_backups
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.purge_expired_messages(p_conversation_id bigint)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare
  me uuid := auth.uid();
  v integer := 0;
  r record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if exists (select 1 from public.chat_backups b where b.conversation_id = p_conversation_id) then
    return 0;
  end if;
  for r in select id, media_url from public.messages
            where conversation_id = p_conversation_id
              and created_at < public.now_ms() - 30 * 86400000
  loop
    perform public.queue_media_deletion(r.media_url, 'message_expired');
    delete from public.messages where id = r.id;
    v := v + 1;
  end loop;
  return v;
end $fn$;

-- Repost thoughts: what the reposter says rides under the label, not as a
-- caption and not as a comment.
alter table public.post_reposts add column if not exists thought text;
create or replace function public.set_repost_thought(p_post_id bigint, p_thought text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  me bigint := public.me_id();
  v text := left(btrim(coalesce(p_thought, '')), 240);
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  update public.post_reposts set thought = nullif(v, '')
   where original_post_id = p_post_id and reposter_id = me;
  if not found then
    perform public.crushly_fail(404, 'not_your_repost', 'Repost this first, then add your thought.');
  end if;
  return jsonb_build_object('postId', p_post_id, 'thought', nullif(v, ''));
end $fn$;
