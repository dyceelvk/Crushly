import { FollowButton } from '../FollowButton';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../Txt';
import { Avatar } from '../Photo';
import { VerifiedBadge } from '../Badges';
import { EditedClip } from '../EditedClip';
import { CommentsSheet } from './CommentsSheet';
import { ReactionButton } from './Reactions';
import { ShareToWhisper } from '../ShareToWhisper';
import { useReactToPost } from '../../api/hooks';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { timeAgo } from '../../lib/format';
import { useTrackPostView } from '../../lib/useTrackPostView';
import { PostViews } from '../ViewersSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { Post } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';

/**
 * A clip in Crushes, with nothing between the reader and the picture.
 *
 * The feed used to draw every post the same way: avatar, name, words, then a
 * photograph in a box, then a row of actions under it. That is the right shape
 * for a post you *read*. It is the wrong shape for a clip, where the clip is the
 * post — the card's own background, its cover and its margins were all eating
 * screen that the video should have had.
 *
 * So a clip gets the whole card: the video is the surface, the person and their
 * words sit on it, and the small controls drawn over the picture are the ones a
 * thumb reaches for — Crush, comment, share, and sound. No cover image, no frame, and the scrim
 * is only under the words, low enough that the middle of the picture stays
 * clean.
 *
 * Other actions such as picking and the full post are available in Flow: tapping the
 * picture opens the post, where the full rail lives.
 */
export function CrushClipCard({ post, active }: { post: Post; active: boolean }) {
  useTrackPostView(post.id, active, post.mine);
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const react = useReactToPost();
  const authorName = post.author.name;

  const open = () => navigation.navigate('PostViewer', { postId: post.id });

  return (
    <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Open ${authorName}’s clip in Flow`}
        style={{ width: '100%' }}
      >
        <EditedClip
          /* Private file behind the media Worker: the header is what makes it
             play at all. */
          uri={mediaSource(mediaUrl(post.mediaUrl))}
          live={post.edit ?? null}
          autoPlay={active && !commentsOpen && !shareOpen}
          loop
          muted={muted}
          controls={false}
          fallbackRatio={0.8}
          maxHeight={560}
          accessibilityLabel={`Clip by ${authorName}`}
          cornerControl={
            <Pressable
              onPress={(event) => { event.stopPropagation(); setMuted(value => !value); }}
              accessibilityRole="button"
              accessibilityLabel={muted ? `Unmute ${authorName}’s clip` : `Mute ${authorName}’s clip`}
              accessibilityState={{ selected: !muted }}
              style={({ pressed }) => ({ position: 'absolute', right: 10, bottom: 10, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,12,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', opacity: pressed ? 0.75 : 1 })}
            >
              <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#FFFFFF" />
            </Pressable>
          }
        />
      </Pressable>

      {/* Words and controls over the bottom of the picture, and nowhere else. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(7,7,8,0)', 'rgba(7,7,8,0.62)', 'rgba(7,7,8,0.92)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 148 }}
        />
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm, paddingTop: space.xl }} pointerEvents="box-none">
          <Pressable
            onPress={() => navigation.navigate('UserProfile', { id: post.author.id })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${authorName}’s Space`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
          >
            <Avatar
              uri={post.author.photos[0]?.url ?? null}
              name={authorName}
              size={30}
              ring={post.author.verified ? 'gold' : undefined}
            />
            <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt variant="bodyStrong" numberOfLines={1} color="#FFFFFF">
                {authorName}
              </Txt>
              <VerifiedBadge size={12} tier={post.author.badgeTier ?? (post.author.verified ? 'verified' : 'none')} />
              <Txt variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1}>
                · {timeAgo(post.createdAt)}
              </Txt>
            </View>
          </Pressable>

          {!post.mine && post.audience === 'everyone' ? <View style={{alignSelf:'flex-start',marginTop:6}}><FollowButton id={post.author.id} name={post.author.name} compact /></View> : null}
          <PostViews post={post} light />
          {post.body ? (
            <Txt variant="body" numberOfLines={2} color="#FFFFFF" style={{ marginTop: 6 }}>
              {post.body}
            </Txt>
          ) : null}

          <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm }}>
            {/* Same control as Flow: the holUpp mark at rest, filled once you
                have crushed, and a hold that floats the seven faces. It was a
                heart here, which is the one shape the owner has rejected. */}
            <ReactionButton
              myReaction={post.myReaction ?? (post.liked ? 'crush' : null)}
              count={post.likeCount}
              size={22}
              onDark
              onReact={(kind) => react.mutate({ postId: post.id, liked: kind !== null, kind: kind ?? (post.myReaction ?? 'crush') })}
            />
            <Pressable
              onPress={() => setCommentsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Comments"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              hitSlop={8}
            >
              <Ionicons name="chatbubble-outline" size={21} color="#FFFFFF" />
              <Txt variant="bodyStrong" color="#FFFFFF">
                {post.commentCount}
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => setShareOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Share this post"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              hitSlop={8}
            >
              <Ionicons name="arrow-redo-outline" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </View>

      <CommentsSheet post={post} visible={commentsOpen} onClose={() => setCommentsOpen(false)} />
      <ShareToWhisper visible={shareOpen} post={post} onClose={() => setShareOpen(false)} />
    </View>
  );
}
