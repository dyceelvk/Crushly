-- Two rules for the Whisper, both enforced here rather than in the app.
--
-- 1. No video. A Whisper carries pictures and voice notes. Video was the most
--    expensive thing a member could send and it was also the thing that played
--    back silent, so it is closed off at the door: the app no longer offers it,
--    and this function refuses it, which means an older install that still has
--    the button cannot send one either.
--
-- 2. Two photos per member per 24 hours, across every conversation at once. A
--    per-conversation cap is trivial to walk around — open the next Whisper and
--    carry on — and a client-side cap is not a cap at all, because the client
--    can be reinstalled or replaced. So the count is taken from the rows, for
--    the sender, over the last day. Voice notes are not counted: they are small
--    and they are how people who cannot type talk.
--
-- Both checks live in a thin wrapper. The body of `send_message` is long, was
-- verified against production, and rewriting it wholesale to add two guards
-- would put every existing rule — blocks, closed connections, quote rebuilding,
-- the post snapshot — back on the table for no reason. The old body is renamed
-- and kept exactly as it was; the wrapper refuses the two cases and otherwise
-- delegates to it untouched.

-- The kind list still allows 'video' on purpose. Rows that were sent before
-- today are still legal messages and still have to render; making the column
-- reject them would fail on the next update of those rows and would rewrite
-- history a member was actually part of. The refusal belongs in the send path,
-- which is where it now is.

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'send_message'
  ) then
    execute 'alter function public.send_message(bigint, text, text, text, jsonb) rename to send_message_unchecked';
  end if;
end $$;

-- The renamed body must not be reachable on its own, or the guards are a
-- suggestion. Only the wrapper below may call it.
revoke all on function public.send_message_unchecked(bigint, text, text, text, jsonb)
  from public, anon, authenticated;

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
      from messages m
     where m.sender_id = me
       and m.kind = 'photo'
       and m.created_at > public.now_ms() - window_ms;

    if recent_photos >= photo_limit then
      -- Tell the member when the oldest of their photos falls out of the
      -- window, so the refusal is a fact they can act on rather than a wall.
      select min(m.created_at) + window_ms into next_allowed_ms
        from messages m
       where m.sender_id = me
         and m.kind = 'photo'
         and m.created_at > public.now_ms() - window_ms;
      perform public.crushly_fail(429, 'photo_limit',
        format('You can send %s photos a day. The next one is free in about %s hours.',
               photo_limit,
               greatest(1, ceil((next_allowed_ms - public.now_ms()) / 3600000.0)::int)));
    end if;
  end if;

  return public.send_message_unchecked(p_conversation_id, p_kind, p_body, p_media_url, p_meta);
end $$;

revoke all on function public.send_message(bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_message(bigint, text, text, text, jsonb) to authenticated, service_role;

-- The count above runs on every photo send, so it needs its index. Partial,
-- because only photo rows are ever counted and they are a small share of a
-- conversation.
create index if not exists messages_photos_by_sender_idx
  on public.messages (sender_id, created_at)
  where kind = 'photo';

comment on function public.send_message(bigint, text, text, text, jsonb) is
  'Sends a Whisper. Refuses video, and refuses a third photo within 24 hours.';
