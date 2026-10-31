// Prove the interest cap now speaks instead of swallowing the tap.
import { open, sleep } from './cdp.mjs';

const p = await open('edit');

const tapLabel = async (label) => {
  const sel = `[...document.querySelectorAll('[role="checkbox"]')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(label)})`;
  await p.ev(`(() => { const el = ${sel}; el.scrollIntoView({block:'center'}); return true; })()`);
  await sleep(400);
  const r = await p.rectOf(sel);
  await p.tapPoint(r.x, r.y);
};

const pick = ['Music', 'Fitness', 'Fashion', 'Gaming', 'Travel', 'Movies'];
for (const label of pick) await tapLabel(label);
// 3 already selected (Music, Coffee, Design) → six more taps land on 8.
const more = ['Food', 'Art'];
for (const label of more) await tapLabel(label);

const counts = async () =>
  p.ev(`(() => {
    const txt = [...document.querySelectorAll('div')].map(d => d.textContent).find(t => t && /^Interests · \\d+\\/10$/.test(t.trim()));
    return txt ? txt.trim() : null;
  })()`);
console.log('after 10 picks:', await counts());

// Fill to the cap, then go one past it.
for (const label of ['Books', 'Nightlife', 'Photography', 'Outdoors']) {
  const before = await counts();
  if (String(before).includes('10/10')) break;
  await tapLabel(label);
  console.log('  tapped', label, '→', await counts());
}
console.log('at the cap:', await counts());
await tapLabel('Sports');
await sleep(800);
console.log('after one tap past the cap:', await counts());
const toast = await p.ev(`(() => document.body.innerText.includes('swap it out'))()`);
console.log('cap message shown:', toast);
await p.shot('/home/user/evidence/edit-cap-toast.png');
console.log('errors:', p.logs.filter((l) => /EXCEPTION|error/i.test(l)).slice(0, 5));
await p.close();
