// Tiny CDP driver for RN-Web screens. Node 20 has no global WebSocket; ws-shim
// stands one in from the app's node_modules.
import './ws-shim.mjs';
import { writeFileSync } from 'node:fs';

const PORT = 9222;

export async function open(screen, { width = 390, height = 844 } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: `http://127.0.0.1:8097/index.html?s=${screen}` });
  await sleep(9000);

  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

  const rectOf = (sel) =>
    ev(`(() => { const el = ${sel}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, top: r.y }; })()`);

  const tapPoint = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(500);
  };

  const scrollTo = async (y) => {
    await ev(`(() => {
      const all = [...document.querySelectorAll('div')];
      const sc = all.filter(el => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible')
        .sort((a,b) => b.scrollHeight - a.scrollHeight)[0];
      if (sc) sc.scrollTop = ${y};
      return sc ? sc.scrollTop : -1;
    })()`);
    await sleep(700);
  };

  return {
    ws, send, ev, logs, scrollTo, rectOf, tapPoint,
    async tap(sel, label = '') {
      const r = await rectOf(sel);
      if (!r) { console.log('  tap: not found', label || sel); return false; }
      // Bring it into view first.
      if (r.top < 60 || r.top > height - 200) {
        await ev(`(() => { const el = ${sel}; if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
        await sleep(500);
      }
      const r2 = await rectOf(sel);
      await tapPoint(r2.x, r2.y);
      return true;
    },
    async shot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
