# Crushly

A premium dating and social app for gay, bi and queer men. *Meet men. Make connections. Follow the feeling.*

| Folder | What it is |
| --- | --- |
| [`CrushlyApp/`](CrushlyApp/) | The app. Expo (React Native) for iOS, Android and web, written in TypeScript. |
| [`supabase/`](supabase/) | The backend. Supabase: Postgres schema + row-level security, RPC functions, Auth, Storage and the demo seed. |
| [`netlify.toml`](netlify.toml) | Web deployment: builds the Expo web export on Netlify. |

There is no server to run — the app talks to Supabase directly.

## Run it locally

Requires **Node 22+**, [Docker](https://docs.docker.com/) and the
[Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
# 1. Backend: local Supabase stack + demo community (port 54321)
supabase start
supabase db reset                 # migrations + seed.sql
cd supabase && npm install
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> \
npm run seed:photos               # demo portraits into Storage
cd ..

# 2. App
cd CrushlyApp
npm install
cp .env.example .env              # then paste the URL + anon key from `supabase status`
npm start                         # Expo dev server: press i / a, or scan the QR code with Expo Go
```

The web app also runs from the same dev server (`npm run web`).

### Demo account

Sign in with **daniel@crushly.app / crushly123**, or tap *Explore the demo community* on the sign-in screen. Every seeded member is a real account with the password `crushly123`, so you can sign in as anyone in a second browser and test both sides of a Crush or a conversation. For example, crush back on **Marcus** from Daniel's account to see a Mutual Crush.

Reset the demo data at any time with `supabase db reset` (then re-run `npm run seed:photos`).

## Deploy the web app on Netlify

1. Connect this repository to [Netlify](https://app.netlify.com). `netlify.toml`
   already knows how to build it (`base: CrushlyApp`, Expo web export → `dist/`,
   SPA redirects).
2. In **Site settings → Environment variables**, add:
   - `EXPO_PUBLIC_SUPABASE_URL` — your Supabase project URL
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon (public) key
3. Deploy. Native builds (TestFlight / Play Store) use the same env vars — see
   [`CrushlyApp/README.md`](CrushlyApp/README.md).

For the backend, create a project at [supabase.com](https://supabase.com) and run
`supabase link --project-ref <ref> && supabase db push` — full steps in
[`supabase/README.md`](supabase/README.md).

## What works end to end

Everything below is backed by Supabase (Auth, Postgres with row-level security,
RPC functions and Storage):

- Sign up, sign in, sign out, change email or password, sign out other sessions, pause account, delete account
- Onboarding: intentions, basics, photo upload (resized on device), bio, interests, and discovery preferences
- Discover with filters (age, distance, connection type, interests). Distance is always rounded and exact location is never returned.
- Crush, Deep Crush with a note, Pass, Mutual Crush celebration, and removing a Connection
- Crushes: *Crushing on you* / *Your crushes* / *Mutual Crushes*
- Messaging: text, photos, voice notes, stickers, shared profiles, Crush reactions, optional read receipts, and new messages within ~3 seconds
- Message search: filter conversations by name, preview or message text
- Moments (expire after 24h): text or photo, viewer with reply, react and Crush
- Notification center with live in-app toasts
- Safety: block, unblock, report (from profiles, chats and Moments), hide from Discover, who can message or Crush you, show or hide online status, distance, age and read receipts
- Verification: selfie with a random pose. Requests stay **pending** until a moderator approves them.
- Settings: discovery, privacy, notifications, dark/light/system appearance, and support pages

## Deliberately not faked

These features need a third-party service or a human in the loop. Rather than pretend, the UI says so honestly:

| Feature | Status |
| --- | --- |
| **Crushly Plus** | The paywall screen records interest (`profiles.plus_interest`). There's no payment provider yet, so nothing is charged and no Plus features unlock. Incognito returns `402 plus_required`. |
| **Verification review** | Selfies land in the private `verification` bucket and wait for a human. Approve or reject them with `supabase/scripts/admin.mjs verify-user`. |
| **Reports** | Stored in `reports`. Triaged with `supabase/scripts/admin.mjs reports` — no moderator dashboard yet. |
| **Push notifications** | In-app notifications and toasts work. OS push needs Expo push credentials and isn't wired up yet. |
| **GIFs** | Replaced by a built-in sticker pack, so no GIF API key is needed. |
| **Realtime** | Polling through react-query (a few seconds in an open chat). Supabase Realtime channels are an easy swap-in when you scale. |

## Before launch

- The **Terms, Privacy and Community Guidelines** copy in `CrushlyApp/src/screens/settings/Info.tsx` is placeholder text written for the product. Have it reviewed by a lawyer.
- The seed uses 16 AI-generated portraits (`supabase/seed/photos/`) for demo members. Don't ship them as real users.
- Turn on email confirmation in Supabase Auth, and keep the service role key out of the app (it belongs only in server-side scripts).

## Tests

```bash
# App: typecheck + unit tests (format helpers, message previews, Moments feed)
cd CrushlyApp && npm run typecheck && npm test

# Backend: schema, seed and RPC smoke tests on a throwaway Postgres
python -m venv /tmp/pgvenv && /tmp/pgvenv/bin/pip install pgserver psycopg2-binary
/tmp/pgvenv/bin/python supabase/tests/run.py
```

Both run on every push in `.github/workflows/ci.yml`. The database logic lives
in `supabase/migrations/` (SQL functions mirror the old Express routes one for
one); `supabase/README.md` explains the layout.
