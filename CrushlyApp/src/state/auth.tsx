import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setAuthToken, setUnauthorizedHandler } from '../api/client';
import { keys } from '../api/hooks';
import type { Me } from '../api/types';
import { storage } from '../lib/storage';

const TOKEN_KEY = 'crushly.session';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
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
    setAuthToken(null);
    setToken(null);
    setMeState(null);
    await storage.remove(TOKEN_KEY);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      forget();
    });
  }, [forget]);

  useEffect(() => {
    (async () => {
      const saved = await storage.get(TOKEN_KEY);
      if (saved) {
        setAuthToken(saved);
        try {
          const current = await api.get<Me>('/me');
          qc.setQueryData(keys.me, current);
          setMeState(current);
          setToken(saved);
        } catch (e) {
          // Offline: keep the session and let screens show their own retry states.
          if (e instanceof ApiError && e.isNetwork) setToken(saved);
          else {
            setAuthToken(null);
            await storage.remove(TOKEN_KEY);
          }
        }
      }
      setRestoring(false);
    })();
  }, [qc]);

  const accept = useCallback(
    async (res: { token: string; me: Me }) => {
      setAuthToken(res.token);
      await storage.set(TOKEN_KEY, res.token);
      qc.setQueryData(keys.me, res.me);
      setMeState(res.me);
      setToken(res.token);
    },
    [qc],
  );

  const signIn = useCallback(
    async (email: string, password: string) => accept(await api.post('/auth/login', { email, password })),
    [accept],
  );
  const signUp = useCallback(
    async (email: string, password: string) => accept(await api.post('/auth/signup', { email, password })),
    [accept],
  );
  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* best effort */
    }
    await forget();
  }, [forget]);

  const refresh = useCallback(async () => {
    try {
      const current = await api.get<Me>('/me');
      qc.setQueryData(keys.me, current);
      setMeState(current);
      return current;
    } catch {
      return null;
    }
  }, [qc]);

  const status: AuthStatus = restoring ? 'restoring' : !token ? 'signedOut' : me && !me.onboarded ? 'onboarding' : 'ready';

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
