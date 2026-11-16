import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { browserLocation } from '../lib/browser';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, requireConfig, supabase, SUPABASE_PROJECT_URL, toApiError } from '../api/client';
import { captchaFailureMessage, getCaptchaToken, isCaptchaError } from '../lib/captcha';
import { emailSendMessage, signUpOutcome } from '../lib/auth';
import { nativeAuthorizeUrl, nativeRedirectFor, parseNativeReturn } from '../lib/oauthNative';
import { keys } from '../api/hooks';
import { getMe, webOrigin, webReturnUrl } from '../api/service';
import type { Me } from '../api/types';

import { authStatus, type AuthStatus } from '../lib/authGate';
export type { AuthStatus };

type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Hands the browser to Google and comes back with a session. No email is
   * involved, so nothing can be rate-limited, delayed or filed as spam — and the
   * address arrives already verified by Google.
   */
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** Verifies the emailed one-time code and signs the member in. */
  verifySignupOtp: (email: string, token: string) => Promise<void>;
  /** Sets a new password while holding a recovery session (link or code path). */
  setNewPassword: (password: string) => Promise<void>;
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
  const [mustSetPassword, setMustSetPassword] = useState(false);
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
      /**
       * Fetched per attempt, never cached: a Turnstile token is single-use and
       * expires. When no site key is configured this is `undefined` and the
       * request is exactly what it was before the check existed.
       */
      const captchaToken = await getCaptchaToken();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) {
        const msg = String(error.message ?? '');
        if (isCaptchaError(msg)) throw new ApiError(400, captchaFailureMessage(msg), 'captcha');
        if (/invalid login credentials/i.test(msg)) throw new ApiError(401, 'That email and password don’t match.');
        // A stable code, so the sign-in screen can offer the way out of this
        // state instead of only describing it.
        if (/not confirmed/i.test(msg)) throw new ApiError(403, 'Your email isn’t confirmed yet. We can send you a fresh code.', 'email-unconfirmed');
        if (!msg) throw new ApiError(400, 'Enter your email and password.');
        throw new ApiError(error.status ?? 400, msg);
      }
      await afterAuth();
    },
    [afterAuth],
  );

  const signInWithGoogle = useCallback(async () => {
    requireConfig();

    /**
     * On the phone there is no page to come back to, so the round trip is made
     * explicit: an in-app browser opens the project's authorize endpoint, Google
     * and Supabase do exactly what they do on the web, and Supabase sends the
     * app back to `crushly://auth-callback` with the session in the fragment.
     * `parseNativeReturn` reads it; nothing is adopted unless both tokens are
     * present and an actual sign-in is in flight.
     */
    if (Platform.OS !== 'web') {
      const { openAuthSessionAsync } = await import('expo-web-browser');
      const { default: Constants } = await import('expo-constants');
      // The scheme this build registered — `holup` in the secure release, which
      // app.config.js overrides over app.json's `crushly`. A redirect to the
      // wrong scheme is delivered to no app at all.
      const redirect = nativeRedirectFor(Constants.expoConfig?.scheme as string | string[] | undefined);
      const result = await openAuthSessionAsync(nativeAuthorizeUrl(SUPABASE_PROJECT_URL, redirect), redirect);
      // Dismissing the sheet is a decision, not a failure: say nothing.
      if (result.type !== 'success') return;
      const parsed = parseNativeReturn(result.url);
      if (!parsed) throw new ApiError(400, 'Google sign-in did not come back to holUpp. Please try again.');
      if (parsed.kind === 'error') throw new ApiError(400, parsed.message);
      const { error } = await supabase.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      });
      if (error) throw toApiError(error);
      await afterAuth();
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // The page they are on, not just the host: the root of holupp.net is the
      // marketing site, so a return to the origin alone lands them outside the
      // app with a session nothing picks up.
      options: { redirectTo: webReturnUrl() },
    });
    // Success means the browser is already navigating; the session is adopted
    // when Supabase redirects back with detectSessionInUrl.
    if (error) throw toApiError(error);
  }, [afterAuth]);

  const signUp = useCallback(
    async (email: string, password: string) => {
      requireConfig();
      /**
       * `emailRedirectTo` is not optional in practice. Without it the link in the
       * confirmation email is built from the project's `site_url`, which was
       * still the old Netlify deploy — so a member who tapped "Confirm my email"
       * left the app they were using. Passing the origin they are actually on is
       * what makes the link come back here; it only works because that origin is
       * in the project's redirect allow list.
       */
      const origin = webOrigin();
      // Same rule as sign-in: the check is asked for here, at the request, and
      // the token is spent immediately.
      const captchaToken = await getCaptchaToken();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          ...(origin ? { emailRedirectTo: origin } : {}),
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) {
        const msg = String(error.message ?? '');
        if (isCaptchaError(msg)) throw new ApiError(400, captchaFailureMessage(msg), 'captcha');
        if (/already (registered|exists)/i.test(msg)) {
          throw new ApiError(409, 'An account with this email already exists. Try signing in.');
        }
        if (/rate limit|too many/i.test(msg)) {
          throw new ApiError(429, emailSendMessage(msg), 'email-rate-limit');
        }
        throw new ApiError(error.status ?? 400, msg || 'We couldn’t create your account. Please try again.');
      }
      const outcome = signUpOutcome(data);
      if (outcome === 'already-registered') {
        /**
         * No error, no session, no identity — and no email. Saying "check your
         * inbox" here is the bug that looks exactly like a broken mail server.
         */
        throw new ApiError(409, 'That email already has a Space. Sign in instead — or use Forgot password for a reset code.');
      }
      if (outcome === 'confirm-email') {
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

  const status = authStatus({ restoring, signedIn, mustSetPassword, me });

  const value = useMemo(
    () => ({ status, me, signIn, signInWithGoogle, signUp, verifySignupOtp, setNewPassword, signOut, refresh, forget }),
    [status, me, signIn, signInWithGoogle, signUp, verifySignupOtp, setNewPassword, signOut, refresh, forget],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
