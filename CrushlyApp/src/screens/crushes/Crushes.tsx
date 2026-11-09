import { useSwipeTabs } from '../../components/SwipeTabs';
import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Segmented } from '../../components/Segmented';
import { ProfileTile } from '../../components/ProfileCard';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Button } from '../../components/Button';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useKeepClose, useKeepRequests, useMe, useOpenConversation } from '../../api/hooks';
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
  const [tab, setTab] = useState<Tab>(initial ?? route.params?.tab ?? 'incoming');
  const swipe = useSwipeTabs({ options: ['incoming', 'outgoing', 'mutual'] as Tab[], value: tab, onChange: setTab, width: contentWidth });
  const { data: me } = useMe();
  const requests = useKeepRequests(me?.id ?? 0, tab, true);
  const open = useOpenConversation();
  const keepBack = useKeepClose();

  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);

  const list = requests.data?.pages.flatMap((page) => page.items) ?? [];
  const loadingList = requests.isLoading;
  const errorList = requests.isError;
  const listError = requests.error;
  const refresh = () => { void requests.refetch(); };
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

  const footer = (p: Profile) => (
    <View style={{ marginTop: 8, gap: 8 }}>
      {p.canKeepBack ? (
        <Button title="Keep Close back" size="sm" variant="crush" accessibilityLabel={`Keep ${p.name} Close back`}
          disabled={keepBack.isPending} onPress={() => keepBack.mutate(p.id, {
            onSuccess: () => toast({ kind: 'success', title: 'You’re Close Ones' }),
            onError: (e) => toast({ kind: 'error', title: 'Couldn’t Keep Close', message: (e as Error).message }),
          })} />
      ) : null}
      {!p.limitedSpace ? <Button title="Whisper" size="sm" variant="secondary" icon="chatbubble-outline" onPress={() => message(p)} /> : null}
    </View>
  );

  const caption = (p: Profile) => {
    const label = tab === 'incoming' ? 'Keeps you Close' : tab === 'outgoing' ? 'You Keep Close' : 'Mutually Kept Close';
    return p.at ? `${label} · ${timeAgoLong(p.at)}` : label;
  };
  const empty = {
    incoming: { title: 'Nobody has Kept you Close yet', message: 'People who Keep you Close appear here.', action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) } },
    outgoing: { title: 'Nobody Kept Close yet', message: 'Choose Keep Close on someone’s Space.', action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) } },
    mutual: { title: 'No mutual Keep Close yet', message: 'People who Keep each other Close appear here.', action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) } },
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
                  People who Keep you Close, the people you Keep Close, and mutuals.
                </Txt>
              </View>
            )}
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'incoming', label: 'Kept you' },
                { value: 'outgoing', label: 'Keeping' },
                { value: 'mutual', label: 'Mutual' },
              ]}
            />
            {loadingList ? (
              <View style={{ flexDirection: 'row', gap }}>
                {Array.from({ length: columns }).map((_, i) => (
                  <Skeleton key={i} style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.lg }} />
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => item.limitedSpace ? (
          <View style={{ width: tileW }}>
            <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 6 }}>
              <Txt variant="subheading">{item.name}</Txt>
              <Txt variant="small" color="textSecondary">Keeps you Close. Their Space is private until you’re Close Ones.</Txt>
            </View>
            {footer(item)}
          </View>
        ) : (
          <ProfileTile profile={item} width={tileW} caption={caption(item)} onOpen={() => openProfile(item.id)} footer={footer(item)} />
        )}
        ListEmptyComponent={
          loadingList ? null : errorList ? (
            <ErrorState error={listError} message="Your Keep Close list didn’t load." onRetry={refresh} />
          ) : (
            <EmptyState icon="crush" title={empty.title} message={empty.message} action={empty.action} />
          )
        }
        ListFooterComponent={requests.hasNextPage ? <Button title="Show more" variant="ghost" loading={requests.isFetchingNextPage} onPress={() => void requests.fetchNextPage()} /> : null}
        refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={refresh} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
