# Crushly backend — Supabase

All of Crushly's backend lives here: schema, row-level security, the RPC
functions that used to be Express routes, and the demo seed. The app talks to
Supabase directly (`@supabase/supabase-js`); there is no server to run.

| File | What it is |
| --- | --- |
| `migrations/` | Schema, RLS, storage buckets and every RPC. Applied in order. |
| `seed.sql` | Demo community (11 accounts, chats, Moments). Password: `crushly123`. |
| `seed/photos/` | AI-generated demo portraits, uploaded to `media/seed/`. |
| `scripts/seed-storage.mjs` | Uploads `seed/photos/` to the `media` bucket. |
| `tests/` | Smoke tests for the schema and RPCs (see `tests/run.py`). |
| `config.toml` | Local dev stack (ports, auth, storage). |

## Run it locally

Requires the [Supabase CLI](https://supabase.com/docs/guides/local-development)
and Docker.

```bash
supabase start                # boots Postgres, Auth, Storage, Studio…
supabase db reset             # applies migrations + seed.sql
cd supabase && npm install
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> \
npm run seed:photos           # demo portraits into media/seed/
```

Then point the app at the local stack (in `CrushlyApp/.env`):

```bash
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<from `supabase status`>
```

## Run it on a hosted project

1. Create a project at [supabase.com](https://supabase.com).
2. Push the schema: `supabase link --project-ref <ref> && supabase db push`
   (this also runs `seed.sql`; comment it out first if you want an empty app).
3. In **Authentication → Providers → Email**, turn *Confirm email* off for the
   smoothest demo (or keep it on — the app will ask members to confirm first).
4. Upload the demo photos with `npm run seed:photos` as above, using the
   project URL and its **service role** key.
5. Copy the project URL and **anon** key into the app env (below).

## How it fits together

- **Identity** is Supabase Auth. `profiles.auth_user_id` links to `auth.users`;
  an `on_auth_user_created` trigger creates every member's rows at signup.
- **Privacy**: RLS only lets members touch their own rows. Everything
  cross-member (Discover, crushes, chat, Moments, notifications) goes through
  the SECURITY DEFINER RPCs in `migrations/20261008000002_functions.sql`,
  which apply the same privacy rules as the old API — exact coordinates and
  birthdates never leave the database.
- **Media** lives in two storage buckets: `media` (public: photos, chat media,
  Moments, demo seed) and `verification` (private: review selfies). Paths are
  `<kind>/<profile id>/<file>`; members can only write inside their own folder.
- **Errors** from RPCs use `__CRUSHLY__<status>__<code>__<message>`, which the
  app's `src/api/client.ts` turns back into typed `ApiError`s.

## Ops tooling

`scripts/admin.mjs` is the human-review tooling the app deliberately doesn't
fake — approving verification selfies and triaging reports:

```bash
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...   # service role, never in the app

npm run admin -- verify-user --list            # pending selfie reviews
npm run admin -- verify-user --approve daniel@crushly.app
npm run admin -- verify-user --reject  daniel@crushly.app
npm run admin -- reports                       # open reports (reported member's email, reason)
npm run admin -- reports --status all
npm run admin -- reports --resolve 3
```

Approving sets the member to `verified` and drops a `verified` notification
(and a `verification_rejected` one when rejecting), so it shows up in the app.

## Optional demo data

`seed.sql` is for local evaluation only — never load it into a live project as
content. Every seeded member is flagged `is_demo` and is a real account with
the password `crushly123` (so you can sign in as anyone and test both sides):

| Email | Notes |
| --- | --- |
| `daniel@crushly.app` | The demo account. People are crushing on him; Marcus is one Crush away from a Mutual Crush. |
| `marcus@crushly.app`, `ryan@crushly.app`, `ade@crushly.app`, `seun@crushly.app` | Verified. |
| Everyone else | Unverified, variously active. Tobi and Seun have no photos — same as the original demo. |

Reset at any time: `supabase db reset` (and re-run `npm run seed:photos`).

If demo data ever reaches a live project, purge it — this deletes the demo
members (and everything they touched) and their photos, leaving real accounts
untouched:

```bash
npm run admin -- purge-demo --dry-run   # preview
npm run admin -- purge-demo             # wipe it
```
