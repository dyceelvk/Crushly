# Crushly e2e — auth journeys on the real site

Playwright checks for the journeys a member can't live without, run against a
**deployed** Crushly (or a local dev server):

1. **Sign-up with the emailed 6-digit code** — the fast path
2. **Sign-up with the emailed one-tap link** — the phone path
3. **Password reset with the emailed 6-digit code** — the "I'm locked out" path

Codes and links are minted with the Supabase **Admin API**, so no mailbox
access is needed; every e2e member is deleted again afterwards.

`@playwright/test` is a **dev-only** dependency — it is never bundled into the
app; only the browser is downloaded when you run the suite.

## Run it in GitHub Actions (against the live site)

1. Add one secret: **Settings → Secrets and variables → Actions → New repository secret**
   https://github.com/dyceelvk/Crushly/settings/secrets/actions
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: your project's **service_role** key —
     https://supabase.com/dashboard/project/yzcssyebozfkmojqqdhc/settings/api
     (⚠️ powerful key: only ever put it in GitHub Secrets — never in the repo,
     never in chat. Rotate it if it leaks.)
   - `EXPO_PUBLIC_SUPABASE_URL` is already a secret.
2. Open **Actions → "E2E (live site)" → Run workflow**
   https://github.com/dyceelvk/Crushly/actions/workflows/e2e.yml
   (pick the site if you're not testing the default https://mencrushly.netlify.app)

> The workflow resolves the live site URL from the `NETLIFY_SITE_ID` secret
> automatically (currently https://crushlyi.netlify.app) — the `base_url` input
> is only a fallback. Override it to test a deploy preview instead.

## Run it locally

```bash
cd CrushlyApp
npm start                                    # serves the app on :8081 (or use the live site)
export E2E_BASE_URL=http://localhost:8081   # or https://mencrushly.netlify.app
export EXPO_PUBLIC_SUPABASE_URL=https://yzcssyebozfkmojqqdhc.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=…           # from your own machine's env — never commit it
npm run e2e
```

## What "green" proves

- Both sign-up paths (code **and** link) really sign a member in — the
  confirmation email template, the OTP verify call, and the deep-link session
  pickup all work end to end.
- The password-reset journey works: request → code → new password → signed in.
- New members land on onboarding with a bootstrapped profile.
