import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { spaceShareUrl } from './spaceShare';
import { PUBLIC_SITE } from './publicSite';
import { spaceShareToken } from '../api/service';
import { isMissingFunctionError } from './relationshipFallback';

/**
 * The link for a Space, minted by the database rather than assembled here: a
 * token cannot be derived for a Space the member may not share, and revoking one
 * kills every copy in circulation.
 *
 * A backend that predates the token routine gets the older in-app link instead.
 * That is safe rather than a compromise: with no token routine there is no public
 * card either, so `?space=` opens the app and reveals nothing to a stranger —
 * whereas failing outright would take the share button away from those members.
 */
async function spaceUrl(id: number): Promise<string> {
  try {
    return spaceShareUrl(await spaceShareToken(id));
  } catch (e) {
    if (isMissingFunctionError(e as { code?: string; message?: string })) {
      return `${PUBLIC_SITE}/?space=${id}`;
    }
    throw e;
  }
}

export async function copySpaceLink(id: number): Promise<void> {
  const ok = await Clipboard.setStringAsync(await spaceUrl(id));
  if (!ok) throw new Error('Clipboard unavailable');
}

export async function shareSpaceLink(id: number): Promise<'shared' | 'copied' | 'dismissed'> {
  const url = await spaceUrl(id);
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ url }); return 'shared'; }
      catch (e) { if ((e as Error).name === 'AbortError') return 'dismissed'; throw e; }
    }
    await copySpaceLink(id);
    return 'copied';
  }
  const result = await Share.share({ message: url });
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
