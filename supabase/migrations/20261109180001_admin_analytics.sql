-- Aggregates only: no message text, personal identifiers or fake event history.
create or replace function public.holup_admin_analytics() returns jsonb
language plpgsql security definer set search_path=public as $$
declare since7 bigint:=public.now_ms()-7*86400000; result jsonb;
begin
  if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
  insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_analytics','{}'::jsonb);
  select jsonb_build_object(
    'members', (select count(*) from public.profiles where onboarded),
    'seenLast7Days', (select count(*) from public.profiles where onboarded and last_active_at>=since7),
    'newMembersLast7Days', (select count(*) from public.profiles where onboarded and created_at>=since7),
    'postsLast7Days', (select count(*) from public.posts where created_at>=since7),
    'reactionsLast7Days', (select count(*) from public.post_reactions where created_at>=since7),
    'commentsLast7Days', (select count(*) from public.post_comments where created_at>=since7),
    'whispersLast7Days', (select count(*) from public.messages where created_at>=since7),
    'openReports', (select count(*) from public.reports where not handled)
  ) into result;
  return result;
end $$;
revoke all on function public.holup_admin_analytics() from public,anon,authenticated;
grant execute on function public.holup_admin_analytics() to authenticated,service_role;
notify pgrst,'reload schema';
