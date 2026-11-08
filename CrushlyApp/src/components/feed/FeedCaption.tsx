import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../Txt';
import { VerifiedBadge } from '../Badges';
import { useTheme } from '../../theme/ThemeProvider';
import { timeAgo } from '../../lib/format';
import type { Post } from '../../api/types';

/**
 * Author, caption and provenance, bottom-left over the video.
 *
 * Measured from the reference: 16 dp from the left, right edge stopping 96 dp
 * from the screen edge so the action rail never sits on a word, author 15 dp
 * extra-bold, caption 13/18 clamped to three lines, and a provenance chip above
 * the author — in TikTok that chip says which template made the clip; here it
 * says which Circle the post was written into, which is the same question
 * ("where did this come from") answered with something Hollop actually has.
 */
export function FeedCaption({
  post,
  onAuthor,
  onCircle,
  onSound,
  circleName,
  bottom,
}: {
  post: Post;
  onAuthor: () => void;
  onCircle?: () => void;
  /** Opens the sound page. Only given when the post actually has a sound. */
  onSound?: () => void;
  circleName?: string | null;
  bottom: number;
}) {
  const { colors } = useTheme();
  /**
   * What the clip is under. The database names the sound now (`post_engagement`
   * carries it), so this reads the row instead of asserting one: a clip with
   * somebody else's sound on it says their name, not its author's.
   */
  const soundLabel = post.sound ? `${post.sound.title} — ${post.author.name}` : `original sound — ${post.author.name}`;

  const hashtags = post.body.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const words = hashtags.length
    ? post.body.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim()
    : post.body.trim();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 96, bottom, zIndex: 11 }}
    >
      {circleName ? (
        <Pressable
          onPress={onCircle}
          accessibilityRole="button"
          accessibilityLabel={`Posted in the Circle ${circleName}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            alignSelf: 'flex-start',
            backgroundColor: 'rgba(255,255,255,0.94)',
            borderRadius: 9,
            paddingHorizontal: 10,
            paddingVertical: 6,
            marginBottom: 12,
          }}
        >
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              backgroundColor: '#111',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="people" size={10} color="#FFF" />
          </View>
          <Txt style={{ fontSize: 12.5, color: '#111', fontFamily: 'Manrope_700Bold' }} numberOfLines={1}>
            In your Circle · {circleName}
          </Txt>
        </Pressable>
      ) : null}

      <Pressable onPress={onAuthor} accessibilityRole="button" accessibilityLabel={`${post.author.name}, open profile`} hitSlop={6}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Txt
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontFamily: 'Manrope_800ExtraBold',
              color: '#FFFFFF',
              textShadowColor: 'rgba(0,0,0,0.55)',
              textShadowRadius: 8,
            }}
          >
            {post.author.name}
          </Txt>
          {post.author.verified ? <VerifiedBadge tier={post.author.badgeTier} size={14} /> : null}
          <Txt
            style={{
              fontSize: 11.5,
              color: 'rgba(255,255,255,0.72)',
              textShadowColor: 'rgba(0,0,0,0.55)',
              textShadowRadius: 6,
            }}
          >
            · {timeAgo(post.createdAt)}
          </Txt>
        </View>
      </Pressable>

      {words ? (
        <Txt
          numberOfLines={3}
          style={{
            fontSize: 13,
            lineHeight: 18,
            color: '#FFFFFF',
            marginTop: 4,
            textShadowColor: 'rgba(0,0,0,0.6)',
            textShadowRadius: 8,
          }}
        >
          {words}
        </Txt>
      ) : null}

      {hashtags.length ? (
        <Txt
          numberOfLines={1}
          style={{
            fontSize: 13,
            lineHeight: 18,
            color: colors.gold,
            marginTop: 2,
            textShadowColor: 'rgba(0,0,0,0.6)',
            textShadowRadius: 8,
          }}
        >
          {hashtags.join(' ')}
        </Txt>
      ) : null}

      <Pressable
        onPress={onSound}
        disabled={!onSound}
        accessibilityRole={onSound ? 'button' : undefined}
        accessibilityLabel={onSound ? `Sound: ${soundLabel}` : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }}
      >
        <Ionicons name="musical-notes" size={13} color="#FFFFFF" />
        <Txt
          numberOfLines={1}
          style={{
            fontSize: 12.5,
            color: '#FFFFFF',
            textShadowColor: 'rgba(0,0,0,0.6)',
            textShadowRadius: 6,
          }}
        >
          {soundLabel}
        </Txt>
        {onSound ? <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.7)" /> : null}
      </Pressable>
    </View>
  );
}
