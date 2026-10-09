"""Install the old ARM artifact, then the exact new artifact, without a data wipe.
Runs exclusively on a disposable emulator. No member credentials/data used.
"""
import pathlib
import re
import subprocess
import sys

lines = []
def adb(*args):
    p = subprocess.run(['adb', *args], text=True, capture_output=True, timeout=180)
    return p.returncode, p.stdout + p.stderr

def note(text):
    lines.append(text)
    pathlib.Path('apk-check/install-report.txt').write_text('\n'.join(lines) + '\n')
    print('::notice::' + text)

_, abis = adb('shell', 'getprop', 'ro.product.cpu.abilist')
note('Android 11 emulator supported ABIs: ' + abis.strip())
if 'armeabi-v7a' not in abis and 'arm64-v8a' not in abis:
    note('INCONCLUSIVE: emulator lacks ARM translation; metadata comparison is not a device install test.')
    sys.exit(0)
for label in ['old', 'new']:
    code, output = adb('install', '-r', f'apk-check/{label}/Crushly-android-test.apk')
    if code or 'Success' not in output:
        reason = re.search(r'(INSTALL_[A-Z_]+[^\]\n]*)', output)
        reason = reason[0] if reason else 'unknown installer error'
        note(f'{label} APK install FAILED: {reason}')
        print('::error::' + reason)
        sys.exit(1)
    note(f'{label} APK install succeeded.')
note('PASS: Android 11 installed the exact ARM startup-fix APK over the exact earlier APK without uninstalling or clearing data. Not a Samsung hardware test.')
