/**
 * Signs in as the throwaway probe account, walks to the Flow, opens the
 * comments sheet and photographs it. Not a test — a way to look at the thing.
 *
 *   EMAIL=... PASSWORD=... node e2e/shoot-comments.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE ?? 'http://127.0.0.1:8080';
const EMAIL = process.env.EMAIL ?? '';
const PASSWORD = process.env.PASSWORD ?? '';
const shot = (p) => `${OUT}/${p}`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Sign in
await page.getByText('I already have an account').click();
await page.waitForTimeout(800);
await page.locator('input[type="email"], input[autocomplete="email"], input[placeholder*="mail" i]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
await page.screenshot({ path: shot('01-signed-in.png') });
console.log('after sign-in:', (await page.locator('body').innerText()).slice(0, 300).replace(/\n{2,}/g, ' | '));

// Post 16 is the one carrying the thread; its card sits second in the feed.
// Open the post itself, then its comments — the sheet is the same either way,
// but the populated state is what needs looking at.
// The text-only card has no media, so tapping it does not open a viewer —
// its comment count is the control that opens the sheet.
const count = page.getByLabel(/^Comments, \d+$/).last();
console.log('comment controls:', await count.count());
await count.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await count.click({ force: true }).catch(() => {});
await page.waitForTimeout(2400);

const viewReplies = page.getByLabel(/^View \d+ repl/).first();
if (await viewReplies.count()) {
  await viewReplies.click({ force: true }).catch(() => {});
  await page.waitForTimeout(900);
}
await page.screenshot({ path: shot('06-thread-with-avatars.png') });

// Reply from the UI: the sheet should switch into "Replying to" and post.
const replyBtn = page.getByLabel(/^Reply to /).first();
console.log('reply controls:', await replyBtn.count());
if (await replyBtn.count()) {
  await replyBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('07-replying.png') });
  const field = page.getByLabel('Write a comment').first();
  await field.fill('Answering from the UI, not the API.');
  await page.getByLabel('Send comment').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2600);
  await page.screenshot({ path: shot('08-after-ui-reply.png') });
  console.log('after sending:', (await page.locator('body').innerText()).slice(-420).replace(/\n{2,}/g, ' | '));
}

if (errors.length) {
  console.log('--- page errors ---');
  console.log([...new Set(errors)].slice(0, 6).join('\n').slice(0, 1200));
}
await browser.close();
