/** Unknown Android builds fail closed rather than receiving a legacy APK. */
export function updateVersionPath(platform: string, channel: unknown, packageName?: unknown): string {
  if (platform !== 'android') return '/version';
  if (channel === 'secure') return '/secure/version';
  return packageName === 'app.crushly' ? '/version' : '/secure/version';
}
