-- Comments: like a comment, answer a comment, and delete without eating replies.
--
-- These assertions run against the same throwaway Postgres as the rest of the
-- suite. They exist because the interesting parts of a thread are the parts
-- that are easy to get wrong: a reply that answers a reply, a reply to a
-- comment on a different post, a delete that takes somebody else's words with
-- it, and a like count that only counts the people allowed to see it.
do $$
declare
  daniel   uuid;
  marcus   uuid;
  jayden   uuid;
  daniel_id bigint;
  marcus_id bigint;
  thread_post   bigint;
  comment_id bigint;
  reply_id  bigint;
  j         jsonb;
  items     jsonb;
  n         integer;
begin
  select id into daniel from auth.users where email = 'daniel@crushly.app';
  select id into marcus from auth.users where email = 'marcus@crushly.app';
  select id into jayden from auth.users where email = 'jayden@crushly.app';
  select id into daniel_id from profiles where name = 'Daniel';
  select id into marcus_id from profiles where name = 'Marcus';

  set role authenticated;
  perform set_config('request.jwt.claim.sub', daniel::text, false);

  j := public.create_post('comment thread probe', null, 'everyone', null, null);
  thread_post := (j ->> 'id')::bigint;

  /* ------------------------------------------------------- a comment, a reply */
  j := public.comment_on_post(thread_post, 'first', null);
  comment_id := (j ->> 'id')::bigint;

  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.comment_on_post(thread_post, 'answer', comment_id);
  reply_id := (j ->> 'id')::bigint;

  -- A reply may not answer a reply.
  begin
    perform public.comment_on_post(thread_post, 'answer to the answer', reply_id);
    raise exception 'a reply answered a reply';
  exception when others then
    if sqlerrm not like '%one level deep%' then raise; end if;
  end;

  -- A reply must live on the comment it answers.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  j := public.create_post('a different post', null, 'everyone', null, null);
  begin
    perform public.comment_on_post((j ->> 'id')::bigint, 'wrong post', comment_id);
    raise exception 'a reply was allowed onto another post';
  exception when others then
    -- The reply is refused because that comment is not on this post.
    if sqlerrm not like '%That comment%there%' then raise; end if;
  end;

  /* ------------------------------------------------------------------- likes */
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.react_to_post_comment(comment_id, true);
  assert (j ->> 'liked')::boolean and (j ->> 'likeCount')::int = 1,
    'liking a comment reports the truth';

  -- Liking twice is not two likes.
  j := public.react_to_post_comment(comment_id, true);
  assert (j ->> 'likeCount')::int = 1, 'a like is not counted twice';

  /* ------------------------------------------------- reading the whole thread */
  j := public.post_comments_feed(thread_post, 200);
  items := j -> 'items';
  assert jsonb_array_length(items) = 2, 'the feed carries the comment and its reply';

  select count(*) into n from jsonb_array_elements(items) e
   where (e ->> 'id')::bigint = comment_id
     and (e ->> 'likeCount')::int = 1
     and (e ->> 'liked')::boolean
     and (e ->> 'replyCount')::int = 1
     and e -> 'parentId' = 'null'::jsonb;
  assert n = 1, 'the comment knows its likes and how many answered it';

  select count(*) into n from jsonb_array_elements(items) e
   where (e ->> 'id')::bigint = reply_id
     and (e ->> 'parentId')::bigint = comment_id;
  assert n = 1, 'the reply knows what it answers';

  /* ------------------- deleting a comment with replies empties, never eats them */
  -- Daniel wrote the comment and owns the post; Marcus could not remove it.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  perform public.delete_post_comment(comment_id);

  j := public.post_comments_feed(thread_post, 200);
  items := j -> 'items';
  assert jsonb_array_length(items) = 2, 'the reply survives its parent being deleted';

  select count(*) into n from jsonb_array_elements(items) e
   where (e ->> 'id')::bigint = comment_id
     and (e ->> 'hidden')::boolean
     and e -> 'body' = 'null'::jsonb;
  assert n = 1, 'a deleted comment with replies is emptied, not removed';

  select count(*) into n from jsonb_array_elements(items) e
   where (e ->> 'id')::bigint = reply_id
     and e ->> 'body' = 'answer';
  assert n = 1, 'the reply still says what it said';

  -- And nobody may like a comment that has been deleted.
  begin
    perform public.react_to_post_comment(comment_id, true);
    raise exception 'a deleted comment could be liked';
  exception when others then
    if sqlerrm not like '%was deleted%' then raise; end if;
  end;

  /* ---------------------------------- a reply with no children is simply gone */
  perform public.delete_post_comment(reply_id);
  j := public.post_comments_feed(thread_post, 200);
  assert jsonb_array_length(j -> 'items') = 1, 'a childless comment is removed outright';

  /* ----------------------------------------------- the count matches the thread */
  -- Daniel owns the post, so he may remove anything on it; he removes his own.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  perform public.delete_post_comment(comment_id);
  j := public.post_comments_feed(thread_post, 200);
  assert jsonb_array_length(j -> 'items') = 0, 'the thread is empty again';
  assert (public.post_engagement(thread_post, daniel_id) ->> 'commentCount')::int = 0,
    'the count on the post follows the thread';

  /* -------------------------------------------- people you cut off are unseen */
  -- Marcus leaves a comment, and only then is he cut off. What he already
  -- wrote stops being shown to Daniel; what he writes next cannot reach the
  -- post at all, because he may no longer see it.
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  perform public.comment_on_post(thread_post, 'from the other side', null);

  perform set_config('request.jwt.claim.sub', daniel::text, false);
  insert into public.blocks (blocker_id, blocked_id) values (daniel_id, marcus_id);

  j := public.post_comments_feed(thread_post, 200);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where e ->> 'body' = 'from the other side';
  assert n = 0, 'a comment from somebody you cut off is not shown';

  perform set_config('request.jwt.claim.sub', marcus::text, false);
  begin
    perform public.comment_on_post(thread_post, 'and one more', null);
    raise exception 'a blocked member could still comment';
  exception when others then
    if sqlerrm not like '%isn%available%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', daniel::text, false);
  delete from public.blocks where blocker_id = daniel_id and blocked_id = marcus_id;

  -- Leave the database as we found it.
  delete from public.post_comments c where c.post_id = thread_post;
  delete from public.posts po where po.id = thread_post;
  reset role;
  raise notice 'comment thread tests passed';
end $$;
