// The public-debug test app remains unchanged. Secure candidates opt in only in
// the private release workflow; never let missing secrets fall back to debug.
const base = require('./app.json').expo;
const fs = require('fs');
const path = require('path');

/**
 * Firebase is only wired in when its config file is actually present.
 *
 * Without `google-services.json` the app still builds and everything except true
 * push works; with it, `getDevicePushTokenAsync` can return a token and the phone
 * can be woken while holUpp is closed. Requiring the file unconditionally would
 * turn "push is not set up yet" into "the build is broken", which is the wrong
 * trade for a feature that is additive.
 */
function firebaseConfig() {
  const file = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(file)) return {};
  return { googleServicesFile: './google-services.json' };
}

module.exports = () => {
  const withFirebase = (cfg) => ({ ...cfg, android: { ...cfg.android, ...firebaseConfig() } });
  if (process.env.HOLUP_SECURE_ANDROID !== '1') return withFirebase(base);
  return {
    ...base,
    scheme: 'holup',
    // Secure packages must never query the legacy debug-signature channel.
    extra: { ...base.extra, androidUpdateChannel: 'secure' },
    android: {
      ...base.android,
      ...firebaseConfig(),
      package: 'app.holup.mobile',
      intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'],
        // All shareable HolUpp HTTPS links open the installed app: posts/videos
        // (/v/), private Spaces (/s/), public profiles (/u/) and reusable
        // invitations (/i/). Without the APK the same URLs stay on their web
        // landing pages because App Links only claim them when this package is
        // installed and verified.
        data: [
          { scheme: 'https', host: 'holupp.net', pathPrefix: '/v/' },
          { scheme: 'https', host: 'holupp.net', pathPrefix: '/s/' },
          { scheme: 'https', host: 'holupp.net', pathPrefix: '/u/' },
          { scheme: 'https', host: 'holupp.net', pathPrefix: '/i/' },
          { scheme: 'https', host: 'www.holupp.net', pathPrefix: '/v/' },
          { scheme: 'https', host: 'www.holupp.net', pathPrefix: '/s/' },
          { scheme: 'https', host: 'www.holupp.net', pathPrefix: '/u/' },
          { scheme: 'https', host: 'www.holupp.net', pathPrefix: '/i/' },
          // The retired hostname is deliberately gone: it belongs to no project,
          // so an install claiming it would only ever open a page that 404s.
        ] }],
    },
    plugins: [...base.plugins, './plugins/withSecureAndroidSigning'],
  };
};
