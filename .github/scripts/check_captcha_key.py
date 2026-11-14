#!/usr/bin/env python3
"""Refuse to build an app whose captcha site key cannot possibly work.

This exists because 1.0.111 through 1.0.114 shipped with

    0x4AAAAAAF_cVwIC4n5lJE8ca1a84037fdb644723129315c390ad9

— the real 24-character Turnstile key with a 30-character hex string pasted onto
the end of it. Cloudflare's widget answered "Invalid sitekey. Contact the Site
Administrator", no token was ever produced, and Supabase refused every sign-in
and sign-up with `captcha_failed`. From the phone that looked like a check that
would not pass, which is exactly how it was reported.

Nothing in the app can repair a key that is wrong; what can be done is to stop
the build. The key is public (it ships inside the APK), so validating its shape
here leaks nothing.

Rules:
  * unset is allowed — the check is then off, and the app behaves as before;
  * a 24-character key is required otherwise;
  * the key may be surrounded by whitespace or quotes, and anything after the
    24th character is dropped, because that is the shape of the mistake that
    happened. The corrected value is printed so it can be pasted back into the
    repository secret.
"""
from __future__ import annotations

import os
import re
import sys

KEYS = ("EXPO_PUBLIC_TURNSTILE_SITE_KEY",)
PATTERN = re.compile(r"0x4[A-Za-z0-9_-]{21}")


def normalize(raw: str) -> str:
    value = raw.strip().strip("'\"").replace("\n", "").replace("\r", "").replace(" ", "")
    start = value.find("0x4")
    if start < 0:
        return ""
    candidate = value[start:start + 24]
    return candidate if PATTERN.fullmatch(candidate) else ""


def main() -> int:
    checked = 0
    for name in KEYS:
        raw = os.environ.get(name, "")
        if not raw.strip():
            print(f"{name} is not set: the bot check is off in this build.")
            continue
        checked += 1
        good = normalize(raw)
        if not good:
            print(
                f"::error::{name} is not a Turnstile site key. A key is exactly 24 "
                f"characters, starting 0x4AAAAAA…; got {len(raw.strip())} characters.\n"
                "Cloudflare would answer 'Invalid sitekey' and every sign-in would be "
                "refused. Fix the repository secret (or remove it to build without the check).",
                file=sys.stderr,
            )
            return 1
        if good != raw.strip():
            # Not a failure: the extra characters are the bug, and the fix is the
            # first 24. Say so loudly so the secret itself gets corrected.
            print(
                f"::warning::{name} has extra characters after the site key. "
                f"Building with the real key instead: {good}\n"
                f"Please update the repository secret to exactly that value."
            )
        else:
            print(f"{name} is a valid 24-character site key.")
    if checked == 0:
        print("No captcha key to validate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
