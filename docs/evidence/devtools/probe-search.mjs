// Type into Search and capture the result states.
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
const { writeFileSync } = await import('node:fs');
const shot = async (f) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(f, Buffer.from(data, 'base64')); };

console.log('EMPTY', JSON.stringify(await ev(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,300)`)));
await shot('/home/user/evidence/search-before-0.png');

await send('Input.insertText', { text: 'ngozi' });
await new Promise((r) => setTimeout(r, 2500));
console.log('TYPED', JSON.stringify(await ev(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,600)`)));
await shot('/home/user/evidence/search-before-1.png');
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
