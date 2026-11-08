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
    code, raw = upload(1024 * 1024)
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
            elif rpc('post_comment_settings', {'p_post_id': post_id}) != (200, b'false'):
                failures.append('comment option readback')
        finally:
            if post_id:
                rc, _ = rpc('delete_post', {'p_post_id': post_id})
                if rc != 200: failures.append('test post cleanup')
            rc = delete_object(url)
            print('Small media cleanup: HTTP', rc)
            if rc not in (200, 204, 404): failures.append('small media cleanup')
    code, raw = upload(30 * 1024 * 1024)
    print('30 MB media upload: HTTP', code, 'error:', str(decode(raw).get('error', raw[:250].decode('utf-8', 'replace') if code != 201 else ''))[:300])
    large_url = decode(raw).get('url')
    if code != 201 or not large_url:
        failures.append('30 MB upload')
    else:
        rc = delete_object(large_url)
        print('Large media cleanup: HTTP', rc)
        if rc not in (200, 204, 404): failures.append('large media cleanup')
    if failures: raise RuntimeError(', '.join(failures))
    print('Publish diagnostics passed')

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('FAILED:', e)
        sys.exit(1)
