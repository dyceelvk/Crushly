-- Remove the old two-argument comment_on_post.
--
-- Threading added a third argument (the parent being answered), and the new
-- function was created with `create or replace` — which cannot replace a
-- function whose argument list differs. So the database ended up holding two
-- of them: the original (post, body) and the new (post, body, parent).
--
-- PostgREST resolves a call by its named arguments. A client that sends only
-- p_post_id and p_body — which is every build released before threading — now
-- matches both candidates and gets a 203 back: "Could not choose the best
-- candidate function". Commenting would simply fail for anyone who has not
-- updated the app yet.
--
-- The old signature also predates the thread guard and soft delete, so it must
-- not stay reachable as a way around them. Dropping it leaves one function,
-- the one that knows about parents, and the default on p_parent_id keeps the
-- old two-argument call shape working for every caller that still uses it.
--
-- The grants are carried over deliberately: the new function is executable by
-- `authenticated`, which the old one never was.

do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'comment_on_post'
       and p.pronargs = 2
  ) then
    drop function public.comment_on_post(bigint, text);
  end if;
end $$;

-- Belt and braces: make the surviving signature callable for signed-in members
-- even if it was recreated without its grant.
grant execute on function public.comment_on_post(bigint, text, bigint) to authenticated;
