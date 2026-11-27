import { useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../state/auth';
import { storage } from '../lib/storage';
import { sharedSpaceId, sharedSpaceToken } from '../lib/spaceShare';
import { sharedProfile } from '../lib/profileShare';
import * as service from '../api/service';
import type { RootStackParamList } from '../navigation/types';

type PendingSpace = { kind: 'id'; value: number } | { kind: 'handle'; value: string } | { kind: 'token'; value: string };
const KEY = 'holup-pending-shared-space';

function encodePending(value: PendingSpace): string {
  return `${value.kind}:${value.value}`;
}

function decodePending(raw: string | null): PendingSpace | null {
  if (!raw) return null;
  const oldId = raw.match(/^[1-9][0-9]{0,14}$/);
  if (oldId && Number.isSafeInteger(Number(raw))) return { kind: 'id', value: Number(raw) };
  const id = raw.match(/^id:([1-9][0-9]{0,14})$/);
  if (id && Number.isSafeInteger(Number(id[1]))) return { kind: 'id', value: Number(id[1]) };
  const handle = raw.match(/^handle:([a-z0-9_.]{2,30})$/);
  if (handle) return { kind: 'handle', value: handle[1] };
  const token = raw.match(/^token:([0-9a-f]{32})$/);
  return token ? { kind: 'token', value: token[1] } : null;
}

/** Preserve the destination across sign-in/onboarding; UserProfile still checks access. */
export function SharedSpaceIntent() {
  const { status } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [pending, setPending] = useState<PendingSpace | null>(null);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const take = (url: string | null) => {
      const id = sharedSpaceId(url);
      const handle = id ? null : sharedProfile(url);
      const token = id || handle ? null : sharedSpaceToken(url);
      const next: PendingSpace | null = id
        ? { kind: 'id', value: id }
        : handle
          ? { kind: 'handle', value: handle }
          : token
            ? { kind: 'token', value: token }
            : null;
      if (!next || !live) return;
      attempted.current = null;
      setPending(next);
      void storage.set(KEY, encodePending(next));
    };
    void (async () => {
      const saved = decodePending(await storage.get(KEY));
      if (saved && live) setPending(saved);
      if (Platform.OS === 'web') take(typeof window === 'undefined' ? null : window.location.href);
      else take(await Linking.getInitialURL());
    })();
    const sub = Linking.addEventListener('url', ({ url }) => take(url));
    return () => { live = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !pending) return;
    const marker = encodePending(pending);
    if (attempted.current === marker) return;
    attempted.current = marker;
    const timer = setTimeout(() => {
      void (async () => {
        let id: number | null = pending.kind === 'id' ? pending.value : null;
        try {
          if (pending.kind === 'handle') id = await service.sharedProfileIdByHandle(pending.value);
          if (pending.kind === 'token') id = await service.spaceIdFromShareToken(pending.value);
          if (!id) {
            attempted.current = null;
            setPending(null);
            await storage.remove(KEY);
            return;
          }
          navigation.navigate('UserProfile', { id });
          setPending(null);
          await storage.remove(KEY);
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const u = new URL(window.location.href);
            u.searchParams.delete('space');
            u.searchParams.delete('ref');
            window.history.replaceState(null, '', u.pathname + u.search + u.hash);
          }
        } catch {
          // Keep the destination for a later foreground/retry rather than
          // converting a temporary network failure into a lost shared link.
          // The storage entry remains, and a new URL event or a fresh app
          // mount can try the same trusted destination again.
          attempted.current = null;
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [status, pending, navigation]);
  return null;
}
