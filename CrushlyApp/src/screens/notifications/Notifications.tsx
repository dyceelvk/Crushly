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
};

export function notificationText(n: Pick<AppNotification, 'kind' | 'body'> & { actor: { name: string } | null }): { title: string; detail?: string } {
  const name = n.actor?.name ?? 'Someone';
  switch (n.kind) {
    case 'crush':
      return { title: `${name} sent you a Crush.` };
    case 'deep_crush':
      return { title: `${name} sent you a Big Crush.`, detail: n.body ? `“${n.body}”` : undefined };
    case 'mutual':
      return { title: `You and ${name} have a Mutual Crush.`, detail: 'Say hello while the feeling’s fresh.' };
    case 'message':
      return { title: `${name} sent you a Whisper.`, detail: n.body || undefined };
    case 'moment_reply':
      return { title: `${name} replied to your Moment.`, detail: n.body || undefined };
    case 'moment_reaction': {
      const emoji = n.body === 'crush' ? '♥' : MOMENT_REACTIONS.find((r) => r.key === n.body)?.emoji;
      return { title: `${name} reacted to your Moment${emoji ? ` ${emoji}` : ''}.` };
    }
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
  const unread = (data ?? []).filter((n) => !n.read).length;

  // Opening the center marks everything as seen after a beat (unread styling stays for this visit).
  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => markRead.mutate({}), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread > 0]);

  const open = (n: AppNotification) => {
    switch (n.kind) {
      case 'crush':
      case 'deep_crush':
        return navigation.navigate('Main', { screen: 'Crushes', params: { tab: 'incoming' } });
      case 'mutual':
        return n.actor ? navigation.navigate('UserProfile', { id: n.actor.id }) : navigation.navigate('Main', { screen: 'Crushes', params: { tab: 'mutual' } });
      case 'message':
      case 'moment_reply':
        return n.refId ? navigation.navigate('Chat', { conversationId: n.refId }) : navigation.navigate('Main', { screen: 'Messages' });
      case 'moment_reaction':
        return navigation.navigate('Moments');
      case 'verified':
      case 'verification_rejected':
        return navigation.navigate('Verification');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: gutter, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}>
          <IconButton icon="chevron-back" variant="plain" label="Go back" onPress={() => navigation.goBack()} />
          <Txt variant="heading" style={{ flex: 1 }} accessibilityRole="header">
            Crush Alerts
          </Txt>
          <IconButton icon="settings-outline" variant="plain" label="Crush Alert settings" onPress={() => navigation.navigate('NotificationSettings')} />
        </View>
      </View>
      {isLoading ? (
        <LoadingBlock label="Loading notifications" />
      ) : (
        <FlatList
          data={data ?? []}
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
                <View>
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
                </View>
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
              <ErrorState message={(error as Error)?.message} onRetry={refetch} />
            ) : (
              <EmptyState
                icon="notifications-outline"
                title="All quiet for now"
                message="Crushes, Mutual Crushes and Whispers will show up here."
                action={{ label: 'Discover people', onPress: () => navigation.navigate('Discover') }}
              />
            )
          }
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} />}
        />
      )}
    </View>
  );
}
