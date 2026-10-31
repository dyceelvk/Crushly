// Capture a tall RN-Web screen as a sequence of viewport panels.
// Usage: node --import ./ws-shim.mjs editshot.mjs <screen> <prefix> [panels] [step]
import './ws-shim.mjs';

const [,, screen = 'edit', prefix = 'edit', panels = '5', step = '760'] = process.argv;
const PORT = 9222;
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `http://127.0.0.1:8097/index.html?s=${screen}` });
await new Promise((r) => setTimeout(r, 9000));

const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

const info = await evalJs(`(() => {
  const all = [...document.querySelectorAll('div')];
  const scrollers = all.filter(el => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible');
  if (!scrollers.length) return { ok: false };
  const sc = scrollers.sort((a,b) => b.scrollHeight - a.scrollHeight)[0];
  window.__sc = sc;
  return { ok: true, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight };
})()`);
console.log('scroller', JSON.stringify(info));

const { writeFileSync } = await import('node:fs');
const shots = [];
for (let i = 0; i < Number(panels); i++) {
  const y = i * Number(step);
  await evalJs(`(() => { const sc = window.__sc; if (sc) sc.scrollTop = ${y}; window.scrollTo(0, ${y}); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const f = `/home/user/evidence/${prefix}-${i}.png`;
  writeFileSync(f, Buffer.from(data, 'base64'));
  shots.push(f);
}
console.log('wrote', shots.join(' '));
ws.close();
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
