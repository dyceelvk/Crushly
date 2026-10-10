import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { Pill, VerifiedBadge } from '../../components/Badges';
import { Button } from '../../components/Button';
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
export function CloseOnesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();
  const list = useCloseOnes();
  const letGo = useLetGo();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header">
              Close Ones
            </Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              People you’ve chosen to keep near. Only you can see this list.
            </Txt>
          </View>
        </View>

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          {list.isLoading ? (
            <LoadingBlock label="Loading your Close Ones" />
          ) : list.isError ? (
            <ErrorState message={list.error instanceof Error ? list.error.message : 'Your Close Ones didn’t load.'} onRetry={list.refetch} />
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
                  onPress={() => navigation.navigate('UserProfile', { id: entry.member.id })}
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
                      <Pill tone="gold" label="Keeps you close" icon={<Ionicons name="bookmark" size={11} color={colors.gold} />} />
                    ) : null}
                  </View>
                </Pressable>
                <Button
                  title="Let go"
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    haptic.tap();
                    letGo.mutate(entry.member.id, {
                      onError: (e) => toast({ kind: 'error', title: 'Not let go', message: (e as Error).message }),
                    });
                  }}
                />
              </View>
            ))
          ) : (
            <EmptyState
              icon="bookmark-outline"
              title="Nobody here yet"
              message="Keep someone close from their Space and they’ll show up here. It’s yours alone — they aren’t told, and nobody sees this list."
              action={{ label: 'Find someone', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) }}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
