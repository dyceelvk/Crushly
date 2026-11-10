// The public-debug test app remains unchanged. Secure candidates opt in only in
// the private release workflow; never let missing secrets fall back to debug.
const base = require('./app.json').expo;
module.exports = () => {
  if (process.env.HOLUP_SECURE_ANDROID !== '1') return base;
  return {
    ...base,
    scheme: 'holup',
    // Secure packages must never query the legacy debug-signature channel.
    extra: { ...base.extra, androidUpdateChannel: 'secure' },
    android: {
      ...base.android,
      package: 'app.holup.mobile',
      intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'],
        // Both public landing pages open the app: a shared post (/v/) and a shared
        // Space (/s/). The Space page links on to ?space=<id> for anyone the app
        // cannot open for, so an old install still lands somewhere real.
        data: [{ scheme: 'https', host: 'holupapp.vercel.app', pathPrefix: '/v/' },
               { scheme: 'https', host: 'holupapp.vercel.app', pathPrefix: '/s/' }] }],
    },
    plugins: [...base.plugins, './plugins/withSecureAndroidSigning'],
  };
};
