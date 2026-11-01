-- Editing a post after it is posted.
--
-- There was no way to fix a typo, change your mind about who could see
-- something, or take a word back — the only options were none and delete. This
-- adds `edit_post`, which only the author can call, only on their own post, and
-- which re-checks everything the composer checks:
--
--   * the words are trimmed and capped;
--   * the audience can only be `everyone` / `connections`, and cannot be changed
--     on a post that belongs to a Circle (the room decides who sees it);
--   * a video recipe is re-cleaned by `clean_video_edit`, the same gate
--     `create_post` uses;
--   * a media post cannot be left with no words *and* no media.
--
-- It returns the post serialised the way the app reads it (`load_post`), so a
-- screen can drop the result straight into its cache.

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
  elsif p_audience in ('everyone', 'connections') then
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

notify pgrst, 'reload schema';
