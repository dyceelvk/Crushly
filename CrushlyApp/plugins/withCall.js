const { withAndroidManifest, withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');
module.exports = config => {
  // Android 9 (API 28) is the supported minimum. Set the shared Expo/RN
  // Gradle property, rather than overriding dependency manifests.
  config = withGradleProperties(config, config => {
    config.modResults = config.modResults.filter(p => p.key !== 'android.minSdkVersion');
    config.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '28' });
    return config;
  });
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] ||= [];
    for (const name of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
      if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    return config;
  });
  return withAppBuildGradle(config, config => {
    // WebRTC JNI invokes Java classes by name. Preserve them in release builds.
    config.modResults.contents += `\nandroid.buildTypes.release.proguardFiles(file("crushly-webrtc.pro"))\nfile("crushly-webrtc.pro").text = "-keep class org.webrtc.** { *; }\\n-keep class com.oney.WebRTCModule.** { *; }\\n"\n`;
    return config;
  });
};
