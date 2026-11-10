-- This internal serializer trusts the supplied viewer and target and does not
-- enforce profile visibility. Only authorized SECURITY DEFINER entry points
-- may call it; direct RPC must not permit viewer impersonation.
revoke execute on function public.public_profile(bigint, bigint, boolean)
  from public, anon, authenticated;
