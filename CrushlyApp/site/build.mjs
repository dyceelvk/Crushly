/**
 * holUpp.net — the public site, generated.
 *
 * Why a generator and not hand-written HTML: eleven pages share one head, one
 * header, one footer and one set of schemas. Hand-copied, the day somebody fixes
 * the description on the home page is the day nine other pages keep the old one,
 * and the search engine sees a site that disagrees with itself.
 *
 * Why no framework: this is a marketing site. Every page is static HTML that a
 * crawler reads without running JavaScript, the CSS is one file, the JS is one
 * file, and there is nothing to hydrate. That is the difference between a page
 * that renders in 300 ms on a 3G phone and one that needs a bundle first.
 *
 * Output goes into `dist/`, beside the Expo export, so the app's shared routes
 * (/v/, /s/) keep working and the site owns everything else.
 */

import { mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const DIST = path.join(APP_ROOT, 'dist');
const SITE = 'https://holupp.net';
const WORKER = 'https://crushly-media.dyceelvk.workers.dev';

/**
 * The release the site is advertising.
 *
 * Read from the release channel at build time so the structured data cannot
 * disagree with the download page, which reads the same feed in the browser.
 * If the channel is unreachable the build still ships — a marketing page that
 * fails to deploy because a worker was briefly down is a worse outcome than a
 * version number that the page's own JavaScript immediately corrects.
 */
const RELEASE = { version: '1.0.106', size: '94 MB' };

const MARK = `<svg viewBox="0 0 401 286" role="img" aria-label="holUpp" xmlns="http://www.w3.org/2000/svg"><circle cx="116.5" cy="126" r="100.5" fill="#FF8C8A"/><circle cx="274" cy="159" r="110" fill="#F764AB"/><circle cx="216.5" cy="159.5" r="38.5" fill="#361333"/></svg>`;

/* ---------------------------------------------------------------- icons ---
 * Inline, 24px, stroke-only. A sprite would be smaller on a long page, but an
 * inline path cannot 404 and costs one cache miss instead of two requests.
 */
const ICONS = {
  flow: '<path d="M4 7h16M4 12h10M4 17h13"/>',
  crush: '<path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20Z"/>',
  moment: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="7" r="2.2"/><path d="M15.4 12.6c2.4.3 4.1 2 4.6 4.4"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/>',
  whisper: '<path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3H6a2.5 2.5 0 0 1-2.5-2.5v-8A2.5 2.5 0 0 1 6 4.5h11.5A2.5 2.5 0 0 1 20 7Z"/>',
  space: '<circle cx="12" cy="8.2" r="3.4"/><path d="M5 20c.7-3.6 3.5-5.6 7-5.6s6.3 2 7 5.6"/>',
  around: '<path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  big: '<path d="M13 3 5 14h6l-1 7 8-11h-6Z"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6Z"/><path d="M9 12l2 2 4-4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5s1.3-6.1 3.8-8.5Z"/>',
  spark: '<path d="M12 3v5M12 16v5M4.5 12h5M14.5 12h5"/><path d="M7.4 7.4l3 3M13.6 13.6l3 3M16.6 7.4l-3 3M10.4 13.6l-3 3"/>',
};

const icon = (name) => `<span class="icon-tile" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.spark}</svg></span>`;

/* ---------------------------------------------------------------- pages --- */

const NAV = [
  ['/about', 'About'],
  ['/how-it-works', 'How it works'],
  ['/#features', 'Features'],
  ['/download', 'Download'],
];

const FEATURES = [
  { slug: '/flow', name: 'Flow', icon: 'flow', blurb: 'One feed of everything happening across holUpp — posts, clips and people, in the order they happened rather than the order an algorithm prefers.' },
  { slug: '/crushes', name: 'Crushes', icon: 'crush', blurb: 'React to what somebody posted and mean it. A Crush is a real signal between two people, not a vanity counter.' },
  { slug: '/moments', name: 'Moments', icon: 'moment', blurb: 'Photos and clips that disappear after 24 hours. Say the thing, show the day, and let it go.' },
  { slug: '/connections', name: 'Connections', icon: 'people', blurb: 'Add Ups and mutual Crushes become connections — the people you actually talk to, kept in one place.' },
  { slug: '/circles', name: 'Circles', icon: 'circle', blurb: 'Communities built around a shared interest, a city, a hobby or a running conversation.' },
  { slug: '/whispers', name: 'Whispers', icon: 'whisper', blurb: 'Private conversation that opens when the interest is mutual. Text, voice notes, photos — no video.' },
  { slug: '/space', name: 'Space', icon: 'space', blurb: 'Your profile, your identity, your posts: everything about you in one place, with your own handle.' },
  { slug: '/around', name: 'Around', icon: 'around', blurb: 'Find people and things happening near you, without handing over your exact address.' },
  { slug: '/crushes#big', name: 'Big Crushes', icon: 'big', blurb: 'The posts and people collecting the most attention right now, across the whole community.' },
];

const PAGES = [
  {
    path: '/',
    title: 'holUpp — Everything happens on holUpp',
    description:
      'holUpp is a social ecosystem: discover people, share Moments, join Circles and build real connections. Free on Android, and in your browser.',
    h1: 'Everything happens on <span class="grad">holUpp.</span>',
    crumb: null,
    priority: '1.0',
    body: homepage,
  },
  {
    path: '/about',
    title: 'About holUpp — a social ecosystem, not a single feed',
    description:
      'What holUpp is, who it is for and the principles behind it: a social place for everyone, in every country, built around people rather than an algorithm.',
    h1: 'About holUpp',
    crumb: 'About',
    priority: '0.8',
    body: aboutPage,
  },
  {
    path: '/how-it-works',
    title: 'How holUpp works — five steps from joining to connecting',
    description:
      'Join, create your Space, discover on Flow, participate with posts and Moments, then connect. Here is exactly how holUpp works, step by step.',
    h1: 'How holUpp works',
    crumb: 'How it works',
    priority: '0.8',
    body: howPage,
  },
  ...FEATURES.slice(0, 8).map((feature) => ({
    path: feature.slug.split('#')[0],
    title: `${feature.name} on holUpp — ${feature.blurb.split('.')[0]}.`,
    description: feature.blurb,
    h1: feature.name,
    crumb: feature.name,
    priority: '0.7',
    feature,
    body: featurePage,
  })),
  {
    path: '/download',
    title: 'Download holUpp for Android — official APK',
    description:
      'Download the official holUpp Android app. One verified APK, current version, file size and install steps. Free, no account needed to install.',
    h1: 'Get holUpp for Android',
    crumb: 'Download',
    priority: '0.9',
    body: downloadPage,
    extraHead: '',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy — holUpp',
    description: 'What holUpp collects, why, how long it keeps it, and how to have it deleted. Written in plain language.',
    h1: 'Privacy Policy',
    crumb: 'Privacy',
    priority: '0.3',
    body: privacyPage,
  },
  {
    path: '/terms',
    title: 'Terms of Service — holUpp',
    description: 'The rules for using holUpp: who may join, what is not allowed, and what happens when something goes wrong.',
    h1: 'Terms of Service',
    crumb: 'Terms',
    priority: '0.3',
    body: termsPage,
  },
  {
    path: '/contact',
    title: 'Contact and support — holUpp',
    description: 'Reach the holUpp team for support, account help, privacy requests or press. One address, answered by a person.',
    h1: 'Contact and support',
    crumb: 'Contact',
    priority: '0.4',
    body: contactPage,
  },
];

/* ------------------------------------------------------------- templates --- */

/**
 * The heading block shared by every page that does not write its own.
 *
 * One h1 per page, and it is the same element in the same place on every page,
 * so a crawler and a reader both find the subject of the page immediately. The
 * homepage draws its own hero and is skipped.
 */
function pageHero(page) {
  const lead = page.lead || page.description;
  return `
<section class="page-hero">
  <div class="wrap">
    <p class="eyebrow">${escape(page.crumb || 'holUpp')}</p>
    <h1>${page.h1}</h1>
    <p class="lede">${escape(lead)}</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="/download">Get the Android app</a>
      <a class="btn btn-ghost" href="/app" rel="nofollow">Continue on Web</a>
    </div>
  </div>
</section>`;
}

function layout(page) {
  const url = `${SITE}${page.path === '/' ? '/' : page.path}`;
  const isHome = page.path === '/';
  const breadcrumbLd = page.crumb
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
        ],
      }
    : null;

  const graph = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE}/#org`,
      name: 'holUpp',
      alternateName: 'HolUpp',
      url: `${SITE}/`,
      logo: { '@type': 'ImageObject', url: `${SITE}/site/holup-mark.png`, width: 401, height: 286 },
      description: 'holUpp is a social ecosystem for discovering people, sharing Moments and building connections.',
      email: 'support@holupp.net',
      sameAs: [`${SITE}/`],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      url: `${SITE}/`,
      name: 'holUpp',
      inLanguage: 'en',
      publisher: { '@id': `${SITE}/#org` },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  if (isHome || page.path === '/download') {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'holUpp',
      applicationCategory: 'SocialMediaApplication',
      operatingSystem: 'Android 8.0+',
      url: `${SITE}/download`,
      downloadUrl: `${SITE}/download`,
      installUrl: `${SITE}/download`,
      softwareVersion: RELEASE.version,
      fileSize: RELEASE.size,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      publisher: { '@id': `${SITE}/#org` },
      description: 'The official holUpp Android app — Moments, Circles, Whispers and Connections.',
    });
  }

  if (breadcrumbLd) graph.push(breadcrumbLd);
  if (page.path === '/how-it-works') {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: 'How to start on holUpp',
      totalTime: 'PT5M',
      step: [
        ['Join holUpp', 'Create your account and establish your identity.'],
        ['Create your Space', 'Personalise your profile and introduce yourself.'],
        ['Discover', 'Explore Flow, find people, browse Circles and look at what is happening.'],
        ['Participate', 'Share posts, publish Moments, join conversations and interact.'],
        ['Connect', 'Build connections and establish your presence in the community.'],
      ].map(([name, text], i) => ({ '@type': 'HowToStep', position: i + 1, name, text })),
    });
  }
  if (page.path === '/contact') {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      name: 'Contact holUpp',
      url,
      mainEntity: { '@type': 'Organization', name: 'holUpp', email: 'support@holupp.net' },
    });
  }

  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${page.path === href ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  const drawerLinks = [
    ['/about', 'About', 'What holUpp is'],
    ['/how-it-works', 'How it works', 'Five steps'],
    ['/#features', 'Features', 'Flow, Moments, Circles'],
    ['/flow', 'Flow', 'The feed'],
    ['/crushes', 'Crushes', 'React and connect'],
    ['/moments', 'Moments', '24-hour posts'],
    ['/circles', 'Circles', 'Communities'],
    ['/whispers', 'Whispers', 'Private chat'],
    ['/download', 'Download', 'Android APK'],
  ]
    .map(([href, label, note]) => `<a href="${href}">${label}<span>${note}</span></a>`)
    .join('');

  const bodyHtml = page.body({ page });
  const hero = /<h1[\s>]/.test(bodyHtml) ? '' : pageHero(page);
  const crumbs = page.crumb
    ? `<div class="wrap"><ol class="breadcrumbs"><li><a href="/">Home</a></li><li aria-current="page">${page.crumb}</li></ol></div>`
    : '';

  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#0B070C">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="holUpp">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/brand/share-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="holUpp — a social ecosystem for people, Moments and Circles">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(page.title)}">
<meta name="twitter:description" content="${escape(page.description)}">
<meta name="twitter:image" content="${SITE}/brand/share-card.png">
<meta name="google-site-verification" content="YeeCgU2SU9k12xZv_iPTCFhwBmskf_9z3auJ4TQnTAw">
<meta name="msvalidate.01" content="">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/site/theme.css" as="style">
<link rel="stylesheet" href="/site/theme.css">
<script type="application/ld+json">${JSON.stringify(graph.length === 1 ? graph[0] : graph)}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="holUpp home">${MARK}<span class="brand-name">hol<b>Upp</b></span></a>
    <nav class="nav" aria-label="Primary">${nav}</nav>
    <div class="header-actions">
      <a class="btn btn-ghost btn-sm" href="/app" rel="nofollow">Continue on Web</a>
      <a class="btn btn-primary btn-sm" href="/download">Get the app</a>
      <button class="burger" type="button" aria-expanded="false" aria-controls="drawer" aria-label="Open menu"><span></span></button>
    </div>
  </div>
</header>
<div class="drawer" id="drawer">
  <nav aria-label="Mobile">${drawerLinks}</nav>
  <a class="btn btn-ghost btn-wide" href="/app" rel="nofollow">Continue on Web</a>
  <a class="btn btn-primary btn-wide" href="/download" style="margin-top:10px">Get the Android app</a>
</div>
<main id="main">
${crumbs}
${page.path === '/' ? '' : hero}
${bodyHtml}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/">${MARK}<span class="brand-name">hol<b>Upp</b></span></a>
        <p>Discover people, share moments and build connections. Everything happens on holUpp.</p>
      </div>
      <div class="footer-col">
        <h4>holUpp</h4>
        <ul>
          <li><a href="/about">About holUpp</a></li>
          <li><a href="/how-it-works">How It Works</a></li>
          <li><a href="/#features">Features</a></li>
          <li><a href="/download">Download</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Features</h4>
        <ul>
          <li><a href="/flow">Flow</a></li>
          <li><a href="/crushes">Crushes</a></li>
          <li><a href="/moments">Moments</a></li>
          <li><a href="/circles">Circles</a></li>
          <li><a href="/whispers">Whispers</a></li>
          <li><a href="/space">Space</a></li>
          <li><a href="/around">Around</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <ul>
          <li><a href="/app" rel="nofollow">Continue on Web</a></li>
          <li><a href="/privacy">Privacy Policy</a></li>
          <li><a href="/terms">Terms of Service</a></li>
          <li><a href="/contact">Contact</a></li>
          <li><a href="/contact#support">Support</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-base">
      <span>© ${new Date().getFullYear()} holUpp · holupp.net</span>
      <span>Built for people, not for an algorithm.</span>
    </div>
  </div>
</footer>
<script src="/site/site.js" defer></script>
</body>
</html>
`;
}

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------- shared --- */

const shot = (src, alt, cls = '') =>
  `<div class="shot ${cls}"><img src="/site/screens/${src}" alt="${escape(alt)}" loading="lazy" decoding="async"></div>`;

const steps = () => `
<div class="steps">
  ${[
    ['Join holUpp', 'Create your account and establish your identity. Your handle is yours, and it is how people find you.'],
    ['Create your Space', 'Personalise your profile and introduce yourself — a photo, a line about you, and the things you actually care about.'],
    ['Discover', 'Explore Flow, find people, browse Circles and look at what is happening across the community.'],
    ['Participate', 'Share posts, publish Moments, join conversations and interact with what other people have shared.'],
    ['Connect', 'Build connections and establish your presence — Add Ups and mutual Crushes become the people you talk to.'],
  ]
    .map(([title, text]) => `<div class="step reveal"><div class="step-num" aria-hidden="true"></div><div><h3>${title}</h3><p>${text}</p></div></div>`)
    .join('')}
</div>`;

const featureGrid = () => `
<div class="grid g3">
  ${FEATURES.map(
    (f) => `<a class="card reveal" href="${f.slug}">${icon(f.icon)}<h3>${f.name}</h3><p>${f.blurb}</p></a>`,
  ).join('')}
</div>`;

const trustStrip = () => `
<section class="band-tight">
  <div class="wrap">
    <div class="grid g4">
      ${[
        ['Built for everyone', 'Not a niche app. Wherever you are, holUpp works the same.'],
        ['You choose the audience', 'Every post is public or for your connections — never a surprise.'],
        ['Moments expire', 'Photos and clips disappear after 24 hours, by design.'],
        ['No video in private chat', 'Whispers carry text, voice and photos. That is deliberate.'],
      ]
        .map(([title, text]) => `<div class="reveal"><h3 style="font-size:17px">${title}</h3><p style="color:var(--muted);font-size:14.5px;margin:8px 0 0">${text}</p></div>`)
        .join('')}
    </div>
  </div>
</section>`;

/* ----------------------------------------------------------------- pages --- */

function homepage() {
  return `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow reveal">holUpp · a social ecosystem</p>
      <h1 class="reveal">Everything happens on <span class="grad">holUpp.</span></h1>
      <p class="lede reveal">Discover people, share moments, explore conversations and build connections. Your social world has a place on holUpp.</p>
      <div class="hero-cta reveal">
        <a class="btn btn-primary" href="/app" rel="nofollow">Continue on Web</a>
        <a class="btn btn-ghost" href="/download">Get the Android App</a>
      </div>
      <p class="hero-note reveal"><span>Free to join</span><span class="dot"></span><span>Android and web</span><span class="dot"></span><span>Available worldwide</span></p>
    </div>
    <div class="phones reveal">
      <div class="float-card float-a" aria-hidden="true">
        <span class="float-dot"></span>
        <div><b>Moments</b><span>Live for 24 hours</span></div>
      </div>
      <div class="phone phone-main"><img src="/site/screens/feed.png" alt="The holUpp feed on Android, showing a member's post, its reactions and a clip" width="320" height="640"></div>
      <div class="float-card float-b" aria-hidden="true">
        <span class="float-dot alt"></span>
        <div><b>Crush</b><span>Mutual → a Whisper opens</span></div>
      </div>
    </div>
  </div>
</section>

${trustStrip()}

<section class="band" id="about">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">About holUpp</p>
      <h2>A social place for people, not for a feed.</h2>
      <p>holUpp is a social ecosystem where people discover one another, share experiences, take part in conversations, explore communities and build connections. It is not one endless timeline — it is several places that each do one thing well: a feed, a set of communities, a private messenger and a profile that is actually yours.</p>
      <p>It is designed for everyone, regardless of where you live. There is no waitlist and no country list.</p>
    </div>
    <div class="related reveal">
      <a class="chip" href="/about">More about holUpp →</a>
      <a class="chip" href="/how-it-works">How it works →</a>
    </div>
  </div>
</section>

<section class="band" id="features">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Explore holUpp</p>
      <h2>Nine things, and each one has a job.</h2>
      <p>Flow to find things. Crushes to say something. Moments to share a day. Circles to go deeper. Whispers to talk properly.</p>
    </div>
    <div style="margin-top:34px">${featureGrid()}</div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">How holUpp works</p>
      <h2>Five steps from curious to connected.</h2>
    </div>
    ${steps()}
    <div class="related reveal"><a class="chip" href="/how-it-works">Read the full walkthrough →</a></div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <div class="slab reveal">
      <h2>Your holUpp experience starts here.</h2>
      <p>Open holUpp in your browser and pick up where you left off, or install the Android app and get the full experience on your phone.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="/app" rel="nofollow">Continue on Web</a>
        <a class="btn btn-ghost" href="/download">Get the Android App</a>
      </div>
    </div>
  </div>
</section>`;
}

function aboutPage() {
  return `
<section class="band">
  <div class="wrap">
    <div class="wrap" style="padding:0">
      <div class="section-head reveal">
        <p class="eyebrow">Why it exists</p>
        <h2>A social ecosystem, not a single feed.</h2>
        <p class="lede">Most social products are one timeline with different tabs on top. holUpp is built the other way round: a handful of distinct places, each with one purpose, that together make somewhere you can actually spend time.</p>
      </div>
    </div>

    <div class="prose reveal" style="margin-top:34px">
      <p>On holUpp you can <a href="/flow">discover</a> people and content, share <a href="/moments">Moments</a> that expire after a day, take part in conversations, explore <a href="/circles">Circles</a> built around shared interests, and <a href="/connections">build connections</a> with the people you keep coming back to. Everything sits under your own <a href="/space">Space</a> — your profile, your identity and your posts in one place.</p>

      <h2>Who it is for</h2>
      <p>Anyone. holUpp is designed for everyone, regardless of location. The rules are the same in every country, the app is the same on every Android phone, and there is no region-locked feature list. The minimum age is 16.</p>

      <h2>What it is not</h2>
      <ul>
        <li><strong>It is not a dating app.</strong> Crushes are how interest is expressed here, and they can turn into a conversation — but the product is a social place, not a matchmaking one. People use it for friends, for communities, for posting, and for meeting somebody. All of that is normal.</li>
        <li><strong>It is not an engagement machine.</strong> Moments expire, Whispers are private, and there is no infinite scroll that keeps inventing reasons to show you something.</li>
        <li><strong>It is not a directory of people.</strong> Private profiles, private conversations and signed-in screens are never indexed by search engines. Only the public pages you are reading now are.</li>
      </ul>

      <h2>The principles behind it</h2>
      <h3>You choose the audience</h3>
      <p>Every post is either public or for your connections, and the composer says which before you post. There is no third, invisible setting.</p>
      <h3>Deleting means deleting</h3>
      <p>When you delete a post or a message, the row goes and the file goes. Nothing is kept "for a while" in a place the app cannot reach.</p>
      <h3>Private means private</h3>
      <p>Whispers are text, voice notes and photos between two people. No video in private chat — that is a decision about consent and pressure, not a missing feature.</p>
      <h3>Small and honest</h3>
      <p>Where a control can only do one of two things, it says which one it is doing. A button that silently does nothing is worse than a button that explains why it cannot.</p>
    </div>

    <div class="grid g3 reveal" style="margin-top:46px">
      <a class="card" href="/how-it-works">${icon('spark')}<h3>How it works</h3><p>The five steps from joining to connecting.</p></a>
      <a class="card" href="/#features">${icon('flow')}<h3>Features</h3><p>Flow, Crushes, Moments, Circles, Whispers, Space and Around.</p></a>
      <a class="card" href="/download">${icon('phone')}<h3>Get the app</h3><p>The official Android build, with version and size.</p></a>
    </div>
  </div>
</section>`;
}

function howPage() {
  return `
<section class="band">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">How holUpp works</p>
      <h2>Five steps from curious to connected.</h2>
      <p>Nothing here takes long. The first three take about five minutes; the last two are the point.</p>
    </div>
    ${steps()}

    <div class="prose reveal" style="margin-top:48px">
      <h2>What happens after the five steps</h2>
      <p>Once you are in, holUpp is not a checklist. You open it, you see what is happening on <a href="/flow">Flow</a>, you react to a post, you post a <a href="/moments">Moment</a> of your own day, and you reply to whoever replied to you. The parts you do not use — Circles, Around, Big Crushes — stay out of the way until you want them.</p>

      <h2>A note on Crushes</h2>
      <p>A Crush is interest expressed between two people. When it is mutual, a <a href="/whispers">Whisper</a> can open and the conversation is private from the first message. When it is not, nothing happens and nobody is told — no notification, no "seen", no score. That silence is a feature.</p>

      <h2>Getting in</h2>
      <p>You can start in a browser with <a href="/app" rel="nofollow">Continue on Web</a>, or install the <a href="/download">Android app</a>. Both are the same account and the same people.</p>
    </div>

    <div class="related reveal">
      <a class="chip" href="/flow">Flow →</a>
      <a class="chip" href="/crushes">Crushes →</a>
      <a class="chip" href="/circles">Circles →</a>
      <a class="chip" href="/whispers">Whispers →</a>
      <a class="chip" href="/download">Download →</a>
    </div>
  </div>
</section>`;
}

function featurePage({ page }) {
  const f = page.feature;
  const detail = FEATURE_DETAIL[page.path];
  return `
<section class="band">
  <div class="wrap">
    <div class="feature-row" style="border-top:0;padding-top:0">
      <div class="feature-copy">
        <p class="eyebrow">${f.name}</p>
        <h2>${detail.headline}</h2>
        <p class="lede" style="margin-top:16px">${f.blurb}</p>
        <ul class="feature-list">
          ${detail.points.map((point) => `<li>${point}</li>`).join('')}
        </ul>
        <div class="hero-cta" style="margin-top:26px">
          <a class="btn btn-primary" href="/app" rel="nofollow">Open holUpp</a>
          <a class="btn btn-ghost" href="/download">Get the app</a>
        </div>
      </div>
      <div class="feature-visual">
        ${detail.visual}
      </div>
    </div>

    <div class="prose reveal" style="margin-top:44px">
      ${detail.body}
    </div>

    <div class="related reveal">
      ${FEATURES.filter((other) => other.slug.split('#')[0] !== page.path)
        .slice(0, 6)
        .map((other) => `<a class="chip" href="${other.slug}">${other.name} →</a>`)
        .join('')}
    </div>
  </div>
</section>`;
}

const FEATURE_DETAIL = {
  '/flow': {
    headline: 'One place for everything that is happening.',
    points: [
      'Posts, clips and Moments in the order they were shared.',
      'Public Flow for the whole community, and a feed of your own connections.',
      'No invented "you might like" posts — you see what people actually posted.',
    ],
    visual: shot('feed-post.png', 'A post on the holUpp Flow feed with its Comps and Comp answers', 'shot-narrow'),
    body: `
      <h2>What Flow is</h2>
      <p>Flow is the front page of holUpp: a feed of what people have shared, newest first, with the reactions they have collected. It is deliberately plain. There is no ranking you cannot see, and no invisible boost given to posts with a particular shape.</p>
      <h2>Two Flows, one switch</h2>
      <p>The public Flow shows everything shared with everyone. Your connections Flow shows the people you have actually connected with. Both are one tap apart, and the app remembers which one you were on.</p>
      <h2>What you can do from it</h2>
      <p>React with a <a href="/crushes">Crush</a>, comment, share a post to a <a href="/circles">Circle</a>, save it, or open the poster's <a href="/space">Space</a>. If a post is a clip, it plays inline and can be saved to your device with the creator's mark on it.</p>`,
  },
  '/crushes': {
    headline: 'Say something, and mean it.',
    points: [
      'A Crush is a reaction between two people, not a counter to farm.',
      'Mutual Crushes open a private Whisper.',
      'Big Crushes shows what the whole community is reacting to right now.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row"><div class="ui-avatar"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line short"></div></div><span class="ui-pill">Crush</span></div>
      <div class="ui-media"></div>
      <div class="ui-row"><div class="ui-avatar alt"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Add Up</span></div>
      <div class="ui-row"><div class="ui-avatar alt2"></div><div class="ui-lines"><div class="ui-line short"></div></div><span class="ui-pill">Reply</span></div>
    </div>`,
    body: `
      <h2>How Crushes work</h2>
      <p>You react to a post you like, or to a person whose Space you visited. That is a Crush. If the interest is returned, a private conversation can open — a <a href="/whispers">Whisper</a>. If it is not, nothing is announced: no notification, no score, no "someone liked you" tease.</p>
      <h2 id="big">Big Crushes</h2>
      <p>Big Crushes is the community's own answer to what is worth seeing: the interactions and content collecting the most attention across holUpp right now. It is the one ranked surface in the product, and it is ranked by people, not by a model.</p>
      <h2>Crushes are not just for dating</h2>
      <p>Reactions work the same on a friend's photo, a clip of somebody's day, or a post in a <a href="/circles">Circle</a>. Most Crushes on holUpp are people saying "that was good" — not a match request.</p>`,
  },
  '/moments': {
    headline: 'Share the day. Let it go.',
    points: [
      'Photos and clips that disappear after 24 hours.',
      'A round ring around a Space shows a Moment is live.',
      'Cards appear in Discovery; nothing lingers past its day.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row"><div class="ui-avatar" style="box-shadow:0 0 0 3px #fff8f8, 0 0 0 5px #ff8788"></div><div class="ui-lines"><div class="ui-line short"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Live · 22h</span></div>
      <div class="ui-media"></div>
      <div class="ui-row"><div class="ui-avatar alt" style="box-shadow:0 0 0 3px #fff8f8, 0 0 0 5px #ed59af"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Live · 4h</span></div>
    </div>`,
    body: `
      <h2>Why 24 hours</h2>
      <p>A Moment is for the thing happening now — the walk, the meal, the view, the work in progress. Because it expires, it does not have to be your best photo. That is the whole design goal.</p>
      <h2>Photos and clips</h2>
      <p>Moments take photos and short clips. They are shown as a ring around your avatar so people know something is live, and as a card in Discovery so they can be found without following anyone.</p>
      <h2>What happens at the end</h2>
      <p>The Moment stops being visible and stops being served. If you have saved your own copy, it is yours — the app never re-encodes the original to make the copy.</p>`,
  },
  '/connections': {
    headline: 'The people you keep coming back to.',
    points: [
      'Add Ups and mutual Crushes become connections.',
      'Your connections get their own Flow.',
      'Connections can be removed, and the removal is immediate.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row"><div class="ui-avatar"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line short"></div></div><span class="ui-pill">Connected</span></div>
      <div class="ui-row"><div class="ui-avatar alt"></div><div class="ui-lines"><div class="ui-line short"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Connected</span></div>
      <div class="ui-row"><div class="ui-avatar alt2"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Add Up</span></div>
      <div class="ui-row"><div class="ui-avatar"></div><div class="ui-lines"><div class="ui-line short"></div></div><span class="ui-pill">Add Up</span></div>
    </div>`,
    body: `
      <h2>How a connection happens</h2>
      <p>Two ways: you both send an Add Up, or a Crush is returned. Either way it is mutual, and nobody is connected to somebody who did not agree.</p>
      <h2>What changes when you connect</h2>
      <p>Their posts appear in your connections Flow, they can Whisper you, and you appear in each other's Space. Public posts stay visible to everyone — connecting does not make anything private that was not already.</p>
      <h2>Removing a connection</h2>
      <p>Remove someone and it takes effect immediately: they drop out of your Flow, your Space and your Whisper list, and the conversation closes. There is no "are you sure" loop that quietly keeps the row.</p>`,
  },
  '/circles': {
    headline: 'Smaller rooms, better conversations.',
    points: [
      'Communities built around an interest, a city or a running conversation.',
      'Public circles anyone can join, and private ones that need a request.',
      'Posts, themes and members live together in one place.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row"><div class="ui-avatar"></div><div class="ui-lines"><div class="ui-line short"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Joined</span></div>
      <div class="ui-row"><div class="ui-avatar alt"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Request</span></div>
      <div class="ui-row"><div class="ui-avatar alt2"></div><div class="ui-lines"><div class="ui-line short"></div></div><span class="ui-pill">Joined</span></div>
      <div class="ui-row"><div class="ui-avatar"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line short"></div></div><span class="ui-pill">Joined</span></div>
    </div>`,
    body: `
      <h2>Why Circles exist</h2>
      <p>A feed shows you everything. A Circle shows you one thing properly. Photography, a university, a football team, a neighbourhood, a genre — the point is that the conversation has a subject and the people in it chose to be there.</p>
      <h2>Public and private</h2>
      <p>A public Circle can be joined by anyone and appears in discovery. A private Circle asks for a request, and the members decide. Posts inside a private Circle stay inside it.</p>
      <h2>Running one</h2>
      <p>Every Circle has a banner, a theme, posts and members. Sharing a post to a Circle is one tap from the share sheet of any post you can see.</p>`,
  },
  '/whispers': {
    headline: 'Private by default, quiet by design.',
    points: [
      'Text, voice notes and photos between two people.',
      'Opens when the interest is mutual — no cold messaging.',
      'No video in private chat, of any kind. That is deliberate.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row" style="max-width:78%"><div class="ui-lines"><div class="ui-line"></div><div class="ui-line short"></div></div></div>
      <div class="ui-row" style="max-width:64%;margin-left:auto;background:rgba(255,135,136,.14);border-color:rgba(255,135,136,.3)"><div class="ui-lines"><div class="ui-line short"></div></div></div>
      <div class="ui-row" style="max-width:52%"><div class="ui-lines"><div class="ui-line tiny"></div></div><span class="ui-pill">Voice</span></div>
      <div class="ui-row" style="max-width:70%;margin-left:auto;background:rgba(255,135,136,.14);border-color:rgba(255,135,136,.3)"><div class="ui-lines"><div class="ui-line"></div></div></div>
    </div>`,
    body: `
      <h2>What a Whisper is</h2>
      <p>A private conversation between two people who have both shown interest. It carries text, voice notes and photos. Deleting a message deletes it for both sides, and the deleted row is gone from the server, not hidden.</p>
      <h2>Why no video</h2>
      <p>Private video is a different level of exposure from a private message. holUpp does not offer it in Whispers at all — there is no bubble, no camera control and no play button. If you want to share a clip, you post it, and you choose the audience.</p>
      <h2>Photo limits</h2>
      <p>Two photos per 24 hours in a conversation. It is a limit on volume, not on trust, and deleting a photo does not give the slot back.</p>`,
  },
  '/space': {
    headline: 'Your profile is a place, not a card.',
    points: [
      'Your handle, your photo, your words, your posts.',
      'Moments and Circles surface on your Space.',
      'You choose what is public and what is for connections.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row"><div class="ui-avatar" style="width:52px;height:52px"></div><div class="ui-lines"><div class="ui-line short"></div><div class="ui-line tiny"></div></div><span class="ui-pill">Follow</span></div>
      <div class="ui-media" style="height:96px"></div>
      <div class="ui-row"><div class="ui-lines"><div class="ui-line"></div><div class="ui-line short"></div></div></div>
    </div>`,
    body: `
      <h2>What lives on a Space</h2>
      <p>Your profile photo, your handle and your own words; the posts you have shared; the Circles you are part of; a live Moment if you have one; and the badge your account has earned. It is the page people land on when they tap your name anywhere in holUpp.</p>
      <h2>One handle, everywhere</h2>
      <p>Handles are unique and quiet — they identify you without turning your Space into a scoreboard. Changing one is possible; it does not break the spaces you are already in.</p>
      <h2>You control the audience</h2>
      <p>Each post is public or for your connections, chosen before you post it, and shown on the post afterwards. Your Space reflects exactly that.</p>`,
  },
  '/around': {
    headline: 'What is happening near you.',
    points: [
      'People and activity around your area, not your exact location.',
      'Opt in — Around is off until you allow it.',
      'Cities and neighbourhoods, never a pin on a map.',
    ],
    visual: `<div class="ui-mock" aria-hidden="true">
      <div class="ui-row"><div class="ui-avatar alt2"></div><div class="ui-lines"><div class="ui-line short"></div><div class="ui-line tiny"></div></div><span class="ui-pill">2 km</span></div>
      <div class="ui-row"><div class="ui-avatar"></div><div class="ui-lines"><div class="ui-line"></div><div class="ui-line tiny"></div></div><span class="ui-pill">5 km</span></div>
      <div class="ui-row"><div class="ui-avatar alt"></div><div class="ui-lines"><div class="ui-line short"></div></div><span class="ui-pill">Nearby</span></div>
    </div>`,
    body: `
      <h2>Local without being tracked</h2>
      <p>Around shows people and activity in your area so a community can be a neighbourhood and not just a hashtag. It works from an approximate location and it is off until you turn it on.</p>
      <h2>What it shows</h2>
      <p>People near you who are visible to you already, Circles based in your city, and posts tagged with a place. Nothing here reveals a street address, and nothing is shown to people who could not already see your posts.</p>
      <h2>Turning it off</h2>
      <p>One switch, in Settings. Turning it off removes you from other people's Around immediately.</p>`,
  },
};

function downloadPage() {
  return `
<section class="band">
  <div class="wrap">
    <div class="dl-grid">
      <div>
        <p class="eyebrow">Android</p>
        <h1>Get holUpp for Android</h1>
        <p class="lede">The official holUpp app. One verified APK, straight from our release channel — no store account needed, no ZIP to unpack.</p>

        <div class="dl-panel" style="margin-top:28px">
          <a class="btn btn-primary btn-wide" id="apk-download" href="#"
             data-version-url="${WORKER}/version" data-download-url="${WORKER}/download"
             aria-disabled="true" rel="nofollow">Checking Android download…</a>
          <p class="dl-status" id="apk-status" role="status" aria-live="polite">Checking the current Android build…</p>
          <dl class="spec" style="margin-top:20px">
            <dt>Version</dt><dd data-release="version">${RELEASE.version}</dd>
            <dt>File size</dt><dd data-release="bytes">${RELEASE.size}</dd>
            <dt>Minimum Android</dt><dd>8.0 (Oreo)</dd>
            <dt>Released</dt><dd data-release="date">13 November 2026</dd>
            <dt>Price</dt><dd>Free</dd>
            <dt>File</dt><dd>holUpp-&lt;version&gt;-RielOS.apk</dd>
          </dl>
          <p class="caption">Version and size are read live from the release channel every time this page loads, so they cannot go stale between deploys.</p>
        </div>

        <div class="prose" style="margin-top:36px">
          <h2>What you get</h2>
          <p>Everything on holUpp: Flow, Crushes, Moments, Circles, Whispers, your Space and Around. The Android app is the full product — the browser version is the same account with fewer camera and gallery features.</p>
          <h2>Install in three steps</h2>
          <ol>
            <li>Tap <strong>Download APK</strong> above and wait for the file to finish.</li>
            <li>Open it from your notifications, or from <strong>Files → Downloads</strong>.</li>
            <li>If Android asks, allow <strong>Install unknown apps</strong> for your browser or file manager. You can revoke that permission straight after installing.</li>
          </ol>
          <h2>Before you install</h2>
          <ul>
            <li><strong>Android 8.0 or newer.</strong> Older versions cannot run the video pipeline.</li>
            <li><strong>About 250 MB free.</strong> The APK is under 100 MB; the app needs room for its cache.</li>
            <li><strong>You are 16 or over.</strong> holUpp is not for under-16s, and the app checks.</li>
            <li><strong>It is unsigned by Google Play.</strong> That is expected for a direct download — your phone will say so once.</li>
          </ul>
          <h2>Updating</h2>
          <p>The app tells you when a new version exists and links straight to it. Installing an update keeps your account and your drafts; there is nothing to export first.</p>
        </div>
      </div>

      <div>
        <div class="dl-panel">
          <h2 style="font-size:20px;margin:0 0 14px">Inside the app</h2>
          <div class="shots-strip">
            ${[
              ['feed.png', 'The holUpp home feed on Android, with the Moments rail, a post and a clip'],
              ['feed-clip.png', 'A clip playing in the holUpp feed'],
            ]
              .map(
                ([src, alt]) =>
                  `<div class="phone"><img src="/site/screens/${src}" alt="${alt}" loading="lazy" width="320" height="640"></div>`,
              )
              .join('')}
          </div>
          <p class="caption">Real screens from holUpp on Android.</p>
        </div>

        <div class="card" style="margin-top:18px">
          ${icon('shield')}
          <h3>Verified before it is published</h3>
          <p>Every build is signed, hashed and checked for server credentials before it reaches this channel. The file you download is the file that passed those checks — never a repackaged copy.</p>
        </div>

        <div class="card" style="margin-top:18px">
          ${icon('globe')}
          <h3>No app? Use the web</h3>
          <p>You can sign in with the same account in your browser at <a href="/app" rel="nofollow">holupp.net/app</a>.</p>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function privacyPage() {
  return `
<section class="band">
  <div class="wrap">
    <div class="prose reveal">
      <p class="lede">Plain language, no clauses designed to be skipped. Last updated 13 November 2026.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>What you give us:</strong> your email, your handle, your profile details, and the posts, photos, clips and messages you choose to share.</li>
        <li><strong>What the app needs to work:</strong> the device type and Android version, so a bug can be reproduced, and the timestamps of what you post.</li>
        <li><strong>What we do not collect:</strong> your contacts, your precise location unless you turn on <a href="/around">Around</a>, and nothing from other apps on your phone.</li>
      </ul>

      <h2>Why we keep it</h2>
      <p>To run your account, to show your posts to the people you chose, to send the emails you asked for (confirmation, password reset, support replies), and to keep the community safe. Nothing is sold and nothing is used to build an advertising profile.</p>

      <h2>Who can see what</h2>
      <ul>
        <li><strong>Public posts</strong> are visible to anyone signed in to holUpp.</li>
        <li><strong>Connection posts</strong> are visible only to people you are connected to.</li>
        <li><strong>Whispers</strong> are visible to the two people in the conversation.</li>
        <li><strong>Moments</strong> disappear after 24 hours and stop being served.</li>
      </ul>

      <h2>Search engines</h2>
      <p>Only the public marketing pages on holupp.net are indexed. Your profile, your posts, your conversations and every signed-in screen are excluded — they carry a noindex directive and are never served to a crawler. See the note on our <a href="/about">About</a> page.</p>

      <h2>Deleting your data</h2>
      <p>Deleting a post deletes the row and the file. Deleting your account deletes your profile, your posts, your media and your messages. Deletion is immediate and is not a soft delete — the space it took is reclaimed.</p>

      <h2>Where it is stored</h2>
      <p>Account and message records live in a Postgres database; photos, clips and Moment media live in private object storage. Both are encrypted in transit, and media is served through an authenticated endpoint rather than a public URL.</p>

      <h2>Contact</h2>
      <p>Questions about this policy, or a request to see or delete your data: <a href="mailto:support@holupp.net">support@holupp.net</a>. See <a href="/contact">Contact</a>.</p>
    </div>
  </div>
</section>`;
}

function termsPage() {
  return `
<section class="band">
  <div class="wrap">
    <div class="prose reveal">
      <p class="lede">The rules, in the order you will need them. Last updated 13 November 2026.</p>

      <h2>Who may use holUpp</h2>
      <p>You must be 16 or older. One account per person. You are responsible for what is posted from your account and for keeping your password to yourself.</p>

      <h2>What is not allowed</h2>
      <ul>
        <li>Harassment, threats, hate speech, or targeting somebody because of who they are.</li>
        <li>Content that sexualises minors, in any form. This is reported and removed immediately.</li>
        <li>Impersonating another person, or creating an account to evade a ban.</li>
        <li>Sharing somebody else's private information, images or conversations.</li>
        <li>Automated scraping, bulk account creation, or using holUpp to send spam or floods of email.</li>
        <li>Uploading content you do not have the rights to.</li>
      </ul>

      <h2>What you own</h2>
      <p>You keep ownership of everything you post. You give holUpp the permission it needs to store, display and deliver that content to the people you chose — nothing more, and that permission ends when you delete the content.</p>

      <h2>Moderation</h2>
      <p>Content that breaks these rules is removed and the account may be suspended or closed. You can report any post, message or profile from inside the app, and you will be told when action is taken.</p>

      <h2>Availability</h2>
      <p>holUpp is provided as it is. We work to keep it up, and we will not remove a feature you rely on without telling you first. Scheduled maintenance is announced in the app.</p>

      <h2>Changes</h2>
      <p>If these terms change in a way that matters, you will be told in the app before the change takes effect. Continuing to use holUpp after that means you accept the new terms.</p>

      <h2>Contact</h2>
      <p>Anything unclear, or a dispute to raise: <a href="mailto:support@holupp.net">support@holupp.net</a>.</p>
    </div>
  </div>
</section>`;
}

function contactPage() {
  return `
<section class="band">
  <div class="wrap">
    <div class="dl-grid">
      <div class="reveal">
        <h2 style="font-size:clamp(24px,3vw,32px)">One address, answered by a person.</h2>
        <p class="lede" style="margin-top:14px">Support, account help, privacy requests and press all go to the same place. We aim to reply within two working days.</p>
        <div class="dl-panel" style="margin-top:24px">
          <h3 style="margin:0 0 8px">Email</h3>
          <p style="margin:0"><a href="mailto:support@holupp.net" style="font-size:18px;font-weight:700">support@holupp.net</a></p>
          <p class="caption">Replies come from this address — if you are writing about an account, send from the address on it.</p>
        </div>
      </div>
      <div>
        <div class="card" id="support">
          ${icon('whisper')}
          <h3>Account and app support</h3>
          <p>Cannot sign in, did not get a confirmation code, a post will not upload, or the app crashes. Include your handle and what you were doing when it happened.</p>
        </div>
        <div class="card" style="margin-top:16px">
          ${icon('shield')}
          <h3>Safety, privacy and data requests</h3>
          <p>Reporting content that breaks the <a href="/terms">Terms</a>, or asking what we hold about you and asking for it to be deleted.</p>
        </div>
        <div class="card" style="margin-top:16px">
          ${icon('globe')}
          <h3>Press and partnerships</h3>
          <p>Anything about holUpp as a product, a launch, or working together.</p>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

/* ------------------------------------------------------------------ build --- */

const ROBOTS = `# holUpp — https://holupp.net
#
# Everything here is meant to be read: the marketing pages and the Android
# download page. Signed-in surfaces are never listed as disallowed because a
# blocked page cannot show a crawler its own noindex — and every private route
# carries one. See /privacy for what is and is not indexed.

User-agent: *
Allow: /
Disallow: /app
Disallow: /v/
Disallow: /s/

Sitemap: ${SITE}/sitemap.xml
`;

async function main() {
  try {
    // The update feed is briefly cacheable for phones, but a marketing build
    // must capture the current release in its static HTML. Cache-bust this
    // server-side read so a deploy that follows a release immediately cannot
    // stamp the previous version into the indexable download page.
    const res = await fetch(`${WORKER}/version?site-build=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const info = await res.json();
      if (info.version) RELEASE.version = String(info.version);
      if (info.bytes) RELEASE.size = `${(Number(info.bytes) / 1048576).toFixed(1)} MB`;
    } else {
      console.warn(`site: release channel answered ${res.status} — using last known ${RELEASE.version}`);
    }
  } catch {
    console.warn(`site: release channel unreachable — using last known ${RELEASE.version}`);
  }

  if (!existsSync(DIST)) throw new Error('dist/ is missing — run the Expo export first (npm run build:web does both).');

  // The app shell has to survive: /v/ and /s/ links load the Expo bundle, and
  // /app is where "Continue on Web" goes. index.html is about to become the
  // marketing home page, so it is copied aside first.
  const shell = await readFile(path.join(DIST, 'index.html'), 'utf8');
  await writeFile(path.join(DIST, 'app.html'), shell);

  await mkdir(path.join(DIST, 'site'), { recursive: true });
  await cp(path.join(HERE, 'theme.css'), path.join(DIST, 'site', 'theme.css'));
  await cp(path.join(HERE, 'site.js'), path.join(DIST, 'site', 'site.js'));
  await cp(path.join(HERE, 'assets'), path.join(DIST, 'site'), { recursive: true });

  const built = [];
  for (const page of PAGES) {
    const html = layout(page);
    const out = page.path === '/' ? path.join(DIST, 'index.html') : path.join(DIST, page.path.slice(1), 'index.html');
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, html);
    built.push({ path: page.path, html });
  }

  const urls = built
    .map(({ path: p }) => `  <url><loc>${SITE}${p === '/' ? '/' : p}</loc><changefreq>${p === '/' || p === '/download' ? 'weekly' : 'monthly'}</changefreq><priority>${(PAGES.find((x) => x.path === p) || {}).priority || '0.6'}</priority></url>`)
    .join('\n');
  await writeFile(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  await writeFile(path.join(DIST, 'robots.txt'), ROBOTS);


  await writeFile(
    path.join(DIST, 'site.webmanifest'),
    JSON.stringify(
      {
        name: 'holUpp',
        short_name: 'holUpp',
        description: 'Discover people, share moments and build connections.',
        start_url: '/app',
        display: 'standalone',
        background_color: '#0B070C',
        theme_color: '#0B070C',
        icons: [
          { src: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: '/site/holup-mark.png', sizes: '401x286', type: 'image/png' },
        ],
      },
      null,
      2,
    ),
  );

  // Every page must be readable with JavaScript off and must carry its own
  // unique title and description. Failing here is cheaper than shipping a page
  // that duplicates another one's metadata.
  const titles = new Set();
  const descriptions = new Set();
  for (const { path: p, html } of built) {
    const title = /<title>(.*?)<\/title>/s.exec(html)?.[1];
    const description = /<meta name="description" content="(.*?)">/s.exec(html)?.[1];
    if (!title || !description) throw new Error(`${p}: missing title or description`);
    if (titles.has(title)) throw new Error(`${p}: duplicate title — ${title}`);
    if (descriptions.has(description)) throw new Error(`${p}: duplicate description`);
    titles.add(title);
    descriptions.add(description);
    if (!/<h1[\s>]/.test(html)) throw new Error(`${p}: no h1`);
    if (!/rel="canonical"/.test(html)) throw new Error(`${p}: no canonical`);
    if (!/application\/ld\+json/.test(html)) throw new Error(`${p}: no structured data`);
  }

  console.log(`site: ${built.length} pages, sitemap, robots, manifest — all metadata unique`);
}

main().catch((error) => {
  console.error('site build failed:', error.message);
  process.exit(1);
});
