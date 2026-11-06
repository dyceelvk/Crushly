#!/usr/bin/env python3
"""A version that cannot describe itself must not be announced.

Plain asserts and an exit code: this runs in CI with nothing installed, and it
has to fail loudly for the one mistake that is invisible in production — an APK
that ships under the previous release's sentence, because `release.json` had
carried that field forward since the release before it.
"""

import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('update_notes', HERE / 'update_notes.py')
update_notes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update_notes)


def expect_refusal(what, fn):
    try:
        fn()
    except SystemExit as exc:
        assert str(exc).strip(), f'{what}: refused without saying why'
        print(f'ok  {what}')
    else:
        raise AssertionError(f'{what}: was accepted, but it should have been refused')


def with_notes(text, fn):
    """Point the lookup at a temporary notes file, then restore it."""
    original = update_notes.NOTES_JSON
    tmp = pathlib.Path(original).with_suffix('.test.tmp.json')
    try:
        tmp.write_text(text)
        update_notes.NOTES_JSON = tmp
        return fn()
    finally:
        update_notes.NOTES_JSON = original
        tmp.unlink(missing_ok=True)


def with_no_notes(fn):
    """A notes file that does not exist at all."""
    original = update_notes.NOTES_JSON
    try:
        update_notes.NOTES_JSON = pathlib.Path(original).with_suffix('.absent.json')
        return fn()
    finally:
        update_notes.NOTES_JSON = original


def main() -> int:
    version = update_notes.current_version()
    note = update_notes.note_for(version)

    assert len(note) > 20, f'{version} says almost nothing: {note!r}'
    assert '\n' not in note, f'{version} is a paragraph, not a sentence a phone shows under a button'
    print(f'ok  {version} describes itself: {note}')

    expect_refusal('a version with no entry is refused',
                   lambda: with_notes('{"0.0.1": "Anything."}', lambda: update_notes.note_for(version)))
    expect_refusal('an empty sentence is refused',
                   lambda: with_notes('{"%s": "   "}' % version, lambda: update_notes.note_for(version)))
    expect_refusal('a notes file that is not an object is refused',
                   lambda: with_notes('["nope"]', update_notes.notes_file))
    expect_refusal('a notes file that is not JSON is refused',
                   lambda: with_notes('{nope', update_notes.notes_file))
    expect_refusal('a missing notes file is refused',
                   lambda: with_no_notes(update_notes.notes_file))

    print(f'{version} can be announced honestly.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
