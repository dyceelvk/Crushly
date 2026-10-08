import { HttpError } from '../errors.js';

/** Canonical catalog. Mirrored in CrushlyApp/src/lib/catalog.ts — keep in sync. */
export const INTENTIONS = ['dating', 'relationship', 'friends', 'casual', 'new_connections', 'not_sure'];

export const INTERESTS = [
  'Music', 'Fitness', 'Fashion', 'Gaming', 'Travel', 'Movies', 'Food', 'Art', 'Business',
  'Books', 'Nightlife', 'Photography', 'Outdoors', 'Tech', 'Cooking', 'Dancing', 'Wellness',
  'Sports', 'Theatre', 'Coffee', 'Design', 'Afrobeats', 'Football', 'Wine',
];

export const LANGUAGES = [
  'English', 'French', 'Spanish', 'Portuguese', 'German', 'Italian', 'Yoruba', 'Igbo', 'Hausa',
  'Swahili', 'Arabic', 'Mandarin', 'Hindi', 'Dutch', 'Twi', 'Zulu', 'Amharic', 'Japanese',
];

export const RELATIONSHIP_INTENTIONS = [
  'Long-term partner', 'Long-term, open to short', 'Short-term, open to long',
  'Something casual', 'New friends', 'Still figuring it out',
];

export const LIFESTYLE_FIELDS = {
  work: { type: 'text', max: 60 },
  education: { type: 'text', max: 60 },
  height: { type: 'int', min: 120, max: 230 },
  workout: { type: 'enum', values: ['Often', 'Sometimes', 'Rarely', 'Never'] },
  drinking: { type: 'enum', values: ['Socially', 'Rarely', 'Never', 'Sober'] },
  smoking: { type: 'enum', values: ['Never', 'Socially', 'Regularly'] },
  pets: { type: 'enum', values: ['Dog person', 'Cat person', 'Both', 'Neither'] },
  zodiac: {
    type: 'enum',
    values: ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'],
  },
};

export function str(value, field, { max = 200, min = 0, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const v = value.trim();
  if (required && v.length === 0) throw new HttpError(400, `${field} is required.`);
  if (v.length < min) throw new HttpError(400, `${field} must be at least ${min} characters.`);
  if (v.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  return v;
}

export function list(value, field, allowed, { max = 20 } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be a list.`);
  const unique = [...new Set(value)];
  if (unique.length > max) throw new HttpError(400, `Choose up to ${max} ${field.toLowerCase()}.`);
  for (const item of unique) {
    if (!allowed.includes(item)) throw new HttpError(400, `"${item}" isn't a valid option for ${field.toLowerCase()}.`);
  }
  return unique;
}

export function int(value, field, { min, max }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be between ${min} and ${max}.`);
  return n;
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function bool(value) {
  return value ? 1 : 0;
}

export function email(value) {
  const v = str(value, 'Email', { required: true, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new HttpError(400, 'That email address doesn’t look right.');
  return v;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw new HttpError(400, 'Use at least 8 characters for your password.');
  }
  if (value.length > 200) throw new HttpError(400, 'That password is too long.');
  return value;
}

export function birthdate(value) {
  const v = str(value, 'Birthday', { required: true, max: 10 });
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new HttpError(400, 'Enter your birthday as day, month and year.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new HttpError(400, 'That date doesn’t exist.');
  }
  return v;
}

export function lifestyle(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Lifestyle must be an object.');
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const spec = LIFESTYLE_FIELDS[key];
    if (!spec || raw == null || raw === '') continue;
    if (spec.type === 'text') out[key] = str(raw, key, { max: spec.max });
    else if (spec.type === 'int') out[key] = int(raw, key, spec);
    else out[key] = oneOf(raw, key, spec.values);
  }
  return out;
}
