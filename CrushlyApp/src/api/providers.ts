import { useQuery } from '@tanstack/react-query';
import { SUPABASE_PROJECT_URL, SUPABASE_PUBLIC_KEY } from './client';

/**
 * Which third-party sign-in methods this project actually has switched on.
 *
 * The app must not draw a "Continue with Google" button that no one enabled —
 * tapping it would fail with a provider error the member cannot interpret.
 * Supabase publishes the answer at `/auth/v1/settings`, which is public and
 * needs only the same publishable key the client already carries.
 */
export type AuthProviders = { google: boolean };

export async function fetchAuthProviders(): Promise<AuthProviders> {
  const off = { google: false };
  if (!SUPABASE_PROJECT_URL) return off;
  try {
    const res = await fetch(`${SUPABASE_PROJECT_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLIC_KEY },
    });
    if (!res.ok) return off;
    const json = (await res.json()) as { external?: Record<string, boolean> };
    return { google: Boolean(json?.external?.google) };
  } catch {
    // Offline or blocked: absent a positive answer, do not show the button.
    return off;
  }
}

export const useAuthProviders = () =>
  useQuery({ queryKey: ['auth-providers'], queryFn: fetchAuthProviders, staleTime: 5 * 60_000, retry: false });
