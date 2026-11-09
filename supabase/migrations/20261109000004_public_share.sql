-- An anonymous preview is deliberately separate from signed-in post access.
-- Never expose media URLs: Worker media remains behind live authorization.
-- Every request re-evaluates current audience and profile privacy.
create or replace function public.public_post_preview(p_post_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('id',po.id,'body',left(po.body,300),'author',p.name)
  from posts po join profiles p on p.id=po.author_id join privacy pr on pr.user_id=p.id
  where po.id=p_post_id and po.audience='everyone' and po.circle_id is null
    and p.onboarded and p.status='active' and pr.profile_visibility='everyone' and not pr.incognito
  limit 1
$$;
revoke all on function public.public_post_preview(bigint) from public, anon, authenticated;
grant execute on function public.public_post_preview(bigint) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
