import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Photo, Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useMoments } from '../../api/hooks';
import type { Moment, MomentGroup } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { MOMENT_STYLES } from '../../lib/catalog';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList } from '../../navigation/types';

/** Preview of a Moment: the photo, or the styled text on its gradient. */
export function MomentPreview({ moment, style, textSize = 15, lines = 6 }: { moment?: Moment; style?: object; textSize?: number; lines?: number }) {
  if (!moment) return <View style={[{ backgroundColor: '#17171A' }, style]} />;
  if (moment.kind === 'photo') {
    return (
      <View style={[{ overflow: 'hidden' }, style]}>
        <Photo uri={moment.mediaUrl} style={{ width: '100%', height: '100%' }} />
        {moment.body ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <Txt variant="body" numberOfLines={lines} style={{ fontSize: textSize, color: '#FFF', lineHeight: textSize * 1.35 }}>
              {moment.body}
            </Txt>
          </View>
        ) : null}
      </View>
    );
  }
  const s = MOMENT_STYLES[moment.style] || MOMENT_STYLES.noir;
  return (
    <LinearGradient colors={s.colors} style={[{ padding: 14, justifyContent: 'center' }, style]}>
      <Txt variant="accent" color={s.ink} numberOfLines={lines} style={{ fontSize: textSize, lineHeight: textSize * 1.35 }}>
        {moment.body}
      </Txt>
    </LinearGradient>
  );
}

export function MomentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter, columns } = useLayout();
  const { data, isLoading, isError, error, refetch, isRefetching } = useMoments();

  const cols = columns + 1; // denser than profiles: 3 on phones, 4 on tablets
  const gap = 12;
  const tileW = (contentWidth - gutter * 2 - gap * (cols - 1)) / cols;
  const mine = data?.mine.moments ?? [];
  const connections = (data?.others ?? []).filter((g) => g.user.mutual);
  const nearby = (data?.others ?? []).filter((g) => !g.user.mutual);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.xxxl, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
      showsVerticalScrollIndicator={false}
    >
      <Txt variant="display" accessibilityRole="header">
        Moments
      </Txt>
      <Txt variant="body" color="textSecondary" style={{ marginTop: 2 }}>
        Little glimpses of life. Gone in 24 hours.
      </Txt>

      {/* Your Moment */}
      <Pressable
        onPress={() => (mine.length ? navigation.navigate('MomentViewer', { userId: data!.mine.user.id, mine: true }) : navigation.navigate('MomentComposer'))}
        accessibilityRole="button"
        accessibilityLabel={mine.length ? `Your Moment, ${mine.length} active. View` : 'Share your Moment'}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, padding: space.md, borderRadius: radius.xl,
          backgroundColor: colors.card, borderWidth: 1, borderColor: mine.length ? colors.goldLine : colors.border, opacity: pressed ? 0.85 : 1,
        })}
      >
        <View style={{ width: 64, height: 84, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
          {mine.length ? <MomentPreview moment={mine[mine.length - 1]} style={{ width: 64, height: 84 }} textSize={9} /> : <Avatar uri={data?.mine.user.photo} name={data?.mine.user.name} size={52} />}
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="subheading">Your Moment</Txt>
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            {mine.length
              ? `${mine.length} active · ${mine.reduce((n, m) => n + (m.viewCount || 0), 0)} views`
              : 'Share what you’re up to. It disappears in 24 hours.'}
          </Txt>
        </View>
        <Pressable
          onPress={() => navigation.navigate('MomentComposer')}
          accessibilityRole="button"
          accessibilityLabel="New Moment"
          hitSlop={8}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="add" size={24} color={colors.onGold} />
        </Pressable>
      </Pressable>

      {isLoading ? (
        <View style={{ flexDirection: 'row', gap, marginTop: space.xl }}>
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} style={{ width: tileW, height: tileW * 1.35, borderRadius: 26 }} />
          ))}
        </View>
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={refetch} />
      ) : !connections.length && !nearby.length ? (
        <EmptyState
          icon="aperture-outline"
          title="It’s quiet right now"
          message="No Moments nearby at the moment. Be the first — a Moment is a great way to get noticed."
          action={{ label: 'Share a Moment', onPress: () => navigation.navigate('MomentComposer') }}
        />
      ) : (
        <>
          {connections.length ? <Grid title="From your Connections" groups={connections} tileW={tileW} gap={gap} /> : null}
          {nearby.length ? <Grid title="Around you" groups={nearby} tileW={tileW} gap={gap} /> : null}
        </>
      )}
    </ScrollView>
  );
}

function Grid({ title, groups, tileW, gap }: { title: string; groups: MomentGroup[]; tileW: number; gap: number }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm }} accessibilityRole="header">
        {title}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {groups.map((g) => (
          <MomentTile key={g.user.id} group={g} width={tileW} />
        ))}
      </View>
    </View>
  );
}

/** Soft "pebble" tiles — rounded portrait shapes with a gold edge when there's something new. */
function MomentTile({ group, width }: { group: MomentGroup; width: number }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const latest = group.moments[group.moments.length - 1];
  const h = width * 1.35;
  return (
    <Pressable
      onPress={() => navigation.navigate('MomentViewer', { userId: group.user.id })}
      accessibilityRole="button"
      accessibilityLabel={`${group.user.name}'s Moment${group.moments.length > 1 ? `s, ${group.moments.length}` : ''}, ${timeAgo(latest.createdAt)} ago${group.hasUnseen ? ', new' : ''}`}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width, height: h, borderRadius: width * 0.3, padding: 2.5, borderWidth: 1.5, borderColor: group.hasUnseen ? colors.gold : colors.border }}>
        <View style={{ flex: 1, borderRadius: width * 0.3 - 3, overflow: 'hidden', backgroundColor: colors.card }}>
          <MomentPreview moment={latest} style={{ width: '100%', height: '100%', paddingBottom: latest.kind === 'text' ? Math.min(36, width * 0.3) + 14 : 0 }} textSize={Math.max(10, width / 10)} lines={4} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.65)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' }} />
          {group.moments.length > 1 ? (
            <View style={{ position: 'absolute', top: 10, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Txt variant="caption" color="#fff">
                {group.moments.length}
              </Txt>
            </View>
          ) : null}
          <View style={{ position: 'absolute', bottom: 10, left: 0, right: 0, alignItems: 'center' }}>
            <Avatar uri={group.user.photo} name={group.user.name} size={Math.min(36, width * 0.3)} ring={group.user.mutual ? 'crush' : null} />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6 }}>
        <Txt variant="smallStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {group.user.name}
        </Txt>
        {group.user.verified ? <VerifiedBadge size={12} /> : null}
      </View>
      <Txt variant="caption" color="textMuted" align="center">
        {timeAgo(latest.createdAt)}
      </Txt>
    </Pressable>
  );
}
