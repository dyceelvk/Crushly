import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { socialRouter } from './routes/social.js';
import { messagesRouter } from './routes/messages.js';
import { momentsRouter } from './routes/moments.js';
import { notificationsRouter } from './routes/notifications.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '200kb' }));

  // Native clients call the API cross-origin; tokens travel in headers, never cookies.
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'crushly' }));
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api', socialRouter);
  app.use('/api', messagesRouter);
  app.use('/api', momentsRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  // User media: long cache, names are random & immutable.
  const mediaOpts = { maxAge: '30d', immutable: true, fallthrough: false };
  app.use('/uploads', express.static(config.uploadsDir, mediaOpts));
  app.use('/seed', express.static(config.seedPhotosDir, mediaOpts));

  // Expo web build (single-page app).
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/uploads|\/seed).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Something went wrong.';
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (12 MB max).' : 'That upload didn’t work. Try again.';
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'We couldn’t read that request.';
    } else if (status === 404 && err.code === 'ENOENT') {
      message = 'Not found.';
    }
    if (status >= 500) {
      console.error(err);
      message = 'Something went wrong on our side. Please try again.';
    }
    res.status(status).json({ error: { message, code: err.code && typeof err.code === 'string' && !err.code.startsWith('E') ? err.code : undefined } });
  });

  return app;
}
