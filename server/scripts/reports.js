/** Moderator tool: list open safety reports.  `npm run reports` */
import { getDb } from '../src/db.js';

const rows = getDb()
  .prepare(
    `SELECT r.id, r.reason, r.details, r.context, r.created_at, a.email AS reporter, b.email AS reported
       FROM reports r JOIN users a ON a.id = r.reporter_id JOIN users b ON b.id = r.reported_id
      WHERE r.status = 'open' ORDER BY r.created_at`,
  )
  .all();
if (!rows.length) console.log('No open reports.');
rows.forEach((r) => console.log(`#${r.id} [${r.reason}] ${r.reporter} → ${r.reported} (${new Date(r.created_at).toISOString()})${r.context ? ` via ${r.context}` : ''}\n   ${r.details || '(no details)'}`));
