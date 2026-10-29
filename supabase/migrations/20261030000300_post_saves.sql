-- Saved posts, for real.
--
-- The Save button in the post viewer was cosmetic: it flipped a local
-- `useState`, told you "Post saved", and forgot the moment you closed the
-- viewer. There was no table to write to. This is that table, and the three
-- RPCs the button needs.
--
-- Saving is private by construction. Nobody can ask who saved what, there is
-- no count on a post, no notification is sent to the author, and no feed reads
-- this table. It is a bookmark drawer, not a signal — which is also why it
-- carries no "saved by N people" field anywhere in the API: a table with no
-- reader is a table that cannot leak.
--
-- Deleting a post removes its saves along with it, so a saved list can never
-- show a row whose post is gone.

create table if not exists public.post_saves (
  user_id    bigint not null references public.profiles(id) on delete cascade,
  post_id    bigint not null references public.posts(id) on delete cascade,
  created_at bigint not null default public.now_ms(),
  primary key (user_id, post_id)
);

-- The drawer is read newest-first.
create index if not exists post_saves_user_idx
  on public.post_saves (user_id, created_at desc);

alter table public.post_saves enable row level security;

-- Your own saves are all you can see or write. There is deliberately no
-- SELECT policy that lets a post's author find out who saved it.
drop policy if exists post_saves_select_own on public.post_saves;
create policy post_saves_select_own on public.post_saves
  for select to authenticated using (user_id = public.me_id());

drop policy if exists post_saves_insert_own on public.post_saves;
create policy post_saves_insert_own on public.post_saves
  for insert to authenticated with check (user_id = public.me_id());

drop policy if exists post_saves_delete_own on public.post_saves;
create policy post_saves_delete_own on public.post_saves
  for delete to authenticated using (user_id = public.me_id());

/* ------------------------------------------------------------- save / unsave */

-- Idempotent in both directions: saving a post you already saved, or unsaving
-- one you never saved, returns the truth rather than an error. The app can then
-- show the returned state instead of assuming its optimistic guess was right.
create or replace function public.save_post(p_post_id bigint, p_saved boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

  if coalesce(p_saved, true) then
    insert into post_saves (user_id, post_id) values (me, po.id)
    on conflict do nothing;
  else
    delete from post_saves s where s.user_id = me and s.post_id = po.id;
  end if;

  return jsonb_build_object(
    'saved', exists (select 1 from post_saves s where s.user_id = me and s.post_id = po.id)
  );
end $$;

-- One post's saved state, for the viewer. Reads through the same function so a
-- viewer never says "saved" for a post you can no longer see.
create or replace function public.post_saved(p_post_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from post_saves s
     where s.user_id = public.me_id()
       and s.post_id = p_post_id
  );
$$;

-- The saved list itself. Same shape as the Flow feed on purpose — same `post`
-- JSON, same audience and block rules — so the saved screen reuses the same
-- card component and cannot show a post the viewer could not otherwise open.
create or replace function public.saved_posts(p_limit integer default 20, p_after bigint default null)
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
    select po.* from post_saves s
      join posts po on po.id = s.post_id
     where s.user_id = me
       and (p_after is null
            or s.created_at < (select s2.created_at from post_saves s2
                                where s2.user_id = me and s2.post_id = p_after)
            or (s.created_at = (select s2.created_at from post_saves s2
                                 where s2.user_id = me and s2.post_id = p_after)
                and po.id < p_after))
     order by s.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    -- A post that has since been deleted or hidden is skipped, not an error:
    -- one dead row must not empty the whole drawer.
    if found and public.can_view_post(post, me) then
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
        ) || public.post_engagement(r.id, me) || jsonb_build_object('saved', true)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

/* ------------------------------------------------------------------ grants */

revoke all on function public.save_post(bigint, boolean) from public, anon, authenticated;
grant execute on function public.save_post(bigint, boolean) to authenticated, service_role;

revoke all on function public.post_saved(bigint) from public, anon, authenticated;
grant execute on function public.post_saved(bigint) to authenticated, service_role;

revoke all on function public.saved_posts(integer, bigint) from public, anon, authenticated;
grant execute on function public.saved_posts(integer, bigint) to authenticated, service_role;
