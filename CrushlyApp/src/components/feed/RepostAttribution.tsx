import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Post } from '../../api/types';
import { Txt } from '../Txt';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { repostAttribution } from '../../lib/repost';

/**
 * The distribution label sits above the canonical post header. It names the
 * reposter without changing the post's author, timestamp or ownership.
 */
export function RepostAttribution({
  post,
  onOpen,
  dark = false,
}: {
  post: Pick<Post, 'repostedBy'>;
  onOpen?: () => void;
  dark?: boolean;
}) {
  const { colors } = useTheme();
  const reposter = post.repostedBy;
  if (!reposter) return null;

  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 22 }}>
      <Ionicons name="repeat-outline" size={13} color={dark ? 'rgba(255,255,255,0.78)' : colors.textMuted} />
      <Txt variant="caption" color={dark ? 'rgba(255,255,255,0.82)' : 'textMuted'} numberOfLines={1}>
        {repostAttribution(reposter.name)}
      </Txt>
    </View>
  );

  if (!onOpen) {
    return <View style={{ paddingHorizontal: space.sm, paddingTop: 7 }}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${reposter.name} reposted. Open ${reposter.name}’s Space`}
      hitSlop={6}
      style={({ pressed }) => ({ paddingHorizontal: space.sm, paddingTop: 7, opacity: pressed ? 0.62 : 1 })}
    >
      {content}
    </Pressable>
  );
}
