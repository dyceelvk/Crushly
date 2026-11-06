import React, { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { IconButton } from '../../components/IconButton';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useMarkNotificationsRead, useNotifications } from '../../api/hooks';
import type { AppNotification } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { MOMENT_REACTIONS } from '../../lib/catalog';
import { circleNotificationText, circleRoute } from '../../lib/circleNotifications';
import { useProfileTap } from '../../lib/useProfileTap';
import type { ScreenProps } from '../../navigation/types';

const ICON: Record<AppNotification['kind'], { name: keyof typeof Ionicons.glyphMap; tone: 'crush' | 'gold' | 'success' | 'textSecondary' }> = {
  crush: { name: 'heart', tone: 'crush' },
  deep_crush: { name: 'sparkles', tone: 'gold' },
  mutual: { name: 'heart-circle', tone: 'crush' },
  message: { name: 'chatbubble', tone: 'textSecondary' },
  moment_reply: { name: 'aperture', tone: 'gold' },
  moment_reaction: { name: 'happy', tone: 'gold' },
  verified: { name: 'shield-checkmark', tone: 'success' },
  verification_rejected: { name: 'shield-outline', tone: 'textSecondary' },
  post_reaction: { name: 'heart-outline', tone: 'crush' },
  post_comment: { name: 'chatbubble-outline', tone: 'textSecondary' },
  post_mention: { name: 'at-outline', tone: 'gold' },
  keep: { name: 'eye-outline', tone: 'gold' },
  circle_request: { name: 'person-add-outline', tone: 'gold' },
  circle_approved: { name: 'checkmark-circle', tone: 'success' },
  circle_joined: { name: 'people-circle-outline', tone: 'success' },
  circle_declined: { name: 'close-circle-outline', tone: 'textSecondary' },
  circle_invite: { name: 'mail-outline', tone: 'gold' },
};

/**
 * What a notification says, in the words the product uses.
 *
 * Every line here names the person, says what they did, and stops. The three
 * relationships are not interchangeable and must not be made to sound alike:
 * a profile is an **Add up** (a request a person answers), following is
 * **Keeping close** (nobody's permission needed), and a post is a **Crush**
 * (engagement, undone by tapping again). Writing "added up with you" for a
 * Crush, or "following you" for an Add up, is how the three became one feature
 * wearing three names.
 */
export function notificationText(n: Pick<AppNotification, 'kind' | 'body'> & { actor: { name: string } | null }): { title: string; detail?: string } {
  const name = n.actor?.name ?? 'Someone';
  switch (n.kind) {
    case 'crush':
      return { title: `${name} added you up.`, detail: 'Accept or decline it in Crushes.' };
    case 'deep_crush':
      return { title: `${name} added you up and sent a note.`, detail: n.body ? `“${n.body}”` : undefined };
    case 'mutual':
      return { title: `${name} accepted your Add Up request.` };
    case 'keep':
      return { title: `${name} started keeping you close.` };
    case 'post_reaction':
      return { title: `${name} crushed on your post.`, detail: 'See what’s happening there.' };
    case 'post_comment':
      return { title: `${name} commented on your post.`, detail: n.body ? `“${n.body}”` : undefined };
    case 'post_mention':
      return { title: `${name} mentioned you in a post.`, detail: n.body ? `“${n.body}”` : undefined };
    /* A Whisper is answered in Whisper. It has no line here on purpose: the
       database no longer writes these rows, and an old one is not drawn. */
    case 'message':
      return { title: '' };
    case 'moment_reply':
      return { title: `${name} replied to your Moment.`, detail: n.body || undefined };
    case 'moment_reaction': {
      const emoji = n.body === 'crush' ? '♥' : MOMENT_REACTIONS.find((r) => r.key === n.body)?.emoji;
      return { title: `${name} reacted to your Moment${emoji ? ` ${emoji}` : ''}.` };
    }
    /* The body of a Circle notification is the room's name, so it reads as one. */
    case 'circle_request':
    case 'circle_approved':
    case 'circle_joined':
    case 'circle_declined':
    case 'circle_invite':
      return circleNotificationText(n.kind, n.body, name);
    case 'verified':
      return { title: 'Your Space is verified.', detail: 'Your check badge is now visible on your Space.' };
    case 'verification_rejected':
      return { title: 'Your verification needs another try.', detail: n.body || 'Make sure your face is clearly visible and matches the pose.' };
    default:
      return { title: n.body };
  }
}

export function NotificationsScreen({ navigation }: ScreenProps<'Notifications'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { data, isLoading, isError, error, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationsRead();
  /**
   * Social activity only.
   *
   * The database stopped writing `message` rows (a Whisper belongs in the Whisper
   * inbox, where it can be read and answered in one place). Rows written before
   * that rule existed are dropped here as well, so the centre is not a museum of
   * old conversations on any phone that installed an earlier build.
   */
  const items = (data ?? []).filter((n) => n.kind !== 'message');
  const unread = items.filter((n) => !n.read).length;

  // Opening the center marks everything as seen after a beat (unread styling stays for this visit).
  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => markRead.mutate({}), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread > 0]);

  const openProfile = useProfileTap();
  /**
   * Where a notification goes.
   *
   * Each destination is the thing the notification is about, and nothing else:
   * an Add up opens the request where it can be accepted or declined, an
   * accepted one opens the person's Space, a follow opens the follower's Space,
   * and a Crush, a comment or a mention opens the exact post. Taking somebody to
   * a feed and hoping they find it is the same as not answering the tap.
   */
  const open = (n: AppNotification) => {
    switch (n.kind) {
      case 'crush':
      case 'deep_crush':
        // The request itself, with Accept and Decline — not a list of people.
        return navigation.navigate('CrushList', { tab: 'incoming' });
      case 'mutual':
      case 'keep':
        return n.actor ? navigation.navigate('UserProfile', { id: n.actor.id }) : navigation.navigate('Main', { screen: 'Discover' });
      case 'post_reaction':
      case 'post_comment':
      case 'post_mention':
        return n.refId ? navigation.navigate('PostViewer', { postId: n.refId }) : navigation.navigate('Main', { screen: 'Flows' });
      case 'moment_reply':
        return n.refId ? navigation.navigate('Chat', { conversationId: n.refId }) : navigation.navigate('Main', { screen: 'Messages' });
      case 'moment_reaction':
        return navigation.navigate('Moments');
      case 'verified':
      case 'verification_rejected':
        return navigation.navigate('Verification');
      case 'circle_request':
      case 'circle_approved':
      case 'circle_joined':
      case 'circle_declined':
      case 'circle_invite': {
        const to = n.refId ? circleRoute(n.kind, n.refId) : null;
        return to ? navigation.navigate(to.screen, to.params) : navigation.navigate('Circles');
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: gutter, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}>
          <IconButton icon="chevron-back" variant="plain" label="Go back" onPress={() => navigation.goBack()} />
          {/* One place, one name. What it carries is social activity — add ups,
              Keep Closes, Crushes, comments and mentions — and never a private
              conversation, which lives in Whisper. */}
          <Txt variant="heading" style={{ flex: 1 }} accessibilityRole="header">
            Notifications
          </Txt>
          <IconButton icon="settings-outline" variant="plain" label="Notification settings" onPress={() => navigation.navigate('NotificationSettings')} />
        </View>
      </View>
      {isLoading ? (
        <LoadingBlock label="Loading notifications" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.xxxl, width: '100%', maxWidth: contentWidth, alignSelf: 'center', flexGrow: 1 }}
          renderItem={({ item: n }) => {
            const ic = ICON[n.kind] ?? ICON.message;
            const t = notificationText(n);
            return (
              <Pressable
                onPress={() => open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n.read ? '' : 'New. '}${t.title} ${t.detail ?? ''}. ${timeAgo(n.createdAt)} ago`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 })}
              >
                <Pressable
                  /* The row opens what the notification is about; the picture
                     opens the person — Moment first when they have one live. */
                  onPress={() => (n.actor ? openProfile(n.actor.id) : open(n))}
                  accessibilityRole="button"
                  accessibilityLabel={n.actor ? `Open ${n.actor.name}` : 'Open notification'}
                >
                  {n.actor ? (
                    <Avatar uri={n.actor.photo} name={n.actor.name} size={48} />
                  ) : (
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={ic.name} size={22} color={colors[ic.tone]} />
                    </View>
                  )}
                  {n.actor ? (
                    <View style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={ic.name} size={14} color={colors[ic.tone]} />
                    </View>
                  ) : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Txt variant={n.read ? 'body' : 'bodyStrong'}>{t.title}</Txt>
                  {t.detail ? (
                    <Txt variant="small" color="textSecondary" numberOfLines={2} style={{ marginTop: 2 }}>
                      {t.detail}
                    </Txt>
                  ) : null}
                  <Txt variant="caption" color="textMuted" style={{ marginTop: 2 }}>
                    {timeAgo(n.createdAt)} ago
                  </Txt>
                </View>
                {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.crush }} accessibilityElementsHidden /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            isError ? (
              <ErrorState error={error} message="Notifications didn’t load." onRetry={refetch} />
            ) : (
              <EmptyState
                icon="notifications-outline"
                title="All quiet for now"
                message="Add ups, Keep Closes, Crushes and comments will show up here. Whispers stay in Whisper."
                action={{ label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) }}
              />
            )
          }
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} />}
        />
      )}
    </View>
  );
}
