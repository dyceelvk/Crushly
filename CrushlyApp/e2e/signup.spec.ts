/**
 * End-to-end checks for the Crushly auth journeys, run with Playwright:
 *
 *   1. Sign-up verified with the emailed 6-digit code
 *   2. Sign-up verified with the emailed one-tap link
 *   3. Password reset verified with the emailed 6-digit code
 *
 * Codes and links are minted with the Supabase Admin API (service role key),
 * so no mailbox access is needed. Required environment:
 *
 *   E2E_BASE_URL               site under test (default http://localhost:8081)
 *   EXPO_PUBLIC_SUPABASE_URL   Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  service role key — secrets only, never commit
 *
 * Run from CrushlyApp/:  npm run e2e
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:8081';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** First onboarding step — proof the member is signed in and past auth. */
const ONBOARDING = 'What are you looking for?';
const PASSWORD = 'Crushly-e2e-2026';

function admin(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run the e2e suite.');
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let counter = 0;
function uniqueEmail(tag: string): string {
  counter += 1;
  return `e2e.${tag}.${Date.now()}.${counter}@crushly.app`;
}

/** E2E members are deleted again so the project doesn't accumulate them. */
const created: string[] = [];
test.afterEach(async () => {
  const a = admin();
  for (const id of created.splice(0)) {
    await a.auth.admin.deleteUser(id).catch(() => {});
  }
});

async function signUpViaApp(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: /18 or older/ }).check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({ timeout: 30_000 });
}

test('sign-up: verify with the emailed code', async ({ page }) => {
  const email = uniqueEmail('code');
  await signUpViaApp(page, email, PASSWORD);

  const { data, error } = await admin().auth.admin.generateLink({ type: 'signup', email });
  expect(error).toBeNull();
  const otp = data?.properties?.email_otp;
  if (data?.user?.id) created.push(data.user.id);
  expect(otp).toMatch(/^\d{6}$/);

  await page.getByRole('button', { name: 'Verify with code', exact: true }).click();
  await page.getByLabel('Confirmation code', { exact: true }).fill(otp!);
  // Auto-submits at 6 digits → session → profile bootstrapped → onboarding.
  await expect(page.getByRole('heading', { name: ONBOARDING })).toBeVisible({ timeout: 45_000 });
});

test('sign-up: verify with the emailed link', async ({ page }) => {
  const email = uniqueEmail('link');
  await signUpViaApp(page, email, PASSWORD);

  // The app offers the link path too — send it (also exercises the resend call).
  await page.getByRole('button', { name: 'Get a link', exact: true }).click();
  await expect(page.getByText('Link sent!')).toBeVisible();

  const { data, error } = await admin().auth.admin.generateLink({
    type: 'signup',
    email,
    options: { redirectTo: BASE },
  });
  expect(error).toBeNull();
  const link = data?.properties?.action_link;
  if (data?.user?.id) created.push(data.user.id);
  expect(link).toBeTruthy();

  // One tap on the emailed link lands signed in.
  await page.goto(link!);
  await expect(page.getByRole('heading', { name: ONBOARDING })).toBeVisible({ timeout: 45_000 });
});

test('password reset: verify with the emailed code', async ({ page }) => {
  const email = uniqueEmail('reset');
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: 'Crushly-e2e-old',
    email_confirm: true,
  });
  expect(error).toBeNull();
  created.push(data.user.id);

  await page.goto('/');
  await page.getByRole('button', { name: 'I already have an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('link', { name: /Forgot password/ }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({ timeout: 30_000 });

  const res = await admin().auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: BASE },
  });
  expect(res.error).toBeNull();
  const otp = res.data?.properties?.email_otp;
  expect(otp).toMatch(/^\d{6}$/);

  await page.getByRole('button', { name: 'Verify with code', exact: true }).click();
  await page.getByLabel('Code from your email', { exact: true }).fill(otp!);
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat new password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Save new password', exact: true }).click();

  // Recovery code + new password → signed straight in → onboarding.
  await expect(page.getByRole('heading', { name: ONBOARDING })).toBeVisible({ timeout: 45_000 });
});
