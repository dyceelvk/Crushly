// holUpp is owned, developed and operated by RielOS.
//
// Everything the app says about the company, and every link that points at the
// company website, lives here — one file to change, nowhere else.
//
// COMPANY_SITE used to be empty on purpose, while the Riel site did not exist: the
// app must never link out to a domain we do not control, so every "read this on our
// website" link simply stayed hidden. The site is live now (rielincos.com, which
// says in its own words that RielOS is the technology company behind holUpp), so
// the links appear — and there is still exactly one place to change if it moves.

/** The company as it is said out loud. */
export const COMPANY_NAME = 'RielOS';

/** Full legal entity as it should appear in the Terms and Privacy Policy. */
export const COMPANY_LEGAL_NAME = 'RielOS';

/** How RielOS describes itself on its own site. */
export const COMPANY_TAGLINE = 'Independent technology group';

/** Fill in once the company registration is confirmed. */
export const COMPANY_REGISTRATION = '[RC NUMBER]';
/** Fill in once the registered address is confirmed. */
export const COMPANY_ADDRESS = '[REGISTERED ADDRESS]';

/**
 * Governing law and courts for the Terms — LEFT EMPTY ON PURPOSE so the app
 * never publishes where RielOS is registered. While it is empty the terms
 * use neutral wording ("the jurisdiction in which RielOS is registered").
 *
 * Set it to the place of incorporation to make the jurisdiction clause
 * specific. This constant is the ONLY place that value is ever rendered, and
 * the choice is a private legal decision made with counsel — it must not leak
 * into the app copy, the website or this repository's public documentation.
 */
export const COMPANY_JURISDICTION: string = '';

export const jurisdictionLaw = (): string =>
  (COMPANY_JURISDICTION ? `the laws of ${COMPANY_JURISDICTION}` : `the laws of the jurisdiction in which ${COMPANY_LEGAL_NAME} is registered`);

export const jurisdictionCourts = (): string =>
  (COMPANY_JURISDICTION ? `the courts of ${COMPANY_JURISDICTION}` : `the courts of the jurisdiction in which ${COMPANY_LEGAL_NAME} is registered`);

/** The company website. One origin, no trailing slash. */
export const COMPANY_SITE = 'https://rielincos.com';

/** Where a person writes to the company rather than to holUpp support. */
export const COMPANY_CONTACT_EMAIL = 'hello@rielincos.com';

/**
 * The one address every route out of holUpp leads to.
 *
 * It was a personal Gmail while the website, the privacy policy and the terms all
 * said support@holupp.net — so somebody writing in from the app reached a different
 * inbox from somebody writing in from the site, and the published policy named an
 * address the app did not use. One address, and it is the domain one.
 */
export const SUPPORT_EMAIL = 'support@holupp.net';
export const SAFETY_EMAIL = SUPPORT_EMAIL;
export const LEGAL_EMAIL = SUPPORT_EMAIL;
export const PRIVACY_EMAIL = SUPPORT_EMAIL;

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
export function companyUrl(path = ''): string | null {
  if (!COMPANY_SITE) return null;
  const clean = path.replace(/^\/+/, '');
  return clean ? `${COMPANY_SITE.replace(/\/+$/, '')}/${clean}` : COMPANY_SITE;
}

/** The company website, or null if there is none to send anybody to. */
export function companySite(): string | null {
  return companyUrl();
}

/**
 * Who owns holUpp — said once, in the words the app shows.
 *
 * The question people actually ask is "who is behind this?", and the answer used
 * to be three words in the corner of a settings screen. This is that answer as a
 * sentence, kept here so the settings screen, the explainer and the website footer
 * cannot drift apart.
 */
export const OWNERSHIP_SENTENCE = 'holUpp is owned, developed and operated by RielOS.';

/** The longer answer, for the sheet that opens when somebody asks. */
export const OWNERSHIP_EXPLANATION = [
  'holUpp is a product of RielOS — an independent technology group. Everything here is built and run by one team: the app, the website you are reading this on, and the servers behind them.',
  'RielOS owns holUpp. It develops it, operates it, and answers for it. There is no parent company standing behind the app, and holUpp has not been sold or licensed to anybody else.',
  `If you want to know who you are dealing with, the company says so itself at rielincos.com — and writes back from ${COMPANY_CONTACT_EMAIL}.`,
] as const;
