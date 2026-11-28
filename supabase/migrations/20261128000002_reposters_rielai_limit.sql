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
