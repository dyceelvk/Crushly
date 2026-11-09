-- EXPERIMENT ONLY: teen project foundation 01 must be installed first.
-- A report is a private record for a trusted moderation service, not a chat
-- with a staff member or a promise that a moderation team exists.
begin;
do $$
begin
 if current_setting('holup.instance_type',true) is distinct from 'teen-isolated'
  or to_regclass('public.profiles') is not null or to_regclass('holup_teen.accounts') is null then
  raise exception 'Refusing to install outside the isolated teen project'; end if;
end $$;
create table if not exists holup_teen.reports (
 id bigint generated always as identity primary key,
 reporter uuid not null references holup_teen.accounts(user_id) on delete cascade,
 reported uuid not null references holup_teen.accounts(user_id) on delete cascade,
 reason text not null check(reason in ('harassment','sexual_content','impersonation','adult_impostor','threat','other')),
 details text not null default '' check(char_length(details)<=500),
 status text not null default 'open' check(status in ('open','reviewing','resolved')),
 created_at timestamptz not null default now(),
 check(reporter<>reported)
);
create index if not exists teen_reports_queue_idx on holup_teen.reports(status,created_at,id);
create index if not exists teen_reports_rate_idx on holup_teen.reports(reporter,created_at);
alter table holup_teen.reports enable row level security;
revoke all on holup_teen.reports from public,anon,authenticated;
revoke all on all sequences in schema holup_teen from public,anon,authenticated;

create or replace function public.teen_report_member(p_target uuid,p_reason text,p_details text default '',p_also_block boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); report_id bigint; description text:=btrim(coalesce(p_details,''));
begin
 if me is null or p_target is null or me=p_target then raise exception 'Invalid member' using errcode='22023'; end if;
 if p_reason is null or p_reason not in ('harassment','sexual_content','impersonation','adult_impostor','threat','other')
   or char_length(description)>500 or p_also_block is null then raise exception 'Choose a reason and keep details under 500 characters' using errcode='22023'; end if;
 perform holup_teen.pair_lock(me,p_target);
 perform pg_advisory_xact_lock(hashtextextended('teen-report:'||me::text,0));
 perform 1 from holup_teen.accounts where user_id=me for share;
 if not holup_teen.eligible(me) or not exists(select 1 from holup_teen.accounts where user_id=p_target) then
  raise exception 'Member unavailable' using errcode='42501'; end if;
 if (select count(*) from holup_teen.reports where reporter=me and created_at>now()-interval '1 hour')>=5 then
  raise exception 'Please try again later' using errcode='54000'; end if;
 insert into holup_teen.reports(reporter,reported,reason,details) values(me,p_target,p_reason,description) returning id into report_id;
 if p_also_block then
  insert into holup_teen.blocks(blocker,blocked) values(me,p_target) on conflict do nothing;
  delete from holup_teen.keeps where (keeper=me and kept=p_target) or (keeper=p_target and kept=me);
 end if;
 return jsonb_build_object('received',true,'reportId',report_id,'blocked',p_also_block);
end $$;
revoke all on function public.teen_report_member(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.teen_report_member(uuid,text,text,boolean) to authenticated;
commit;
