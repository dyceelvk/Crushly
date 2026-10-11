-- Likes and comments on a Flow post.
--
-- A Moment answers with a Whisper, because a Moment is a day long and private
-- between two people. A Flow post is not that: it is something somebody put in
-- front of whoever he allowed to see it, and the answer to it belongs under it,
-- where everyone who can see the post can read it. That is what a comment is.
--
-- So this adds two things a post did not have: a like, and a comment that is
-- public to exactly the audience the post already had. Nothing here widens
-- anything. A comment inherits its post's audience — if you could not read the
-- post you cannot read a single word under it — a block still silences both
-- ways, and the author of a post may remove a comment on his own post, because
-- it is his doorstep.

create table if not exists public.post_reactions (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    bigint not null references public.profiles(id) on delete cascade,
  created_at bigint not null default public.now_ms(),
  primary key (post_id, user_id)
);

create index if not exists post_reactions_post_idx on public.post_reactions (post_id, created_at desc);

create table if not exists public.post_comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  author_id  bigint not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at bigint not null default public.now_ms()
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at, id);

alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;

-- Who may read: whoever may read the post. Not one person more.
drop policy if exists post_reactions_select on public.post_reactions;
create policy post_reactions_select on public.post_reactions
  for select to authenticated
  using (
    exists (
      select 1 from posts p
       where p.id = post_reactions.post_id
         and public.can_view_post(p, public.me_id())
    )
  );

drop policy if exists post_reactions_insert on public.post_reactions;
create policy post_reactions_insert on public.post_reactions
  for insert to authenticated with check (user_id = public.me_id());

drop policy if exists post_reactions_delete on public.post_reactions;
create policy post_reactions_delete on public.post_reactions
  for delete to authenticated using (user_id = public.me_id());

drop policy if exists post_comments_select on public.post_comments;
create policy post_comments_select on public.post_comments
  for select to authenticated
  using (
    exists (
      select 1 from posts p
       where p.id = post_comments.post_id
         and public.can_view_post(p, public.me_id())
    )
  );

drop policy if exists post_comments_insert on public.post_comments;
create policy post_comments_insert on public.post_comments
  for insert to authenticated
  with check (
    author_id = public.me_id()
    and exists (
      select 1 from posts p
       where p.id = post_comments.post_id
         and public.can_view_post(p, public.me_id())
    )
  );

-- Your own comment, always. And a comment left on your post, because you
-- should not have to host something you would rather not have said on your
-- own doorstep.
drop policy if exists post_comments_delete on public.post_comments;
create policy post_comments_delete on public.post_comments
  for delete to authenticated
  using (
    author_id = public.me_id()
    or exists (
      select 1 from posts p
       where p.id = post_comments.post_id and p.author_id = public.me_id()
    )
  );

-- Two new kinds of notification. The constraint has to be widened first or
-- every insert below it would fail.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('crush', 'deep_crush', 'mutual', 'message', 'moment_reply',
                  'moment_reaction', 'verified', 'verification_rejected',
                  'post_reaction', 'post_comment'));

-- ------------------------------------------------------------------- liking

create or replace function public.react_to_post(p_post_id bigint, p_liked boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me  bigint := public.me_id();
  po  public.posts;
  had boolean;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;
  if po.author_id = me then
    perform public.crushly_fail(400, '', 'You can’t like your own post.');
  end if;

  select exists (select 1 from post_reactions r where r.post_id = po.id and r.user_id = me) into had;

  if coalesce(p_liked, true) then
    insert into post_reactions (post_id, user_id) values (po.id, me) on conflict do nothing;
    -- Only the first like is news; un-liking and re-liking is not.
    if not had then
      perform public.notify_to(po.author_id, 'post_reaction', me, po.id, '');
    end if;
  else
    delete from post_reactions r where r.post_id = po.id and r.user_id = me;
  end if;

  return jsonb_build_object(
    'liked', coalesce(p_liked, true),
    'likeCount', (select count(*) from post_reactions r where r.post_id = po.id)
  );
end $$;

-- ----------------------------------------------------------------- commenting

create or replace function public.post_comments_feed(p_post_id bigint, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  po public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;

  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'createdAt', c.created_at,
        'mine', c.author_id = me,
        'author', public.public_profile(me, c.author_id, false)
      ) order by c.created_at, c.id
    ), '[]'::jsonb))
    from post_comments c
    where c.post_id = po.id
      -- A comment from somebody you have cut off is not shown to you, even
      -- though he was allowed to leave it.
      and not public.is_blocked_pair(me, c.author_id)
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  );
end $$;

create or replace function public.comment_on_post(p_post_id bigint, p_body text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me         bigint := public.me_id();
  po         public.posts;
  clean_body text := left(btrim(coalesce(p_body, '')), 1000);
  new_id     bigint;
  n          integer;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;
  if clean_body = '' then
    perform public.crushly_fail(400, '', 'Write something first.');
  end if;

  -- Somebody working through a feed leaving a hundred comments is not a
  -- conversation; it is noise. Thirty an hour is more than anybody writes.
  select count(*) into n from post_comments c
   where c.author_id = me and c.created_at > public.now_ms() - 3600 * 1000;
  if n >= 30 then
    perform public.crushly_fail(429, '', 'That’s a lot of commenting — take a moment.');
  end if;

  insert into post_comments (post_id, author_id, body)
  values (po.id, me, clean_body)
  returning id into new_id;

  if po.author_id <> me then
    perform public.notify_to(po.author_id, 'post_comment', me, po.id, left(clean_body, 80));
  end if;

  return jsonb_build_object(
    'id', new_id,
    'body', clean_body,
    'createdAt', (select c.created_at from post_comments c where c.id = new_id),
    'mine', true,
    'author', public.public_profile(me, me, false)
  );
end $$;

create or replace function public.delete_post_comment(p_comment_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  po bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  -- Yours to remove, or the post is yours and the comment was left on it.
  select c.post_id into po
    from post_comments c
    join posts p on p.id = c.post_id
   where c.id = p_comment_id
     and (c.author_id = me or p.author_id = me);

  if not found then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;

  delete from post_comments c where c.id = p_comment_id;
  return true;
end $$;

-- ------------------------------------------------------- feeds carry the counts

-- flow_feed is redefined so every post arrives with its counts and whether you
-- liked it, rather than the app asking once per post.
create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'likeCount', (select count(*) from post_reactions r where r.post_id = p_post_id),
    'commentCount', (select count(*) from post_comments c where c.post_id = p_post_id),
    'liked', exists (select 1 from post_reactions r where r.post_id = p_post_id and r.user_id = p_viewer)
  );
$$;

create or replace function public.flow_feed(p_limit integer default 20, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  post  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select po.* from posts po
     where (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
                             or (po.created_at = (select p2.created_at from posts p2 where p2.id = p_after) and po.id < p_after))
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'mediaKind', case
            when r.media_url is null then null
            when r.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'audience', r.audience,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

create or replace function public.public_flow_feed(p_limit integer default 20, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  post  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select po.* from posts po
     where po.audience = 'everyone'
       and po.circle_id is null
       and po.author_id <> me
       and (
         p_after is null
         or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
         or (
           po.created_at = (select p2.created_at from posts p2 where p2.id = p_after)
           and po.id < p_after
         )
       )
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'mediaKind', case
            when r.media_url is null then null
            when r.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'audience', r.audience,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', false
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

-- ------------------------------------------------------- posts may carry a clip

-- A post could hold a photo. It can hold a short clip now too: the Flows in the
-- member's sketch have both, and there is no reason a post should be the one
-- kind of sharing that cannot move.
create or replace function public.media_upload_ticket(
  p_kind text, p_content_type text, p_bytes int default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_ext text;
  v_limit int;
  v_path text;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type isn’t supported.');
  end if;
  if p_kind = 'photos' and v_ext not in ('jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Photos must be JPEG, PNG or WebP.');
  end if;
  -- Moments stay a photo or nothing: they are a day long and meant to be
  -- glanced at, and a clip belongs in a Vibe. A post may carry either.
  if p_kind in ('photos', 'moments') and v_ext not in ('jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Photos must be JPEG, PNG or WebP.');
  end if;
  if p_kind = 'posts' and v_ext not in ('jpg', 'png', 'webp', 'mp4', 'webm') then
    perform public.crushly_fail(415, '', 'A post takes a photo or a short clip.');
  end if;
  if p_kind = 'circles' and v_ext not in ('jpg', 'png', 'webp', 'm4a', 'mp3') then
    perform public.crushly_fail(415, '', 'Circles take photos and voice notes.');
  end if;
  if p_kind = 'vibes' and v_ext not in ('mp4', 'webm', 'jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Vibes are short video clips, with a still for the cover.');
  end if;

  v_limit := case when p_kind in ('messages', 'circles', 'vibes', 'posts') then 25 * 1024 * 1024
                  else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty — try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from circle_messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from vibes where author_id = me and created_at > public.now_ms() - 3600 * 1000)
    into n;
  if n >= 40 then
    perform public.crushly_fail(429, '', 'That’s a lot of uploading — try again in a little while.');
  end if;

  if p_kind = 'photos' and (select count(*) from photos where user_id = me) >= 6 then
    perform public.crushly_fail(400, '', 'You can show up to 6 photos.');
  end if;

  v_path := p_kind || '/' || me::text || '/' || public.now_ms()::text || '-'
    || substr(md5(random()::text || me::text || public.now_ms()::text), 1, 10) || '.' || v_ext;

  return jsonb_build_object('path', v_path, 'maxBytes', v_limit, 'extension', v_ext);
end $$;

-- ------------------------------------------------------------------- grants

revoke all on function public.react_to_post(bigint, boolean) from public, anon, authenticated;
grant execute on function public.react_to_post(bigint, boolean) to authenticated, service_role;
revoke all on function public.post_comments_feed(bigint, integer) from public, anon, authenticated;
grant execute on function public.post_comments_feed(bigint, integer) to authenticated, service_role;
revoke all on function public.comment_on_post(bigint, text) from public, anon, authenticated;
grant execute on function public.comment_on_post(bigint, text) to authenticated, service_role;
revoke all on function public.delete_post_comment(bigint) from public, anon, authenticated;
grant execute on function public.delete_post_comment(bigint) to authenticated, service_role;
revoke all on function public.post_engagement(bigint, bigint) from public, anon, authenticated;
grant execute on function public.post_engagement(bigint, bigint) to authenticated, service_role;
