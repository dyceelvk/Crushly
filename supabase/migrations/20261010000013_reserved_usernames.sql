-- Reserved handles.
--
-- Nobody should be able to be @support, @admin or @rielinc. Impersonating staff
-- is the oldest trick there is, and a member who looks official can talk people
-- out of money, photos or personal details before anyone thinks to check.
--
-- A reserved handle is simply one nobody may claim — unless it has an owner,
-- which is how Riel Inc.'s own account takes @rielinc without opening the door
-- to everybody else. Setting that owner is done here, in a migration, not by
-- anything a member can reach from the app.

create table if not exists public.reserved_usernames (
  handle    text primary key,
  owner_id  bigint references public.profiles(id) on delete set null,
  note      text not null default ''
);

alter table public.reserved_usernames enable row level security;

-- Anyone signed in may read the list — it is not a secret, and seeing it saves
-- someone from wondering why a handle they fancied is unavailable. Only
-- migrations write to it.
drop policy if exists reserved_usernames_read on public.reserved_usernames;
create policy reserved_usernames_read on public.reserved_usernames
  for select to authenticated using (true);

insert into public.reserved_usernames (handle, note) values
  ('rielinc', 'Riel Inc. official'),
  ('riel', 'Riel Inc.'),
  ('crushly', 'The service itself'),
  ('crushlyapp', 'The service itself'),
  ('admin', 'Staff'),
  ('administrator', 'Staff'),
  ('moderator', 'Staff'),
  ('moderation', 'Staff'),
  ('support', 'Staff'),
  ('help', 'Staff'),
  ('safety', 'Staff'),
  ('security', 'Staff'),
  ('billing', 'Staff'),
  ('team', 'Staff'),
  ('official', 'Staff'),
  ('staff', 'Staff'),
  ('founder', 'Staff'),
  ('ceo', 'Staff'),
  ('legal', 'Staff'),
  ('privacy', 'Staff'),
  ('terms', 'Staff'),
  ('abuse', 'Staff'),
  ('system', 'Reserved'),
  ('root', 'Reserved'),
  ('null', 'Reserved'),
  ('undefined', 'Reserved'),
  ('test', 'Reserved'),
  ('verified', 'Could be mistaken for a badge')
on conflict (handle) do nothing;

-- Nobody can be given a handle that is already somebody's: reserved words are
-- for the future, not for taking something away from a member who has it.
delete from public.reserved_usernames r
 where r.owner_id is null
   and exists (select 1 from profiles p where p.username = r.handle);

-- Is this handle free? Says nothing about who holds a taken one, so it cannot
-- be used to fish for accounts.
create or replace function public.username_available(p_username text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if v !~ '^[a-z0-9_]{3,20}$' then return false; end if;
  if v ~ '^[0-9_]+$' then return false; end if;           -- not a row of numbers or underscores
  if exists (select 1 from reserved_usernames r where r.handle = v and (r.owner_id is null or r.owner_id <> me)) then
    return false;
  end if;
  return not exists (select 1 from profiles p where p.username = v and p.id <> coalesce(me, -1));
end $$;

create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v text := lower(btrim(coalesce(p_username, '')));
  changed bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if v = '' then
    perform public.crushly_fail(400, '', 'Pick a username.');
  elsif length(v) < 3 then
    perform public.crushly_fail(400, '', 'Usernames are at least 3 characters.');
  elsif length(v) > 20 then
    perform public.crushly_fail(400, '', 'Usernames are at most 20 characters.');
  elsif v ~ '^[0-9_]+$' then
    perform public.crushly_fail(400, '', 'Use at least one letter.');
  elsif v !~ '^[a-z0-9_]+$' then
    perform public.crushly_fail(400, '', 'Letters, numbers and underscores only.');
  end if;

  -- Reserved so nobody can pass themselves off as staff or as the company.
  if exists (select 1 from reserved_usernames r where r.handle = v and (r.owner_id is null or r.owner_id <> me)) then
    perform public.crushly_fail(409, '', 'That username is reserved.');
  end if;

  select p.username_updated_at into changed from profiles p where p.id = me;
  if changed is not null and public.now_ms() - changed < 24 * 60 * 60 * 1000 then
    perform public.crushly_fail(429, '', 'You can change your username once a day.');
  end if;

  if exists (select 1 from profiles p where p.username = v and p.id <> me) then
    perform public.crushly_fail(409, '', 'That username is taken.');
  end if;

  update profiles
     set username = v,
         username_updated_at = case when username = v then username_updated_at else public.now_ms() end,
         updated_at = public.now_ms()
   where id = me;

  return jsonb_build_object('username', v);
end $$;
