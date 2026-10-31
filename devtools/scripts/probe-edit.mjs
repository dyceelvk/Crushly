// Probe Edit Space in the harness: what the pronouns row actually contains,
// what a cap on interests/languages does, and whether the save path leaves the
// screen thinking it is still dirty.
import { open, sleep } from './cdp.mjs';

const p = await open('edit');

// 1. The pronouns row as rendered.
const pronouns = await p.ev(`(() => {
  const chips = [...document.querySelectorAll('[role="checkbox"]')].slice(0, 6);
  const inputs = [...document.querySelectorAll('input, textarea')];
  const values = inputs.map(el => ({ tag: el.tagName, value: el.value, placeholder: el.placeholder, aria: el.getAttribute('aria-label') }));
  return { chips: chips.map(c => ({ label: c.getAttribute('aria-label'), checked: c.getAttribute('aria-checked') })), values };
})()`);
console.log('PRONOUN CHIPS + INPUTS:');
console.log(JSON.stringify(pronouns, null, 2));

// 2. Tap the first pronoun chip, see if it selects and whether the text box clears.
await p.ev(`(() => { const el = [...document.querySelectorAll('[role="checkbox"]')][0]; el.scrollIntoView({block:'center'}); return true; })()`);
await sleep(600);
await p.tap(`[...document.querySelectorAll('[role="checkbox"]')][0]`, 'first pronoun chip');
const afterChip = await p.ev(`(() => {
  const chips = [...document.querySelectorAll('[role="checkbox"]')].slice(0,6).map(c => ({ label: c.getAttribute('aria-label'), checked: c.getAttribute('aria-checked') }));
  const inputs = [...document.querySelectorAll('input')].map(el => el.value);
  return { chips, inputs };
})()`);
console.log('AFTER TAPPING FIRST PRONOUN:', JSON.stringify(afterChip, null, 2));
await p.shot('/home/user/evidence/edit-probe-pronoun.png');

// 3. Interests cap: how many are selected, and what does an eleventh tap do?
await p.scrollTo(1500);
const cap = await p.ev(`(() => {
  const all = [...document.querySelectorAll('[role="checkbox"]')].map(c => c.getAttribute('aria-label'));
  return all.length;
})()`);
console.log('total checkboxes on screen:', cap);
console.log('console/errors:', p.logs.slice(0, 10));
await p.close();
