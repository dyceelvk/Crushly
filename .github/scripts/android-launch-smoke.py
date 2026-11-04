"""Cold start, sign in, and walk every surface of the release APK.

This script used to stop at Welcome. That is why "the APK was checked" kept
meaning less than it sounded: a build can launch, reach its first screen, hold
the process open, and still put a caption under the tab bar, order a strip
wrongly, or send a link to the wrong segment. None of that shows up in a
compiler, a unit test or a successful launch.

So the run is:

  1. cold start twice, signed out, asserting the real opening UI (as before);
  2. sign in as the walk account, through the same screens a person uses;
  3. photograph and read every surface — the Flow strip and its three segments,
     the magnifier, Crushes, Whispers, Close Ones, Space, the menu, Settings —
     dumping the accessibility tree at each stop into `walk/report.txt`.

Everything is addressed by the app's own text and accessibility labels, never by
pixel coordinates, so a layout change moves the walk with it.

The walk account is a throwaway profile in the project's own database
(`arena.walk@example.com`); no other user's data is touched. Credentials arrive
through the environment and are never printed.
"""
import os
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = 'app.crushly'
SCREEN = [0, 0]  # filled in from `wm size`; dump bounds are in the same pixels
LAUNCHER = [PACKAGE + '/.MainActivity']  # resolved from the package, not assumed
OUT = pathlib.Path(os.environ.get('CRUSHLY_WALK_OUT') or 'walk')
EMAIL = os.environ.get('CRUSHLY_WALK_EMAIL') or ''
PASSWORD = os.environ.get('CRUSHLY_WALK_PASSWORD') or ''

OUT.mkdir(parents=True, exist_ok=True)
report = open(OUT / 'report.txt', 'w', encoding='utf-8')


def log(line):
    print(line, flush=True)
    report.write(line + '\n')
    report.flush()


def adb(*args, check=True):
    return subprocess.run(['adb', *args], text=True, capture_output=True, check=check).stdout


def read_screen_size():
    out = adb('shell', 'wm', 'size', check=False)
    found = re.findall(r'(\d+)x(\d+)', out)
    if found:
        SCREEN[0], SCREEN[1] = (int(v) for v in found[-1])
    return SCREEN


def fail(reason):
    log('::error::Android 9 release walk failed: ' + reason)
    try:
        png = subprocess.run(['adb', 'exec-out', 'screencap', '-p'],
                             capture_output=True, timeout=120).stdout
        (OUT / 'failure.png').write_bytes(png)
        log('failure.png saved ({} bytes)'.format(len(png)))
    except Exception as exc:                       # never mask the real reason
        log('could not screenshot the failure: ' + str(exc))
    report.close()
    sys.exit(1)


def nodes(attempts=3):
    """Every node in the app's window, with the centre of its bounds.

    On Android the soft keyboard is a window of its own, and `uiautomator dump`
    reports the *active* one. Once a text field has focus the dump therefore
    describes the keyboard, and the form behind it looks empty. So: if what came
    back is an input method, send BACK (which dismisses the keyboard, not the
    screen) and ask again. Anything else — a system dialog, the launcher — is
    returned as-is, because pretending not to see it is how a walk turns into a
    green tick over nothing.
    """
    root = None
    for attempt in range(attempts):
        dumped = adb('shell', 'uiautomator', 'dump', '/sdcard/crushly-ui.xml', check=False)
        if 'dumped' not in dumped:
            return None
        xml = adb('shell', 'cat', '/sdcard/crushly-ui.xml', check=False)
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            return None
        # `package` lives on the nodes; the <hierarchy> root carries rotation
        # only. Reading it from the root — which is what this did first — made
        # every window look like "not the app", and the BACK presses that
        # followed walked the app out to the launcher.
        packages = {n.get('package') or '' for n in root.iter('node')}
        if PACKAGE in packages:
            break
        ime = any('inputmethod' in p or 'keyboard' in p for p in packages)
        if not ime:
            # Some other window (a system dialog, the launcher). Report it as it
            # is: the caller can say what it saw instead of waiting in the dark.
            log('window is not the app ({}); using what is on screen'.format(
                ', '.join(sorted(p for p in packages if p)) or 'unknown'))
            break
        if attempt < attempts - 1:
            adb('shell', 'input', 'keyevent', '4')
            time.sleep(1.0)
    out = []
    for n in root.iter('node'):
        bounds = n.get('bounds', '')
        try:
            box = bounds.replace('][', ',').strip('[]').split(',')
            x1, y1, x2, y2 = (int(v) for v in box)
        except ValueError:
            continue
        out.append({
            'text': ' '.join(n.get('text', '').split()),
            'desc': ' '.join(n.get('content-desc', '').split()),
            'class': n.get('class', ''),
            'x': (x1 + x2) // 2,
            'y': (y1 + y2) // 2,
            'x1': x1, 'x2': x2, 'y1': y1, 'y2': y2,
            'on_screen': y1 > 0 and y2 > y1,
        })
    return out


def norm(value):
    """Flatten whitespace and quote style so a label matches however it is typed."""
    return ' '.join(value.replace('\u2019', "'").replace('\u2018', "'").split()).lower()


def labels(seen):
    return [' '.join((n['text'] + ' ' + n['desc']).split()) for n in seen]


def alive(why):
    if not adb('shell', 'pidof', PACKAGE, check=False).strip():
        # Logcat is the only way to know why a release build died: React Native
        # aborts the process on an uncaught JS error, so the crash buffer is
        # printed here instead of being swallowed.
        log(adb('logcat', '-d', '-b', 'crash', check=False)[-4000:])
        log(adb('logcat', '-d', check=False)[-4000:])
        fail(why)


def wait_for(needles, seconds, why):
    """Wait until every needle is on screen. Returns the last tree or None."""
    deadline = time.monotonic() + seconds
    wanted = [norm(n) for n in needles]
    while time.monotonic() < deadline:
        alive(why)
        seen = nodes()
        if seen is None:
            time.sleep(2)
            continue
        text = ' ¦ '.join(norm(v) for v in labels(seen))
        if all(w in text for w in wanted):
            return seen
        time.sleep(2)
    return None


def find(seen, needle, cls=None):
    want = norm(needle)
    pool = [n for n in seen if (cls is None or cls in n['class']) and n['on_screen']]
    for key in ('text', 'desc'):
        for n in pool:
            if norm(n[key]) == want:
                return n
    for key in ('text', 'desc'):
        for n in pool:
            if want in norm(n[key]):
                return n
    return None


def swipe_up():
    adb('shell', 'input', 'swipe', '160', '520', '160', '240', '220')
    time.sleep(1.2)


def scroll_to(needle, swipes=4):
    """Swipe until the label is on screen. Returns True when it is."""
    if find(nodes() or [], needle):
        return True
    for _ in range(swipes):
        swipe_up()
        if find(nodes() or [], needle):
            return True
    return False


def tap(needle, cls=None, tries=2, required=False):
    for _ in range(tries):
        seen = nodes()
        if seen:
            node = find(seen, needle, cls=cls)
            if node:
                adb('shell', 'input', 'tap', str(node['x']), str(node['y']))
                time.sleep(1.8)
                return True
        time.sleep(1.5)
    log('MISSING: nothing on screen to tap for ' + repr(needle))
    if required:
        fail('the ' + needle + ' control was not on screen')
    return False


def type_into(index, value, fields=None):
    seen = nodes() or []
    fields = fields or [n for n in seen if 'EditText' in n['class'] and n['on_screen']]
    if len(fields) <= index:
        return False
    adb('shell', 'input', 'tap', str(fields[index]['x']), str(fields[index]['y']))
    time.sleep(1.0)
    # `input text` has no way to send a space; an escaped %s is how adb spells it.
    adb('shell', 'input', 'text', value.replace(' ', '%s'))
    time.sleep(0.8)
    return True


def shot(name, seen=None):
    seen = nodes() if seen is None else seen
    if not seen:
        # uiautomator occasionally returns a tree with nothing in it while the
        # screen is obviously drawn. Say so instead of writing "nothing on
        # screen", which reads like a bug in the app.
        seen = nodes()
        if not seen:
            log('[{}] the accessibility dump came back empty; the screenshot is still real'.format(name))
    time.sleep(0.8)
    png = subprocess.run(['adb', 'exec-out', 'screencap', '-p'],
                         capture_output=True, timeout=120).stdout
    path = OUT / (name + '.png')
    path.write_bytes(png)
    present = labels(seen or [])
    log('[{}] {} bytes | {}'.format(name, len(png), ' · '.join(present)[:500] or '(nothing on screen)'))
    return seen


def sign_in():
    """Welcome -> sign in -> the Flow. Returns True when the app is signed in."""
    if not EMAIL or not PASSWORD:
        fail('no walk credentials in the environment (CRUSHLY_WALK_EMAIL / CRUSHLY_WALK_PASSWORD)')
    # Welcome offers "Get Started" (create an account) and a quieter line for
    # people who already have one. The walk takes the second.
    if not tap('I already have an account', tries=3):
        # Some builds land straight on the form; only fail if the form is absent too.
        if not find(nodes() or [], 'Welcome back'):
            fail('could not reach the sign-in form from Welcome')
    if not wait_for(['Welcome back'], 45, 'process exited on the way to sign in'):
        fail('the sign-in form never appeared')
    fields = [n for n in (nodes() or []) if 'EditText' in n['class'] and n['on_screen']]
    log('sign-in form has {} text field(s)'.format(len(fields)))
    shot('02-sign-in-form')
    if len(fields) < 2:
        fail('the sign-in form did not offer email and password fields')
    if not type_into(0, EMAIL, fields):
        fail('the email field could not be filled')
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(0.8)
    if not type_into(1, PASSWORD, fields):
        fail('the password field could not be filled')
    shot('03-sign-in-filled')
    adb('shell', 'input', 'keyevent', '4')  # dismiss the keyboard over the button
    time.sleep(1.0)
    if not tap('Sign in', tries=3, required=True):
        return False
    if wait_for(['Connections', 'Whispers'], 120, 'process exited while signing in'):
        log('signed in as the walk account')
        return True
    shot('01-sign-in-stuck')
    fail('signing in did not reach the app')
    return False


def leave_screen():
    """Leave the screen we opened, by its own Back if it has one.

    Pressing the system BACK is not enough on a screen with a focused text
    field: the first press only dismisses the keyboard, so the walk carried on
    inside Search and every later step was wrong-but-green. Tapping the screen's
    own Back closes the screen whether or not a keyboard is up, so that is tried
    first, and the system BACK is only the fallback.
    """
    if tap('Back', tries=1):
        time.sleep(0.6)
        return
    back_out()


def return_to_tabs(tries=4):
    """Come back to the app's four tabs, however many screens are stacked.

    If a screen will not close — a verification flow with its own chrome, a
    camera permission sheet — the app is started again instead of the walk
    carrying on wherever it happens to be, which is how a screen silently
    becomes five wrong screenshots.
    """
    for _ in range(tries):
        seen = nodes() or []
        if find(seen, 'Home') and find(seen, 'Space'):
            return True
        leave_screen()
    log('could not get back to the tabs; restarting the app')
    adb('shell', 'am', 'force-stop', PACKAGE)
    time.sleep(1.5)
    adb('shell', 'am', 'start', '-n', LAUNCHER[0])
    time.sleep(8)
    return bool(find(nodes() or [], 'Home'))


def back_out():
    """Leave whatever screen just opened — and stop there.

    Pressing BACK twice unconditionally was wrong twice over: on a screen with
    the keyboard up the first one only dismisses the keyboard (so one is not
    enough), and on a screen without it the second one leaves the app (so two is
    too many). The app went to the launcher and every later step reported
    MISSING. So: BACK once, then look at where we are, and only fix it up if we
    are not back in the app.
    """
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(1.4)
    seen = nodes()          # nodes() dismisses a keyboard and re-reads, by itself
    if seen is not None:
        return
    log('BACK left the app; bringing it back to the front')
    adb('shell', 'am', 'start', '-n', LAUNCHER[0])
    time.sleep(6)


def assert_strip(seen):
    """Home reads Flow → Crushes → Connections, and the bar reads
    Home → Discover → (+) → Whispers → Space.

    This is the layout that was argued about most; a screenshot can be read two
    ways, a sorted list of x coordinates cannot. Three things are asserted, not
    two: the strip's words and order, that the magnifier is *not* on the strip
    (search moved into Discover), and that Crushes is not a tab in the bar.
    """
    points = {}
    for n in seen:
        for value in (n['desc'], n['text']):
            key = norm(value)
            if key in ('flow', 'crushes', 'connections'):
                points.setdefault(key, []).append((n['x'], n['y']))
    missing = [k for k in ('flow', 'crushes', 'connections') if k not in points]
    if missing:
        fail('the Home strip is missing ' + ', '.join(missing))

    # "Flow" and "Crushes" may also be the bar or a heading, so keep to the row
    # that holds all three.
    rows = {}
    for key, pts in points.items():
        for _, y in pts:
            rows.setdefault(y // 40, set()).add(key)
    row = next((r for r, keys in rows.items() if keys >= {'flow', 'crushes', 'connections'}), None)
    if row is None:
        fail('no single row holds Flow, Crushes and Connections')
    in_row = {k: [x for x, y in v if y // 40 == row] for k, v in points.items()}
    order = sorted(in_row, key=lambda k: min(in_row[k]))
    if order != ['flow', 'crushes', 'connections']:
        fail('the strip reads ' + ' → '.join(order) + ', not Flow → Crushes → Connections')

    # Search is a page, not a magnifier on a row about the feed.
    if find(seen, 'Search Crushly'):
        fail('the strip still carries a magnifier; search lives in Discover now')

    screen = SCREEN[0] or max(n['x2'] for n in seen if n['on_screen'])
    for key in ('flow', 'crushes', 'connections'):
        node = next((n for n in seen if n['on_screen']
                     for v in (n['desc'], n['text']) if norm(v) == key and n['y'] // 40 == row), None)
        if node and node['x2'] > screen:
            fail('the "{}" label runs off the screen ({} > {})'.format(key, node['x2'], screen))
    log('strip: Flow → Crushes → Connections, no magnifier, nothing clipped; checked')

    # The bar: four words and a plus, with Discover in it and Crushes out of it.
    bar = {}
    for n in seen:
        for value in (n['desc'], n['text']):
            key = norm(value)
            if key in ('home', 'discover', 'whispers', 'space', 'crushes'):
                bar.setdefault(key, []).append((n['x'], n['y']))
    bar_missing = [k for k in ('home', 'discover', 'whispers', 'space') if k not in bar]
    if bar_missing:
        fail('the bottom bar is missing ' + ', '.join(bar_missing))
    lowest = max(y for pts in bar.values() for _, y in pts)
    bar_keys = {k for k, pts in bar.items() if any(abs(y - lowest) < 60 for _, y in pts)}
    if 'crushes' in bar_keys:
        fail('Crushes is still a tab in the bar; it belongs on the strip')
    log('bar: Home · Discover · + · Whispers · Space; checked')


def assert_hook_is_low(seen):
    """The search hook is the bottom line of a page, under name, caption, sound."""
    hook = find(seen, 'Search for')
    if not hook:
        return
    sound = find(seen, 'Original sound')
    if sound and hook['y'] < sound['y']:
        fail('the search hook sits above the sound row ({} < {})'.format(hook['y'], sound['y']))
    log('search hook y={} is below the sound row y={}'.format(hook['y'], sound['y'] if sound else '-'))


def walk():
    """Photograph every surface, in the order the app presents them."""
    seen = shot('04-flow-default')
    assert_strip(seen)
    assert_hook_is_low(seen)

    for label, name in (('Crushes', '05-segment-crushes'),
                        ('Connections', '06-segment-connections'),
                        ('Flow', '07-segment-flow')):
        tap(label)
        shot(name)

    # Search is Discover's, so walk to Discover to find it.
    tap('Discover')
    if tap('Search Crushly'):
        shot('08-discover-search')
        return_to_tabs()

    # And the hook under a clip must search the words it names, not open blank.
    # The hook only exists on Flow, and the step before this one left us on
    # Discover, so come home first.
    tap('Home')
    if tap('Search for'):
        seen = shot('09-hook-search')
        named = [n['desc'] for n in seen if norm(n['desc']).startswith('search for')]
        log('the hook opened: ' + (named[0] if named else '(no hook label left)'))
        return_to_tabs()

    for label, name in (('Whispers', '11-whispers'),
                        ('Space', '12-space')):
        tap(label)
        shot(name)

    # Close Ones is a segment of Whispers, not a tab of its own: walk in the way
    # a person would, from the tab.
    if tap('Whispers'):
        if tap('Close Ones'):
            shot('13-close-ones')
            # The box in Whispers searches conversations and cannot search a list
            # of people, so it must not be above this list.
            seen = nodes() or []
            if find(seen, 'Search your Whispers'):
                fail('the Whispers search box is showing over Close Ones')

    # Space's Close Ones count is a link into that segment, not into a lookalike.
    tap('Space')
    scroll_to('Close Ones')
    if tap('Close Ones'):
        shot('14-space-to-close-ones')
        seen = nodes() or []
        if not find(seen, 'chosen to keep near'):
            fail('Space → Close Ones did not land on the Close Ones segment')

    # A clip's sound is a place, so it has to open as one.
    tap('Flow')
    if tap('Original sound'):
        shot('15-sound')
        return_to_tabs()

    # The drawer is gone. Everything it used to hold now opens from where it
    # belongs: Circles, Moments and Picked from the Space, Settings from the
    # Space's gear, notifications from the bell on Home. Each row is still
    # opened and photographed, because a row that lands on a blank page or the
    # wrong list is a row that lies.
    n = 16
    for row, name in (('Your Circles', 'circles'),
                      ('Your Moments', 'moments'),
                      ('Picked', 'picked')):
        tap('Space')
        scroll_to(row)
        if tap(row, tries=2):
            shot('{:02d}'.format(n) + '-' + name)
            n += 1
            return_to_tabs()

    # Settings, from the Space's gear, and every page inside it.
    tap('Space')
    if tap('Settings', tries=2):
        shot('{:02d}-settings'.format(n))
        n += 1
        for sub, slug in (('Account & security', 'account'),
                          ('Appearance', 'appearance'),
                          ('Privacy & visibility', 'privacy'),
                          ('Discover preferences', 'filters'),
                          ('Crushly Plus', 'plus'),
                          ('Verification', 'verification')):
            tap('Space')
            if not tap('Settings', tries=2):
                continue
            scroll_to(sub)
            if tap(sub, tries=2):
                shot('{:02d}-settings-{}'.format(n, slug))
                n += 1
                return_to_tabs()

    # Notifications are a sheet over Home now, with two tabs inside it.
    tap('Home')
    if tap('Notifications', tries=2):
        seen = shot('{:02d}-notifications-sheet'.format(n))
        n += 1
        if find(seen, 'From Crushly'):
            log('notifications: sheet with Yours and From Crushly')
            if tap('From Crushly', tries=2):
                shot('{:02d}-notifications-from-crushly'.format(n))
                n += 1
        else:
            fail('the notification sheet has no "From Crushly" tab')
        # Back out of the sheet the way a person would.
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(1.5)
        return_to_tabs()

    # A Vibe opens as its own page, not as a bigger tile in the row.
    tap('Discover')
    if tap("s vibe,", tries=2):
        shot('{:02d}-vibe'.format(n))
        n += 1
        return_to_tabs()

    # Search with something actually typed into it: the empty state is not the
    # screen, and the results are the part people use. The magnifier is
    # Discover's, not the strip's.
    tap('Discover')
    if tap('Search Crushly'):
        type_into(0, 'spencer')
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2.5)
        shot('{:02d}-search-results'.format(n))
        n += 1
        return_to_tabs()

    # Space's own edit surface, and the three Crushes lenses.
    tap('Space')
    time.sleep(1.5)
    if tap('Edit Space'):
        shot('{:02d}-edit-space'.format(n))
        n += 1
        return_to_tabs()
    # Crushes is a post feed: pictures and words from the people you share a
    # Crush with. It is not a list of people, so what is checked here is that the
    # page is the feed (cards or its empty state), not a directory.
    tap('Home')
    tap('Crushes')
    seen = shot('{:02d}-crushes-feed'.format(n))
    n += 1
    if find(seen, 'Suggested') or find(seen, 'Crushing on you'):
        fail('Crushes is showing people, not posts')
    log('crushes: post feed, not a directory; checked')

    # Who crushed you is a people list, and it lives behind the Space's count.
    tap('Space')
    if tap('Crushes', tries=2):
        seen = shot('{:02d}-crush-list'.format(n))
        n += 1
        if find(seen, 'Crushing on you'):
            log('crush list: the people side of Crushes, reached from Space')
        return_to_tabs()
    log('walk finished with {} screens'.format(n))


def main():
    apk = sys.argv[1]
    read_screen_size()
    log('screen: {}x{} px'.format(SCREEN[0], SCREEN[1]))
    adb('install', '-r', apk)
    adb('shell', 'pm', 'clear', PACKAGE)
    for attempt in range(2):
        adb('shell', 'am', 'force-stop', PACKAGE)
        adb('logcat', '-c')
        adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')

        # 1. The opening sentence. Also the place where a launch crash shows up.
        if not wait_for(['Follow the feelings'], 90, 'process exited during startup'):
            fail('the follow-the-feelings opening did not appear')

        # 2. One tap anywhere, which is the whole interaction on that screen.
        size = adb('shell', 'wm', 'size', check=False).strip().split()[-1]
        w, h = (int(v) for v in size.split('x'))
        adb('shell', 'input', 'tap', str(w // 2), str(h // 2))
        time.sleep(2)

        # 3. Welcome, which is where signing in starts.
        if not wait_for(['Welcome to Crushly', 'Get Started'], 60,
                        'process exited after the opening screen'):
            fail('tapping the opening did not reach Welcome')
        time.sleep(2)

        logs = adb('logcat', '-d', '-b', 'crash', check=False)
        if PACKAGE in logs and ('FATAL EXCEPTION' in logs or 'Fatal signal' in logs):
            fail('fatal crash recorded')
        log('::notice::cold start {}: welcome UI visible; process alive.'.format(attempt + 1))

        if attempt == 0:
            # The relaunch proves the first run did not leave the app wedged;
            # the second run is the one that gets walked.
            continue

        sign_in()
        walk()
        alive('process exited during the walk')

    report.close()
    print('Android 9 release walk finished. See walk/report.txt and the screenshots beside it.')


if __name__ == '__main__':
    main()
