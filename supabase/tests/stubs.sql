-- Minimal Supabase platform stubs so Crushly migrations can run on plain Postgres.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists extensions;
-- pgcrypto exists on real Supabase (schema `extensions`); this build lacks it,
-- so stub the two functions our SQL uses. Same signatures and self-consistency:
-- crypt(pw, gen_salt('bf')) round-trips through crypt(pw, stored).
create function extensions.gen_salt(algo text) returns text language sql as $$
  select '$2a$06$' || substr(md5(random()::text), 1, 22)
$$;
create function extensions.crypt(pw text, salt text) returns text language sql immutable as $$
  select left(salt, 29) || md5(pw || left(salt, 29))
$$;

create schema if not exists auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar, role varchar, email varchar,
  encrypted_password varchar, email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz
);
create table auth.identities (
  id uuid, user_id uuid, provider_id text, provider text, identity_data jsonb,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Supabase's default schema grants
grant usage on schema public, storage to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema realtime;
create table realtime.messages (id bigint generated always as identity, extension text, payload jsonb);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated, anon;
grant select, insert on realtime.messages to authenticated;
grant usage on all sequences in schema realtime to authenticated;
create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true)
$$;
