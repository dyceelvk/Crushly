# Teen isolation — foundation only, NOT deployed or ready for teens

## Product decision
- Teens aged 12–17 may use Holup without Didit. Birthday is self-declared and
  cannot be silently edited by the member. Didit is reserved for optional
  creator verification, not teen signup.
- Adults can deliberately lie about age. No self-declaration design can prove
  that everyone in the teen space is a teen or guarantee no adult contact.
  There must be reporting, active moderation, suspicious-account handling and
  escalation; the app must not advertise an absolute guarantee.
- The existing live adult gate stays on. This experiment cannot enable teen
  onboarding in production.

## Separate data plane
`01_tenant_foundation.sql` is designed for a **new, separate** Supabase
project with independent authentication, signing keys, database, API endpoint,
storage, and secrets. It refuses to install without the operator's explicit
`holup.instance_type=teen-isolated` setting and refuses if adult `public.profiles`
exists. Never install it in the adult project; a separate schema by itself is
not a sufficient boundary. No project has been created. Infrastructure may
have recurring costs and requires an approved provisioning plan.

It establishes tenant-only accounts, immutable member-declared DOB, minimal
profiles, one-way Keep and mutual Close Ones, blocks, and consent state. Every
social RPC checks eligibility and consent from the database; at age 18, or on
suspension/withdrawal, later calls fail closed. No adult profiles are queried or
imported. Adults pretending to be under 18 remain a real risk. Only a trusted
backend can record guardian consent; children cannot approve it themselves.
Consent status is **not** evidence that guardian identity/relationship has been
verified. Do not turn it on until an appropriate consent/withdrawal workflow
and legal review are available for each jurisdiction.

No dating, Add Up, romantic matching, messages, posts, uploads, links, search
across adult accounts, creator badges, or Realtime have been added here. The
prototype deliberately leaves these unavailable instead of faking safety. The
teen app/client, account creation, recovery/age-correction procedure, consent,
moderation/reporting, age-appropriate content, abuse protection, storage,
signing/session isolation, retirement at 18, privacy notices, observability,
and server-side enforcement against every direct API path remain unfinished.
The existing app points at the adult project and must not use an adult token
for a teen account. No preexisting profile/relationships migrate automatically.

There are no tests or security review for this foundation yet; it is not a
production migration. The user asked not to spend time on tests, so none were
run in this step. Full adversarial, concurrency and two-project end-to-end
verification is a release prerequisite, particularly consent withdrawal,
turning 18, forged JWTs, direct database access, cached sessions, blocks,
media, adult/teen search and all external content/link paths.

`CrushlyApp/src/teen/isolatedClient.ts` constructs an unwired teen client only
for a different Supabase project and a publishable key, with its own session
namespace and no implicit interception of the adult app's auth links. It does
not provision a project, implement signup/link routing, or stop a person from
creating a second account with a false birthday. The app still has no teen entry
point; none of this code is live.

`02_safety_reporting.sql` adds a private report record (including an
adult-impostor reason), a rate limit, and an optional atomic block. It is not a
moderation dashboard or evidence that reports will be reviewed. There is no
staff-facing queue/service, escalation/on-call process or client UI yet; those
are required before opening the teen service.

`CrushlyApp/src/teen/service.ts` is an unwired typed facade for those teen-only
RPCs. It creates its own isolated client rather than accepting the adult
client. It has no navigation, login/deep-link flow, consent UI or teen content.
