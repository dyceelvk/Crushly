import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_CONTACT_EMAIL,
  COMPANY_NAME,
  COMPANY_SITE,
  OWNERSHIP_EXPLANATION,
  OWNERSHIP_SENTENCE,
  companySite,
  companyUrl,
} from './company';

test('the company is RielOS and the site is its own domain', () => {
  assert.equal(COMPANY_NAME, 'RielOS');
  assert.equal(COMPANY_SITE, 'https://rielincos.com');
  assert.equal(companySite(), 'https://rielincos.com');
  // no trailing slash, https, no www — one canonical address
  assert.doesNotMatch(COMPANY_SITE, /\/$/);
  assert.match(COMPANY_SITE, /^https:\/\//);
  assert.doesNotMatch(COMPANY_SITE, /\/\/www\./);
});

test('paths hang off the site without doubling a slash', () => {
  assert.equal(companyUrl(), 'https://rielincos.com');
  assert.equal(companyUrl('/'), 'https://rielincos.com');
  assert.equal(companyUrl('legal/terms'), 'https://rielincos.com/legal/terms');
  assert.equal(companyUrl('/legal/terms'), 'https://rielincos.com/legal/terms');
});

test('ownership is said plainly and names the company once', () => {
  assert.equal(OWNERSHIP_SENTENCE, 'holUpp is owned, developed and operated by RielOS.');
  assert.match(OWNERSHIP_SENTENCE, /owned, developed and operated by RielOS/);
  // The sentence must not hedge — no "part of", no "a brand of".
  assert.doesNotMatch(OWNERSHIP_SENTENCE, /part of|brand of|powered by/i);
});

test('the explainer answers all three questions a person asks', () => {
  const all = OWNERSHIP_EXPLANATION.join(' ');
  assert.match(all, /product of RielOS/);
  // who runs it
  assert.match(all, /operates it/);
  // and how to reach them
  assert.match(all, /rielincos\.com/);
  assert.ok(all.includes(COMPANY_CONTACT_EMAIL));
});

test('the app never spells the company as a product name', () => {
  // The brand is holUpp / HolUpp. "Holupp", "Holup" and "Riel Inc." are wrong
  // everywhere, and this file is where the company is named.
  const all = [COMPANY_NAME, OWNERSHIP_SENTENCE, ...OWNERSHIP_EXPLANATION].join(' ');
  assert.doesNotMatch(all, /Riel Inc\./);
  assert.doesNotMatch(all, /Holup(p)?\b/);
});
