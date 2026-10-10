"""Check a build for server credentials, and never print them.

Run only AFTER Gradle or the web export, so no server value can be inlined by
Expo afterwards. Works on an APK (a zip) or on a directory of build output, so
the same check covers the phone build and the website.

Two kinds of finding:

  - Known values. Every credential the project holds is passed in the
    environment; if any of them appears in the build, it is a leak. A
    credential that is not configured is reported as unexamined, never as
    safe — silence is not evidence.
  - Known shapes. A credential we have not thought to configure still has a
    shape — `sb_secret_…`, a Groq `gsk_…`, an AWS key, a service-role JWT, a
    private key block. This catches the mistake we did not anticipate, which
    is the only kind that ever actually ships.

What is deliberately NOT flagged: the Supabase project URL and its
publishable key. Those are designed to sit in a client, and the whole of the
protection is Row Level Security behind them — see supabase/tests/smoke.sql.
"""
import base64
import json
import os
import pathlib
import re
import sys
import urllib.parse
import zipfile

# An absent optional secret is explicitly reported as unexamined, not 'safe'.
names = ('SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
         'SUPABASE_SECRET_KEY', 'DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET',
         'TURN_SHARED_SECRET', 'NETLIFY_AUTH_TOKEN', 'GMAIL_SMTP_PASS',
         'OPENAI_API_KEY', 'GROQ_API_KEY', 'GROQ_SAFEGUARD_KEY',
         'FCM_SERVER_KEY', 'APNS_AUTH_KEY', 'B2_APPLICATION_KEY',
         'CLOUDFLARE_API_TOKEN')

# Shapes that should never appear in anything handed to a member's device.
shapes = (
    ('Supabase secret key', re.compile(rb'sb_secret_[A-Za-z0-9_-]{16,}')),
    ('Groq/OpenAI style key', re.compile(rb'\b(?:gsk|sk)-[A-Za-z0-9]{24,}')),
    ('AWS access key id', re.compile(rb'\bAKIA[0-9A-Z]{16}\b')),
    ('GitHub token', re.compile(rb'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b')),
    ('GitHub fine-grained token', re.compile(rb'\bgithub_pat_[A-Za-z0-9_]{20,}\b')),
    ('Slack token', re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{10,}')),
    ('private key block', re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
)

patterns = []
checked = []
missing = []
for name in names:
    value = os.environ.get(name, '')
    if not value:
        missing.append(name)
        continue
    checked.append(name)
    values = [value, json.dumps(value)[1:-1], urllib.parse.quote(value, safe=''),
              base64.b64encode(value.encode()).decode()]
    # A URI's password may be compiled separately from the URI; check both.
    if name == 'SUPABASE_DB_URL':
        password = urllib.parse.urlparse(value).password
        if password and len(password) >= 8:
            values.extend([password, urllib.parse.unquote(password)])
    patterns.extend(v.encode() for v in values if len(v) >= 8)


def has_service_role_token(content: bytes) -> bool:
    """True when a JWT in these bytes claims the service role.

    The app ships a Supabase publishable key, which is a JWT as well, so the
    shape of a token proves nothing. What matters is what the token claims:
    only a service-role token steps around Row Level Security.
    """
    for match in re.finditer(rb'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', content):
        payload = match.group(0).split(b'.')[1]
        payload += b'=' * (-len(payload) % 4)
        try:
            decoded = base64.urlsafe_b64decode(payload)
        except Exception:  # noqa: BLE001 - not a token we can read, not a finding
            continue
        if b'"role"' in decoded and b'service_role' in decoded:
            return True
    return False


def blobs(target: pathlib.Path):
    """Yields (name, bytes) for every file in an APK or a build directory."""
    if target.is_dir():
        for path in target.rglob('*'):
            if path.is_file():
                yield path.name, path.read_bytes()
        return
    with zipfile.ZipFile(target) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            yield entry.filename, archive.read(entry)


target = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None

findings = []
scanned = 0
for name, content in blobs(target):
    scanned += 1
    for pattern in patterns:
        if pattern in content:
            findings.append(f'a configured credential value appears in {name}')
            break
    else:
        for label, shape in shapes:
            if shape.search(content):
                findings.append(f'something shaped like a {label} appears in {name}')
                break
        else:
            if has_service_role_token(content):
                findings.append(f'a service-role token appears in {name}')
    if findings:
        break

if findings:
    print('::error::' + findings[0] + '. Publication blocked; rotate affected credentials outside chat.')
    sys.exit(1)

report = (f'Known server credential leakage check: passed ({len(checked)} configured credential types compared, '
          f'{len(shapes)} shapes, {scanned} files scanned).\n'
          'No credential values printed or included in this report.\n'
          'Client config is intentionally public (Supabase URL and publishable key); RLS is the boundary.\n'
          'Not a full security audit; unknown values and device compromise are outside this check.\n'
          'Unconfigured comparison types: ' + ', '.join(missing) + '\n')
if report_path:
    report_path.write_text(report)
print(f'::notice::Secret leakage check passed ({len(checked)} configured credentials, {len(shapes)} shapes, {scanned} files); no values logged.')
