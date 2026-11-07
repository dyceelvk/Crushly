// Expo's web export writes a bare shell: <title>Crushly</title> and nothing
// else in the head. That is what Google reads for a search snippet, and what
// WhatsApp / X / Telegram / iMessage read for a link preview — so an unbranded
// "Crushly" and a blank card is what the world sees today when a member shares
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

const SITE = 'https://mecrushly.vercel.app';
const TITLE = 'Crushly — where crushes become conversations';
const DESCRIPTION =
  'Crushly is where a crush turns into a conversation. Post a Moment, join a Space, and meet the people already curious about you. Free on Android and the web.';
const IMAGE = `${SITE}/brand/share-card.png`;
const MARKER = '<!-- crushly-seo -->';

// Set GOOGLE_SITE_VERIFICATION in the build env (Vercel project settings or the
// deploy workflow) to the content string Search Console gives you, and the
// ownership meta tag rides along with every deploy.
const VERIFY = String(process.env.GOOGLE_SITE_VERIFICATION ?? '').trim();

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const indexFile = `${dist}index.html`;

if (!existsSync(indexFile)) {
  console.error(`seo-head: no ${indexFile} — did the web export run?`);
  process.exit(1);
}

const html = await readFile(indexFile, 'utf8');

if (html.includes(MARKER)) {
  console.log('seo-head: head already carries the Crushly tags, nothing to do.');
  process.exit(0);
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Crushly',
      url: SITE,
      logo: `${SITE}/brand/crushly-mark.png`,
      description: DESCRIPTION,
    },
    { '@type': 'WebSite', name: 'Crushly', url: SITE },
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
  `<meta property="og:site_name" content="Crushly" />`,
  `<meta property="og:title" content="${TITLE}" />`,
  `<meta property="og:description" content="${DESCRIPTION}" />`,
  `<meta property="og:url" content="${SITE}/" />`,
  `<meta property="og:image" content="${IMAGE}" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta property="og:image:alt" content="Crushly — where crushes become conversations" />`,
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
const patched = withTitle.replace(/<\/head>/i, `${tags}\n  </head>`);

if (patched === withTitle) {
  console.error('seo-head: found no </head> to inject into — refusing to ship an unlabelled page.');
  process.exit(1);
}

await writeFile(indexFile, patched);
console.log(`seo-head: title, description, share card and canonical stamped in${VERIFY ? ' (Search Console tag included)' : ''}.`);
