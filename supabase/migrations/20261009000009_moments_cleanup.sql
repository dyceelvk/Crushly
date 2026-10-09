-- Expired Moments: delete the row *and* the photo behind it.
--
-- Until now expiry was only a filter — the feed hid Moments after 24 hours, but
-- the row stayed in the database and the photo stayed in Storage forever, so a
-- link anyone had already saved kept working. That is a broken promise and a
-- privacy exposure, not just wasted space.
--
-- This adds the missing half: a bounded, fail-safe sweep.
--
-- Running it — either works, both are idempotent:
--   * the scheduled workflow .github/workflows/cleanup.yml (hourly, no
--     extension needed):  select public.cleanup_expired_moments();
--   * pg_cron, if enabled under Database → Extensions:
--                        select public.schedule_moment_cleanup();
--
-- Photos that live in the external object store are deleted by that bucket's
-- own lifecycle rule, so the sweep leaves them alone — it never deletes a file
-- it did not upload, and it never deletes anything that has not expired.

-- Audit trail: every deletion attempt is recorded, successes and failures alike,
-- so orphans are visible instead of silent. Service role only.
create table if not exists public.media_cleanup_log (
  id          bigint generated always as identity primary key,
  media_path  text not null,
  reason      text not null,
  ok          boolean not null,
  detail      text,
  created_at  bigint not null default public.now_ms()
);
create index if not exists media_cleanup_log_created_idx on public.media_cleanup_log (created_at);
alter table public.media_cleanup_log enable row level security;

-- Deletes at most `p_limit` expired Moments (oldest first) together with the
-- Supabase Storage object each one points at. Returns how many rows went.
--
-- Order matters: the row is deleted first, so a Moment is never left visible
-- with a file that has already gone. Storage cleanup is best effort — a failure
-- is logged and the sweep carries on rather than aborting the batch.
create or replace function public.cleanup_expired_moments(p_limit int default 500)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_deleted int := 0;
  v_path text;
  v_has_storage boolean := to_regclass('storage.objects') is not null;
begin
  for v_row in
    select id, media_url
      from public.moments
     where expires_at <= public.now_ms()
     order by expires_at
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      delete from public.moments m where m.id = v_row.id;
      v_deleted := v_deleted + 1;

      v_path := nullif(btrim(coalesce(v_row.media_url, '')), '');
      -- Absolute URLs point at the external object store, where the bucket's
      -- lifecycle rule owns deletion. Bare paths are Supabase Storage objects.
      if v_path is not null
         and v_path !~ '^(https?:|file:|blob:|data:)'
         and v_has_storage then
        begin
          delete from storage.objects o
           where o.bucket_id = 'media'
             and o.name = regexp_replace(v_path, '^/+', '');
          insert into public.media_cleanup_log (media_path, reason, ok)
            values (v_path, 'moment_expired', true);
        exception when others then
          insert into public.media_cleanup_log (media_path, reason, ok, detail)
            values (v_path, 'moment_expired', false, sqlerrm);
        end;
      end if;
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

-- Schedules the sweep with pg_cron, if pg_cron is enabled. Safe to run twice.
create or replace function public.schedule_moment_cleanup(p_schedule text default '23 * * * *')
returns text
language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('cron.job') is null then
    return 'pg_cron is not enabled on this project — the sweep runs from .github/workflows/cleanup.yml instead. To use pg_cron: Database → Extensions → pg_cron, then run select public.schedule_moment_cleanup();';
  end if;

  if exists (select 1 from cron.job where jobname = 'crushly_moment_cleanup') then
    return 'already scheduled (crushly_moment_cleanup)';
  end if;

  perform cron.schedule('crushly_moment_cleanup', p_schedule, 'select public.cleanup_expired_moments()');
  return 'scheduled crushly_moment_cleanup: ' || p_schedule;
end $$;

revoke all on function public.schedule_moment_cleanup(text) from public, anon, authenticated;
grant execute on function public.schedule_moment_cleanup(text) to service_role;

-- Wire it up automatically on projects that have pg_cron; a no-op elsewhere.
do $$
begin
  if to_regclass('cron.job') is not null then
    perform public.schedule_moment_cleanup();
  else
    raise notice 'pg_cron not present — Moment cleanup runs from the scheduled workflow.';
  end if;
end $$;
