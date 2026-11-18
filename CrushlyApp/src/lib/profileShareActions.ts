import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { profileShareUrl } from './profileShare';

/**
 * Sharing a Space, the same two verbs posts already have.
 *
 * Deliberately built on the handle rather than a database-minted token: a handle
 * is not a secret, and the landing page re-asks the database on every visit, so
 * the link stops revealing anything the moment the member turns their Space
 * private. There is nothing to revoke.
 */
export async function copyProfileLink(username: string): Promise<void> {
  const ok = await Clipboard.setStringAsync(profileShareUrl(username));
  if (!ok) throw new Error('Clipboard unavailable');
}

export async function shareProfileLink(username: string): Promise<'shared' | 'copied' | 'dismissed'> {
  const url = profileShareUrl(username);
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url });
        return 'shared';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'dismissed';
        throw e;
      }
    }
    await copyProfileLink(username);
    return 'copied';
  }
  const result = await Share.share({ message: url });
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
