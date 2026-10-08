import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Platform, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../components/Txt';
import { IconButton } from '../../components/IconButton';
import { PressableScale } from '../../components/PressableScale';
import { FeatureCard, ProfileTile } from '../../components/ProfileCard';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { BottomSheet } from '../../components/BottomSheet';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { keys, useBadges, useCrush, useDiscover, useMe, usePass } from '../../api/hooks';
import type { Profile } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { distanceLabel } from '../../lib/catalog';
import type { RootStackParamList } from '../../navigation/types';
import { celebrated } from '../crushes/MutualCrush';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function useCrushFlow() {
  const navigation = useNavigation<Nav>();
  const crush = useCrush();
  const toast = useToast();
  const run = useCallback(
    async (p: Pick<Profile, 'id' | 'name' | 'photos'>, opts: { deep?: boolean; note?: string } = {}) => {
      try {
        const res = await crush.mutateAsync({ id: p.id, ...opts });
        if (res.mutual && res.isNew) {
          celebrated.add(p.id);
          navigation.navigate('MutualCrush', { userId: p.id, name: p.name, photo: p.photos[0]?.url });
        } else {
          toast({
            kind: 'crush',
            title: opts.deep ? `Deep Crush sent to ${p.name}` : `You crushed on ${p.name}`,
            message: opts.deep ? 'You’ll stand out at the top of their Crushes.' : 'If it’s mutual, you’ll be the first to know.',
            avatar: p.photos[0]?.url ?? null,
          });
        }
        return res;
      } catch (e) {
        toast({ kind: 'error', title: 'Crush not sent', message: (e as Error).message });
        return null;
      }
    },
    [crush, navigation, toast],
  );
  return { run, pendingId: crush.isPending ? crush.variables?.id : undefined };
}

export function DiscoverScreen() {
  const navigation = useNavigation<Nav>();
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter, columns } = useLayout();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch, isRefetching } = useDiscover();
  const { data: me } = useMe();
  const { data: badges } = useBadges(true);
  const pass = usePass();
  const { run: crushOn, pendingId } = useCrushFlow();
  const { openActions } = useMemberActions();
  const [deepFor, setDeepFor] = useState<Profile | null>(null);
  const [note, setNote] = useState('');

  const items = useMemo(() => data?.items ?? [], [data]);
  const feature = items[0];
  const rest = items.slice(1);

  // Fresh discoveries arrive automatically as the current batch runs low.
  useEffect(() => {
    if (data && items.length < 4 && data.total > items.length && !isRefetching) refetch();
  }, [data, items.length, isRefetching, refetch]);

  // Gentle cross-fade when the spotlight changes.
  const enter = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!feature || reduceMotion) return;
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 280, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [feature?.id, enter, reduceMotion, feature]);

  const gap = 12;
  const tileW = (contentWidth - gutter * 2 - gap * (columns - 1)) / columns;
  const prefs = me?.preferences;
  const filtersActive = !!prefs && (prefs.intentions.length > 0 || prefs.interests.length > 0 || prefs.verifiedOnly);

  const onPass = (p: Profile) => {
    pass.mutate(p.id, {
      onError: (e) => toast({ kind: 'error', title: 'Couldn’t skip', message: (e as Error).message }),
    });
  };

  const openDeep = (p: Profile) => {
    if (me && me.plus.deepCrushesLeft <= 0) {
      toast({ kind: 'info', title: 'No Deep Crushes left today', message: 'They refresh tomorrow. A regular Crush still says plenty.' });
      return;
    }
    setNote('');
    setDeepFor(p);
  };

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: space.sm }}>
        <View style={{ flex: 1 }}>
          <Txt variant="display" accessibilityRole="header">
            Discover
          </Txt>
          <Txt variant="body" color="textSecondary" style={{ marginTop: 2 }}>
            Find someone worth knowing.
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton icon="notifications-outline" label={`Notifications${badges?.notifications ? `, ${badges.notifications} unread` : ''}`} badge={!!badges?.notifications} onPress={() => navigation.navigate('Notifications')} />
          <IconButton icon="options-outline" label={`Filters${filtersActive ? ', active' : ''}`} badge={filtersActive} onPress={() => navigation.navigate('Filters')} />
        </View>
      </View>

      <PressableScale
        onPress={() => navigation.navigate('Filters')}
        accessibilityLabel={`Discovery area: near you, ${prefs ? distanceLabel(prefs.maxDistance) : ''}. Change filters`}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: space.md, marginBottom: space.lg,
          backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold }} />
        <Txt variant="smallStrong">Near you</Txt>
        <Txt variant="small" color="textMuted" numberOfLines={1}>
          {[me?.profile.city, prefs ? distanceLabel(prefs.maxDistance).toLowerCase() : null].filter(Boolean).join(' · ')}
        </Txt>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </PressableScale>

      {data && !data.viewerHasLocation ? (
        <PressableScale
          onPress={() => navigation.navigate('EditProfile')}
          accessibilityLabel="Add your approximate location to see distances"
          style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 14, borderRadius: radius.md, backgroundColor: colors.goldSoft, marginBottom: space.lg }}
        >
          <Ionicons name="navigate-outline" size={18} color={colors.gold} />
          <Txt variant="small" style={{ flex: 1 }}>
            Add your approximate location to see who’s nearby. Your exact spot is never shared.
          </Txt>
          <Ionicons name="chevron-forward" size={16} color={colors.gold} />
        </PressableScale>
      ) : null}

      {feature ? (
        <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <FeatureCard
            profile={feature}
            onOpen={() => navigation.navigate('UserProfile', { id: feature.id })}
            onCrush={() => crushOn(feature)}
            onPass={() => onPass(feature)}
            onDeepCrush={() => openDeep(feature)}
            onMore={() => openActions({ id: feature.id, name: feature.name, age: feature.age, context: 'discover' }, [
              { label: 'View full profile', icon: <Ionicons name="person-outline" size={20} color={colors.textSecondary} />, onPress: () => navigation.navigate('UserProfile', { id: feature.id }) },
            ])}
            crushing={pendingId === feature.id}
            deepLeft={me?.plus.deepCrushesLeft}
          />
        </Animated.View>
      ) : null}

      {rest.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.xxl, marginBottom: space.md }}>
          <Txt variant="title" accessibilityRole="header">
            More discoveries
          </Txt>
          <Txt variant="small" color="textMuted">
            {Math.max(0, (data?.total ?? 0) - 1)} nearby
          </Txt>
        </View>
      ) : null}
    </View>
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingHorizontal: gutter }}>
        <View style={{ width: '100%', maxWidth: contentWidth - gutter * 2, alignSelf: 'center' }} accessibilityLabel="Loading discoveries" accessibilityRole="progressbar">
          <Skeleton style={{ height: 34, width: 170, marginTop: space.md }} />
          <Skeleton style={{ height: 16, width: 220, marginTop: 10 }} />
          <Skeleton style={{ height: 34, width: 200, marginTop: space.md, borderRadius: 999 }} />
          <Skeleton style={{ height: 460, borderRadius: radius.xl, marginTop: space.lg }} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rest}
        key={columns}
        numColumns={columns}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={columns > 1 ? { gap } : undefined}
        contentContainerStyle={{
          paddingTop: insets.top, paddingHorizontal: gutter, paddingBottom: space.xxxl, gap, width: '100%', maxWidth: contentWidth, alignSelf: 'center',
        }}
        renderItem={({ item }) => (
          <ProfileTile
            profile={item}
            width={tileW}
            onOpen={() => navigation.navigate('UserProfile', { id: item.id })}
            onCrush={() => crushOn(item)}
          />
        )}
        ListEmptyComponent={
          isError ? (
            <ErrorState message={(error as Error)?.message} onRetry={refetch} />
          ) : !feature ? (
            <EmptyState
              icon="compass-outline"
              title="You’ve seen everyone nearby"
              message={
                filtersActive || (prefs && prefs.maxDistance > 0 && prefs.maxDistance < 100)
                  ? 'Widen your distance or relax a filter to meet more people.'
                  : 'New members join every day. Check back soon, or share a Moment while you wait.'
              }
              action={{ label: 'Adjust filters', onPress: () => navigation.navigate('Filters') }}
              secondary={{ label: 'Share a Moment', onPress: () => navigation.navigate('MomentComposer') }}
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => qc.invalidateQueries({ queryKey: keys.discover })}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressViewOffset={insets.top}
          />
        }
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      <BottomSheet
        visible={!!deepFor}
        onClose={() => setDeepFor(null)}
        title={`Deep Crush ${deepFor?.name ?? ''}`}
        subtitle="Stand out with a note. Deep Crushes appear at the top of their Crushes."
        footer={
          <Button
            title="Send Deep Crush"
            icon="sparkles"
            variant="primary"
            onPress={async () => {
              const p = deepFor;
              if (!p) return;
              setDeepFor(null);
              await crushOn(p, { deep: true, note: note.trim() || undefined });
            }}
          />
        }
      >
        <Input value={note} onChangeText={setNote} placeholder={`Say why ${deepFor?.name ?? 'they'} caught your eye…`} multiline maxLength={140} showCount accessibilityLabel="Deep Crush note" />
        <Txt variant="small" color="textMuted" style={{ marginTop: space.sm }}>
          {me ? `${me.plus.deepCrushesLeft} of ${me.plus.deepCrushesPerDay} Deep Crushes left today.` : ''}
        </Txt>
      </BottomSheet>
    </View>
  );
}
