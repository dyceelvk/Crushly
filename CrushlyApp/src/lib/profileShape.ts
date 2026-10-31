/**
 * The shape a Space arrives in, made safe before a screen touches it.
 *
 * `loadProfile()` used to hand the screen exactly what `load_profile` returned.
 * The screen then did what any screen does — `p.moments.length`,
 * `p.interests.length`, `p.photos.length` — and the day a key was absent it was
 * not a sparse Space, it was `TypeError: Cannot read properties of undefined
 * (reading 'length')` and a blank white page with no way back.
 *
 * The keys are not guaranteed by anything the client can see: `load_profile`
 * composes its payload from three other functions and merges the Moments in
 * conditionally, so a payload without `moments` is a version skew away, not a
 * hypothetical. JSON columns are just as loose — `interests` is `jsonb` and can
 * be `null`.
 *
 * So the boundary normalises: every array is an array, every string is a string,
 * every object is an object, and nothing that cannot be repaired is passed on as
 * if it were fine. A Space with one photo and no bio still draws; it does not
 * crash the app.
 */

import type { CrushState, FullProfile, Intention, MomentSummary, Photo } from '../api/types';
import { INTENTIONS } from './catalog';

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const nilableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nilableNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

const photos = (v: unknown): Photo[] =>
  Array.isArray(v)
    ? v
        .filter((p): p is Record<string, unknown> => isObject(p))
        .map((p, i) => ({ id: num(p.id, i), url: str(p.url) }))
        .filter((p) => !!p.url)
    : [];

const crushState = (v: unknown): CrushState => {
  const c = isObject(v) ? v : {};
  return {
    sent: bool(c.sent),
    sentDeep: bool(c.sentDeep),
    received: bool(c.received),
    receivedDeep: bool(c.receivedDeep),
    note: nilableStr(c.note),
    mutual: bool(c.mutual),
  };
};

const INTENTION_VALUES = INTENTIONS.map((i) => i.value) as readonly string[];

const intentions = (v: unknown): Intention[] =>
  strings(v).filter((x): x is Intention => INTENTION_VALUES.includes(x));

const moments = (v: unknown): MomentSummary[] =>
  Array.isArray(v)
    ? v
        .filter((m): m is Record<string, unknown> => isObject(m))
        .map((m, i) => ({
          id: num(m.id, i),
          kind: (m.kind === 'photo' || m.kind === 'video' ? m.kind : 'text') as MomentSummary['kind'],
          body: str(m.body),
          mediaUrl: nilableStr(m.mediaUrl),
          style: (typeof m.style === 'string' ? m.style : 'noir') as MomentSummary['style'],
          edit: isObject(m.edit) ? (m.edit as MomentSummary['edit']) : null,
          createdAt: num(m.createdAt),
        }))
    : [];

const lifestyle = (v: unknown) => {
  const l = isObject(v) ? v : {};
  const out: Record<string, string | number> = {};
  for (const key of ['work', 'education', 'workout', 'drinking', 'smoking', 'pets', 'zodiac'] as const) {
    const value = l[key];
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  const height = num(l.height, 0);
  if (height > 0) out.height = height;
  return out as FullProfile['lifestyle'];
};

/**
 * A payload from `load_profile`, made safe to render.
 *
 * Accepts `unknown` on purpose: the caller has a JSON value from the network, and
 * pretending otherwise is how the crash got in.
 */
export function profileShape(row: unknown): FullProfile {
  const r = isObject(row) ? row : {};
  return {
    id: num(r.id),
    name: str(r.name, 'Someone'),
    username: nilableStr(r.username),
    age: nilableNum(r.age),
    pronouns: nilableStr(r.pronouns),
    city: nilableStr(r.city),
    verified: bool(r.verified),
    distance: nilableStr(r.distance),
    online: typeof r.online === 'boolean' ? r.online : null,
    activity: nilableStr(r.activity),
    bio: str(r.bio),
    intentions: intentions(r.intentions),
    relationshipIntention: nilableStr(r.relationshipIntention),
    interests: strings(r.interests),
    sharedInterests: strings(r.sharedInterests),
    photos: photos(r.photos),
    crush: crushState(r.crush),
    canMessage: bool(r.canMessage),
    acceptsCrushes: bool(r.acceptsCrushes, true),
    at: nilableNum(r.at) ?? undefined,
    languages: strings(r.languages),
    lifestyle: lifestyle(r.lifestyle),
    messageBlockReason: nilableStr(r.messageBlockReason),
    moments: moments(r.moments),
  };
}
