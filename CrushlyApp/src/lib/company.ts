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
