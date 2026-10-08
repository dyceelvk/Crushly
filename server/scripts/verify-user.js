/**
 * Moderator tool: review pending verification requests.
 *
 *   npm run verify-user                      # list pending requests
 *   npm run verify-user -- approve <email>   # approve after checking the selfie in data/private/
 *   npm run verify-user -- reject <email>
 */
import { getDb, now } from '../src/db.js';
import { config } from '../src/config.js';
import { notify } from '../src/lib/social.js';

const [action, email] = process.argv.slice(2);
const db = getDb();

if (!action) {
  const rows = db
    .prepare(
      `SELECT u.email, p.name, v.pose, v.selfie_path, v.created_at FROM verification_requests v
         JOIN users u ON u.id = v.user_id JOIN profiles p ON p.user_id = v.user_id
        WHERE v.status = 'pending' ORDER BY v.created_at`,
    )
    .all();
  if (!rows.length) console.log('No pending verification requests.');
  rows.forEach((r) => console.log(`${r.email}  (${r.name})  pose: "${r.pose}"  selfie: ${config.privateDir}/${r.selfie_path}`));
  process.exit(0);
}

const user = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email || '').toLowerCase());
if (!user || !['approve', 'reject'].includes(action)) {
  console.error('Usage: npm run verify-user -- approve|reject <email>');
  process.exit(1);
}
const status = action === 'approve' ? 'verified' : 'rejected';
db.prepare("UPDATE verification_requests SET status = ?, reviewed_at = ? WHERE user_id = ? AND status = 'pending'").run(status === 'verified' ? 'approved' : 'rejected', now(), user.id);
db.prepare('UPDATE profiles SET verification = ? WHERE user_id = ?').run(status, user.id);
notify(user.id, status === 'verified' ? 'verified' : 'verification_rejected');
console.log(`${email} → ${status}`);
