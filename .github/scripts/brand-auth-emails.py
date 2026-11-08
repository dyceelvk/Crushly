import json, os, urllib.request, urllib.error

ref = 'yzcssyebozfkmojqqdhc'
url = f'https://api.supabase.com/v1/projects/{ref}/config/auth'
headers = {'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json'}
keys = ['mailer_subjects_confirmation', 'mailer_subjects_recovery', 'mailer_templates_confirmation_content', 'mailer_templates_recovery_content', 'smtp_sender_name']
def call(method, body=None):
    req = urllib.request.Request(url, headers=headers, method=method, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Supabase auth configuration request failed: HTTP {e.code}') from None
before = call('GET')
patch = {}
for k in keys:
    old = before.get(k)
    if not isinstance(old, str) or not old:
        raise RuntimeError('Missing expected configuration field: ' + k)
    new = 'Hollop' if k == 'smtp_sender_name' else old.replace('Crushly', 'Hollop').replace('CRUSHLY', 'HOLLOP')
    if k.startswith('mailer_templates_'):
        for marker in ['{{ .Token }}', '{{ .ConfirmationURL }}']:
            if marker not in old or old.count(marker) != new.count(marker):
                raise RuntimeError('Verification marker missing or changed: ' + k)
    patch[k] = new
call('PATCH', patch)
after = call('GET')
for k in keys:
    if after.get(k) != patch[k]:
        raise RuntimeError('Updated value did not verify: ' + k)
for k in ['site_url', 'uri_allow_list', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_admin_email', 'external_email_enabled', 'mailer_autoconfirm']:
    if after.get(k) != before.get(k):
        raise RuntimeError('Unexpected change to auth delivery setting: ' + k)
print('Updated and verified confirmation/recovery subjects, email templates and sender display name. Verification codes, links, sender address and SMTP settings retained.')
