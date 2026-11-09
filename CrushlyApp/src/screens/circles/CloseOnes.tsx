import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Avatar } from '../../components/Photo';
import { Pill, VerifiedBadge } from '../../components/Badges';
import { Button } from '../../components/Button';
import { ConfirmSheet } from '../../components/BottomSheet';
import { IconButton } from '../../components/IconButton';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useCloseOnes, useLetGo } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { haptic } from '../../lib/haptics';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Close Ones — the people you have chosen to keep near.
 *
 * The list is yours alone: nobody else can see who is on it, and letting
 * somebody go is silent. Keeping someone close asks nothing of them.
 */
/**
 * The list itself, without a screen around it.
 *
 * Close Ones is a list of *people you talk to*, so it lives inside Whispers
 * rather than as a destination of its own: it was a row in the menu, which put
 * the people you have chosen to keep near one tap away from the people you are
 * already whispering with, in a different room, with a different header.
 */
export function CloseOnesPane({ embedded = false }: { embedded?: boolean }) {
  /* Every picture on this screen opens a Moment when there is one live, and the
     Space otherwise — the same handler every other screen uses. */
  const openProfile = useProfileTap();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();
  const list = useCloseOnes();
  const letGo = useLetGo();
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: embedded ? 0 : insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
        }
        showsVerticalScrollIndicator={false}
      >
        {embedded ? (
          <Txt variant="small" color="textSecondary" style={{ marginTop: space.md, marginBottom: space.sm }}>
            People with an approved Keep Close relationship.
          </Txt>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
            <View style={{ flex: 1 }}>
              <Txt variant="display" accessibilityRole="header">
                Close Ones
              </Txt>
              <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
                People with an approved Keep Close relationship.
              </Txt>
            </View>
          </View>
        )}

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          {list.isLoading ? (
            <LoadingBlock label="Loading your Close Ones" />
          ) : list.isError ? (
            <ErrorState error={list.error} message="Your Close Ones didn’t load." onRetry={list.refetch} />
          ) : list.data?.items.length ? (
            list.data.items.map((entry) => (
              <View
                key={entry.member.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
                  padding: space.md,
                }}
              >
                <Pressable
                  onPress={() => openProfile(entry.member.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${entry.member.name}’s Space`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
                >
                  <Avatar uri={entry.member.photos[0]?.url ?? null} name={entry.member.name} size={46} ring={entry.member.verified ? 'gold' : undefined} />
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {entry.member.name}
                      </Txt>
                      {entry.member.verified ? <VerifiedBadge size={14} /> : null}
                    </View>
                    <Txt variant="caption" color="textMuted" numberOfLines={1}>
                      {entry.member.username ? `@${entry.member.username}` : entry.member.city || 'Member'}
                    </Txt>
                    {entry.keepsYou ? (
                      <Pill tone="gold" label="Kept Close" icon={<Ionicons name="bookmark" size={11} color={colors.gold} />} />
                    ) : null}
                  </View>
                </Pressable>
                <Button
                  title="Let go"
                  size="sm"
                  variant="secondary"
                  onPress={() => { haptic.tap(); setSelected({ id: entry.member.id, name: entry.member.name }); }}
                />
              </View>
            ))
          ) : (
            <EmptyState
              icon="bookmark-outline"
              title="Nobody here yet"
              message="Send a Keep Close request from someone’s Space. Once approved, they’ll appear here."
              action={{ label: 'Find someone', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) }}
            />
          )}
        </View>
      </ScrollView>
      <ConfirmSheet visible={!!selected} onCancel={() => setSelected(null)} title="End Keep Close?" message={`Your Whisper with ${selected?.name ?? 'this member'} will close. Your Add Up is separate and won’t be removed.`} confirmLabel="End Keep Close" destructive loading={letGo.isPending} onConfirm={() => { if (selected) letGo.mutate(selected.id, { onSuccess: () => { setSelected(null); toast({ kind: 'info', title: 'Keep Close ended' }); }, onError: (e) => toast({ kind: 'error', title: 'Couldn’t end Keep Close', message: (e as Error).message }) }); }} />
    </View>
  );
}
