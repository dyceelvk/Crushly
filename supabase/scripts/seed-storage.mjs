/**
 * Uploads the demo portraits (supabase/seed/photos) to the public `media`
 * bucket under `seed/`, matching the paths in seed.sql.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:photos
 *
 * Use the service role key (never ship it in the app). Works against a local
 * `supabase start` stack or a hosted project.
 */
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

const supabase = createClient(url, key);
const photosDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'photos');

const files = (await readdir(photosDir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
if (!files.length) {
  console.error(`No photos found in ${photosDir}`);
  process.exit(1);
}

let ok = 0;
for (const file of files) {
  const body = await readFile(path.join(photosDir, file));
  const { error } = await supabase.storage
    .from('media')
    .upload(`seed/${file}`, body, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    console.error(`✗ seed/${file}: ${error.message}`);
    process.exitCode = 1;
  } else {
    ok += 1;
    console.log(`✓ seed/${file}`);
  }
}
console.log(`Uploaded ${ok}/${files.length} demo photos to media/seed/.`);
