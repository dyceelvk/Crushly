const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Exclude only device-local drafts and Expo SecureStore from Android backup,
// without turning backups off for unrelated app data.
module.exports = function withLocalDraftsBackup(config) {
  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:fullBackupContent'] = '@xml/hollop_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/hollop_data_extraction_rules';
    return c;
  });
  return withDangerousMod(config, ['android', async (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(dir, { recursive: true });
    const exclude = '<include domain="sharedpref" path="."/><exclude domain="file" path="hollop-drafts/"/><exclude domain="sharedpref" path="SecureStore"/>';
    fs.writeFileSync(path.join(dir, 'hollop_backup_rules.xml'), `<?xml version="1.0" encoding="utf-8"?><full-backup-content>${exclude}</full-backup-content>`);
    fs.writeFileSync(path.join(dir, 'hollop_data_extraction_rules.xml'), `<?xml version="1.0" encoding="utf-8"?><data-extraction-rules><cloud-backup>${exclude}</cloud-backup><device-transfer>${exclude}</device-transfer></data-extraction-rules>`);
    return c;
  }]);
};
