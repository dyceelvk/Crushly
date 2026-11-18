import { expect, type Page } from '@playwright/test';

/**
 * Get a browser to the app itself.
 *
 * The web build is honest with a browser: it opens with a one-time notice
 * ("You're on the web version" — Keep browsing / Get the app), and behind that
 * sits the intro screen that says "Tap anywhere to begin". Both are real screens
 * a person clears without thinking. Nothing in this suite could see past them,
 * which is why every offline spec failed with a 30-second click timeout on a tab
 * that was never on screen.
 *
 * One helper, called by every spec, so the next screen added at the front of the
 * app is a one-line fix rather than six.
 */
export async function enterApp(page: Page): Promise<void> {
  const keepBrowsing = page.getByRole('button', { name: 'Keep browsing holUpp in this browser' });
  if (await keepBrowsing.isVisible().catch(() => false)) {
    await keepBrowsing.click();
    await page.waitForTimeout(250);
  }

  const begin = page.getByText('Tap anywhere to begin', { exact: false }).first();
  if (await begin.isVisible().catch(() => false)) {
    await begin.click();
    // The intro hands over to the app; give the tree a moment to settle before
    // the caller starts looking for tabs.
    await page.waitForTimeout(1200);
  }
}

/** `goto` and clear whatever stands in front of the app, in one call. */
export async function openApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await enterApp(page);
}

/** True when the tab bar is up, i.e. the app is past its front doors. */
export async function inApp(page: Page): Promise<boolean> {
  return page
    .getByText('Connections', { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
}

/** Assert the app is actually on screen, with a sentence that says why not. */
export async function expectInApp(page: Page): Promise<void> {
  await expect(
    page.getByText('Connections', { exact: true }).first(),
    'the app should be on screen — if not, a new screen was added in front of it',
  ).toBeVisible({ timeout: 20000 });
}
