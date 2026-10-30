-- 20261030090936 restore_message_media_kind
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (pg_constraint).
-- Idempotent.
--
-- What this migration owns: messages.kind, which had lost its `video` member —
-- the constraint in production was silently narrower than the one committed in
-- 20261010000024_post_video.sql, so sending a video message failed with a bare
-- 23514 check violation and the composer blamed the network.
--
-- Re-asserts the full set. `call`, `sticker`, `profile` and `moment_reply` are
-- not media but they are message kinds and belong in the same constraint, so
-- they are listed here rather than added incrementally somewhere else.
--
-- The drop/add pair is what makes this a "restore": a constraint cannot be
-- widened in place.

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
  check (kind = any (array[
    'text', 'photo', 'voice', 'video',
    'call', 'sticker', 'profile', 'moment_reply'
  ]));

-- The same shape for Circle messages, for the same reason: it is the other
-- table that carries a `kind` and it is checked at exactly this point.
alter table public.circle_messages
  drop constraint if exists circle_messages_kind_check;

alter table public.circle_messages
  add constraint circle_messages_kind_check
  check (kind = any (array['text', 'photo', 'voice', 'video']));
