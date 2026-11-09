import { useSwipeTabs } from '../../components/SwipeTabs';
import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Segmented } from '../../components/Segmented';
import { ProfileTile } from '../../components/ProfileCard';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useAcceptKeepClose, useCrushes, useDeclineKeepClose, useKeepRequests, useLetGo, useMe, useOpenConversation } from '../../api/hooks';
import type { Profile } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgoLong } from '../../lib/format';
import type { RootStackParamList } from '../../navigation/types';

type Tab = 'incoming' | 'outgoing' | 'mutual';

/** Height of Home's strip. As a pane, Crushes starts under it — the strip is
 *  drawn over the pane, so anything that begins at the top of the pane collides
 *  with it. The 320 dp walk caught exactly that: the lens row printed straight
 *  through "Flow · Crushes · Connections". */
const STRIP = 46;

export function CrushesScreen({ embedded = false, initial }: { embedded?: boolean; initial?: Tab } = {}) {
  /* Every picture on this screen opens a Moment when there is one live, and the
     Space otherwise — the same handler every other screen uses. */
  const openProfile = useProfileTap();
  const route = useRoute<RouteProp<RootStackParamList, 'CrushList'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { contentWidth, gutter, columns } = useLayout();
  const { data, isLoading, isError, error, refetch, isRefetching } = useCrushes();
  const [tab, setTab] = useState<Tab>(initial ?? route.params?.tab ?? 'incoming');
  const swipe = useSwipeTabs({ options: ['incoming', 'outgoing', 'mutual'] as Tab[], value: tab, onChange: setTab, width: contentWidth });
  const { data: me } = useMe();
  const requests = useKeepRequests(me?.id ?? 0, tab === 'outgoing' ? 'outgoing' : 'incoming', tab !== 'mutual');
  const accept = useAcceptKeepClose();
  const decline = useDeclineKeepClose();
  const cancel = useLetGo();
  const open = useOpenConversation();

  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);

  const list = tab === 'mutual' ? (data?.mutual ?? []) : (requests.data?.pages.flatMap((page) => page.items) ?? []);
  const loadingList = tab === 'mutual' ? isLoading : requests.isLoading;
  const errorList = tab === 'mutual' ? isError : requests.isError;
  const listError = tab === 'mutual' ? error : requests.error;
  const refresh = () => { void refetch(); if (tab !== 'mutual') void requests.refetch(); };
  const gap = 12;
  const tileW = (contentWidth - gutter * 2 - gap * (columns - 1)) / columns;

  const message = async (p: Profile) => {
    try {
      const conv = await open.mutateAsync(p.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open your Whisper', message: (e as Error).message });
    }
  };

  const footer = (p: Profile) => {
    if (tab === 'incoming') {
      return (
        <View style={{ marginTop: 8, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton
              icon="close"
              label={`Decline ${p.name}’s request`}
              size={40}
              onPress={() => decline.mutate(p.id, { onSuccess: () => toast({ kind: 'info', title: 'Request declined' }), onError: (e) => toast({ kind: 'error', title: 'Couldn’t decline', message: (e as Error).message }) })}
              color={colors.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <Button
                title="Accept"
                size="sm"
                variant="crush"
                loading={accept.isPending && accept.variables === p.id}
                onPress={() =>
                  accept.mutate(p.id, {
                    onSuccess: () => toast({ kind: 'success', title: 'Request accepted' }),
                    onError: (e) => toast({ kind: 'error', title: 'Request not accepted', message: (e as Error).message }),
                  })
                }
              />
            </View>
          </View>
        </View>
      );
    }
    if (tab === 'mutual') {
      return (
        <View style={{ marginTop: 8 }}>
          <Button title="Whisper" size="sm" variant="secondary" icon="chatbubble-outline" onPress={() => message(p)} />
        </View>
      );
    }
    /* Outgoing: the only thing left to do with a question you asked is to take
       it back. */
    return (
      <View style={{ marginTop: 8 }}>
        <Button
          title="Cancel request"
          size="sm"
          variant="secondary"
          loading={cancel.isPending && cancel.variables === p.id}
          onPress={() =>
            cancel.mutate(p.id, {
              onSuccess: () => toast({ kind: 'info', title: 'Request cancelled', message: `${p.name} won’t see it anymore.` }),
              onError: (e) => toast({ kind: 'error', title: 'Couldn’t cancel', message: (e as Error).message }),
            })
          }
        />
      </View>
    );
  };

  const caption = (p: Profile) => {
    if (tab === 'incoming') return p.at ? `Asked to Keep Close · ${timeAgoLong(p.at)}` : 'Asked to Keep Close';
    if (tab === 'outgoing') return p.at ? `Request sent · ${timeAgoLong(p.at)}` : 'Request sent';
    return p.at ? `Kept Close · ${timeAgoLong(p.at)}` : 'Kept Close';
  };

  const empty = {
    incoming: {
      title: 'No Keep Close requests yet',
      message: 'When somebody asks to Keep Close, you can accept or decline here.',
      action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) },
    },
    outgoing: {
      title: 'No sent requests',
      message: 'Keep Close requests you send will appear here until they are answered.',
      action: { label: 'Start discovering', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) },
    },
    mutual: {
      title: 'No Kept Close members yet',
      message: 'Once a Keep Close request is approved, you can Whisper here.',
      action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) },
    },
  }[tab];

  return (
    <View {...swipe.panHandlers} style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={loadingList ? [] : list}
        key={`${columns}-${tab}`}
        numColumns={columns}
        keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={columns > 1 ? { gap } : undefined}
        contentContainerStyle={{ paddingTop: embedded ? insets.top + STRIP : insets.top, paddingHorizontal: gutter, paddingBottom: space.xxxl, gap: space.lg, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingTop: space.sm }}>
            {/* As a pane of Home the strip above already says which surface this
                is; printing a second title under it would name the same screen
                twice. */}
            {embedded ? null : (
              <View>
                <Txt variant="display" accessibilityRole="header">
                  Keep Close
                </Txt>
                <Txt variant="body" color="textSecondary" style={{ marginTop: 2 }}>
                  Your requests and approved Keep Close members.
                </Txt>
              </View>
            )}
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'incoming', label: 'Requests' },
                { value: 'outgoing', label: 'Sent' },
                { value: 'mutual', label: 'Kept Close' },
              ]}
            />
            {tab === 'incoming' && list.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                <Txt variant="small" color="textMuted" style={{ flex: 1 }}>
                  Only you can answer your Keep Close requests.
                </Txt>
              </View>
            ) : null}
            {loadingList ? (
              <View style={{ flexDirection: 'row', gap }}>
                {Array.from({ length: columns }).map((_, i) => (
                  <Skeleton key={i} style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.lg }} />
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ProfileTile profile={item} width={tileW} caption={caption(item)} onOpen={() => openProfile(item.id)} footer={footer(item)} />
        )}
        ListEmptyComponent={
          loadingList ? null : errorList ? (
            <ErrorState error={listError} message="Your Keep Close list didn’t load." onRetry={refresh} />
          ) : (
            <EmptyState icon="crush" title={empty.title} message={empty.message} action={empty.action} />
          )
        }
        ListFooterComponent={tab !== 'mutual' && requests.hasNextPage ? <Button title="Show more" variant="ghost" loading={requests.isFetchingNextPage} onPress={() => void requests.fetchNextPage()} /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching || requests.isRefetching} onRefresh={refresh} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
