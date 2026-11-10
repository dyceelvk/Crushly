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
 * Two things live here, and they are the two that are not verbs about the post
 * itself: **Pick** keeps it (private, silent — the author is never told) and
 * **Repost** passes it on. Crush, Comment and Share are in the row under the
 * post, where they have been all along — the rail carried all five once, which
 * meant every one of those three existed twice on one screen, and the rail is
 * the last place a thumb reaches.
 *
 * Measured from the reference: 58 dp wide, 10 dp from the screen edge, items
 * 15 dp apart, a 46 dp avatar with a 20 dp follow badge hanging off its bottom
 * edge, 34 dp glyphs, and an 11.5 dp count under each.
 *
 * The author's face disc that used to sit at the bottom of the rail is gone: it
 * opened the author's Space, and the avatar at the top of the same rail already
 * does exactly that.
 */
export function FeedRail({
  post,
  onAuthor,
  onPick,
  onRepost,
  reposts,
  following,
  onFollow,
}: {
  post: Post;
  onAuthor: () => void;
  onPick: () => void;
  /** Absent until the reposts table exists — a button that does nothing is worse
   *  than a button that is not there. */
  onRepost?: () => void;
  reposts?: number;
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

      {item('Pick', null, (
        <Ionicons
          name={post.saved ? 'bookmark' : 'bookmark-outline'}
          size={30}
          color={post.saved ? colors.gold : '#FFFFFF'}
        />
      ), onPick)}

      {onRepost
        ? item('Repost', reposts ?? null, <Ionicons name="repeat-outline" size={32} color="#FFFFFF" />, onRepost)
        : null}
    </View>
  );
}
