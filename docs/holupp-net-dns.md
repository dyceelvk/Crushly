# holupp.net — what is wrong and the exact fix

Checked live on 13 November 2026, from outside the network.

## What the internet says right now

| Name | Asked | Answer |
| --- | --- | --- |
| `holupp.net` | A | **nothing at all** (`Status 0`, zero records) |
| `holupp.net` | NS | `ns1.hosting.businessidentity.llc`, `ns2.hosting.businessidentity.llc` |
| `www.holupp.net` | A | **`66.223.49.89`** — the hosting provider's parked page, not Vercel |
| `www.holupp.net` | CNAME | nothing |

Registrar: **DomainRegistry.com LLC**, registered 12 Nov 2026, expires 12 Nov 2027.
Vercel's own check agrees: `misconfigured: true`, `aValues: []`, `cnames: []`.

So the domain is bought and attached to the project, but the DNS zone has never been
pointed at Vercel. Nothing inside Vercel or inside the app can change that; the records
have to be written in the zone.

## Option A — keep the current nameservers, add the records (smallest change, keeps email)

Log in where the zone lives (the Business Identity hosting panel, or DomainRegistry's DNS
editor) and edit the zone for `holupp.net`:

1. **Delete** the `A` record on `www` that points at `66.223.49.89`.
2. Add, exactly:

```
A      @      216.198.79.1
A      @      64.29.17.1
CNAME  www    1680767b10051ab7.vercel-dns-017.com
```

Leave `MX`, `TXT` (the `spf1 ... postal.businessidentity.llc` record) and everything else
alone — that is mail, and it is not mine to break.

## Option B — hand the whole zone to Vercel (one place to manage, no A records to keep)

At DomainRegistry, set the domain's nameservers to:

```
ns1.vercel-dns.com
ns2.vercel-dns.com
```

Vercel then writes and owns every record. The catch: any mailbox currently on the hosting
zone has to be recreated as records in Vercel, or mail stops.

## After either option

Propagation is usually minutes, and can take a few hours. Then:

* `https://holupp.net` and `https://www.holupp.net` serve the web app over HTTPS
  (Vercel issues the certificate itself, free, once the records resolve).
* `https://holupp.net/.well-known/assetlinks.json` starts answering, which is what lets an
  Android App Link open the app instead of a browser tab.
* The intent filters in `app.config.js` already list `holupp.net` **and**
  `www.holupp.net`, so the installed app handles the new links; they still also list
  `holupapp.vercel.app`, so links shared before today keep opening.

## What is already done on my side

* `holupp.net` and `www.holupp.net` are both on the Vercel project
  `prj_KYBzDmPBZAxHcmau8uzRuhT9dlze`, verified, with no redirect set between them.
* Every share link in the app is minted on `https://holupp.net`:
  posts (`/v/<id>`), Spaces (`/s/<token>`), the `?space=` fallback, the OG card image and
  the canonical tag. Old `holupapp.vercel.app` links are still *read*, and a landing page
  served on the old host advertises the old host rather than pointing readers at a domain
  that does not resolve yet.
