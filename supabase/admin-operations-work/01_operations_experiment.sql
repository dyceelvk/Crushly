-- EXPERIMENT ONLY. Not a production migration. Apply after admin controls on a
-- disposable/staged project; the member client must not receive service keys.
begin;
create or replace function public.holup_admin_reports(p_handled boolean default false,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_reports',jsonb_build_object('handled',coalesce(p_handled,false)));
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'reporterId',q.reporter_id,'reporterName',q.reporter_name,
  'reportedId',q.reported_id,'reportedName',q.reported_name,'reason',q.reason,'details',q.details,
  'context',q.context,'handled',q.handled,'createdAt',q.created_at) order by q.created_at desc,q.id desc),'[]'::jsonb) into result
 from (select r.*,rp.name reporter_name,tp.name reported_name from public.reports r
  left join public.profiles rp on rp.id=r.reporter_id left join public.profiles tp on tp.id=r.reported_id
  where r.handled=coalesce(p_handled,false) order by r.created_at desc,r.id desc
  limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0)) q;
 return result;
end $$;

create or replace function public.holup_admin_set_report_handled(p_report_id bigint,p_handled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare previous boolean;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 if p_handled is null then perform public.crushly_fail(400,'','Choose a status.'); end if;
 select handled into previous from public.reports where id=p_report_id for update;
 if not found then perform public.crushly_fail(404,'','Report unavailable.'); end if;
 if previous is distinct from p_handled then
  update public.reports set handled=p_handled where id=p_report_id;
  insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'report_status',jsonb_build_object('reportId',p_report_id,'before',previous,'after',p_handled));
 end if;
 return true;
end $$;

create or replace function public.holup_admin_accounts(p_query text,p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path=public as $$
declare term text:=lower(btrim(coalesce(p_query,''))); result jsonb;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 if length(term)<2 or length(term)>100 then perform public.crushly_fail(400,'','Search using 2 to 100 characters.'); end if;
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'search_accounts','{}'::jsonb);
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'username',q.username,'status',q.status,
  'onboarded',q.onboarded,'verification',q.verification) order by q.id desc),'[]'::jsonb) into result
 from (select p.id,p.name,p.username,p.status,p.onboarded,p.verification from public.profiles p
  where strpos(lower(p.name),term)>0 or strpos(lower(coalesce(p.username,'')),term)>0 or p.id::text=term
  order by p.id desc limit least(greatest(coalesce(p_limit,30),1),100)) q;
 return result;
end $$;

-- List review status only. Verification decisions continue to use Didit; this
-- queue does not pretend to provide evidence or an override without a secure
-- evidence/reviewer workflow.
create or replace function public.holup_admin_verifications(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'view_verifications','{}'::jsonb);
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'memberId',q.user_id,'memberName',q.member_name,
  'status',q.status,'createdAt',q.created_at,'reviewedAt',q.reviewed_at) order by q.created_at desc,q.id desc),'[]'::jsonb) into result
 from (select v.id,v.user_id,v.status,v.created_at,v.reviewed_at,p.name member_name from public.verification_requests v
  join public.profiles p on p.id=v.user_id order by v.created_at desc,v.id desc limit least(greatest(coalesce(p_limit,50),1),100)) q;
 return result;
end $$;

create or replace function public.holup_admin_audit(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'actor',q.actor,'kind',q.kind,'details',q.details,'createdAt',q.created_at) order by q.id desc),'[]'::jsonb) into result
 from (select id,actor,kind,details,created_at from public.holup_admin_events order by id desc limit least(greatest(coalesce(p_limit,50),1),100)) q;
 return result;
end $$;
revoke all on function public.holup_admin_reports(boolean,integer,integer),public.holup_admin_set_report_handled(bigint,boolean),public.holup_admin_accounts(text,integer),public.holup_admin_verifications(integer),public.holup_admin_audit(integer) from public,anon,authenticated;
grant execute on function public.holup_admin_reports(boolean,integer,integer),public.holup_admin_set_report_handled(bigint,boolean),public.holup_admin_accounts(text,integer),public.holup_admin_verifications(integer),public.holup_admin_audit(integer) to authenticated,service_role;
commit;
