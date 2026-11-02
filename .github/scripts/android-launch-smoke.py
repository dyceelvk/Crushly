"""Launch a clean, unsigned-in release install twice and assert the real opening UI.

The app opens on "Follow the feelings" (one tap) and then on Welcome. The script
walks that path rather than expecting Welcome first, which is what it used to do
— and it also had no way of telling "the app is showing a different screen" from
"the app died", so a tap-through keeps the two distinct.

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
    def labels():
        """Visible text plus accessibility labels, whitespace-collapsed."""
        result = adb('shell', 'uiautomator', 'dump', '/sdcard/crushly-ui.xml', check=False)
        if 'dumped' not in result:
            return None
        xml = adb('shell', 'cat', '/sdcard/crushly-ui.xml', check=False)
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            return None
        return [' '.join((n.get('text', '') + ' ' + n.get('content-desc', '')).split())
                for n in root.iter('node')]

    def alive(why):
        if not adb('shell', 'pidof', PACKAGE, check=False).strip():
            # Logcat is the only way to know why a release build died: React
            # Native aborts the process on an uncaught JS error, so the crash
            # buffer is printed here instead of being swallowed.
            print(adb('logcat', '-d', '-b', 'crash', check=False)[-4000:])
            print(adb('logcat', '-d', check=False)[-4000:])
            fail(why)

    # 1. The opening sentence. Also the place where a launch crash shows up.
    deadline = time.monotonic() + 90
    opening = False
    while time.monotonic() < deadline:
        time.sleep(3)
        alive('process exited during startup')
        seen = labels()
        if seen is None:
            continue
        if any('Follow the feelings' in s for s in seen):
            opening = True
            break
    if not opening:
        fail('the follow-the-feelings opening did not appear')

    # 2. One tap anywhere, which is the whole interaction on that screen.
    size = adb('shell', 'wm', 'size', check=False).strip().split()[-1]
    w, h = (int(v) for v in size.split('x'))
    adb('shell', 'input', 'tap', str(w // 2), str(h // 2))
    time.sleep(2)

    # 3. Welcome, which is where signing in starts.
    deadline = time.monotonic() + 60
    welcome = False
    while time.monotonic() < deadline:
        alive('process exited after the opening screen')
        seen = labels()
        if seen is None:
            time.sleep(2)
            continue
        # Whitespace-collapsed: the Welcome headline is set as `Welcome to\nCrushly`.
        if any('Welcome to Crushly' in s for s in seen) and any('Get Started' in s for s in seen):
            welcome = True
            break
        time.sleep(2)
    if not welcome:
        fail('tapping the opening did not reach Welcome')
    time.sleep(10)
    if not adb('shell', 'pidof', PACKAGE, check=False).strip():
        fail('process exited after welcome')
    logs = adb('logcat', '-d', '-b', 'crash', check=False)
    if PACKAGE in logs and ('FATAL EXCEPTION' in logs or 'Fatal signal' in logs):
        fail('fatal crash recorded')
    print(f'::notice::Android 9 release launch {attempt + 1}: welcome UI visible; process alive.')
print('Android 9 cold start and relaunch passed (signed out).')
