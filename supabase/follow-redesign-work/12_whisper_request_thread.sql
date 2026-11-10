-- Disposable database only. Proves the Whisper request behaves the way the chat
-- presents it: asking opens the thread, the sender writes two messages, the
-- recipient answers inside that thread, and nothing else opens a line.
-- Run after fixture + 10_cutover_candidate.sql.
begin;
do $test$
declare
  au uuid; bu uuid; a bigint; b bigint;
  r jsonb; w jsonb; cv bigint; denied boolean; m jsonb;
begin
  select id into au from auth.users where email='marcus@crushly.app';
  select id into bu from auth.users where email='daniel@crushly.app';
  select id into a from profiles where auth_user_id=au;
  select id into b from profiles where auth_user_id=bu;
  assert a is not null and b is not null;

  -- Fresh pair: no thread, no permission, no block, no legacy keeps in the way.
  reset role;
  delete from blocks where blocker_id in (a,b) and blocked_id in (a,b);
  delete from messages where conversation_id in (select id from conversations where user_a=least(a,b) and user_b=greatest(a,b));
  delete from holup_whisper_permissions where conversation_id in (select id from conversations where user_a=least(a,b) and user_b=greatest(a,b));
  delete from conversations where user_a=least(a,b) and user_b=greatest(a,b);
  update privacy set holup_whisper_open=false where user_id in (a,b);

  /* Asking for a Whisper opens the thread, and says it is a request. */
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  r := public.open_conversation(b);
  cv := (r->>'id')::bigint;
  w := r->'whisper';
  assert w->>'state'='pending', 'a new Whisper is a request, not an open line';
  assert (w->>'requester')::boolean, 'the asker is the requester';
  assert (w->>'remaining')::int=2, 'two messages are allowed before an answer';
  assert (w->>'canSend')::boolean, 'the asker may write';
  assert not (w->>'needsDecision')::boolean, 'the asker has nothing to answer';
  assert public.load_conversation(cv)->'whisper'->>'state'='pending';

  /* Two messages, then the door closes until the other person answers. */
  perform public.send_message(cv,'text','first thing','', '{}'::jsonb);
  w := public.load_conversation(cv)->'whisper';
  assert (w->>'sent')::int=1 and (w->>'remaining')::int=1 and (w->>'canSend')::boolean;
  perform public.send_message(cv,'text','and a second','', '{}'::jsonb);
  w := public.load_conversation(cv)->'whisper';
  assert (w->>'sent')::int=2 and (w->>'remaining')::int=0 and not (w->>'canSend')::boolean,
    'after two messages the asker waits for an answer';
  denied := false;
  begin perform public.send_message(cv,'text','a third','', '{}'::jsonb); exception when others then denied := true; end;
  assert denied, 'a third message before acceptance is refused';

  /* The recipient opens the same thread and is asked to answer, in the chat. */
  perform set_config('request.jwt.claim.sub',bu::text,true);
  w := public.load_conversation(cv)->'whisper';
  assert w->>'state'='pending';
  assert not (w->>'requester')::boolean, 'the recipient is not the requester';
  assert (w->>'needsDecision')::boolean, 'the recipient is asked to accept or decline';
  assert (w->>'sent')::int=2;
  assert (w->>'canSend')::boolean, 'the recipient may answer with a message instead of a button';
  -- And the two messages are readable by them, or there is nothing to answer.
  assert jsonb_array_length(public.get_messages(cv)->'items')=2;

  /* Accept: the thread opens, both may write, and the counter stops mattering. */
  assert public.holup_accept_whisper(cv);
  w := public.load_conversation(cv)->'whisper';
  assert w->>'state'='accepted' and (w->>'canSend')::boolean and not (w->>'needsDecision')::boolean;
  perform public.send_message(cv,'text','third message now that it is open','', '{}'::jsonb);
  perform set_config('request.jwt.claim.sub',au::text,true);
  assert public.load_conversation(cv)->'whisper'->>'state'='accepted';
  perform public.send_message(cv,'text','and a fourth','', '{}'::jsonb);

  /* A opened it, so a cannot accept their own request; only the recipient may. */
  reset role;
  delete from messages where conversation_id=cv;
  delete from holup_whisper_permissions where conversation_id=cv;
  delete from conversations where id=cv;
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  cv := (public.open_conversation(b)->>'id')::bigint;
  perform public.send_message(cv,'text','hello there','', '{}'::jsonb);
  denied := false;
  begin perform public.holup_accept_whisper(cv); exception when others then denied := true; end;
  assert denied, 'the asker cannot accept on the recipient''s behalf';

  /* Decline: the thread stays shut, and it stays shut for both of them. */
  perform set_config('request.jwt.claim.sub',bu::text,true);
  assert public.holup_decline_whisper(cv);
  w := public.load_conversation(cv)->'whisper';
  assert w->>'state'='declined' and not (w->>'canSend')::boolean;
  denied := false;
  begin perform public.send_message(cv,'text','after a decline','', '{}'::jsonb); exception when others then denied := true; end;
  assert denied, 'a declined request cannot be written to';
  perform set_config('request.jwt.claim.sub',au::text,true);
  denied := false;
  begin perform public.send_message(cv,'text','please','', '{}'::jsonb); exception when others then denied := true; end;
  assert denied, 'and the asker cannot write into it either';

  /* A block ends a pending request and closes the thread. */
  reset role;
  delete from messages where conversation_id=cv;
  delete from holup_whisper_permissions where conversation_id=cv;
  delete from conversations where id=cv;
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  cv := (public.open_conversation(b)->>'id')::bigint;
  perform public.send_message(cv,'text','one','', '{}'::jsonb);
  reset role;
  perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
  perform public.block_member(a);
  reset role;
  assert (select state from holup_whisper_permissions where conversation_id=cv)='blocked';
  assert (select closed from conversations where id=cv), 'blocking closes the thread';

  /* The list the app renders carries the same state, so a pending request is
     visible as a request before it is opened. */
  reset role;
  perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
  select item into m from jsonb_array_elements(public.list_conversations()->'items') item
   where (item->>'id')::bigint=cv;
  assert m is null, 'a blocked thread is not listed';
  raise notice 'isolated Whisper request-in-thread tests passed';
  reset role;
end $test$;
rollback;
