import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { circleNotificationText, circleRoute, isCircleNotification } from '../lib/circleNotifications';
import { useProfileTap } from '../lib/useProfileTap';
import { Txt } from './Txt';
import { Avatar } from './Photo';
import { BottomSheet } from './BottomSheet';
import { EmptyState, ErrorState, Skeleton } from './States';
import { useNotifications, useMarkNotificationsRead } from '../api/hooks';
import { timeAgo } from '../lib/format';
import { space, radius, stroke } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import type { AppNotification, NotificationKind } from '../api/types';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Lens = 'yours' | 'crushly';

/**
 * Notifications, as a sheet.
 *
 * It used to be a page, which meant tapping a bell replaced the whole app for a
 * list you glance at and leave. A sheet keeps the Home underneath, closes on the
 * backdrop, on a downward drag or on Android's back — the three ways people
 * already dismiss things.
 *
 * Two tabs, one interface. `From Crushly` is the product talking to you
 * (verification results, announcements); `Yours` is other members — Crushes,
 * Whispers, and what came back to a Moment. The split is by notification kind,
 * not by a second endpoint: there is one list of notifications and two ways to
 * read it, so a notification can never exist in one tab and not the other.
 */
/** The mark on a Circle notification: asked, let in, turned away, invited. */
const CIRCLE_GLYPH: Partial<Record<NotificationKind, keyof typeof Ionicons.glyphMap>> = {
  circle_request: 'person-add-outline',
  circle_approved: 'checkmark',
  circle_declined: 'close',
  circle_invite: 'mail-outline',
  circle_joined: 'people-circle-outline',
};

export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { data, isLoading, isError, error, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [lens, setLens] = useState<Lens>('yours');

  const items = useMemo<AppNotification[]>(() => data ?? [], [data]);
  const yours = items.filter((n) => n.kind !== 'verified' && n.kind !== 'verification_rejected');
  const fromCrushly = items.filter((n) => n.kind === 'verified' || n.kind === 'verification_rejected');
  const shown = lens === 'yours' ? yours : fromCrushly;
  const unread = shown.filter((n) => !n.read).length;

  /** Downward drag on the grabber closes it, the way the platform does. */
  const drag = useRef(new Animated.Value(0)).current;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 6,
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 70) {
            onClose();
          }
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [drag, onClose],
  );

  const openProfile = useProfileTap();
  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    onClose();
    const kind: NotificationKind = n.kind;
    if (kind === 'message' && n.refId) {
      navigation.navigate('Chat', { conversationId: n.refId });
      return;
    }
    if (kind === 'crush' || kind === 'deep_crush') {
      navigation.navigate('CrushList', { tab: 'incoming' });
      return;
    }
    if (kind === 'mutual') {
      navigation.navigate('CrushList', { tab: 'mutual' });
      return;
    }
    if (kind === 'verified' || kind === 'verification_rejected') {
      navigation.navigate('Verification');
      return;
    }
    /*
     * A Circle notification is about a room, not a person, so it opens the room.
     * The reference is the Circle's id in all four cases: a request lands on the
     * owner's Requests list (the thing they have to do), an approval on the room
     * itself (the thing they now have), and a decline or an invitation on the
     * preview — where someone who is not in the room can still see where they
     * stand and, for an invitation, the way in.
     */
    if (isCircleNotification(kind) && n.refId) {
      const to = circleRoute(kind, n.refId);
      if (to) navigation.navigate(to.screen, to.params);
      return;
    }
    if (n.actor) navigation.navigate('UserProfile', { id: n.actor.id });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight={0.82}>
      <View {...pan.panHandlers} style={{ alignItems: 'center', paddingTop: space.xs, paddingBottom: space.sm }}>
        <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingBottom: space.sm }}>
        <Txt variant="display" style={{ flex: 1 }}>
          Notifications
        </Txt>
        {unread > 0 ? (
          <Pressable
            onPress={() => markRead.mutate({ kinds: Array.from(new Set(shown.map((n) => n.kind))) })}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${lens === 'yours' ? 'your notifications' : 'Crushly’s notifications'} read`}
            hitSlop={8}
            style={{ paddingHorizontal: space.sm, paddingVertical: 4 }}
          >
            <Txt variant="caption" style={{ color: colors.primary }}>
              Mark all read
            </Txt>
          </Pressable>
        ) : null}
      </View>

      {/* Two tabs, one list. */}
      <View style={{ flexDirection: 'row', gap: space.lg, paddingHorizontal: space.md, borderBottomWidth: stroke.hairline, borderBottomColor: colors.border }}>
        {([
          ['yours', 'Yours'],
          ['crushly', 'From Crushly'],
        ] as [Lens, string][]).map(([key, label]) => {
          const on = lens === key;
          const count = (key === 'yours' ? yours : fromCrushly).filter((n) => !n.read).length;
          return (
            <Pressable
              key={key}
              onPress={() => setLens(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={count ? `${label}, ${count} unread` : label}
              style={{ paddingVertical: space.sm }}
            >
              <Txt
                style={{
                  fontSize: 14.5,
                  fontFamily: on ? 'Manrope_800ExtraBold' : 'Manrope_600SemiBold',
                  color: on ? colors.text : colors.textMuted,
                }}
              >
                {label}
                {count ? ` ${count}` : ''}
              </Txt>
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: on ? colors.text : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={{ padding: space.md, gap: space.sm }}>
          <Skeleton style={{ height: 62 }} />
          <Skeleton style={{ height: 62 }} />
          <Skeleton style={{ height: 62 }} />
        </View>
      ) : isError ? (
        <ErrorState message={(error as Error)?.message ?? 'Notifications didn’t load.'} onRetry={() => void refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={lens === 'yours' ? 'notifications-outline' : 'megaphone-outline'}
          title={lens === 'yours' ? 'Nothing yet' : 'Nothing from Crushly'}
          message={
            lens === 'yours'
              ? 'Crushes, Whispers and replies to your Moments will land here.'
              : 'Account and verification news from Crushly will land here.'
          }
        />
      ) : (
        <ScrollView
          style={{ maxHeight: 460 }}
          contentContainerStyle={{ padding: space.sm, gap: 2, paddingBottom: space.xl }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.text} />
          }
        >
          {shown.map((n) => {
            const official = n.kind === 'verified' || n.kind === 'verification_rejected';
            /*
             * A Circle notification carries the room's *name* as its body, which
             * on its own says nothing: "Sunday go sharp oh" is not news. It gets
             * the same sentence the full Notifications screen uses — one copy,
             * one phrasing — so the row reads "Ada asked to join Sunday go sharp".
             */
            const line = isCircleNotification(n.kind)
              ? circleNotificationText(n.kind, n.body, n.actor?.name ?? 'Someone').title
              : n.body;
            return (
              <Pressable
                key={n.id}
                onPress={() => open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n.actor?.name ?? 'Crushly'}: ${line}${n.read ? '' : ', unread'}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  padding: space.sm,
                  borderRadius: radius.md,
                  backgroundColor: n.read ? 'transparent' : colors.card,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                {official ? (
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.card,
                      borderWidth: stroke.hairline,
                      borderColor: colors.border,
                    }}
                  >
                    <Ionicons name={n.kind === 'verified' ? 'shield-checkmark' : 'shield-outline'} size={19} color={colors.gold} />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => (n.actor ? openProfile(n.actor.id) : undefined)}
                    accessibilityRole="button"
                    accessibilityLabel={n.actor ? `Open ${n.actor.name}` : undefined}
                  >
                    <Avatar uri={n.actor?.photo ?? null} name={n.actor?.name ?? 'Crushly'} size={40} />
                    {/* Which kind of Circle news this is, without a second word. */}
                    {CIRCLE_GLYPH[n.kind] ? (
                      <View
                        style={{
                          position: 'absolute',
                          right: -2,
                          bottom: -2,
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.card,
                          borderWidth: stroke.hairline,
                          borderColor: colors.border,
                        }}
                      >
                        <Ionicons name={CIRCLE_GLYPH[n.kind]!} size={11} color={colors.primary} />
                      </View>
                    ) : null}
                  </Pressable>
                )}
                <View style={{ flex: 1 }}>
                  <Txt variant="body" numberOfLines={2}>
                    {line}
                  </Txt>
                  <Txt variant="caption" color="textMuted" style={{ marginTop: 2 }}>
                    {[n.actor?.name, timeAgo(n.createdAt)].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
                {n.read ? null : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.crush }} />}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </BottomSheet>
  );
}
