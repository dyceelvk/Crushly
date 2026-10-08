#!/usr/bin/env node
/**
 * Crushly admin tools — run locally, never shipped to members.
 *
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in the environment
 *   (service role key: Supabase → Settings → API Keys → service_role —
 *    keep it out of chat and out of the repo; rotate if it leaks).
 *
 *   npm run admin -- review-verification          members waiting on review
 *   npm run admin -- decide <requestId> <approved|rejected>
 *   npm run admin -- ai-assist <requestId>        AI review assist (admin-only)
 *   npm run admin -- purge-demo                   remove the fictional demo community
 */
import { createClient } from '@supabase/supabase-js';

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment first.');
  console.error('  SUPABASE_URL                Supabase → Project Settings → API → Project URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY   Supabase → Settings → API Keys → service_role key');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

async function reviewVerification() {
  const { data: rows, error } = await supabase
    .from('verification_requests')
    .select('id, user_id, status, didit_status, created_at, decision, profiles!inner(name, email)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) fail(error.message);
  if (!rows?.length) {
    console.log('No members waiting on review.');
    return;
  }
  console.log(`Members waiting on review (${rows.length}):\n`);
  for (const r of rows) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    console.log(`  #${r.id}  ${p?.name ?? '?'} <${p?.email ?? '?'}>`);
    console.log(`      didit: ${r.didit_status ?? 'n/a'}   requested: ${new Date(Number(r.created_at)).toLocaleString()}`);
    if (r.decision) console.log(`      decision: ${JSON.stringify(r.decision).slice(0, 220)}`);
  }
  console.log('\nDecide with:  npm run admin -- decide <requestId> <approved|rejected>');
  console.log('AI assist:    npm run admin -- ai-assist <requestId>   (advisory only — you decide)');
}

async function decide(requestId, verdict) {
  if (!['approved', 'rejected'].includes(verdict)) fail('verdict must be approved or rejected');
  const { data: row, error } = await supabase
    .from('verification_requests')
    .select('id, user_id, status')
    .eq('id', Number(requestId))
    .maybeSingle();
  if (error || !row) fail(`request ${requestId} not found`);
  const { error: upErr } = await supabase
    .from('verification_requests')
    .update({ status: verdict, reviewed_at: Date.now() })
    .eq('id', row.id);
  if (upErr) fail(upErr.message);
  const profileStatus = verdict === 'approved' ? 'verified' : 'rejected';
  const { error: profErr } = await supabase.from('profiles').update({ verification: profileStatus }).eq('id', row.user_id);
  if (profErr) fail(profErr.message);
  console.log(`✓ request #${row.id} ${verdict} — profile verification set to '${profileStatus}'.`);
}

async function aiAssist(requestId) {
  const res = await fetch(`${url}/functions/v1/verify-identity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: Number(requestId) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`AI assist failed (HTTP ${res.status}): ${body.error ?? 'unknown error'}`);
  console.log(`AI verdict for request #${requestId} (advisory — the human decides):`);
  console.log(JSON.stringify(body, null, 2));
}

async function purgeDemo() {
  // The fictional demo community lives under @crushly.app addresses (seed.sql).
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, auth_user_id, email')
    .like('email', '%@crushly.app');
  if (error) fail(error.message);
  if (!profiles?.length) {
    console.log('No demo members found — nothing to purge.');
    return;
  }
  for (const p of profiles) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(p.auth_user_id);
    if (delErr) console.error(`  could not delete ${p.email}: ${delErr.message}`);
  }
  console.log(`✓ Purged ${profiles.length} demo member(s) (${profiles.map((p) => p.email).join(', ')}).`);
}

const commands = {
  'review-verification': () => reviewVerification(),
  decide: () => decide(args[0], args[1]),
  'ai-assist': () => aiAssist(args[0]),
  'purge-demo': () => purgeDemo(),
};

if (!commands[cmd]) {
  console.error(`Unknown command: ${cmd ?? '(none)'}\n`);
  console.error('Usage:');
  console.error('  npm run admin -- review-verification');
  console.error('  npm run admin -- decide <requestId> <approved|rejected>');
  console.error('  npm run admin -- ai-assist <requestId>');
  console.error('  npm run admin -- purge-demo');
  process.exit(1);
}

await commands[cmd]();
