import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, requireConfig, supabase } from '../api/client';
import { keys } from '../api/hooks';
import { getMe } from '../api/service';
import type { Me } from '../api/types';

export type AuthStatus = 'restoring' | 'signedOut' | 'onboarding' | 'ready';

type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the member after onboarding/account changes. */
  refresh: () => Promise<Me | null>;
  /** Local-only sign out after account deletion (session already gone server-side). */
  forget: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session state is Supabase Auth's (persisted in the OS keychain on device,
 * localStorage on the web); `me` is the member record the rest of the app uses.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [me, setMeState] = useState<Me | null>(null);

  // Keep local `me` in sync with the query cache, so any mutation that updates ['me'] re-routes correctly.
  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === 'me' && event.type === 'updated') {
        const data = event.query.state.data as Me | undefined;
        if (data) setMeState(data);
      }
    });
  }, [qc]);

  const forget = useCallback(async () => {
    setSignedIn(false);
    setMeState(null);
    qc.clear();
  }, [qc]);

  /** Adopt whatever session supabase-js now holds (startup, sign-in, or an email link landing). */
  const adoptSession = useCallback(async () => {
    setSignedIn(true);
    try {
      const current = await getMe();
      qc.setQueryData(keys.me, current);
      setMeState(current);
    } catch (e) {
      // Offline: keep the session and let screens show their own retry states.
      if (!(e instanceof ApiError && e.isNetwork)) {
        setSignedIn(false);
      }
    }
  }, [qc]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session && !cancelled) await adoptSession();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    // Sessions can arrive after startup — confirmation links landing on the
    // URL, token refreshes, or another tab signing in. Adopt them instead of
    // bouncing the member back to the sign-in/up screens.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        void forget();
        return;
      }
      if (session && ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION', 'USER_UPDATED'].includes(event)) {
        // Defer: this callback runs under supabase-js's auth lock.
        setTimeout(() => {
          if (!cancelled) void adoptSession();
        }, 0);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [qc, forget, adoptSession]);

  const afterAuth = useCallback(
    async () => {
      const current = await getMe();
      qc.setQueryData(keys.me, current);
      setMeState(current);
      setSignedIn(true);
    },
    [qc],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      requireConfig();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        const msg = String(error.message ?? '');
        if (/invalid login credentials/i.test(msg)) throw new ApiError(401, 'That email and password don’t match.');
        if (/not confirmed/i.test(msg)) throw new ApiError(403, 'Confirm your email first — open the link we sent to your inbox, then sign in.');
        if (!msg) throw new ApiError(400, 'Enter your email and password.');
        throw new ApiError(error.status ?? 400, msg);
      }
      await afterAuth();
    },
    [afterAuth],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      requireConfig();
      const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
      if (error) {
        const msg = String(error.message ?? '');
        if (/already (registered|exists)/i.test(msg)) {
          throw new ApiError(409, 'An account with this email already exists. Try signing in.');
        }
        throw new ApiError(error.status ?? 400, msg || 'We couldn’t create your account. Please try again.');
      }
      if (!data.session) {
        throw new ApiError(
          202,
          'Check your inbox — tap the confirmation link and you’ll be signed straight in.',
        );
      }
      await afterAuth();
    },
    [afterAuth],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* best effort */
    }
    await forget();
  }, [forget]);

  const refresh = useCallback(async () => {
    try {
      const current = await getMe();
      qc.setQueryData(keys.me, current);
      setMeState(current);
      return current;
    } catch {
      return null;
    }
  }, [qc]);

  const status: AuthStatus = restoring ? 'restoring' : !signedIn ? 'signedOut' : me && !me.onboarded ? 'onboarding' : 'ready';

  const value = useMemo(
    () => ({ status, me, signIn, signUp, signOut, refresh, forget }),
    [status, me, signIn, signUp, signOut, refresh, forget],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
