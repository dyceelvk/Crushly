"""Read-only production preflight/verification. Runs in Actions with stored secrets.
Only public URLs, commit revisions and check outcomes are logged, never credentials
or response bodies. Does not create users, upload media or modify production data.
"""
import argparse
import json
import os
import subprocess
import time
import urllib.request
from urllib.parse import urlparse


def request_json(url, token=None):
    headers = {'User-Agent': 'Crushly-release-check', 'Cache-Control': 'no-cache'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def database_check(sql):
    result = subprocess.run(
        ['psql', os.environ['SUPABASE_DB_URL'], '-X', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
        env={**os.environ, 'PGCONNECT_TIMEOUT': '15'}, capture_output=True, text=True, timeout=45,
    )
    if result.returncode != 0 or result.stdout.strip() != 't':
        raise RuntimeError('Database verification failed (details withheld to protect connection credentials)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['preflight', 'verify'])
    args = parser.parse_args()
    required = ['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID', 'SUPABASE_DB_URL']
    if args.phase == 'preflight':
        required += ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'EXPO_PUBLIC_SUPABASE_URL',
                     'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ACCESS_TOKEN',
                     'B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET']
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError('Missing repository configuration: ' + ', '.join(missing))
    site = request_json('https://api.netlify.com/api/v1/sites/' + os.environ['NETLIFY_SITE_ID'], os.environ['NETLIFY_AUTH_TOKEN'])
    base = site.get('ssl_url')
    if not base or urlparse(base).scheme != 'https':
        raise RuntimeError('Netlify site has no HTTPS production URL')
    print(f'::notice::Netlify target verified: {base}', flush=True)
    if args.phase == 'preflight':
        cf = request_json('https://api.cloudflare.com/client/v4/accounts/' + os.environ['CLOUDFLARE_ACCOUNT_ID'] + '/workers/scripts/crushly-media/settings', os.environ['CLOUDFLARE_API_TOKEN'])
        if not cf.get('success'):
            raise RuntimeError('Cloudflare Worker access check failed')
        database_check("select to_regclass('public.profiles') is not null and to_regclass('supabase_migrations.schema_migrations') is not null;")
        print('::notice::PREFLIGHT PASSED: Netlify site, Cloudflare Worker access, Supabase connection and required configuration verified.', flush=True)
        return

    sha = os.environ['GITHUB_SHA']
    worker = 'https://crushly-media.dyceelvk.workers.dev'
    # CDN publication can take a short time. Never claim success for an old build.
    for attempt in range(12):
        try:
            web_release = request_json(base.rstrip('/') + '/deployment.json?release=' + sha)
            if web_release.get('revision') == sha:
                break
        except Exception:
            pass
        if attempt == 11:
            raise RuntimeError('Netlify production is not serving the requested commit')
        time.sleep(10)
    worker_release = request_json(worker + '/deployment?release=' + sha)
    if worker_release.get('revision') != sha:
        raise RuntimeError('Cloudflare Worker is not serving the requested commit')
    health = request_json(worker + '/health')
    if not health.get('b2') or not health.get('bucketPrivate'):
        raise RuntimeError('Cloudflare media storage health check failed')
    database_check("""select
      (select count(*) = 2 from supabase_migrations.schema_migrations where version in ('20261013000026','20261013000027'))
      and exists (select 1 from storage.buckets where id='media' and not public)
      and to_regclass('public.media_upload_reservations') is not null
      and exists (select 1 from pg_trigger where tgname='guard_managed_username' and not tgisinternal)
      and not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('media_public_read','media_insert_own'));
    """)
    print(f'::notice::NETLIFY VERIFIED: {base} serves revision {sha}.', flush=True)
    print(f'::notice::CLOUDFLARE VERIFIED: {worker} serves revision {sha}; B2 reachable and private.', flush=True)
    print('::notice::SUPABASE VERIFIED: migrations 026 and 027 recorded, legacy media private, username guard and upload ledger installed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # HTTP exceptions may contain credential-bearing URLs; log class only.
        if isinstance(error, RuntimeError):
            print(f'::error::{error}', flush=True)
        else:
            print(f'::error::Release check failed ({type(error).__name__}); no sensitive response details logged.', flush=True)
        raise SystemExit(1)
