-- The blue ring around a profile photo means "this person has a Moment right
-- now". Every screen that wanted to draw it had to fetch the moments itself to
-- find out. `load_profile` already returns a `moments` array, but an array is
-- the wrong shape for a yes/no question — it is capped at six, it carries
-- media URLs nobody asked for, and on a list it is six rows of work per
-- person. `hasMoment` is that boolean, computed once, next to the profile it
-- describes, by the same rule the viewer used, so the ring cannot claim a
-- Moment the viewer is not allowed to open.

/* -------------------------------------------------------------- load_profile */

-- `hasMoment` is the ring. `moments` stays as it was so nothing that already
-- reads it breaks; the boolean is what a 120px avatar can actually use.
create or replace function public.load_profile(p_target_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me      bigint := public.me_id();
  profile jsonb;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  profile := public.load_visible_profile(me, p_target_id, true);
  if profile is null then
    return null;
  end if;
  return profile || jsonb_build_object(
    'moments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'body', t.body, 'mediaUrl', t.media_url,
        'style', t.style, 'createdAt', t.created_at
      ) order by t.id desc)
        from (
          select id, kind, body, media_url, style, created_at
            from moments
           where user_id = p_target_id and expires_at > public.now_ms()
             and (audience = 'everyone' or public.is_connected_pair(me, p_target_id))
           order by id desc limit 6
        ) t
    ), '[]'::jsonb),
    -- Judged one row at a time by the same rule the viewer used, so the ring
    -- cannot say "Moment" about a Moment the viewer is not allowed to open.
    'hasMoment', exists (
      select 1 from moments m
       where m.user_id = p_target_id
         and m.expires_at > public.now_ms()
         and public.can_view_moment(m, me)
    )
  );
end $$;

revoke all on function public.load_profile(bigint) from public, anon, authenticated;
grant execute on function public.load_profile(bigint) to authenticated, service_role;
