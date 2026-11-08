"""Check the deployed Space-banner/search path on the dedicated walk account.

Refuses to change an existing banner. Synthetic content is private to connections,
then removed; never prints credentials, paths, or other members' content.
"""
import base64
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_ANON_KEY']
WORKER = 'https://crushly-media.dyceelvk.workers.dev'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==')


def request(url, method='GET', data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def json_value(raw):
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def main():
    login = json.dumps({'email': os.environ['WALK_EMAIL'], 'password': os.environ['WALK_PASSWORD']}).encode()
    rc, raw = request(BASE + '/auth/v1/token?grant_type=password', 'POST', login, {'apikey': KEY, 'Content-Type': 'application/json'})
    token = (json_value(raw) or {}).get('access_token')
    if rc != 200 or not token:
        raise RuntimeError('Walk account sign-in failed')
    headers = {'apikey': KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    media_headers = {'Authorization': 'Bearer ' + token, 'User-Agent': 'okhttp/4.12.0'}
    def rpc(name, args):
        return request(BASE + '/rest/v1/rpc/' + name, 'POST', json.dumps(args).encode(), headers)
    rc, raw = rpc('me_id', {})
    me = json_value(raw)
    if rc != 200 or not isinstance(me, int):
        raise RuntimeError('Could not identify the walk account')
    rc, raw = rpc('space_banner', {'p_target_id': me})
    if rc != 200 or json_value(raw) is not None:
        raise RuntimeError('Banner check failed or the walk account already has a banner; refusing to replace it')
    url = None
    post_id = None
    errors = []
    keyword = 'holupcheck' + uuid.uuid4().hex[:10]
    try:
        upload_headers = dict(media_headers, **{'Content-Type': 'image/png', 'X-Media-Kind': 'banners'})
        rc, raw = request(WORKER + '/m', 'POST', PNG, upload_headers)
        url = (json_value(raw) or {}).get('url')
        if rc != 201 or not isinstance(url, str) or not url.startswith(WORKER + '/m/banners/'):
            raise RuntimeError('Banner upload failed: HTTP %s' % rc)
        rc, raw = rpc('set_space_banner', {'p_url': url})
        if rc != 200 or json_value(raw) is not None:
            raise RuntimeError('Banner save failed: HTTP %s' % rc)
        rc, raw = rpc('space_banner', {'p_target_id': me})
        if rc != 200 or json_value(raw) != url:
            raise RuntimeError('Banner did not read back')
        req = urllib.request.Request(url, headers=media_headers)
        with urllib.request.urlopen(req, timeout=90) as response:
            rc, content = response.status, response.read()
            cache_control = response.headers.get('Cache-Control', '').lower()
        if 'no-store' not in cache_control or 'private' not in cache_control:
            raise RuntimeError('Banner media cache policy is not private and no-store')
        if rc != 200 or content != PNG:
            raise RuntimeError('Banner media readback failed: HTTP %s' % rc)
        rc, _ = request(url, headers={'User-Agent': 'okhttp/4.12.0'})
        if rc == 200:
            raise RuntimeError('Banner was readable without authentication')
        print('Banner upload, private media readback and anonymous denial: passed')
        rc, raw = rpc('create_post_with_options', {'p_body': 'Automated private search check #' + keyword,
            'p_media_url': None, 'p_audience': 'connections', 'p_circle_id': None,
            'p_edit': None, 'p_comments_enabled': True})
        created = json_value(raw) or {}
        post_id = created.get('id') if isinstance(created, dict) else None
        if rc != 200 or not post_id:
            raise RuntimeError('Private search fixture could not be created: HTTP %s' % rc)
        for category in ('top', 'clips', 'photos', 'people', 'sounds', 'places', 'hashtags', 'moments'):
            rc, raw = rpc('search_holup', {'p_query': keyword, 'p_category': category,
                'p_since': 0, 'p_sort': 'relevance', 'p_author': '', 'p_content': 'all',
                'p_hashtag': False, 'p_limit': 40, 'p_place': ''})
            data = json_value(raw)
            if rc != 200 or not isinstance(data, dict):
                raise RuntimeError('Search category %s failed: HTTP %s' % (category, rc))
            if category == 'top' and not any(x.get('id') == post_id for x in data.get('posts', [])):
                raise RuntimeError('Private own post was missing from search')
            if category == 'hashtags' and not any(x.get('tag') == keyword for x in data.get('hashtags', [])):
                raise RuntimeError('Private own hashtag was missing from search')
        print('All eight categories and private own-post/hashtag search: passed')
    finally:
        if post_id:
            rc, _ = rpc('delete_post', {'p_post_id': post_id})
            if rc != 200:
                errors.append('post cleanup failed')
        if url:
            rc, raw = rpc('space_banner', {'p_target_id': me})
            if rc != 200:
                errors.append('could not check banner before cleanup')
            elif json_value(raw) == url:
                rc, _ = rpc('set_space_banner', {'p_url': None})
                if rc != 200:
                    errors.append('banner row cleanup failed')
            rc, _ = request(url, 'DELETE', headers=media_headers)
            if rc not in (200, 204, 404):
                errors.append('banner object cleanup failed')
        if errors:
            raise RuntimeError('; '.join(errors))
    print('Test content and banner cleaned up')


if __name__ == '__main__':
    main()
