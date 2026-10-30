-- 20261029084055 space_posts
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (pg_get_functiondef).
-- Idempotent (create or replace), safe to replay.
--
-- What this migration owns: the "Space" feeds on a profile — the posts and the
-- live Vibes belonging to one author, cursor-paged.
--   * space_posts(author_id, p_limit, p_after)
--   * space_vibes(author_id, p_limit, p_after)
--
-- Both go through can_view_post / can_view_vibe per row rather than trusting
-- the author id alone, so a Space can never leak a Circle post or a Vibe whose
-- audience has since narrowed.

create or replace function public.space_posts(p_author_id bigint, p_limit integer default 20, p_after bigint default null::bigint)
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

  for r in
    select po.* from posts po
     where po.author_id = p_author_id
       and (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
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
          'edit', r.edit,
          'audience', r.audience,
          'circleId', r.circle_id,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $function$;

create or replace function public.space_vibes(p_author_id bigint, p_limit integer default 30, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  vibe  public.vibes;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select v.* from vibes v
     where v.author_id = p_author_id
       and v.expires_at > public.now_ms()
       and (p_after is null or v.created_at < (select v2.created_at from vibes v2 where v2.id = p_after)
                             or (v.created_at = (select v2.created_at from vibes v2 where v2.id = p_after) and v.id < p_after))
     order by v.created_at desc, v.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 60)
  loop
    select * into vibe from vibes where id = r.id;
    if public.can_view_vibe(vibe, me) then
      items := items || jsonb_build_array(public.serialize_vibe(vibe, me));
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.space_posts(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.space_posts(bigint, integer, bigint) to authenticated, service_role;
revoke all on function public.space_vibes(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.space_vibes(bigint, integer, bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
