-- EXPERIMENT ONLY. Requires 01; do not deploy. Case-bound Didit capture.
begin;
create table public.manual_verification_captures (
 case_id bigint primary key references public.manual_verification_cases(id) on delete cascade,
 state text not null check(state in ('requested','creating','created','approved','declined','review','expired')),
 lease uuid, lease_until timestamptz,
 provider_session_id text unique, provider_url text, workflow_id text,
 updated_at timestamptz not null default now()
);
alter table public.manual_verification_captures enable row level security;
revoke all on public.manual_verification_captures from public,anon,authenticated;

create or replace function public.manual_capture_request(p_case bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; state text;
begin
 if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or c.kind<>'person_id' then perform public.crushly_fail(404,'','Open person ID application unavailable.'); end if;
 select cap.state into state from public.manual_verification_captures cap where cap.case_id=p_case for update;
 if state in ('requested','creating','created','approved','review') then perform public.crushly_fail(409,'','Capture is already requested or in progress.'); end if;
 delete from public.manual_verification_capture_evidence where case_id=p_case;
 insert into public.manual_verification_captures(case_id,state) values(p_case,'requested')
 on conflict(case_id) do update set state='requested',lease=null,lease_until=null,provider_session_id=null,provider_url=null,workflow_id=null,updated_at=now();
 insert into public.manual_verification_messages(case_id,sender_auth,sender_role,body)
 values(p_case,auth.uid(),'admin','Please complete the secure Didit live ID and selfie capture using the button in this review. Never share a password or sign-in code.');
 insert into public.holup_admin_events(actor,kind,details) values(auth.uid(),'verification_capture_requested',jsonb_build_object('caseId',p_case));
 return true;
end $$;

-- This service-only function trusts p_actor only after an edge function has
-- verified its JWT using Auth. Never expose a service key to a client.
create or replace function public.manual_capture_claim(p_case bigint,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; cap public.manual_verification_captures; tok uuid;
begin
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or c.kind<>'person_id' or not exists(select 1 from public.profiles p where p.id=c.member_id and p.auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 select * into cap from public.manual_verification_captures where case_id=p_case for update;
 if not found then raise exception 'A reviewer must request capture first' using errcode='42501'; end if;
 if cap.state in ('created','review','approved') then return jsonb_build_object('state',cap.state,'url',cap.provider_url); end if;
 if cap.state='creating' and cap.lease_until>now() then raise exception 'Capture is being prepared; try again shortly' using errcode='55000'; end if;
 if cap.state not in ('requested','creating') then raise exception 'Ask your reviewer for another capture' using errcode='55000'; end if;
 tok:=gen_random_uuid();
 update public.manual_verification_captures set state='creating',lease=tok,lease_until=now()+interval '2 minutes',updated_at=now() where case_id=p_case;
 return jsonb_build_object('state','creating','lease',tok);
end $$;
create or replace function public.manual_capture_record(p_case bigint,p_actor uuid,p_lease uuid,p_session text,p_url text,p_workflow text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases;
begin
 select * into c from public.manual_verification_cases where id=p_case for update;
 if not found or c.status<>'open' or c.kind<>'person_id' or not exists(select 1 from public.profiles p where p.id=c.member_id and p.auth_user_id=p_actor) then raise exception 'Application unavailable' using errcode='42501'; end if;
 if p_session is null or p_url is null or p_workflow is null or p_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_url !~ '^https://verify[.]didit[.]me/' or length(p_url)>2000 or p_workflow is null or length(p_workflow)>100 then raise exception 'Invalid provider session' using errcode='22023'; end if;
 update public.manual_verification_captures set state='created',provider_session_id=p_session,provider_url=p_url,workflow_id=p_workflow,lease=null,lease_until=null,updated_at=now()
 where case_id=p_case and state='creating' and lease=p_lease and lease_until>now();
 if not found then raise exception 'Capture reservation expired' using errcode='55000'; end if;
 return true;
end $$;

create or replace function public.manual_capture_lookup(p_case bigint,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; cap public.manual_verification_captures; allowed boolean;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or c.status<>'open' or c.kind<>'person_id' then raise exception 'Application unavailable' using errcode='42501'; end if;
 select exists(select 1 from public.profiles p where p.id=c.member_id and p.auth_user_id=p_actor) or exists(select 1 from public.holup_admins a where a.auth_user_id=p_actor) into allowed;
 if not allowed then raise exception 'Application unavailable' using errcode='42501'; end if;
 select * into cap from public.manual_verification_captures where case_id=p_case;
 if not found then return jsonb_build_object('state','not_requested'); end if;
 return jsonb_build_object('state',cap.state,'session',cap.provider_session_id,'workflow',cap.workflow_id);
end $$;

-- Called only with server-fetched provider results. We store the minimum
-- decision, not raw document images, face data, extracted IDs or full response.
create or replace function public.manual_capture_result(p_case bigint,p_session text,p_workflow text,p_state text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.manual_verification_cases; cap public.manual_verification_captures;
begin
 select * into c from public.manual_verification_cases where id=p_case for update;
 select * into cap from public.manual_verification_captures where case_id=p_case for update;
 if c.id is null or c.status<>'open' or cap.provider_session_id is distinct from p_session or cap.workflow_id is distinct from p_workflow then raise exception 'Capture changed' using errcode='55000'; end if;
 if p_state is null or p_state not in ('created','approved','declined','review','expired') then raise exception 'Invalid result' using errcode='22023'; end if;
 -- Do not revive terminal declined/expired attempts. If a later provider
 -- decision withdraws approval, fail closed and revoke evidence.
 if cap.state in ('declined','expired') then return true; end if;
 if cap.state='approved' and p_state='created' then return true; end if;
 if p_state in ('declined','expired','review') then delete from public.manual_verification_capture_evidence where case_id=p_case; end if;
 update public.manual_verification_captures set state=p_state,updated_at=now() where case_id=p_case;
 if p_state='approved' then
  insert into public.manual_verification_capture_evidence(case_id,provider_session_id,approved,completed_at)
  values(p_case,p_session,true,public.now_ms()) on conflict(case_id) do update set provider_session_id=excluded.provider_session_id,approved=true,completed_at=excluded.completed_at,recorded_at=public.now_ms();
 end if;
 return true;
end $$;
create or replace function public.manual_capture_state(p_case bigint) returns text
language plpgsql stable security definer set search_path='' as $$
declare c public.manual_verification_cases; s text;
begin
 select * into c from public.manual_verification_cases where id=p_case;
 if not found or public.me_id() is null or (c.member_id<>public.me_id() and not public.holup_is_admin()) then perform public.crushly_fail(404,'','Application unavailable.'); end if;
 select state into s from public.manual_verification_captures where case_id=p_case;
 return coalesce(s,'not_requested');
end $$;
revoke all on function public.manual_capture_request(bigint),public.manual_capture_state(bigint) from public,anon,authenticated;
grant execute on function public.manual_capture_request(bigint),public.manual_capture_state(bigint) to authenticated;
revoke all on function public.manual_capture_claim(bigint,uuid),public.manual_capture_record(bigint,uuid,uuid,text,text,text),public.manual_capture_lookup(bigint,uuid),public.manual_capture_result(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.manual_capture_claim(bigint,uuid),public.manual_capture_record(bigint,uuid,uuid,text,text,text),public.manual_capture_lookup(bigint,uuid),public.manual_capture_result(bigint,text,text,text) to service_role;
commit;
