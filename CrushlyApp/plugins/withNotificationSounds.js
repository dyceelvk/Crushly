const { withDangerousMod, withPlugins } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Puts holUpp's own chimes where Android can find them.
 *
 * A notification channel cannot point at a bundled JS asset: Android resolves
 * `sound` against `res/raw` at the moment the channel is created, and a channel
 * whose sound file is missing is created *silent* and then never changes — which
 * is exactly the bug holUpp shipped with, in a different form. So the two wavs
 * that already live in `assets/sounds` are copied into `res/raw` under the names
 * `src/lib/systemAlert.ts` asks for, before Gradle ever runs.
 *
 * Only the background channel uses them: while the app is open the in-app chime
 * is the sound, and playing both would be two sounds for one message.
 */
// Every choice the picker offers gets a raw resource, named the way
// `src/lib/systemAlert.ts` asks for it (`holup_<id>`), so switching the sound in
// settings also switches the sound of a notification that arrives while the app
// is closed.
const CHOICES = ['glass', 'pulse', 'lumen', 'bloom', 'drip', 'orbit'];
const SOUNDS = CHOICES.map((id) => ({ from: `assets/sounds/${id}.wav`, to: `holup_${id}.wav` }));

function withNotificationSounds(config) {
  return withDangerousMod(config, [
    'android',
    (c) => {
      const root = c.modRequest.projectRoot;
      const raw = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(raw, { recursive: true });
      for (const sound of SOUNDS) {
        const src = path.join(root, sound.from);
        if (!fs.existsSync(src)) {
          // A build without the file would create a silent channel forever; fail
          // loudly here instead of shipping a phone that never makes a sound.
          throw new Error(`withNotificationSounds: missing ${sound.from}`);
        }
        fs.copyFileSync(src, path.join(raw, sound.to));
      }
      return c;
    },
  ]);
}

module.exports = (config) => withPlugins(config, [withNotificationSounds]);
