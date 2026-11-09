-- ISOLATED EXPERIMENT, NOT A PRODUCTION MIGRATION. Requires current legacy
-- schema. No serving or transcoding job is provided. Only a trusted isolated
-- transcode service may write an already-validated short preview object.
begin;
create table if not exists public.experimental_post_previews (
  post_id bigint primary key references public.posts(id) on delete cascade,
  source_media_url text not null,
  -- A completely separate, private rendition namespace. Never an original.
  object_key text not null unique check (object_key ~ '^public-previews/[a-f0-9]{64}\.mp4$'),
  created_at bigint not null default public.now_ms()
);
alter table public.experimental_post_previews enable row level security;
revoke all on public.experimental_post_previews from public,anon,authenticated;
-- Service-only writes require explicit production role/grant review.
grant select,insert,update,delete on public.experimental_post_previews to service_role;

-- The anonymous caller receives only a short-rendition key, NEVER source_media_url.
-- Sharing, public audience and Space privacy are re-evaluated on every call.
-- A Worker would still need to authorize each HTTP request/range, enforce the
-- browser allowance, keep the bucket private and never serve arbitrary keys.
create or replace function public.experimental_public_video_preview_key(p_post_id bigint)
returns text language sql stable security definer set search_path=public as $$
 select pv.object_key from public.experimental_post_previews pv
 join public.posts p on p.id=pv.post_id
 where pv.post_id=p_post_id and p.media_url=pv.source_media_url
   and p.media_url is not null
   -- This experimental encoder does not yet render edits or attached sounds.
   -- Fail closed rather than expose footage the owner trimmed out.
   and p.edit is null and (p.sound_id is null or exists (select 1 from public.sounds snd
     where snd.id=p.sound_id and snd.owner_id=p.author_id and snd.title='Original sound' and snd.media_url is null))
   and public.public_post_preview(p.id) is not null
 limit 1
$$;
revoke all on function public.experimental_public_video_preview_key(bigint) from public,anon,authenticated;
grant execute on function public.experimental_public_video_preview_key(bigint) to anon,authenticated,service_role;
commit;
