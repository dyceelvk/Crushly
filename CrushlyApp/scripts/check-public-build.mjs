// Fail closed. Only these two public client config values are allowed.
const url = String(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/^['"]|['"]$/g, '');
const key = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim().replace(/^['"]|['"]$/g, '');
if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url) || !key) throw Error('Set the two public Supabase build variables.');
let role;
try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch {}
if (!key.startsWith('sb_publishable_') && role !== 'anon') throw Error('Client key must be publishable or a legacy anon key. Never bundle server credentials.');
const allowed = new Set(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
for (const name of Object.keys(process.env)) {
  if (name.startsWith('EXPO_PUBLIC_') && !allowed.has(name)) throw Error('Unexpected public build variable: ' + name);
}
console.log('Public build configuration validated. No credential values printed.');
