-- REQUIRES: relationship_cutover
-- HolUpp invitations, server-side referral attribution, and successful counts.
--
-- A member receives one reusable, unguessable invitation code. A referral is
-- claimed only by an authenticated, not-yet-onboarded account and becomes
-- successful only after onboarding plus a real first activity (post, Moment,
-- active follow, or Circle membership). Clicks alone never inflate the count.

create table if not exists public.holup_invite_codes (
  inviter_id bigint primary key references public.profiles(id) on delete cascade,
  code text not null unique,
  created_at bigint not null default public.now_ms(),
  revoked_at bigint
);

create index if not exists holup_invite_codes_active_idx
  on public.holup_invite_codes (code)
  where revoked_at is null;

alter table public.holup_invite_codes enable row level security;
revoke all on public.holup_invite_codes from public, anon, authenticated;

create table if not exists public.holup_referrals (
  id bigint generated always as identity primary key,
  inviter_id bigint not null references public.profiles(id) on delete cascade,
  referred_id bigint not null unique references public.profiles(id) on delete cascade,
  code text not null,
  status text not null default 'claimed' check (status in ('claimed', 'qualified', 'revoked')),
  claimed_at bigint not null default public.now_ms(),
  qualified_at bigint
);

create index if not exists holup_referrals_inviter_status_idx
  on public.holup_referrals (inviter_id, status, qualified_at);

alter table public.holup_referrals enable row level security;
revoke all on public.holup_referrals from public, anon, authenticated;

-- The member-facing stats and link are returned in one server-shaped answer.
create or replace function public.holup_invite_info()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  invite_code text;
  successful bigint := 0;
  pending bigint := 0;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select code into invite_code
    from public.holup_invite_codes
   where inviter_id = me and revoked_at is null;

  if invite_code is null then
    invite_code := replace(gen_random_uuid()::text, '-', '');
    insert into public.holup_invite_codes (inviter_id, code)
    values (me, invite_code)
    on conflict (inviter_id) do update
      set code = excluded.code,
          created_at = public.now_ms(),
          revoked_at = null
    returning code into invite_code;
  end if;

  select
    count(*) filter (where status = 'qualified'),
    count(*) filter (where status = 'claimed')
    into successful, pending
    from public.holup_referrals
   where inviter_id = me;

  return jsonb_build_object(
    'code', invite_code,
    'link', 'https://holupp.net/i/' || invite_code,
    'successful', successful,
    'pending', pending,
    'total', successful + pending
  );
end
$function$;

-- The invite page only needs a safe, generic validation answer. It does not
-- expose the inviter's private profile or any member directory data.
create or replace function public.holup_invite_preview(p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  clean text := lower(trim(coalesce(p_code, '')));
  inviter_name text;
begin
  if clean !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('valid', false);
  end if;

  select nullif(p.name, '') into inviter_name
    from public.holup_invite_codes i
    join public.profiles p on p.id = i.inviter_id
   where i.code = clean
     and i.revoked_at is null
     and p.status = 'active'
     and p.onboarded
   limit 1;

  if inviter_name is null then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object('valid', true, 'inviterName', inviter_name);
end
$function$;

-- Claiming is tied to auth.uid through me_id. The browser/app supplies only the
-- opaque code from the link; it cannot name the inviter or the referred account.
create or replace function public.holup_referral_claim(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  clean text := lower(trim(coalesce(p_code, '')));
  inviter bigint;
  already_onboarded boolean;
  inserted boolean := false;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if clean !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('claimed', false);
  end if;

  select onboarded into already_onboarded from public.profiles where id = me;
  if coalesce(already_onboarded, false) then
    return jsonb_build_object('claimed', false);
  end if;

  select inviter_id into inviter
    from public.holup_invite_codes
   where code = clean and revoked_at is null;

  if inviter is null or inviter = me then
    return jsonb_build_object('claimed', false);
  end if;

  insert into public.holup_referrals (inviter_id, referred_id, code)
  values (inviter, me, clean)
  on conflict (referred_id) do nothing;
  inserted := found;

  return jsonb_build_object('claimed', inserted);
end
$function$;

-- A successful referral is a claimed invite plus onboarding plus a genuine
-- first activity. The activity trigger calls this function after the new row is
-- written, while the onboarding trigger catches activity that happened before
-- the final onboarding flag was set.
create or replace function public.holup_mark_referral_activity(p_member_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_member_id is null then return; end if;
  if not exists (
    select 1 from public.profiles
     where id = p_member_id and onboarded and status = 'active'
  ) then
    return;
  end if;
  if not (
    exists (select 1 from public.posts where author_id = p_member_id)
    or exists (select 1 from public.moments where user_id = p_member_id)
    or exists (select 1 from public.holup_follows where follower_id = p_member_id and status = 'active')
    or exists (select 1 from public.circle_members where member_id = p_member_id)
  ) then
    return;
  end if;

  update public.holup_referrals
     set status = 'qualified', qualified_at = coalesce(qualified_at, public.now_ms())
   where referred_id = p_member_id and status = 'claimed';
end
$function$;

revoke all on function public.holup_mark_referral_activity(bigint) from public, anon, authenticated;

create or replace function public.holup_referral_activity_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  member_id bigint;
begin
  member_id := nullif(to_jsonb(new) ->> tg_argv[0], '')::bigint;
  if member_id is not null then
    perform public.holup_mark_referral_activity(member_id);
  end if;
  return new;
end
$function$;

revoke all on function public.holup_referral_activity_trigger() from public, anon, authenticated;

create or replace function public.holup_referral_onboarding_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.holup_mark_referral_activity(new.id);
  return new;
end
$function$;

revoke all on function public.holup_referral_onboarding_trigger() from public, anon, authenticated;

drop trigger if exists holup_referral_posts_activity on public.posts;
create trigger holup_referral_posts_activity
after insert on public.posts
for each row execute function public.holup_referral_activity_trigger('author_id');

drop trigger if exists holup_referral_moments_activity on public.moments;
create trigger holup_referral_moments_activity
after insert on public.moments
for each row execute function public.holup_referral_activity_trigger('user_id');

drop trigger if exists holup_referral_follows_activity on public.holup_follows;
create trigger holup_referral_follows_activity
after insert or update of status on public.holup_follows
for each row when (new.status = 'active')
execute function public.holup_referral_activity_trigger('follower_id');

drop trigger if exists holup_referral_circle_members_activity on public.circle_members;
create trigger holup_referral_circle_members_activity
after insert on public.circle_members
for each row execute function public.holup_referral_activity_trigger('member_id');

drop trigger if exists holup_referral_onboarded_activity on public.profiles;
create trigger holup_referral_onboarded_activity
after update of onboarded on public.profiles
for each row when (new.onboarded is true and old.onboarded is distinct from true)
execute function public.holup_referral_onboarding_trigger();

revoke all on function public.holup_invite_info() from public, anon;
grant execute on function public.holup_invite_info() to authenticated, service_role;
revoke all on function public.holup_invite_preview(text) from public;
grant execute on function public.holup_invite_preview(text) to anon, authenticated, service_role;
revoke all on function public.holup_referral_claim(text) from public, anon;
grant execute on function public.holup_referral_claim(text) to authenticated, service_role;

notify pgrst, 'reload schema';
