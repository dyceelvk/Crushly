import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './errors.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.privateDir, { recursive: true });

const EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/gif': '.gif',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'video/webm': '.webm', // some browsers label MediaRecorder audio as video/webm
};

const storageFor = (dir) =>
  multer.diskStorage({
    destination: dir,
    // Unguessable names: media is served by URL, so the name is the capability.
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(18).toString('base64url') + (EXT[file.mimetype] || '')),
  });

const filter = (prefixes) => (_req, file, cb) => {
  const type = (file.mimetype || '').split(';')[0];
  file.mimetype = type;
  if (prefixes.some((p) => type.startsWith(p)) && EXT[type]) return cb(null, true);
  cb(new HttpError(415, prefixes.includes('audio/') ? 'That audio format isn’t supported.' : 'Please choose a JPG, PNG, WEBP or HEIC image.'));
};

const limits = { fileSize: config.maxUploadBytes, files: 1 };

export const imageUpload = multer({ storage: storageFor(config.uploadsDir), fileFilter: filter(['image/']), limits });
export const mediaUpload = multer({ storage: storageFor(config.uploadsDir), fileFilter: filter(['image/', 'audio/', 'video/webm']), limits });
export const privateUpload = multer({ storage: storageFor(config.privateDir), fileFilter: filter(['image/']), limits });

export const publicUrlFor = (file) => `/uploads/${file.filename}`;

export function removeUploadedFile(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  fs.rm(path.join(config.uploadsDir, path.basename(url)), { force: true }, () => {});
}
