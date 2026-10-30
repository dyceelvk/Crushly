-- 20261029141213 fix_comment_on_post_overload
--
-- RECONSTRUCTED 2026-10-30. The objects this migration removed no longer exist
-- in production, so this file is the guard rather than a recovered dump: it
-- drops every public.comment_on_post overload except the canonical
-- (bigint, text, bigint) signature from 20261029122045_post_comment_threads.
--
-- Why it mattered: adding p_parent_id created a second overload instead of
-- replacing the first, and PostgREST then rejected rpc/comment_on_post as
-- ambiguous ("Could not choose the best candidate function"). Dropping by
-- identity rather than by hand keeps this correct even if another overload is
-- added later.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'comment_on_post'
  loop
    if fn.args <> 'p_post_id bigint, p_body text, p_parent_id bigint' then
      execute format('drop function public.comment_on_post(%s)', fn.args);
      raise notice 'dropped stale overload comment_on_post(%)', fn.args;
    end if;
  end loop;
end $$;
