import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Keep Close, seen from the other side.
 *
 * Keep Close is Hollop's follow: it says "this one, I want to keep seeing". A
 * follow that only exists inside one person's Space is a follow nobody can act
 * on, so wherever somebody's words appear in public they carry the mark — the
 * feed, a Circle, a comment, a Moment. Small enough to sit inside a byline, and
 * quiet enough that it is information rather than decoration.
 *
 * `compact` is for the places where the name already has a lot around it: the
 * mark alone, with the sentence left to the screen reader.
 */
export function KeepsYouChip({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Keeps you close"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: compact ? 0 : 6,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: compact ? 'transparent' : colors.goldSoft,
        borderWidth: compact ? 0 : 1,
        borderColor: colors.goldLine,
      }}
    >
      <Ionicons name="bookmark" size={10} color={colors.gold} />
      {compact ? null : (
        <Txt variant="caption" color="gold" style={{ fontSize: 9.5, lineHeight: 12 }}>
          Keeps you close
        </Txt>
      )}
    </View>
  );
}
