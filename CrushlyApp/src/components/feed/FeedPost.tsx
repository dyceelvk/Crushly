import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from '../Txt';
import { Photo } from '../Photo';
import { EditedClip } from '../EditedClip';
import { FeedRail } from './FeedRail';
import { FeedCaption } from './FeedCaption';
import { useTheme } from '../../theme/ThemeProvider';
import { formatCount } from '../../lib/counts';
import type { Post } from '../../api/types';

/**
 * One post, filling one screen.
 *
 * The reference's rule, and the one thing that makes a feed like this feel
 * different from a list: **the media is fitted, never cropped**. A 16:9 clip on a
 * 19.5:9 phone gets bars, because cropping it to fill loses the subject — the
 * capture of the game clip shows exactly that, letterboxed, and the letterbox is
 * the design rather than a compromise.
 *
 * Everything else is laid over the media and never moves it: the rail, the
 * caption stack and the scrim are absolutely positioned children of a fixed-size
 * frame.
 */
export function FeedPost({
  post,
  height,
  active,
  bottomInset,
  circleName,
  following,
  onAuthor,
  onCircle,
  onFollow,
  onLike,
  onComment,
  onShare,
  onPick,
  onRepost,
  onSound,
}: {
  post: Post;
  height: number;
  active: boolean;
  bottomInset: number;
  circleName?: string | null;
  following?: boolean;
  onAuthor: () => void;
  onCircle?: () => void;
  onFollow?: () => void;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onPick: () => void;
  onRepost?: () => void;
  /** Only supplied when the post carries a sound — see FeedCaption. */
  onSound?: () => void;
}) {
  const { colors } = useTheme();
  const isClip = post.mediaKind === 'video' && !!post.mediaUrl;

  return (
    <View style={{ height, width: '100%', backgroundColor: colors.bg }}>
      {isClip ? (
        <EditedClip
          uri={post.mediaUrl as string}
          live={post.edit}
          autoPlay={active}
          loop
          fill
          // contain, not cover: see the note above.
          // 'fill' would crop; this stage fits the clip and paints the backdrop bars
          fit="fit"
          accessibilityLabel={post.body ? `Clip: ${post.body}` : 'A clip'}
          onDoubleTap={onLike}
        />
      ) : post.mediaKind === 'photo' && post.mediaUrl ? (
        <Pressable onPress={onLike} onLongPress={onLike} accessibilityRole="imagebutton" accessibilityLabel="Photo post, double tap to like" style={{ flex: 1 }}>
          <Photo uri={post.mediaUrl} fit="contain" style={{ width: '100%', height: '100%' }} alt={post.body} priority="high" />
        </Pressable>
      ) : (
        // A post with no media still gets a screen: the words are the content.
        // The gradient is the brand's, because an empty black rectangle reads as
        // a failed load.
        <Pressable onPress={onLike} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel="Text post">
          <LinearGradient
            colors={['#0A0E27', '#1B1035', '#2A0E2E']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 }}
          >
            <Txt
              style={{
                fontFamily: 'Fraunces_600SemiBold',
                fontSize: 26,
                lineHeight: 34,
                letterSpacing: -0.3,
                color: '#FFFFFF',
                textAlign: 'center',
              }}
            >
              {post.body}
            </Txt>
          </LinearGradient>
        </Pressable>
      )}

      {/* The scrim. Two stops, not one: the top has to hold white tabs over a
          bright clip and the bottom has to hold white captions over a bright one. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)']}
        locations={[0, 0.24, 0.55, 1]}
        style={{ position: 'absolute', inset: 0 }}
      />

      <FeedRail
        post={post}
        onAuthor={onAuthor}
        onPick={onPick}
        onRepost={onRepost}
        following={following}
        onFollow={onFollow}
      />

      {/* The row under the post: the three verbs that are about *this* post,
          where the thumb already is, and where they are legible over a bright
          clip because the scrim is between them and the media. The rail keeps
          the two that are about keeping and passing it on. */}
      <View
        style={{
          position: 'absolute',
          left: 12,
          right: 84,
          bottom: bottomInset + 96,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 26,
          zIndex: 11,
        }}
      >
        <Action
          icon={post.liked ? 'heart' : 'heart-outline'}
          tint={post.liked ? colors.crush : '#FFFFFF'}
          label={post.liked ? 'Take back your Crush' : 'Crush'}
          count={post.likeCount}
          onPress={onLike}
        />
        <Action
          icon="chatbubble-outline"
          label="Comment"
          count={post.commentCount}
          onPress={onComment}
        />
        <Action icon="paper-plane-outline" label="Share" onPress={onShare} />
      </View>

      <FeedCaption post={post} onAuthor={onAuthor} onCircle={onCircle} onSound={onSound} circleName={circleName} bottom={bottomInset} />
    </View>
  );
}

/**
 * One verb in the row under the post. Glyph, count, name — the same anatomy as
 * the rail's items so the two do not read as two different products.
 */
function Action({
  icon,
  label,
  count,
  tint = '#FFFFFF',
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count?: number;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count == null ? label : `${label}, ${count}`}
      hitSlop={10}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Ionicons name={icon} size={23} color={tint} />
      {count ? (
        <Txt style={{ fontSize: 12.5, color: '#FFFFFF', fontFamily: 'Manrope_600SemiBold' }}>{formatCount(count)}</Txt>
      ) : null}
    </Pressable>
  );
}
