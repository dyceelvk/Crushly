/**
 * The 24-hour browser limit — the client's half.
 *
 * The rule lives in the database (`holup_web_open`), because a limit a member
 * can restart by clearing site data is not a limit. Everything here is about
 * what the *screen* says, and it is pure so it can be argued with in a test
 * rather than by opening three browsers.
 *
 * The shape of the answer comes from the owner, in these words: 24 hours on the
 * web, counted from the first time you use the web, **once, never reset**. Not a
 * daily allowance, not a rolling window. When it is over, the browser does not
 * disappear — it stops being able to *post*, and the app is where the rest of
 * holUpp is.
 *
 * Why read-only rather than a wall
 * --------------------------------
 * There is no App Store listing, so an iPhone cannot install holUpp the way an
 * Android phone can. A hard wall would take a working product away from every
 * iPhone member and replace it with a button to nothing. Read-only keeps every
 * Space, every Flow and every Whisper readable, and puts the wall exactly where
 * a browser genuinely cannot do the job anyway: clips, recording, posting.
 *
 * Android is the one platform where the wall is real, so it is the one platform
 * that gets the wall — with the download, which exists.
 */

export const WEB_LIMIT_MS = 24 * 60 * 60 * 1000;

/** What the database told us. Null when the member is not signed in yet. */
export type WebClock = {
  firstSeenAt: number | null;
  elapsedMs: number;
  remainingMs: number;
  blocked: boolean;
  /** Server-side entitlement. Exempt members never enter a limited standing. */
  unlimited?: boolean;
  opens?: number;
};

/**
 * Who gets what once the browser's 24 hours are gone.
 *
 *   'open'      — inside the 24 hours; nothing changes.
 *   'readonly'  — the browser can still be read, but not written to. iPhone and
 *                 desktop land here, because neither has an app to send them to.
 *   'wall'      — Android: the app is one tap away and is the better product, so
 *                 the browser hands over properly.
 *
 * Android is detected from the user agent, which is a claim the browser makes
 * about itself — not proof. That is fine here: it decides *which wording* a
 * member sees, never whether the rule applies. Both states are restricted; the
 * difference is whether there is a door to open.
 */
export type WebStanding = 'open' | 'readonly' | 'wall';

export function webStanding(clock: WebClock | null | undefined, platform: 'ios' | 'android' | 'other'): WebStanding {
  // `unlimited` is authoritative when present. The blocked check remains as a
  // defensive fallback for older server responses that do not include it.
  if (clock?.unlimited || !clock?.blocked) return 'open';
  return platform === 'android' ? 'wall' : 'readonly';
}

/** What a browser member is told, and what it means for what they can do. */
export function webLimitCopy(standing: WebStanding): { title: string; body: string; cta: string | null } {
  if (standing === 'wall') {
    return {
      title: 'Your browser time is up',
      body: 'holUpp in the browser is for the first day. Clips, Moments and Whispers live in the app, and it is already on your phone’s download — nothing is lost.',
      cta: 'Get the holUpp app',
    };
  }
  if (standing === 'readonly') {
    return {
      title: 'This browser is read-only now',
      body: 'You can still read the Flow and visit Spaces. Posting, Moments, clips and Whispers need the phone app — on iPhone, use Add to Home Screen so holUpp opens like an app.',
      cta: 'Add to Home Screen',
    };
  }
  return { title: '', body: '', cta: null };
}

/**
 * "23 hours left", "47 minutes left", "< 1 minute left".
 *
 * Rounded down on purpose: telling somebody they have 24 hours when they have
 * 23h59m is the kind of small lie that makes the whole clock feel arbitrary.
 */
export function timeLeftLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'No time left';
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 1) return 'Less than a minute left';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}

/**
 * The one prompt that is worth showing before the wall.
 *
 * A limit nobody saw coming is a bug from the member's side. This fires once,
 * in the last six hours, and never again — so the notice is information, not
 * nagging.
 */
export function shouldWarn(clock: WebClock | null | undefined): boolean {
  if (!clock || clock.unlimited || clock.blocked || clock.firstSeenAt == null) return false;
  return clock.remainingMs > 0 && clock.remainingMs <= 6 * 60 * 60 * 1000;
}

/** A coarse platform read. Used for wording only — never for the rule itself. */
export function webPlatform(userAgent: string | undefined): 'ios' | 'android' | 'other' {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'other';
  // iPadOS 13+ reports itself as a Mac; the touch point is what gives it away,
  // and the caller is expected to have checked that before calling this.
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'other';
}
