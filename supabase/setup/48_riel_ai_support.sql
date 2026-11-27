-- RielAi member help and support intake.
-- Member RielAi is help-only in the first release: it answers from the
-- approved help content and does not persist an AI conversation. A member can
-- explicitly hand a problem to human support; that report is retained as a
-- support ticket under the existing privacy boundary.

create table if not exists public.holup_support_tickets (
  id              bigserial primary key,
  auth_user_id    uuid not null references auth.users(id) on delete cascade,
  category        text not null check (category in ('report_problem','feedback','account','safety','other')),
  subject         text not null,
  body            text not null,
  source          text not null default 'app',
  status          text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at      bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists holup_support_tickets_user_idx
  on public.holup_support_tickets (auth_user_id, created_at desc);
create index if not exists holup_support_tickets_status_idx
  on public.holup_support_tickets (status, created_at desc);

alter table public.holup_support_tickets enable row level security;
revoke all on public.holup_support_tickets from anon, authenticated;
revoke all on sequence public.holup_support_tickets_id_seq from anon, authenticated;

create or replace function public.holup_support_ticket_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := auth.uid();
  v_category text := lower(btrim(coalesce(p->>'category','report_problem')));
  v_subject text := left(btrim(coalesce(p->>'subject','')), 160);
  v_body text := left(btrim(coalesce(p->>'body','')), 12000);
  v_source text := left(btrim(coalesce(p->>'source','app')), 40);
  v_id bigint;
begin
  if v_user is null then perform public.crushly_fail(401, 'unauthorized', 'Sign in to report a problem.'); end if;
  if v_category not in ('report_problem','feedback','account','safety','other') then perform public.crushly_fail(400, '', 'Choose a supported support category.'); end if;
  if char_length(v_subject) < 2 then perform public.crushly_fail(400, '', 'Give the problem a short subject.'); end if;
  if char_length(v_body) < 2 then perform public.crushly_fail(400, '', 'Describe the problem so the team can investigate it.'); end if;
  insert into public.holup_support_tickets(auth_user_id, category, subject, body, source)
  values (v_user, v_category, v_subject, v_body, coalesce(nullif(v_source,''), 'app'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'open');
end $function$;

create or replace function public.holup_support_ticket_list(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
begin
  if v_user is null then perform public.crushly_fail(401, 'unauthorized', 'Sign in to view support requests.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'category', t.category, 'subject', t.subject, 'body', t.body,
    'status', t.status, 'source', t.source, 'createdAt', t.created_at, 'updatedAt', t.updated_at
  ) order by t.created_at desc), '[]'::jsonb)
  into v_rows
  from public.holup_support_tickets t
  where t.auth_user_id = v_user
  limit 20;
  return jsonb_build_object('rows', v_rows);
end $function$;

grant execute on function public.holup_support_ticket_create(jsonb) to authenticated;
grant execute on function public.holup_support_ticket_list(jsonb) to authenticated;
revoke execute on function public.holup_support_ticket_create(jsonb) from public, anon;
revoke execute on function public.holup_support_ticket_list(jsonb) from public, anon;
