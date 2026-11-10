create or replace function public.peer_presence(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  r record;
  v record;
  see_online boolean;
  see_activity boolean;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c
   where c.id = p_conversation_id and (c.user_a = me or c.user_b = me);
  if not found then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;

  -- Closed or blocked threads must not disclose either person's current
  -- presence, activity, or receipt preferences. Keep the established return
  -- shape so older clients stop announcing rather than crashing.
  if conv.closed or public.is_blocked_pair(conv.user_a, conv.user_b) then
    return jsonb_build_object('peerId', peer, 'online', null, 'activity', null,
      'receipts', false, 'announce', false, 'closed', true);
  end if;

  select p.last_active_at, pr.show_online, pr.show_activity into r
    from profiles p join privacy pr on pr.user_id = p.id where p.id = peer;
  select pr.show_online, pr.show_activity into v from privacy pr where pr.user_id = me;

  see_online := coalesce(r.show_online, true) and coalesce(v.show_online, true);
  see_activity := see_online and coalesce(r.show_activity, true) and coalesce(v.show_activity, true);

  return jsonb_build_object(
    'peerId', peer,
    'online', case when see_online then public.is_online_at(r.last_active_at) else null end,
    'activity', case when see_activity then public.activity_label_at(r.last_active_at) else null end,
    'receipts', public.receipts_visible(me, peer),
    'announce', coalesce(v.show_online, true),
    'closed', conv.closed
  );
end $$;
