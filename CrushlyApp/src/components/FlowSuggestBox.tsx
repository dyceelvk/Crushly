import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, space } from '../theme/tokens';
import { useFlowSuggestions } from '../api/hooks';
import type { RootStackParamList } from '../navigation/types';

/**
 * The box line above the videos: what people are actually talking about.
 *
 * It slideshows through relatable search terms drawn from the week's posts and
 * comments — the same words the algorithm is ranking with — so the feed is not
 * only ordered by what is working, it says out loud what is working. One tap
 * takes the term into Search.
 */
export function FlowSuggestBox() {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const terms = useFlowSuggestions();
  const [index, setIndex] = useState(0);
  const slide = useRef(new Animated.Value(1)).current;

  const list = terms.map((t) => t.term).filter(Boolean);
  const current = list[index % Math.max(list.length, 1)];

  /* Every 3.8 seconds the box slides to the next term — a slideshow in a line,
     not a marquee; nothing moves while the list is empty. */
  useEffect(() => {
    if (list.length < 2) return;
    const id = setInterval(() => {
      Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        setIndex((i) => i + 1);
        slide.setValue(1);
      });
    }, 3800);
    return () => clearInterval(id);
  }, [list.length, slide]);

  if (!current) return null;

  return (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: space.sm }}>
      <Pressable
        onPress={() => navigation.navigate('Search', { q: current })}
        accessibilityRole="button"
        accessibilityLabel={`Search for ${current}`}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 38,
          paddingHorizontal: 12,
          borderRadius: radius.lg,
          backgroundColor: colors.elevated,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
          overflow: 'hidden',
        })}
      >
        <Ionicons name="search" size={15} color={colors.textMuted} />
        <Animated.View style={{ transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }], opacity: slide, flexShrink: 1 }}>
          <Txt numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.text }}>
            {current}
          </Txt>
        </Animated.View>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Search')}
        accessibilityRole="button"
        accessibilityLabel="Open Search"
        style={({ pressed }) => ({
          width: 38,
          height: 38,
          borderRadius: radius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.elevated,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Ionicons name="search-circle-outline" size={19} color={colors.text} />
      </Pressable>
    </View>
  );
}
