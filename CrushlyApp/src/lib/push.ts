/**
 * Registering this phone with the push server.
 *
 * The device token is what lets Google wake a phone that is not running holUpp.
 * Getting one needs Firebase configured in the native build (`google-services.json`),
 * so everything here is written to fail quietly and completely when that file is
 * absent: an app that loses a feature must not lose a screen.
 *
 * The token is registered against the signed-in profile by the server — the client
 * never sends a profile id, so it cannot register somebody else's phone.
 */
import { Platform } from 'react-native';
import { supabase } from '../api/client';
import { soundChoice } from './sound';

type ExpoNotifications = typeof import('expo-notifications');

let token: string | null = null;
let registering = false;
let configured: boolean | null = null;

async function notifications(): Promise<ExpoNotifications | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

/**
 * Registers the phone and its chosen chime. Safe to call on every start and after
 * every sound change: the server upserts on the token.
 */
export async function registerPushToken(): Promise<boolean> {
  if (registering) return !!token;
  registering = true;
  try {
    const n = await notifications();
    if (!n) return false;
    if (!token) {
      // The FCM registration token, not Expo's own token: this app talks to Google
      // directly, so there is no Expo push service in the middle to trust.
      const device = await n.getDevicePushTokenAsync();
      const value = typeof device?.data === 'string' ? device.data : '';
      if (!value) return false;
      token = value;
    }
    const { error } = await supabase.rpc('register_device_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_sound: soundChoice(),
    });
    if (error) return false;
    configured = true;
    return true;
  } catch {
    // No Firebase in this build, or no Play services on this phone. Push stays off;
    // the in-app chime and the notification bar still work.
    configured = false;
    return false;
  } finally {
    registering = false;
  }
}

/** Keeps the server's copy of the sound in step with the member's choice. */
export async function syncPushSound(): Promise<void> {
  if (!token) return;
  try {
    await supabase.rpc('set_device_sound', { p_token: token, p_sound: soundChoice() });
  } catch {
    /* the next registration will fix it */
  }
}

/**
 * Called on sign-out. A phone that keeps its token after somebody signs out would
 * go on receiving that account's Whispers on a stranger's lock screen.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!token) return;
  const value = token;
  token = null;
  try {
    await supabase.rpc('unregister_device_token', { p_token: value });
  } catch {
    /* the row is dead anyway once the token rotates */
  }
}

export function pushConfigured(): boolean | null {
  return configured;
}
