-- Deleting a post or a file deletes it everywhere. No tombstones, no orphans.
--
-- The promise the app makes — "it disappears for everyone, right away" — was
-- only ever kept in the database. Three separate leaks made it false at the
-- storage layer, and all three are fixed here:
--
--   1. `delete_post` removed the row. Nothing removed the file. A deleted post's
--      photo or clip stayed in the bucket forever, fetchable by anyone who still
--      held the link.
--   2. `cleanup_expired_moments` deliberately skipped *absolute* URLs, on the
--      reasoning that the bucket's lifecycle rule would deal with them. That is
--      true for Moments written to R2 — the `moments/` rule does expire them —
--      but nothing expires anything in B2, where every Moment written before the
--      move lives. Those files were kept by nobody and deleted by nothing.
--   3. `delete_account` removed the auth user and cascaded the rows. Every photo,
--      Moment, Whisper attachment and post media of that person stayed behind,
--      nameless, in the bucket.
--
-- The shape of the fix is a queue, not a fire-and-forget call. A client cannot be
-- trusted to finish a deletion: the app can be killed between the row going and
-- the file going, and an older install has no idea this step exists. So the
-- database writes down what must be deleted, inside the same transaction that
-- deletes the row, and a drain empties the queue afterwards. If the queue cannot
-- be emptied — no Worker, no credential — the intent is still recorded, and the
-- next run picks it up.

create table if not exists public.media_deletions (
  path        text primary key,
  reason      text not null,
  created_at  bigint not null default public.now_ms(),
  attempts    int not null default 0,
  last_error  text,
  deleted_at  bigint
);

create index if not exists media_deletions_pending_idx
  on public.media_deletions (created_at)
  where deleted_at is null;

alter table public.media_deletions enable row level security;
-- Nothing but the service role touches this table: it is a work list, not a
-- record a member has any business reading.

/**
 * Write down a file that must go.
 *
 * Accepts any of the shapes a media reference takes — a Worker URL, a Supabase
 * public URL, a bare path — and reduces it to the object key, because that is
 * what both stores are addressed by. Anything that is not ours (a remote URL, a
 * data URI, a file still only on somebody's phone) is ignored rather than
 * queued, so a drain can never be talked into deleting an arbitrary key.
 */
create or replace function public.queue_media_deletion(p_ref text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_path text := nullif(btrim(coalesce(public.media_object_path(p_ref), '')), '');
  v_kind text;
begin
  if v_path is null then return; end if;

  -- Only the six kinds the uploader mints. A path that does not start with one
  -- of them never came from this app, and is not ours to delete.
  v_kind := split_part(ltrim(v_path, '/'), '/', 1);
  if v_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'banners') then
    return;
  end if;

  insert into public.media_deletions (path, reason)
  values (ltrim(v_path, '/'), coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'deleted'))
  on conflict (path) do nothing;
end $$;

-- ------------------------------------------------------------------ the posts

create or replace function public.delete_post(p_post_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_path text;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select media_url into v_path
    from posts where id = p_post_id and author_id = me;

  /*
   * The row and the work item go together or not at all.
   *
   * If the delete below rolls back, so does the queue entry — there is no
   * version of this where a file is deleted for a post that still exists.
   */
  if v_path is not null and btrim(v_path) <> '' then
    perform public.queue_media_deletion(v_path, 'post_deleted');
  end if;

  delete from posts where id = p_post_id and author_id = me;
  return found;
end $$;

revoke all on function public.delete_post(bigint) from public, anon, authenticated;
grant execute on function public.delete_post(bigint) to authenticated, service_role;

-- ------------------------------------------------------------------ the Moments

create or replace function public.delete_moment(p_moment_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  m public.moments;
begin
  select * into m from moments mo where mo.id = p_moment_id and mo.user_id = me;
  if not found then
    perform public.crushly_fail(404, '', 'Moment not found.');
  end if;

  perform public.queue_media_deletion(m.media_url, 'moment_deleted');
  delete from moments mo where mo.id = m.id;
  return true;
end $$;

revoke all on function public.delete_moment(bigint) from public, anon, authenticated;
grant execute on function public.delete_moment(bigint) to authenticated, service_role;

/**
 * Expired Moments, including the ones in the object store.
 *
 * The previous version deleted Supabase Storage objects and left every absolute
 * URL to a lifecycle rule that only exists for `moments/` in R2. Everything
 * written before the move — which is nearly all of it — was skipped, so an
 * expired Moment's row went and its file did not.
 */
create or replace function public.cleanup_expired_moments(p_limit int default 500)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_deleted int := 0;
begin
  for v_row in
    select id, media_url
      from public.moments
     where expires_at <= public.now_ms()
     order by expires_at
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.queue_media_deletion(v_row.media_url, 'moment_expired');
      delete from public.moments m where m.id = v_row.id;
      v_deleted := v_deleted + 1;
    exception when others then
      -- One bad row must never stop the sweep, and must never be silent.
      insert into public.media_cleanup_log (media_path, reason, ok, detail)
        values (coalesce(v_row.media_url, ''), 'moment_row', false, sqlerrm);
    end;
  end loop;

  return v_deleted;
end $$;

revoke all on function public.cleanup_expired_moments(int) from public, anon, authenticated;
grant execute on function public.cleanup_expired_moments(int) to service_role;

-- ------------------------------------------------------------- closing a Space

/**
 * Everything this member ever uploaded, queued before the account goes.
 *
 * `delete_account` removes the auth user, and the cascades take every row with
 * it — which means that after this call there is nothing left to say *which*
 * files belonged to them. So the list is written down first, while the rows are
 * still there to be read.
 */
create or replace function public.queue_all_member_media(p_user bigint, p_reason text default 'account_deleted')
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  if p_user is null then return 0; end if;

  perform public.queue_media_deletion(url, p_reason) from public.photos where user_id = p_user;
  perform public.queue_media_deletion(media_url, p_reason) from public.moments where user_id = p_user;
  perform public.queue_media_deletion(media_url, p_reason) from public.messages where sender_id = p_user;
  perform public.queue_media_deletion(media_url, p_reason) from public.posts where author_id = p_user;
  perform public.queue_media_deletion(url, p_reason) from public.profile_banners where profile_id = p_user;
  select count(*) into n from public.media_deletions where deleted_at is null and reason = p_reason;
  return n;
end $$;

revoke all on function public.queue_all_member_media(bigint, text) from public, anon, authenticated;
grant execute on function public.queue_all_member_media(bigint, text) to service_role;

create or replace function public.delete_account(p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid();
  encrypted text;
  profile bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select u.encrypted_password into encrypted from auth.users u where u.id = me;
  if encrypted is null or extensions.crypt(coalesce(p_password, ''), encrypted) <> encrypted then
    perform public.crushly_fail(403, '', 'Enter your password to delete your account.');
  end if;

  -- Before the cascade: after it, their files are unattributable.
  select id into profile from public.profiles where auth_user_id = me;
  perform public.queue_all_member_media(profile, 'account_deleted');

  delete from auth.users u where u.id = me;
  return true;
end $$;

revoke all on function public.delete_account(text) from public, anon, authenticated;
grant execute on function public.delete_account(text) to authenticated, service_role;

-- ------------------------------------------------------------------- the drain
--
-- The Worker cannot read this table — it holds no service key, on purpose — so
-- the workflow reads a batch with the database credential it already has, hands
-- the paths to the Worker, and marks what the Worker confirmed.

create or replace function public.media_deletion_batch(p_limit int default 200)
returns table (path text, reason text)
language sql stable security definer set search_path = public as $$
  select d.path, d.reason
    from public.media_deletions d
   where d.deleted_at is null
   order by d.created_at
   limit greatest(coalesce(p_limit, 200), 1)
$$;

create or replace function public.media_deletion_result(p_path text, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.media_deletions d
     set attempts = d.attempts + 1,
         last_error = case when p_ok then null else coalesce(p_error, 'delete failed') end,
         deleted_at = case when p_ok then public.now_ms() else d.deleted_at end
   where d.path = p_path;
end $$;

revoke all on function public.media_deletion_batch(int) from public, anon, authenticated;
revoke all on function public.media_deletion_result(text, boolean, text) from public, anon, authenticated;
grant execute on function public.media_deletion_batch(int) to service_role;
grant execute on function public.media_deletion_result(text, boolean, text) to service_role;

notify pgrst, 'reload schema';
