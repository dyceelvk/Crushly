// Expo's web export writes a bare shell: <title>holUpp</title> and nothing
// else in the head. That is what Google reads for a search snippet, and what
// WhatsApp / X / Telegram / iMessage read for a link preview — so an unbranded
// "holUpp" and a blank card is what the world sees today when a member shares
// the site.
//
// React cannot fix this: the head of a static file is written before any JS
// runs. So the tags are stamped in here, after `expo export`, from build:web.
//
// Idempotent — a second run finds its own marker and exits. If the export ever
// changes shape and index.html is missing, this fails loudly rather than
// shipping a site with no preview.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://holupapp.vercel.app';
const TITLE = 'holUpp — where crushes become conversations';
const DESCRIPTION =
  'holUpp is where a crush turns into a conversation. Post a Moment, join a Space, and meet the people already curious about you. Free on Android and the web.';
const IMAGE = `${SITE}/brand/share-card.png`;
const MARKER = '<!-- crushly-seo -->';

// Search Console ownership. The value is public by design - it ships in the
// HTML of every page - so it lives here rather than in a secret. The env var
// still wins if one is ever set, so another property can be added without a
// code change.
const VERIFY = String(
  process.env.GOOGLE_SITE_VERIFICATION ?? 'YeeCgU2SU9k12xZv_iPTCFhwBmskf_9z3auJ4TQnTAw',
).trim();

// Google can render the app's JavaScript, but it is slower and more expensive
// for it to do so. Giving it the same words in plain HTML costs nothing and is
// the honest version of the page: what holUpp is, and why there is nothing to
// see without JavaScript.
const NOSCRIPT = `<noscript>
      <div style="max-width:540px;margin:56px auto;padding:0 24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#17120E;color:#B5A38C;">
        <h1 style="font-size:24px;line-height:1.35;color:#F3DDA6;margin:0 0 14px;">holUpp &mdash; where crushes become conversations</h1>
        <p style="font-size:15px;line-height:1.8;margin:0 0 12px;">holUpp is a social app for the moment before you speak. Post a Moment that disappears in 24 hours, join a Space around something you actually care about, and find out who was already curious about you.</p>
        <p style="font-size:15px;line-height:1.8;margin:0;">Free on Android and in the browser. This page needs JavaScript enabled &mdash; the app itself runs once it loads.</p>
      </div>
    </noscript>`;

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const indexFile = `${dist}index.html`;

if (!existsSync(indexFile)) {
  console.error(`seo-head: no ${indexFile} — did the web export run?`);
  process.exit(1);
}

const html = await readFile(indexFile, 'utf8');

if (html.includes(MARKER)) {
  console.log('seo-head: head already carries the holUpp tags, nothing to do.');
  process.exit(0);
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'holUpp',
      url: SITE,
      logo: `${SITE}/brand/holup-mark.png`,
      description: DESCRIPTION,
    },
    { '@type': 'WebSite', name: 'holUpp', url: SITE },
  ],
};

const tags = [
  MARKER,
  `<meta name="description" content="${DESCRIPTION}" />`,
  `<meta name="robots" content="index,follow" />`,
  `<link rel="canonical" href="${SITE}/" />`,
  `<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />`,
  VERIFY ? `<meta name="google-site-verification" content="${VERIFY}" />` : '',
  `<meta property="og:type" content="website" />`,
  `<meta property="og:site_name" content="holUpp" />`,
  `<meta property="og:title" content="${TITLE}" />`,
  `<meta property="og:description" content="${DESCRIPTION}" />`,
  `<meta property="og:url" content="${SITE}/" />`,
  `<meta property="og:image" content="${IMAGE}" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta property="og:image:alt" content="holUpp — where crushes become conversations" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:title" content="${TITLE}" />`,
  `<meta name="twitter:description" content="${DESCRIPTION}" />`,
  `<meta name="twitter:image" content="${IMAGE}" />`,
  `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
]
  .filter(Boolean)
  .map((line) => `    ${line}`)
  .join('\n');

const withTitle = html.replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`);
const withNoscript = withTitle.replace(/<noscript>[\s\S]*?<\/noscript>/i, NOSCRIPT);
const patched = withNoscript.replace(/<\/head>/i, `${tags}\n  </head>`);

if (patched === withNoscript) {
  console.error('seo-head: found no </head> to inject into — refusing to ship an unlabelled page.');
  process.exit(1);
}

await writeFile(indexFile, patched);
console.log(`seo-head: title, description, share card and canonical stamped in${VERIFY ? ' (Search Console tag included)' : ''}.`);
