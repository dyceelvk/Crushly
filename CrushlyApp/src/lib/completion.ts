/**
 * How complete a Space is — one definition, used twice.
 *
 * This lived only in `api/service.ts`, computed from the last *saved* profile.
 * The screen that shows it is the screen where you edit it, so the number sat
 * still while you typed: fill in a bio and three interests and the bar still read
 * 85%, with "Next: Write a bio" beside it. Worse, it could only ever describe the
 * server's copy, so the same screen could show a full bio in a text box and tell
 * you to write one.
 *
 * It takes the shape the screen already has in its hands rather than a database
 * row, so editing and saving cannot disagree, and it is testable on its own.
 */

export type CompletionInput = {
  name?: string | null;
  birthdate?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  city?: string | null;
  intentions?: string[] | null;
  interests?: string[] | null;
  languages?: string[] | null;
  relationshipIntention?: string | null;
  lifestyle?: Record<string, unknown> | null;
};

export type Completion = { percent: number; missing: string[] };

const BIO_MIN = 20;

/**
 * Every check is worth the points next to it and they add up to 100 — a rule
 * worth keeping, because the percentage is shown as if it were out of everything
 * a Space can be.
 */
export function profileCompletion(profile: CompletionInput, photoCount: number): Completion {
  const interests = profile.interests ?? [];
  const languages = profile.languages ?? [];
  const lifestyle = profile.lifestyle ?? {};
  const bio = profile.bio ?? '';
  const checks = [
    { label: 'Add a photo', weight: 20, done: photoCount >= 1 },
    { label: 'Add at least 3 photos', weight: 10, done: photoCount >= 3 },
    { label: 'Name and birthday', weight: 10, done: !!profile.name && !!profile.birthdate },
    { label: 'Write a bio', weight: 15, done: bio.length >= BIO_MIN },
    { label: 'Pick 3 interests', weight: 10, done: interests.length >= 3 },
    { label: 'Say what you’re looking for', weight: 10, done: (profile.intentions ?? []).length > 0 },
    { label: 'Relationship intention', weight: 5, done: !!profile.relationshipIntention },
    { label: 'Pronouns', weight: 5, done: !!profile.pronouns },
    { label: 'Languages', weight: 5, done: languages.length > 0 },
    { label: 'Lifestyle details', weight: 5, done: Object.keys(lifestyle).filter((k) => (lifestyle as Record<string, unknown>)[k] != null && (lifestyle as Record<string, unknown>)[k] !== '').length >= 2 },
    { label: 'Your city', weight: 5, done: !!profile.city },
  ];
  const percent = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  return { percent, missing: checks.filter((c) => !c.done).map((c) => c.label) };
}
