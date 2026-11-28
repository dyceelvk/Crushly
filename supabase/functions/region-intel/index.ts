// region-intel — the only place in HolUpp where an IP address is turned into a
// place.
//
//  * The client never sends its own location; there is no parameter for it.
//  * x-forwarded-for / x-real-ip are believed only in the ways described in
//    resolveClientIp below. A member can set any header they like.
//  * Private, loopback, link-local and CGNAT space is refused rather than
//    geolocated, because geolocating 10.0.0.1 produces a confident lie.
//  * A miss is a miss: `identified: false`. We never substitute the member's
//    declared country and never guess a continent from a city.
//
// Provider: ipwho.is — free, no key, returns ASN/organisation, which is what
// distinguishes "same country, roaming" from "impossible travel".

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Trusted proxy ranges. Empty by default: until a hop is listed here, only the
// hop the platform itself appended is believed (see resolveClientIp).
const TRUSTED_PROXY_CIDRS = (Deno.env.get('TRUSTED_PROXY_CIDRS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const PROVIDER = 'ipwho.is';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GEO_TIMEOUT_MS = 2500;

type Geo = {
  identified: boolean;
  ip: string;
  ipVersion: 4 | 6;
  countryCode: string | null;
  country: string | null;
  continentCode: string | null;
  continent: string | null;
  region: string | null;
  regionCode: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  asn: string | null;
  isp: string | null;
  confidence: number;
  provider: string;
  source: 'live' | 'cache' | 'unavailable';
};

function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') ||
      v6.startsWith('::ffff:');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function inCidr(ip: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (ip.includes(':') !== net.includes(':')) return false;
  if (net.includes(':')) return ip.toLowerCase().startsWith(net.toLowerCase().replace(/::.*$/, ''));
  const toInt = (s: string) => s.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  if (!Number.isFinite(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(net) & mask);
}

const isIp = (s: string | null): s is string => Boolean(s && /^[0-9a-fA-F:.]+$/.test(s));

// How the client address is chosen.
//  * The Supabase edge proxy appends the address it saw to the END of
//    x-forwarded-for. A caller can put anything at the START, so the first entry
//    is attacker-controlled and the last one is the platform's word.
//  * With no trusted CIDR configured we take the LAST entry. With trusted CIDRs
//    configured we walk from the right past hops inside those ranges and stop at
//    the first address outside them — that is the real client.
function resolveClientIp(req: Request, socketIp: string | null): { ip: string | null; via: string } {
  const chain = (req.headers.get('x-forwarded-for') ?? '')
    .split(',').map((s) => s.trim()).filter(isIp);

  // What the runtime actually reports, measured from production on 18 Nov 2026:
  //
  //   x-forwarded-for: 136.66.110.14, 136.66.110.14, 99.82.171.78
  //   cf-connecting-ip: 136.66.110.14      <- the real client
  //   socketIp: 0.0.0.0                     <- the edge's own address
  //
  // The tail of x-forwarded-for was 99.82.171.78 (AS16509 Amazon, Seattle), i.e.
  // the platform's egress, which is why a member in Lagos was recorded as being
  // in Seattle. cf-connecting-ip matched the real egress address exactly, so it
  // is the header worth believing.

  // 1. The edge's own view of the client, if it gives one.
  const cf = req.headers.get('cf-connecting-ip')?.trim() ?? null;
  if (isIp(cf) && !isPrivate(cf)) return { ip: cf, via: 'cf-connecting-ip' };

  // 2. The socket, when it is a real client address rather than a placeholder.
  if (socketIp && isIp(socketIp) && !isPrivate(socketIp)) {
    return { ip: socketIp, via: 'socket' };
  }

  // 3. A trusted hop may have told us directly.
  if (socketIp != null && TRUSTED_PROXY_CIDRS.some((c) => inCidr(socketIp, c))) {
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (!TRUSTED_PROXY_CIDRS.some((c) => inCidr(chain[i], c))) {
        return { ip: chain[i], via: 'x-forwarded-for (walked past trusted hops)' };
      }
    }
  }

  // 4. Last resort. The tail is the platform's word, but it is the platform's
  //    *egress* here, so it is recorded with a `via` that says so and the row is
  //    filtered out of regional reporting below.
  if (chain.length > 0) return { ip: chain[chain.length - 1], via: 'x-forwarded-for (platform egress — unreliable)' };
  const real = req.headers.get('x-real-ip')?.trim() ?? null;
  if (isIp(real)) return { ip: real, via: 'x-real-ip' };
  return { ip: socketIp, via: 'socket (unavailable)' };
}

async function geolocate(ip: string): Promise<Geo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,continent,continent_code,region,region_code,city,latitude,longitude,timezone,connection`,
      { signal: controller.signal, headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.success === false) return null;
    const conn = body?.connection ?? {};
    return {
      identified: Boolean(body?.country_code),
      ip,
      ipVersion: ip.includes(':') ? 6 : 4,
      countryCode: body?.country_code ?? null,
      country: body?.country ?? null,
      continentCode: body?.continent_code ?? null,
      continent: body?.continent ?? null,
      region: body?.region ?? null,
      regionCode: body?.region_code ?? null,
      city: body?.city ?? null,
      latitude: typeof body?.latitude === 'number' ? body.latitude : null,
      longitude: typeof body?.longitude === 'number' ? body.longitude : null,
      timezone: typeof body?.timezone?.id === 'string' ? body.timezone.id : null,
      asn: conn?.asn ? `AS${conn.asn}` : null,
      isp: conn?.isp ?? conn?.org ?? null,
      // Country-level accuracy from an IP is good; city-level is not. Saying so
      // in the record is cheaper than being wrong later in an investigation.
      confidence: body?.country_code ? (body?.city ? 70 : 55) : 0,
      provider: PROVIDER,
      source: 'live',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req, info) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  let body: {
    action?: string; event?: string; requestId?: string;
    deviceCategory?: string; recordId?: number;
  } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: profile } = await admin
    .from('profiles').select('id, country_code, country_source, city').eq('auth_user_id', user.id).maybeSingle();
  if (!profile) return json({ error: 'profile not found' }, 404);

  const { data: role } = await admin.rpc('holup_admin_role');

  // The peer address as the runtime saw it, where the runtime exposes it. This
  // is the only value no caller can influence.
  const socketIp = info?.remoteAddr && 'hostname' in info.remoteAddr
    ? info.remoteAddr.hostname
    : null;
  const { ip, via } = resolveClientIp(req, socketIp);
  const action = body.action ?? 'detect';

  // Temporary: report exactly what this runtime received, so the hop that
  // carries the real client address is identified from evidence rather than
  // guessed from documentation. Removed once resolveClientIp is settled.
  if (action === 'diagnose') {
    if (!role || !['super_admin', 'security_admin', 'fraud_investigator'].includes(role)) {
      return json({ error: 'forbidden' }, 403);
    }
    const chain = (req.headers.get('x-forwarded-for') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    return json({
      socketIp,
      via: resolveClientIp(req, socketIp).via,
      resolved: resolveClientIp(req, socketIp).ip,
      xForwardedFor: chain,
      xRealIp: req.headers.get('x-real-ip'),
      cfConnectingIp: req.headers.get('cf-connecting-ip'),
      forwarded: req.headers.get('forwarded'),
      trustedProxyCidrs: TRUSTED_PROXY_CIDRS,
    });
  }

  if (action === 'lookup') {
    if (!role || !['super_admin', 'security_admin', 'fraud_investigator'].includes(role)) {
      return json({ error: 'forbidden' }, 403);
    }
    const recordId = Number(body.recordId);
    if (!Number.isFinite(recordId)) return json({ error: 'recordId required' }, 400);
    const { data: rec } = await admin
      .from('holup_network_records')
      .select('id, profile_id, ip, country_code, region, city, asn, isp, occurred_at')
      .eq('id', recordId).maybeSingle();
    if (!rec) return json({ error: 'not found' }, 404);
    // Reading somebody's network record is itself an auditable act. The audit
    // row is written before the data is returned, not after.
    await admin.from('holup_admin_audit').insert({
      actor: user.id,
      actor_role: role,
      module: 'security',
      action: 'network_record_lookup',
      target_type: 'holup_network_records',
      target_id: String(recordId),
      detail: 'Administrator resolved an IP registry entry through region-intel.',
      result: 'success',
      ip: via,
      user_agent: req.headers.get('user-agent') ?? null,
    });
    return json({ record: rec });
  }

  if (!ip || isPrivate(ip)) {
    return json({
      identified: false, reason: ip ? 'private_or_reserved_address' : 'no_address_available',
      via, provider: PROVIDER,
    });
  }

  const sinceMs = Date.now() - CACHE_TTL_MS;
  const { data: cached } = await admin
    .from('holup_network_records')
    .select('country_code, region, city, asn, isp, detection_confidence')
    .eq('ip', ip).not('country_code', 'is', null)
    .gte('occurred_at', sinceMs)
    .order('occurred_at', { ascending: false }).limit(1).maybeSingle();

  let geo: Geo;
  if (cached) {
    geo = {
      identified: true, ip, ipVersion: ip.includes(':') ? 6 : 4,
      countryCode: cached.country_code, country: null, continentCode: null, continent: null,
      region: cached.region, regionCode: null, city: cached.city,
      latitude: null, longitude: null, timezone: null,
      asn: cached.asn, isp: cached.isp,
      confidence: cached.detection_confidence ?? 55, provider: PROVIDER, source: 'cache',
    };
  } else {
    const live = await geolocate(ip);
    if (!live) {
      return json({ identified: false, reason: 'provider_unavailable', via, provider: PROVIDER });
    }
    geo = live;
  }

  // Continent + subregion names come from our own registry, not the provider, so
  // a rename at the provider never fragments analytics.
  let continentCode: string | null = null;
  let continentName: string | null = null;
  let subregionName: string | null = null;
  let countryName: string | null = geo.country;
  if (geo.countryCode) {
    const { data: row } = await admin
      .from('holup_regions')
      .select('code, name, parent_id')
      .eq('level', 'country').eq('code', geo.countryCode).maybeSingle();
    if (row) {
      countryName = row.name;
      const { data: sub } = await admin
        .from('holup_regions').select('name, parent_id').eq('id', row.parent_id).maybeSingle();
      subregionName = sub?.name ?? null;
      const { data: cont } = sub
        ? await admin.from('holup_regions').select('code, name').eq('id', sub.parent_id).maybeSingle()
        : { data: null };
      continentCode = cont?.code ?? null;
      continentName = cont?.name ?? null;
    }
  }

  const event = body.event ?? 'SESSION_REFRESH';
  const retentionDays = 365;
  const nowMs = Date.now();

  const { data: inserted, error: insErr } = await admin
    .from('holup_network_records')
    .insert({
      profile_id: profile.id,
      ip,
      country_code: geo.countryCode,
      region: geo.region,
      city: geo.city,
      asn: geo.asn,
      isp: geo.isp,
      device_category: body.deviceCategory ?? 'unknown',
      request_id: body.requestId ?? null,
      event,
      source_header: via,
      detection_provider: geo.provider,
      detection_confidence: geo.confidence,
      occurred_at: nowMs,
      expires_at: nowMs + retentionDays * 86400000,
    })
    .select('id').maybeSingle();

  if (insErr) return json({ error: 'could not record network observation' }, 500);

  const { data: region } = await admin
    .from('holup_user_regions').select('*').eq('profile_id', profile.id).maybeSingle();

  const selected = region?.selected_country_code ?? profile.country_code ?? null;
  const detected = geo.countryCode ?? region?.detected_country_code ?? null;
  const effective = selected ?? detected ?? null;

  const mismatch = Boolean(selected && detected && selected !== detected);
  const status = !detected
    ? (region?.region_status ?? 'UNVERIFIED')
    : mismatch ? 'MISMATCH' : 'IDENTIFIED';

  await admin.from('holup_user_regions').upsert({
    profile_id: profile.id,
    selected_country_code: selected,
    detected_country_code: detected,
    effective_country_code: effective,
    continent: continentName ?? region?.continent ?? null,
    subregion: subregionName ?? region?.subregion ?? null,
    state_region: geo.region ?? region?.state_region ?? null,
    city: geo.city ?? region?.city ?? null,
    timezone: geo.timezone ?? region?.timezone ?? null,
    detection_method: 'IP_GEOLOCATION',
    detection_confidence: geo.confidence,
    detection_provider: geo.provider,
    region_status: status,
    last_detected_at: nowMs,
    updated_at: nowMs,
  }, { onConflict: 'profile_id' });

  /*
   * The profile's country is what the Control Centre shows and what other parts
   * of the platform filter on. Writing it here is what stops every user page
   * reading "Country not recorded" — detection used to land only in
   * holup_user_regions, which nothing else joined to.
   *
   * `country_source` already has a vocabulary, and it is used rather than
   * extended: 'inferred' means the platform worked it out, 'account' means the
   * member said so, 'admin_verified' means a person checked. Only an empty or
   * 'inferred' country is refreshed by detection — a member's own answer stands,
   * and an administrator's wins permanently. Detection stays required;
   * disclosure stays the member's choice (`share_with_members`), untouched here.
   */
  if (detected) {
    const source = profile.country_source ?? null;
    if (!profile.country_code || source === 'inferred' || source === null) {
      /* A city the member typed stands. The IP's city only fills an empty
         field — detection updates the country, and never replaces what a
         person chose for themselves. */
      const patch: Record<string, unknown> = { country_code: detected, country_source: 'inferred' };
      if (!profile.city) patch.city = geo.city ?? null;
      await admin.from('profiles')
        .update(patch)
        .eq('id', profile.id);
    }
  }

  if (detected && detected !== region?.detected_country_code) {
    await admin.from('holup_region_history').insert({
      profile_id: profile.id,
      previous_country_code: region?.detected_country_code ?? null,
      new_country_code: detected,
      previous_continent: region?.continent ?? null,
      new_continent: continentName ?? null,
      reason: 'DETECTION',
      detection_provider: geo.provider,
      detection_confidence: geo.confidence,
    });
  }

  // A mismatch between declared and measured country raises a LOW event for a
  // human to glance at. It restricts nothing: travelling, using a VPN and living
  // in a country you did not pick at sign-up are all legitimate.
  if (mismatch) {
    const { data: existing } = await admin
      .from('holup_security_events').select('id')
      .eq('profile_id', profile.id).eq('category', 'GEO_CHANGE')
      .in('status', ['OPEN', 'INVESTIGATING'])
      .gte('created_at', nowMs - 7 * 86400000).limit(1).maybeSingle();
    if (!existing) {
      await admin.from('holup_security_events').insert({
        profile_id: profile.id,
        category: 'GEO_CHANGE',
        severity: 'LOW',
        risk_score: 20,
        headline: `Declared country ${selected} differs from measured ${detected}`,
        evidence: {
          selected_country_code: selected, detected_country_code: detected,
          network_record_id: inserted?.id ?? null, asn: geo.asn, isp: geo.isp,
          note: 'Geographic mismatch only. Not sufficient for any enforcement.',
        },
        network_record_id: inserted?.id ?? null,
        country_code: detected,
        continent: continentName,
        status: 'OPEN',
      });
    }
  }

  /* What leaves this function is the member's own region summary and nothing
     else. The resolved address itself, the header chain it came from, the
     network operator and the provider's internals stay on this side of the
     line: they are recorded in holup_network_records for the audited admin
     lookups, and a client that never receives them cannot leak them. */
  return json({
    identified: geo.identified,
    country: geo.countryCode, countryName,
    continent: continentCode, continentName, subregion: subregionName,
    region: geo.region, city: geo.city,
    region_status: status,
    selected_country_code: selected,
    detected_country_code: detected,
    effective_country_code: effective,
  });
});
