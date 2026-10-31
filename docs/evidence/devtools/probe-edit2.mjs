// Interaction probe for Edit Space: "My own" pronouns, the live completion, slots.
import './ws-shim.mjs';
const PORT = 9222;
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:8097/index.html?s=edit' });
await new Promise((r) => setTimeout(r, 9000));
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const { writeFileSync } = await import('node:fs');

// Chips are role="checkbox" on RN-Web, not "button" — matching only buttons
// quietly found nothing and made every interaction look impossible.
const find = async (label) => ev(`(() => {
  const el = [...document.querySelectorAll('[role="button"],[role="checkbox"],input,button')].find(n =>
    (n.getAttribute('aria-label') || '') === ${JSON.stringify(label)} ||
    (n.innerText || '').trim() === ${JSON.stringify(label)});
  if (!el) return null;
  // A click is dispatched at viewport coordinates, so the target has to be on
  // screen first — a chip 240px below the fold is unclickable, not broken.
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (r.width < 2) return null;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: el.getAttribute('aria-disabled') };
})()`);

const click = async (pt) => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  }
  await new Promise((r) => setTimeout(r, 700));
};

// 1. what the empty photo slots say they are
console.log('SLOTS', JSON.stringify(await ev(`(() => [...document.querySelectorAll('[aria-label^="Add photo"]')]
  .map(n => ({ label: n.getAttribute('aria-label'), disabled: n.getAttribute('aria-disabled'), opacity: getComputedStyle(n).opacity })))()`)));

// 2. the completion line before anything is touched
const pct = async () => ev(`(() => { const t = document.body.innerText; const m = t.match(/Profile (\\d+)% complete[\\s\\S]{0,60}/); return m ? m[0].replace(/\\n/g, ' | ') : null; })()`);
console.log('PCT-BEFORE', await pct());

// 3. click "My own"
const mine = await find('My own');
await new Promise((r) => setTimeout(r, 400));
console.log('MYOWN', JSON.stringify(mine));
if (mine) await click(mine);
const afterOwn = await ev(`(() => { const i = [...document.querySelectorAll('input')].find(n => (n.getAttribute('aria-label')||'') === 'Custom pronouns'); return i ? { present: true, focused: document.activeElement === i } : { present: false }; })()`);
console.log('CUSTOM-INPUT', JSON.stringify(afterOwn));
const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/home/user/evidence/edit-own-pronouns.png', Buffer.from(data, 'base64'));

// 4. the number is live: watch it move between two states in one session
const topShot = async (file) => {
  await ev(`(() => { const sc = [...document.querySelectorAll('div')].filter(el => el.scrollHeight > el.clientHeight + 20).sort((a,b) => b.scrollHeight - a.scrollHeight)[0]; if (sc) sc.scrollTop = 0; window.scrollTo(0,0); return true; })()`);
  await new Promise((r) => setTimeout(r, 800));
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
};
await topShot('/home/user/evidence/edit-live-80.png');
const before = await pct();
const opt = await find('Often');
await new Promise((r) => setTimeout(r, 400));
console.log('LIFESTYLE-CHIP', JSON.stringify(opt), 'before:', before);
if (opt) { await click(opt); console.log('PCT-AFTER-1', await pct()); }
// "Never" also exists in the Workout group, and picking it there just replaces
// "Often" — same one filled key, same score. "Sober" is Drinking's own answer.
const opt2 = await find('Sober');
await new Promise((r) => setTimeout(r, 400));
if (opt2) { await click(opt2); console.log('PCT-AFTER-2', await pct()); }
// Back to the top before the last shot: the interaction scrolled the page to
// the chip that was clicked, so the completion line is off screen.
await ev(`(() => { const sc = [...document.querySelectorAll('div')].filter(el => el.scrollHeight > el.clientHeight + 20).sort((a,b) => b.scrollHeight - a.scrollHeight)[0]; if (sc) sc.scrollTop = 0; window.scrollTo(0,0); return true; })()`);
await new Promise((r) => setTimeout(r, 900));
await topShot('/home/user/evidence/edit-live-85.png');
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
