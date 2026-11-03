-- Sounds, so "original sound" is a thing rather than a caption.
--
-- The feed has said "original sound — <name>" since the redesign, and the
-- reference's sound page could not be built on top of that sentence: there was
-- no row to open. This adds the smallest honest model:
--
--   * `sounds` — one per author today, titled "Original sound", owned by them.
--     A clip announces its sound automatically on insert, so every video that
--     already exists can be attributed without anybody re-posting it.
--   * `posts.sound_id` — which sound a clip is under.
--   * `attach_post_sound()` — use somebody else's sound on a clip of your own,
--     which is what the sound page's one action does.
--   * `sound_page()` — the sound, who owns it, how many clips are on it, and the
--     clips you are allowed to see.
--
-- `post_engagement` carries the sound too, so every feed that already returns
-- engagement gets the sound with it and no feed query had to be rewritten.

create table if not exists public.sounds (
  id         bigint generated always as identity primary key,
  owner_id   bigint not null references public.profiles(id) on delete cascade,
  title      text not null default 'Original sound',
  media_url  text,
  created_at bigint not null default public.now_ms(),
  constraint sounds_title_len check (char_length(title) between 1 and 80)
);

alter table public.posts add column if not exists sound_id bigint references public.sounds(id) on delete set null;
create index if not exists posts_sound_idx on public.posts (sound_id, created_at desc);

-- One "Original sound" per author: it is their recorded identity, not a new
-- object every time they post.
create unique index if not exists sounds_one_original_per_owner
  on public.sounds (owner_id) where title = 'Original sound';

alter table public.sounds enable row level security;

create or replace function public.original_sound_for(p_owner bigint)
returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from sounds where owner_id = p_owner and title = 'Original sound';
  if v_id is not null then
    return v_id;
  end if;
  insert into sounds (owner_id, title) values (p_owner, 'Original sound')
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from sounds where owner_id = p_owner and title = 'Original sound';
  end if;
  return v_id;
end $$;

-- A clip carries a sound from the moment it exists.
create or replace function public.posts_attach_original_sound()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sound_id is null and new.media_url is not null
     and new.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then
    new.sound_id := public.original_sound_for(new.author_id);
  end if;
  return new;
end $$;

drop trigger if exists posts_attach_original_sound on public.posts;
create trigger posts_attach_original_sound before insert on public.posts
  for each row execute function public.posts_attach_original_sound();

-- Attribute the clips that already exist.
insert into public.sounds (owner_id, title)
select distinct p.author_id, 'Original sound'
  from public.posts p
 where p.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)'
on conflict do nothing;

update public.posts p
   set sound_id = s.id
  from public.sounds s
 where p.sound_id is null
   and s.owner_id = p.author_id
   and s.title = 'Original sound'
   and p.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)';

-- Using somebody else's sound on your own clip.
create or replace function public.attach_post_sound(p_post_id bigint, p_sound_id bigint)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me   bigint := public.me_id();
  mine bigint;
  snd  public.sounds;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select author_id into mine from posts where id = p_post_id;
  if mine is null then
    perform public.crushly_fail(404, 'not_found', 'That post is no longer available.');
  end if;
  if mine <> me then
    perform public.crushly_fail(403, 'not_yours', 'Only your own post can carry a sound.');
  end if;
  select * into snd from sounds where id = p_sound_id;
  if not found then
    perform public.crushly_fail(404, 'not_found', 'That sound is no longer available.');
  end if;

  update posts set sound_id = p_sound_id where id = p_post_id;

  return jsonb_build_object(
    'postId', p_post_id,
    'sound', jsonb_build_object('id', snd.id, 'title', snd.title, 'ownerId', snd.owner_id)
  );
end $$;

-- The page: the sound, its owner, how much is on it, and the clips you may see.
create or replace function public.sound_page(p_sound_id bigint, p_limit integer default 24)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  snd   public.sounds;
  n     integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  items jsonb := '[]'::jsonb;
  total integer := 0;
  r     record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into snd from sounds where id = p_sound_id;
  if not found then
    perform public.crushly_fail(404, 'not_found', 'That sound is no longer available.');
  end if;

  select count(*) into total
    from posts p
   where p.sound_id = p_sound_id and public.can_view_post(p, me);

  for r in
    select p.*
      from posts p
     where p.sound_id = p_sound_id and public.can_view_post(p, me)
     order by p.created_at desc
     limit n
  loop
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
        'edit', r.edit,
        'audience', r.audience,
        'circleId', r.circle_id,
        'createdAt', r.created_at,
        'author', public.public_profile(me, r.author_id, false),
        'mine', r.author_id = me
      ) || public.post_engagement(r.id, me)
    );
  end loop;

  return jsonb_build_object(
    'sound', jsonb_build_object(
      'id', snd.id,
      'title', snd.title,
      'createdAt', snd.created_at,
      'postCount', total,
      'owner', public.public_profile(me, snd.owner_id, false)
    ),
    'items', items
  );
end $$;

-- Every feed that already asks for engagement now gets the sound with it.
create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'likeCount', (select count(*) from post_reactions r where r.post_id = p_post_id),
    'commentCount', (
      select count(*) from post_comments c
       where c.post_id = p_post_id
         and not c.hidden
         and not public.is_blocked_pair(p_viewer, c.author_id)
    ),
    'liked', exists (
      select 1 from post_reactions r where r.post_id = p_post_id and r.user_id = p_viewer
    ),
    'myReaction', (
      select r.kind from post_reactions r
       where r.post_id = p_post_id and r.user_id = p_viewer
    ),
    'reactionKinds', coalesce((
      select jsonb_object_agg(s.kind, s.n)
        from (select r.kind, count(*) as n
                from post_reactions r
               where r.post_id = p_post_id
               group by r.kind) s
    ), '{}'::jsonb),
    'saved', exists (
      select 1 from post_saves s where s.post_id = p_post_id and s.user_id = p_viewer
    ),
    'sound', (
      select jsonb_build_object('id', s.id, 'title', s.title, 'ownerId', s.owner_id)
        from posts po join sounds s on s.id = po.sound_id
       where po.id = p_post_id
    )
  );
$$;

revoke all on function public.attach_post_sound(bigint, bigint) from public, anon, authenticated;
revoke all on function public.sound_page(bigint, integer) from public, anon, authenticated;
revoke all on function public.original_sound_for(bigint) from public, anon;
revoke all on function public.post_engagement(bigint, bigint) from public, anon, authenticated;
grant execute on function public.attach_post_sound(bigint, bigint) to authenticated, service_role;
grant execute on function public.sound_page(bigint, integer) to authenticated, service_role;
grant execute on function public.original_sound_for(bigint) to authenticated, service_role;
grant execute on function public.post_engagement(bigint, bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
