# Audit fixes and rollout notes

These changes address the ten findings in [the repository audit](repository-audit.md).
They have been implemented in the repository, **not deployed to production**.

## What changed

| Finding | Fix |
| --- | --- |
| Public fallback for private uploads | App propagates Worker failures instead of retrying through Storage. Migration 026 makes the legacy media bucket private and removes member inserts. |
| Reserved username bypass | Database trigger prevents direct changes to username and its cooldown timestamp. The validated RPC remains usable; it locks the profile during changes. |
| Saved photo URLs ignore blocks/visibility | Authorization requires an existing photo owned by the path's member and checks blocks/visibility. Deleted photo rows revoke access. Seed photos also require a visible profile reference. |
| Worker deletions rejected | Shared canonical path parsing handles `/m/` and legacy Storage URLs; a supplied URL must name the exact same object. B2 deletion errors now return failure. |
| Vibe uploads misrouted | Vibes participate in all media-kind routing, including configuration filtering and auth. |
| Upload quota counts posts, not uploads | Durable reservations enforce 40 attempts per rolling hour, serialized by a per-member database lock. Clients cannot erase their quota. Failed uploads consume an attempt too. Text activity does not. |
| Chat drops incoming messages between sends/polls | Only received pages advance the receive cursor. Polls do not overlap; caught-up messages are deduplicated and ordered while optimistic drafts are retained. |
| Outdated manual setup | Both generated forms now contain all 27 migrations. CI checks byte-for-byte parity with the generator. |
| Filtered feed pages appear empty | Flow, public Flow and Circle feed queries apply visibility before LIMIT. |
| Comment limit ignored | Comments are ordered/limited in a subquery before JSON aggregation. |

### Legacy media compatibility

New uploads continue storing absolute Worker `/m/<path>` URLs. Bare stored paths
and this project's old public Storage URLs now render through `/legacy/<path>`.
The Worker forwards the member JWT to the authenticated Supabase Storage endpoint;
Storage RLS applies the same media authorization. There is no service-key bypass
and no public fallback. Files do not have to move between stores for this change.

All Worker media responses are `private, no-store`, and private photos no longer
use expo-image disk/memory caching. This prevents a newly cached response from
outliving an authorization check. Previously downloaded copies cannot be recalled.

An explicitly empty `EXPO_PUBLIC_MEDIA_BASE_URL` or removal of a kind from
`EXPO_PUBLIC_MEDIA_KINDS` disables those uploads; it does not move them to public
storage. A working Worker pointed at the same Supabase project is required.

## Deployment plan — requires production operator action

Use a staging project with two member accounts first. For production, coordinate
these changes in a maintenance window and keep a database backup:

1. Deploy the updated **media Worker** (includes the authenticated `/legacy/`
   route, no-store responses and correct deletion failures).
2. Apply migrations **026 and 027** using the normal migration pipeline. Do not
   modify previously recorded migration versions and do not load the demo seed.
   These migrations change live storage policy; review any manually added
   `storage.objects` policies as they may grant access beyond the repository's
   known policies.
3. Release the updated web/native clients promptly. Old clients using public
   Storage URLs or direct Storage uploads may stop working after step 2; this
   is a fail-closed compatibility break, not a reason to re-enable public media.
4. In staging/production verification, test both new B2 files and existing
   Supabase files: upload a Vibe, exchange a chat photo, delete a profile photo,
   block the other member, and attempt to reopen saved URLs. Confirm unauthorized
   requests fail, authorized legacy reads succeed, and media headers are no-store.
5. Review old public CDN/browser cache exposure. Purge controllable edge caches
   where supported and verify old public Storage URLs no longer return files.
   Changing a bucket policy cannot revoke copies already downloaded by a member
   or third party.

The repository changes do not run any of these production steps automatically
in this session. Existing deployment workflows will apply their usual behavior
when an operator pushes/runs them.

### Existing data needing review

- **Orphaned B2 files:** failed old deletions may have left bytes behind. The new
  photo authorization denies unreferenced photos, but does not physically erase
  historical files. Inventory objects against database references first; review
  a dry-run list before removing anything through the Storage/B2 APIs. Never
  infer that all old or unrecognized files are safe to delete.
- **Reserved handles already claimed:** the new trigger blocks future direct
  changes. It does not rename members retroactively. Review suspicious handles
  with an authorized administrator before changing existing identities.
- **Upload reservations:** retain rows for operational accounting/orphan review.
  Only rows newer than one hour count toward quota; old rows cannot block new
  attempts. Any future retention job must preserve at least that rolling window.

## Validation results (2026-10-13)

- TypeScript: passed. Generated `dist/` output is now excluded from typechecking.
- App/client/helper tests: **112 passed**.
- Worker and Didit tests: **15 passed** (127 Node tests total).
- All 27 database migrations applied twice; original smoke, audit regressions and concurrent quota test passed.
- Web production export: passed with offline placeholder Supabase configuration.
- Worker dry-run bundle: passed; no deployment performed.
- Generated SQL parity and `git diff --check`: passed. A deliberately drifted bundle was correctly rejected by the parity check, then restored.

## Validation commands

```bash
cd CrushlyApp
npm run typecheck
npm test
npm run build:web
cd ..
.venv/bin/python supabase/tests/run.py
node supabase/scripts/bundle-setup.mjs --check
cd cloudflare/media-worker
npx wrangler deploy --dry-run
```

The database runner includes the original smoke suite, security/pagination SQL
regressions and a real concurrent test: 45 upload requests yield exactly 40
reservations and five quota errors. The TypeScript tests mock native modules,
Supabase and external fetches; Worker tests never contact live services.

The historical `docs/audit/reproduce.py` intentionally applies only migrations
001–025 to demonstrate the original defects. It is **not** the fixed-code test
suite. Use `supabase/tests/run.py` and `npm test` for current correctness.

Native-device behavior, live B2/Supabase integration and external provider flows
still need staging verification; local tests and exports do not prove those.
