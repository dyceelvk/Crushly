import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../Txt';
import { Avatar } from '../Photo';
import { useTheme } from '../../theme/ThemeProvider';
import { haptic } from '../../lib/haptics';
import { formatCount, spokenCount } from '../../lib/counts';
import type { Post } from '../../api/types';

/**
 * The action rail down the right edge of a post.
 *
 * Measured from the reference: 58 dp wide, 10 dp from the screen edge, items
 * 15 dp apart, a 46 dp avatar with a 20 dp follow badge hanging off its bottom
 * edge, 34 dp glyphs, and an 11.5 dp count under each. The numbers are
 * abbreviated (`39.4K`), never raw — a five-digit number under a heart is noise.
 *
 * Only the bookmark changes colour when it is on. Everything else stays white so
 * the video keeps the eye.
 */
export function FeedRail({
  post,
  onAuthor,
  onLike,
  onComment,
  onSave,
  onShare,
  following,
  onFollow,
}: {
  post: Post;
  onAuthor: () => void;
  onLike: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  following?: boolean;
  onFollow?: () => void;
}) {
  const { colors } = useTheme();

  const item = (label: string, count: number | null, glyph: React.ReactNode, onPress: () => void) => (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={count == null ? label : `${label}, ${spokenCount(count, 'time')}`}
      hitSlop={10}
      style={{ alignItems: 'center', gap: 3 }}
    >
      {glyph}
      {count == null ? null : (
        <Txt
          variant="numeric"
          style={{
            fontSize: 11.5,
            color: '#FFFFFF',
            textShadowColor: 'rgba(0,0,0,0.55)',
            textShadowRadius: 4,
          }}
        >
          {formatCount(count)}
        </Txt>
      )}
    </Pressable>
  );

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: 10, bottom: 188, width: 58, alignItems: 'center', gap: 15, zIndex: 12 }}
    >
      <Pressable onPress={onAuthor} accessibilityRole="button" accessibilityLabel={`${post.author.name}, open profile`} hitSlop={8}>
        <Avatar uri={post.author.photos?.[0]?.url ?? null} name={post.author.name} size={46} />
        {onFollow && !following ? (
          <Pressable
            onPress={() => {
              haptic.tap();
              onFollow();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Follow ${post.author.name}`}
            hitSlop={8}
            style={{
              position: 'absolute',
              left: '50%',
              bottom: -9,
              marginLeft: -10,
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: colors.crush,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="add" size={14} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </Pressable>

      {item('Like', post.likeCount, (
        <Ionicons
          name={post.liked ? 'heart' : 'heart-outline'}
          size={34}
          color={post.liked ? colors.crush : '#FFFFFF'}
          style={{ opacity: post.liked ? 1 : 0.96 }}
        />
      ), onLike)}

      {item('Comment', post.commentCount, <Ionicons name="chatbubble-outline" size={31} color="#FFFFFF" />, onComment)}

      {item('Save', null, (
        <Ionicons name={post.saved ? 'bookmark' : 'bookmark-outline'} size={30} color={post.saved ? colors.gold : '#FFFFFF'} />
      ), onSave)}

      {item('Share', null, <Ionicons name="arrow-redo-outline" size={32} color="#FFFFFF" />, onShare)}

      {/* The sound disc: the reference spins the track under the action rail.
          Crushly has no sound object, so this is the author's mark — the same
          place in the anatomy, filled with the thing that exists. */}
      <Pressable onPress={onAuthor} accessibilityRole="button" accessibilityLabel={`More from ${post.author.name}`} hitSlop={8}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.16)',
          }}
        >
          <Avatar uri={post.author.photos?.[0]?.url ?? null} name={post.author.name} size={30} />
        </View>
      </Pressable>
    </View>
  );
}
