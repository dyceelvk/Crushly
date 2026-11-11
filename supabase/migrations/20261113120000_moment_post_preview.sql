-- A Moment can now be a whole post, nine seconds of it.
--
-- Sharing a post to Moments used to mean re-uploading the file, so a clip that
-- was fifteen seconds long could not be shared at all (Moments cap at 25 s but
-- the point of this feature is a *preview*, not a re-post) and a written post had
-- nothing to share. A shared post is now a reference: the Moment points at the
-- post, plays nine seconds of it, and shows the author's handle under the card.
--
-- What this buys, on purpose:
--
--  · Nothing is copied. The post keeps its own audience and its own rules; the
--    Moment's audience decides who sees the *preview*, and `can_view_post` is
--    applied when the Moment is read. So somebody who loses access to the post
--    stops seeing the preview too, which re-uploading could never do.
--  · The name under the card is the post's author, not whoever shared it, and it
--    is read at display time. A rename is a rename, not a stale copy.
--  · Nine seconds is a constant here as well as in the client, so a client that
--    asks for sixty is not granted sixty.

alter table public.moments
  add column if not exists post_id bigint references public.posts(id) on delete cascade;

-- A shared post is its own kind of Moment, so the existing check has to allow it.
alter table public.moments drop constraint if exists moments_kind_check;
alter table public.moments add constraint moments_kind_check
  check (kind in ('text', 'photo', 'video', 'post'));

create index if not exists moments_post_id_idx on public.moments(post_id) where post_id is not null;

comment on column public.moments.post_id is
  'Set when this Moment is a nine-second preview of a post rather than a new upload.';

/* ------------------------------------------------- creating a shared Moment */

create or replace function public.share_post_to_moment(
  p_post_id bigint,
  p_audience text default 'everyone',
  p_body text default ''
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  me            bigint := public.me_id();
  po            public.posts;
  clean_audience text := coalesce(p_audience, 'everyone');
  clean_body    text := left(coalesce(p_body, ''), 200);
  new_id        bigint;
  m             public.moments;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if clean_audience not in ('everyone', 'connections') then
    clean_audience := 'everyone';
  end if;

  select * into po from posts p where p.id = p_post_id;
  -- You can only share what you can see. The same refusal for "no such post" and
  -- "not yours to see", so a share cannot be used to probe for post ids.
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;

  -- One live preview per post per person. Sharing the same post twice in a day
  -- replaces the earlier card rather than stacking two identical ones in
  -- everybody's row.
  update moments
     set expires_at = 0
   where user_id = me and post_id = p_post_id and expires_at > public.now_ms();

  insert into moments (user_id, kind, body, style, audience, expires_at, post_id)
  values (me, 'post', clean_body, 'noir', clean_audience, public.now_ms() + 24 * 60 * 60 * 1000, p_post_id)
  returning id into new_id;

  select * into m from moments mo where mo.id = new_id;
  return public.serialize_moment(m, me);
end $$;

grant execute on function public.share_post_to_moment(bigint, text, text) to authenticated, service_role;

/* ------------------------------------------------------ reading them back */

/*
 * `serialize_moment` is replaced *verbatim* from what is live, plus one field.
 *
 * Rewriting it from memory would have quietly dropped the author card, the
 * seen flag, the viewer's own reaction and the owner-only view count. The whole
 * function is restated so the only difference is the `post` block at the end.
 */
create or replace function public.serialize_moment(m moments, p_viewer bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  mine boolean := m.user_id = p_viewer;
  result jsonb;
  po public.posts;
  pa public.profiles;
begin
  result := jsonb_build_object(
    'id', m.id,
    'userId', m.user_id,
    'kind', m.kind,
    'body', m.body,
    'mediaUrl', m.media_url,
    'style', m.style,
    'audience', m.audience,
    'createdAt', m.created_at,
    'expiresAt', m.expires_at,
    'edit', m.edit,
    'durationMs', m.duration_ms,
    'seen', exists (select 1 from moment_views mv where mv.moment_id = m.id and mv.user_id = p_viewer),
    'myReaction', (select r.kind from moment_reactions r where r.moment_id = m.id and r.user_id = p_viewer),
    'author', (
      select jsonb_build_object(
        'id', pf.id,
        'name', pf.name,
        'verified', pf.verification = 'verified',
        'photo', public.photos_of(pf.id) -> 0 ->> 'url',
        'mutual', pf.id <> p_viewer and public.is_connected_pair(p_viewer, pf.id)
      ) from profiles pf where pf.id = m.user_id
    )
  );

  /* A Moment that is a preview of a post carries what the card needs and no
     more: the post's own media, its author's handle, and nine seconds. */
  if m.post_id is not null then
    select * into po from posts pp where pp.id = m.post_id;
    if found and public.can_view_post(po, p_viewer) then
      select * into pa from profiles pr where pr.id = po.author_id;
      result := result || jsonb_build_object(
        'post', jsonb_build_object(
          'id', po.id,
          'body', po.body,
          'mediaUrl', po.media_url,
          'mediaKind', case
            when po.media_url is null then null
            when po.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'authorId', po.author_id,
          'authorName', pa.name,
          'username', nullif(pa.username, ''),
          'previewMs', 9000
        )
      );
    end if;
  end if;

  if mine then
    result := result || jsonb_build_object(
      'viewCount', (select count(*)::int from moment_views mv where mv.moment_id = m.id and mv.user_id <> p_viewer),
      'reactions', coalesce((
        select jsonb_agg(jsonb_build_object('kind', r.kind, 'userId', r.user_id, 'name', p.name)
                         order by r.created_at desc)
          from moment_reactions r join profiles p on p.id = r.user_id
         where r.moment_id = m.id
      ), '[]'::jsonb)
    );
  end if;
  return result;
end $function$;

notify pgrst, 'reload schema';
