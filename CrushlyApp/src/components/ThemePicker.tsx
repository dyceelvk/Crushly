import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { CIRCLE_THEMES, resolveTheme, searchThemes, type CircleTheme } from '../lib/circleThemes';

/**
 * Choosing what kind of Circle this is.
 *
 * Thirty themes is too many to scroll past every time and too few to need a
 * fair fight, so the list has one search box over it: type "food" and the food
 * rooms stay. Nothing about the box is required — an empty box is the whole
 * list, in the order people gather.
 *
 * Underneath is the answer for whoever the list fails: their own words, with a
 * cover generated from them, so a self-written theme still looks like a room and
 * not like a shrug.
 *
 * Each theme's cover is drawn here from the theme itself — a pair of colours and
 * a glyph — which is what makes a Circle recognisable before it has a photograph.
 */
export function ThemePicker({
  value,
  onChange,
}: {
  /** The stored theme: a slug, or the owner's own words. */
  value: string | null;
  onChange: (theme: string | null) => void;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');

  const results = useMemo(() => searchThemes(query), [query]);
  const chosen = resolveTheme(value);
  // A stored theme that is not in the list is one somebody typed.
  const chosenIsCustom = !!chosen && !CIRCLE_THEMES.some((t) => t.slug === chosen.slug);

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="label" color="textSecondary">
          Theme
        </Txt>
        {chosen ? <Txt variant="caption" color="gold">{chosen.label}</Txt> : null}
      </View>

      {/* The search box. Sleek on purpose: one line, no chrome, the glyph for
          what it is doing. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          height: 40,
          borderRadius: 999,
          backgroundColor: colors.elevated,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Ionicons name="search" size={15} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Find a theme — food, football, owambe…"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          accessibilityLabel="Find a theme"
          style={{
            flex: 1,
            minWidth: 0,
            color: colors.text,
            fontSize: 13,
            paddingVertical: 0,
          }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear the search">
            <Ionicons name="close-circle" size={15} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal={false}
        style={{ maxHeight: 208 }}
        contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {results.map((t: CircleTheme) => (
          <ThemeTile
            key={t.slug}
            theme={t}
            selected={chosen?.slug === t.slug && !chosenIsCustom}
            onPress={() => onChange(chosen?.slug === t.slug && !chosenIsCustom ? null : t.slug)}
          />
        ))}
        {results.length === 0 ? (
          <Txt variant="small" color="textMuted" style={{ paddingVertical: space.sm }}>
            Nothing called that. Use the box below and it is yours.
          </Txt>
        ) : null}
      </ScrollView>

      {/* Their own words. */}
      <View style={{ gap: 6 }}>
        <Txt variant="caption" color="textMuted">
          Nothing here fits? Name it yourself.
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              height: 40,
              borderRadius: radius.sm,
              backgroundColor: colors.elevated,
              borderWidth: 1,
              borderColor: chosenIsCustom ? colors.gold : colors.border,
            }}
          >
            <Ionicons name="create-outline" size={15} color={colors.textMuted} />
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Your own theme"
              placeholderTextColor={colors.textMuted}
              maxLength={40}
              accessibilityLabel="Your own theme"
              style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 13, paddingVertical: 0 }}
            />
          </View>
          <Pressable
            onPress={() => onChange(custom.trim() ? custom.trim() : null)}
            disabled={!custom.trim()}
            accessibilityRole="button"
            accessibilityLabel="Use this theme"
            style={{
              paddingHorizontal: 14,
              height: 40,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: custom.trim() ? colors.goldSoft : colors.elevated,
              borderWidth: 1,
              borderColor: custom.trim() ? colors.goldLine : colors.border,
            }}
          >
            <Txt variant="smallStrong" color={custom.trim() ? 'gold' : 'textMuted'}>
              Use
            </Txt>
          </Pressable>
        </View>
        {chosenIsCustom && chosen ? (
          <Txt variant="caption" color="gold">
            {`Your theme: ${chosen.label}`}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/** One theme: its cover, its word. */
export function ThemeTile({
  theme,
  selected,
  onPress,
  size = 96,
}: {
  theme: CircleTheme;
  selected?: boolean;
  onPress?: () => void;
  size?: number;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={theme.label}
      style={{ width: size }}
    >
      <LinearGradient
        colors={theme.cover as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height: size * 0.62,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.gold : 'rgba(255,255,255,0.10)',
        }}
      >
        <Ionicons name={theme.icon as keyof typeof Ionicons.glyphMap} size={18} color="rgba(255,255,255,0.92)" />
        {selected ? (
          <View style={{ position: 'absolute', top: 5, right: 5, backgroundColor: colors.gold, borderRadius: 8, padding: 2 }}>
            <Ionicons name="checkmark" size={10} color={colors.onGold} />
          </View>
        ) : null}
      </LinearGradient>
      <Txt variant="caption" numberOfLines={1} color={selected ? 'gold' : 'textSecondary'} style={{ marginTop: 4 }}>
        {theme.label}
      </Txt>
    </Pressable>
  );
}
