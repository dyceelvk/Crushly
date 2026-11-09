# Rolled-back pg_net scheduler experiment

These were applied in production and then immediately reversed. No cron job
ran while the credential existed; the job history was empty and the queue was
empty. The secret and scheduler function were removed. `pg_net` and `pg_cron`
were removed after confirming zero jobs and zero pending requests.

The installation's `net.http_request_queue` granted PUBLIC read access from
the extension owner (`supabase_admin`). REVOKE as the migration role did not
remove that grant. Therefore pg_net would have exposed a cleanup credential in
its outbound queue. The migration files with these versions are deliberately
replay-safe markers, **not the historical SQL**; replaying the original first
migration would transiently recreate the vulnerability. The originally applied
statements are preserved below for audit. No secret value is present.

## 20261109152125 schedule_verification_image_cleanup (original, unsafe)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
revoke all on table net.http_request_queue from public, anon, authenticated, authenticator;
revoke all on table net._http_response from public, anon, authenticated, authenticator;
do $$
declare secret_value text;
begin
 if exists(select 1 from vault.decrypted_secrets where name='holup_evidence_scheduler_v1') then
  raise exception 'Scheduler secret name already exists; manual review required';
 end if;
 secret_value := encode(extensions.gen_random_bytes(32),'hex');
 perform vault.create_secret(secret_value,'holup_evidence_scheduler_v1','Dedicated credential for evidence cleanup scheduler');
end $$;
create or replace function public.manual_evidence_cleanup_authenticate(p_digest text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.manual_evidence_cleanup_auth_state where singleton and secret_digest=p_digest)
 or exists(select 1 from vault.decrypted_secrets where name='holup_evidence_scheduler_v1'
  and encode(extensions.digest(decrypted_secret,'sha256'),'hex')=p_digest)
$$;
create function public.manual_evidence_scheduled_invoke() returns bigint
language plpgsql security definer set search_path='' as $$
declare credential text; request_id bigint;
begin
 select decrypted_secret into strict credential from vault.decrypted_secrets where name='holup_evidence_scheduler_v1';
 select net.http_post(url:='https://yzcssyebozfkmojqqdhc.supabase.co/functions/v1/manual-evidence-cleanup',
  headers:=jsonb_build_object('content-type','application/json','x-cleanup-secret',credential),
  body:='{}'::jsonb,timeout_milliseconds:=110000) into request_id;
 return request_id;
end $$;
revoke all on function public.manual_evidence_scheduled_invoke() from public,anon,authenticated,service_role;
select cron.schedule('holup-evidence-cleanup-v1','*/15 * * * *','select public.manual_evidence_scheduled_invoke()');
```

## 20261109152214 disable_unsafe_evidence_scheduler (original)

```sql
select cron.unschedule(jobid) from cron.job where jobname='holup-evidence-cleanup-v1';
create or replace function public.manual_evidence_cleanup_authenticate(p_digest text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.manual_evidence_cleanup_auth_state where singleton and secret_digest=p_digest)
$$;
drop function if exists public.manual_evidence_scheduled_invoke();
delete from vault.secrets where name='holup_evidence_scheduler_v1';
```

## 20261109152300 remove_unused_evidence_scheduler_extensions (original)

```sql
do $$ begin
 if exists(select 1 from cron.job) or exists(select 1 from net.http_request_queue) then
  raise exception 'Scheduler extensions are in use';
 end if;
end $$;
drop extension pg_net;
drop extension pg_cron;
```
