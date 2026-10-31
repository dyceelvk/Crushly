// Node here is 20, which has no global WebSocket. `ws` from the app's
// node_modules stands in; it implements onopen/onmessage with event.data.
import { createRequire } from 'node:module';
if (typeof globalThis.WebSocket === 'undefined') {
  const require = createRequire(import.meta.url);
  globalThis.WebSocket = require('/tmp/wsnode/node_modules/ws');
}
