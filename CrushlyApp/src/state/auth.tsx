import { withDeadline } from '../lib/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { browserLocation } from '../lib/browser';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, requireConfig, supabase, toApiError } from '../api/client';
import { keys } from '../api/hooks';
import { getMe } from '../api/service';
import type { Me } from '../api/types';

export type AuthStatus = 'restoring' | 'restoreError' | 'signedOut' | 'onboarding' | 'resetting' | 'ready';

type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** Verifies the emailed one-time code and signs the member in. */
  verifySignupOtp: (email: string, token: string) => Promise<void>;
  /** Sets a new password while holding a recovery session (link or code path). */
  setNewPassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Retry a stalled session restore without deleting local credentials. */
  retryRestore: () => void;
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
  const profileLoaded = useRef(false);
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const retryRestore = useCallback(() => { setRestoreError(false); setRestoring(true); setRestoreAttempt((n) => n + 1); }, []);
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
    profileLoaded.current = false;
    setSignedIn(false);
    setMeState(null);
    setMustSetPassword(false);
    qc.clear();
  }, [qc]);

  // A recovery email link lands with #...type=recovery — route those members
  // straight to the "choose a new password" screen instead of the app.
  useEffect(() => {
    const location = browserLocation(Platform.OS, typeof window === 'undefined' ? undefined : window);
    if (/type=recovery/.test(location?.hash ?? '')) {
      setMustSetPassword(true);
    }
  }, []);

  /** Adopt whatever session supabase-js now holds (startup, sign-in, or an email link landing). */
  const adoptSession = useCallback(async () => {
    setSignedIn(true);
    try {
      const current = await getMe();
      profileLoaded.current = true;
      qc.setQueryData(keys.me, current);
      setMeState(current);
      setRestoreError(false);
      setRestoring(false);
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
        const { data, error } = await withDeadline(supabase.auth.getSession(), 15000, 'Session restore timed out.');
        if (error) throw error;
        if (data.session && !cancelled) {
          const current = await withDeadline(getMe(), 15000, 'Profile restore timed out.');
          if (!cancelled) {
            profileLoaded.current = true;
            qc.setQueryData(keys.me, current);
            setMeState(current);
            setSignedIn(true);
          }
        }
        if (!cancelled) setRestoreError(false);
      } catch {
        // An auth event may have loaded the profile while this attempt timed
        // out. Never leave a successfully restored member behind an error.
        if (!cancelled && !profileLoaded.current) setRestoreError(true);
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
  }, [qc, forget, adoptSession, restoreAttempt]);

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
      const { error } = await withDeadline(supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }), 20000, 'Sign in is taking too long. Check your connection and try again.');
      if (error) {
        const msg = String(error.message ?? '');
        if (/invalid login credentials/i.test(msg)) throw new ApiError(401, 'That email and password don’t match.');
        if (/not confirmed/i.test(msg)) throw new ApiError(403, 'Your email isn’t confirmed yet — enter the code from your inbox during sign up, or run sign up again to get a new code.');
        if (!msg) throw new ApiError(400, 'Enter your email and password.');
        throw new ApiError(error.status ?? 400, msg);
      }
      await withDeadline(afterAuth(), 20000, 'Signed in, but your profile did not load. Check your connection and try again.');
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
          'Check your inbox — we sent a code and a link. Use whichever you prefer.',
        );
      }
      await afterAuth();
    },
    [afterAuth],
  );

  const verifySignupOtp = useCallback(
    async (email: string, token: string) => {
      requireConfig();
      const code = token.trim();
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code,
        type: 'signup',
      });
      if (error) {
        const msg = String(error.message ?? '');
        if (/expired/i.test(msg)) {
          throw new ApiError(410, 'That code has expired — tap Resend code for a fresh one.');
        }
        if (/invalid|token|otp/i.test(msg)) {
          throw new ApiError(400, 'That code didn’t work — check for typos, or resend a new one.');
        }
        throw new ApiError(error.status ?? 400, msg || 'We couldn’t verify that code.');
      }
      if (!data.session) {
        throw new ApiError(400, 'That code didn’t work — check for typos, or resend a new one.');
      }
      await afterAuth();
    },
    [afterAuth],
  );

  const setNewPassword = useCallback(
    async (password: string) => {
      requireConfig();
      const pw = String(password ?? '');
      if (pw.length < 8) throw new ApiError(400, 'Use at least 8 characters.');
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw toApiError(error);
      setMustSetPassword(false);
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

  const status: AuthStatus = restoring ? 'restoring' : restoreError ? 'restoreError' : !signedIn ? 'signedOut' : mustSetPassword ? 'resetting' : me && !me.onboarded ? 'onboarding' : 'ready';

  const value = useMemo(
    () => ({ status, me, signIn, signUp, verifySignupOtp, setNewPassword, signOut, refresh, forget, retryRestore }),
    [status, me, signIn, signUp, verifySignupOtp, setNewPassword, signOut, refresh, forget, retryRestore],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
