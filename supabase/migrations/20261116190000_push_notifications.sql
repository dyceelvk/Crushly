-- Push notifications: the table that remembers a phone, and the trigger that
-- wakes the sender.
--
-- Until now the app could only tell somebody about a Whisper while it was open,
-- because a closed app is not running to ask. Android's answer to that is FCM: the
-- server hands a message to Google, Google wakes the phone. That needs two things
-- this migration provides — somewhere to keep each phone's token, and a trigger
-- that tells the `push-dispatch` function the moment something arrives.
--
-- Deliberately no new event model: it hangs off the `notifications` and
-- `messages` rows that already exist. If a row is not there, nobody is told.

/* ------------------------------------------------------------- device tokens */

create table if not exists public.device_tokens (
  id          bigserial primary key,
  profile_id  bigint not null references public.profiles (id) on delete cascade,
  -- The FCM registration token. Unique: the same phone re-registering after a
  -- reinstall must update the row, not create a second one that never gets cleaned.
  token       text not null unique,
  platform    text not null default 'android',
  -- Which chime this phone has chosen, so a notification that arrives while the
  -- app is closed plays the sound its owner picked rather than a default.
  sound       text,
  created_at  bigint not null,
  updated_at  bigint not null
);

create index if not exists device_tokens_profile_idx on public.device_tokens (profile_id);

alter table public.device_tokens enable row level security;

drop policy if exists device_tokens_own on public.device_tokens;
create policy device_tokens_own on public.device_tokens
  for all to authenticated
  using (profile_id in (select id from public.profiles where auth_user_id = auth.uid()))
  with check (profile_id in (select id from public.profiles where auth_user_id = auth.uid()));

grant select, insert, update, delete on public.device_tokens to authenticated;
grant usage, select on sequence public.device_tokens_id_seq to authenticated;

-- The app never needs to know its own profile id to register a phone, and a
-- function that resolves it server-side cannot be talked into registering a token
-- against somebody else's account.
create or replace function public.register_device_token(
  p_token text,
  p_platform text default 'android',
  p_sound text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile bigint;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'invalid device token';
  end if;
  select id into v_profile from public.profiles where auth_user_id = auth.uid();
  if v_profile is null then
    raise exception 'no profile for this session';
  end if;
  insert into public.device_tokens as d (profile_id, token, platform, sound, created_at, updated_at)
  values (v_profile, p_token, coalesce(nullif(p_platform, ''), 'android'), p_sound, v_now, v_now)
  on conflict (token) do update set
    profile_id = excluded.profile_id,
    platform   = excluded.platform,
    sound      = coalesce(excluded.sound, d.sound),
    updated_at = excluded.updated_at;
end $$;

create or replace function public.set_device_sound(p_token text, p_sound text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.device_tokens d set sound = p_sound, updated_at = (extract(epoch from now()) * 1000)::bigint
  where d.token = p_token
    and d.profile_id in (select id from public.profiles where auth_user_id = auth.uid());
end $$;

create or replace function public.unregister_device_token(p_token text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.device_tokens d
  where d.token = p_token
    and d.profile_id in (select id from public.profiles where auth_user_id = auth.uid());
end $$;

revoke all on function public.register_device_token(text, text, text) from public, anon;
revoke all on function public.set_device_sound(text, text) from public, anon;
revoke all on function public.unregister_device_token(text) from public, anon;
grant execute on function public.register_device_token(text, text, text) to authenticated;
grant execute on function public.set_device_sound(text, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;

/* ---------------------------------------------------------------- dispatch */

-- Every send is recorded. A push system that cannot be inspected is one that is
-- "working" right up until somebody says it never arrived.
create table if not exists public.push_attempts (
  id           bigserial primary key,
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  recipient_id bigint,
  source       text,
  record_id    bigint,
  title        text,
  body         text,
  sent         int not null default 0,
  failed       int not null default 0,
  note         text
);

alter table public.push_attempts enable row level security;
revoke all on public.push_attempts from anon, authenticated;

-- Where to call and with what. Server-only: no grants to anon/authenticated, so
-- the dispatch key cannot be read by a client even if a policy were misconfigured.
create table if not exists public.push_config (
  id           int primary key default 1,
  dispatch_url text not null,
  dispatch_key text not null,
  enabled      boolean not null default true
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- `pg_net` is what the trigger uses to make the HTTP call. It is present on Supabase
-- and absent from a bare Postgres, which is what CI applies these migrations to —
-- so its absence must not fail the migration. Without it the trigger still compiles
-- and simply returns early, and the app's own poll keeps working.
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable (%): push trigger will not queue', sqlerrm;
end $$;

-- One trigger function for both tables: it does not decide anything about who is
-- told or what it says — that judgement lives in `push-dispatch`, where it can be
-- changed without a migration.
create or replace function public.push_dispatch_trigger()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
  v_on  boolean;
begin
  select dispatch_url, dispatch_key, enabled into v_url, v_key, v_on from public.push_config where id = 1;
  if v_url is null or v_key is null or v_on is not true then
    return new;
  end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'source', tg_table_name,
        'record', to_jsonb(new)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- A push that cannot be queued must never block the Whisper it was about.
    insert into public.push_attempts (source, record_id, failed, note)
    values (tg_table_name, (to_jsonb(new) ->> 'id')::bigint, 1, 'queue failed: ' || sqlerrm);
  end;
  return new;
end $$;

drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification
  after insert on public.notifications
  for each row execute function public.push_dispatch_trigger();

drop trigger if exists push_on_message on public.messages;
create trigger push_on_message
  after insert on public.messages
  for each row execute function public.push_dispatch_trigger();
