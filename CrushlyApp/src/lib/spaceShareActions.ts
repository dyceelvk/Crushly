import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { spaceShareUrl } from './spaceShare';
import { spaceShareToken } from '../api/service';

/**
 * Share links are minted, not constructed: the database issues the token, so a
 * member cannot hand out a link for somebody else's Space and a revoked link
 * stops resolving.
 */
export async function copySpaceLink(id: number): Promise<void> {
  const url = spaceShareUrl(await spaceShareToken(id));
  const ok = await Clipboard.setStringAsync(url);
  if (!ok) throw new Error('Clipboard unavailable');
}

export async function shareSpaceLink(id: number): Promise<'shared' | 'copied' | 'dismissed'> {
  const url = spaceShareUrl(await spaceShareToken(id));
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
