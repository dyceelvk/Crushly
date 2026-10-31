// Video frame + controls proof.
//
// Captures a sequence from the harness, because the thing being proved is
// temporal: a tap must pause, and the disc must say so and then get out of the
// way. A single screenshot cannot show that.
//
// usage: viddemo.mjs <url> <outPrefix> [--scroll=620] [--wait=9000]
import './ws-shim.mjs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
const pos = args.filter((a) => !a.startsWith('--'));
const url = pos[0];
const prefix = pos[1];
const wait = Number(opts.wait ?? 9000);
const scrollTo = Number(opts.scroll ?? 0);
const W = Number(opts.w ?? 390);
const H = Number(opts.h ?? 844);

const t = await (await fetch('http://127.0.0.1:9222/json/new', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, wait));

const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value;
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${prefix}-${name}.png`, Buffer.from(data, 'base64'));
  console.log('  saved', `${prefix}-${name}.png`);
};

if (scrollTo) {
  await ev(`(() => { const sc = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 300); const el = sc.sort((a,b) => b.clientHeight - a.clientHeight)[0]; if (el) { el.scrollTop = ${scrollTo}; el.dispatchEvent(new Event('scroll', { bubbles: true })); } return el ? el.scrollTop : -1; })()`);
  await new Promise((r) => setTimeout(r, 1500));
}

// Where is the video, and is the page reporting it correctly?
const report = await ev(`(() => {
  const vs = [...document.querySelectorAll('video')];
  return vs.map(v => {
    const r = v.getBoundingClientRect();
    const box = v.parentElement?.parentElement?.getBoundingClientRect();
    return { src: (v.currentSrc||'').split('/').pop(), natural: v.videoWidth + 'x' + v.videoHeight, playing: !v.paused, ready: v.readyState, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], frame: box ? [Math.round(box.width), Math.round(box.height)] : null };
  });
})()`);
console.log('videos:', JSON.stringify(report));

await shot('1-paused');

// Tap the middle of the first visible video to play it.
const tapAt = await ev(`(() => {
  const v = [...document.querySelectorAll('video')].find(v => { const r = v.getBoundingClientRect(); return r.top > 0 && r.top < window.innerHeight - 100; });
  if (!v) return null;
  const r = v.getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
})()`);
console.log('tapping', JSON.stringify(tapAt));

const click = async (p) => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
};

if (tapAt) {
  await click(tapAt);
  await new Promise((r) => setTimeout(r, 120));      // disc at its brightest
  await shot('2-tap-flash');
  await new Promise((r) => setTimeout(r, 900));      // disc should be gone, still playing
  await shot('3-playing');
  await click(tapAt);                                 // pause
  await new Promise((r) => setTimeout(r, 900));
  await shot('4-paused-again');
}

const after = await ev(`(() => [...document.querySelectorAll('video')].map(v => ({ src: (v.currentSrc||'').split('/').pop(), playing: !v.paused, t: Number(v.currentTime.toFixed(2)) })))()`);
console.log('after:', JSON.stringify(after));
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${t.id}`);
