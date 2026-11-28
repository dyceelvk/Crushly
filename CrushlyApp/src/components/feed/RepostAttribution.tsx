import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Post } from '../../api/types';
import { Txt } from '../Txt';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { repostAttribution } from '../../lib/repost';
import { RepostersSheet } from './RepostersSheet';

/**
 * The distribution label sits above the canonical post header. It names the
 * reposter without changing the post's author, timestamp or ownership.
 *
 * Tapping it lifts the list of everyone who reposted — not the last reposter's
 * Space. `onOpen` is accepted for the older call sites and deliberately not
 * used: the list answers "who?" and any name in it opens that person's Space.
 */
export function RepostAttribution({
  post,
  dark = false,
  onOpen,
}: {
  post: Pick<Post, 'id' | 'repostedBy'>;
  dark?: boolean;
  /** Legacy: ignored. The sheet is the answer now. */
  onOpen?: () => void;
}) {
  const { colors } = useTheme();
  const [listOpen, setListOpen] = useState(false);
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

  return (
    <>
      <Pressable
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${reposter.name} reposted. See everyone who reposted this`}
        hitSlop={6}
        style={({ pressed }) => ({ paddingHorizontal: space.sm, paddingTop: 7, alignSelf: 'flex-start', opacity: pressed ? 0.62 : 1 })}
      >
        {content}
      </Pressable>
      <RepostersSheet postId={post.id} visible={listOpen} onClose={() => setListOpen(false)} />
    </>
  );
}
