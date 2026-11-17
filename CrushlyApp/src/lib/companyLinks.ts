/**
 * The way out of holUpp and into the company that makes it.
 *
 * A link that opens a browser is the one kind of navigation this app cannot test
 * with a unit test, so the parts that *can* be wrong are pulled out here and
 * tested: which URL, what the row says, and what happens when there is nowhere to
 * go. The screens only draw what this returns.
 */
import { Linking } from 'react-native';
import { COMPANY_NAME, COMPANY_SITE, COMPANY_TAGLINE, companySite } from './company';

export type CompanyLink = {
  title: string;
  subtitle: string;
  url: string;
};

/** The row that opens the company website. */
export function companyRow(): CompanyLink | null {
  const url = companySite();
  if (!url) return null;
  return {
    title: 'Our Company',
    subtitle: `${COMPANY_NAME} — ${COMPANY_TAGLINE.toLowerCase()}`,
    url,
  };
}

/**
 * The row that goes to the same place and says so.
 *
 * It exists next to "Our Company" on purpose. One is a thing to read and one is a
 * thing to press, and people look for different words for each: "who owns this?"
 * and "take me to the website".
 */
export function visitCompanyRow(): CompanyLink | null {
  const url = companySite();
  if (!url) return null;
  return {
    title: `Visit ${COMPANY_NAME} ↗`,
    subtitle: COMPANY_SITE.replace(/^https?:\/\//, ''),
    url,
  };
}

/** Open an address outside the app. Never throws at the caller. */
export async function openOutside(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
