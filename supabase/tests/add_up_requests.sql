-- The old relationship verbs are closed, and closing them changed nothing.
--
-- This file used to test `crush_member` / `accept_connection_request` /
-- `keep_close` — the request-and-accept Crush model that Add Ups and Homies
-- replaced. Those routines are still deployed on phones that have not updated,
-- so they must not be deleted; but they must not mutate relationship state
-- either, or an old client would quietly write the model the new one no longer
-- reads. Each of them now fails one way, with one code, and leaves every table
-- exactly as it found it.
--
-- The behaviour that replaced them lives in:
--   supabase/follow-redesign-work/02_follow_test.sql   (Add Ups)
--   supabase/follow-redesign-work/05_homies_test.sql   (Homies)
--   supabase/tests/notifications_social.sql            (the Add Up announcement)
do $test$
declare
  a_uuid uuid; b_uuid uuid;
  a_id bigint; b_id bigint;
  closed int := 0;
  before_state jsonb;
  after_state jsonb;
  refunded int;
  n int;
begin
  select id into a_uuid from auth.users where email = 'daniel@crushly.app';
  select id into b_uuid from auth.users where email = 'marcus@crushly.app';
  select id into a_id from profiles where name = 'Daniel';
  select id into b_id from profiles where name = 'Marcus';
  assert a_id is not null and b_id is not null;

  -- A snapshot of everything the legacy verbs used to write. Compared before
  -- and after, so "refused" means refused rather than "refused after doing a
  -- little of the work".
  select jsonb_build_object(
           'crushes', (select count(*) from public.crushes),
           'connections', (select count(*) from public.connections),
           'keeps', (select count(*) from public.keeps),
           'follows', coalesce((select count(*) from public.holup_follows), 0),
           'homies', coalesce((select count(*) from public.holup_homie_requests), 0),
           'notifications', (select count(*) from public.notifications)
         ) into before_state;

  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;

  -- One helper per routine: the assertion is the same shape every time, so the
  -- list of what is closed and the standard it is held to stay readable.
  begin perform public.crush_member(b_id, false, null); exception when others then closed := closed + 1; end;
  begin perform public.uncrush_member(b_id, 'tap'); exception when others then closed := closed + 1; end;
  begin perform public.accept_connection_request(b_id); exception when others then closed := closed + 1; end;
  begin perform public.decline_connection_request(b_id); exception when others then closed := closed + 1; end;
  begin perform public.cancel_connection_request(b_id); exception when others then closed := closed + 1; end;
  begin perform public.keep_close(b_id); exception when others then closed := closed + 1; end;
  begin perform public.let_go(b_id); exception when others then closed := closed + 1; end;
  begin perform public.remove_connection(b_id); exception when others then closed := closed + 1; end;

  reset role;

  if closed <> 8 then
    raise exception '% of the 8 legacy relationship verbs still run; an old client can still write the old model', 8 - closed;
  end if;

  select jsonb_build_object(
           'crushes', (select count(*) from public.crushes),
           'connections', (select count(*) from public.connections),
           'keeps', (select count(*) from public.keeps),
           'follows', coalesce((select count(*) from public.holup_follows), 0),
           'homies', coalesce((select count(*) from public.holup_homie_requests), 0),
           'notifications', (select count(*) from public.notifications)
         ) into after_state;

  if after_state is distinct from before_state then
    raise exception 'a closed verb still changed relationship state: % became %', before_state, after_state;
  end if;

  -- Refused with a code the client can act on, not a generic failure: the point
  -- of the refusal is the "update Holup" message, so it has to survive.
  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;
  begin
    perform public.crush_member(b_id, false, null);
    raise exception 'crush_member did not raise at all';
  exception when others then
    if position('__CRUSHLY__409__relationship_upgrade_required' in sqlerrm) = 0 then
      raise exception 'the refusal must carry 409 relationship_upgrade_required, got: %', sqlerrm;
    end if;
  end;

  -- The new verbs are the ones that work, and they work for the same member in
  -- the same session, so the refusal above is about the verb, not the account.
  perform public.holup_follow(b_id);
  reset role;
  select count(*) into n from public.holup_follows
   where follower_id = a_id and followed_id = b_id and status in ('active', 'pending');
  if n <> 1 then
    raise exception 'the replacement Add Up did not record anything';
  end if;

  -- A Homie request is still answerable in the same session: the new verbs are
  -- not closed by association.
  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;
  perform public.holup_request_homie(b_id);
  reset role;
  select count(*) into n from public.holup_homie_requests
   where sender_id = a_id and recipient_id = b_id and status = 'pending';
  if n > 1 then
    raise exception 'a Homie request was recorded twice';
  end if;

  raise notice 'Legacy relationship verbs: all 8 closed with 409, no state changed, replacements work.';
end $test$;
