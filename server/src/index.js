import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db.js';

getDb();
if (process.env.CRUSHLY_SEED === '1') {
  const { seed } = await import('../scripts/seed.js');
  seed();
}
createApp().listen(config.port, config.host, () => {
  console.log(`Crushly API listening on http://${config.host}:${config.port}`);
});
