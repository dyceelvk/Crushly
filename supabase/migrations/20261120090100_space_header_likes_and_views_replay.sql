-- No-op on a clean checkout.
--
-- The first application of the parent migration against the live project
-- compiled a body that read a column `holup_follow_settings` does not have, so
-- the function existed but every call failed. The parent file was corrected in
-- place and re-applied on 2026-11-20, and this marker exists so the project's
-- migration history has an entry for that second application.
--
-- Verified after the fix, as two different authenticated members:
--   owner calling on their own Space   → views: 17, allRoundLikes: 4
--   another member calling on the same → views: null, allRoundLikes: 4
--   anon                               → cannot execute the function at all

select 1;
