# holupp.net — now on Cloudflare DNS (13 Nov 2026)

The host's nameservers never served the apex `A` records (ns1 master had a newer SOA serial
with no apex A, ns2 an older serial with them). Rather than wait for a weekday support desk,
the zone was recreated on Cloudflare's free DNS.

## Zone

| | |
| --- | --- |
| Zone ID | `6d3af60697ffafb1bb91ab13f0a5d817` |
| Account | `ac2868504ec6646d8e3342e6d10e3d69` (Rielos) |
| Status | `pending` until the registrar's nameservers change |
| Nameservers to set | **`hans.ns.cloudflare.com`**, **`sharon.ns.cloudflare.com`** |

## Records (all DNS-only / grey cloud — proxying would break Vercel's certificate)

```
A      @      216.198.79.1
A      @      64.29.17.1
CNAME  www    1680767b10051ab7.vercel-dns-017.com
MX     @      10 mailserver.businessidentity.llc
TXT    @      v=spf1 a mx include:spf.postal.businessidentity.llc ~all
TXT    postal-1k0g5o._domainkey    v=DKIM1; t=s; h=sha256; p=MIGfMA0GCS…IDAQAB;
TXT    _dmarc   v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; ruf=…; fo=1
CNAME  psrp    rp.postal.businessidentity.llc
```

The DKIM and DMARC values were read from the old zone's live nameservers, not retyped.
`_acme-challenge` TXT records were deliberately not copied: they were the old host's
certificate challenge, already consumed, and Vercel issues its own certificate.

## Left to do (registrar only)

At **domainregistry.com → holupp.net → Nameservers → use custom nameservers**, replace

```
ns1.hosting.businessidentity.llc
ns2.hosting.businessidentity.llc
```

with

```
hans.ns.cloudflare.com
sharon.ns.cloudflare.com
```

Cloudflare flips the zone from `pending` to `active` on its own, usually within minutes to a
few hours, and emails confirmation. Then Vercel issues the certificate and
`https://holupp.net` serves the app.

Mail is unaffected: the mailbox still lives on `mailserver.businessidentity.llc` (66.223.100.94),
and the MX record now travels with the zone.
