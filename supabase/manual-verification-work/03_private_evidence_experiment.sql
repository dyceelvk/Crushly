-- EXPERIMENT ONLY: private applicant evidence. Never use a public media bucket.
-- The required deployed edge service streams each authorized read; direct
-- member/admin object access is deliberately absent. Requires 01.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('holup-review-evidence','holup-review-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- Abort rather than silently using a preexisting public/misconfigured bucket.
do $$ begin
 if not exists(select 1 from storage.buckets where id='holup-review-evidence' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then
  raise exception 'Review evidence bucket is not configured safely'; end if;
end $$;
create table public.manual_verification_files (
 id uuid primary key default gen_random_uuid(),
 case_id bigint not null references public.manual_verification_cases(id) on delete cascade,
 storage_path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 state text not null default 'reserved' check(state in ('reserved','ready','deleted')),
 created_at bigint not null default public.now_ms()
);
create index manual_verification_files_case on public.manual_verification_files(case_id,created_at);
alter table public.manual_verification_files enable row level security;
revoke all on public.manual_verification_files from public,anon,authenticated;

create or replace function public.manual_evidence_reserve(p_case bigint,p_actor uuid,p_mime text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; fid uuid:=gen_random_uuid(); suffix text; path text;
begin
 if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Unsupported image type' using errcode='22023'; end if;
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 if (select count(*) from public.manual_verification_files where case_id=p_case and created_at>public.now_ms()-3600000)>=12 then raise exception 'Please try again later' using errcode='54000'; end if;
 if (select count(*) from public.manual_verification_files where case_id=p_case and state in ('reserved','ready'))>=6 then raise exception 'Maximum of six images per application' using errcode='54000'; end if;
 suffix:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 path:='cases/'||p_case::text||'/'||fid::text||'.'||suffix;
 insert into public.manual_verification_files(id,case_id,storage_path,mime_type) values(fid,p_case,path,p_mime);
 return jsonb_build_object('id',fid,'path',path);
end $$;
create or replace function public.manual_evidence_finish(p_file uuid,p_actor uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases;
begin
 select * into f from public.manual_verification_files where id=p_file for update;
 if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id for update;
 if c.status<>'open' or not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 update public.manual_verification_files set state=case when p_success then 'ready' else 'deleted' end where id=p_file and state='reserved';
 if not found then raise exception 'Image already processed' using errcode='55000'; end if;
 return true;
end $$;
create or replace function public.manual_evidence_list(p_case bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; result jsonb;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or public.me_id() is null or (c.member_id<>public.me_id() and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 if public.holup_is_admin() and c.member_id<>public.me_id() then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_verification_file_list',jsonb_build_object('caseId',p_case)); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by created_at,id),'[]'::jsonb) into result from public.manual_verification_files where case_id=p_case and state='ready';
 return result;
end $$;
create or replace function public.manual_evidence_authorize(p_file uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases; reviewer boolean;
begin
 select * into f from public.manual_verification_files where id=p_file and state='ready';
 if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id;
 reviewer:=exists(select 1 from public.holup_admins where auth_user_id=p_actor);
 if not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) and not reviewer then raise exception 'Image unavailable' using errcode='42501'; end if;
 if reviewer then insert into public.holup_admin_events(actor,kind,details) values(p_actor,'open_verification_file',jsonb_build_object('caseId',c.id,'fileId',f.id)); end if;
 return jsonb_build_object('path',f.storage_path,'mime',f.mime_type);
end $$;
revoke all on function public.manual_evidence_list(bigint) from public,anon,authenticated;
grant execute on function public.manual_evidence_list(bigint) to authenticated;
revoke all on function public.manual_evidence_reserve(bigint,uuid,text),public.manual_evidence_finish(uuid,uuid,boolean),public.manual_evidence_authorize(uuid,uuid) from public,anon,authenticated;
grant execute on function public.manual_evidence_reserve(bigint,uuid,text),public.manual_evidence_finish(uuid,uuid,boolean),public.manual_evidence_authorize(uuid,uuid) to service_role;
commit;
