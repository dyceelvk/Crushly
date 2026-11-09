-- Production retention foundation only. Does not enable verification or uploads.
-- The matching cleanup worker and scheduler are required for physical deletion.
create table public.manual_verification_cases (
 id bigint generated always as identity primary key,
 member_id bigint not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('creator','person_id')),
 status text not null default 'open' check(status in ('open','approved','rejected','withdrawn')),
 criteria_snapshot jsonb not null,
 created_at bigint not null default public.now_ms(),
 decided_at bigint,
 reviewer uuid references auth.users(id),
 decision_reason text
);
create unique index manual_verification_one_category on public.manual_verification_cases(member_id) where status in ('open','approved');
alter table public.manual_verification_cases enable row level security;
revoke all on public.manual_verification_cases from public,anon,authenticated;
revoke all on sequence public.manual_verification_cases_id_seq from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('holup-review-evidence','holup-review-evidence',false,5242880,array['image/jpeg','image/png','image/webp']);
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
create table public.manual_verification_file_deletions (
 storage_path text primary key, queued_at timestamptz not null default now(), revision uuid not null default gen_random_uuid()
);
alter table public.manual_verification_file_deletions enable row level security;
revoke all on public.manual_verification_file_deletions from public,anon,authenticated;
create function public.manual_evidence_queue_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or (new.state='deleted' and old.state<>'deleted') then
  insert into public.manual_verification_file_deletions(storage_path) values(old.storage_path)
  on conflict(storage_path) do update set queued_at=now(),revision=gen_random_uuid();
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger manual_evidence_deleted after delete or update of state on public.manual_verification_files for each row execute function public.manual_evidence_queue_delete();
create function public.manual_evidence_expire(p_limit integer default 100) returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 with candidates as (
  select f.id from public.manual_verification_files f join public.manual_verification_cases c on c.id=f.case_id
  where f.state<>'deleted' and ((c.status<>'open' and (c.decided_at is null or c.decided_at<=public.now_ms()-2592000000))
   or (f.state='reserved' and f.created_at<=public.now_ms()-86400000))
  order by f.created_at,f.id limit least(greatest(coalesce(p_limit,100),1),100) for update of f skip locked
 ) update public.manual_verification_files f set state='deleted' from candidates q where f.id=q.id;
 get diagnostics changed=row_count; return changed;
end $$;
create function public.manual_evidence_cleanup_enqueue(p_path text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_path is null or p_path !~ '^cases/[0-9]+/[0-9a-f-]{36}[.]jpg$' then raise exception 'Invalid evidence path' using errcode='22023'; end if;
 insert into public.manual_verification_file_deletions(storage_path) values(p_path)
 on conflict(storage_path) do update set queued_at=now(),revision=gen_random_uuid();
end $$;
create function public.manual_evidence_cleanup_batch(p_limit integer default 100) returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('path',q.storage_path,'revision',q.revision)),'[]'::jsonb) from
 (select storage_path,revision from public.manual_verification_file_deletions order by queued_at,storage_path limit least(greatest(coalesce(p_limit,100),1),100)) q
$$;
create function public.manual_evidence_cleanup_done(p_path text,p_revision uuid) returns void language sql security definer set search_path='' as $$
 delete from public.manual_verification_file_deletions where storage_path=p_path and revision=p_revision
$$;
create table public.manual_evidence_cleanup_health_state (
 singleton boolean primary key default true check(singleton), last_attempt_at bigint, last_success_at bigint,
 last_failed integer not null default 0 check(last_failed>=0)
);
insert into public.manual_evidence_cleanup_health_state(singleton) values(true);
alter table public.manual_evidence_cleanup_health_state enable row level security;
revoke all on public.manual_evidence_cleanup_health_state from public,anon,authenticated;
create function public.manual_evidence_cleanup_heartbeat(p_failed integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_failed is null or p_failed<0 then raise exception 'Invalid count' using errcode='22023'; end if;
 update public.manual_evidence_cleanup_health_state set last_attempt_at=public.now_ms(),
 last_success_at=case when p_failed=0 then public.now_ms() else last_success_at end,last_failed=p_failed where singleton;
end $$;
revoke all on function public.manual_evidence_queue_delete(),public.manual_evidence_expire(integer),public.manual_evidence_cleanup_enqueue(text),public.manual_evidence_cleanup_batch(integer),public.manual_evidence_cleanup_done(text,uuid),public.manual_evidence_cleanup_heartbeat(integer) from public,anon,authenticated;
grant execute on function public.manual_evidence_expire(integer),public.manual_evidence_cleanup_enqueue(text),public.manual_evidence_cleanup_batch(integer),public.manual_evidence_cleanup_done(text,uuid),public.manual_evidence_cleanup_heartbeat(integer) to service_role;
