import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { invitationUrl } from './referral';

export async function copyInvitationLink(code: string): Promise<void> {
  const ok = await Clipboard.setStringAsync(invitationUrl(code));
  if (!ok) throw new Error('Clipboard unavailable');
}

export async function shareInvitationLink(code: string): Promise<'shared' | 'copied' | 'dismissed'> {
  const url = invitationUrl(code);
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url });
        return 'shared';
      } catch (error) {
        if ((error as Error).name === 'AbortError') return 'dismissed';
        throw error;
      }
    }
    await copyInvitationLink(code);
    return 'copied';
  }
  const result = await Share.share({ message: url });
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
