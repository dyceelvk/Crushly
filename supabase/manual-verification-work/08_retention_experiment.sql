-- EXPERIMENT ONLY. 30 days after a completed review. The scheduler and worker
-- must run and be monitored before this is a retention guarantee. Access is
-- denied at the deadline even if physical deletion is delayed.
begin;
create or replace function public.manual_evidence_list(p_case bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; result jsonb;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or public.me_id() is null or (c.member_id<>public.me_id() and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 if public.holup_is_admin() and c.member_id<>public.me_id() then insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_verification_file_list',jsonb_build_object('caseId',p_case)); end if;
 if c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000) then return '[]'::jsonb; end if;
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
 if not found or (c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000)) then raise exception 'Image unavailable' using errcode='42501'; end if;
 reviewer:=exists(select 1 from public.holup_admins where auth_user_id=p_actor);
 if not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) and not reviewer then raise exception 'Image unavailable' using errcode='42501'; end if;
 if reviewer then insert into public.holup_admin_events(actor,kind,details) values(p_actor,'open_verification_file',jsonb_build_object('caseId',c.id,'fileId',f.id)); end if;
 return jsonb_build_object('path',f.storage_path,'mime',f.mime_type);
end $$;
create or replace function public.manual_evidence_expire(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 with candidates as (
  select f.id from public.manual_verification_files f
  join public.manual_verification_cases c on c.id=f.case_id
  where f.state<>'deleted' and (
   (c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000))
   or (f.state='reserved' and f.created_at<=public.now_ms()-86400000)
  ) order by f.created_at,f.id limit least(greatest(coalesce(p_limit,100),1),100) for update of f skip locked
 ) update public.manual_verification_files f set state='deleted' from candidates q where f.id=q.id;
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function public.manual_evidence_expire(integer) from public,anon,authenticated;
grant execute on function public.manual_evidence_expire(integer) to service_role;
commit;
