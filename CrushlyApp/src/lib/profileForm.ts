/**
 * The editable half of a Space, and the question "is this different from what
 * the server has?".
 *
 * It lives here rather than inside EditProfile because the answer to that
 * question decides whether a footer button appears and whether leaving asks to
 * discard work — and it got that wrong. Saving a new @handle left the screen
 * dirty: the profile write came back first and re-seeded the form from it, then
 * the handle write landed, so the form held the old handle while the screen held
 * the new one. The result was "Save changes" still in the footer and a "Discard
 * your changes?" prompt when leaving a screen that had nothing left to save, and
 * a second save attempted to change a handle that can only change once a day.
 *
 * The fix is to compare against a baseline the screen owns — seeded when the
 * Space loads and re-seeded from the server's own copy after a successful save —
 * instead of re-deriving it from a query that may still be in flight.
 */

import type { Intention, Lifestyle, Me } from '../api/types';

export type ProfileForm = {
  name: string;
  username: string;
  pronouns: string;
  city: string;
  bio: string;
  intentions: Intention[];
  relationshipIntention: string;
  interests: string[];
  languages: string[];
  lifestyle: Lifestyle;
  heightText: string;
};

/** The server's copy, as the form holds it. */
export function formFromMe(me: Me): ProfileForm {
  return {
    name: me.profile.name,
    username: me.profile.username ?? '',
    pronouns: me.profile.pronouns,
    city: me.profile.city,
    bio: me.profile.bio,
    intentions: me.profile.intentions,
    relationshipIntention: me.profile.relationshipIntention,
    interests: me.profile.interests,
    languages: me.profile.languages,
    lifestyle: me.profile.lifestyle,
    heightText: me.profile.lifestyle.height ? String(me.profile.lifestyle.height) : '',
  };
}

/**
 * The form as it stands once a save has been accepted.
 *
 * `username` is passed in separately because the handle is written by its own
 * call — the database owns its format and its once-a-day rule — so the value
 * that counts is the one *it* returned, not the one that was typed (the server
 * lowercases it, and it is the only place that can say what was actually stored).
 */
export function formAfterSave(me: Me, username: string): ProfileForm {
  return { ...formFromMe(me), username };
}

/**
 * A stable string for "these two forms are the same".
 *
 * `JSON.stringify` drops keys whose value is `undefined`, which is what makes
 * picking a lifestyle chip and then unpicking it read as clean again rather than
 * as a change. It is used for both the live form and the baseline so the two are
 * always compared in the same shape.
 */
export function formKey(form: ProfileForm | null): string {
  return form ? JSON.stringify(form) : '';
}

/** Is there anything here the server does not already have? */
export function isDirty(form: ProfileForm | null, baseline: string): boolean {
  return !!form && formKey(form) !== baseline;
}

/**
 * A birthday the reader cannot mistake.
 *
 * The screen printed `split('-').reverse().join('/')`, so 11 April 1998 became
 * "11/04/1998" — which is April in Lagos and November in New York, on a line
 * the reader cannot edit and must contact support to change. Naming the month
 * costs nothing and removes the reading.
 */
export function birthdayLabel(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return 'not set';
  const month = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][Number(m[2]) - 1];
  if (!month) return 'not set';
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * The label under a multi-select that has a ceiling.
 *
 * The ceiling used to be silent: at ten interests, tapping an eleventh did
 * nothing at all, which reads as a broken button rather than as a limit. The
 * count is shown up front and the honest answer when the limit is reached.
 */
export function capMessage(label: string, max: number): { title: string; message: string } {
  return {
    title: `That’s ${max} ${label}`,
    message: 'Tap one to swap it out for another.',
  };
}
