import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BottomSheet } from './BottomSheet';
import { Avatar } from './Photo';
import { Txt } from './Txt';
import { Button } from './Button';
import { viewerPage } from '../api/service';
import type { Post } from '../api/types';
import { useProfileTap } from '../lib/useProfileTap';
import { formatCount } from '../lib/counts';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { MOMENT_REACTIONS } from '../lib/catalog';

/** The list endpoint is owner-authorized server-side; callers cannot opt in. */
export function ViewersSheet({ kind, id, visible, onClose, reactions = [] }: { kind: 'post' | 'moment'; id: number; visible: boolean; onClose: () => void; reactions?: {kind: string; userId: number; name: string}[] }) {
  const { colors } = useTheme();
  const openProfile = useProfileTap();
  const query = useInfiniteQuery({
    queryKey: ['private-viewers', kind, id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => viewerPage(kind, id, pageParam),
    getNextPageParam: (last, pages) => last.items.length === 100 ? pages.length * 100 : undefined,
    enabled: visible && id > 0,
    staleTime: 0,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <BottomSheet visible={visible} onClose={onClose} swipeToClose={kind === 'moment'} title={kind === 'moment' ? 'Moment activity' : 'Views'} subtitle="Only you can see who viewed this.">
      {kind === 'moment' ? <><Txt variant="bodyStrong">{typeof query.data?.pages[0]?.count === 'number' ? `${query.data.pages[0].count} views` : 'Views'}</Txt><Txt variant="bodyStrong" style={{ marginTop: space.md }}>Reactions</Txt>{reactions.length ? reactions.map((r, i) => <Txt key={`${r.userId}-${i}`}>{r.kind === 'crush' ? 'Crush' : MOMENT_REACTIONS.find(x => x.key === r.kind)?.emoji ?? r.kind} {r.name}</Txt>) : <Txt color="textSecondary">No reactions yet.</Txt>}<Txt variant="bodyStrong" style={{ marginTop: space.md }}>Viewers</Txt></> : null}
      {query.isLoading ? <ActivityIndicator color={colors.primary} /> : query.isError ? (
        <View style={{ gap: space.sm }}><Txt color="textSecondary">Couldn’t load viewers.</Txt><Button title="Try again" onPress={() => void query.refetch()} /></View>
      ) : items.length === 0 ? <Txt color="textSecondary">No views yet.</Txt> : (
        <View style={{ gap: space.sm }}>
          {items.map((item, index) => {
            const profile = item.profile;
            const row = <><Avatar uri={profile?.photos?.[0]?.url ?? null} name={profile?.name ?? 'Private member'} size={40} /><Txt variant="bodyStrong">{profile?.name ?? 'Private member'}</Txt></>;
            return profile ? <Pressable key={`${profile.id}-${index}`} accessibilityRole="button" accessibilityLabel={`Open ${profile.name}’s Space`} onPress={() => { onClose(); setTimeout(() => openProfile(profile.id), 250); }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}>{row}</Pressable>
              : <View key={`hidden-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}>{row}</View>;
          })}
          {query.hasNextPage ? <Button title="Show more" loading={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} /> : null}
        </View>
      )}
    </BottomSheet>
  );
}

/** Count only for other readers; the list control appears for the author. */
export function PostViews({ post, light = false }: { post: Post; light?: boolean }) {
  const [visible, setVisible] = useState(false);
  const { colors } = useTheme();
  if (post.viewCount == null) return null;
  const color = light ? '#FFFFFF' : colors.textSecondary;
  const contents = <><Ionicons name="eye-outline" size={16} color={color} /><Txt variant="caption" style={{ color }}>{formatCount(post.viewCount)} views</Txt></>;
  return <>
    {post.mine ? <Pressable accessibilityRole="button" accessibilityLabel={`${post.viewCount} views, see viewers`} onPress={() => setVisible(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 4 }}>{contents}</Pressable>
      : <View accessible accessibilityLabel={`${post.viewCount} views`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 4 }}>{contents}</View>}
    {post.mine ? <ViewersSheet kind="post" id={post.id} visible={visible} onClose={() => setVisible(false)} /> : null}
  </>;
}
