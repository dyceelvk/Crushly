"""Launch a clean, unsigned-in release install twice and assert real welcome UI.

No personal accounts, tokens, or user data involved. Logs stay private to the
runner; only known crash categories are surfaced in annotations.
"""
import pathlib
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = 'app.crushly'

def adb(*args, check=True):
    return subprocess.run(['adb', *args], text=True, capture_output=True, check=check).stdout

def fail(reason):
    print('::error::Android 9 release launch failed: ' + reason)
    sys.exit(1)

adb('install', '-r', sys.argv[1])
adb('shell', 'pm', 'clear', PACKAGE)
for attempt in range(2):
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
    deadline = time.monotonic() + 90
    welcome = False
    while time.monotonic() < deadline:
        time.sleep(3)
        if not adb('shell', 'pidof', PACKAGE, check=False).strip():
            fail('process exited during startup')
        result = adb('shell', 'uiautomator', 'dump', '/sdcard/crushly-ui.xml', check=False)
        if 'dumped' not in result:
            continue
        xml = adb('shell', 'cat', '/sdcard/crushly-ui.xml', check=False)
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            continue
        labels = [n.get('text', '') + ' ' + n.get('content-desc', '') for n in root.iter('node')]
        if any('Welcome to Crushly' in s for s in labels) and any('Get Started' in s for s in labels):
            welcome = True
            break
    if not welcome:
        fail('welcome UI did not appear (splash timeout or startup error)')
    time.sleep(10)
    if not adb('shell', 'pidof', PACKAGE, check=False).strip():
        fail('process exited after welcome')
    logs = adb('logcat', '-d', '-b', 'crash', check=False)
    if PACKAGE in logs and ('FATAL EXCEPTION' in logs or 'Fatal signal' in logs):
        fail('fatal crash recorded')
    print(f'::notice::Android 9 release launch {attempt + 1}: welcome UI visible; process alive.')
print('Android 9 cold start and relaunch passed (signed out).')
