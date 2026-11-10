-- Run only on a disposable test database. Direct RPC exposes a caller-chosen
-- viewer and bypasses profile visibility; service wrappers retain access.
do $$
begin
  assert not has_function_privilege('anon', 'public.public_profile(bigint,bigint,boolean)', 'execute'),
    'anonymous callers must not execute the internal serializer';
  assert not has_function_privilege('authenticated', 'public.public_profile(bigint,bigint,boolean)', 'execute'),
    'authenticated callers must not impersonate a viewer via the serializer';
  assert has_function_privilege('postgres', 'public.public_profile(bigint,bigint,boolean)', 'execute'),
    'server-side SECURITY DEFINER wrappers must retain access';
end $$;
