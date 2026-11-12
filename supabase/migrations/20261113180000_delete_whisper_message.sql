-- Deleting a Whisper message.
--
-- There was no delete. Long-pressing a message offered reactions, "Copy text"
-- and "Flag this Whisper" — and nothing else, for anybody, on any message. The
-- owner asked for deleting that reaches the server, so this is the whole path:
-- the row, the file behind it, and the other person's screen.
--
-- Three decisions worth writing down:
--
--   1. Only the sender may delete, and it deletes for both of them. A message
--      that stayed visible on the recipient's phone would not be deleted, and a
--      recipient who could delete would be able to edit a conversation they did
--      not write.
--
--   2. There is no time limit. "Delete for everyone" windows exist so a message
--      cannot be quietly rewritten after it was read; but this app already
--      promises a member control over their own content, and a Whisper that
--      cannot be taken back is the thing people complain about. The row and the
--      file both go.
--
--   3. Deleting a photo does NOT give the day's allowance back. The limit would
--      otherwise be a formality: send two, delete two, send two more. So the
--      count comes from a ledger that outlives the message.

-- ------------------------------------------------------------------ the ledger
--
-- One row per photo sent. Written in the same call that sends the photo, read by
-- the limit, and never touched by a delete — that is the entire point of it.
create table if not exists public.whisper_photo_ledger (
  message_id  bigint primary key,
  sender_id   bigint not null references public.profiles(id) on delete cascade,
  created_at  bigint not null default public.now_ms()
);
create index if not exists whisper_photo_ledger_sender_idx
  on public.whisper_photo_ledger (sender_id, created_at);

alter table public.whisper_photo_ledger enable row level security;

-- Photos sent before this ledger existed still count. Without this backfill the
-- first deploy would hand everybody a fresh two.
insert into public.whisper_photo_ledger (message_id, sender_id, created_at)
select m.id, m.sender_id, m.created_at
  from public.messages m
 where m.kind = 'photo'
on conflict (message_id) do nothing;

-- ------------------------------------------------------------ the send wrapper
--
-- Same two guards as before — no video, two photos a day — but the count now
-- comes from the ledger rather than from the messages table, so deleting a photo
-- no longer buys another one.

create or replace function public.send_message(
  p_conversation_id bigint, p_kind text default 'text', p_body text default '',
  p_media_url text default null, p_meta jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  photo_limit constant int := 2;
  window_ms constant bigint := 24 * 60 * 60 * 1000;
  recent_photos int;
  next_allowed_ms bigint;
  saved jsonb;
  new_id bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if p_kind = 'video' then
    perform public.crushly_fail(403, 'video_not_allowed',
      'Whispers carry photos and voice notes. Send a photo instead.');
  end if;

  if p_kind = 'photo' then
    select count(*) into recent_photos
      from public.whisper_photo_ledger l
     where l.sender_id = me
       and l.created_at > public.now_ms() - window_ms;

    if recent_photos >= photo_limit then
      select min(l.created_at) + window_ms into next_allowed_ms
        from public.whisper_photo_ledger l
       where l.sender_id = me
         and l.created_at > public.now_ms() - window_ms;
      perform public.crushly_fail(429, 'photo_limit',
        format('You can send %s photos a day. The next one is free in about %s hours.',
               photo_limit,
               greatest(1, ceil((next_allowed_ms - public.now_ms()) / 3600000.0)::int)));
    end if;
  end if;

  saved := public.send_message_unchecked(p_conversation_id, p_kind, p_body, p_media_url, p_meta);

  -- The ledger is written only once the message really exists, so a refused send
  -- never costs a photo.
  if p_kind = 'photo' then
    new_id := (saved ->> 'id')::bigint;
    insert into public.whisper_photo_ledger (message_id, sender_id)
    values (new_id, me)
    on conflict (message_id) do nothing;
  end if;

  return saved;
end $$;

revoke all on function public.send_message(bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_message(bigint, text, text, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------- deleting

create or replace function public.delete_message(p_message_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  m public.messages;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into m from public.messages msg where msg.id = p_message_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Whisper is already gone.');
  end if;

  -- Not "not found": the message exists and this member may not touch it. Saying
  -- so is the difference between a bug report and a bug.
  if m.sender_id <> me then
    perform public.crushly_fail(403, 'not_your_message', 'You can only delete your own Whisper.');
  end if;

  -- Queued in the same transaction as the delete: a photo or voice note left in
  -- the bucket would be a message that is gone from the thread and still
  -- reachable by anybody holding its URL.
  perform public.queue_media_deletion(m.media_url, 'message_deleted');

  delete from public.messages msg where msg.id = m.id;
  return true;
end $$;

revoke all on function public.delete_message(bigint) from public, anon, authenticated;
grant execute on function public.delete_message(bigint) to authenticated, service_role;

comment on function public.delete_message(bigint) is
  'Deletes one of your own Whispers — the row, and the file behind it.';

notify pgrst, 'reload schema';
