-- 20261029205829 post_saves
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (columns,
-- pg_constraint, pg_indexes, pg_policy, pg_get_functiondef). Idempotent.
--
-- What this migration owns: keeping a post.
--   * post_saves table + RLS (you can only see and touch your own saves)
--   * save_post(post_id, saved)  - the only write path
--   * post_saved(post_id)        - cheap boolean for a detail screen
--   * saved_posts(limit, after)  - the Keeps list, read through can_view_post so
--                                 a saved post that later narrows its audience
--                                 simply stops appearing
--   * post_engagement() gains `saved`
--
-- Note the asymmetry with likes: a save is private. There is no count, no
-- notification and no way to discover who saved a post — which is why every
-- policy here is `user_id = me_id()` and nothing references post_saves in a
-- serialized payload other than the caller's own row.

create table if not exists public.post_saves (
  user_id    bigint not null references public.profiles(id) on delete cascade,
  post_id    bigint not null references public.posts(id) on delete cascade,
  created_at bigint not null default public.now_ms(),
  primary key (user_id, post_id)
);

create index if not exists post_saves_user_idx
  on public.post_saves (user_id, created_at desc);

alter table public.post_saves enable row level security;

drop policy if exists post_saves_select_own on public.post_saves;
create policy post_saves_select_own on public.post_saves
  for select to authenticated
  using (user_id = public.me_id());

drop policy if exists post_saves_insert_own on public.post_saves;
create policy post_saves_insert_own on public.post_saves
  for insert to authenticated
  with check (user_id = public.me_id());

drop policy if exists post_saves_delete_own on public.post_saves;
create policy post_saves_delete_own on public.post_saves
  for delete to authenticated
  using (user_id = public.me_id());

create or replace function public.save_post(p_post_id bigint, p_saved boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
end $function$;

create or replace function public.post_saved(p_post_id bigint)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from post_saves s
     where s.user_id = public.me_id()
       and s.post_id = p_post_id
  );
$function$;

create or replace function public.saved_posts(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  post  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  -- Cursor is the save's own timestamp, not the post's: you want the things you
  -- kept most recently, whatever order they were posted in.
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
end $function$;

create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'likeCount', (select count(*) from post_reactions r where r.post_id = p_post_id),
    'commentCount', (select count(*) from post_comments c where c.post_id = p_post_id and not c.hidden and not public.is_blocked_pair(p_viewer, c.author_id)),
    'liked', exists (select 1 from post_reactions r where r.post_id = p_post_id and r.user_id = p_viewer),
    'saved', exists (select 1 from post_saves s where s.post_id = p_post_id and s.user_id = p_viewer)
  );
$function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.save_post(bigint, boolean) from public, anon, authenticated;
grant execute on function public.save_post(bigint, boolean) to authenticated, service_role;
revoke all on function public.post_saved(bigint) from public, anon, authenticated;
grant execute on function public.post_saved(bigint) to authenticated, service_role;
revoke all on function public.saved_posts(integer, bigint) from public, anon, authenticated;
grant execute on function public.saved_posts(integer, bigint) to authenticated, service_role;
revoke all on function public.post_engagement(bigint, bigint) from public, anon, authenticated;
grant execute on function public.post_engagement(bigint, bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
