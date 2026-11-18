import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Avatar } from '../../components/Photo';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { Tabs } from '../../components/Tabs';
import { useLayout } from '../../components/Layout';
import { useSpaceViewers } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { useProfileTap } from '../../lib/useProfileTap';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Who viewed your Space.
 *
 * The visit was already being recorded every time somebody opened a Space — it
 * just had no way out of the database. What this screen shows is deliberately
 * second-hand information: a person's own name, and roughly when they were here.
 * Nothing about where they were, what they did next, or how long they stayed,
 * because a viewer list that leaks more than "I looked" is a tracking tool.
 *
 * Two things follow from that:
 *
 *   * It opens on a count. "Twelve people opened your Space this week" is the
 *     answer to the question most people are actually asking — is anybody
 *     looking — and it means you have to choose to see names rather than being
 *     handed a list of everybody who ever glanced at you.
 *   * Some rows have no name. A viewer who is incognito, has blocked you, has
 *     been blocked by you, or whose profile is not visible to you still counts,
 *     but shows as "Private member". The count never lies about how many people
 *     came; the list just does not always say who.
 */
export function SpaceViewersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const openProfile = useProfileTap();

  /** 0 = all time. Week is the default because "who looked at me recently" is
   *  the question, and all-time grows into a list nobody scrolls. */
  const [days, setDays] = useState(7);
  const viewers = useSpaceViewers(days);

  const pages = viewers.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const total = pages[0]?.count ?? 0;
  const named = items.filter((item) => item.profile !== null).length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.sm,
        paddingHorizontal: gutter,
        paddingBottom: space.xxxl,
        width: '100%',
        maxWidth: contentWidth,
        alignSelf: 'center',
      }}
      refreshControl={
        <RefreshControl
          refreshing={viewers.isRefetching}
          onRefresh={viewers.refetch}
          tintColor={colors.gold}
          colors={[colors.gold]}
          progressViewOffset={insets.top}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Txt variant="display" accessibilityRole="header">
            Who viewed you
          </Txt>
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            Only you can see this. Nobody is told they were here.
          </Txt>
        </View>
      </View>

      {/* The window is a choice, not a filter behind a menu. It is the app's own
          tab row rather than a segmented pill, because on a Space the tabs are
          how a page is divided and this page has one axis of division. */}
      <View style={{ marginTop: space.lg, flexDirection: 'row', gap: space.lg }}>
        <Tabs
          tabs={[
            { id: '1', label: 'Today' },
            { id: '7', label: 'This week' },
            { id: '0', label: 'All time' },
          ]}
          active={String(days)}
          onChange={(next) => setDays(Number(next))}
          accessibilityLabel="Choose the period"
        />
      </View>

      {viewers.isLoading ? (
        <LoadingBlock label="Loading viewers" />
      ) : viewers.isError ? (
        <ErrorState message="Couldn’t load who viewed you." onRetry={() => void viewers.refetch()} />
      ) : (
        <>
          {/* The headline answer, before any names. One number, no adjectives. */}
          <View
            style={{
              marginTop: space.lg,
              padding: space.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.primaryLine,
              backgroundColor: colors.card,
              gap: 2,
            }}
          >
            <Txt variant="display" accessibilityLabel={`${total} ${total === 1 ? 'viewer' : 'viewers'}`}>
              {total}
            </Txt>
            <Txt variant="small" color="textSecondary">
              {total === 1 ? 'person opened your Space' : 'people opened your Space'}
              {days === 1 ? ' today.' : days === 7 ? ' this week.' : ' in total.'}
            </Txt>
          </View>

          {items.length === 0 ? (
            <EmptyState
              icon="eye-outline"
              title="Nobody yet"
              message="When somebody opens your Space it shows up here. Your own visits never count."
            />
          ) : (
            <View style={{ marginTop: space.lg, gap: space.sm }}>
              <Txt variant="title" accessibilityRole="header">
                {named === 0 ? 'Viewers' : 'Who' }
              </Txt>
              {items.map((item, index) => {
                const profile = item.profile;
                const row = (
                  <>
                    <Avatar uri={profile?.photos?.[0]?.url ?? null} name={profile?.name ?? '?'} size={44} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {profile?.name ?? 'Private member'}
                      </Txt>
                      <Txt variant="small" color="textSecondary" numberOfLines={1}>
                        {profile ? timeAgo(item.viewedAt) : 'Their profile is private'}
                        {item.views > 1 ? ` · ${item.views} visits` : ''}
                      </Txt>
                    </View>
                  </>
                );
                /* A row you cannot open is not a button. Rendering it as one
                   would tell a screen reader there is something behind it. */
                return profile ? (
                  <Pressable
                    key={`${profile.id}-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${profile.name}’s Space`}
                    onPress={() => openProfile(profile.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      minHeight: 56,
                      paddingHorizontal: space.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.card,
                    }}
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View
                    key={`hidden-${index}`}
                    accessible
                    accessibilityLabel="A private member viewed your Space"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      minHeight: 56,
                      paddingHorizontal: space.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.card,
                      opacity: 0.7,
                    }}
                  >
                    {row}
                  </View>
                );
              })}
              {viewers.hasNextPage ? (
                <Button
                  title="Show more"
                  loading={viewers.isFetchingNextPage}
                  onPress={() => void viewers.fetchNextPage()}
                />
              ) : null}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
