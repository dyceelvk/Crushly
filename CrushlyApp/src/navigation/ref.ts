/**
 * A handle on navigation for things that are not screens — a tapped system
 * notification, for instance, which arrives whenever the phone decides to deliver
 * it, including before the tree has drawn its first screen.
 */
import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';
import type { AlertRoute } from '../lib/alertContent';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Opens where the notification was about. Returns false when navigation is not
 * ready yet — the caller keeps the route and tries again, rather than dropping a
 * member on the home screen and letting them wonder what they tapped.
 */
export function openAlertRoute(route: AlertRoute): boolean {
  if (!navigationRef.isReady()) return false;
  if (route === 'messages') navigationRef.navigate('Main', { screen: 'Messages' });
  else navigationRef.navigate('Notifications');
  return true;
}
