const { withAppBuildGradle } = require('expo/config-plugins');
// Build secrets stay outside the project; fail closed if the Expo template
// changes instead of silently shipping the public debug signer.
module.exports = (config) => withAppBuildGradle(config, (result) => {
  let gradle = result.modResults.contents;
  const marker = '    signingConfigs {';
  if ((gradle.match(/    signingConfigs \{/g) || []).length !== 1) throw new Error('Android signing block changed; secure signing not configured');
  gradle = gradle.replace(marker, `${marker}
        holupRelease {
            def path = System.getenv('HOLUP_ANDROID_KEYSTORE_PATH')
            def password = System.getenv('HOLUP_ANDROID_RELEASE_KEY_PASSWORD')
            if (!path || !password) throw new GradleException('Missing holUpp release signing credentials')
            storeFile file(path)
            storePassword password
            keyAlias 'holup-release'
            keyPassword password
        }`);
  const release = /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!release.test(gradle)) throw new Error('Android release signing line changed; secure signing not configured');
  result.modResults.contents = gradle.replace(release, '$1signingConfig signingConfigs.holupRelease');
  return result;
});
