-- Keep Close: the people you want near.
--
-- A Connection is mutual, and it is a big word. Keep Close is smaller, and it
-- is yours alone: it means "I want to see what this person shares", and it asks
-- nothing back. You can Keep Close anyone you can see — the two of you do not
-- have to have Clicked.
--
-- Two rules keep it from being a weapon. Cutting someone off severs the
-- keeping in both directions, so a member you have cut off cannot stay in your
-- Close Ones and you cannot stay in theirs. And the list is private: you see
-- yours, nobody sees anyone else's. Another member's Space shows you a count
-- and one quiet yes-or-no — whether they keep you close — and nothing about
-- who else does.

create table if not exists public.keeps (
  keeper_id  bigint not null references public.profiles(id) on delete cascade,
  kept_id    bigint not null references public.profiles(id) on delete cascade,
  created_at bigint not null default public.now_ms(),
  primary key (keeper_id, kept_id),
  check (keeper_id <> kept_id)
);

create index if not exists keeps_kept_idx on public.keeps (kept_id, created_at desc);

alter table public.keeps enable row level security;

-- Only your own list is queryable, and even that the app reads through
-- close_ones(). Who keeps *you* close is not a table anybody may sweep.
drop policy if exists keeps_select_own on public.keeps;
create policy keeps_select_own on public.keeps
  for select to authenticated using (keeper_id = public.me_id());

-- Cutting someone off should end the keeping, in both directions, the moment
-- it happens — without every call site having to remember to do it.
create or replace function public.keeps_severed_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.keeps k
   where (k.keeper_id = new.blocker_id and k.kept_id = new.blocked_id)
      or (k.keeper_id = new.blocked_id and k.kept_id = new.blocker_id);
  return null;
end $$;

drop trigger if exists blocks_sever_keeps on public.blocks;
create trigger blocks_sever_keeps after insert on public.blocks
  for each row execute function public.keeps_severed_on_block();

-- Everything the app needs to draw the Keep Close button on a Space, in one
-- call: what I have done, what they have done, and the two counts.
create or replace function public.keep_state(p_member_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_member_id is null or me = p_member_id then
    return jsonb_build_object('keeps', false, 'keepsYou', false, 'keepsCount', 0, 'keptByCount', 0, 'self', true);
  end if;
  -- Someone you have cut off, or who has cut you off, gets nothing at all.
  if public.is_blocked_pair(me, p_member_id) then
    return jsonb_build_object('keeps', false, 'keepsYou', false, 'keepsCount', 0, 'keptByCount', 0, 'self', false);
  end if;

  return jsonb_build_object(
    'keeps',       exists (select 1 from keeps k where k.keeper_id = me and k.kept_id = p_member_id),
    'keepsYou',    exists (select 1 from keeps k where k.keeper_id = p_member_id and k.kept_id = me),
    'keepsCount',  (select count(*) from keeps k where k.keeper_id = p_member_id),
    'keptByCount', (select count(*) from keeps k where k.kept_id = p_member_id),
    'self',        false
  );
end $$;

create or replace function public.keep_close(p_member_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  n  int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_member_id is null or me = p_member_id then
    perform public.crushly_fail(400, '', 'You can’t keep yourself close.');
  end if;
  if not exists (select 1 from profiles p where p.id = p_member_id and p.status = 'active') then
    perform public.crushly_fail(404, '', 'Member not found.');
  end if;
  if public.is_blocked_pair(me, p_member_id) then
    perform public.crushly_fail(403, '', 'You can’t keep this member close.');
  end if;

  -- A hundred a day is far past what a person does by hand and far short of
  -- what it takes to farm a follower list.
  select count(*) into n from keeps k
   where k.keeper_id = me and k.created_at > public.now_ms() - 86400 * 1000;
  if n >= 100 then
    perform public.crushly_fail(429, '', 'That’s a lot for one day — try again tomorrow.');
  end if;

  insert into keeps (keeper_id, kept_id) values (me, p_member_id) on conflict do nothing;
  return public.keep_state(p_member_id);
end $$;

-- Letting go is not an accusation and it is not announced: the row simply
-- goes, and the other member is never told.
create or replace function public.let_go(p_member_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  delete from keeps k where k.keeper_id = me and k.kept_id = p_member_id;
  return true;
end $$;

-- Your Close Ones. Yours only — there is no way to ask for somebody else's.
create or replace function public.close_ones(p_limit integer default 50, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select k.kept_id, k.created_at
      from keeps k
     where k.keeper_id = me
       and not public.is_blocked_pair(me, k.kept_id)
       and (
         p_after is null
         or k.created_at < (select k2.created_at from keeps k2 where k2.keeper_id = me and k2.kept_id = p_after)
         or (
           k.created_at = (select k2.created_at from keeps k2 where k2.keeper_id = me and k2.kept_id = p_after)
           and k.kept_id < p_after
         )
       )
     order by k.created_at desc, k.kept_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
  loop
    items := items || jsonb_build_array(jsonb_build_object(
      'member',   public.public_profile(me, r.kept_id, false),
      'keepsYou', exists (select 1 from keeps k where k.keeper_id = r.kept_id and k.kept_id = me),
      'keptAt',   r.created_at
    ));
  end loop;

  return jsonb_build_object('items', items);
end $$;

revoke all on function public.keep_state(bigint) from public, anon, authenticated;
grant execute on function public.keep_state(bigint) to authenticated, service_role;
revoke all on function public.keep_close(bigint) from public, anon, authenticated;
grant execute on function public.keep_close(bigint) to authenticated, service_role;
revoke all on function public.let_go(bigint) from public, anon, authenticated;
grant execute on function public.let_go(bigint) to authenticated, service_role;
revoke all on function public.close_ones(integer, bigint) from public, anon, authenticated;
grant execute on function public.close_ones(integer, bigint) to authenticated, service_role;
