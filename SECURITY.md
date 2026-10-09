# Crushly security boundary and launch blockers

## Assume the clients are public

Anyone can inspect a web bundle, unpack an APK, modify a client, or call an API
without using our UI. Do not rely on minification, obfuscation, certificate
pinning or hiding the Supabase project URL to authorize access. Never encrypt
a server secret with a key shipped alongside it and call it protected.

Only the Supabase URL and publishable/legacy `anon` client key belong in the
client. The public key identifies the project, not an administrator. Member
JWTs authorize sessions. RLS, RPC checks and edge-function authorization must
hold even for a deliberately modified client. Native sessions use SecureStore;
a rooted/compromised phone can still expose the current member's session.

Didit, database, service-role, SMTP, AI, deployment and TURN shared-secret
credentials stay in GitHub Secrets/Supabase server environments. Keep production
secrets out of build-wide environment variables and logs. Client builds reject
unknown public variables and non-public Supabase key types. The APK leakage
guard checks known configured credential values/encodings after compilation;
it is not a full audit and cannot recognize every unknown or transformed secret.

## Existing verified controls, not a blanket security guarantee

- RLS covers member data; cross-member RPCs derive identity from the signed-in
  session. Database smoke tests exercise privacy and forged-verification denial.
- Only service-role functions write provider verification decisions. Didit
  callbacks verify HMAC signatures and freshness; client result parameters
  never approve a member.
- Authenticated private call rooms are scoped to two conversation members.
- Native auth sessions are stored in OS secure storage, not embedded in APKs.
- Production credentials must be rotated if actually exposed. Never send them
  in chat or print them while investigating; rotating the public anon key does
  not substitute for fixing broken permissions.

## Must address before a public production launch

1. **Private release signing.** Current APKs use Expo's PUBLIC debug key.
   Anyone can obtain that key; it is not a trusted production identity. Create
   a private release/upload key using EAS credentials or Play App Signing and
   store its backup/passwords securely, never in Git. Verify the certificate
   for every build, keep it stable across upgrades, and test upgrades. Do not
   silently rotate signing identities for existing installs.
2. **Private chat media.** `media` is currently a PUBLIC bucket for profile,
   Moment AND chat attachments. Possessing a URL allows a fetch without the
   conversation authorization check. Move chat photos/voice/video to a private
   bucket with conversation-participant RLS, short-lived signed URLs issued
   after permission checks, and an explicit migration/revocation plan for old
   public files. Merely hiding a URL is not access control. Public profile
   images and private verification documents must remain separate.
3. **Server-side abuse protection.** Extend persistent rate limits and quotas
   beyond call-room creation to verification creation, messages, uploads and
   discovery. Add spending caps/alerts and safe audit logs. Obfuscation will
   not stop authenticated bots or stolen-session abuse.
4. **Full authorization audit.** Exercise anon/authenticated/service-role grants,
   SECURITY DEFINER entrypoints, profile writes, blocking/unmatching, storage,
   and privilege escalation with adversarial tests, then independently review.
5. **Release infrastructure.** Pin/review third-party Actions and dependencies,
   use least-privilege secrets, protect release approvals, monitor vulnerabilities,
   and publish checksums/direct APKs under unique immutable version names.

The Git repository being public does not itself leak properly stored server
secrets. Treat any real credentials ever committed—even later deleted—as exposed
and rotate them. Do not claim the current app is production-secure based only
on a successful build, emulator test, or negative secret-string scan.
