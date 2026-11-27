#!/usr/bin/env python3
"""Refuse to publish an APK whose signer certificate set cannot update the
installed base in place.

Android compares the *set* of signer certificates when it allows an update.
1.0.133-1.0.136 shipped with Expo's public debug key only; 1.0.140 and 1.0.142
shipped with the production Holup key only; 1.0.141 shipped with BOTH (v1/v2
legacy debug + v3 production with a rotation lineage). A phone on 1.0.141
carries {debug, production}, so a standard-secure-only APK ({production}) is
rejected by the installer with "App not installed" - the 1.0.142 failure.

This check requires the published APK to carry the same certificate set the
installed base can accept: the legacy Expo debug key (v1/v2) and the production
Holup key (v3). Until every device has passed through a rotated build, a
standard-secure-only APK must not be published. Override the required set with
REQUIRED_SIGNER_FINGERPRINTS (comma-separated) only after the installed base no
longer carries the legacy key; the script then says so explicitly.

Usage: check_apk_signers.py <apk-path>
Exit 0 = the APK carries every required signer, 1 = it does not.
"""
import hashlib
import io
import struct
import sys
import zipfile

# Legacy Expo template debug key (what 1.0.133-1.0.136 and the v1/v2 blocks of
# the rotated 1.0.141 were signed with) and the production Holup release key
# (what the secure v3 block and the standard-secure builds carry).
LEGACY_DEBUG_FINGERPRINT = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'
PRODUCTION_FINGERPRINT = 'cda5c0a7ff47e02ecf8dcef9e22869a09dfe8377aeacb86948555fed097d4ee4'

APK_SIG_BLOCK_MAGIC = b'APK Sig Block 42'
V2_PAIR_ID = 0x7109871a
V3_PAIR_ID = 0xf05368c0


def _cert_fps_from_blob(blob):
    """Extract X.509 SHA-256 fingerprints from a v2/v3 'certificates' blob."""
    fps = []
    q = 0
    while q + 4 <= len(blob):
        (clen,) = struct.unpack_from('<I', blob, q)
        if q + 8 > len(blob):
            break
        fps.append(hashlib.sha256(blob[q + 4:q + 4 + clen]).hexdigest())
        q += 4 + clen
    return fps


def _cert_fps_from_signing_block(data):
    """Parse the APK Signing Block and return every v2/v3 signer fingerprint."""
    eocd = data.rfind(b'PK\x05\x06')
    if eocd < 0:
        return []
    cd_offset = struct.unpack_from('<I', data, eocd + 16)[0]
    if data[cd_offset - 16:cd_offset] != APK_SIG_BLOCK_MAGIC:
        return []
    block_size = struct.unpack_from('<Q', data, cd_offset - 24)[0]
    # Layout: [uint64 size][pairs ...][uint64 size][magic(16)]. The recorded
    # block_size excludes the leading size field, so the pairs region runs from
    # cd_offset - block_size to cd_offset - 24.
    pos = cd_offset - block_size
    end = cd_offset - 24
    fps = []
    while pos + 12 <= end:
        (pair_len,) = struct.unpack_from('<Q', data, pos)
        pair_id = struct.unpack_from('<I', data, pos + 8)[0]
        value = data[pos + 12:pos + 8 + pair_len]
        if pair_id in (V2_PAIR_ID, V3_PAIR_ID):
            # value: uint32 signer_count, then length-prefixed signers.
            if len(value) < 4:
                pos += 8 + pair_len
                continue
            (count,) = struct.unpack_from('<I', value, 0)
            p = 4
            for _ in range(count):
                if p + 4 > len(value):
                    break
                (slen,) = struct.unpack_from('<I', value, p)
                signer = value[p + 4:p + 4 + slen]
                if len(signer) < 4:
                    break
                (sd_len,) = struct.unpack_from('<I', signer, 0)
                sd = signer[4:4 + sd_len]
                if len(sd) < 4:
                    break
                (d_len,) = struct.unpack_from('<I', sd, 0)
                # signed_data = digests (length-prefixed) + certificates (length-prefixed)
                cert_len_off = 4 + d_len
                if cert_len_off + 4 > len(sd):
                    break
                (c_len,) = struct.unpack_from('<I', sd, cert_len_off)
                certs_blob = sd[cert_len_off + 4:cert_len_off + 4 + c_len]
                fps.extend(_cert_fps_from_blob(certs_blob))
                p += 4 + slen
        pos += 8 + pair_len
    return fps


def _cert_fps_from_v1(zf):
    """v1 signatures store a PKCS#7 blob in META-INF/*.RSA|DSA|EC."""
    fps = []
    for name in zf.namelist():
        base = name.rsplit('/', 1)[-1].upper()
        if name.startswith('META-INF/') and base.endswith(('.RSA', '.DSA', '.EC')):
            try:
                blob = zf.read(name)
                # PKCS#7 certs are embedded; extract with openssl if available.
                import subprocess
                import tempfile
                import pathlib
                with tempfile.NamedTemporaryFile(suffix='.der', delete=False) as fh:
                    fh.write(blob)
                    path = fh.name
                out = subprocess.run(
                    ['openssl', 'pkcs7', '-inform', 'DER', '-in', path,
                     '-print_certs', '-noout'],
                    text=True, capture_output=True)
                pathlib.Path(path).unlink(missing_ok=True)
                if out.returncode != 0:
                    continue
                for line in out.stdout.splitlines():
                    if line.startswith('sha256 Fingerprint='):
                        fps.append(line.split('=', 1)[1].replace(':', '').lower())
            except (ImportError, OSError, subprocess.SubprocessError):
                continue
    return fps


def apk_signer_fingerprints(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    fps = set(_cert_fps_from_signing_block(data))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        fps.update(_cert_fps_from_v1(zf))
    return fps


def main():
    if len(sys.argv) != 2:
        print('Usage: check_apk_signers.py <apk-path>')
        return 1
    apk = sys.argv[1]
    import os
    required = [fp.strip().lower() for fp in
                os.environ.get('REQUIRED_SIGNER_FINGERPRINTS',
                               f'{LEGACY_DEBUG_FINGERPRINT},{PRODUCTION_FINGERPRINT}').split(',')
                if fp.strip()]
    fps = apk_signer_fingerprints(apk)
    print('::notice::APK signer certificate SHA-256 fingerprints: '
          + (', '.join(sorted(fps)) if fps else 'none found'))
    missing = [fp for fp in required if fp not in fps]
    if missing:
        print(f'::error::{apk} is missing required signer(s): {', '.join(missing)}. '
              f'This APK cannot update devices that carry the other key(s) in place - '
              'the installer rejects it. Build it with build-rotated-android.yml.')
        return 1
    print('::notice::APK carries every required signer; in-place updates are safe.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
