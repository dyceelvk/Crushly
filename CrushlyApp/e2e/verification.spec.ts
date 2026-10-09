/** Offline browser regression: every backend/provider request is mocked.
 * Build with EXPO_PUBLIC_SUPABASE_URL=https://verification-test.supabase.co
 * and EXPO_PUBLIC_SUPABASE_ANON_KEY=offline-public-key, then serve the export.
 * No real account, ID document, provider session or credits are used.
 */
import { test, expect, type Page } from '@playwright/test';

const API = 'https://verification-test.supabase.co';
const PROVIDER = 'https://verification-provider.example/session';
async function member(page: Page, initial = 'Not Started', failStart = false) {
  let diditStatus = initial;
  const profile = { id: 1, email: 'offline@example.com', name: 'Offline test', verification: 'pending', onboarded: true,
    status: 'active', birthdate: '1995-01-01', created_at: Date.now() };
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: profile.email };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = [ { alg: 'HS256', typ: 'JWT' }, { sub: user.id, aud: 'authenticated', role: 'authenticated', exp } ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.offline-signature';
  await page.addInitScript(({ user, token, exp }) => {
    localStorage.setItem('sb-verification-test-auth-token', JSON.stringify({ user, access_token: token,
      refresh_token: 'offline-refresh', token_type: 'bearer', expires_at: exp, expires_in: 3600 }));
  }, { user, token, exp });
  const starts: unknown[] = [];
  let polls = 0;
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path === '/auth/v1/user') body = { ...user };
    else if (path === '/rest/v1/profiles') body = profile;
    else if (path === '/rest/v1/photos') body = [];
    else if (path === '/rest/v1/verification_requests') body = null;
    else if (path === '/rest/v1/crushes') body = [];
    else if (path === '/functions/v1/didit-status') {
      polls++;
      profile.verification = diditStatus === 'Approved' ? 'verified' : diditStatus === 'Not Started' ? 'none' : 'pending';
      body = { status: profile.verification, diditStatus, sessionId: 'offline-session' };
    } else if (path === '/functions/v1/didit-session') {
      starts.push(route.request().postDataJSON());
      // Deliberately resolve after the click's popup-activation window.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      body = failStart ? { error: 'Verification provider is temporarily unavailable.' } : { url: PROVIDER, session_id: 'offline-session' };
      status = failStart ? 502 : 200;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(`${PROVIDER}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Offline hosted verification</h1>' }));
  return { starts, polls: () => polls, approve: () => { diditStatus = 'Approved'; } };
}

test('unused session is ready, and Continue navigates the same tab after delayed response', async ({ page, context }) => {
  const mocked = await member(page);
  await page.goto('/verification');
  await expect(page.getByText('Ready to verify', { exact: true })).toBeVisible();
  await expect(page.getByText('Verification under review', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue verification', exact: true }).click();
  await expect(page).toHaveURL(PROVIDER);
  expect(context.pages()).toHaveLength(1);
  expect(mocked.starts).toEqual([{ newSession: false }]);
});

test('failed session creation remains retryable and never claims verification opened', async ({ page }) => {
  await member(page, 'Not Started', true);
  await page.goto('/verification');
  await page.getByRole('button', { name: 'Continue verification', exact: true }).click();
  await expect(page.getByText('Verification provider is temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready to verify', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue verification', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/verification$/);
});

test('review is driven by provider status, not a click', async ({ page }) => {
  await member(page, 'In Review');
  await page.goto('/verification');
  await expect(page.getByText('Verification under review', { exact: true })).toBeVisible();
});

for (const path of ['/verification?didit=done&status=Approved', '/?didit=done&status=Approved']) {
  test(`return ${path} polls the server instead of trusting URL approval`, async ({ page }) => {
    const mocked = await member(page);
    await page.goto(path);
    await expect(page.getByText('Ready to verify', { exact: true })).toBeVisible();
    await expect.poll(mocked.polls).toBeGreaterThan(0);
    await expect(page.getByText('You’re verified', { exact: true })).toHaveCount(0);
    mocked.approve();
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await expect(page.getByText('You’re verified', { exact: true })).toBeVisible();
  });
}

test('explicit restart is distinct from Continue', async ({ page }) => {
  const mocked = await member(page);
  await page.goto('/verification');
  await page.getByRole('button', { name: 'Start a new session', exact: true }).click();
  await expect(page).toHaveURL(PROVIDER);
  expect(mocked.starts).toEqual([{ newSession: true }]);
});
