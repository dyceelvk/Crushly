"""Test the exact public APKs with explicit 32-bit ARM selection on Android 11.

Disposable emulator only: no personal accounts/data. Do not use -t (which would
allow a testOnly APK), -d (downgrade), or uninstall on a user's device.
"""
import pathlib
import re
import subprocess
import sys

PACKAGE = 'app.crushly'
ABI = 'armeabi-v7a'
lines = []


def adb(*args):
    p = subprocess.run(['adb', *args], text=True, capture_output=True, timeout=180)
    return p.returncode, p.stdout + p.stderr


def note(text):
    lines.append(text)
    pathlib.Path('apk-check/install-report.txt').write_text('\n'.join(lines) + '\n')
    print('::notice::' + text)


def fail(text):
    note(text)
    print('::error::' + text)
    sys.exit(1)


def uninstall_emulator_copy():
    adb('uninstall', PACKAGE)
    _, packages = adb('shell', 'pm', 'list', 'packages', PACKAGE)
    if 'package:' + PACKAGE in packages:
        fail('Could not remove the disposable emulator copy before clean-install test.')


def install(label, scenario):
    code, output = adb('install', '--no-streaming', '--abi', ABI, '-r',
                       f'apk-check/{label}/Crushly-android-test.apk')
    if code or 'Success' not in output:
        reason = re.search(r'(INSTALL_[A-Z_]+[^\]\n]*)', output)
        fail(f'{scenario}: {reason[0] if reason else "unknown installer error"}')
    _, package = adb('shell', 'dumpsys', 'package', PACKAGE)
    if not re.search(r'primaryCpuAbi=armeabi-v7a\b', package):
        fail(f'{scenario}: installer did not select 32-bit ARM; test inconclusive.')
    note(f'{scenario}: installed successfully; primaryCpuAbi=armeabi-v7a.')


_, abis = adb('shell', 'getprop', 'ro.product.cpu.abilist')
note('Android 11 emulator supported ABIs: ' + abis.strip())
if ABI not in abis.split(','):
    fail('INCONCLUSIVE: emulator lacks 32-bit ARM translation; cannot test this path.')

uninstall_emulator_copy()
install('new', 'Fresh install of startup-fix APK (no existing app)')
uninstall_emulator_copy()
install('old', 'Fresh install of earlier APK')
install('new', 'Update from earlier APK to startup-fix APK (no data wipe)')
note('PASS: exact public APK installed fresh and as an update with explicit 32-bit ARM selection. '
     'No allow-test or downgrade override used. ARM translation on an emulator is not Samsung hardware validation.')
