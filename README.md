# Crushly

A premium dating and social app for gay, bi and queer men. *Meet men. Make connections. Follow the feeling.*

| Folder | What it is |
| --- | --- |
| [`CrushlyApp/`](CrushlyApp/) | The app. Expo (React Native) for iOS, Android and web, written in TypeScript. |
| [`supabase/`](supabase/) | The backend. Supabase: Postgres schema + row-level security, RPC functions, Auth, Storage and an optional demo seed. |
| [`netlify.toml`](netlify.toml) | Web deployment: builds the Expo web export on Netlify. |

There is no server to run — the app talks to Supabase directly.

## Run it locally

Requires **Node 22+**, [Docker](https://docs.docker.com/) and the
[Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
# 1. Backend: local Supabase stack (port 54321)
supabase start
supabase db reset                 # schema + optional demo community (seed.sql)
cd supabase && npm install
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> \
npm run seed:photos               # demo portraits into Storage (skip for a clean stack)
cd ..

# 2. App
cd CrushlyApp
npm install
cp .env.example .env              # then paste the URL + anon key from `supabase status`
npm start                         # Expo dev server: press i / a, or scan the QR code with Expo Go
```

The web app also runs from the same dev server (`npm run web`).

### Optional: the demo community

`seed.sql` fills a **local** stack with fictional members (password `crushly123`
for all) so you can click around without juggling two accounts — for example
sign in as **daniel@crushly.app** and crush back **Marcus** to see a Mutual
Crush. It stays out of the product: the sign-in screen's *Explore the demo
community* button only appears when you set `EXPO_PUBLIC_DEMO_LOGIN=1`, and
every seeded member is flagged `is_demo`. If demo data ever reaches a live
project, purge it so only real members remain:

```bash
cd supabase && npm run admin -- purge-demo --dry-run   # preview
cd supabase && npm run admin -- purge-demo             # delete demo members + photos
```

## Deploy for real (Netlify + Supabase)

A productive deployment has real accounts and no seeded data. Four steps from
zero:

1. **Create the backend.** New project at [supabase.com](https://supabase.com),
   then create the schema — easiest first:
   - **GitHub Actions (recommended)**: add one repository secret and the
     [`db-migrations.yml`](.github/workflows/db-migrations.yml) workflow pushes
     `supabase/migrations/` to your project automatically on every migration
     change (or manually from the Actions tab → *Run workflow*):
     1. In your Supabase project, click **Connect** at the top of the page →
        **Session pooler** → copy the URI. Replace `[YOUR-PASSWORD]` with
        your database password (Settings → Database → *Reset database
        password* if you lost it; percent-encode special characters).
     2. GitHub repo → **Settings → Secrets and variables → Actions** →
        **New repository secret** → name it `SUPABASE_DB_URL`, paste the URI.
     Never commit that value or paste it into chat.
   - **No CLI, one time**: run the three parts in [`supabase/setup/`](supabase/setup/)
     in the project's **SQL editor** (each file on GitHub has a copy button),
     or paste the all-in-one [`supabase/setup.sql`](supabase/setup.sql) —
     either way it's re-runnable and self-healing.
   - **Local CLI**: `supabase link --project-ref <ref> && supabase db push`
     (full steps in [`supabase/README.md`](supabase/README.md)).
   Never load `seed.sql` into a live project — it's the fictional demo
   community. If it ever lands there, `npm run admin -- purge-demo` removes it.
2. **Wire up email links.** In **Supabase → Authentication → URL
   configuration**, set **Site URL** (and redirect URLs) to your Netlify domain
   — confirmation and reset emails link back to the app from there. New
   projects confirm emails by default; turn that off in **Authentication →
   Providers → Email** only if you want instant sign-in for a private preview.
3. **Put the deploy secrets in GitHub** and the
   [`deploy-web.yml`](.github/workflows/deploy-web.yml) workflow builds the
   app and deploys it to Netlify on every push (or manually from the Actions
   tab — *Deploy web app* → **Run workflow**). Five repository secrets
   (Settings → Secrets and variables → Actions):
   | Secret | Where the value comes from |
   | --- | --- |
   | `SUPABASE_DB_URL` | Supabase project → **Connect** button (top of the page) → **Session pooler** → the URI string, with `[YOUR-PASSWORD]` replaced |
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL (bare `https://<ref>.supabase.co`) |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon `public` key |
   | `NETLIFY_AUTH_TOKEN` | [Netlify → Personal access tokens](https://app.netlify.com/user/applications) → New access token |
   | `NETLIFY_SITE_ID` | Netlify → Site configuration → General → Site ID |

   The build reads the Supabase values from secrets, so nothing has to be
   configured in Netlify itself. If the app ever shows "Backend not
   connected", the env secrets are missing — the workflow says exactly which.
4. **One Netlify toggle.** So Actions is the only deployer, turn off Netlify's
   own git builds: Netlify → Site configuration → Build & deploy → your
   repository → **Stop auto publishing**. (Leave the site connected; the
   `netlify.toml` redirects/headers are baked into the export either way.)

   Then sign up for real. Native builds (TestFlight / Play Store) use the same
   env values — see [`CrushlyApp/README.md`](CrushlyApp/README.md).

### Switch the live site to another Netlify account

When one Netlify account's deploys are blocked — e.g. a stuck *"Skipped due to
account credit usage exceeded"* flag (a known Netlify issue that top-ups don't
always clear, and it can block even manual deploys) — the clean move is a
**new site on another account**. The pipeline follows the `NETLIFY_SITE_ID`
secret, so nothing in the repo changes:

1. **Create a new site in the other account**:
   [app.netlify.com → Add new site → Import an existing project](https://app.netlify.com/start)
   → `dyceelvk/Crushly`, branch `arena/927d4af8-crushly`. (The repo's
   `netlify.toml` carries the whole build config.)
2. **Copy the build env vars onto the new site**: Site configuration →
   Environment variables → add `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` with the same values as the GitHub secrets.
   Git builds need them baked in at build time.
3. **Keep the URL identical (recommended).** Rename the OLD site first
   (Site configuration → General → Change site name → e.g. `mencrushly-old`),
   then rename the NEW site to `mencrushly` (same place). `mencrushly.netlify.app`
   then serves the new site, and the Supabase Site URL, email links and the
   logo inside the emails all keep working untouched. If you skip this, the
   new site gets a fresh `*.netlify.app` address — the deploy workflow points
   Supabase at it automatically on the next run.
4. **Point the pipeline at the new site**: GitHub →
   [Settings → Secrets and variables → Actions](https://github.com/dyceelvk/Crushly/settings/secrets/actions)
   → update:
   - `NETLIFY_SITE_ID` → the new site's **Site ID** (Site configuration → General)
   - `NETLIFY_AUTH_TOKEN` → a [Personal access token](https://app.netlify.com/user/applications)
     from the account that owns the NEW site — only needed if that account is a
     different Netlify login; one token sees every account the same login
     belongs to.
5. **Retire the old site's automation** (optional but tidy): old site → Site
   configuration → Build & deploy → **Stop auto publishing**, and delete the
   `ci-trigger` build hook under **Build hooks**.
6. **Push anything** (or Actions → *Deploy web app* → **Run workflow**). The
   deploy log's *Diagnose Netlify access* step prints the site it is deploying
   to — confirm it shows the new site, then watch the URL update.

   The same switch works in reverse later: point `NETLIFY_SITE_ID` back and the
   pipeline follows.

   **Current state (2026-10-08):** the pipeline targets site `crushlyi` on a
   second Netlify account, and **https://crushlyi.netlify.app serves the latest
   commit** — the old account's "credit usage exceeded" block no longer matters.
   The old `mencrushly.netlify.app` still serves the frozen build; if you want
   that name back on the new account, rename the old site (step 3 above) and
   rename `crushlyi` to `mencrushly` — the pipeline follows on the next deploy.

## AI profile verification

Members follow two illustrated poses (`CrushlyApp/assets/poses/`), the app uploads the
selfies to the private `verification` bucket, and the `verify-identity` edge function
compares them with their profile photos using a vision model — verified members get the
badge instantly, mismatches can retake, and anything the AI can't handle stays queued for
manual review (`npm run admin -- review-verification`).

- One secret keeps it automatic: **`OPENAI_API_KEY`** at
  https://github.com/dyceelvk/Crushly/settings/secrets/actions
  (create one at https://platform.openai.com/api-keys). The deploy wires it into the
  project and deploys `supabase/functions/verify-identity/index.ts` on every push.
- Optional `AI_MODEL` repo secret overrides the default `gpt-4o-mini`.
- Without an AI key, verification still works — requests queue for human review.

## Gmail confirmation emails

Sign-up confirmation emails are sent through your Gmail via SMTP as **6-digit codes**
(no links to click): the branded template with the Crushly logo lives in
`supabase/email-templates/confirm-signup.html` and is re-applied on every deploy —
edit that file (not the dashboard) to change the email.
Wire it once — it lives in GitHub secrets and re-applies on every deploy:

1. Turn on **2-Step Verification**: https://myaccount.google.com/signinoptions/two-step-verification
2. Create an **App Password** (name it `Crushly SMTP`, choose Mail): https://myaccount.google.com/apppasswords
   → you get a 16-character password. Never paste it in chat — secrets only.
3. Add three secrets at https://github.com/dyceelvk/Crushly/settings/secrets/actions :
   - `SUPABASE_ACCESS_TOKEN` — create one at https://supabase.com/dashboard/account/tokens
   - `GMAIL_SMTP_USER` — your full Gmail address (e.g. `Dyceelvk@gmail.com`)
   - `GMAIL_SMTP_PASS` — the 16-character App Password from step 2
4. Tell the agent "done" — the next deploy wires it (SMTP `smtp.gmail.com:465`, Confirm email ON,
   branded OTP template). The `Wire Gmail confirmation` step reports success and
   points Supabase at whichever site the pipeline targets — currently
   **https://crushlyi.netlify.app** (see *Switch the live site to another Netlify
   account* above). The logo the email embeds is served from
   `<live site>/brand/crushly-mark.png` (repo: `CrushlyApp/public/brand/`).

Prefer clicking by hand? SMTP lives at
https://supabase.com/dashboard/project/yzcssyebozfkmojqqdhc/auth/providers (Email → SMTP Settings)
and the link landing pages at
https://supabase.com/dashboard/project/yzcssyebozfkmojqqdhc/auth/url-configuration
(Site URL = your live site's URL, plus `<live site>/**` as a redirect).

## Quick links (this project)

| Where | Link |
| --- | --- |
| GitHub secrets (all five go here) | https://github.com/dyceelvk/Crushly/settings/secrets/actions |
| GitHub Actions (run/see workflows) | https://github.com/dyceelvk/Crushly/actions |
| Netlify personal access tokens | https://app.netlify.com/user/applications |
| Live site | https://crushlyi.netlify.app (follows the `NETLIFY_SITE_ID` secret) |
| Netlify site (deploys) | https://app.netlify.com/sites/crushlyi/deploys |
| Netlify site configuration (Site ID, git builds) | https://app.netlify.com/sites/crushlyi/configuration |
| E2E auth-journey checks (manual run) | https://github.com/dyceelvk/Crushly/actions/workflows/e2e.yml |
| Supabase SQL editor (fallback setup) | https://supabase.com/dashboard/project/_/sql/new |
| Supabase API keys (URL + anon) | https://supabase.com/dashboard/project/_/settings/api |
| Supabase database (reset DB password) | https://supabase.com/dashboard/project/_/settings/database |
| Supabase Connect dialog (Session pooler URI) | https://supabase.com/dashboard/project/_/connect |
| Supabase auth settings (confirm email, URLs) | https://supabase.com/dashboard/project/_/auth/providers |

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
