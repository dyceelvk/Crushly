-- Replies in Whispers: swipe a message toward the middle to answer it.
--
-- The client only sends the *id* of the message being answered. The quote that
-- appears above the reply is rebuilt here, from the stored row, so a member
-- cannot craft metadata that puts words in someone else's mouth — the quoted
-- text is always the text that was actually sent, and the name is always the
-- name of whoever sent it. A reply can only point at a message in the same
-- conversation, so it cannot be used to surface something from elsewhere.

create or replace function public.send_message(
  p_conversation_id bigint, p_kind text default 'text', p_body text default '',
  p_media_url text default null, p_meta jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  reason text;
  new_id bigint;
  clean_body text := coalesce(p_body, '');
  clean_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  clean_media text := nullif(coalesce(p_media_url, ''), '');
  shared jsonb;
  preview text;
  reply_id bigint;
  reply jsonb;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c where c.id = p_conversation_id;
  if not found or (conv.user_a <> me and conv.user_b <> me) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  if conv.closed then
    perform public.crushly_fail(403, '', 'This connection has ended.');
  end if;
  reason := public.messaging_block_reason(me, peer);
  if reason is not null then
    perform public.crushly_fail(403, 'messaging_restricted', reason);
  end if;

  case p_kind
    when 'text' then
      if btrim(clean_body) = '' then
        perform public.crushly_fail(400, '', 'Say something worth replying to.');
      end if;
      clean_body := left(clean_body, 2000);
    when 'photo' then
      if clean_media is null then
        perform public.crushly_fail(400, '', 'Choose a photo to send.');
      end if;
      clean_body := left(clean_body, 300);
    when 'voice' then
      if clean_media is null then
        perform public.crushly_fail(400, '', 'Record a voice note to send.');
      end if;
      clean_meta := jsonb_build_object('duration',
        least(greatest(coalesce((clean_meta ->> 'duration')::int, 1), 1), 300));
    when 'video' then
      if clean_media is null then
        perform public.crushly_fail(400, '', 'Record a video note to send.');
      end if;
      clean_meta := jsonb_build_object('duration',
        least(greatest(coalesce((clean_meta ->> 'duration')::int, 1), 1), 120));
    when 'call' then
      if clean_meta ->> 'channel' is null or btrim(clean_meta ->> 'channel') = '' then
        perform public.crushly_fail(400, '', 'Call requests need a channel.');
      end if;
      clean_body := 'Voice call';
      clean_meta := jsonb_build_object('channel', clean_meta ->> 'channel');
    when 'sticker' then
      if clean_meta ->> 'sticker' not in ('wave', 'blush', 'fire', 'cheers', 'wink', 'heart_eyes', 'coffee', 'crown') then
        perform public.crushly_fail(400, '', 'Pick a sticker to send.');
      end if;
    when 'profile' then
      shared := public.load_visible_profile(me, (clean_meta ->> 'profileId')::bigint);
      if shared is null then
        perform public.crushly_fail(404, '', 'That Space can’t be shared.');
      end if;
      clean_meta := jsonb_build_object(
        'profileId', (shared ->> 'id')::bigint,
        'name', shared ->> 'name',
        'age', shared ->> 'age',
        'photo', shared #>> '{photos,0,url}',
        'verified', (shared ->> 'verified')::boolean);
    else
      perform public.crushly_fail(400, '', 'Unsupported message type.');
  end case;

  -- Rebuild the quote from the row itself, never from what the client said it
  -- said. Anything that does not resolve is dropped rather than trusted.
  if coalesce(clean_meta #>> '{replyTo,id}', '') ~ '^[0-9]{1,18}$' then
    reply_id := (clean_meta #>> '{replyTo,id}')::bigint;
    select jsonb_build_object(
             'id', rm.id,
             'mine', rm.sender_id = me,
             'name', case when rm.sender_id = me then 'You'
                          else coalesce((select p.name from profiles p where p.id = rm.sender_id), 'Member') end,
             'preview', case rm.kind
               when 'text' then left(coalesce(nullif(btrim(rm.body), ''), 'Whisper'), 80)
               when 'photo' then coalesce(nullif(btrim(rm.body), ''), 'Photo')
               when 'voice' then 'Voice note'
               when 'video' then 'Video note'
               when 'sticker' then 'Sticker'
               when 'profile' then 'Shared a Space'
               when 'call' then 'Voice call'
               else coalesce(nullif(btrim(rm.body), ''), 'Whisper') end
           )
      into reply
      from messages rm
     where rm.id = reply_id and rm.conversation_id = p_conversation_id;

    if reply is null then
      clean_meta := clean_meta - 'replyTo';
    else
      clean_meta := jsonb_set(clean_meta, '{replyTo}', reply);
    end if;
  end if;

  insert into messages (conversation_id, sender_id, kind, body, media_url, meta)
  values (p_conversation_id, me, p_kind, clean_body, clean_media, clean_meta)
  returning id into new_id;
  update conversations set last_message_at = public.now_ms() where id = p_conversation_id;

  preview := case p_kind
    when 'text' then left(clean_body, 80)
    when 'photo' then 'Sent a photo'
    when 'voice' then 'Sent a voice note'
    when 'video' then 'Sent a video note'
    when 'call' then 'Voice call'
    when 'sticker' then 'Sent a sticker'
    else 'Shared a Space'
  end;
  perform public.notify_to(peer, 'message', me, p_conversation_id, preview);

  return (
    select public.serialize_message(m, me, public.receipts_visible(me, peer))
      from messages m where m.id = new_id
  );
end $$;
