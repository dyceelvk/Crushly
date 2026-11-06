/**
 * The one profile-picture handler.
 *
 * Every screen that shows somebody's picture calls `openProfile(id)` from this
 * hook and nothing else, so there is exactly one place that decides whether a tap
 * means "their Moment" or "their Space". A screen cannot drift from the rule
 * without changing this file — which is the point: the behaviour was previously
 * decided in seventeen separate `onPress` handlers, and they had already started
 * to disagree.
 *
 * The Moment it consults is the real one: the same `visible_moments` response
 * the rings are drawn from, already filtered by the backend for expiry and
 * audience. Not a decorative ring, and not a guess.
 */
import { useCallback, useRef } from 'react';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLiveMomentUsers, useMe } from '../api/hooks';
import { momentViewerParams, profileDestination } from './profileTap';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Two taps inside this window are one tap: a picture is easy to hit twice. */
const DOUBLE_TAP_MS = 700;

/**
 * `ring: true` is a statement about the *picture on screen*, not about the
 * screen: call it from an avatar that is drawn with `momentRing` right now.
 * Everything else keeps the default and opens the Space, which is why a chat
 * header, a name in a notification or a row in Search can no longer fall into
 * somebody's Moment by accident.
 */
export function useProfileTap(options: { ring?: boolean } = {}): (userId: number | null | undefined) => void {
  const surface = options.ring ? 'ring' : 'plain';
  const navigation = useNavigation<Nav>();
  const live = useLiveMomentUsers();
  /* Your own picture is a door too. Without this, tapping your own ring asked
     the viewer for somebody else's Moment and found nothing, because yours are
     not in that list. */
  const me = useMe();
  const meId = me.data?.id ?? null;
  const lastTap = useRef<{ userId: number; at: number } | null>(null);

  /*
   * Which screen we are on, and — if it is the Moment viewer — whose Moment it
   * is showing. Read from the navigator rather than a context so it is correct
   * even on a screen that was reached by a deep link.
   */
  const viewingMomentOf = useNavigationState((state) => {
    const route = state?.routes?.[state.index ?? 0];
    if (!route || route.name !== 'MomentViewer') return null;
    const params = route.params as { userId?: number } | undefined;
    return params?.userId ?? null;
  });

  return useCallback(
    (userId) => {
      if (!userId) return;
      const now = Date.now();
      if (lastTap.current && lastTap.current.userId === userId && now - lastTap.current.at < DOUBLE_TAP_MS) return;
      lastTap.current = { userId, at: now };

      const where = profileDestination({ userId, surface, liveMoments: live, viewingMomentOf });
      if (where === 'moment') navigation.navigate('MomentViewer', momentViewerParams(userId, meId));
      else navigation.navigate('UserProfile', { id: userId });
    },
    [navigation, live, viewingMomentOf, meId, surface],
  );
}
