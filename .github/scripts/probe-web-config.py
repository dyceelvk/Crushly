"""Read-only check of the public Supabase config in deployed Expo bundles.

Never prints config values, tokens or fetched bodies; only presence and deploy
metadata. This is a build-config check, not an end-to-end auth verification.
"""
import json
import os
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

API = 'https://api.netlify.com/api/v1'
MAX_BYTES = 16 * 1024 * 1024


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            src = dict(attrs).get('src', '')
            if urlparse(src).path.endswith('.js'):
                self.sources.append(src)


def fetch(url, token=None):
    headers = {'User-Agent': 'Crushly-build-config-check'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('response exceeds size limit')
        return data.decode('utf-8')


def presence(bundle, project_url, public_key):
    return bool(project_url and project_url in bundle), bool(public_key and public_key in bundle)


def check(label, base, project_url, public_key):
    parser = Scripts()
    parser.feed(fetch(base))
    if not parser.sources:
        print(f'::warning::{label}: no JavaScript bundle found; config check inconclusive.')
        return False
    url_found = key_found = redirect_found = calls_found = False
    for src in parser.sources:
        url = urljoin(base.rstrip('/') + '/', src)
        # Do not fetch arbitrary external script hosts from the served HTML.
        if urlparse(url).netloc != urlparse(base).netloc:
            continue
        bundle = fetch(url)
        a, b = presence(bundle, project_url, public_key)
        redirect_found |= 'Ready to verify' in bundle and 'Creating a session does not submit your verification' in bundle
        calls_found |= 'register_call_room' in bundle and 'Start voice call' in bundle
        url_found |= a
        key_found |= b
    ok = url_found and key_found
    kind = 'notice' if ok else 'warning'
    print(f'::{kind}::{label}: public Supabase URL={"present" if url_found else "missing"}, '
          f'public key={"present" if key_found else "missing"}; '
          f'{"build config confirmed" if ok else "build config incomplete"} — {base}')
    print(f'::{"notice" if redirect_found else "warning"}::{label}: verification redirect/status fix={"present" if redirect_found else "not present"}.')
    print(f'::{"notice" if calls_found else "warning"}::{label}: native/web call signaling fix={"present" if calls_found else "not present"}.')
    return ok


def main():
    token = os.environ['NETLIFY_AUTH_TOKEN']
    site_id = os.environ['NETLIFY_SITE_ID']
    project_url = os.environ.get('EXPO_PUBLIC_SUPABASE_URL', '').strip().strip('\"\'').rstrip('/')
    public_key = os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY', '').strip().strip('\"\'')
    if not project_url or not public_key:
        raise ValueError('expected public config is missing from GitHub secrets')
    site = json.loads(fetch(f'{API}/sites/{site_id}', token))
    deploys = json.loads(fetch(f'{API}/sites/{site_id}/deploys?per_page=25', token))
    published = site.get('published_deploy') or {}
    print(f'::notice::Published deploy: context={published.get("context", "unknown")}, '
          f'commit={str(published.get("commit_ref") or "unknown")[:7]}, '
          f'state={published.get("state", "unknown")}.')
    targets = [('main site', site.get('ssl_url'))]
    previews = [d for d in deploys if d.get('context') == 'deploy-preview' and d.get('state') == 'ready']
    if previews:
        d = previews[0]
        # Use the immutable deploy URL so config matches the reported commit.
        base = d.get('deploy_ssl_url') or (f'https://{d["id"]}--{site["name"]}.netlify.app' if d.get('id') and site.get('name') else None)
        print(f'::notice::Ready preview: commit={str(d.get("commit_ref") or "unknown")[:7]}.')
        if d.get('commit_ref') != os.environ.get('GITHUB_SHA'):
            print('::warning::Ready preview is not this workflow commit; a fresh preview may still be building.')
        targets.append(('ready deploy preview', base))
        if d.get('review_id') and site.get('name'):
            targets.append(('PR preview alias', f'https://deploy-preview-{d["review_id"]}--{site["name"]}.netlify.app'))
    else:
        print('::warning::No ready deploy preview available to check yet.')
    for label, base in targets:
        if not base:
            print(f'::warning::{label}: URL unavailable.')
            continue
        try:
            check(label, base, project_url, public_key)
        except Exception as error:
            # Exceptions can include URLs/bodies; expose only their class.
            print(f'::warning::{label}: config check inconclusive ({type(error).__name__}).')


if __name__ == '__main__':
    main()
