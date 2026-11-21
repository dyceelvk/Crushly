import { useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useAuth } from '../state/auth';
import { storage } from '../lib/storage';
import { sharedReferralCode } from '../lib/referral';
import * as service from '../api/service';

const KEY = 'holup-pending-referral';

/**
 * Holds an invitation across the confirmation/onboarding journey. The code is
 * only a client-side pointer; attribution and qualification happen in guarded
 * database functions after auth confirms the account.
 */
export function SharedReferralIntent() {
  const { status } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const take = (url: string | null) => {
      const code = sharedReferralCode(url);
      if (!code || !live) return;
      attempted.current = null;
      setPending(code);
      void storage.set(KEY, code);
    };
    void (async () => {
      const saved = await storage.get(KEY);
      if (saved && sharedReferralCode(`https://holupp.net/i/${saved}`) && live) setPending(saved.toLowerCase());
      if (Platform.OS === 'web') take(typeof window === 'undefined' ? null : window.location.href);
      else take(await Linking.getInitialURL());
    })();
    const sub = Linking.addEventListener('url', ({ url }) => take(url));
    return () => { live = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if ((status !== 'onboarding' && status !== 'ready') || !pending) return;
    if (attempted.current === pending) return;
    attempted.current = pending;
    void (async () => {
      try {
        const result = await service.claimReferral(pending);
        // A not-yet-confirmed session is the one response worth retaining. All
        // other false answers are terminal: self-referral, a duplicate account,
        // an invalid/revoked code, or an already-onboarded member.
        if (result.retryable) {
          attempted.current = null;
          return;
        }
        setPending(null);
        await storage.remove(KEY);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const u = new URL(window.location.href);
          u.searchParams.delete('ref');
          window.history.replaceState(null, '', u.pathname + u.search + u.hash);
        }
      } catch {
        // Keep the code for a later URL event or fresh app mount. A network
        // failure must not turn a valid invitation into an un-attributed signup.
        attempted.current = null;
      }
    })();
  }, [status, pending]);

  return null;
}
