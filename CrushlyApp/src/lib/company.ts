// Crushly is a product of Riel Inc.
//
// Everything the app says about the company, and every link that points at the
// company website, lives here — one file to change, nowhere else.
//
// COMPANY_SITE is deliberately EMPTY until the Riel site is live. The app must
// never link out to a domain we do not control, so while it is empty the
// "read on our website" links simply stay hidden. Set it to the live origin
// (for example 'https://riel.inc') and every legal link in the app appears at
// once — no other file needs to change.

export const COMPANY_NAME = 'Riel Inc.';

/** Full legal entity as it should appear in the Terms and Privacy Policy. */
export const COMPANY_LEGAL_NAME = 'Riel Inc.';

/** Fill in once the company registration is confirmed. */
export const COMPANY_REGISTRATION = '[RC NUMBER]';
/** Fill in once the registered address is confirmed. */
export const COMPANY_ADDRESS = '[REGISTERED ADDRESS]';

/**
 * Governing law and courts for the Terms — LEFT EMPTY ON PURPOSE so the app
 * never publishes where Riel Inc. is registered. While it is empty the terms
 * use neutral wording ("the jurisdiction in which Riel Inc. is registered").
 *
 * Set it to the place of incorporation to make the jurisdiction clause
 * specific. This constant is the ONLY place that value is ever rendered, and
 * the choice is a private legal decision made with counsel — it must not leak
 * into the app copy, the website or this repository's public documentation.
 */
export const COMPANY_JURISDICTION: string = '';

export const jurisdictionLaw = (): string =>
  (COMPANY_JURISDICTION ? `the laws of ${COMPANY_JURISDICTION}` : 'the laws of the jurisdiction in which Riel Inc. is registered');

export const jurisdictionCourts = (): string =>
  (COMPANY_JURISDICTION ? `the courts of ${COMPANY_JURISDICTION}` : 'the courts of the jurisdiction in which Riel Inc. is registered');

const COMPANY_SITE: string = ''; // ← set this when the Riel landing page goes live

export const SUPPORT_EMAIL = 'support@crushly.app';
export const SAFETY_EMAIL = 'safety@crushly.app';
export const LEGAL_EMAIL = 'legal@crushly.app';
export const PRIVACY_EMAIL = 'privacy@crushly.app';

/** True while a company detail is still an unfilled placeholder. */
export const isPlaceholder = (value: string) => value.includes('[');

/** The entity line shown in legal copy, omitting details we haven't set yet. */
export function companyEntityLine(): string {
  const parts = [COMPANY_LEGAL_NAME];
  if (!isPlaceholder(COMPANY_REGISTRATION)) parts.push(`(RC ${COMPANY_REGISTRATION})`);
  if (!isPlaceholder(COMPANY_ADDRESS)) parts.push(`of ${COMPANY_ADDRESS}`);
  return parts.join(' ');
}

/**
 * Absolute URL on the company website, or null while no site is configured.
 * Paths are written without a leading slash, e.g. companyUrl('legal/terms').
 */
export function companyUrl(path: string): string | null {
  if (!COMPANY_SITE) return null;
  return `${COMPANY_SITE.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
