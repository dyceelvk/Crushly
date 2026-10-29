/**
 * The acceptance checks for the post viewer / comments sheet, measured rather
 * than eyeballed. Navigates the way a person does: open the captioned clip,
 * then tap the comments control.
 *
 *   EMAIL=... PASSWORD=... node e2e/verify-comments-ui.mjs
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
const W = Number(process.env.W ?? 402);
const H = Number(process.env.H ?? 874);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const measure = () => page.evaluate(() => {
  const vh = window.innerHeight;
  const field = document.querySelector('[aria-label="Write a comment"]');
  const send = document.querySelector('[aria-label="Send comment"]');
  const fr = field ? field.getBoundingClientRect() : null;
  const sr = send ? send.getBoundingClientRect() : null;
  let scroller = null;
  for (const el of document.querySelectorAll('div')) {
    if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 100 && el.clientWidth > 200) { scroller = el; break; }
  }
  return {
    vh,
    // The heading is React Native's Txt, which may wrap its text — so look for
    // the sheet's own close control instead, and confirm the heading text too.
    sheetHeading:
      !!document.querySelector('[aria-label="Close comments"]') ||
      [...document.querySelectorAll('*')].some((n) => (n.textContent || '').trim() === 'Comments' && n.children.length <= 1),
    fieldOnScreen: !!fr && fr.bottom <= vh + 1 && fr.top >= 0 && fr.height > 10,
    sendOnScreen: !!sr && sr.bottom <= vh + 1 && sr.top >= 0,
    fieldTop: fr ? Math.round(fr.top) : null,
    gapUnderField: fr ? Math.round(vh - fr.bottom) : null,
    list: scroller ? { canScroll: scroller.scrollHeight > scroller.clientHeight + 4 } : null,
  };
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function signIn() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  const ex = page.getByText('I already have an account', { exact: false }).first();
  if (await ex.count()) { await ex.click({ force: true }).catch(() => {}); await page.waitForTimeout(1100); }
  await page.locator('input[placeholder*="mail" i], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const btn = page.getByText(/^(Sign in|Log in|Continue)$/i).first();
  if (await btn.count()) await btn.click({ force: true }).catch(() => {});
  else await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForTimeout(4200);
}

async function openViewer() {
  const cap = page.getByText('Golden hour in Port Harcourt', { exact: false }).first();
  await cap.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(700);
  const spot = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (n) => n.textContent && n.textContent.startsWith('Golden hour in Port Harcourt') && n.children.length === 0,
    );
    if (!el) return null;
    let node = el;
    let box = null;
    for (let i = 0; i < 8 && node; i++) { const r = node.getBoundingClientRect(); if (r.height > 300) { box = r; break; } node = node.parentElement; }
    return box ? { x: box.x + box.width / 2, y: box.y + 140 } : null;
  });
  if (spot) { await page.mouse.click(spot.x, spot.y); await page.waitForTimeout(2200); }
  return page.evaluate(() => !!document.querySelector('[aria-label="More options"]'));
}

await signIn();
const inViewer = await openViewer();
check('the post viewer opens', inViewer);

// ---------- 1. the default viewer shows no composer at all ----------
const closed = await measure();
check('viewer: no comment field', closed.fieldTop === null, closed.fieldTop === null ? '' : `found at y=${closed.fieldTop}`);
check('viewer: no send button', !closed.sendOnScreen);
await page.screenshot({ path: `${OUT}/verify-1-viewer-closed.png` });

// the other parts of the default viewer
const chrome = await page.evaluate(() => {
  const has = (sel) => !!document.querySelector(sel);
  return {
    creator: has('[aria-label$="Space"]'),
    like: has('[aria-label^="Like"], [aria-label^="Unlike"]'),
    comment: has('[aria-label^="Comment, "], [aria-label^="Comments, "]'),
    bookmark: has('[aria-label$="post"]') && document.querySelectorAll('[aria-label*="sav" i]').length > 0,
    caption: [...document.querySelectorAll('div')].some((n) => (n.textContent || '').startsWith('Golden hour in Port Harcourt') && n.children.length === 0),
    // The pill reads "View comments" and carries the count in its label:
    // "View comments, 8". Both shapes are accepted.
    viewComments: [...document.querySelectorAll('[aria-label]')].some((n) =>
      /^(View \d+ comments?|View comments(|, \d+))$/.test(n.getAttribute('aria-label'))),
  };
});
check('viewer: creator header', chrome.creator);
check('viewer: like / comment / bookmark icons', chrome.like && chrome.comment && chrome.bookmark,
  `like=${chrome.like} comment=${chrome.comment} bookmark=${chrome.bookmark}`);
check('viewer: caption near the bottom', chrome.caption);
check('viewer: compact "View comments" with the count', chrome.viewComments);

// ---------- 2. the sheet carries the composer ----------
const openBtn = page.locator('[aria-label^="View comments"], [aria-label^="View "][aria-label*="comments"], [aria-label^="Comment, "]').first();
if (await openBtn.count()) { await openBtn.click({ force: true }).catch(() => {}); await page.waitForTimeout(1600); }
const opened = await measure();
check('sheet opens with the thread', opened.sheetHeading);
check('sheet: the comment field is present', opened.fieldTop !== null);
check('sheet: the send button is present', opened.sendOnScreen);
check('sheet: composer sits at the bottom', opened.gapUnderField !== null && opened.gapUnderField <= 30, `gap ${opened.gapUnderField}px`);
await page.screenshot({ path: `${OUT}/verify-2-sheet-open.png` });

// ---------- 3. the list scrolls under the composer ----------
const scrolled = await page.evaluate(() => {
  for (const el of document.querySelectorAll('div')) {
    if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 100 && el.clientWidth > 200) {
      el.scrollTop = Math.floor(el.scrollHeight / 2);
      return el.scrollTop;
    }
  }
  return -1;
});
await page.waitForTimeout(400);
const afterScroll = await measure();
check('sheet: list scrolls', scrolled > 0, `scrollTop ${scrolled}`);
check('sheet: composer stays put while scrolling', afterScroll.fieldTop === opened.fieldTop, `${opened.fieldTop} -> ${afterScroll.fieldTop}`);

// ---------- 4. the keyboard does not bury it ----------
await page.locator('[aria-label="Write a comment"]').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(400);
await page.setViewportSize({ width: W, height: Math.round(H * 0.62) });
await page.waitForTimeout(900);
const kb = await measure();
check('keyboard open: field still on screen', kb.fieldOnScreen);
check('keyboard open: send still on screen', kb.sendOnScreen);
await page.screenshot({ path: `${OUT}/verify-3-keyboard.png` });
await page.setViewportSize({ width: W, height: H });
await page.waitForTimeout(500);

// ---------- 5. closing takes the whole interface away ----------
const close = page.locator('[aria-label="Close comments"]').last();
if (await close.count()) { await close.click({ force: true }).catch(() => {}); await page.waitForTimeout(1400); }
const after = await measure();
check('closed: sheet gone', !after.sheetHeading);
check('closed: no comment field', after.fieldTop === null, after.fieldTop === null ? '' : `found at y=${after.fieldTop}`);
check('closed: no send button', !after.sendOnScreen);
await page.screenshot({ path: `${OUT}/verify-4-closed-again.png` });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('failed:'); failed.forEach((f) => console.log(' -', f.name, f.detail)); }
await browser.close();
process.exit(failed.length ? 1 : 0);
