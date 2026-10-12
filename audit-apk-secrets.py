"""Check a build for server credentials, and never print them.

Run only AFTER Gradle or the web export, so no server value can be inlined by
Expo afterwards. Works on an APK (a zip) or on a directory of build output, so
the same check covers the phone build and the website.

Two kinds of finding:

  - Known values. Every credential the project holds is passed in the
    environment; if any of them appears in the build, it is a leak. A
    credential that is not configured is reported as unexamined, never as
    safe — silence is not evidence.
  - Known shapes. A credential we have not thought to configure still has a
    shape — `sb_secret_…`, a Groq `gsk_…`, an AWS key, a service-role JWT, a
    private key block. This catches the mistake we did not anticipate, which
    is the only kind that ever actually ships.

Where the shapes are looked for matters. React Native ships a Hermes bytecode
bundle, and Hermes stores every string in one blob with no separator between
them, so two innocent literals can sit back to back as, say, `sb_secret_`
followed by ordinary words — which reads as a secret key to a plain byte scan
even though no such string exists in the build. Shapes are therefore matched
against whole strings, read out of the Hermes string table; if that table
cannot be read, this check fails rather than guess. Known values are still
compared byte for byte everywhere, including inside the bytecode.

What is deliberately NOT flagged: the Supabase project URL and its
publishable key. Those are designed to sit in a client, and the whole of the
protection is Row Level Security behind them — see supabase/tests/smoke.sql.
"""
import base64
import json
import os
import pathlib
import re
import sys
import urllib.parse
import struct
import zipfile

# An absent optional secret is explicitly reported as unexamined, not 'safe'.
names = ('SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
         'SUPABASE_SECRET_KEY', 'DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET',
         'TURN_SHARED_SECRET', 'NETLIFY_AUTH_TOKEN', 'GMAIL_SMTP_PASS',
         'OPENAI_API_KEY', 'GROQ_API_KEY', 'GROQ_SAFEGUARD_KEY',
         'FCM_SERVER_KEY', 'APNS_AUTH_KEY', 'B2_APPLICATION_KEY',
         'CLOUDFLARE_API_TOKEN')

# Shapes that should never appear in anything handed to a member's device.
shapes = (
    ('Supabase secret key', re.compile(rb'sb_secret_[A-Za-z0-9_-]{16,}')),
    ('Groq/OpenAI style key', re.compile(rb'\b(?:gsk|sk)-[A-Za-z0-9]{24,}')),
    ('AWS access key id', re.compile(rb'\bAKIA[0-9A-Z]{16}\b')),
    ('GitHub token', re.compile(rb'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b')),
    ('GitHub fine-grained token', re.compile(rb'\bgithub_pat_[A-Za-z0-9_]{20,}\b')),
    ('Slack token', re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{10,}')),
    ('private key block', re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
)

patterns = []
checked = []
missing = []
for name in names:
    value = os.environ.get(name, '')
    if not value:
        missing.append(name)
        continue
    checked.append(name)
    values = [value, json.dumps(value)[1:-1], urllib.parse.quote(value, safe=''),
              base64.b64encode(value.encode()).decode()]
    # A URI's password may be compiled separately from the URI; check both.
    if name == 'SUPABASE_DB_URL':
        password = urllib.parse.urlparse(value).password
        if password and len(password) >= 8:
            values.extend([password, urllib.parse.unquote(password)])
    patterns.extend(v.encode() for v in values if len(v) >= 8)


# --- Reading a Hermes bytecode bundle, string by string --------------------
#
# React Native compiles the app's JavaScript into one Hermes bytecode bundle.
# Hermes keeps every string in a single blob, packed back to back with nothing
# in between, so a plain byte scan can read two neighbouring literals as one
# long run. These helpers recover the real string boundaries so a shape can
# only ever match a string that actually exists in the build.

MAGIC = 0x1F1903C103BC1FC6  # '\u1f19\u03c1\u03bc\u1fc6'.encode('utf-16be'), Hermes' file header magic
LONG_STRING = 0xFF          # length byte that says "see the overflow table"


def header_fields(b):
    """The head of the header, which is stable across bytecode revisions."""
    if len(b) < 64 or struct.unpack_from('<Q', b, 0)[0] != MAGIC:
        raise ValueError('not a Hermes bytecode file')
    u32 = lambda off: struct.unpack_from('<I', b, off)[0]  # noqa: E731
    return {
        'version': u32(8),
        'fileLength': u32(32),
        'functionCount': u32(40),
        'stringKindCount': u32(44),
        'identifierCount': u32(48),
        'stringCount': u32(52),
        'overflowStringCount': u32(56),
        'stringStorageSize': u32(60),
    }


def unpack_entry(word):
    """SmallStringTableEntry, as Hermes packs it into one 32-bit word:
    bit 0 is the UTF-16 flag, bits 1..23 are the offset into the blob, and the
    top byte is the length. A length of 0xFF defers to the overflow table."""
    return {
        'offset': (word >> 1) & 0x7FFFFF,
        'length': (word >> 24) & 0xFF,
        'isUTF16': bool(word & 1),
    }


def is_plausible_text(text):
    """Readable as text, allowing the odd control character: real builds do
    contain the occasional \x1f marker or a non-breaking space in UI copy."""
    return all(ch.isprintable() or ch in '\n\r\t' for ch in text)


def looks_like_text(strings):
    """A blob read at the wrong position decodes to noise, so insist that all
    but a trace of the strings are readable."""
    if not strings:
        return False
    readable = sum(1 for text, _ in strings if is_plausible_text(text))
    return readable >= 0.99 * len(strings)


def _textish(byte):
    return 0x20 <= byte < 0x7F or byte in (9, 10, 13)


def _density_region(b, storage):
    """The blob is the one long stretch of readable text in the file, so find
    it by density rather than by trying every position (which is far too slow).
    Returns a byte range that should contain it."""
    table = bytes(1 if _textish(i) else 0 for i in range(256))
    flags = b.translate(table)
    # UTF-16 strings store a zero after each ASCII character, so a block can be
    # only half readable; the blob as a whole still stands out clearly.
    block = 4096
    blocks = [sum(flags[i:i + block]) / block for i in range(0, len(flags), block)]
    if not blocks:
        raise ValueError('empty file')
    best = max(range(len(blocks)), key=lambda i: blocks[i])
    left = best
    while left > 0 and blocks[left - 1] >= 0.45:
        left -= 1
    right = best
    while right + 1 < len(blocks) and blocks[right + 1] >= 0.45:
        right += 1
    start, end = left * block, min((right + 1) * block, len(b))
    if end - start < storage:
        raise ValueError('no stretch of text long enough to hold the strings')
    return start, end


def entries_from(words, position, count, storage):
    entries = [unpack_entry(words[(position + 4 * i) // 4]) for i in range(count)]
    if any(e['offset'] >= storage for e in entries):
        raise ValueError('an entry points past the end of the blob')
    return entries


def read_strings(b):
    """Returns (header, strings), each string being (text, is_long)."""
    if len(b) % 4:
        raise ValueError('bytecode file is not a multiple of four bytes')

    header = header_fields(b)
    count = header['stringCount']
    storage = header['stringStorageSize']
    overflow_count = header['overflowStringCount']
    if not (0 < count < 5_000_000 and 0 < storage <= len(b)):
        raise ValueError('implausible string table sizes')

    words = struct.unpack_from(f'<{(len(b) - len(b) % 4) // 4}I', b, 0)
    region_start, region_end = _density_region(b, storage)

    # Where the table would sit if the blob started at `base`; the two are
    # adjacent, so the blob's position fixes the table's.
    back = 8 * overflow_count + 4 * count
    expected = sorted({count - 1, count // 2, count // 4, count // 8, 1024, 256})

    last_error = None
    for base in range(max(region_start, 64), min(region_end, len(b) - storage) + 1):
        if base % 4:
            continue
        for slack in (0, 4, 8, 12):
            position = base - back - slack
            if position < 64 or position % 4:
                continue
            # Reject at once: real entries sit inside the blob and the long ones
            # point into the overflow table.
            try:
                for i in expected:
                    e = unpack_entry(words[(position + 4 * i) // 4])
                    if e['offset'] >= storage:
                        raise ValueError('an entry points past the end of the blob')
                    if e['length'] == LONG_STRING and e['offset'] >= overflow_count:
                        raise ValueError('an entry points past the overflow table')
                entries = [unpack_entry(words[(position + 4 * i) // 4])
                           for i in range(count)]
                if any(e['offset'] >= storage for e in entries):
                    raise ValueError('an entry points past the end of the blob')

                overflow = [struct.unpack_from('<II', b, position + 4 * count + 8 * i)
                            for i in range(overflow_count)]

                def span_of(entry):
                    if entry['length'] == LONG_STRING:
                        if entry['offset'] >= len(overflow):
                            raise ValueError('entry points outside the overflow table')
                        off, chars = overflow[entry['offset']]
                    else:
                        off, chars = entry['offset'], entry['length']
                    return off, chars * (2 if entry['isUTF16'] else 1)

                sizes = [span_of(e) for e in entries]
                if max(off + size for off, size in sizes) != storage:
                    raise ValueError('the strings do not fill the blob')

                strings = []
                for entry, (off, size) in zip(entries, sizes):
                    raw = b[base + off:base + off + size]
                    if len(raw) != size:
                        raise ValueError('a string runs past the end of the file')
                    try:
                        text = (raw.decode('utf-16-le', errors='surrogatepass')
                                if entry['isUTF16'] else raw.decode('latin-1'))
                    except UnicodeDecodeError:
                        raise ValueError('a string does not decode as text')
                    strings.append((text, entry['length'] == LONG_STRING))
                if not looks_like_text(strings):
                    raise ValueError('the strings at this position read as noise')
                return header, strings
            except ValueError as exc:
                last_error = exc
                continue
    raise ValueError(f'could not read the Hermes string table ({last_error})')


def has_service_role_token(content: bytes) -> bool:
    """True when a JWT in these bytes claims the service role.

    The app ships a Supabase publishable key, which is a JWT as well, so the
    shape of a token proves nothing. What matters is what the token claims:
    only a service-role token steps around Row Level Security.
    """
    for match in re.finditer(rb'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', content):
        payload = match.group(0).split(b'.')[1]
        payload += b'=' * (-len(payload) % 4)
        try:
            decoded = base64.urlsafe_b64decode(payload)
        except Exception:  # noqa: BLE001 - not a token we can read, not a finding
            continue
        if b'"role"' in decoded and b'service_role' in decoded:
            return True
    return False


def is_hermes_bytecode(content: bytes) -> bool:
    return len(content) >= 8 and content[:8].hex() == 'c61fbc03c103191f'


def strings_in(content: bytes, name: str):
    """The individual strings of a Hermes bundle, or None if it is not one.

    A wrong shape check is worse than no shape check, so an unreadable bytecode
    file is an error, not a pass.
    """
    if not is_hermes_bytecode(content):
        return None
    try:
        header, found = read_strings(content)
    except ValueError as exc:
        raise SystemExit(f'::error::cannot read the Hermes string table in {name} '
                         f'({exc}); shapes cannot be checked, so publication is blocked.')
    return header, [text for text, _ in found]


def blobs(target: pathlib.Path):
    """Yields (name, bytes) for every file in an APK or a build directory."""
    if target.is_dir():
        for path in target.rglob('*'):
            if path.is_file():
                yield path.name, path.read_bytes()
        return
    with zipfile.ZipFile(target) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            yield entry.filename, archive.read(entry)


target = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None

findings = []
scanned = 0
bytecode_scanned = 0
strings_examined = 0
for name, content in blobs(target):
    scanned += 1
    for pattern in patterns:
        if pattern in content:
            findings.append(f'a configured credential value appears in {name}')
            break
    else:
        decoded = strings_in(content, name)
        if decoded is None:
            hit = None
            for label, shape in shapes:
                if shape.search(content):
                    hit = f'something shaped like a {label} appears in {name}'
                    break
            if hit is None and has_service_role_token(content):
                hit = f'a service-role token appears in {name}'
        else:
            # Every string on its own, so two neighbouring literals cannot add
            # up to something that looks like a key.
            header, texts = decoded
            bytecode_scanned += 1
            strings_examined += len(texts)
            hit = None
            for text in texts:
                data = text.encode('utf-8', errors='surrogatepass')
                for label, shape in shapes:
                    if shape.search(data):
                        hit = (f'something shaped like a {label} appears in a string '
                               f'inside {name}')
                        break
                if hit:
                    break
            if hit is None and any(has_service_role_token(t.encode('utf-8', errors='surrogatepass'))
                                   for t in texts):
                hit = f'a service-role token appears in a string inside {name}'
        if hit:
            findings.append(hit)
    if findings:
        break

if findings:
    print('::error::' + findings[0] + '. Publication blocked; rotate affected credentials outside chat.')
    sys.exit(1)

bytecode_note = (f'Hermes bytecode: {bytecode_scanned} bundle(s) read as {strings_examined} individual strings, '
                 f'so no match can span two neighbouring literals.\n'
                 if bytecode_scanned else
                 'Hermes bytecode: none found in this target; shapes checked against raw bytes.\n')
report = (f'Known server credential leakage check: passed ({len(checked)} configured credential types compared, '
          f'{len(shapes)} shapes, {scanned} files scanned).\n'
          'No credential values printed or included in this report.\n'
          + bytecode_note +
          'Client config is intentionally public (Supabase URL and publishable key); RLS is the boundary.\n'
          'Not a full security audit; unknown values and device compromise are outside this check.\n'
          'Unconfigured comparison types: ' + ', '.join(missing) + '\n')
if report_path:
    report_path.write_text(report)
print(f'::notice::Secret leakage check passed ({len(checked)} configured credentials, {len(shapes)} shapes, '
      f'{scanned} files, {strings_examined} bytecode strings); no values logged.')
