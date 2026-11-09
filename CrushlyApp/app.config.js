// The public-debug test app remains unchanged. Secure candidates opt in only in
// the private release workflow; never let missing secrets fall back to debug.
const base = require('./app.json').expo;
module.exports = () => {
  if (process.env.HOLUP_SECURE_ANDROID !== '1') return base;
  return {
    ...base,
    scheme: 'holup',
    android: {
      ...base.android,
      package: 'app.holup.mobile',
      intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: 'https', host: 'holupapp.vercel.app', pathPrefix: '/v/' }] }],
    },
    plugins: [...base.plugins, './plugins/withSecureAndroidSigning'],
  };
};
