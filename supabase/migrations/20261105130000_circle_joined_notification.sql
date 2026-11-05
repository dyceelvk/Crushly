/*
 * Someone is in your room — say so in words that fit the owner.
 *
 * `circle_approved` is what a person hears when they are let in: "Riel let you
 * into Sunday Go Sharp". The same kind was being sent to the owner when the
 * membership went the other way (a self-join on an open room, or an invitation
 * being accepted), so the owner read their own approval back. Same event, two
 * opposite sentences, one kind — so the owner's side gets its own kind and can
 * be phrased from the owner's point of view.
 */
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('crush', 'deep_crush', 'mutual', 'message', 'moment_reply',
                  'moment_reaction', 'verified', 'verification_rejected',
                  'post_reaction', 'post_comment',
                  'circle_request', 'circle_approved', 'circle_declined',
                  'circle_invite', 'circle_joined'));

create or replace function public.join_circle(p_circle_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
  req public.circle_join_requests;
  inv public.circle_invitations;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;

  if exists (select 1 from circle_members where circle_id = c.id and member_id = me) then
    return jsonb_build_object('state', 'member', 'already', true);
  end if;

  if public.is_blocked_pair(me, c.owner_id) then
    perform public.crushly_fail(403, '', 'You cannot join this Circle.');
  end if;

  -- Invited already: this is not an ask, it is an answer.
  select * into inv from circle_invitations
   where circle_id = c.id and member_id = me and status = 'pending';
  if found then
    select count(*) into n from circle_members where circle_id = c.id;
    if n >= public.circle_capacity() then
      perform public.crushly_fail(409, '', 'This Circle is full.');
    end if;
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, me, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
    update circle_invitations
       set status = 'accepted', decided_at = public.now_ms()
     where id = inv.id;
    perform public.notify_to(c.owner_id, 'circle_joined', me, c.id, left(c.name, 60));
    return jsonb_build_object('state', 'member', 'viaInvitation', true);
  end if;

  if not c.discoverable then
    perform public.crushly_fail(403, '', 'That Circle is private.');
  end if;

  if c.join_policy = 'invite' then
    perform public.crushly_fail(403, '', 'This Circle only takes people the owner adds.');
  end if;

  select count(*) into n from circle_members where circle_id = c.id;
  if n >= public.circle_capacity() then
    perform public.crushly_fail(409, '', 'This Circle is full.');
  end if;

  if c.join_policy = 'open' then
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, me, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
    perform public.notify_to(c.owner_id, 'circle_joined', me, c.id, left(c.name, 60));
    return jsonb_build_object('state', 'member');
  end if;

  select * into req from circle_join_requests
   where circle_id = c.id and member_id = me and status = 'pending';
  if not found then
    insert into circle_join_requests (circle_id, member_id)
      values (c.id, me)
      returning * into req;
    perform public.notify_to(c.owner_id, 'circle_request', me, c.id, left(c.name, 60));
  end if;

  return jsonb_build_object('state', 'pending', 'requestId', req.id);
end $function$;
