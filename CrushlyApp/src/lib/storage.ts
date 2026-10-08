import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Small key/value store. Uses the OS keychain/keystore on device (session
 * tokens never sit in plain storage) and localStorage on the web.
 */
const web = Platform.OS === 'web';

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (web) return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (web) localStorage.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // Storage can fail in private browsing; the app still works for the session.
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (web) localStorage.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  },
};
