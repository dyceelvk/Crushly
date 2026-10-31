// Does a search result open the thing that matched?
import './ws-shim.mjs';
const PORT = 9222;
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:8097/index.html?s=search' });
await new Promise((r) => setTimeout(r, 9000));
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

await send('Input.insertText', { text: 'ngozi' });
await new Promise((r) => setTimeout(r, 2200));

// Click each result row in turn and record where it said it was going.
const rows = await ev(`(() => [...document.querySelectorAll('[role="button"]')]
  .map(n => { const r = n.getBoundingClientRect(); return { t: (n.innerText||'').replace(/\\n/g,' | ').slice(0,44), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), h: Math.round(r.height) }; })
  .filter(o => o.h > 40))()`);
console.log('ROWS', JSON.stringify(rows));

const press = async (pt) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 600));
};
console.log('AT-START', JSON.stringify(await ev(`window.__route || null`)));
for (const row of rows) {
  await press(row);
  const now = await ev(`window.__route || null`);
  console.log('TAP', JSON.stringify(row.t), '->', JSON.stringify(now));
  // back to search for the next one
  await ev(`window.history.length && 0`);
  await send('Page.navigate', { url: 'http://127.0.0.1:8097/index.html?s=search' });
  await new Promise((r) => setTimeout(r, 5000));
  await send('Input.insertText', { text: 'ngozi' });
  await new Promise((r) => setTimeout(r, 1800));
}
console.log('ROUTE', JSON.stringify(await ev(`window.__route || null`)));
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
