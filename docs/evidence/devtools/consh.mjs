// Dump console + exceptions for a harness screen.
import './ws-shim.mjs';
const [,, screen = 'messages', wait = '9000'] = process.argv;
const PORT = 9222;
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') console.log('LOG', m.params.type, m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 400));
  if (m.method === 'Runtime.exceptionThrown') console.log('EXC', (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 1200));
  if (m.method === 'Log.entryAdded') console.log('NET', m.params.entry.level, m.params.entry.text.slice(0, 300));
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:8097/index.html?s=${screen}` });
await new Promise((r) => setTimeout(r, Number(wait)));
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
console.log('BODY', await ev(`document.body.innerText.slice(0,600)`));
console.log('HTMLCHARS', await ev(`document.body.innerHTML.length`));
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
