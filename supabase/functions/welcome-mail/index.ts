// holUpp welcome mail — the letter a member gets the first time they are actually
// inside holUpp.
//
// Not a confirmation, not a reset: those are about getting in. This one is about
// being in — the same job Meta's welcome mail does after you join Facebook. It is
// sent from RielOS, the company that owns and operates holUpp, and it is the only
// mail holUpp sends that is not about a credential.
//
// Called two ways, both fine:
//   · POST { "id": <welcome_mail id> }  — the dispatcher, right after onboarding
//   · POST { }                          — drains whatever is queued (the cron path)
// The queue row is claimed with a status transition, so two callers cannot send
// the same letter twice.
//
// Secrets: RESEND_API_KEY, WELCOME_FROM, WELCOME_REPLY_TO, DISPATCH_SECRET.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('WELCOME_FROM') ?? 'RielOS <hello@rielincos.com>';
const REPLY_TO = Deno.env.get('WELCOME_REPLY_TO') ?? 'info@rielincos.com';
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://holupp.net';
/** The one public contact address. Nothing is sent from an address nobody reads. */
const SITE = 'https://rielincos.com';

type WelcomeRow = {
  id: number;
  profile_id: number;
  email: string;
  name: string | null;
  status: string;
  attempts: number;
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * The letter.
 *
 * Markup is table-based with inline styles because Gmail is the destination, and
 * Gmail strips <style> blocks. Light on purpose: a white card on a pale ground,
 * one idea per paragraph, and a single button — a welcome that lists twelve
 * features is a manual, not a welcome.
 */
function welcomeHtml(name: string) {
  const who = name ? `Hi ${escapeHtml(name.split(' ')[0])},` : 'Hi,';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f7f6f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Welcome to holUpp. Here is what to do first.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f9;">
    <tr><td align="center" style="padding:36px 14px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#ffffff;border-radius:20px;border:1px solid #e8e5ee;">
        <tr><td style="padding:32px 32px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a6f90;font-weight:700;">A note from RielOS</div>
          <div style="margin-top:16px;font-size:24px;font-weight:700;color:#1a1522;line-height:1.3;">Welcome to holUpp.</div>
          <div style="margin-top:14px;font-size:15px;color:#4e475d;line-height:1.75;">
            ${who}<br /><br />
            Your account is ready, and you are in. holUpp is where people find each other, share moments
            that disappear after a day, and talk without an audience.
          </div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="font-size:13.5px;color:#4e475d;line-height:1.9;">
            <b style="color:#1a1522;">Three things worth doing first</b><br />
            1. Finish your Space — a photo and a line about you is all it takes.<br />
            2. Add up someone you know. If they add you back, a Whisper opens.<br />
            3. Post a Moment. It is gone in 24 hours, so nothing has to be perfect.
          </div>
        </td></tr>

        <tr><td align="center" style="padding:26px 32px 6px;">
          <a href="${APP_URL}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14.5px;font-weight:600;padding:13px 26px;border-radius:12px;">Open holUpp</a>
        </td></tr>

        <tr><td style="padding:18px 32px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="font-size:13px;color:#6b6379;line-height:1.75;">
            One honest note: verification is a real review, not a button. If you ever want the checkmark,
            the requirements are published in the app before you apply — nothing is decided quietly.
          </div>
        </td></tr>

        <tr><td style="padding:24px 32px 32px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="border-top:1px solid #eeebf3;padding-top:18px;font-size:12px;color:#8b8399;line-height:1.75;">
            You are getting this because this address finished signing up to holUpp. It is sent once.<br />
            Questions or replies go to <a href="mailto:${REPLY_TO}" style="color:#6d28d9;text-decoration:none;font-weight:600;">${REPLY_TO}</a>.<br /><br />
            <b style="color:#4e475d;">RielOS</b> — the company behind holUpp<br />
            <a href="${SITE}" style="color:#8b8399;text-decoration:none;">${SITE.replace('https://', '')}</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function welcomeText(name: string) {
  const who = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';
  return `Welcome to holUpp.

${who}

Your account is ready, and you are in. holUpp is where people find each other, share
moments that disappear after a day, and talk without an audience.

Three things worth doing first:
1. Finish your Space — a photo and a line about you is all it takes.
2. Add up someone you know. If they add you back, a Whisper opens.
3. Post a Moment. It is gone in 24 hours, so nothing has to be perfect.

Open holUpp: ${APP_URL}

One honest note: verification is a real review, not a button. If you ever want the
checkmark, the requirements are published in the app before you apply — nothing is
decided quietly.

You are getting this because this address finished signing up to holUpp. It is sent once.
Questions or replies go to ${REPLY_TO}.

RielOS — the company behind holUpp
${SITE}`;
}

async function claim(id: number | null): Promise<WelcomeRow[]> {
  if (id !== null) {
    const rows = await rest<WelcomeRow[]>(
      `welcome_mail?id=eq.${id}&status=eq.queued&select=id,profile_id,email,name,status,attempts`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' } , body: JSON.stringify({ status: 'sending' }) },
    );
    return rows;
  }
  // Drain: claim up to 25 queued letters in one statement. `is.null` is not used
  // here — the status transition is the lock, so a second caller sees nothing.
  const queued = await rest<{ id: number }[]>(
    'welcome_mail?status=eq.queued&select=id&order=id.asc&limit=25',
  );
  const out: WelcomeRow[] = [];
  for (const row of queued) {
    const claimed = await rest<WelcomeRow[]>(
      `welcome_mail?id=eq.${row.id}&status=eq.queued&select=id,profile_id,email,name,status,attempts`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sending' }) },
    );
    out.push(...claimed);
  }
  return out;
}

async function send(row: WelcomeRow): Promise<{ ok: boolean; detail: string }> {
  if (!RESEND_API_KEY) return { ok: false, detail: 'RESEND_API_KEY is not set' };

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
        // Resend sits behind Cloudflare, which rejects a bare runtime User-Agent.
        'User-Agent': 'holupp-welcome/1.0',
      },
      body: JSON.stringify({
        from: FROM,
        to: [row.email],
        reply_to: REPLY_TO,
        subject: 'Welcome to holUpp',
        html: welcomeHtml(row.name ?? ''),
        text: welcomeText(row.name ?? ''),
        headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>` },
        tags: [{ name: 'kind', value: 'welcome' }],
      }),
    });
  } catch (error) {
    return { ok: false, detail: `unreachable: ${String(error)}` };
  }

  const body = await response.text();
  if (!response.ok) return { ok: false, detail: `${response.status}: ${body.slice(0, 300)}` };
  try {
    return { ok: true, detail: JSON.parse(body)?.id ?? '' };
  } catch {
    return { ok: true, detail: '' };
  }
}

Deno.serve(async (request) => {
  // A rendering of the letter itself, for the Control Centre's preview. It sends
  // nothing and reads nothing: the same template function the sender calls, with
  // a name to fill in.
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.get('preview') === '1') {
    return new Response(welcomeHtml(url.searchParams.get('name') ?? ''), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (request.method !== 'POST') return new Response('POST only', { status: 405 });

  // The dispatcher proves itself with the shared secret; the cron path may also
  // carry the service key. Anything else is refused before any row is touched.
  const auth = request.headers.get('authorization') ?? '';
  const authorised =
    (DISPATCH_SECRET && auth === `Bearer ${DISPATCH_SECRET}`) || auth === `Bearer ${SERVICE_KEY}`;
  if (!authorised) return Response.json({ error: 'unauthorised' }, { status: 401 });

  let payload: { id?: number } = {};
  try {
    payload = await request.json();
  } catch {
    /* empty body = drain the queue */
  }

  let rows: WelcomeRow[];
  try {
    rows = await claim(typeof payload.id === 'number' ? payload.id : null);
  } catch (error) {
    return Response.json({ error: `claim failed: ${String(error)}` }, { status: 500 });
  }

  const results: { id: number; ok: boolean; detail: string }[] = [];
  for (const row of rows) {
    const outcome = await send(row);
    const patch = outcome.ok
      ? { status: 'sent', sent_at: Date.now(), provider_id: outcome.detail || null, error: null, attempts: row.attempts + 1 }
      : { status: 'failed', error: outcome.detail, attempts: row.attempts + 1 };
    try {
      await rest(`welcome_mail?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch {
      /* the outcome is in this response even if the write back failed */
    }
    results.push({ id: row.id, ...outcome });
  }

  return Response.json({ processed: results.length, results });
});
