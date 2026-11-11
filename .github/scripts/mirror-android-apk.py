#!/usr/bin/env python3
"""Upload a public release APK to private B2 and verify its bytes there.
B2 credentials come only from workflow secrets and are never printed.
"""
import base64
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

p = pathlib.Path(sys.argv[1])
if not re.fullmatch(r'Crushly-\d+\.\d+\.\d+-Android9plus\.apk', p.name):
    sys.exit('Unexpected release filename')
key = os.environ['B2_KEY_ID'].strip()
secret = os.environ['B2_APPLICATION_KEY'].strip()
bucket = os.environ['B2_BUCKET'].strip()
headers = {'User-Agent':'Crushly release mirror'}
def request(url, *, data=None, extra=None):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers={**headers, **(extra or {})}), timeout=300)
    except urllib.error.HTTPError as e:
        # B2 says *why* in the body — `cap_exceeded`, `unauthorized`,
        # `cannot_download` — and a bare status code turns a five-minute fix into
        # an afternoon. The body carries no credentials, so it is safe to print.
        detail = ''
        try:
            raw = e.read(2000).decode('utf-8', 'replace')
            detail = ' — ' + ' '.join(raw.split())[:400]
        except Exception:
            pass
        raise RuntimeError('B2 request failed with HTTP ' + str(e.code) + detail) from None

def call(url, body, token):
    with request(url, data=json.dumps(body).encode(), extra={'Authorization':token, 'Content-Type':'application/json'}) as r:
        return json.load(r)

auth_header = base64.b64encode((key+':'+secret).encode()).decode()
with request('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', extra={'Authorization':'Basic '+auth_header}) as r:
    auth = json.load(r)
token=auth['authorizationToken']; api=auth['apiUrl']
buckets=call(api+'/b2api/v2/b2_list_buckets', {'accountId':auth['accountId']}, token)['buckets']
item=next((b for b in buckets if b['bucketName']==bucket),None)
if not item: sys.exit('Release mirror bucket was not found')
data=p.read_bytes(); sha256=hashlib.sha256(data).hexdigest(); sha1=hashlib.sha1(data).hexdigest()
slot=call(api+'/b2api/v2/b2_get_upload_url', {'bucketId':item['bucketId']}, token)
path='android-releases/'+p.name
with request(slot['uploadUrl'], data=data, extra={'Authorization':slot['authorizationToken'], 'X-Bz-File-Name':urllib.parse.quote(path, safe='/'), 'X-Bz-Content-Sha1':sha1, 'Content-Type':'application/vnd.android.package-archive'}) as r:
    result=json.load(r)
if result.get('contentLength')!=len(data) or result.get('contentSha1')!=sha1:
    sys.exit('Release mirror upload did not match the local APK')
url=auth['downloadUrl']+'/file/'+urllib.parse.quote(bucket,safe='')+'/'+urllib.parse.quote(path,safe='/')
digest=hashlib.sha256(); count=0
with request(url, extra={'Authorization':token}) as r:
    while chunk:=r.read(1024*1024):
        count+=len(chunk);digest.update(chunk)
if count!=len(data) or digest.hexdigest()!=sha256:
    sys.exit('Release mirror readback did not match the local APK')
print(f'Mirrored and read back {p.name}: {count} bytes, SHA-256 {sha256}')
