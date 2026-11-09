-- EXPERIMENT ONLY. Durable cleanup even after account/case deletion; this does
-- not provision a scheduler. Buckets must remain private until cleanup works.
begin;
create table public.manual_verification_file_deletions (
 storage_path text primary key, queued_at timestamptz not null default now()
);
alter table public.manual_verification_file_deletions enable row level security;
revoke all on public.manual_verification_file_deletions from public,anon,authenticated;
create or replace function public.manual_evidence_queue_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or (new.state='deleted' and old.state<>'deleted') then
  insert into public.manual_verification_file_deletions(storage_path) values(old.storage_path) on conflict do nothing;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger manual_evidence_deleted after delete or update of state on public.manual_verification_files
 for each row execute function public.manual_evidence_queue_delete();
revoke all on function public.manual_evidence_queue_delete() from public,anon,authenticated;

create or replace function public.manual_evidence_hide(p_file uuid,p_actor uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files; c public.manual_verification_cases;
begin
 select * into f from public.manual_verification_files where id=p_file for update;
 if not found or f.state='deleted' then raise exception 'Image unavailable' using errcode='42501'; end if;
 select * into c from public.manual_verification_cases where id=f.case_id;
 if not exists(select 1 from public.profiles where id=c.member_id and auth_user_id=p_actor) then raise exception 'Image unavailable' using errcode='42501'; end if;
 update public.manual_verification_files set state='deleted' where id=p_file;
 return f.storage_path;
end $$;
-- Release a reservation after a failed/incomplete upload even if the case was
-- closed while the object was being transferred. Account ownership still wins.
create or replace function public.manual_evidence_abort(p_file uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare f public.manual_verification_files;
begin
 select * into f from public.manual_verification_files where id=p_file for update;
 if not found then return; end if;
 if not exists(select 1 from public.manual_verification_cases c join public.profiles p on p.id=c.member_id where c.id=f.case_id and p.auth_user_id=p_actor) then raise exception 'Image unavailable' using errcode='42501'; end if;
 update public.manual_verification_files set state='deleted' where id=p_file and state='reserved';
end $$;
create or replace function public.manual_evidence_cleanup_batch(p_limit int default 100) returns jsonb
language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(q.storage_path),'[]'::jsonb) from
 (select storage_path from public.manual_verification_file_deletions order by queued_at limit least(greatest(coalesce(p_limit,100),1),100)) q
$$;
create or replace function public.manual_evidence_cleanup_done(p_path text) returns void
language sql security definer set search_path='' as $$
 delete from public.manual_verification_file_deletions where storage_path=p_path
$$;
revoke all on function public.manual_evidence_hide(uuid,uuid),public.manual_evidence_abort(uuid,uuid),public.manual_evidence_cleanup_batch(integer),public.manual_evidence_cleanup_done(text) from public,anon,authenticated;
grant execute on function public.manual_evidence_hide(uuid,uuid),public.manual_evidence_abort(uuid,uuid),public.manual_evidence_cleanup_batch(integer),public.manual_evidence_cleanup_done(text) to service_role;
commit;
