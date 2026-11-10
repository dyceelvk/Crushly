#!/usr/bin/env python3
"""Independent scheduled check of the verification-image cleanup pipeline.

Does not publish case IDs, paths, image data, or detailed health status.
Creates a generic assigned GitHub issue on failure, with deduplication. GitHub
notification delivery is account-dependent and is not guaranteed. This check
cannot detect a GitHub Actions-wide outage by itself.
"""
import os
import json
import urllib.request
import urllib.error
import subprocess
import sys

# Times are milliseconds, matching public.now_ms(). Leave a 45-minute grace
# after each deadline to account for the 15-minute cleanup schedule and delays.
QUERY = r"""
select concat_ws(',',
 case when h.last_attempt_at is null or h.last_attempt_at < public.now_ms()-2700000 then 'cleanup_stale' end,
 case when h.last_failed > 0 then 'cleanup_reported_failure' end,
 case when exists(select 1 from public.manual_verification_file_deletions q where q.queued_at < now()-interval '45 minutes') then 'deletion_queue_stale' end,
 case when exists(select 1 from public.manual_verification_files f join public.manual_verification_cases c on c.id=f.case_id
   where f.state <> 'deleted' and
   ((c.status <> 'open' and (c.decided_at is null or c.decided_at < public.now_ms()-2592000000-2700000))
    or (f.state='reserved' and f.created_at < public.now_ms()-86400000-2700000))) then 'expiry_backlog' end)
from public.manual_evidence_cleanup_health_state h where h.singleton;
"""
FLAGS = {'cleanup_stale', 'cleanup_reported_failure', 'deletion_queue_stale', 'expiry_backlog'}


def health():
    db = os.environ.get('SUPABASE_DB_URL', '')
    if not db:
        return ['monitor_database_unavailable']
    try:
        p = subprocess.run(['psql', db, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-c', QUERY],
                           capture_output=True, text=True, timeout=35,
                           env={**os.environ, 'PGCONNECT_TIMEOUT': '10'})
        if p.returncode != 0:
            return ['monitor_database_unavailable']
        # A missing singleton is itself an error, not a healthy blank line.
        raw = p.stdout.strip()
        if not p.stdout or '\n' in raw:
            return ['monitor_invalid_response']
        flags = raw.split(',') if raw else []
        return flags if all(x in FLAGS for x in flags) else ['monitor_invalid_response']
    except (OSError, subprocess.TimeoutExpired):
        return ['monitor_database_unavailable']


def api(method, path, payload=None):
    token = os.environ.get('GH_TOKEN', '')
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if not token or repo != 'dyceelvk/Crushly':
        raise RuntimeError('Maintenance notification unavailable')
    req = urllib.request.Request('https://api.github.com/repos/' + repo + path,
        method=method, headers={'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json', 'User-Agent': 'holUpp-maintenance-monitor',
        'Content-Type': 'application/json'},
        data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.load(res)
    except (OSError, ValueError):
        raise RuntimeError('Maintenance notification unavailable') from None


def issue(test=False):
    title = 'holUpp maintenance notification test' if test else 'holUpp maintenance check requires attention'
    # No health flags or member data go into the public issue.
    if not test:
        for page in range(1, 21):
            items = api('GET', '/issues?state=open&per_page=100&page=' + str(page))
            if not isinstance(items, list):
                raise RuntimeError('Maintenance notification unavailable')
            if any(i.get('title') == title and i.get('user', {}).get('login') == 'github-actions[bot]' for i in items):
                print('A maintenance notification is already open.')
                return
            if len(items) < 100:
                break
        else:
            raise RuntimeError('Maintenance notification search exceeded its limit')
    created = api('POST', '/issues', {'title': title,
        'body': ('Notification test; no action is required.' if test else
                 'Please review the recent maintenance checks in Actions. No member information is included.'),
        'assignees': ['dyceelvk']})
    number = created.get('number') if isinstance(created, dict) else None
    if not isinstance(number, int) or number < 1:
        raise RuntimeError('Maintenance notification unavailable')
    if test:
        api('PATCH', '/issues/' + str(number), {'state': 'closed'})
        print('Test issue created and closed; notification delivery is not guaranteed.')
    else:
        print('A maintenance issue was created and assigned to the repository owner.')


def main():
    if os.environ.get('TEST_ALERT') == 'true':
        try:
            issue(test=True)
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            return 1
        return 0
    flags = health()
    if not flags:
        print('Maintenance check passed.')
        return 0
    print('Maintenance check failed.', file=sys.stderr)
    try:
        issue()
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
