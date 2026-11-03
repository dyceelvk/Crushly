import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar, Photo } from '../../components/Photo';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useSoundPage } from '../../api/hooks';
import { formatCount } from '../../lib/counts';
import { fonts, palettes, radius, space } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';
import type { Post } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * A sound: who it belongs to, how much is under it, and the clips themselves.
 *
 * The feed has been labelling clips "original sound — <name>" since the
 * redesign, and until now that label was a sentence with nowhere to go. This is
 * where it goes.
 *
 * Two actions, both real:
 *
 *   Use this sound   opens the composer with this sound already attached, and
 *                    the clip lands on this page when it is posted.
 *   the grid         opens the clip. Tapping a tile is not a new surface; it is
 *                    the same post, seen through the sound.
 *
 * The page is noir whatever the app's appearance is, because a grid of clips is
 * a wall of images and a white wall makes every one of them look framed.
 */
export function SoundScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Sound'>>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const noir = palettes.dark;

  const soundId = route.params?.soundId ?? null;
  const query = useSoundPage(soundId);
  const sound = query.data?.sound;
  const items: Post[] = query.data?.items ?? [];

  // Two columns with a hairline gutter — the same rhythm the search grid uses,
  // so the app's grids read as one idea rather than three.
  const gutter = 2;
  const tile = (Math.min(width, 720) - gutter) / 2;

  const me = sound?.owner;

  const openPost = useCallback(
    (post: Post) => navigation.navigate('PostViewer', { postId: post.id }),
    [navigation],
  );

  const useSound = useCallback(() => {
    if (!sound) return;
    navigation.navigate('CreatePost', {
      type: 'flow',
      soundId: sound.id,
      soundLabel: `${sound.title} — ${sound.owner.name}`,
    });
  }, [navigation, sound]);

  const head = useMemo(
    () => (
      <View style={{ paddingTop: insets.top + 6 }}>
        {/* ------------------------------------------------------------ bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 }}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            style={{ padding: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={noir.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => (sound ? navigation.navigate('UserProfile', { id: sound.owner.id }) : undefined)}
            disabled={!sound}
            accessibilityRole="button"
            accessibilityLabel="Open the owner's Space"
            hitSlop={10}
            style={{ padding: 8 }}
          >
            <Ionicons name="person-outline" size={22} color={noir.text} />
          </Pressable>
        </View>

        {/* --------------------------------------------------------- the sound */}
        {query.isLoading ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Skeleton style={{ height: 96, borderRadius: 20 }} />
            <Skeleton style={{ height: 44, borderRadius: 22 }} />
          </View>
        ) : sound ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar uri={me?.photos?.[0]?.url} name={me?.name ?? 'Sound'} size={76} ring="muted" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt
                  accessibilityRole="header"
                  style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.6, color: noir.text }}
                  numberOfLines={2}
                >
                  {sound.title}
                </Txt>
                <Pressable
                  onPress={() => navigation.navigate('UserProfile', { id: sound.owner.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${sound.owner.name}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                >
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: noir.textSecondary }} numberOfLines={1}>
                    {sound.owner.name}
                  </Txt>
                  <Ionicons name="chevron-forward" size={13} color={noir.textMuted} />
                </Pressable>
                <Txt style={{ fontSize: 12.5, color: noir.textMuted, marginTop: 2 }}>
                  {sound.postCount === 1 ? '1 post' : `${formatCount(sound.postCount)} posts`}
                </Txt>
              </View>
            </View>

            <Pressable
              onPress={useSound}
              accessibilityRole="button"
              accessibilityLabel="Use this sound"
              style={{
                marginTop: space.lg,
                height: 46,
                borderRadius: 23,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: noir.crush,
              }}
            >
              <Txt style={{ fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' }}>Use this sound</Txt>
            </Pressable>
          </View>
        ) : null}
      </View>
    ),
    [insets.top, me, navigation, noir, query.isLoading, sound, useSound],
  );

  if (query.error) {
    return (
      <View style={{ flex: 1, backgroundColor: noir.bg, paddingTop: insets.top }}>
        <ErrorState error={query.error} message="That sound didn’t load." onRetry={() => void query.refetch()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: noir.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }} showsVerticalScrollIndicator={false}>
        {head}

        {!query.isLoading && items.length === 0 ? (
          <EmptyState
            title="Nothing on this sound yet"
            message="Be the first to post under it."
            action={{ label: 'Use this sound', onPress: useSound }}
          />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gutter }}>
            {items.map((post) => (
              <Pressable
                key={post.id}
                onPress={() => openPost(post)}
                accessibilityRole="button"
                accessibilityLabel={post.body ? `Post: ${post.body.slice(0, 40)}` : 'A clip on this sound'}
                style={{ width: tile, height: tile * 1.25, backgroundColor: noir.card, borderRadius: radius.xs, overflow: 'hidden' }}
              >
                {post.mediaUrl ? (
                  <Photo
                    uri={post.mediaUrl}
                    fit="cover"
                    style={{ width: '100%', height: '100%' }}
                    alt={post.body ? post.body.slice(0, 60) : 'A clip on this sound'}
                  />
                ) : (
                  <View style={{ flex: 1, padding: 12, justifyContent: 'flex-end' }}>
                    <Txt numberOfLines={5} style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: noir.text }}>
                      {post.body}
                    </Txt>
                  </View>
                )}

                {/* Views are not shown here because we do not have a per-post
                    view count that is honest to show; the play triangle and the
                    count we do have (reactions) are. */}
                <View style={{ position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Ionicons name="heart" size={13} color="#FFFFFF" />
                  <Txt style={{ fontFamily: fonts.bold, fontSize: 12, color: '#FFFFFF' }}>{formatCount(post.likeCount ?? 0)}</Txt>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
