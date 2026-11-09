import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { spaceShareUrl } from './spaceShare';

export async function copySpaceLink(id: number): Promise<void> {
  const ok = await Clipboard.setStringAsync(spaceShareUrl(id));
  if (!ok) throw new Error('Clipboard unavailable');
}

export async function shareSpaceLink(id: number): Promise<'shared' | 'copied' | 'dismissed'> {
  const url = spaceShareUrl(id);
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
