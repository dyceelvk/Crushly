-- DESTRUCTIVE synthetic fixture for disposable DB only.
do $$
declare expected text; actual text;
begin
 assert not exists(select 1 from public.conversations), 'conversations not cleared';
 assert not exists(select 1 from public.messages), 'messages not cascaded';
 assert not exists(select 1 from public.hidden_whispers), 'hidden message links not cascaded';
 assert not exists(select 1 from public.message_reactions), 'message reactions not cascaded';
 assert not exists(select 1 from public.call_rooms), 'call rooms not cascaded';
 assert not exists(select 1 from public.notifications where body in ('reset-target-message','reset-target-moment-reply')), 'whisper notifications not cleared';
 assert not exists(select 1 from public.privacy where holup_whisper_open), 'existing settings must not be interpreted as automatic acceptance';
 select digest into expected from reset_scope_snapshot where key='profiles'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) into actual from public.profiles t; assert expected=actual,'profiles changed';
 select digest into expected from reset_scope_snapshot where key='privacy'; select md5(coalesce(string_agg((to_jsonb(t)-'holup_whisper_open')::text,',' order by user_id),'')) into actual from public.privacy t; assert expected=actual,'previous privacy changed';
 select digest into expected from reset_scope_snapshot where key='posts'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) into actual from public.posts t; assert expected=actual,'posts changed';
 select digest into expected from reset_scope_snapshot where key='moments'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) into actual from public.moments t; assert expected=actual,'moments changed';
 select digest into expected from reset_scope_snapshot where key='connections'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by user_a,user_b),'')) into actual from public.connections t; assert expected=actual,'connections changed';
 select digest into expected from reset_scope_snapshot where key='follows'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by follower_id,followed_id),'')) into actual from public.holup_follows t; assert expected=actual,'follows changed';
 select digest into expected from reset_scope_snapshot where key='homies'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by user_a,user_b),'')) into actual from public.holup_homies t; assert expected=actual,'homies changed';
 select digest into expected from reset_scope_snapshot where key='notifications'; select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) into actual from public.notifications t; assert expected=actual,'unrelated notifications changed';
 raise notice 'reset scope preserves unrelated synthetic data';
end $$;
