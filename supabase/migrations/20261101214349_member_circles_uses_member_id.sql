-- 20261101214349 member_circles_uses_member_id
--
-- Mirrored back from production's own migration history.
--
-- This migration was applied to `yzcssyebozfkmojqqdhc` on 2026-11-01 and
-- recorded under this version, but its file never landed in the repository —
-- so `supabase db push` refused to run at all with "Remote migration versions
-- not found in local migrations directory", which is why the web deploy job was
-- failing even after the hardcoded migration filename was fixed.
--
-- The SQL below is the statement stored in supabase_migrations.schema_migrations
-- for this version, restored verbatim so that replaying the directory in order
-- still produces the schema production actually has.
--
-- What it changes: `circle_members` keys members by `member_id`, not `user_id`.
-- The earlier `member_circles` still selected `cm.user_id` and `cm.role` off
-- that table, so it could not run. This replaces it with the member_id form and
-- fills in a role/muted fallback for the viewer.

create or replace function public.member_circles(p_member_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  connected boolean;
  items jsonb := '[]'::jsonb;
  r record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  connected := public.is_connected_pair(me, p_member_id);

  for r in
    select c.*,
           (select count(*) from circle_members cm2 where cm2.circle_id = c.id) as member_count,
           exists (select 1 from circle_members cm3 where cm3.circle_id = c.id and cm3.member_id = me) as i_am_in
      from circles c
     where exists (select 1 from circle_members cm where cm.circle_id = c.id and cm.member_id = p_member_id)
       and (
         c.visibility = 'public'
         or connected
         or exists (select 1 from circle_members cm5 where cm5.circle_id = c.id and cm5.member_id = me)
       )
     order by i_am_in desc, member_count desc, c.created_at desc
     limit 30
  loop
    items := items || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'about', r.about,
      'coverUrl', r.cover_url,
      'theme', r.theme,
      'visibility', r.visibility,
      'createdAt', r.created_at,
      'ownerId', r.owner_id,
      'myRole', case when r.i_am_in then coalesce((select cm6.role from circle_members cm6 where cm6.circle_id = r.id and cm6.member_id = me), 'member') else 'visitor' end,
      'muted', coalesce((select cm7.muted from circle_members cm7 where cm7.circle_id = r.id and cm7.member_id = me), false),
      'memberCount', r.member_count,
      'joined', r.i_am_in
    ));
  end loop;

  return jsonb_build_object('items', items, 'connected', connected);
end $function$;
