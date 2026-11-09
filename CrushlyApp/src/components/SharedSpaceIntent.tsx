import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../state/auth';
import { storage } from '../lib/storage';
import { sharedSpaceId } from '../lib/spaceShare';
import type { RootStackParamList } from '../navigation/types';

const KEY = 'holup-pending-shared-space';
/** Preserve the destination across sign-in; UserProfile still checks access. */
export function SharedSpaceIntent() {
  const { status } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const take = (url: string | null) => {
      const id = sharedSpaceId(url);
      if (id && live) { setPending(id); void storage.set(KEY, String(id)); }
    };
    void (async () => {
      const saved = await storage.get(KEY);
      if (saved && /^[1-9][0-9]{0,14}$/.test(saved) && Number.isSafeInteger(Number(saved)) && live) setPending(Number(saved));
      if (Platform.OS === 'web') take(typeof window === 'undefined' ? null : window.location.href);
      else take(await Linking.getInitialURL());
    })();
    const sub = Linking.addEventListener('url', ({ url }) => take(url));
    return () => { live = false; sub.remove(); };
  }, []);
  useEffect(() => {
    if (status !== 'ready' || !pending) return;
    const timer = setTimeout(() => {
      navigation.navigate('UserProfile', { id: pending });
      setPending(null);
      void storage.remove(KEY);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const u = new URL(window.location.href); u.searchParams.delete('space');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [status, pending, navigation]);
  return null;
}
