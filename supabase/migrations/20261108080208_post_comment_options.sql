-- Comment controls are enforced by the database, including older app versions.
-- Creation and the choice happen in one transaction; the post is never briefly
-- public with comments enabled before the choice is applied.
alter table public.posts add column if not exists comments_enabled boolean not null default true;

create or replace function public.create_post_with_options(
  p_body text, p_media_url text, p_audience text, p_circle_id bigint,
  p_edit jsonb, p_comments_enabled boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if p_comments_enabled is null then
    perform public.crushly_fail(400, '', 'Choose whether comments are allowed.');
  end if;
  result := public.create_post(p_body, p_media_url, p_audience, p_circle_id, p_edit);
  update public.posts set comments_enabled = p_comments_enabled
    where id = (result->>'id')::bigint and author_id = public.me_id();
  if not found then
    perform public.crushly_fail(500, '', 'Could not save post options.');
  end if;
  return result || jsonb_build_object('commentsEnabled', p_comments_enabled);
end $$;
revoke all on function public.create_post_with_options(text,text,text,bigint,jsonb,boolean) from public, anon;
grant execute on function public.create_post_with_options(text,text,text,bigint,jsonb,boolean) to authenticated, service_role;

-- Also blocks old clients and direct inserts; enforcement does not rely on UI.
create or replace function public.enforce_post_comments_enabled()
returns trigger language plpgsql security definer set search_path = public as $$
declare allowed boolean;
begin
  select comments_enabled into allowed from public.posts where id = new.post_id;
  if allowed is distinct from true then
    perform public.crushly_fail(403, 'comments_disabled', 'Comments are turned off for this post.');
  end if;
  return new;
end $$;
revoke all on function public.enforce_post_comments_enabled() from public, anon, authenticated;
drop trigger if exists enforce_post_comments_enabled on public.post_comments;
create trigger enforce_post_comments_enabled before insert on public.post_comments
for each row execute function public.enforce_post_comments_enabled();

create or replace function public.post_comment_settings(p_post_id bigint)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare viewer bigint := public.me_id(); po public.posts;
begin
  if viewer is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into po from public.posts where id = p_post_id;
  if not found or not public.can_view_post(po, viewer) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;
  return po.comments_enabled;
end $$;
revoke all on function public.post_comment_settings(bigint) from public, anon;
grant execute on function public.post_comment_settings(bigint) to authenticated, service_role;
