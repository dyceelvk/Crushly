-- 20261029084324 profile_moment_ring
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (pg_get_functiondef).
-- Idempotent (create or replace), safe to replay.
--
-- What this migration owns: visible_moments(), the single server-side source
-- for the ring of Moments at the top of the app. It replaced a client-side loop
-- that fetched every live Moment and filtered it in the browser — which leaked
-- the ids of Moments you could not see.
--
-- Returns a SETOF jsonb already serialized for the caller, oldest first, with
-- can_view_moment applied per row (expiry, audience, blocks, incognito).

create or replace function public.visible_moments()
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  m public.moments;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  for m in select * from moments mo where mo.expires_at > public.now_ms() order by mo.created_at asc loop
    if public.can_view_moment(m, me) then
      return next public.serialize_moment(m, me);
    end if;
  end loop;
end $function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.visible_moments() from public, anon, authenticated;
grant execute on function public.visible_moments() to authenticated, service_role;

notify pgrst, 'reload schema';
