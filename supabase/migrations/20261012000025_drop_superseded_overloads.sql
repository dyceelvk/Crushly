-- Remove the functions that were left behind when a parameter was added.
--
-- `create or replace function` only replaces a function whose parameter list is
-- identical. Adding `p_edit` at the end (021, 022, 023, 024) therefore created a
-- second function instead of replacing the first, and the older one stayed. When
-- the app posts something without a video edit it does not send `p_edit`, and
-- two candidates both accept that call, so PostgREST cannot choose one and
-- answers 300. That is why posting a Vibe, a Moment, a post — and sending a
-- Circle message — all failed while the rest of the app worked.
--
-- Each drop is guarded: the older function is removed only when the newer one is
-- present, so this can be run more than once and cannot take anything down.
--
-- After the drops, PostgREST is told to reload its schema cache, so the fix is
-- live at once instead of on its next refresh.

do $$
begin
  -- 024 added p_edit to create_post; 016's four-argument version is the leftover.
  if to_regprocedure('public.create_post(text, text, text, bigint, jsonb)') is not null then
    drop function if exists public.create_post(text, text, text, bigint);
  end if;

  -- 022 added p_edit to create_moment.
  if to_regprocedure('public.create_moment(text, text, text, text, text, jsonb)') is not null then
    drop function if exists public.create_moment(text, text, text, text, text);
  end if;

  -- 021 added p_edit to create_vibe.
  if to_regprocedure('public.create_vibe(text, text, text, text, integer, jsonb)') is not null then
    drop function if exists public.create_vibe(text, text, text, text, integer);
  end if;

  -- 023 added p_edit to send_circle_message.
  if to_regprocedure('public.send_circle_message(bigint, text, text, text, jsonb)') is not null then
    drop function if exists public.send_circle_message(bigint, text, text, text);
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check afterwards: each name below should answer with exactly one signature.
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('create_post', 'create_moment', 'create_vibe', 'send_circle_message')
--    order by p.proname, args;
