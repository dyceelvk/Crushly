const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');
module.exports = config => {
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
