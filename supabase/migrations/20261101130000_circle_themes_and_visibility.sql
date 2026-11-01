-- A Circle has a theme now, and a Circle knows who it is for.
--
-- Creating a Circle used to ask two questions: a name, and a sentence. Nothing
-- said what kind of room it was — so a "Sunday People" and a "Design Room" were
-- the same grey rectangle with a different word on it, and there was no way to
-- find a room you were not already in.
--
-- A theme is a chosen category, one of a fixed list the app draws from a search
-- box (plus whatever the owner types if nothing fits). It is text, not a lookup
-- table: a theme is a label on a room, and a label should never be able to stop
-- a room being made.
--
-- Visibility is the other half. A Circle is private by default — the room is for
-- the people in it — and an owner may make it public, which means it shows on
-- their Space to anybody who looks. Nothing about the posts or the conversation
-- changes: a public Circle is findable, not readable.

alter table public.circles
  add column if not exists theme text;

alter table public.circles
  add column if not exists visibility text not null default 'connections';

alter table public.circles
  drop constraint if exists circles_visibility_check;
alter table public.circles
  add constraint circles_visibility_check check (visibility in ('connections', 'public'));

-- A theme is a label, so it is short and it is trimmed. Empty becomes null.
create or replace function public.crushly_clean_theme(p text)
returns text
language sql
immutable
as $function$
  select nullif(left(trim(coalesce(p, '')), 40), '')
$function$;

/**
 * The owner's answer to "what kind of room is this, and who can find it".
 *
 * Separate from `create_circle` rather than a new parameter on it: the create
 * path is called by builds that predate themes, and an overload on a function
 * that already exists in production is a deployment waiting to go wrong. This is
 * called straight afterwards, by the owner, on a Circle they just made.
 */
create or replace function public.set_circle_look(p_circle_id bigint, p_theme text, p_visibility text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_owner bigint;
  v_theme text := public.crushly_clean_theme(p_theme);
  v_visibility text := case when p_visibility = 'public' then 'public' else 'connections' end;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select owner_id into v_owner from circles where id = p_circle_id;
  if v_owner is null then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;
  if v_owner <> me then
    perform public.crushly_fail(403, '', 'Only the owner can change this Circle.');
  end if;

  update circles set theme = v_theme, visibility = v_visibility where id = p_circle_id;
  return jsonb_build_object('id', p_circle_id, 'theme', v_theme, 'visibility', v_visibility);
end $function$;

/**
 * The Circles on somebody's Space.
 *
 * What a visitor may see, in one list: the Circles this member made public, and
 * — only when the two are connected — the ones they share with you. A Circle you
 * are in always comes first, because a room you are standing in is the thing you
 * came to check on.
 *
 * Deliberately not `my_circles`: that one is about you, and this one is about
 * somebody else, and the difference between them is the whole point.
 */
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
           exists (select 1 from circle_members cm3 where cm3.circle_id = c.id and cm3.user_id = me) as i_am_in,
           (select cm4.role from circle_members cm4 where cm4.circle_id = c.id and cm4.user_id = p_member_id) as their_role
      from circles c
     where exists (select 1 from circle_members cm where cm.circle_id = c.id and cm.user_id = p_member_id)
       and (
         c.visibility = 'public'
         or connected
         or exists (select 1 from circle_members cm5 where cm5.circle_id = c.id and cm5.user_id = me)
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
      'myRole', case when r.i_am_in then 'member' else 'visitor' end,
      'muted', false,
      'memberCount', r.member_count,
      'joined', r.i_am_in
    ));
  end loop;

  return jsonb_build_object('items', items, 'connected', connected);
end $function$;
