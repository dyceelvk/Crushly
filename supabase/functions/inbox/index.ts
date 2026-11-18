// holUpp inbox — the receiving half of the mail that leaves this project.
//
// Welcome letters and receipts are sent from rielincos.com; replies and support mail
// arrive at info@rielincos.com, where Resend receives them (its MX is the domain's MX).
// Resend has no mailbox to read them in, so this function is the mailbox:
//   · POST /inbox  { }            — sync: pull everything Resend has received, store what is new
//   · POST /inbox  <webhook body> — email.received from Resend, verified with its Svix signature
// It stores and lists; the Control Centre renders. Attachments are metadata only —
// their temporary URLs expire, so they are fetched fresh when opened.
//
// Secrets: RESEND_API_KEY, DISPATCH_SECRET, INBOX_WEBHOOK_SECRET (whsec_…).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET') ?? '';
const WEBHOOK_SECRET = Deno.env.get('INBOX_WEBHOOK_SECRET') ?? '';

const RESEND = 'https://api.resend.com';
const HEADERS = {
  Authorization: `Bearer ${RESEND_API_KEY}`,
  'Content-Type': 'application/json',
  // Resend sits behind Cloudflare, which rejects a bare runtime User-Agent.
  'User-Agent': 'holupp-inbox/1.0',
};

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`rest ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Resend signs webhooks the Svix way: HMAC-SHA256 over `<id>.<timestamp>.<body>`
 * with the base64 secret behind `whsec_`. Verified here rather than trusted,
 * because this endpoint writes into the Control Centre's inbox — an unauthenticated
 * caller must not be able to put words in a support mailbox.
 */
async function validSignature(request: Request, raw: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signatures = request.headers.get('svix-signature');
  if (!id || !timestamp || !signatures) return false;

  // Five minutes is Svix's own tolerance; a replayed older request is refused.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const keyBytes = Uint8Array.from(atob(WEBHOOK_SECRET.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // The header carries space-separated `v1,<sig>` entries; any match is valid.
  return signatures.split(' ').some((part) => {
    const [, value] = part.split(',');
    return value === expected;
  });
}

/**
 * A display name and a bare address.
 *
 * Resend's parsed `from` field is only the address (`support@rielincos.com`), so the
 * name is read from the raw `From:` header, which still has it. Without this every
 * sender would appear nameless in the mailbox.
 */
function splitAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) return { email: match[2].trim().toLowerCase(), name: match[1].trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

async function alreadyStored(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await rest<{ resend_id: string }[]>(
    `inbox_messages?resend_id=in.(${ids.map((id) => `"${id}"`).join(',')})&select=resend_id`,
  );
  return new Set(rows.map((row) => row.resend_id));
}

async function store(id: string, known: Set<string>, refresh = false): Promise<boolean> {
  if (known.has(id) && !refresh) return false;

  let detail: Record<string, unknown>;
  try {
    const response = await fetch(`${RESEND}/emails/receiving/${id}`, { headers: HEADERS });
    if (!response.ok) return false;
    detail = await response.json();
  } catch {
    return false;
  }

  const headers = (detail.headers ?? {}) as Record<string, string>;
  // The parsed field is the bare address; the raw header keeps the name.
  const from = splitAddress(headers['from'] ?? String(detail.from ?? ''));
  const replyTo = headers['reply-to'] ? splitAddress(headers['reply-to']).email : null;
  const references = (headers['references'] ?? '').match(/<[^>]+>/g) ?? [];

  const attachments = Array.isArray(detail.attachments)
    ? (detail.attachments as Record<string, unknown>[]).map((file) => ({
        id: file.id ?? null,
        filename: file.filename ?? 'attachment',
        contentType: file.content_type ?? 'application/octet-stream',
        size: file.size ?? null,
      }))
    : [];

  try {
    await rest('inbox_messages?on_conflict=resend_id', {
      method: 'POST',
      headers: { Prefer: refresh ? 'resolution=merge-duplicates,return=minimal' : 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([{
        resend_id: id,
        from_email: from.email || 'unknown',
        from_name: from.name,
        reply_to: replyTo || null,
        to_emails: Array.isArray(detail.to) ? detail.to : [],
        cc_emails: Array.isArray(detail.cc) ? detail.cc : [],
        subject: (detail.subject as string) ?? null,
        text_body: (detail.text as string) ?? null,
        html_body: (detail.html as string) ?? null,
        message_id: (detail.message_id as string) ?? null,
        in_reply_to: headers['in-reply-to'] ?? null,
        references_ids: references,
        attachments,
        received_at: detail.created_at ? new Date(String(detail.created_at)).getTime() : Date.now(),
      }]),
    });
  } catch {
    return false;
  }
  return true;
}

async function sync(): Promise<{ seen: number; added: number }> {
  let seen = 0;
  let added = 0;
  let cursor: string | undefined;

  for (let page = 0; page < 3; page += 1) {
    const url = `${RESEND}/emails/receiving?limit=50${cursor ? `&after=${cursor}` : ''}`;
    let body: { data?: { id: string }[]; has_more?: boolean };
    try {
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) break;
      body = await response.json();
    } catch {
      break;
    }
    const list = body.data ?? [];
    if (!list.length) break;
    seen += list.length;
    const known = await alreadyStored(list.map((row) => row.id));
    for (const row of list) added += (await store(row.id, known)) ? 1 : 0;
    cursor = list[list.length - 1]?.id;
    if (!body.has_more) break;
  }

  return { seen, added };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });

  const raw = await request.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const signed = await validSignature(request, raw);
  const bearer = request.headers.get('authorization') ?? '';
  const trusted = bearer === `Bearer ${SERVICE_KEY}` || (DISPATCH_SECRET && bearer === `Bearer ${DISPATCH_SECRET}`);
  if (!signed && !trusted) return Response.json({ error: 'unauthorised' }, { status: 401 });
  if (!RESEND_API_KEY) return Response.json({ error: 'RESEND_API_KEY is not set' }, { status: 500 });

  if (payload.type === 'email.received') {
    const data = (payload.data ?? {}) as { email_id?: string; id?: string };
    const id = data.email_id ?? data.id;
    if (!id) return Response.json({ ok: true, ignored: 'no email id' });
    const known = await alreadyStored([id]);
    return Response.json({ ok: true, added: await store(id, known) });
  }

  // Repair pass: re-read what is already stored and fill in the name and reply-to
  // that earlier versions did not keep. Safe to run more than once.
  if (payload.action === 'refresh') {
    const rows = await rest<{ resend_id: string }[]>('inbox_messages?select=resend_id&order=id.desc&limit=100');
    let updated = 0;
    for (const row of rows) updated += (await store(row.resend_id, new Set(), true)) ? 1 : 0;
    return Response.json({ ok: true, refreshed: updated });
  }

  if (typeof payload.id === 'string' && payload.action !== 'sync') {
    const known = await alreadyStored([payload.id]);
    return Response.json({ ok: true, added: await store(payload.id, known) });
  }

  try {
    return Response.json({ ok: true, ...(await sync()) });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
});
