#!/usr/bin/env python3
"""Independent scheduled check of the verification-image cleanup pipeline.

Prints only aggregate health flags, never case IDs, paths, or image data. SMTP
uses repository secrets and sends only operational status to the support address.
This check cannot detect a GitHub Actions-wide outage by itself.
"""
import os
import smtplib
import ssl
import subprocess
import sys
from email.message import EmailMessage

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


def email(flags, test=False):
    user = os.environ.get('GMAIL_SMTP_USER', '')
    password = os.environ.get('GMAIL_SMTP_PASS', '')
    if not user or not password:
        raise RuntimeError('SMTP credentials are not configured')
    msg = EmailMessage()
    msg['Subject'] = 'Holup verification image cleanup: ' + ('test alert' if test else 'attention required')
    msg['From'] = user
    msg['To'] = 'rielosInc@gmail.com'
    msg.set_content(('This is a test of the Holup verification image cleanup alert. No action is required.' if test else
                     'The independent cleanup check needs attention. Health flags: ' + ', '.join(flags) +
                     '. No personal data or image paths are included. Check the latest verification retention monitor and cleanup runs at https://github.com/dyceelvk/Crushly/actions.'))
    try:
        with smtplib.SMTP('smtp.gmail.com', 587, timeout=20) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login(user, password)
            refused = smtp.send_message(msg)
            if refused:
                raise RuntimeError('SMTP did not accept the alert')
    except smtplib.SMTPAuthenticationError:
        raise RuntimeError('SMTP authentication failed') from None
    except smtplib.SMTPResponseException as e:
        raise RuntimeError('SMTP alert rejected (response code %s)' % e.smtp_code) from None
    except (OSError, smtplib.SMTPException, ssl.SSLError):
        # Avoid printing provider exceptions: they can contain sensitive data.
        raise RuntimeError('SMTP alert could not be sent') from None


def main():
    if os.environ.get('TEST_ALERT') == 'true':
        try:
            email([], test=True)
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            return 1
        print('Test alert accepted by SMTP; inbox delivery must be checked separately.')
        return 0
    flags = health()
    if not flags:
        print('Verification image cleanup health check passed.')
        return 0
    print('Verification image cleanup health check failed: ' + ', '.join(flags), file=sys.stderr)
    try:
        email(flags)
        print('Alert accepted by SMTP; inbox delivery is not guaranteed.')
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
