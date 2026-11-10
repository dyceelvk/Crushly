-- Marked copies: a saveable clip, with the creator's name on it.
--
-- Saving a clip to a device is the one way a post leaves Holup, so the file that
-- leaves must carry the mark. That file is produced outside the request path: a
-- job downloads the original from the private bucket, burns in the mark and the
-- creator's handle, appends the end splash, and records the object key here. The
-- app never re-encodes anything, and the copy that plays inside Holup is
-- untouched.
--
-- Two rules this migration keeps, both of which are the whole point:
--
--   * a marked copy is only ever handed out to somebody who could already see
--     the post — the same `can_view_post` the feed uses, so a block, a private
--     audience or an expired Moment means no download either;
--   * the object key is never sent to a client. The Worker asks for it by post
--     id, with the member's own token, and streams the bytes itself. A key that
--     never leaves the server cannot be guessed, forwarded or replayed.

create table if not exists public.post_downloads (
  post_id bigint primary key references public.posts(id) on delete cascade,
  -- Where the marked file sits in the private bucket. Server-side only.
  object_key text not null,
  bytes bigint,
  created_at bigint not null default public.now_ms()
);

-- Nothing reads this table directly. A direct grant would let a member enumerate
-- which posts have marked copies, including posts they cannot see.
alter table public.post_downloads enable row level security;
revoke all on table public.post_downloads from public, anon, authenticated;

comment on table public.post_downloads is
  'Marked copies of clips, produced by the marking job. Reached only through post_download().';

/**
 * The object key for a post's marked copy, or null.
 *
 * Returns `{ path }` — never a full URL — so the caller (the media Worker) can
 * fetch from the bucket itself. Null, not an error, for every refusal: a member
 * who cannot see the post learns nothing about whether a marked copy exists.
 */
create or replace function public.post_download(p_post_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  po public.posts;
  d public.post_downloads;
begin
  if me is null then
    return null;
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    return null;
  end if;

  select * into d from post_downloads pd where pd.post_id = p_post_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object('path', d.object_key, 'bytes', d.bytes);
end $function$;

revoke all on function public.post_download(bigint) from public, anon;
grant execute on function public.post_download(bigint) to authenticated, service_role;

/**
 * The marking job's way in: which clips still need a copy, and the original to
 * work from.
 *
 * Deliberately restricted to the service role. A member calling this would be
 * asking the server to list every video post in the database, which is exactly
 * the enumeration `post_download` avoids.
 */
create or replace function public.posts_needing_download(p_limit integer default 20)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
begin
  -- Service role calls carry no member id; a member's call does, and is refused.
  if me is not null then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'mediaUrl', p.media_url,
      'authorId', p.author_id
    ) order by p.id)
    from (
      select po.id, po.media_url, po.author_id
      from posts po
      where po.media_url ~* '\.(mp4|webm|mov|m4v)(\?|$)'
        and not exists (select 1 from post_downloads pd where pd.post_id = po.id)
      order by po.id
      limit greatest(1, least(coalesce(p_limit, 20), 100))
    ) p
  ), '[]'::jsonb);
end $function$;

revoke all on function public.posts_needing_download(integer) from public, anon, authenticated;
grant execute on function public.posts_needing_download(integer) to service_role;

/** The job's write. One row per post; re-running replaces the copy. */
create or replace function public.register_post_download(
  p_post_id bigint,
  p_object_key text,
  p_bytes bigint default null
)
returns boolean
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
begin
  if me is not null then
    return false;
  end if;
  if p_object_key is null or p_object_key = '' then
    return false;
  end if;
  if not exists (select 1 from posts where id = p_post_id) then
    return false;
  end if;

  insert into post_downloads (post_id, object_key, bytes)
  values (p_post_id, p_object_key, p_bytes)
  on conflict (post_id) do update
    set object_key = excluded.object_key,
        bytes = excluded.bytes,
        created_at = public.now_ms();

  return true;
end $function$;

revoke all on function public.register_post_download(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.register_post_download(bigint, text, bigint) to service_role;

-- A post that is deleted takes its marked copy with it (the foreign key), and a
-- clip replaced by an edit leaves a stale row: the job overwrites on re-run, and
-- the Worker only serves what the row points at.
