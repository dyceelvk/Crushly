/**
 * Crushly ops CLI — the human-review tooling the app deliberately doesn't fake.
 *
 *   node scripts/admin.mjs verify-user --list [--all]        pending verifications
 *   node scripts/admin.mjs verify-user --approve <email>     mark verified + notify
 *   node scripts/admin.mjs verify-user --reject  <email>     mark rejected + notify
 *   node scripts/admin.mjs reports [--status open|resolved|all]
 *   node scripts/admin.mjs reports --resolve <id>            mark a report handled
 *   node scripts/admin.mjs purge-demo [--dry-run]            remove seeded demo data
 *
 * Uses the service role key (never ship it in the app) against a local
 * `supabase start` stack or a hosted project:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin -- verify-user --list
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const [cmd, sub, ...rest] = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? (i += 1, rest[i]) : true;
  else positionals.push(rest[i]);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function table(rows, columns) {
  if (!rows.length) {
    console.log('(nothing to show)');
    return;
  }
  const widths = columns.map((c) => Math.max(c.header.length, ...rows.map((r) => String(r[c.key] ?? '').length)));
  console.log(columns.map((c, i) => c.header.padEnd(widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(columns.map((c, i) => String(r[c.key] ?? '').padEnd(widths[i])).join('  '));
}

const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '-');

async function findProfile(email) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, verification')
    .eq('email', email)
    .maybeSingle();
  if (error) fail(`lookup failed: ${error.message}`);
  if (!data) fail(`no profile with email ${email}`);
  return data;
}

async function listVerifications() {
  const all = Boolean(flags.all);
  let q = supabase
    .from('verification_requests')
    .select('id, user_id, pose, status, created_at, reviewed_at, selfie_path, profiles(email, name, verification)')
    .order('id', { ascending: true });
  if (!all) q = q.eq('status', 'pending');
  const { data, error } = await q;
  if (error) fail(error.message);
  table(
    (data ?? []).map((r) => ({
      id: r.id,
      email: r.profiles?.email,
      name: r.profiles?.name,
      profile: r.profiles?.verification,
      pose: r.pose,
      status: r.status,
      sent: when(r.created_at),
      reviewed: when(r.reviewed_at),
    })),
    [
      { header: 'id', key: 'id' },
      { header: 'email', key: 'email' },
      { header: 'name', key: 'name' },
      { header: 'profile', key: 'profile' },
      { header: 'pose', key: 'pose' },
      { header: 'status', key: 'status' },
      { header: 'sent', key: 'sent' },
      { header: 'reviewed', key: 'reviewed' },
    ],
  );
  if (data?.length) console.log(`\nSelfies live in the private "verification" bucket: ${data[0].selfie_path.split('/').slice(0, -1).join('/')}/`);
}

async function reviewUser(decision) {
  const email = positionals[0];
  if (!email) fail(`usage: verify-user --${decision} <email>`);
  const profile = await findProfile(email);

  const { data: reqs, error: reqErr } = await supabase
    .from('verification_requests')
    .update({ status: decision === 'approve' ? 'approved' : 'rejected', reviewed_at: Date.now() })
    .eq('user_id', profile.id)
    .eq('status', 'pending')
    .select('id');
  if (reqErr) fail(reqErr.message);
  if (!reqs?.length) fail(`${email} has no pending verification request`);

  const verification = decision === 'approve' ? 'verified' : 'rejected';
  const { error: profErr } = await supabase.from('profiles').update({ verification }).eq('id', profile.id);
  if (profErr) fail(profErr.message);

  const kind = decision === 'approve' ? 'verified' : 'verification_rejected';
  const body =
    decision === 'approve'
      ? 'Your verification was approved. You now have a verified badge.'
      : 'Your verification wasn’t approved. You can submit a new selfie anytime.';
  const { error: notifyErr } = await supabase.rpc('notify_to', { p_uid: profile.id, p_kind: kind, p_body: body });
  if (notifyErr) fail(`updated, but notification failed: ${notifyErr.message}`);

  console.log(`${decision === 'approve' ? 'Approved' : 'Rejected'} ${email} (${reqs.length} request(s) closed, profile → ${verification}).`);
}

async function listReports() {
  const status = flags.status ?? 'open';
  let q = supabase
    .from('reports')
    .select('id, reporter_id, reported_id, reason, details, context, created_at, handled')
    .order('id', { ascending: true });
  if (status === 'open') q = q.eq('handled', false);
  else if (status === 'resolved') q = q.eq('handled', true);
  else if (status !== 'all') fail('--status must be open, resolved or all');
  const { data, error } = await q;
  if (error) fail(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_id]))];
  const byId = new Map();
  if (ids.length) {
    const { data: profs, error: profErr } = await supabase.from('profiles').select('id, email, verification').in('id', ids);
    if (profErr) fail(profErr.message);
    for (const p of profs ?? []) byId.set(p.id, p);
  }
  table(
    rows.map((r) => ({
      id: r.id,
      reported: byId.get(r.reported_id)?.email,
      verified: byId.get(r.reported_id)?.verification,
      by: byId.get(r.reporter_id)?.email,
      reason: r.reason,
      details: r.details || r.context || '',
      sent: when(r.created_at),
      handled: r.handled ? 'yes' : 'no',
    })),
    [
      { header: 'id', key: 'id' },
      { header: 'reported', key: 'reported' },
      { header: 'verified', key: 'verified' },
      { header: 'by', key: 'by' },
      { header: 'reason', key: 'reason' },
      { header: 'details', key: 'details' },
      { header: 'sent', key: 'sent' },
      { header: 'handled', key: 'handled' },
    ],
  );
}

async function resolveReport() {
  const raw = positionals[0] ?? (typeof flags.resolve === 'string' ? flags.resolve : null);
  const id = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(id)) fail('usage: reports --resolve <id>');
  const { data, error } = await supabase.from('reports').update({ handled: true }).eq('id', id).select('id');
  if (error) fail(error.message);
  if (!data?.length) fail(`no report #${id}`);
  console.log(`Report #${id} marked handled.`);
}

async function purgeDemo() {
  const dryRun = Boolean(flags['dry-run']);
  const { data: demos, error } = await supabase.from('profiles').select('id, auth_user_id, email, name').eq('is_demo', true);
  if (error) fail(error.message);
  const rows = demos ?? [];
  if (!rows.length) console.log('No demo members found — nothing to purge.');
  else {
    table(
      rows.map((r) => ({ id: r.id, email: r.email, name: r.name })),
      [
        { header: 'id', key: 'id' },
        { header: 'email', key: 'email' },
        { header: 'name', key: 'name' },
      ],
    );
    if (dryRun) {
      console.log(`\nDry run: would delete ${rows.length} demo member(s) and everything they touched (crushes, chats, moments, notifications).`);
    } else {
      for (const r of rows) {
        // Deleting the auth user cascades to profiles and every member row.
        const { error: delErr } = await supabase.auth.admin.deleteUser(r.auth_user_id);
        if (delErr) fail(`failed to delete ${r.email}: ${delErr.message}`);
      }
      console.log(`Deleted ${rows.length} demo member(s) and everything they touched.`);
    }
  }
  const { data: files, error: listErr } = await supabase.storage.from('media').list('seed', { limit: 1000 });
  if (listErr) fail(listErr.message);
  const names = (files ?? []).filter((f) => f.name).map((f) => `seed/${f.name}`);
  if (!names.length) console.log('No demo photos in media/seed/.');
  else if (dryRun) console.log(`Dry run: would remove ${names.length} demo photo(s) from media/seed/.`);
  else {
    const { error: rmErr } = await supabase.storage.from('media').remove(names);
    if (rmErr) fail(rmErr.message);
    console.log(`Removed ${names.length} demo photo(s) from media/seed/.`);
  }
  if (dryRun) console.log('\nNothing was deleted. Drop --dry-run to purge.');
}

switch (`cmd:${cmd}`) {
  case 'cmd:verify-user':
    if (flags.list !== undefined || flags.all) await listVerifications();
    else if (flags.approve) await reviewUser('approve');
    else if (flags.reject) await reviewUser('reject');
    else fail('usage: verify-user --list [--all] | --approve <email> | --reject <email>');
    break;
  case 'cmd:reports':
    if (flags.resolve !== undefined || positionals[0]) await resolveReport();
    else await listReports();
    break;
  case 'cmd:purge-demo':
    await purgeDemo();
    break;
  default:
    fail('usage: admin.mjs verify-user ... | reports ... | purge-demo [--dry-run]');
}
