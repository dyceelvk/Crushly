import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CRUSHLY_DATA_DIR || path.join(root, 'data');

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  root,
  dataDir,
  dbFile: process.env.CRUSHLY_DB || path.join(dataDir, 'crushly.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  privateDir: path.join(dataDir, 'private'),
  seedPhotosDir: path.join(root, 'seed', 'photos'),
  /** Built Expo web app served by the API in production / preview. */
  webDist: process.env.CRUSHLY_WEB_DIST || path.resolve(root, '..', 'CrushlyApp', 'dist'),
  /** Free members get a few Deep Crushes a day; Crushly Plus would lift the cap. */
  freeDeepCrushesPerDay: 3,
  momentLifetimeMs: 24 * 60 * 60 * 1000,
  onlineWindowMs: 5 * 60 * 1000,
  maxPhotos: 6,
  maxUploadBytes: 12 * 1024 * 1024,
};
