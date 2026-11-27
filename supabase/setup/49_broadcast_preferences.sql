-- Per-member channel preferences used by confirmation-gated administrator
-- broadcasts. Service announcements remain opt-out rather than being silently
-- treated as marketing mail; the Control Centre shows counts after applying
-- these values.

alter table public.notification_settings
  add column if not exists announcement_in_app boolean not null default true,
  add column if not exists announcement_push boolean not null default true,
  add column if not exists announcement_email boolean not null default true;
