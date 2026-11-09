-- Isolated database only.
begin;
do $review$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); aid bigint; bid bigint; video bigint; photo bigint; r jsonb;
begin
 insert into auth.users(id,email) values(a,'review-progress-a@example.invalid'),(b,'review-progress-b@example.invalid');
 select id into aid from public.profiles where auth_user_id=a; select id into bid from public.profiles where auth_user_id=b;
 insert into public.posts(author_id,body,media_url) values(aid,'clip','https://example.invalid/v.MP4?token=x') returning id into video;
 insert into public.posts(author_id,body,media_url) values(aid,'picture','https://example.invalid/p.jpg') returning id into photo;
 insert into public.post_reactions(post_id,user_id,kind) values(video,aid,'crush'),(video,bid,'fire'),(photo,bid,'fire');
 perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
 r:=public.manual_verification_progress('creator'); assert (r->>'crushes')::int=3,'all visible reactions not counted';
 r:=public.manual_verification_progress('person_id'); assert (r->>'crushes')::int=2,'video reactions incorrectly counted';
 assert (r->>'mediaPosts')::int=2,'media posts incorrectly counted';
 reset role;
 raise notice 'Isolated video and reaction progress review passed';
end $review$;
rollback;
