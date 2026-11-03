#!/usr/bin/env python3
"""
Walk the installed Crushly APK the way a person would.

This is the missing half of shipping an Android build: a compiler cannot tell
you that the strip is ordered wrong, that a caption is hidden under the tab
bar, or that a link lands on the wrong segment. Only the running app can. This
script boots nothing — it expects an emulator already attached to `adb` (see
`.github/workflows/apk-walk.yml`) — and then, at each step:

  * dumps the accessibility tree so the app is addressed by its own labels
    rather than by hard-coded coordinates,
  * takes a screenshot,
  * records which labels were on screen, so the report can be read as text too.

Everything lands in `walk/` (screenshots) and `walk/report.txt`. The script
never pretends a step passed: if a label it needs is absent it writes MISSING
and keeps going, so a broken build still produces a full set of pictures.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = os.environ.get("CRUSHLY_PACKAGE", "app.crushly")
# A secret that is configured but empty must fall back to the test login, not
# try to sign in as nobody.
EMAIL = os.environ.get("CRUSHLY_WALK_EMAIL") or "arena.walk@example.com"
PASSWORD = os.environ.get("CRUSHLY_WALK_PASSWORD") or "Walk-pass-1234"
OUT = os.environ.get("CRUSHLY_WALK_OUT", "walk")

os.makedirs(OUT, exist_ok=True)
REPORT = open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8")


def log(msg: str) -> None:
    print(msg, flush=True)
    REPORT.write(msg + "\n")
    REPORT.flush()


def adb(*args: str, capture: bool = True) -> str:
    res = subprocess.run(["adb", *args], capture_output=capture, text=True, timeout=180)
    return (res.stdout or "") if capture else ""


def dump() -> list[dict]:
    """Every node in the current window, flattened."""
    # `uiautomator dump` writes to the device then we pull the file: /dev/tty
    # truncates on some API levels, and a half-parsed tree is worse than none.
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    raw = adb("exec-out", "cat", "/sdcard/ui.xml")
    start = raw.find("<?xml")
    if start < 0:
        return []
    try:
        root = ET.fromstring(raw[start:].strip())
    except ET.ParseError:
        return []
    nodes = []
    for n in root.iter("node"):
        text = n.get("text", "") or ""
        desc = n.get("content-desc", "") or ""
        cls = n.get("class", "") or ""
        own = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
        if not own:
            continue
        x1, y1, x2, y2 = (int(v) for v in own.groups())
        nodes.append(
            {
                "text": text,
                "desc": desc,
                "class": cls,
                "checkable": n.get("checkable") == "true",
                "x": (x1 + x2) // 2,
                "y": (y1 + y2) // 2,
                "x1": x1,
                "y1": y1,
                "on_screen": y1 < 2300,
            }
        )
    return nodes


def labelled(nodes: list[dict]) -> list[str]:
    seen = []
    for n in nodes:
        for v in (n["text"], n["desc"]):
            v = v.strip()
            if v and v not in seen:
                seen.append(v)
    return seen


def find(nodes: list[dict], needle: str, *, cls: str | None = None) -> dict | None:
    want = needle.lower()
    pool = [n for n in nodes if (cls is None or cls in n["class"])]
    for key in ("text", "desc"):
        for n in pool:
            if n[key].strip().lower() == want:
                return n
    for key in ("text", "desc"):
        for n in pool:
            if want in n[key].strip().lower():
                return n
    return None


def shot(name: str, nodes: list[dict] | None = None) -> list[dict]:
    nodes = dump() if nodes is None else nodes
    time.sleep(0.6)
    png = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=120
    ).stdout
    path = os.path.join(OUT, f"{name}.png")
    with open(path, "wb") as f:
        f.write(png)
    log(f"[{name}] {os.path.getsize(path)} bytes | on screen: {' · '.join(labelled(nodes))[:400]}")
    return nodes


def tap(needle: str, *, cls: str | None = None, tries: int = 1) -> bool:
    for _ in range(tries):
        node = find(dump(), needle, cls=cls)
        if node:
            adb("shell", "input", "tap", str(node["x"]), str(node["y"]))
            time.sleep(1.6)
            return True
        time.sleep(1.2)
    log(f"MISSING: could not find {needle!r}")
    return False


def type_into(index: int, value: str) -> bool:
    """Type into the index-th text field. '@' survives `input text`; spaces do not."""
    fields = [n for n in dump() if "EditText" in n["class"]]
    if len(fields) <= index:
        log(f"MISSING: no text field #{index} (found {len(fields)})")
        return False
    adb("shell", "input", "tap", str(fields[index]["x"]), str(fields[index]["y"]))
    time.sleep(0.8)
    adb("shell", "input", "text", value.replace(" ", "%s"))
    time.sleep(0.6)
    return True


def sign_in() -> bool:
    fields = [n for n in dump() if "EditText" in n["class"]]
    if not fields:
        log("already signed in (no text fields on launch)")
        return True
    log(f"sign-in screen: {len(fields)} text field(s)")
    if not type_into(0, EMAIL):
        return False
    if len(fields) > 1:
        type_into(1, PASSWORD)
    if not (tap("Sign in") or tap("Continue") or tap("Log in")):
        return False
    time.sleep(6)
    return not [n for n in dump() if "EditText" in n["class"]]


def main() -> int:
    log(f"walking {PACKAGE}")
    adb("shell", "pm", "list", "packages", PACKAGE)
    adb("shell", "am", "force-stop", PACKAGE)
    activity = adb(
        "shell", "cmd", "package", "resolve-activity", "--brief", PACKAGE
    ).strip().splitlines()
    launcher = activity[-1].strip() if activity and "/" in activity[-1] else f"{PACKAGE}/.MainActivity"
    log(f"launcher: {launcher}")
    adb("shell", "am", "start", "-n", launcher)
    time.sleep(8)

    shot("00-launch")
    if not sign_in():
        shot("00-signin-failed")
        return 1
    time.sleep(4)
    shot("01-after-sign-in")

    # --- the Flow surface: three segments and the trailing magnifier ---
    for label, name in (
        ("Discover", "02-segment-discover"),
        ("Connections", "03-segment-connections"),
        ("Flow", "04-segment-flow"),
    ):
        if tap(label):
            shot(name)
    if tap("Search"):
        shot("05-search")
        adb("shell", "input", "keyevent", "KEYCODE_BACK")
        time.sleep(1.5)

    # --- bottom tabs ---
    for label, name in (
        ("Crushes", "06-crushes"),
        ("Whispers", "07-whispers"),
        ("Space", "08-space"),
    ):
        if tap(label):
            shot(name)

    # Close Ones lives inside Whispers, so walk in through the tab.
    if tap("Whispers"):
        if tap("Close Ones"):
            shot("09-close-ones")

    # --- the menu ---
    if tap("Everything else in Crushly"):
        shot("10-menu")
        if tap("Settings"):
            shot("11-settings")

    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
