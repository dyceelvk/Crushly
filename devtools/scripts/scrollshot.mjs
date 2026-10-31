// Navigate, scroll the main scroller, screenshot.
import './ws-shim.mjs';
// usage: scrollshot.mjs <url> <out> <scrollTop> [--wait=ms] [--h=1500]
const [,, url, out, topArg, ...rest] = process.argv;
const opt = (k, d) => Number((rest.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]);
const wait = opt('wait', 10000);
const H = opt('h', 844);
const top = Number(topArg || 0);
const { writeFileSync } = await import('node:fs');

const t = await (await fetch('http://127.0.0.1:9222/json/new', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: H, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, wait));

const scroll = (y) =>
  send('Runtime.evaluate', {
    expression: `(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+200&&getComputedStyle(e).overflowY!=='visible');const el=els.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];if(!el)return 'no-scroller';el.scrollTop=${y};el.dispatchEvent(new Event('scroll',{bubbles:true}));return el.scrollTop+':'+el.scrollHeight})()`,
    returnByValue: true,
  });

// Two steps, so React sees a real scroll rather than one jump.
console.log('scroll', (await scroll(top * 0.5))?.result?.value);
await new Promise((r) => setTimeout(r, 900));
console.log('scroll', (await scroll(top))?.result?.value);
await new Promise((r) => setTimeout(r, 2500));

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('saved', out);
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${t.id}`);
