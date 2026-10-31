# Auth email: why no code and no link arrived — 2026-10-31

Reported: signing up with a Gmail address produced no confirmation code and no
link, and nothing appeared in spam either.

Three faults, checked in this order. Two were in the app, one was in the Supabase
project's own configuration. None of them was Gmail quietly binning the mail.

---

## 1. The address already had a confirmed account — and the app said "check your inbox"

**This is the one that matches the report.** `dyceelvk@gmail.com` was created on
**2026-10-08** and is already confirmed:

```sql
select email, email_confirmed_at is not null as confirmed, created_at
from auth.users order by created_at desc;
--  dyceelvk@gmail.com | confirmed | 2026-10-08 13:34:30
```

When an address already has a confirmed account, GoTrue does **not** return an
error from `signUp`. It answers `200` with a user record that has **zero
identities** and sends no email at all — deliberately, so the endpoint cannot be
used to find out who has an account. Reproduced directly against the live
project:

```
POST /auth/v1/signup {"email":"dyceelvk@gmail.com","password":"..."}
200 {"identities":[], "email":"dyceelvk@gmail.com", ...}
```

`identities: []` is the tell. The app treated *"no session"* as *"email sent"* and
showed **"Check your inbox — we sent a code and a link"**. So the screen promised
an email that Supabase had chosen not to send. That is indistinguishable, from
the outside, from a broken mail server.

**Fixed in `d464a0a`.** `signUpOutcome()` in `lib/auth.ts` separates the three
real cases — `signed-in`, `confirm-email`, `already-registered` — and the UI now
says *"That email already has a Space. Sign in instead — or use Forgot password
for a reset code."* Four assertions in `lib/auth.test.ts`.

## 2. Every link in every auth email pointed at the old Netlify deploy

The project's auth settings had:

| Setting | Was | Now |
|---|---|---|
| `site_url` | `https://wecrushly.netlify.app` | `https://mecrushly.vercel.app` |
| `uri_allow_list` | netlify + `localhost:8081` | vercel + `*.vercel.app` + netlify + localhost |

Two consequences. Any confirmation or recovery **link** was built from
`site_url`, so tapping "Confirm my email" took the member to a different
deployment from the app they signed up in. And `sendPasswordReset()` passes the
current browser origin as `redirect_to`; an origin that is not on the allow list
is not honoured, so production reset requests fell back to the Netlify URL too.

**Fixed in two places:** `site_url` and `uri_allow_list` in the Supabase project
(updated live), and the app now passes `emailRedirectTo` explicitly on
`signUp()` and `resendConfirmation()` so the link follows wherever the member
actually is (`webOrigin()` in `api/service.ts`).

## 3. The free plan sends two auth emails an hour

`rate_limit_email_sent` is **2**. Three signup attempts in an hour and the third
is dropped with `429`, whether or not the first two were delivered. The app now
surfaces that as *"Too many emails just now. Give it an hour and try again — or
sign in if you already have a Space."* instead of a generic failure.

This is a project setting, not something code can raise. With custom SMTP the
cap can go to 30/hour on the same plan.

---

## What is *not* broken: the mail path itself

Worth recording, because it was my first suspicion and it was wrong. Supabase is
sending through `smtp.gmail.com:465` as `Dyceelvk@gmail.com`. A resend for the
one genuinely stuck account below returned **`200 {}`** — GoTrue returns `500
"Error sending …"` when the SMTP hand-off fails, so the credential was accepted
and the message left.

For the avoidance of doubt: Gmail **does** refuse SMTP `AUTH` from datacenter
IPs, and it refused it from this sandbox (the EHLO capability list came back
without `AUTH` at all, on both 465 and 587). It has not refused from Supabase so
far. That is a question of *when*, not *if* — see the recommendation.

## One account is genuinely stuck

```
chidubemfranklin2007@gmail.com | UNCONFIRMED | created 2026-10-28 12:56
                               | confirmation_sent_at 2026-10-28 12:57
                               | last_sign_in_at: never
```

Signed up, got as far as a send attempt, never confirmed, never came back. If
that is the same person who reported the problem, the new config plus a resend
from the app's own "Resend code" button should get them in.

## Verified on production, after the fix

The live site, with `dyceelvk@gmail.com` and the form filled in, now answers:

> **That email already has a Space.** Sign in instead — or use Forgot password
> for a reset code.

`evidence/live-auth-fix.png` — captured from `https://mecrushly.vercel.app`,
not from a local build. Before `d464a0a` that same submission produced "Check
your inbox — we sent a code and a link".

## Google sign-in: switched on and verified as far as a machine can

Enabled in the Supabase project (Authentication → Providers → Google) with the
client `234301766260-….apps.googleusercontent.com`. Checked in this order:

| Check | Result |
|---|---|
| `GET /auth/v1/settings` | `external.google: true` |
| `GET /auth/v1/authorize?provider=google&redirect_to=…` | `302` to `accounts.google.com`, `client_id` matching, `redirect_uri=https://yzcssyebozfkmojqqdhc.supabase.co/auth/v1/callback`, `scope=email profile` |
| Google's own response to that URL | `302` into `/v3/signin/identifier` — the client is accepted; no `invalid_client`, no `redirect_uri_mismatch` |
| `on_auth_user_created` trigger on `auth.users` | present and pointing at `handle_new_user` |

That last row is the one that would have broken a first Google sign-in: an OAuth
user arrives with no profile row, and `handle_new_user` is what creates the
profile, preferences, privacy and notification rows. It is live, so a new Google
member lands in onboarding exactly like an email member.

**Not machine-verifiable:** the return leg — Google → `/auth/v1/callback` →
app session — needs a human to authenticate with a Google password. The app
already handles the return (`detectSessionInUrl`, implicit flow, `adoptSession`).

## State as of now: autoconfirm is ON

`mailer_autoconfirm: true`. Deliberate, temporary, and reversible with one call.

Verified against the live project with a throwaway address:

| Check | Result |
|---|---|
| `POST /auth/v1/signup` (new address) | `200`, **`access_token` returned** — the member is signed in on the spot |
| `email_confirmed_at` | set immediately |
| `handle_new_user` trigger | profile, preferences and privacy rows created (profile 31) |
| Cleanup | probe users and their profiles deleted; 7 real users ↔ 7 profiles, no orphans |

**What this means:** sign-up no longer involves email at all, so the two-per-hour
ceiling and the Gmail SMTP path cannot break it. A new member goes from "Create
account" straight into onboarding.

**What it costs:** addresses are unverified. Someone can register an address that
is not theirs. That is acceptable while the app is being built and shown to
people you know, and it is not acceptable once strangers arrive.

**What still uses email:** password reset (`/auth/v1/recover`) and email change.
Those still go through Gmail SMTP and the rate limit. Turn autoconfirm off — same
one call — the moment a real sender is in place.

## Recommendation, in order

1. **Move off Gmail SMTP** to a transactional provider with a verified domain
   (Resend, Brevo, Postmark). Gmail SMTP is capped at ~500/day, rewrites `From:`
   to the Gmail address, cannot be DKIM-signed as `crushly`, and is exactly the
   kind of mail Gmail's own filters treat with suspicion — which is how a
   legitimate signup email ends up in spam or nowhere. This is the actual answer
   to "don't let it be on spam": authenticate the domain, don't borrow Gmail's.
2. Raise `rate_limit_email_sent` once custom SMTP is in place.
3. Turn on **email confirmation** for real, once mail is reliable — right now the
   only way in for a new member is an email that may not arrive, so consider
   `mailer_autoconfirm` off + a verified provider, or autoconfirm on as a
   deliberate pre-launch trade.
