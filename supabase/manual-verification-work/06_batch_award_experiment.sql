-- EXPERIMENT ONLY. Requires 01 and 02. No production changes made.
-- Badge decisions remain admin-only; a provider approval is NOT itself a badge.
begin;
create or replace function public.manual_verification_ready_counts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare creator_count bigint; person_count bigint;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select count(*) filter(where c.kind='creator'),count(*) filter(where c.kind='person_id') into creator_count,person_count
 from public.manual_verification_cases c
 join public.manual_verification_capture_evidence e on e.case_id=c.id and e.approved
 join public.manual_verification_captures d on d.case_id=c.id and d.state='approved' and d.provider_session_id=e.provider_session_id
 join public.profiles p on p.id=c.member_id and p.badge_tier not in ('gold','diamond')
 where c.status='open';
 return jsonb_build_object('creator',creator_count,'personId',person_count,'total',creator_count+person_count);
end $$;

-- One confirmed admin action decides every case ready at execution. The query
-- rechecks the provider result and category under locks; counts are advisory,
-- not the source of truth. Cases arriving after the query snapshot wait for the
-- next action. Two concurrent batch actions serialize. No unready case changes.
create or replace function public.manual_verification_award_ready() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; chosen text; creator_count int:=0; person_count int:=0; reason text:='Verified after completed Didit identity checks and Holup review.';
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 perform pg_advisory_xact_lock(hashtextextended('holup-verification-batch',0));
 for c in select v.* from public.manual_verification_cases v
  join public.manual_verification_capture_evidence e on e.case_id=v.id and e.approved
  join public.manual_verification_captures d on d.case_id=v.id and d.state='approved' and d.provider_session_id=e.provider_session_id
  join public.profiles p on p.id=v.member_id and p.badge_tier not in ('gold','diamond')
  where v.status='open' order by v.id for update of v loop
  -- Case locks serialize this decision against provider-result and individual
  -- reviewer actions. The provider result is checked again after the lock.
  if not exists(select 1 from public.manual_verification_capture_evidence e
    join public.manual_verification_captures d on d.case_id=e.case_id and d.state='approved' and d.provider_session_id=e.provider_session_id
    where e.case_id=c.id and e.approved) then continue; end if;
  perform 1 from public.profiles p where p.id=c.member_id and p.badge_tier not in ('gold','diamond') for update;
  if not found then continue; end if;
  chosen:=case when c.kind='creator' then 'gold' else 'diamond' end;
  update public.profiles set verification='verified',badge_tier=chosen where id=c.member_id;
  update public.manual_verification_cases set status='approved',reviewer=auth.uid(),decided_at=public.now_ms(),decision_reason=reason where id=c.id and status='open';
  insert into public.manual_verification_messages(case_id,sender_auth,sender_role,body) values(c.id,auth.uid(),'admin','Application approved. '||reason);
  insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_decision',jsonb_build_object('caseId',c.id,'memberId',c.member_id,'decision','approve','badge',chosen,'method','batch'));
  if c.kind='creator' then creator_count:=creator_count+1; else person_count:=person_count+1; end if;
 end loop;
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_batch',jsonb_build_object('creator',creator_count,'personId',person_count));
 return jsonb_build_object('creator',creator_count,'personId',person_count,'total',creator_count+person_count);
end $$;
revoke all on function public.manual_verification_ready_counts(),public.manual_verification_award_ready() from public,anon,authenticated;
grant execute on function public.manual_verification_ready_counts(),public.manual_verification_award_ready() to authenticated;
commit;
