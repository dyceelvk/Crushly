-- EXPERIMENT ONLY: isolated teen-specific Supabase project, NEVER adult Holup.
-- The session setting is set only by the operator when creating a new isolated
-- project. A production adult profile table always aborts this script.
-- No link to Didit; birthdates are self-declared and DO NOT prove real age.
begin;
do $$
begin
 if current_setting('holup.instance_type',true) is distinct from 'teen-isolated' then
  raise exception 'Refusing to install: holup.instance_type must be teen-isolated'; end if;
 if to_regclass('public.profiles') is not null then
  raise exception 'Refusing to install in a database with adult Holup profiles'; end if;
end $$;
create schema if not exists holup_teen;
revoke all on schema holup_teen from public,anon,authenticated;

-- The isolated project MUST have separate auth, JWT signing keys, database,
-- storage and Realtime configuration. A schema in the adult project alone is
-- NOT an isolation boundary. No adult data is imported or federated.
create table if not exists holup_teen.accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 birthdate date not null,
 account_status text not null default 'active' check(account_status in ('active','suspended','closed')),
 consent_status text not null default 'pending' check(consent_status in ('pending','granted','withdrawn')),
 consent_version text,
 consent_recorded_at timestamptz,
 created_at timestamptz not null default now(),
 check ((consent_status<>'granted') or (consent_version is not null and consent_recorded_at is not null))
);
create table if not exists holup_teen.profiles (
 user_id uuid primary key references holup_teen.accounts(user_id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 40),
 handle text not null unique check(handle ~ '^[a-z][a-z0-9_]{2,19}$'),
 discoverable boolean not null default false
);
create table if not exists holup_teen.keeps (
 keeper uuid not null references holup_teen.accounts(user_id) on delete cascade,
 kept uuid not null references holup_teen.accounts(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(keeper,kept),check(keeper<>kept)
);
create table if not exists holup_teen.blocks (
 blocker uuid not null references holup_teen.accounts(user_id) on delete cascade,
 blocked uuid not null references holup_teen.accounts(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker,blocked),check(blocker<>blocked)
);
create table if not exists holup_teen.audit (
 id bigint generated always as identity primary key,
 actor text not null, action text not null, subject uuid not null,
 created_at timestamptz not null default now(), details jsonb not null default '{}'::jsonb
);
alter table holup_teen.accounts enable row level security;
alter table holup_teen.profiles enable row level security;
alter table holup_teen.keeps enable row level security;
alter table holup_teen.blocks enable row level security;
alter table holup_teen.audit enable row level security;
revoke all on all tables in schema holup_teen from public,anon,authenticated;
revoke all on all sequences in schema holup_teen from public,anon,authenticated;

-- A member is eligible only while their declared birthday remains 12–17, their
-- account is active, and consent is recorded. The check is live on every RPC:
-- reaching 18 or withdrawal denies the next read/write, not just the next login.
create or replace function holup_teen.eligible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from holup_teen.accounts a where a.user_id=p_user and a.account_status='active'
  and a.consent_status='granted' and a.birthdate <= (current_date - interval '12 years')::date
  and a.birthdate > (current_date - interval '18 years')::date)
$$;
create or replace function holup_teen.blocked(a uuid,b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from holup_teen.blocks k where (k.blocker=a and k.blocked=b) or (k.blocker=b and k.blocked=a))
$$;
create or replace function holup_teen.mutual(a uuid,b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select a is not null and b is not null and a<>b and holup_teen.eligible(a) and holup_teen.eligible(b)
  and not holup_teen.blocked(a,b)
  and exists(select 1 from holup_teen.keeps where keeper=a and kept=b)
  and exists(select 1 from holup_teen.keeps where keeper=b and kept=a)
$$;
create or replace function holup_teen.pair_lock(a uuid,b uuid) returns void
language sql volatile security definer set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended(least(a::text,b::text)||':'||greatest(a::text,b::text),0))
$$;
revoke all on all functions in schema holup_teen from public,anon,authenticated;

-- First declaration is immutable to clients. Corrections require a separate
-- support process; allowing arbitrary birthday changes would let a person
-- move across age boundaries by editing their profile.
create or replace function public.teen_declare_birthdate(p_birthdate date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); original date;
begin
 if me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_birthdate is null or p_birthdate>(current_date-interval '12 years')::date or p_birthdate<=(current_date-interval '18 years')::date then
  raise exception 'This space is for ages 12–17' using errcode='22023'; end if;
 insert into holup_teen.accounts(user_id,birthdate) values(me,p_birthdate) on conflict(user_id) do nothing;
 select birthdate into original from holup_teen.accounts where user_id=me;
 if original is distinct from p_birthdate then raise exception 'Contact support to correct your birthday' using errcode='42501'; end if;
 return jsonb_build_object('consentRequired',true,'active',holup_teen.eligible(me));
end $$;

create or replace function public.teen_my_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); a holup_teen.accounts;
begin
 if me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into a from holup_teen.accounts where user_id=me;
 if not found then return jsonb_build_object('enrolled',false,'active',false); end if;
 return jsonb_build_object('enrolled',true,'active',holup_teen.eligible(me),'consentStatus',a.consent_status,
  'accountStatus',a.account_status,'birthday',a.birthdate,'ageSelfReported',true);
end $$;

-- Trusted backend only. An authenticated teen cannot approve their own consent.
-- An operator may not call this until a separate verifiable guardian-consent
-- workflow, withdrawal, and local-law review exist. Never put service-role
-- credentials in an app. This records a minimal version, not identity docs.
create or replace function public.teen_record_guardian_consent(p_user uuid,p_version text,p_granted boolean,p_operator text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_user is null or p_granted is null or length(btrim(coalesce(p_version,'')))<1 or length(btrim(coalesce(p_version,'')))>40
  or length(btrim(coalesce(p_operator,'')))<1 or length(btrim(coalesce(p_operator,'')))>120 then raise exception 'Invalid consent record' using errcode='22023'; end if;
 update holup_teen.accounts set consent_status=case when p_granted then 'granted' else 'withdrawn' end,
  consent_version=btrim(p_version),consent_recorded_at=now() where user_id=p_user;
 if not found then raise exception 'Account not found' using errcode='P0002'; end if;
 insert into holup_teen.audit(actor,action,subject,details) values(btrim(p_operator),case when p_granted then 'guardian_consent_granted' else 'guardian_consent_withdrawn' end,p_user,jsonb_build_object('version',btrim(p_version)));
 return true;
end $$;
revoke all on function public.teen_record_guardian_consent(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.teen_record_guardian_consent(uuid,text,boolean,text) to service_role;

-- The first social surface contains only a name and an optional exact-match
-- handle. Private by default. No adult profiles, location, dating fields,
-- romantic likes/Add Ups, comments, messages, media, or Realtime are exposed.
create or replace function public.teen_set_profile(p_name text,p_handle text,p_discoverable boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); n text:=btrim(coalesce(p_name,'')); h text:=lower(btrim(coalesce(p_handle,'')));
begin
 perform 1 from holup_teen.accounts where user_id=me for share;
 if not holup_teen.eligible(me) then raise exception 'Teen access not available' using errcode='42501'; end if;
 if char_length(n)<1 or char_length(n)>40 or h !~ '^[a-z][a-z0-9_]{2,19}$' or p_discoverable is null then
  raise exception 'Enter a name and valid handle' using errcode='22023'; end if;
 insert into holup_teen.profiles(user_id,display_name,handle,discoverable) values(me,n,h,p_discoverable)
 on conflict(user_id) do update set display_name=excluded.display_name,handle=excluded.handle,discoverable=excluded.discoverable;
 return true;
end $$;

create or replace function public.teen_find_profile(p_handle text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.user_id,'name',p.display_name,'handle',p.handle)
 from holup_teen.profiles p where holup_teen.eligible(auth.uid()) and holup_teen.eligible(p.user_id)
  and not holup_teen.blocked(auth.uid(),p.user_id) and lower(btrim(p_handle))=p.handle
  and (p.user_id=auth.uid() or p.discoverable or holup_teen.mutual(auth.uid(),p.user_id))
 limit 1
$$;

create or replace function public.teen_keep(p_target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); incoming boolean;
begin
 if me is null or p_target is null or p_target=me then raise exception 'Invalid member' using errcode='22023'; end if;
 perform holup_teen.pair_lock(me,p_target);
 -- Lock both account rows while reading eligibility. A consent withdrawal or
 -- suspension waits for an already-running operation and wins thereafter.
 perform 1 from holup_teen.accounts where user_id in (me,p_target) order by user_id for share;
 incoming:=exists(select 1 from holup_teen.keeps where keeper=p_target and kept=me);
 if not holup_teen.eligible(me) or not holup_teen.eligible(p_target) or holup_teen.blocked(me,p_target)
  or not exists(select 1 from holup_teen.profiles p where p.user_id=p_target and (p.discoverable or incoming or holup_teen.mutual(me,p_target))) then
  raise exception 'Member unavailable' using errcode='42501'; end if;
 if not exists(select 1 from holup_teen.keeps where keeper=me and kept=p_target)
  and (select count(*) from holup_teen.keeps where keeper=me and created_at>now()-interval '1 day')>=50 then
  raise exception 'Please try again later' using errcode='54000'; end if;
 insert into holup_teen.keeps(keeper,kept) values(me,p_target) on conflict do nothing;
 return jsonb_build_object('keeps',true,'mutual',incoming);
end $$;
create or replace function public.teen_unkeep(p_target uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null or p_target is null or me=p_target then raise exception 'Invalid member' using errcode='22023'; end if;
 perform holup_teen.pair_lock(me,p_target);
 delete from holup_teen.keeps where keeper=me and kept=p_target;
 return true;
end $$;
create or replace function public.teen_block(p_target uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null or p_target is null or me=p_target then raise exception 'Invalid member' using errcode='22023'; end if;
 perform holup_teen.pair_lock(me,p_target);
 if not holup_teen.eligible(me) or not exists(select 1 from holup_teen.accounts where user_id=p_target) then raise exception 'Member unavailable' using errcode='42501'; end if;
 insert into holup_teen.blocks(blocker,blocked) values(me,p_target) on conflict do nothing;
 delete from holup_teen.keeps where (keeper=me and kept=p_target) or (keeper=p_target and kept=me);
 return true;
end $$;
create or replace function public.teen_close_ones() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); items jsonb;
begin
 if not holup_teen.eligible(me) then raise exception 'Teen access not available' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'name',p.display_name,'handle',p.handle) order by p.handle),'[]'::jsonb) into items
 from holup_teen.keeps k join holup_teen.profiles p on p.user_id=k.kept
 where k.keeper=me and holup_teen.mutual(me,p.user_id);
 return jsonb_build_object('items',items);
end $$;
create or replace function public.teen_kept_you_close() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); items jsonb;
begin
 if not holup_teen.eligible(me) then raise exception 'Teen access not available' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'name',p.display_name,'mutual',holup_teen.mutual(me,p.user_id)) order by k.created_at desc),'[]'::jsonb) into items
 from holup_teen.keeps k join holup_teen.profiles p on p.user_id=k.keeper
 where k.kept=me and holup_teen.eligible(k.keeper) and not holup_teen.blocked(me,k.keeper);
 return jsonb_build_object('items',items);
end $$;
revoke all on function public.teen_declare_birthdate(date),public.teen_my_state(),public.teen_set_profile(text,text,boolean),public.teen_find_profile(text),public.teen_keep(uuid),public.teen_unkeep(uuid),public.teen_block(uuid),public.teen_close_ones(),public.teen_kept_you_close() from public,anon,authenticated;
grant execute on function public.teen_declare_birthdate(date),public.teen_my_state(),public.teen_set_profile(text,text,boolean),public.teen_find_profile(text),public.teen_keep(uuid),public.teen_unkeep(uuid),public.teen_block(uuid),public.teen_close_ones(),public.teen_kept_you_close() to authenticated;
commit;
