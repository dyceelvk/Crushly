/**
 * The chimes a member can choose from.
 *
 * Six, not twenty. Each one is a different *character* rather than a variation in
 * volume — a wood marimba, an FM bell, a dry pluck, an airy swell, a water drop
 * and a detuned synth — because "which sound do I want" is a taste question and a
 * long list of near-identical beeps does not answer it.
 *
 * The list is data only, with no `require` and no audio: the picker, the settings
 * row and the tests all read it, and the module that owns the player is the only
 * thing that needs the files. Every id here must exist as
 * `assets/sounds/<id>.wav`; a test enforces that.
 */

export interface SoundChoice {
  id: string;
  name: string;
  /** One line, shown under the name in the picker. */
  blurb: string;
}

export const SOUND_CHOICES: SoundChoice[] = [
  { id: 'glass', name: 'Glass', blurb: 'A bright bell with a shimmer' },
  { id: 'pulse', name: 'Pulse', blurb: 'A dry pluck and a high tick' },
  { id: 'lumen', name: 'Lumen', blurb: 'Warm marimba, two notes rising' },
  { id: 'bloom', name: 'Bloom', blurb: 'An airy, calm swell' },
  { id: 'drip', name: 'Drip', blurb: 'A short water drop' },
  { id: 'orbit', name: 'Orbit', blurb: 'Two detuned tones, a little sci-fi' },
];

/**
 * Glass by default: it is the one most people already recognise as "a
 * notification", so a member who never opens this screen still gets something
 * that sounds deliberate rather than something they have to learn.
 */
export const DEFAULT_SOUND = 'glass';

export function isSoundChoice(id: string | null | undefined): boolean {
  return !!id && SOUND_CHOICES.some((s) => s.id === id);
}

export function soundById(id: string | null | undefined): SoundChoice {
  return SOUND_CHOICES.find((s) => s.id === id) ?? SOUND_CHOICES.find((s) => s.id === DEFAULT_SOUND)!;
}

export function soundName(id: string | null | undefined): string {
  return soundById(id).name;
}
