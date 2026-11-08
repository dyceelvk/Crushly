"""Install the last public APK on a disposable Android emulator and exercise
its own download + Android installer. This does not use or wipe a real phone.
"""
import os
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = 'app.crushly'
old = next(pathlib.Path('apk-check/old').glob('*.apk'))
out = pathlib.Path('update-walk')
out.mkdir(exist_ok=True)

def adb(*args, check=True):
    p = subprocess.run(['adb', *args], capture_output=True, text=True, timeout=240)
    if check and p.returncode:
        raise RuntimeError('adb ' + ' '.join(args[:2]) + ' failed: ' + p.stderr[-300:])
    return p.stdout

def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/update-check.xml', check=False)
    xml = adb('shell', 'cat', '/sdcard/update-check.xml', check=False)
    try: root = ET.fromstring(xml)
    except ET.ParseError: return []
    result = []
    for n in root.iter('node'):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds',''))
        if m:
            x1,y1,x2,y2 = map(int,m.groups())
            if x2 > x1 and y2 > y1:
                result.append((n.get('text',''), n.get('content-desc',''), (x1+x2)//2, (y1+y2)//2))
    return result

def tap(seen, label, exact_only=False):
    for exact in ((True,) if exact_only else (True, False)):
        for text, desc, x, y in seen:
            if any((v.lower() == label.lower() if exact else label.lower() in v.lower()) for v in (text, desc)):
                adb('shell', 'input', 'tap', str(x), str(y))
                print('Tapped:', label, flush=True)
                return True
    return False

def version():
    data = adb('shell', 'dumpsys', 'package', PACKAGE, check=False)
    found = re.search(r'versionCode=(\d+)', data)
    return int(found.group(1)) if found else -1

def fail(msg):
    image = subprocess.run(['adb','exec-out','screencap','-p'], capture_output=True, timeout=60).stdout
    (out / 'failure.png').write_bytes(image)
    (out / 'logcat.txt').write_text(adb('logcat', '-d', '-t', '5000', check=False))
    print('::error::' + msg, flush=True)
    sys.exit(1)

abis = adb('shell','getprop','ro.product.cpu.abilist').strip().split(',')
print('Emulator ABIs:', ','.join(abis), flush=True)
if 'arm64-v8a' not in abis:
    fail('Inconclusive: emulator cannot run the public 64-bit ARM build')
adb('install', '--no-streaming', '--abi', 'arm64-v8a', '-r', str(old))
if version() != 80: fail('Old APK did not install as version 80')
adb('shell','appops','set',PACKAGE,'REQUEST_INSTALL_PACKAGES','allow',check=False)
adb('shell','am','start','-W','-n',PACKAGE+'/.MainActivity')
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    seen = nodes()
    if tap(seen,'Update now'):
        break
    time.sleep(3)
else:
    fail('The installed 1.0.80 APK did not offer the update')

clicked_install = False
last = ''
deadline = time.monotonic() + 420
while time.monotonic() < deadline:
    installed = version()
    if installed == 81:
        print('PASS: in-app download, Android installer, and update to versionCode 81 succeeded.', flush=True)
        sys.exit(0)
    seen = nodes()
    text = ' | '.join((t or d) for t,d,_,_ in seen if t or d)
    if text != last:
        print('UI:', text[:450], flush=True)
        last = text
    if 'problem parsing' in text.lower(): fail('Android reported a package parsing error')
    if 'update didn’t finish' in text.lower(): fail('The app reported its update failed')
    if 'allow from this source' in text.lower():
        tap(seen, 'Allow from this source', exact_only=True)
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2)
    if not clicked_install and (tap(seen, 'Install', exact_only=True) or tap(seen,'Update', exact_only=True)):
        clicked_install = True
        time.sleep(4)
    time.sleep(3)
fail('Inconclusive: versionCode 81 not installed before timeout')
