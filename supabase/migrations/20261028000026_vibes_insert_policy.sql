-- Vibes table has RLS enabled but only a SELECT policy. create_vibe is
-- SECURITY DEFINER so it should bypass RLS, but add an INSERT policy as a
-- safety net so authenticated members can always create their own vibes even
-- if the definer bypass isn't in effect on a given deployment.

drop policy if exists vibes_insert_own on public.vibes;
create policy vibes_insert_own on public.vibes
  for insert to authenticated
  with check (author_id = public.me_id());
