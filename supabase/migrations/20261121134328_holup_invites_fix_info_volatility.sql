-- REQUIRES: relationship_cutover
-- holup_invite_info creates a member's reusable code on first use, so it must
-- be VOLATILE rather than STABLE. The original version was rejected by
-- PostgreSQL when it attempted its intentional insert inside a stable function.
create or replace function public.holup_invite_info()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  invite_code text;
  successful bigint := 0;
  pending bigint := 0;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select code into invite_code
    from public.holup_invite_codes
   where inviter_id = me and revoked_at is null;

  if invite_code is null then
    invite_code := replace(gen_random_uuid()::text, '-', '');
    insert into public.holup_invite_codes (inviter_id, code)
    values (me, invite_code)
    on conflict (inviter_id) do update
      set code = excluded.code,
          created_at = public.now_ms(),
          revoked_at = null
    returning code into invite_code;
  end if;

  select
    count(*) filter (where status = 'qualified'),
    count(*) filter (where status = 'claimed')
    into successful, pending
    from public.holup_referrals
   where inviter_id = me;

  return jsonb_build_object(
    'code', invite_code,
    'link', 'https://holupp.net/i/' || invite_code,
    'successful', successful,
    'pending', pending,
    'total', successful + pending
  );
end
$function$;

revoke all on function public.holup_invite_info() from public, anon;
grant execute on function public.holup_invite_info() to authenticated, service_role;

notify pgrst, 'reload schema';
