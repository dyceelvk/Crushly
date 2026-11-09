import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../state/auth';
import { storage } from '../lib/storage';
import { sharedPostId } from '../lib/postShare';
import type { RootStackParamList } from '../navigation/types';

const KEY = 'holup-pending-shared-post';
/** Keeps a share target through sign-in/onboarding and resolves it after auth. */
export function SharedPostIntent() {
  const { status } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const take = (url: string | null) => {
      const id = sharedPostId(url);
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
      navigation.navigate('PostViewer', { postId: pending });
      setPending(null);
      void storage.remove(KEY);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const u = new URL(window.location.href);
        if (u.searchParams.has('post')) { u.searchParams.delete('post'); window.history.replaceState(null, '', u.pathname + u.search + u.hash); }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [status, pending, navigation]);
  return null;
}
