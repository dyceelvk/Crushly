import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { Avatar } from '../../components/Photo';
import { EmptyState } from '../../components/States';
import { BottomSheet } from '../../components/BottomSheet';
import { CommentsSheet } from '../../components/CommentsSheet';
import { useToast } from '../../components/Toast';
import { useDeletePost, useFlow, usePost, usePostSaved, useReactToPost, useSavePost } from '../../api/hooks';
import type { Post } from '../../api/types';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { setVideosPaused } from '../../lib/videoPlayback';
import { EditedClip } from '../../components/EditedClip';
import { EditedPhoto } from '../../components/EditedPhoto';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList, ScreenProps } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SWIPE_THRESHOLD = 60;

/**
 * Watching one post — full screen, immersive.
 *
 * Layout per user spec:
 *   Back button (top-left)  ·  Three dots (top-right)
 *   Profile row (left, below back button)
 *   Media (center, large)
 *   Action column (right side, lower): Like · Comment · Save
 *   Caption (bottom-left)
 */
export function PostViewerScreen({ route, navigation }: ScreenProps<'PostViewer'>) {
  const { postId } = route.params;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const toast = useToast();
  const nav = useNavigation<Nav>();

  const flow = useFlow();
  const postQuery = usePost(postId);
  const post = postQuery.data ?? flow.data?.items.find((p) => p.id === postId) ?? null;
  const like = useReactToPost();
  const remove = useDeletePost();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [threeDotsOpen, setThreeDotsOpen] = useState(false);
  const savedQuery = usePostSaved(postId);
  const save = useSavePost();
  // The answer from the database, falling back to whatever the feed row
  // already knew while the real question is in flight.
  const isSaved = savedQuery.data ?? post?.saved ?? false;

  // Share to Whisper: pick a connection to send this post to — never whisper
  // to yourself, so open your Close Ones list and let you choose.
  const shareToWhisper = () => {
    setThreeDotsOpen(false);
    nav.navigate('CloseOnes');
  };

  // When the viewer opens, pause every feed video so only this viewer plays.
  // When it closes, feed videos resume.
  useEffect(() => {
    setVideosPaused(true);
    return () => setVideosPaused(false);
  }, []);

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const resolveVideoUri = useCallback((mediaPath: string | null) => {
    if (!mediaPath) return '';
    const resolved = mediaSource(mediaUrl(mediaPath));
    return typeof resolved === 'string' ? resolved : resolved.uri;
  }, []);

  const toggleLike = useCallback(async () => {
    if (!post) return;
    try {
      if (like.isPending) return;
      await like.mutateAsync({ postId: post.id, liked: !post.liked });
    } catch (e) {
      toast({ kind: 'error', title: 'Like not sent', message: (e as Error).message });
    }
  }, [post, like, toast]);

  /**
   * Save is a row now, not a local flag. The icon moves on the tap, the write
   * goes out, and a failure puts the icon back and says so — the old version
   * told you "Post saved" whether or not anything was saved, then forgot it
   * the moment you closed the viewer.
   */
  const toggleSave = useCallback(async () => {
    if (!post) return;
    const next = !isSaved;
    try {
      const result = await save.mutateAsync({ postId: post.id, saved: next });
      const savedNow = result?.saved ?? next;
      toast({ kind: savedNow ? 'success' : 'info', title: savedNow ? 'Post saved' : 'Post unsaved' });
    } catch (e) {
      toast({ kind: 'error', title: next ? 'Not saved' : 'Still saved', message: (e as Error).message });
    }
  }, [post, isSaved, save, toast]);

  const deletePost = useCallback(async () => {
    if (!post) return;
    try {
      await remove.mutateAsync(post.id);
      toast({ kind: 'success', title: 'Post deleted' });
      close();
    } catch (e) {
      toast({ kind: 'error', title: 'Not deleted', message: (e as Error).message });
    }
  }, [post, remove, close, toast]);

  const openThreeDots = useCallback(() => {
    setThreeDotsOpen(true);
  }, []);

  // Vertical swipe down closes the viewer and returns to feed at scroll position.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > SWIPE_THRESHOLD,
      onPanResponderEnd: (_, gestureState) => {
        if (gestureState.dy > SWIPE_THRESHOLD) {
          close();
        }
      },
    }),
  ).current;

  if (!post) {
    const loading = (flow.isLoading || postQuery.isLoading) && postQuery.data === undefined;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.gold} />
          </View>
        ) : (
          <EmptyState
            icon="prism-outline"
            title="This post is gone"
            message="The post has been removed."
            action={{ label: 'Close', onPress: close }}
          />
        )}
      </View>
    );
  }

  const mediaUri = post.mediaUrl ? resolveVideoUri(post.mediaUrl) : '';
  const isVideo = post.mediaKind === 'video';
  const hasMedia = !!post.mediaUrl;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* PanResponder for vertical swipe — covers the whole screen. */}
      <View {...panResponder.panHandlers} style={{ flex: 1, backgroundColor: '#000' }}>

        {/* Top header — profile picture left, three dots right */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: space.xs,
            paddingTop: Math.max(insets.top, space.sm),
          }}
        >
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close post"
            hitSlop={20}
            style={{ padding: 10, marginRight: 2 }}
          >
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() =>
              post.mine
                ? nav.navigate('Main', { screen: 'Profile' })
                : nav.navigate('UserProfile', { id: post.author.id })
            }
            accessibilityRole="button"
            accessibilityLabel={post.mine ? 'Your Space' : `${authorName}’s Space`}
            hitSlop={20}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
          >
            <Avatar
              uri={post.author.photos[0]?.url ?? null}
              name={post.author.name}
              size={32}
              ring={post.author.verified ? 'gold' : undefined}
            />
            <View style={{ minWidth: 0 }}>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ color: '#fff' }}>
                {authorName}
              </Txt>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="More options"
            hitSlop={20}
            onPress={openThreeDots}
            style={{ padding: 10 }}
          >
            <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Media — always shrinks to fit the whole screen, nothing cut off.
            EditedClip measures the track and rebuilds the frame to its real
            ratio, so a portrait clip fills the phone instead of sitting in a
            letterbox, and a tap anywhere on it pauses it. */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {hasMedia && isVideo && mediaUri ? (
            <EditedClip
              uri={mediaUri}
              live={post.edit ?? null}
              style={{ width: '100%', height: '100%' }}
              autoPlay
              // A viewer opened on purpose is the one place a loop belongs:
              // it is the only clip on screen and the viewer asked for it.
              loop
              // Here the clip IS the screen, so the whole of it is the tap
              // target and the mark sits dead centre.
              controlPlacement="center"
              contentFit="contain"
            />
          ) : null}
          {hasMedia && !isVideo ? (
            <EditedPhoto
              uri={mediaUrl(post.mediaUrl)}
              live={post.edit ?? null}
              contentFit="contain"
              style={{ width: '100%', height: '100%' }}
              alt={`Post by ${authorName}`}
            />
          ) : null}

          {/* Text-only post fallback */}
          {!hasMedia && post.body ? (
            <View style={{ paddingHorizontal: space.xl, paddingTop: Math.max(insets.top, space.xl), gap: space.lg }}>
              <Txt variant="title" style={{ color: '#fff' }} numberOfLines={4}>
                {post.body}
              </Txt>
            </View>
          ) : null}
        </View>

        {/* Right-side action column — Like, Comment, Save (kept low and subtle) */}
        <View
          style={{
            position: 'absolute',
            right: space.sm,
            bottom: Math.max(insets.bottom, space.sm) + 240,
            gap: space.sm,
          }}
        >
          <Pressable
            onPress={toggleLike}
            accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Take back your crush' : 'Crush'}
            hitSlop={20}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: 'rgba(0,0,0,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={22} color={post.liked ? colors.crush : '#fff'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Comment, ${post.commentCount}`}
            hitSlop={20}
            onPress={() => setCommentsOpen(true)}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: 'rgba(0,0,0,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Ionicons name="chatbubble-outline" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={toggleSave}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Unsave post' : 'Save post'}
            hitSlop={20}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: isSaved ? colors.crush : 'rgba(0,0,0,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={22} color="#fff" />
          </Pressable>
        </View>

        {/* Reopening the thread after closing it. It sits bottom-right, on the
            caption line, so it never covers the middle of the clip — that tap
            belongs to pause. */}
        {!commentsOpen ? (
          <Pressable
            onPress={() => setCommentsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`View comments, ${post.commentCount}`}
            hitSlop={10}
            style={{
              position: 'absolute',
              right: space.sm,
              bottom: Math.max(insets.bottom, space.sm) + (post.body ? 56 : 8),
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 24,
              backgroundColor: 'rgba(0,0,0,0.55)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.22)',
            }}
          >
            <Ionicons name="chatbubble-outline" size={16} color="#fff" />
            <Txt variant="caption" style={{ color: '#fff', fontWeight: '600' }}>
              {post.commentCount > 0 ? `View ${post.commentCount} comments` : 'View comments'}
            </Txt>
          </Pressable>
        ) : null}

        {/* Caption — bottom-left */}
        {post.body ? (
          <View
            style={{
              position: 'absolute',
              bottom: Math.max(insets.bottom, space.sm) + 10,
              left: space.sm,
              right: space.sm,
              maxWidth: width - space.xl,
            }}
          >
            <Txt
              variant="body"
              style={{
                color: '#fff',
                fontSize: 16,
                lineHeight: 22,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 8,
                shadowOpacity: 0.95,
              }}
            >
              <LinkText text={post.body} bare />
            </Txt>
          </View>
        ) : null}
      </View>

      {/* One comments surface for the whole app — the same sheet the Flow
          opens, so a like or a reply behaves identically wherever it is done. */}
      <CommentsSheet
        postId={post.id}
        visible={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        commentCount={post.commentCount}
      />

      {/* Three dots action sheet: Share (whisper), Report, Delete (author only) */}
      <BottomSheet
        visible={threeDotsOpen}
        onClose={() => setThreeDotsOpen(false)}
        title="More"
        maxHeight={0.6}
      >
        <View style={{ gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            onPress={shareToWhisper}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md }}
          >
            <Ionicons name="share-social-outline" size={20} color={colors.crush} />
            <Txt variant="body" color="#000">
              Share to Whisper
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setThreeDotsOpen(false);
              toast({ kind: 'info', title: 'Report sent' });
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md }}
          >
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Txt variant="body" color="#000">
              Report post
            </Txt>
          </Pressable>
          {post.mine ? (
            <Pressable
              accessibilityRole="button"
              onPress={deletePost}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Txt variant="body" color="#000">
                Delete post
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}
