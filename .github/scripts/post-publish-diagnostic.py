"""Exercise the production publish path using only the dedicated walk account.

Creates at most a private-to-connections test post, then deletes the post and
uploaded object. No real user's post is touched; no token or credentials printed.
The large object is synthetic and is never published as a post.
"""
import json
import os
import sys
import urllib.error
import urllib.request

base = os.environ['SUPABASE_URL'].rstrip('/')
key = os.environ['SUPABASE_ANON_KEY']
worker = 'https://crushly-media.dyceelvk.workers.dev'

def request(url, method='GET', data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def decode(raw):
    try: return json.loads(raw)
    except Exception: return {}

def main():
    login = json.dumps({'email': os.environ['WALK_EMAIL'], 'password': os.environ['WALK_PASSWORD']}).encode()
    code, raw = request(base + '/auth/v1/token?grant_type=password', 'POST', login,
                        {'apikey': key, 'Content-Type': 'application/json'})
    token = decode(raw).get('access_token')
    if code != 200 or not token: raise RuntimeError('walk account sign-in failed (HTTP %s)' % code)
    headers = {'apikey': key, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    wh = {'User-Agent': 'Crushly-Publish-Diagnostic/1.0', 'Authorization': 'Bearer ' + token, 'Content-Type': 'video/mp4', 'X-Media-Kind': 'posts'}
    def rpc(name, payload):
        return request(base + '/rest/v1/rpc/' + name, 'POST', json.dumps(payload).encode(), headers)
    def upload(size):
        return request(worker + '/m', 'POST', b'\0' * size, wh)
    def delete_object(url):
        return request(url, 'DELETE', headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'Crushly-Publish-Diagnostic/1.0'})[0]
    failures = []
    orphan_path = os.environ.get('ORPHAN_PATH', '')
    if orphan_path:
        if not orphan_path.startswith('posts/') or '..' in orphan_path:
            raise RuntimeError('invalid cleanup path')
        rc = delete_object(worker + '/m/' + orphan_path)
        print('Previous test object cleanup: HTTP', rc)
        if rc not in (200, 204, 404): failures.append('previous test object cleanup')
    code, raw = rpc('create_post_with_options', {'p_body': 'Automated text-only publish test', 'p_media_url': None,
        'p_audience': 'connections', 'p_circle_id': None, 'p_edit': None, 'p_comments_enabled': True})
    text_id = decode(raw).get('id')
    print('Text-only post RPC: HTTP', code, 'created:', bool(text_id))
    if text_id:
        rc, _ = rpc('delete_post', {'p_post_id': text_id})
        if rc != 200: failures.append('text post cleanup')
    else:
        print('Text post error:', str(decode(raw).get('message', ''))[:300])
        failures.append('text post RPC')
    video = open('/tmp/crushly-publish-test.mp4', 'rb').read()
    code, raw = request(worker + '/m', 'POST', video, wh)
    print('Small media upload: HTTP', code, 'error:', str(decode(raw).get('error', raw[:250].decode('utf-8', 'replace') if code != 201 else ''))[:300])
    url = decode(raw).get('url')
    if code != 201 or not url:
        failures.append('small upload')
    else:
        post_id = None
        try:
            code, raw = rpc('create_post_with_options', {'p_body': 'Automated publish test', 'p_media_url': url,
                'p_audience': 'connections', 'p_circle_id': None, 'p_edit': None, 'p_comments_enabled': False})
            post_id = decode(raw).get('id')
            print('Authenticated video post RPC: HTTP', code, 'created:', bool(post_id))
            if code != 200 or not post_id:
                print('Post error:', str(decode(raw).get('message', ''))[:300])
                failures.append('post RPC')
            else:
                if rpc('post_comment_settings', {'p_post_id': post_id}) != (200, b'false'):
                    failures.append('comment option readback')
                rc, content = request(url, headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'Crushly-Publish-Diagnostic/1.0'})
                print('Published media read: HTTP', rc, 'bytes:', len(content))
                if rc != 200 or content != video: failures.append('published media readback')
        finally:
            if post_id:
                rc, _ = rpc('delete_post', {'p_post_id': post_id})
                if rc != 200: failures.append('test post cleanup')
            rc = delete_object(url)
            print('Small media cleanup: HTTP', rc)
            if rc not in (200, 204, 404): failures.append('small media cleanup')
    android_headers = dict(wh, **{'User-Agent': 'okhttp/4.12.0'})
    code, raw = request(worker + '/m', 'POST', video, android_headers)
    print('Android-agent media upload: HTTP', code)
    android_url = decode(raw).get('url')
    if code != 201 or not android_url:
        failures.append('Android-agent upload')
    else:
        rc = delete_object(android_url)
        print('Android-agent media cleanup: HTTP', rc)
        if rc not in (200, 204, 404): failures.append('Android-agent cleanup')
    # A gallery can report a generic MIME even for a real MP4. Exercise the
    # complete upload -> create -> readback -> delete path for both surfaces.
    for kind in ('posts', 'moments'):
        generic = dict(wh, **{'User-Agent': 'okhttp/4.12.0', 'Content-Type': 'application/octet-stream', 'X-Media-Kind': kind})
        code, raw = request(worker + '/m', 'POST', video, generic)
        url = decode(raw).get('url')
        print('Generic-MIME', kind, 'MP4 upload: HTTP', code)
        if code != 201 or not url:
            print('Upload error:', str(decode(raw).get('error', ''))[:200])
            failures.append('generic-MIME ' + kind + ' upload')
            continue
        created_id = None
        try:
            if kind == 'posts':
                rc, body = rpc('create_post_with_options', {'p_body': 'Automated generic-MIME video test', 'p_media_url': url, 'p_audience': 'connections', 'p_circle_id': None, 'p_edit': None, 'p_comments_enabled': False})
            else:
                rc, body = rpc('create_moment', {'p_kind': 'video', 'p_body': 'Automated video test', 'p_media_url': url, 'p_style': 'noir', 'p_audience': 'connections', 'p_duration_ms': 1000, 'p_edit': None})
            created_id = decode(body).get('id')
            print('Generic-MIME', kind, 'created: HTTP', rc, 'id present:', bool(created_id))
            if rc != 200 or not created_id:
                print('Create error:', str(decode(body).get('message', ''))[:200])
                failures.append('generic-MIME ' + kind + ' creation')
            else:
                rc, content = request(url, headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'Crushly-Publish-Diagnostic/1.0'})
                print('Generic-MIME', kind, 'readback:', rc, 'matches:', content == video)
                if rc != 200 or content != video: failures.append('generic-MIME ' + kind + ' readback')
        finally:
            if created_id:
                delete_rpc, key_name = ('delete_post', 'p_post_id') if kind == 'posts' else ('delete_moment', 'p_moment_id')
                rc, _ = rpc(delete_rpc, {key_name: created_id})
                if rc != 200: failures.append('generic-MIME ' + kind + ' row cleanup')
            rc = delete_object(url)
            print('Generic-MIME', kind, 'cleanup:', rc)
            if rc not in (200, 204, 404): failures.append('generic-MIME ' + kind + ' object cleanup')
    # A Moment video above 8 MiB used to be rejected although one-minute clips
    # are offered in the app. This is unpublished synthetic data and is removed.
    moment_headers = dict(wh, **{'X-Media-Kind':'moments'})
    code, raw = request(worker + '/m', 'POST', b'\0' * (9 * 1024 * 1024), moment_headers)
    url = decode(raw).get('url')
    print('9 MiB Moment video upload: HTTP', code)
    if code != 201 or not url: failures.append('Moment video size limit')
    else:
        rc = delete_object(url)
        if rc not in (200, 204, 404): failures.append('Moment video size cleanup')
    # A generic non-media payload must stay rejected, with no DB error envelope.
    bad_headers = dict(wh, **{'Content-Type':'application/octet-stream'})
    code, raw = request(worker + '/m', 'POST', b'not a media file', bad_headers)
    print('Unsupported generic upload: HTTP', code, 'message:', decode(raw).get('error', ''))
    if code != 415 or '__CRUSHLY__' in decode(raw).get('error', ''):
        failures.append('unsupported upload error handling')
    for size_mb in (30, 75):
        code, raw = upload(size_mb * 1024 * 1024)
        print('%s MB media upload: HTTP' % size_mb, code, 'error:', str(decode(raw).get('error', raw[:250].decode('utf-8', 'replace') if code != 201 else ''))[:300], 'diagnostic:', decode(raw).get('diagnostic', ''))
        large_url = decode(raw).get('url')
        if code != 201 or not large_url:
            failures.append('%s MB upload' % size_mb)
        else:
            rc = delete_object(large_url)
            print('%s MB media cleanup: HTTP' % size_mb, rc)
            if rc not in (200, 204, 404): failures.append('%s MB media cleanup' % size_mb)
    if failures: raise RuntimeError(', '.join(failures))
    print('Publish diagnostics passed')

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('FAILED:', e)
        sys.exit(1)
