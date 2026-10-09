"""Check compiled APK contents for known deployment secret values, never print them.
Run only AFTER Gradle/export, so server values cannot be inlined by Expo.
"""
import base64
import json
import os
import pathlib
import sys
import urllib.parse
import zipfile

# An absent optional secret is explicitly reported as unexamined, not 'safe'.
names = ('SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
         'DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'TURN_SHARED_SECRET',
         'NETLIFY_AUTH_TOKEN', 'GMAIL_SMTP_PASS', 'OPENAI_API_KEY')
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
found = False
with zipfile.ZipFile(sys.argv[1]) as apk:
    for entry in apk.infolist():
        if entry.is_dir():
            continue
        content = apk.read(entry)
        if any(pattern in content for pattern in patterns):
            found = True
            break
if found:
    print('::error::A deployment credential was found in the APK. Publication blocked; rotate affected credentials outside chat.')
    sys.exit(1)
report = (f'Known server credential leakage check: passed ({len(checked)} configured credential types compared).\n'
          'No credential values printed or included in this report.\n'
          'APK client config is intentionally public (Supabase URL and publishable/anon key).\n'
          'Not a full security audit; unknown values and device compromise are outside this check.\n'
          'Unconfigured comparison types: ' + ', '.join(missing) + '\n')
pathlib.Path(sys.argv[2]).write_text(report)
print(f'::notice::APK known-secret leakage check passed ({len(checked)} configured credential types); no values logged.')
