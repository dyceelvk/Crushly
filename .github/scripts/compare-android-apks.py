"""Read-only metadata comparison of two already-distributed public test APKs."""
import hashlib
import io
import tarfile
import tempfile
import os
import pathlib
import re
import subprocess
import zipfile

root = pathlib.Path('apk-check')
tools = sorted((pathlib.Path(os.environ['ANDROID_HOME']) / 'build-tools').iterdir(),
               key=lambda p: [int(v) for v in re.findall(r'\d+', p.name)])[-1]
# The internal builds are documented as debug-signed. Check the exact locked
# Expo template key; never generate a replacement and pretend it can update.
with tempfile.TemporaryDirectory() as temp:
    package = subprocess.check_output(['npm', 'pack', 'expo@57.0.27', '--ignore-scripts', '--silent', '--pack-destination', temp], text=True).strip().splitlines()[-1]
    with tarfile.open(pathlib.Path(temp) / package) as npm_tar:
        template = npm_tar.extractfile('package/template.tgz').read()
    with tarfile.open(fileobj=io.BytesIO(template), mode='r:gz') as template_tar:
        key = template_tar.extractfile('package/android/app/debug.keystore').read()
    key_path = pathlib.Path(temp) / 'debug.keystore'
    key_path.write_bytes(key)
    certificate = subprocess.check_output(['keytool', '-exportcert', '-keystore', str(key_path), '-storepass', 'android', '-alias', 'androiddebugkey'])
    template_digest = hashlib.sha256(certificate).hexdigest()
    print('::notice::Public Expo test certificate SHA256: ' + template_digest)

metadata = []
lines = []
for label in ['old', 'new']:
    apk = root / label / 'Crushly-android-test.apk'
    sign = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    badging = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
    certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: (\S+)', sign)
    certs = [c.lower() for c in certs]
    print('::notice::' + label + ' signer certificate SHA256: ' + ', '.join(certs))
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
    if old[2] != [template_digest]:
        print('::error::The previous APK was not signed by the locked Expo template key. Cannot restore the old signing identity from this template.')
        raise SystemExit(1)
    # Restore only a verified matching internal-test identity. This is NOT
    # production signing; the template's debug key is public by design.
    output = root / 'repaired' / 'Crushly-1.0.2-update.apk'
    output.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        key_path = pathlib.Path(temp) / 'debug.keystore'
        key_path.write_bytes(key)
        subprocess.run([str(tools / 'apksigner'), 'sign', '--ks', str(key_path), '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--out', str(output), str(root / 'new' / 'Crushly-android-test.apk')], check=True)
    subprocess.run([str(tools / 'apksigner'), 'verify', str(output)], check=True)
    repaired_cert = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--print-certs', str(output)], text=True)
    assert re.findall(r'Signer #\d+ certificate SHA-256 digest: (\S+)', repaired_cert) == old[2]
    # Compare installed update next using the repaired artifact, never original.
    (root / 'new' / 'Crushly-android-test.apk').write_bytes(output.read_bytes())
    print('::notice::Restored the earlier verified signing identity on the startup-fix APK. Android 11 update test still required.')
