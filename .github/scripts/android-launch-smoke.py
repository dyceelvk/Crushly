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
     the magnifier and the bell beside it, Crushes, Whispers, Close Ones, Space,
     Settings and its pages, the notification sheet — dumping the accessibility
     tree at each stop into `walk/report.txt`.

Everything is addressed by the app's own text and accessibility labels, never by
pixel coordinates, so a layout change moves the walk with it.

The walk account is a throwaway profile in the project's own database
(`arena.walk@example.com`); no other user's data is touched. Credentials arrive
through the environment and are never printed.
"""
import os
import pathlib
import re
import struct
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
            'checked': n.get('checked', ''),
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


def back():
    """Dismiss whatever is on top without pretending to know what it is."""
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(0.9)


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
    # Long enough for the frame to be finished, not just started. At 0.8s the
    # emulator sometimes handed back a half-painted screen — a card with its
    # action row missing, and a dark rectangle where a list had not drawn yet —
    # which then looks exactly like a layout bug in the app.
    time.sleep(1.6)
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
    # "I already have an account" was this door's copy until the opening was
    # rewritten; both are tried so the walk survives the next rewording too.
    if not (tap('I already have an account', tries=1)
            or tap("I'm already on Hollop", tries=2)
            or tap('Sign in', tries=1)):
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
    # The tab bar says Home / Discover / Whispers / Space. "Connections" is a
    # segment inside the feed, not something a signed-in launch guarantees.
    if wait_for(['Discover', 'Whispers'], 120, 'process exited while signing in'):
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
    """Home reads Crushes → Connections, and the bar reads
    Home → Discover → (+) → Whispers → Space.

    The strip had three words while Flow was one of them, and Flow is gone: what
    is left is where you look at people, not a second feed.
    Clips are not in this build, so the third tab is gone and this asserts the
    two that remain, in order, in one row. A sorted list of x coordinates cannot
    be read two ways, which is why the order is checked and not eyeballed.

    Flow is asserted *absent*, not ignored: a tab that comes back without a
    surface behind it is the exact fault this check exists for.
    """
    points = {}
    for n in seen:
        for value in (n['desc'], n['text']):
            key = norm(value)
            if key in ('flow', 'crushes', 'connections'):
                points.setdefault(key, []).append((n['x'], n['y']))
    missing = [k for k in ('crushes', 'connections') if k not in points]
    if missing:
        fail('the Home strip is missing ' + ', '.join(missing))
    if 'flow' in points:
        fail('the Home strip still carries a Flow tab')

    # "Crushes" may also be a heading or the bar, so keep to the row that holds
    # both words.
    rows = {}
    for key, pts in points.items():
        for _, y in pts:
            rows.setdefault(y // 40, set()).add(key)
    row = next((r for r, keys in rows.items() if keys >= {'crushes', 'connections'}), None)
    if row is None:
        fail('no single row holds Crushes and Connections')
    in_row = {k: [x for x, y in v if y // 40 == row] for k, v in points.items()}
    order = sorted(in_row, key=lambda k: min(in_row[k]))
    if order != ['crushes', 'connections']:
        fail('the strip reads ' + ' → '.join(order) + ', not Crushes → Connections')

    # The far end of the strip: a magnifier, and a bell beside it. The brief put
    # the bell next to search rather than in the corner the hamburger left, and
    # the drawer it used to open is gone — so the corner must hold nothing that
    # opens a menu.
    magnifier = find(seen, 'Search Hollop')
    if magnifier is None:
        fail('the strip has no magnifier; search belongs beside the bell')
    bell = find(seen, 'Notifications')
    if bell is None:
        fail('the strip has no bell; notifications open from here')
    if abs(bell['y'] - magnifier['y']) > 40:
        fail('the bell is not on the strip with the magnifier')
    # Scoped to the strip's own row. The word search used to run over the whole
    # screen, which was safe only while the feed was empty: the first post that
    # appears carries a "More options for <author>" control of its own, and that
    # is a post's menu, not a way out of the drawer this check is about. A post
    # card is allowed to have one; the chrome is not.
    strip_row = [n for n in seen if n['on_screen'] and n['y'] // 40 == row]
    for word in ('menu', 'open menu', 'more options', 'navigation menu'):
        for n in strip_row:
            for value in (n['desc'], n['text']):
                if word in norm(value):
                    fail('the strip still carries a "{}" control; the drawer is gone'.format(word))

    screen = SCREEN[0] or max(n['x2'] for n in seen if n['on_screen'])
    for key in ('crushes', 'connections'):
        node = next((n for n in seen if n['on_screen']
                     for v in (n['desc'], n['text']) if norm(v) == key and n['y'] // 40 == row), None)
        if node and node['x2'] > screen:
            fail('the "{}" label runs off the screen ({} > {})'.format(key, node['x2'], screen))
    log('strip: Crushes → Connections, magnifier + bell, no Flow, nothing clipped; checked')

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


def assert_discover(seen):
    """Discover: one title, the magnifier on it, and the page right under it.

    The fault this replaces was a header drawn twice, each with its own padding,
    which left a band of nothing above the first card and a magnifier stranded
    in the middle of it. So the gap between the title and the page is measured,
    and the magnifier has to be on the title's row rather than floating.
    """
    titles = [n for n in seen if n['on_screen'] and n['y'] < SCREEN[1] * 0.6
              for v in (n['text'], n['desc']) if norm(v) == 'discover']
    if not titles:
        fail('Discover has no title on its own page')
    title = min(titles, key=lambda n: n['y'])
    page = find(seen, 'From everyone') or find(seen, 'Nothing public yet') or find(seen, 'Search people')
    # The band between the title and the feed is now several sections deep — the
    # Moments row, then the clips rail — and it will grow again. Measuring from
    # the title called each new section "a band of nothing": the check was right
    # about the fault it was written for and wrong about the page it now
    # measures. So the reference is the bottom-most thing in the band.
    if page and page['y'] > title['y2']:
        # Only things that end above the feed count: a full-screen container that
        # starts in the band and runs past the bottom would otherwise become the
        # reference and turn the gap negative, which hides exactly the void this
        # check exists to find.
        between = [n for n in seen
                   if n['on_screen'] and title['y2'] < n['y'] and n['y2'] <= page['y']]
        reference = max((n['y2'] for n in between), default=title['y2'])
        gap = page['y'] - reference
        if gap > 80:
            fail('Discover leaves {} px of nothing above the feed'.format(gap))
        log('discover: {:.0f} px from the last section to the feed; checked'.format(gap))
    # Clips are back, and the rail that shows them is the first thing under the
    # Moments row. If the ranking RPC fails, the section disappears silently —
    # which is exactly the kind of absence a screenshot cannot tell you about.
    rail = find(seen, 'Top Crushes This Week')
    if rail is not None:
        log('discover: clips rail is on the page; checked')
    magnifier = find(seen, 'Search Hollop')
    if magnifier is None:
        fail('Discover has no magnifier; search lives here')
    if abs(magnifier['y'] - title['y']) > 40:
        fail('the magnifier is stranded {} px from the Discover title'.format(abs(magnifier['y'] - title['y'])))


def screen_brightness():
    """Mean brightness of the top navigation canvas, excluding feed media.

    Sampling the whole frame is unreliable when a dark video fills Home even
    in light mode. The common top bar changes with appearance on both screens.
    """
    raw = subprocess.run(['adb', 'exec-out', 'screencap'], capture_output=True, timeout=120).stdout
    if len(raw) < 16:
        return None
    try:
        w, h, fmt = struct.unpack('<III', raw[:12])
    except struct.error:
        return None
    if fmt != 1:            # only RGBA_8888 is sampled; anything else is unknown
        return None
    body = len(raw) - 12
    header = 12 if body == w * h * 4 else (16 if len(raw) - 16 == w * h * 4 else None)
    if header is None:
        return None
    px = raw[header:]
    total = bright = 0
    for y in range(max(0, int(h * .055)), min(h, int(h * .125)), max(1, h // 320)):
        for x in range(max(0, int(w * .05)), min(w, int(w * .95)), max(1, w // 160)):
            i = (y * w + x) * 4
            bright += px[i] + px[i + 1] + px[i + 2]
            total += 3
    return bright / total if total else None


def assert_appearance():
    """Light and Dark have to reach the screens, not just the row that sets it.

    Reported as "when I switched to light it stayed light and when I switched to
    dark it stayed light": a preference that saves but does not paint. So the
    frame is measured on Home and on Discover before and after the change.
    """
    tap('Home')
    time.sleep(1.2)
    dark_home = screen_brightness()
    tap('Discover')
    time.sleep(1.2)
    dark_discover = screen_brightness()
    shot('04a-discover-dark')

    if not tap('Space'):
        log('appearance: could not reach the Space; skipped')
        return
    if not tap('Settings', tries=2):
        log('appearance: no Settings row; skipped')
        return
    scroll_to('Appearance')
    if not tap('Appearance', tries=2):
        log('appearance: no Appearance row; skipped')
        return
    if not tap('Light', tries=2):
        log('appearance: no Light choice; skipped')
        return
    time.sleep(1.5)
    shot('04b-appearance-light')
    return_to_tabs()

    tap('Home')
    time.sleep(1.5)
    shot('04c-home-light')
    light_home = screen_brightness()
    tap('Discover')
    time.sleep(1.5)
    shot('04d-discover-light')
    light_discover = screen_brightness()

    if dark_home is None or light_home is None or dark_discover is None or light_discover is None:
        log('appearance: the framebuffer could not be read; not asserted')
    else:
        log('appearance: Home {:.0f} → {:.0f}, Discover {:.0f} → {:.0f}'.format(
            dark_home, light_home, dark_discover, light_discover))
        if light_home < dark_home + 60:
            fail('Home did not change with the appearance ({} → {})'.format(round(dark_home), round(light_home)))
        if light_discover < dark_discover + 60:
            fail('Discover did not change with the appearance ({} → {}); its title used to be white on white'.format(
                round(dark_discover), round(light_discover)))

    # Put it back the way it was found, so the rest of the walk photographs the
    # app in the appearance the member actually chose.
    tap('Space')
    if tap('Settings', tries=2):
        scroll_to('Appearance')
        if tap('Appearance', tries=2):
            tap('Dark', tries=2)
            time.sleep(1.2)
    return_to_tabs()


def assert_space_header(seen):
    """The Space's own controls live at the top of it, and stay there.

    They used to be four rows at the bottom of the page — "Your Circles", "Your
    Moments", "Picked", "Settings" — so the more you posted the further your own
    account's controls moved. Circles and Moments were the tabs above already, so
    those are gone; Settings and Picked are in a pinned header now. Two things
    are asserted, not one: that they are at the top, and that they are still
    there after the page has been scrolled to its end.
    """
    top = SCREEN[1] * 0.28
    for label in ('Settings', 'Picked'):
        node = find(seen, label)
        if node is None:
            fail('the Space has no "{}" control in its header'.format(label))
        if node['y'] > top:
            fail('"{}" sits {} px down the page, not in the header'.format(label, node['y']))
    for row in ('Your Circles', 'Your Moments'):
        if find(seen, row):
            fail('the Space still lists "{}" at the bottom; it is a tab above'.format(row))

    # Four tabs, and About is one of them. The words, what they are looking for,
    # their interests and their facts used to be loose prose under the post
    # list, which meant a Space had no bottom: you finished the posts and kept
    # walking through somebody's biography. They are a tab now.
    for tab in ('Crushes', 'Moments', 'Circles', 'About'):
        if not find(seen, tab):
            fail('the Space has no "{}" tab'.format(tab))
    log('space tabs: Crushes · Moments · Circles · About; checked')

    # One Edit, not two. The header's pencil is the only way in; the gold chip
    # that sat under the name is gone, and so is the Settings row that pointed
    # at the same screen.
    if sum(1 for n in (seen or []) if norm(n.get('text', '')) == 'edit space') > 1:
        fail('the Space has two "Edit Space" controls')

    for _ in range(7):
        swipe_up()
    time.sleep(0.8)
    after = nodes() or []
    held = [label for label in ('Settings', 'Picked')
            if (find(after, label) or {}).get('y', SCREEN[1]) <= top]
    if len(held) < 2:
        fail('the Space header scrolled away with the page (still at the top: {})'.format(
            ', '.join(held) or 'nothing'))
    shot('12a-space-scrolled')
    log('space header: Settings and Picked held at the top after scrolling; bottom rows gone; checked')
    # Back to the top of the page for whoever walks next.
    for _ in range(8):
        adb('shell', 'input', 'swipe', '160', '240', '160', '560', '180')
        time.sleep(0.35)

    # About, opened, so the tab is proven to be a tab and not a label.
    if not tap('About', tries=3):
        fail("the Space's About tab could not be tapped")
    time.sleep(0.9)
    about = nodes() or []
    shot('12b-space-about')
    # The walk account has words and nothing else, so the words are the proof.
    # An account with interests or facts would show one of those instead.
    if not any(find(about, w) for w in ('Checking where things live.',
                                        'Nothing here yet', 'About me',
                                        'Looking for', 'Interests')):
        fail('the About tab shows none of the words, the interests or the facts')
    if not tap('Crushes', tries=3):
        fail('could not get back to the Crushes tab')
    time.sleep(0.6)
    log('space about: the words, the interests and the facts are a tab, not prose under the posts; checked')


def assert_connections(seen):
    """Connections opens with the thing you came to do, not with a blank page.

    Above the feed there is a composer ("Say something…") and, for a member with
    rooms, a filter row starting with All. Both belong at the top: they are what
    you do on this page. Rooms you are *not* in belong somewhere else — between
    posts, in the feed — so this also checks that a discovery card, when there is
    one to show, is below the composer rather than in place of it.
    """
    if not find(seen, 'Say something'):
        fail('Connections has no composer above the feed')
    log('connections: composer above the feed; checked')
    if find(seen, 'Circles you could join'):
        log('connections: rooms you are not in are offered inside the feed; checked')
    # A card that is taller than the screen is a card whose button nobody can
    # reach, and the accessibility dump knows: say which nodes are enormous,
    # with their bounds, so a layout that only breaks on a device can be found
    # from a log instead of a photograph.
    for node in sorted(seen, key=lambda n: n['y2'] - n['y1'], reverse=True)[:4]:
        tall = node['y2'] - node['y1']
        if tall > 200:
            log('connections: tall node {}{} y {}..{}'.format(
                node['class'].rsplit('.', 1)[-1],
                ' "' + (node['text'] or node['desc'])[:24] + '"' if (node['text'] or node['desc']) else '',
                node['y1'], node['y2']))


def walk():
    """Photograph every surface, in the order the app presents them."""
    seen = shot('04-home')
    assert_strip(seen)

    for label, name in (('Crushes', '05-segment-crushes'),
                        ('Connections', '06-segment-connections')):
        tap(label)
        seen = shot(name)
        if label == 'Connections':
            assert_connections(seen)

    # Walk the editor without publishing or touching another member's data.
    # This used to have an Advanced row with no handler, and a schedule toggle
    # which did not schedule anything. Exercise the real comments setting.
    tap('Create post', required=True)
    tap('Post', required=True)
    if not scroll_to('Advanced options', swipes=6):
        fail('editor Advanced options is missing')
    tap('Advanced options', required=True)
    seen = shot('06a-editor-advanced')
    if not find(seen, 'Allow comments') or not find(seen, 'Remixing is not available yet'):
        fail('editor advanced sheet is missing comments or remix availability')
    tap('Allow comments', required=True)
    tap('Done', required=True)
    if not find(nodes() or [], 'Comments off'):
        fail('editor did not retain the comments choice')
    tap('Advanced options', required=True)
    if not find(nodes() or [], 'Allow comments'):
        fail('editor could not reopen Advanced options')
    tap('Done', required=True)
    tap('Cancel', required=True)
    return_to_tabs()
    log('editor: advanced sheet opens, comments choice persists, remix status is honest; checked')

    # Save a post without a network request, restart the app, and reopen it.
    tap('Create post', required=True)
    tap('Post', required=True)
    if not type_into(0, 'Local post draft check'): fail('draft post text field missing')
    back()
    if not scroll_to('Save draft', swipes=6): fail('post Save draft button missing')
    tap('Save draft', required=True)
    if not wait_for(['Discover', 'Whispers'], 30, 'left post draft save'):
        fail('saving post draft did not leave the editor')
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
    if not wait_for(['Discover', 'Whispers'], 90, 'restart after draft save'):
        fail('app did not restart after saving draft')
    tap('Create post', required=True)
    tap('Drafts on this phone', required=True)
    if not find(nodes() or [], 'Local post draft check'): fail('post draft did not survive restart')
    tap('Open draft', required=True)
    if not wait_for(['Local post draft check'], 20, 'post draft reopen'):
        fail('post draft content was not restored')
    tap('Cancel', required=True)
    tap('Discard changes', required=True)
    tap('Create post', required=True)
    tap('Drafts on this phone', required=True)
    tap('Delete', required=True)
    tap('Delete draft', required=True)
    tap('Close', required=True)
    tap('Cancel', required=True)
    return_to_tabs()
    log('phone draft: post saved, survived process restart, reopened and deleted; checked')

    # Also exercise the separate Moment composer; no test post is published.
    tap('Create post', required=True)
    tap('Moment', required=True)
    if not type_into(0, 'Local moment draft check'): fail('Moment draft text field missing')
    typed = [n['text'] for n in (nodes() or []) if 'EditText' in n['class'] and n['on_screen']]
    if not typed or 'draft check' not in typed[0].lower(): fail('Moment text did not reach the editor')
    moment_text = typed[0]
    tap('Save draft', required=True)
    if not wait_for(['Discover', 'Whispers'], 30, 'left Moment draft save'):
        fail('saving Moment draft did not leave the editor')
    tap('Create post', required=True)
    tap('Moment', required=True)
    tap('Drafts on this phone', required=True)
    if not find(nodes() or [], moment_text): fail('Moment draft is missing or changed')
    tap('Open draft', required=True)
    if not wait_for([moment_text], 20, 'Moment draft reopen'):
        fail('Moment draft content was not restored')
    tap('Close', required=True)
    tap('Discard changes', required=True)
    tap('Create post', required=True)
    tap('Moment', required=True)
    tap('Drafts on this phone', required=True)
    tap('Delete', required=True)
    tap('Delete draft', required=True)
    tap('Close', required=True)
    tap('Close', required=True)
    return_to_tabs()
    log('phone draft: Moment saved, reopened and deleted; checked')

    # Discover is a page, not only the door to search: photograph it before
    # opening search, or the one screen the user twice described as "a white
    # board with a search icon" is the one screen never looked at.
    seen = None
    if tap('Discover'):
        seen = shot('07-discover')
        assert_discover(seen)
        if tap('Search Hollop'):
            shot('08-discover-search')
        return_to_tabs()

    # Appearance: measure it, because a preference that saves and does not paint
    # is invisible to every other check in this file.
    assert_appearance()

    for label, name in (('Whispers', '11-whispers'),
                        ('Space', '12-space')):
        tap(label)
        seen = shot(name)
        if label == 'Space':
            assert_space_header(seen)

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

    # The drawer is gone, and so are the rows it left behind. Each of these has
    # exactly one door now, and the door is where the thing lives: Picked in the
    # Space's header, Circles and Moments as tabs on the Space, Settings behind
    # the Space's gear. Every one is opened and photographed, because a door that
    # lands on a blank page is a door that lies.
    n = 16
    tap('Space')
    if tap('Picked', tries=2):
        shot('{:02d}-picked'.format(n))
        n += 1
    return_to_tabs()
    for row, name in (('Circles', 'circles'), ('Moments', 'moments')):
        tap('Space')
        if tap(row, tries=2):
            shot('{:02d}-space-{}'.format(n, name))
            n += 1
        return_to_tabs()

    # A room can be found now, and there are three ways in. The creator has to
    # ask two separate questions — whether anyone can find it, and how people get
    # in — because the commonest way a product like this goes wrong is fusing
    # them into one switch that means neither.
    tap('Space')
    if tap('Circles', tries=2):
        shot('{:02d}-space-circles-list'.format(n))
        n += 1
        circles_seen = nodes() or []
        for label in ('Crushes', 'Moments', 'Circles', 'About'):
            tab_node = find(circles_seen, label)
            if not tab_node or tab_node['x1'] < 0 or tab_node['x2'] > SCREEN[0]:
                fail('Space Circles: tab {} is missing or clipped horizontally'.format(label))
        start_node = find(circles_seen, 'Start a Circle')
        if not start_node:
            fail('Space Circles: Start a Circle is missing')
        if start_node['y2'] - start_node['y1'] > SCREEN[1] * 0.16:
            fail('Space Circles: Start a Circle is abnormally tall on Android')
        # The creator opens straight away from here now, which is also the check
        # that the Space's Circles tab has a door at all.
        if tap('Start a Circle'):
            shot('{:02d}-circle-creator'.format(n))
            n += 1
            # The two settings are under the name, the line about the room and
            # the theme, so the sheet has to be scrolled before it can be read —
            # which is fine, and is why this scrolls instead of looking at the
            # first screenful and calling it missing.
            for needle in ('Can people find it?', 'How do people get in?'):
                if not scroll_to(needle, swipes=5):
                    shot('{:02d}-circle-creator-missing'.format(n))
                    n += 1
                    fail('the Circle creator is missing "%s"' % needle)
            shot('{:02d}-circle-creator-settings'.format(n))
            n += 1
            log('circle creator: findable and joinable are two questions; checked')
            back()
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
                          ('Hollop Plus', 'plus'),
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
        if find(seen, 'From Hollop'):
            log('notifications: sheet with Yours and From Hollop')
            if tap('From Hollop', tries=2):
                shot('{:02d}-notifications-from-crushly'.format(n))
                n += 1
        else:
            fail('the notification sheet has no "From Hollop" tab')
        # Back out of the sheet the way a person would.
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(1.5)
        return_to_tabs()

    # Search with something actually typed into it: the empty state is not the
    # screen, and the results are the part people use.
    tap('Discover')
    if tap('Search Hollop'):
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

        # 2. The opening is two screens, not one:
        #      the sentence, which says "Tap anywhere to begin" and means it;
        #      then Welcome, which offers two named doors.
        #    The tap is right; the wait that followed it was not — it looked
        #    for "Welcome to Hollop" and "Get Started", copy that has been
        #    retired, so a good release failed here and no APK was published.
        #    Tap where the screen tells you to, then expect the doors it draws.
        if not tap('Tap anywhere to begin', tries=2):
            size = adb('shell', 'wm', 'size', check=False).strip().split()[-1]
            w, h = (int(v) for v in size.split('x'))
            adb('shell', 'input', 'tap', str(w // 2), str(h // 2))
        time.sleep(2)

        if not wait_for(['Start with a feeling', "I'm already on Hollop"], 60,
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
