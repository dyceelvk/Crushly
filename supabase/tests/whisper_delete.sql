-- Verify server-enforced deletion, including media, replies and direct reads.
do $$
declare
  a bigint := (select id from public.profiles where name='Daniel');
  b bigint := (select id from public.profiles where name='Ryan');
  x bigint := (select id from public.profiles where name='Jayden');
  au uuid := (select auth_user_id from public.profiles where id=a);
  bu uuid := (select auth_user_id from public.profiles where id=b);
  xu uuid := (select auth_user_id from public.profiles where id=x);
  cv bigint; mid bigint; media_id bigint; reply_id bigint; data jsonb; url text;
begin
  insert into public.connections(user_a,user_b) values(least(a,b),greatest(a,b)) on conflict do nothing;
  perform set_config('request.jwt.claim.sub',au::text,false);
  cv := (public.open_conversation(b)->>'id')::bigint;
  mid := (public.send_message(cv,'text','secret words',null,'{}')->>'id')::bigint;
  url := 'messages/'||a||'/deletion-test.jpg';
  media_id := (public.send_message(cv,'photo','',url,'{}')->>'id')::bigint;
  perform set_config('request.jwt.claim.sub',bu::text,false);
  reply_id := (public.send_message(cv,'text','reply',null,jsonb_build_object('replyTo',jsonb_build_object('id',mid)))->>'id')::bigint;
  assert public.delete_whisper(mid,false), 'recipient can hide for self';
  data:=public.get_messages(cv,0,0,100);
  assert not exists(select 1 from jsonb_array_elements(data->'items') j where (j->>'id')::bigint=mid), 'hidden excluded from history';
  assert not exists(select 1 from jsonb_array_elements(public.sync_whispers(cv,array[mid])) j), 'hidden excluded from sync';
  set local role authenticated;
  assert not exists(select 1 from public.messages where id=mid), 'hidden excluded from direct RLS reads';
  reset role;
  begin
    perform public.delete_whisper(media_id,true);
    raise exception 'recipient deleted sender message' using errcode='XX000';
  exception when sqlstate 'P0001' then assert sqlerrm like '__CRUSHLY__403__%', 'wrong error';
  end;
  assert public.delete_whisper(media_id,false), 'recipient may hide media';
  assert not (public.can_view_media(url,url)->>'allowed')::boolean, 'hidden media denied to hider';
  perform set_config('request.jwt.claim.sub',au::text,false);
  assert (public.can_view_media(url,url)->>'allowed')::boolean, 'other participant still sees media';
  assert exists(select 1 from jsonb_array_elements(public.get_messages(cv,0,0,100)->'items') j where (j->>'id')::bigint=mid), 'sender sees recipient-hidden message';
  perform set_config('request.jwt.claim.sub',xu::text,false);
  begin
    perform public.delete_whisper(mid,false);
    raise exception 'outsider deleted message' using errcode='XX000';
  exception when sqlstate 'P0001' then assert sqlerrm like '__CRUSHLY__404__%', 'wrong error';
  end;
  perform set_config('request.jwt.claim.sub',au::text,false);
  assert public.delete_whisper(mid,true), 'sender deletes for everyone';
  assert not exists(select 1 from public.messages where id=mid), 'row gone';
  assert (select meta#>>'{replyTo,preview}' from public.messages where id=reply_id)='Whisper deleted', 'reply snapshot scrubbed';
  assert public.delete_whisper(media_id,true), 'sender may delete media for everyone';
  assert not (public.can_view_media(url,url)->>'allowed')::boolean, 'deleted media no longer authorized';
  perform set_config('request.jwt.claim.sub',bu::text,false);
  assert not exists(select 1 from jsonb_array_elements(public.get_messages(cv,0,0,100)->'items') j where (j->>'id')::bigint in (mid,media_id)), 'deleted absent for recipient';
  assert not exists(select 1 from jsonb_array_elements(public.sync_whispers(cv,array[mid,media_id])) j), 'deleted absent from live sync';
end $$;
