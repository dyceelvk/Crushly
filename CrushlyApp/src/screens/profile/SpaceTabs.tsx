import React, { useMemo } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Txt } from '../../components/Txt';
import { Photo } from '../../components/Photo';
import { EditedClip } from '../../components/EditedClip';
import { EditedPhoto } from '../../components/EditedPhoto';
import { EmptyState, Skeleton } from '../../components/States';
import { useSpacePosts, useSpaceVibes } from '../../api/hooks';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { FullProfile, MomentSummary, Post, Vibe } from '../../api/types';

/**
 * The tabs on a Space: Flows, Vibes, Moments.
 *
 * A Space is a person, and until now it showed everything about them except
 * the things they had shared. These three tabs are that. Each one is fed by a
 * server function that applies the same visibility rule the main feed applies
 * — `space_posts` leans on `can_view_post`, `space_vibes` on `can_view_vibe` —
 * so a post or clip that is hidden everywhere else cannot surface here.
 *
 * They are rendered inside the Space's existing ScrollView rather than as a
 * `TabView`, because nesting a vertical list inside a vertical scroll is how
 * you get a scroll that fights itself. A fixed-height window with its own
 * `scrollEnabled` is the cheaper arrangement and it does not need a gesture
 * library the project deliberately does not have.
 */

export type SpaceTab = 'flows' | 'vibes' | 'moments';

export const SPACE_TABS: { value: SpaceTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'flows', label: 'Flows', icon: 'chatbubbles-outline' },
  { value: 'vibes', label: 'Vibes', icon: 'play-circle-outline' },
  { value: 'moments', label: 'Moments', icon: 'aperture-outline' },
];

/** Clips need a real height. See the note in Flow.tsx — this is the same bug. */
const MEDIA_W = 200;
const MEDIA_H = 260;

export function SpaceTabs({
  userId,
  profile,
  tab,
  onChange,
  onOpenPost,
  onOpenVibes,
  onOpenMoments,
  windowHeight,
}: {
  userId: number;
  profile: FullProfile;
  tab: SpaceTab;
  onChange: (t: SpaceTab) => void;
  onOpenPost: (postId: number) => void;
  onOpenVibes: (vibeId?: number) => void;
  onOpenMoments: () => void;
  windowHeight: number;
}) {
  const { colors } = useTheme();
  const posts = useSpacePosts(userId);
  const vibes = useSpaceVibes(userId);

  // Only Moments the viewer is allowed to open. `load_profile` already
  // filtered them, so this is a type question, not a permission one.
  const moments = useMemo(() => profile.moments ?? [], [profile.moments]);

  const counts: Record<SpaceTab, number | null> = {
    flows: posts.data ? posts.data.length : null,
    vibes: vibes.data ? vibes.data.length : null,
    moments: moments.length,
  };

  return (
    <View style={{ marginTop: space.xl }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          gap: 4,
          backgroundColor: colors.card,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 4,
        }}
      >
        {SPACE_TABS.map((t) => {
          const active = t.value === tab;
          const n = counts[t.value];
          return (
            <Pressable
              key={t.value}
              onPress={() => onChange(t.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${t.label}${n ? `, ${n}` : ''}`}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 9,
                borderRadius: radius.pill,
                backgroundColor: active ? colors.primarySoft : 'transparent',
                borderWidth: active ? 1 : 0,
                borderColor: colors.primaryLine,
              }}
            >
              <Ionicons name={t.icon} size={15} color={active ? colors.primary : colors.textMuted} />
              <Txt variant="smallStrong" color={active ? 'primary' : 'textMuted'}>
                {t.label}
              </Txt>
              {n ? (
                <Txt variant="caption" color={active ? 'primary' : 'textMuted'}>
                  {n}
                </Txt>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: windowHeight, marginTop: space.md }}>
        {tab === 'flows' ? (
          <FlatList
            data={posts.data ?? []}
            keyExtractor={(p) => String(p.id)}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.md }}
            renderItem={({ item }) => <FlowTile post={item} onPress={() => onOpenPost(item.id)} />}
            ListEmptyComponent={
              posts.isLoading ? (
                <Skeleton style={{ height: 120 }} />
              ) : (
                <EmptyState
                  icon="chatbubbles-outline"
                  title="No Flows yet"
                  message={`${profile.name.split(' ')[0]} hasn’t shared a post you can see.`}
                />
              )
            }
          />
        ) : tab === 'vibes' ? (
          <FlatList
            data={vibes.data ?? []}
            keyExtractor={(v) => String(v.id)}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.md }}
            renderItem={({ item }) => <VibeTile vibe={item} onPress={() => onOpenVibes(item.id)} />}
            ListEmptyComponent={
              vibes.isLoading ? (
                <Skeleton style={{ height: 120 }} />
              ) : (
                <EmptyState
                  icon="play-circle-outline"
                  title="No Vibes right now"
                  message="Vibes only last two weeks, so this empties and refills."
                />
              )
            }
          />
        ) : (
          <FlatList
            data={moments}
            keyExtractor={(m) => String(m.id)}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.md }}
            renderItem={({ item }) => <MomentTile moment={item} onPress={onOpenMoments} />}
            ListEmptyComponent={
              profile.hasMoment ? (
                <Skeleton style={{ height: 120 }} />
              ) : (
                <EmptyState
                  icon="aperture-outline"
                  title="No Moments live"
                  message="A Moment is gone after twenty-four hours. Nothing here right now."
                />
              )
            }
          />
        )}
      </View>
    </View>
  );
}

/** One Flow in the Space grid: the words, and the picture if there is one. */
function FlowTile({ post, onPress }: { post: Post; onPress: () => void }) {
  const { colors } = useTheme();
  const isVideo = post.mediaKind === 'video';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={post.body || (isVideo ? 'A clip' : 'A photo')}
      style={{
        flexDirection: 'row',
        gap: space.md,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        marginBottom: space.sm,
      }}
    >
      {post.mediaUrl ? (
        <View style={{ width: 92, height: 92, backgroundColor: '#000' }}>
          {isVideo ? (
            <EditedClip
              uri={videoUri(post.mediaUrl)}
              live={post.edit ?? null}
              // Thumbnails do not autoplay: nine clips starting at once in a
              // grid is a wall of noise, and it is exactly what the viewer did
              // not ask for by opening a profile.
              contentFit="cover"
              controls={false}
              loop
              style={{ width: 92, height: 92 }}
            />
          ) : (
            <EditedPhoto
              uri={post.mediaUrl}
              live={post.edit ?? null}
              contentFit="cover"
              style={{ width: 92, height: 92 }}
            />
          )}
        </View>
      ) : null}
      <View style={{ flex: 1, paddingVertical: space.md, paddingRight: space.md, justifyContent: 'center', gap: 3 }}>
        <Txt variant="body" numberOfLines={3} style={{ lineHeight: 21 }}>
          {post.body || (isVideo ? 'A clip' : 'A photo')}
        </Txt>
        <Txt variant="caption" color="textMuted">
          {[
            timeAgo(post.createdAt),
            post.audience === 'circle' ? 'in a Circle' : post.audience === 'everyone' ? 'Everyone' : 'Connections',
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Txt>
      </View>
      {isVideo ? <Ionicons name="play" size={14} color={colors.textMuted} style={{ alignSelf: 'center', marginRight: space.md }} /> : null}
    </Pressable>
  );
}

/** One Vibe: its cover, or its first frame if there is no cover. */
function VibeTile({ vibe, onPress }: { vibe: Vibe; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={vibe.body || 'A Vibe'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: space.sm,
        marginBottom: space.sm,
      }}
    >
      <View style={{ width: 56, height: 56, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' }}>
        {vibe.coverUrl ? (
          <Photo uri={vibe.coverUrl} style={{ width: 56, height: 56 }} fit="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={18} color="#fff" />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {vibe.body || 'A Vibe'}
        </Txt>
        <Txt variant="caption" color="textMuted">
          {timeAgo(vibe.createdAt)} · {daysLeft(vibe.expiresAt)}
        </Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

/** One Moment in the Space: its frame, and what is written on it. */
function MomentTile({ moment, onPress }: { moment: MomentSummary; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={moment.body || 'A Moment'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: space.sm,
        marginBottom: space.sm,
      }}
    >
      <View style={{ width: 56, height: 56, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.elevated }}>
        {moment.mediaUrl ? (
          moment.kind === 'video' ? (
            <EditedClip
              uri={videoUri(moment.mediaUrl)}
              live={moment.edit ?? null}
              contentFit="cover"
              controls={false}
              loop
              style={{ width: 56, height: 56 }}
            />
          ) : (
            <Photo uri={moment.mediaUrl} style={{ width: 56, height: 56 }} fit="cover" />
          )
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="text" size={20} color={colors.textMuted} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {moment.body || (moment.kind === 'text' ? 'A thought' : 'A Moment')}
        </Txt>
        <Txt variant="caption" color="textMuted">
          {timeAgo(moment.createdAt)}
        </Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

/** Expo's players want a plain URI; the media Worker wraps it in an object. */
function videoUri(path: string): string {
  const resolved = mediaSource(mediaUrl(path));
  return typeof resolved === 'string' ? resolved : resolved.uri;
}

function daysLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'gone';
  const d = Math.ceil(ms / 86_400_000);
  return d <= 1 ? 'gone tomorrow' : `${d} days left`;
}
