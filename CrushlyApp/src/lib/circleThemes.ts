/**
 * The themes a Circle can be.
 *
 * A Circle's name says who it is for; the theme says what kind of room it is, in
 * one word you can search. Thirty of them, drawn from the things people here
 * actually gather around — including the ten that only make sense in Nigeria,
 * because a category list written for a product in California leaves out the
 * Owambes.
 *
 * Every theme carries its own cover: a pair of colours and an icon, drawn as a
 * gradient behind the room's name until the owner adds a photograph. That makes
 * a theme do two jobs at once — find the room, and recognise it.
 *
 * The list is a label list, not a lookup table: `custom` exists so nobody is
 * ever stopped by a category they did not think of.
 */

export type CircleTheme = {
  /** Stored on the row. Stable, lower-case, never shown. */
  slug: string;
  label: string;
  /** Drawn behind the name when the Circle has no cover photograph yet. */
  cover: [string, string];
  icon: string;
  /** The Nigerian half of the list, kept in its own order for the "Naija" row. */
  naija?: boolean;
};

export const CIRCLE_THEMES: CircleTheme[] = [
  // --- the things people gather around
  { slug: 'faith', label: 'Faith & Sunday', cover: ['#2B3A67', '#7A5C3E'], icon: 'sunny-outline', naija: true },
  { slug: 'music', label: 'Music', cover: ['#3B1E5A', '#C2185B'], icon: 'musical-notes-outline' },
  { slug: 'food', label: 'Food & Cooking', cover: ['#5A2B1E', '#C77A3E'], icon: 'restaurant-outline' },
  { slug: 'style', label: 'Style & Fashion', cover: ['#1E2A5A', '#8E3EB8'], icon: 'shirt-outline' },
  { slug: 'beauty', label: 'Beauty', cover: ['#5A1E44', '#E06AA0'], icon: 'sparkles-outline' },
  { slug: 'fitness', label: 'Fitness & Gym', cover: ['#12303A', '#2E9E8F'], icon: 'barbell-outline' },
  { slug: 'football', label: 'Football', cover: ['#0E3B22', '#4FA96B'], icon: 'football-outline', naija: true },
  { slug: 'sport', label: 'Other Sport', cover: ['#1B2E4A', '#4C7FD1'], icon: 'tennisball-outline' },
  { slug: 'screen', label: 'Movies & TV', cover: ['#2A1B3D', '#6E4E9E'], icon: 'film-outline' },
  { slug: 'gaming', label: 'Gaming', cover: ['#14123A', '#5B39D6'], icon: 'game-controller-outline' },
  { slug: 'books', label: 'Books & Writing', cover: ['#2E2318', '#A9793F'], icon: 'book-outline' },
  { slug: 'art', label: 'Art & Design', cover: ['#3A1E2E', '#C7477E'], icon: 'color-palette-outline' },
  { slug: 'photography', label: 'Photography', cover: ['#1A1F2B', '#6C7A96'], icon: 'camera-outline' },
  { slug: 'tech', label: 'Tech', cover: ['#0F2A38', '#00A8C6'], icon: 'hardware-chip-outline' },
  { slug: 'business', label: 'Business & Hustle', cover: ['#2A2118', '#B08A3E'], icon: 'briefcase-outline' },
  { slug: 'money', label: 'Money & Saving', cover: ['#12321F', '#3E9E5B'], icon: 'cash-outline' },
  { slug: 'travel', label: 'Travel', cover: ['#123048', '#2E86C1'], icon: 'airplane-outline' },
  { slug: 'nightlife', label: 'Nightlife', cover: ['#1A1030', '#7B2FD1'], icon: 'moon-outline' },
  { slug: 'family', label: 'Family & Parenting', cover: ['#33241A', '#A77A4E'], icon: 'home-outline' },
  { slug: 'relationships', label: 'Relationships', cover: ['#3A1526', '#D14E7A'], icon: 'heart-outline' },
  { slug: 'mental-health', label: 'Mental Health', cover: ['#182A2A', '#4F9E9E'], icon: 'leaf-outline' },
  { slug: 'campus', label: 'Campus & School', cover: ['#1C2440', '#5A6ED1'], icon: 'school-outline' },
  { slug: 'career', label: 'Career', cover: ['#1B2530', '#587A9E'], icon: 'trending-up-outline' },
  { slug: 'cars', label: 'Cars & Bikes', cover: ['#241A1A', '#9E4D4D'], icon: 'car-sport-outline' },
  { slug: 'comedy', label: 'Comedy', cover: ['#3A2E10', '#D9A82E'], icon: 'happy-outline' },
  { slug: 'society', label: 'Politics & Society', cover: ['#1E2226', '#7A828A'], icon: 'megaphone-outline' },
  { slug: 'nature', label: 'Nature & Outdoors', cover: ['#152A1C', '#4E9E6A'], icon: 'trail-sign-outline' },
  { slug: 'pets', label: 'Pets', cover: ['#2E2418', '#B98B4E'], icon: 'paw-outline' },

  // --- and the ten that are only true here
  { slug: 'gist', label: 'Gist & Banter', cover: ['#2A1F3A', '#8B5CC7'], icon: 'chatbubbles-outline', naija: true },
  { slug: 'owambe', label: 'Owambe', cover: ['#3A1B2E', '#D14E8E'], icon: 'wine-outline', naija: true },
  { slug: 'aso-ebi', label: 'Aso Ebi', cover: ['#2B1B3A', '#B0479E'], icon: 'ribbon-outline', naija: true },
  { slug: 'sapa', label: 'Sapa Diaries', cover: ['#2A2418', '#A08A3E'], icon: 'wallet-outline', naija: true },
  { slug: 'detty-december', label: 'Detty December', cover: ['#101A3A', '#D14E7A'], icon: 'sparkles-outline', naija: true },
  { slug: 'no-wahala', label: 'No Wahala', cover: ['#14261E', '#4E9E7A'], icon: 'hand-left-outline', naija: true },
  { slug: 'cruise', label: 'Cruise & Vibes', cover: ['#1E1A3A', '#6E5CC7'], icon: 'boat-outline', naija: true },
  { slug: 'mama-put', label: 'Mama Put Runs', cover: ['#3A2218', '#C77A3E'], icon: 'fast-food-outline', naija: true },
  { slug: 'soft-life', label: 'Soft Life', cover: ['#2A1E3A', '#C77AC7'], icon: 'flower-outline', naija: true },
  { slug: 'street-hustle', label: 'Street Hustle', cover: ['#241E14', '#9E7A3E'], icon: 'bicycle-outline', naija: true },
];

/** The one that is not a theme but an answer: I'll say it myself. */
export const CUSTOM_THEME: CircleTheme = {
  slug: 'custom',
  label: 'Something else',
  cover: ['#1E2230', '#5C6478'],
  icon: 'create-outline',
};

const BY_SLUG = new Map(CIRCLE_THEMES.map((t) => [t.slug, t]));

export function themeBySlug(slug: string | null | undefined): CircleTheme | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

/**
 * A theme the owner typed themselves, given a cover of its own.
 *
 * The colour is taken from the words rather than the row, so the same typed
 * theme always draws the same cover — a room that says "Church choir" twice
 * should look like itself both times.
 */
export function customTheme(label: string): CircleTheme {
  const text = label.trim().slice(0, 40) || 'Something else';
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return {
    ...CUSTOM_THEME,
    slug: text.toLowerCase(),
    label: text,
    cover: [`hsl(${h}, 34%, 18%)`, `hsl(${(h + 40) % 360}, 52%, 46%)`],
  };
}

/**
 * How a stored theme reads back.
 *
 * The row holds text; it may be a slug from this list, or whatever the owner
 * typed. Both come back as a theme with a cover, so nothing downstream has to
 * ask which kind it got.
 */
export function resolveTheme(stored: string | null | undefined): CircleTheme | null {
  if (!stored) return null;
  const known = themeBySlug(stored);
  if (known) return known;
  return customTheme(stored);
}

/** The list, filtered by what was typed into the picker's search box. */
export function searchThemes(query: string): CircleTheme[] {
  const q = query.trim().toLowerCase();
  if (!q) return CIRCLE_THEMES;
  return CIRCLE_THEMES.filter((t) => t.label.toLowerCase().includes(q) || t.slug.includes(q));
}
