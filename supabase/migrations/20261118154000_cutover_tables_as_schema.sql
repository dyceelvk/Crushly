-- 20261118154000_cutover_tables_as_schema
--
-- Two tables that production has and the migration chain does not.
--
-- `20261110080000_relationship_cutover.sql` creates `holup_homies` and
-- `holup_whisper_permissions`, but that file declares itself "DISPOSABLE
-- EXPERIMENT ONLY. Not a production migration", locks four tables in share row
-- exclusive mode and backfills them from live connection data. `supabase/tests/run.py`
-- therefore exempts it from the replay, which is right — and leaves everything
-- after it that mentions those tables broken on a clean database:
--
--   add_up_needs_no_approval            lock table public.holup_homies
--   support_notifications_and_…         from public.holup_whisper_permissions
--   control_messaging                   references both
--
-- Production works only because those tables were created there once,
-- out-of-band. A branch database, a fresh environment or a restore could not be
-- built at all.
--
-- So this file adds the *schema* and nothing else. No locks (nothing is being
-- cut over here), no backfill, no policy changes: the exact columns, defaults,
-- checks and indexes the cutover defines, `if not exists` throughout. The data
-- migration stays where it belongs, in the one-shot file, and the request goes
-- with the message that already asked for a reviewed cutover.

create table if not exists public.holup_homies (
  user_a      bigint not null references public.profiles(id) on delete cascade,
  user_b      bigint not null references public.profiles(id) on delete cascade,
  accepted_at bigint not null default public.now_ms(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.holup_homie_requests (
  sender_id    bigint not null references public.profiles(id) on delete cascade,
  recipient_id bigint not null references public.profiles(id) on delete cascade,
  status       text   not null check (status in ('pending','declined','withdrawn')),
  created_at   bigint not null default public.now_ms(),
  decided_at   bigint,
  primary key (sender_id, recipient_id),
  check (sender_id <> recipient_id)
);

create index if not exists holup_homie_requests_inbox
  on public.holup_homie_requests (recipient_id, status, created_at desc);

create table if not exists public.holup_homie_attempts (
  sender_id  bigint not null references public.profiles(id) on delete cascade,
  created_at bigint not null default public.now_ms()
);

create index if not exists holup_homie_attempts_recent
  on public.holup_homie_attempts (sender_id, created_at);

create table if not exists public.holup_whisper_permissions (
  conversation_id   bigint  primary key references public.conversations(id) on delete cascade,
  requester_id      bigint  not null references public.profiles(id) on delete cascade,
  recipient_id      bigint  not null references public.profiles(id) on delete cascade,
  state             text    not null check (state in ('pending','accepted','declined','blocked')),
  request_messages  smallint not null default 0 check (request_messages between 0 and 2),
  created_at        bigint  not null default public.now_ms(),
  decided_at        bigint,
  check (requester_id <> recipient_id)
);

alter table public.holup_homies            enable row level security;
alter table public.holup_homie_requests    enable row level security;
alter table public.holup_homie_attempts    enable row level security;
alter table public.holup_whisper_permissions enable row level security;

-- Reachable only through SECURITY DEFINER functions, exactly as the cutover
-- intended: no direct access for a client, anon or a signed-in member.
do $$
begin
  execute 'revoke all on public.holup_homies, public.holup_homie_requests, public.holup_homie_attempts from public, anon, authenticated';
  execute 'revoke all on public.holup_whisper_permissions from public, anon, authenticated';
exception when undefined_object then
  null; -- a role that does not exist in this environment; nothing to revoke
end $$;

comment on table public.holup_homies is
  'Accepted Add Ups between two members. Schema only here; the data migration lives in the one-shot cutover file.';
