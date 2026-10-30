-- The table media_upload_ticket has always written to, finally in a migration.
--
-- media_upload_ticket() inserts a row here for every upload and counts the last
-- hour's worth to enforce a ceiling. The table was created directly against the
-- database and never committed, so a database built from these migrations alone
-- — which is what CI does, and what a new environment would do — has the
-- function without its table. Calling the ticket there fails with
--   relation "media_upload_reservations" does not exist
-- and the upload path is dead before it starts.
--
-- Shape taken from the live database rather than guessed: path, user_id, bytes,
-- created_at.

create table if not exists public.media_upload_reservations (
  path       text   primary key,
  user_id    bigint not null references public.profiles (id) on delete cascade,
  bytes      integer not null,
  created_at bigint not null default public.now_ms()
);

-- The ticket counts one member's reservations in the last hour on every upload.
create index if not exists media_upload_reservations_recent
  on public.media_upload_reservations (user_id, created_at desc);

alter table public.media_upload_reservations enable row level security;

-- Nothing but the definer functions touch this table; a member reading it would
-- learn only about their own uploads, which they already know.
revoke all on public.media_upload_reservations from anon, authenticated;
grant all on public.media_upload_reservations to service_role;
