-- The serializer accepts caller-supplied viewer and target ids and does not enforce visibility.
-- Only server-side security-definer functions should invoke it after authorization.
revoke execute on function public.public_profile(bigint, bigint, boolean) from public, anon, authenticated;
