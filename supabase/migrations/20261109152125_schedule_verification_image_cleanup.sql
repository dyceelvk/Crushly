-- Historical production experiment, immediately disabled and rolled back by
-- 20261109152214 and 20261109152300. This replay-safe marker intentionally does
-- NOT install pg_net, create a scheduler or expose a credential. Exact applied
-- statements and the reason for the safety rollback are recorded in
-- supabase/manual-verification-work/disabled-pg-net-scheduler-history.md.
select 1;
