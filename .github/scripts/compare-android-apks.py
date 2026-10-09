"""Read-only metadata comparison of two already-distributed public test APKs."""
import hashlib
import os
import pathlib
import re
import subprocess
import zipfile

root = pathlib.Path('apk-check')
tools = sorted((pathlib.Path(os.environ['ANDROID_HOME']) / 'build-tools').iterdir(),
               key=lambda p: [int(v) for v in re.findall(r'\d+', p.name)])[-1]
metadata = []
lines = []
for label in ['old', 'new']:
    apk = root / label / 'Crushly-android-test.apk'
    sign = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    badging = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
    certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: (\S+)', sign)
    version = int(re.search(r"versionCode='(\d+)'", badging)[1])
    package = re.search(r"package: name='([^']+)'", badging)[1]
    with zipfile.ZipFile(apk) as z:
        assert z.testzip() is None, 'ZIP corruption'
        abis = sorted({s.split('/')[1] for s in z.namelist() if s.startswith('lib/') and s.endswith('.so')})
        bundle = hashlib.sha256(z.read('assets/index.android.bundle')).hexdigest()
    metadata.append((package, version, certs, abis))
    public_metadata = [s for s in badging.splitlines() if s.startswith(('package:', 'sdkVersion:', 'targetSdkVersion:', 'native-code:'))]
    lines.extend([label, 'APK bytes: ' + str(apk.stat().st_size), 'APK SHA256: ' + hashlib.sha256(apk.read_bytes()).hexdigest(),
                  'JS bundle SHA256: ' + bundle, 'Signer certificate SHA256: ' + ', '.join(certs), *public_metadata])
    print('::notice::' + label + ' APK: ' + ' '.join(public_metadata))
old, new = metadata
checks = {
    'same package ID': old[0] == new[0],
    'increasing versionCode': new[1] > old[1],
    'same signing certificate': bool(old[2]) and old[2] == new[2],
    'both ARM architectures': {'armeabi-v7a', 'arm64-v8a'}.issubset(new[3]),
}
for check, passed in checks.items():
    text = f'{check}: {passed}'
    lines.append(text)
    print('::' + ('notice' if passed else 'error') + '::' + text)
(root / 'comparison-report.txt').write_text('\n'.join(lines) + '\n')
if not all(checks.values()):
    raise SystemExit(1)
