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
        // Both public landing pages open the app: a shared post (/v/) and a shared
        // Space (/s/). The Space page links on to ?space=<id> for anyone the app
        // cannot open for, so an old install still lands somewhere real.
        data: [
          // The domain we actually publish, both apex and www, for the two
          // public landing pages: a shared post (/v/) and a shared Space (/s/).
          { scheme: 'https', host: 'holupp.net', pathPrefix: '/v/' },
          { scheme: 'https', host: 'holupp.net', pathPrefix: '/s/' },
          { scheme: 'https', host: 'www.holupp.net', pathPrefix: '/v/' },
          { scheme: 'https', host: 'www.holupp.net', pathPrefix: '/s/' },
          // The retired hostname is deliberately gone: it belongs to no project,
          // so an install claiming it would only ever open a page that 404s.
        ] }],
    },
    plugins: [...base.plugins, './plugins/withSecureAndroidSigning'],
  };
};
