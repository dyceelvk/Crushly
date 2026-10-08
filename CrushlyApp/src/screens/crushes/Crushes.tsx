import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../../components/Txt';
import { Segmented } from '../../components/Segmented';
import { ProfileTile } from '../../components/ProfileCard';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useCrushes, useMarkNotificationsRead, useOpenConversation, usePass } from '../../api/hooks';
import type { Profile } from '../../api/types';
import { useCrushFlow } from '../discover/Discover';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgoLong } from '../../lib/format';
import type { RootStackParamList, TabParamList } from '../../navigation/types';

type Tab = 'incoming' | 'outgoing' | 'mutual';

export function CrushesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<TabParamList, 'Crushes'>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { contentWidth, gutter, columns } = useLayout();
  const { data, isLoading, isError, error, refetch, isRefetching } = useCrushes();
  const [tab, setTab] = useState<Tab>(route.params?.tab || 'incoming');
  const { run: crushOn, pendingId } = useCrushFlow();
  const pass = usePass();
  const open = useOpenConversation();
  const markRead = useMarkNotificationsRead();

  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]);

  // Visiting Crushes clears the crush badge.
  useFocusEffect(
    React.useCallback(() => {
      markRead.mutate({ kinds: ['crush', 'deep_crush', 'mutual'] });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const list = data ? data[tab] : [];
  const gap = 12;
  const tileW = (contentWidth - gutter * 2 - gap * (columns - 1)) / columns;

  const message = async (p: Profile) => {
    try {
      const conv = await open.mutateAsync(p.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open chat', message: (e as Error).message });
    }
  };

  const footer = (p: Profile) => {
    if (tab === 'incoming') {
      return (
        <View style={{ marginTop: 8, gap: 8 }}>
          {p.crush.note ? (
            <View style={{ backgroundColor: colors.goldSoft, borderRadius: radius.sm, padding: 10 }}>
              <Txt variant="small" numberOfLines={3} accessibilityLabel={`Note from ${p.name}: ${p.crush.note}`}>
                “{p.crush.note}”
              </Txt>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton icon="close" label={`Pass on ${p.name}`} size={40} onPress={() => pass.mutate(p.id, { onSuccess: () => refetch() })} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Button title="Crush back" size="sm" variant="crush" loading={pendingId === p.id} onPress={() => crushOn(p)} />
            </View>
          </View>
        </View>
      );
    }
    if (tab === 'mutual') {
      return (
        <View style={{ marginTop: 8 }}>
          <Button title="Message" size="sm" variant="secondary" icon="chatbubble-outline" onPress={() => message(p)} />
        </View>
      );
    }
    return null;
  };

  const caption = (p: Profile) => {
    if (tab === 'incoming') return p.crush.receivedDeep ? `Deep Crush · ${p.at ? timeAgoLong(p.at) : ''}` : `Crushed on you · ${p.at ? timeAgoLong(p.at) : ''}`;
    if (tab === 'outgoing') return p.at ? `You crushed · ${timeAgoLong(p.at)}` : 'You crushed';
    return p.at ? `Mutual · ${timeAgoLong(p.at)}` : 'Mutual Crush';
  };

  const empty = {
    incoming: {
      title: 'No crushes yet.',
      message: 'Your next Crush could be around the corner. A complete profile and a fresh Moment help you get noticed.',
      action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) },
    },
    outgoing: {
      title: 'Nobody’s caught your eye — yet',
      message: 'When you Crush on someone, they’ll wait here until the feeling is mutual.',
      action: { label: 'Start discovering', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) },
    },
    mutual: {
      title: 'Your Mutual Crushes live here',
      message: 'When you both feel it, you’ll find each other here — ready to say hello.',
      action: { label: 'Discover people', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) },
    },
  }[tab];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={isLoading ? [] : list}
        key={`${columns}-${tab}`}
        numColumns={columns}
        keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={columns > 1 ? { gap } : undefined}
        contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: gutter, paddingBottom: space.xxxl, gap: space.lg, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingTop: space.sm }}>
            <View>
              <Txt variant="display" accessibilityRole="header">
                Your Crushes
              </Txt>
              <Txt variant="body" color="textSecondary" style={{ marginTop: 2 }}>
                Who’s crushing on you, and who you’re crushing on.
              </Txt>
            </View>
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'incoming', label: 'Crushing on you', count: data?.incoming.length },
                { value: 'outgoing', label: 'Your crushes', count: data?.outgoing.length },
                { value: 'mutual', label: 'Mutual', count: data?.mutual.length },
              ]}
            />
            {tab === 'incoming' && data?.incoming.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                <Txt variant="small" color="textMuted" style={{ flex: 1 }}>
                  Only you can see who’s crushing on you. Crush back to make it mutual.
                </Txt>
              </View>
            ) : null}
            {isLoading ? (
              <View style={{ flexDirection: 'row', gap }}>
                {Array.from({ length: columns }).map((_, i) => (
                  <Skeleton key={i} style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.lg }} />
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ProfileTile profile={item} width={tileW} caption={caption(item)} onOpen={() => navigation.navigate('UserProfile', { id: item.id })} footer={footer(item)} />
        )}
        ListEmptyComponent={
          isLoading ? null : isError ? (
            <ErrorState message={(error as Error)?.message} onRetry={refetch} />
          ) : (
            <EmptyState icon="crush" title={empty.title} message={empty.message} action={empty.action} />
          )
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
