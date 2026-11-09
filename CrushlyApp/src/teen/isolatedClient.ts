import { createClient } from '@supabase/supabase-js';
import { cleanEnvValue, normalizeProjectUrl } from '../lib/env';
import { storage } from '../lib/storage';
import { fetchWithDeadline } from '../lib/requestClock';

/**
 * NOT wired to sign-in or navigation. An isolated teen backend must be a
 * separate Supabase project with separate auth/JWT signing keys. No adult
 * access token, client, media host or sessions may be reused. This client alone
 * does not prevent adults from lying about their age or make teen mode ready.
 */
export function createIsolatedTeenClient(config: { adultProjectUrl: string; teenProjectUrl: string; teenPublishableKey: string }) {
  const adult = normalizeProjectUrl(config.adultProjectUrl);
  const teen = normalizeProjectUrl(config.teenProjectUrl);
  const publicKey = cleanEnvValue(config.teenPublishableKey);
  const projectHost = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/.exec(teen);
  if (!adult || !projectHost || adult === teen || !publicKey.startsWith('sb_publishable_')) {
    throw new Error('Teen mode requires a separate Supabase project and its public key.');
  }
  return createClient(teen, publicKey, {
    auth: {
      storage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.remove(key),
      },
      // Separate per-project namespace. Never reuse adult or other-project tokens.
      storageKey: `holup-teen-${projectHost[1]}-auth-v1`,
      autoRefreshToken: true,
      persistSession: true,
      // The adult app already consumes auth links; teen email/deep-link handling
      // needs explicit, issuer-checked routing before this can be integrated.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: { fetch: fetchWithDeadline((input, init) => fetch(input as RequestInfo, init)) },
  });
}
