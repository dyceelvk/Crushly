-- Owner-only audience: every existing post/media/search reader uses can_view_post.
-- Circle pairing remains unchanged; creation is deliberately unchanged.
alter table public.posts drop constraint if exists posts_audience_check;
alter table public.posts add constraint posts_audience_check
  check (audience in ('connections', 'everyone', 'circle', 'private'));

create or replace function public.can_view_post(p_post public.posts, p_viewer bigint)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_viewer is null then return false; end if;
  if p_post.author_id = p_viewer then return true; end if;
  if public.is_blocked_pair(p_viewer, p_post.author_id) then return false; end if;
  if p_post.audience = 'private' then return false; end if;
  if p_post.audience = 'circle' then
    return public.is_circle_member(p_post.circle_id, p_viewer);
  end if;
  if p_post.audience = 'everyone' then
    return exists (
      select 1 from profiles p join privacy pr on pr.user_id = p.id
       where p.id = p_post.author_id and p.onboarded and p.status = 'active'
         and pr.profile_visibility = 'everyone' and not pr.incognito
    );
  end if;
  return p_post.audience = 'connections' and public.is_connected_pair(p_viewer, p_post.author_id);
end $$;


create or replace function public.edit_post(
  p_post_id bigint,
  p_body text default null,
  p_audience text default null,
  p_edit jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  po public.posts;
  next_body text;
  next_audience text;
  next_edit jsonb;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found then
    perform public.crushly_fail(404, '', 'That post is gone.');
  end if;
  if po.author_id <> me then
    perform public.crushly_fail(403, 'not_yours', 'This post isn’t yours to edit.');
  end if;

  -- A null argument means "leave it alone"; an empty body means "clear it".
  next_body := case when p_body is null then po.body else btrim(p_body) end;
  next_body := left(next_body, 2000);

  if p_audience is null then
    next_audience := po.audience;
  elsif po.circle_id is not null then
    -- Who sees a Circle post is the Circle's business, not the editor's.
    next_audience := po.audience;
  elsif p_audience in ('everyone', 'connections', 'private') then
    next_audience := p_audience;
  else
    perform public.crushly_fail(400, '', 'Pick who can see this.');
  end if;

  if p_edit is null then
    next_edit := po.edit;
  elsif po.media_url is null then
    next_edit := null;
  else
    next_edit := public.clean_video_edit(p_edit);
    if next_edit is null then
      perform public.crushly_fail(400, '', 'That edit could not be saved.');
    end if;
  end if;

  if btrim(next_body) = '' and po.media_url is null then
    perform public.crushly_fail(400, '', 'A post needs some words, or a photo.');
  end if;

  update posts
     set body = next_body,
         audience = next_audience,
         edit = next_edit
   where id = p_post_id;

  return public.load_post(p_post_id);
end $$;

revoke all on function public.edit_post(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.edit_post(bigint, text, text, jsonb) to authenticated, service_role;


-- Previous Whisper cards contained a permanent copy of the post text and
-- media URL. Remove those snapshots whenever the owner changes the audience.
-- Existing messages remain in the conversation as safe references.
create or replace function public.redact_private_post_shares()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.audience is distinct from new.audience then
    update public.messages
       set body = 'Shared a post', media_url = null,
           meta = jsonb_build_object('postId', new.id)
     where kind = 'post' and meta ->> 'postId' = new.id::text;
  end if;
  return new;
end $$;
revoke all on function public.redact_private_post_shares() from public, anon, authenticated;
drop trigger if exists redact_private_post_shares on public.posts;
create trigger redact_private_post_shares after update of audience on public.posts
for each row execute function public.redact_private_post_shares();

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
  shared_post public.posts;
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
    when 'post' then
      -- Share a reference only, never a permanent snapshot. The recipient
      -- resolves the post through the normal, current visibility check.
      select * into shared_post from posts where id = (clean_meta ->> 'postId')::bigint;
      if not found or not public.can_view_post(shared_post, me) then
        perform public.crushly_fail(404, '', 'That post can’t be shared.');
      end if;
      clean_body := 'Shared a post';
      clean_media := null;
      clean_meta := jsonb_build_object('postId', shared_post.id);
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
               when 'post' then 'Shared a post'
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
    when 'post' then 'Shared a post'
    else 'Shared a Space'
  end;
  perform public.notify_to(peer, 'message', me, p_conversation_id, preview);

  return (
    select public.serialize_message(m, me, public.receipts_visible(me, peer))
      from messages m where m.id = new_id
  );
end $$;

revoke all on function public.send_message(bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_message(bigint, text, text, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
