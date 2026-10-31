import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Photo } from '../../components/Photo';
import { VerifiedBadge, Pill } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { ProgressBar, LoadingBlock } from '../../components/States';
import { ListRow, Group } from '../../components/ListRow';
import { useLayout } from '../../components/Layout';
import { CrushlyMark } from '../../components/Logo';
import { PressableScale } from '../../components/PressableScale';
import { useCloseOnes, useCrushes, useMe, useMyCircles } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { elevation, radius, space, stroke } from '../../theme/tokens';
import { intentionLabel } from '../../lib/catalog';
import type { RootStackParamList } from '../../navigation/types';

/**
 * The Space tab.
 *
 * The old version stacked four full-width cards of equal weight — identity,
 * completion, verification, Plus — before the reader reached anything they had
 * made. That reads as a dashboard, and the photo the whole product is about was
 * a 116pt circle in the middle of an empty band.
 *
 * So: the Space leads with its own photo, the name and state sit on the photo,
 * the rest of the gallery is one rail away, and the chrome below it is a
 * hairline-count strip and two groups. Nothing is announced twice.
 */

/** One number in the strip under the gallery. */
function Count({ value, label, onPress, first }: { value?: number | string; label: string; onPress?: () => void; first?: boolean }) {
  const { colors } = useTheme();
  const body = (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: space.md,
        paddingHorizontal: 4,
        borderLeftWidth: first ? 0 : stroke.hairline,
        borderLeftColor: colors.border,
      }}
    >
      {/*
        Text in a flex cell does not shrink on its own — the labels here ran
        into each other ("CrushesCirclesClose Ones"). Constraining the text to
        the cell is what makes three columns three columns.
      */}
      <Txt variant="title" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ width: '100%', textAlign: 'center' }}>
        {value === undefined || value === null ? '—' : String(value)}
      </Txt>
      <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ width: '100%', textAlign: 'center', marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 0}`}
      containerStyle={{ flex: 1 }}
    >
      {body}
    </PressableScale>
  );
}

/** A small control that sits on a photo: dark glass, hairline, white text. */
function GlassChip({
  label,
  icon,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        backgroundColor: 'rgba(10,10,12,0.55)',
        borderWidth: stroke.hairline,
        borderColor: 'rgba(255,255,255,0.14)',
      }}
    >
      {icon ? <Ionicons name={icon} size={15} color="#FFFFFF" /> : null}
      <Txt variant="smallStrong" color="#FFFFFF">
        {label}
      </Txt>
    </Pressable>
  );
}

function Dot() {
  const { colors } = useTheme();
  return <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.5)' }} />;
}

export function ProfileTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { data: me, refetch, isRefetching } = useMe();
  const closeOnes = useCloseOnes();
  const circles = useMyCircles();
  const crushes = useCrushes();

  if (!me) return <LoadingBlock label="Loading your Space" />;
  const p = me.profile;
  const v = me.verification.status;
  const pct = me.completion.percent;
  const hero = p.photos[0]?.url ?? null;
  const gallery = p.photos.slice(1);
  const edit = () => navigation.navigate('EditProfile');
  const meta = [p.pronouns, p.city].filter(Boolean).join('  ·  ');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.sm,
        paddingHorizontal: gutter,
        paddingBottom: space.xxxl,
        width: '100%',
        maxWidth: contentWidth,
        alignSelf: 'center',
      }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="display" accessibilityRole="header">
          Space
        </Txt>
        <IconButton icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
      </View>

      {/*
        The hero. A photo the person chose, at the size the product is actually
        about, with their name on it rather than above it. Tapping it opens the
        photo editor, which is the thing most people come here to do.
      */}
      <PressableScale
        onPress={edit}
        pressedScale={0.99}
        accessibilityRole="button"
        accessibilityLabel={`${p.name}${p.age ? `, ${p.age}` : ''}. Change your photos`}
        containerStyle={{ marginTop: space.md }}
      >
        <View
          style={{
            borderRadius: radius.xl,
            overflow: 'hidden',
            backgroundColor: colors.card,
            borderWidth: stroke.hairline,
            borderColor: colors.border,
            ...elevation.soft,
          }}
        >
          {hero ? (
            <Photo uri={hero} aspectRatio={4 / 5} maxHeight={400} alt={`${p.name}'s main photo`} priority="high" />
          ) : (
            <View style={{ height: 320, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
              <Ionicons name="camera-outline" size={30} color={colors.textMuted} />
              <Txt variant="small" color="textMuted">
                Add your first photo
              </Txt>
            </View>
          )}

          <LinearGradient
            colors={colors.photoScrim}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' }}
          />

          {/*
            A word, not a glyph. A bare pencil on a photo is ambiguous at 17pt
            and reads as a scratch; "Edit" says what the tap does and survives a
            light photo behind it.
          */}
          {/*
            Words, not glyphs. A bare pencil on a photo is ambiguous at 17pt and
            renders as a scratch; "Moment" and "Edit" say what the tap does and
            survive a light photo behind them. Both are the same control, so they
            are the same construction.
          */}
          <View style={{ position: 'absolute', top: space.sm, right: space.sm, flexDirection: 'row', gap: 6 }}>
            <GlassChip icon="add" label="Moment" accessibilityLabel="New Moment" onPress={() => navigation.navigate('MomentComposer')} />
            <GlassChip label="Edit" accessibilityLabel="Edit Space" onPress={edit} />
          </View>

          <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt variant="title" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>
                {p.name}
                {p.age ? `, ${p.age}` : ''}
              </Txt>
              {v === 'verified' ? <VerifiedBadge size={20} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              {p.username ? (
                <Txt variant="smallStrong" color="#FFFFFF">
                  {`@${p.username}`}
                </Txt>
              ) : null}
              {p.username && meta ? <Dot /> : null}
              {meta ? (
                <Txt variant="small" color="rgba(255,255,255,0.78)" numberOfLines={1}>
                  {meta}
                </Txt>
              ) : null}
            </View>
            {me.status === 'paused' || p.intentions.length ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm, flexWrap: 'wrap' }}>
                {me.status === 'paused' ? <Pill tone="glass" label="Hidden from Discover" /> : null}
                {p.intentions.slice(0, 2).map((i) => (
                  <Pill key={i} tone="glass" label={intentionLabel(i)} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </PressableScale>

      {/*
        The rest of the gallery. Six slots is the product's shape, so the rail
        shows the photos that exist and one empty tile that says how many are
        left — the emptiness is the prompt, so no separate banner is needed.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: space.sm }}
        contentContainerStyle={{ gap: space.xs, paddingRight: gutter }}
      >
        {gallery.map((photo) => (
          <Pressable key={photo.id} onPress={edit} accessibilityRole="button" accessibilityLabel="Change your photos">
            <Photo uri={photo.url} style={{ width: 78, height: 98, borderRadius: radius.md }} priority="low" />
          </Pressable>
        ))}
        {p.photos.length < 6 ? (
          <PressableScale
            onPress={edit}
            pressedScale={0.96}
            accessibilityRole="button"
            accessibilityLabel={p.photos.length < 2 ? 'Add a photo' : 'Add another photo'}
          >
            <View
              style={{
                width: 78,
                height: 98,
                borderRadius: radius.md,
                borderWidth: stroke.hairline,
                borderStyle: 'dashed',
                borderColor: colors.borderStrong,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <Ionicons name="add" size={20} color={colors.textSecondary} />
              <Txt variant="caption" color="textMuted">
                {6 - p.photos.length} left
              </Txt>
            </View>
          </PressableScale>
        ) : null}
      </ScrollView>

      {/*
        Completion, as one line and one bar. The old card listed the missing
        fields by name and pushed everything below it off the first screen — for
        a number that is already on the bar.
      */}
      {pct < 100 ? (
        <PressableScale
          onPress={edit}
          pressedScale={0.99}
          accessibilityRole="button"
          accessibilityLabel={`Space ${pct} percent complete. Finish setting it up`}
          containerStyle={{ marginTop: space.md }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radius.md,
              borderWidth: stroke.hairline,
              borderColor: colors.border,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
              <Txt variant="smallStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {`Space ${pct}% complete`}
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Txt variant="smallStrong" color="gold">
                  {me.completion.missing.length ? `Add ${me.completion.missing[0]}` : 'Finish'}
                </Txt>
                <Ionicons name="chevron-forward" size={14} color={colors.gold} />
              </View>
            </View>
            <ProgressBar value={pct / 100} style={{ marginTop: space.xs }} label={`Space ${pct}% complete`} />
          </View>
        </PressableScale>
      ) : null}

      {/*
        The numbers, as a strip rather than a list of rows that repeat what the
        numbers already say. Each one is the shortcut to its own screen.
      */}
      <View
        style={{
          flexDirection: 'row',
          marginTop: space.lg,
          borderTopWidth: stroke.hairline,
          borderBottomWidth: stroke.hairline,
          borderColor: colors.border,
        }}
      >
        <Count
          first
          value={crushes.data?.incoming.length}
          label={crushes.data?.incoming.length === 1 ? 'Crush' : 'Crushes'}
          onPress={() => navigation.navigate('Main', { screen: 'Crushes' })}
        />
        <Count value={circles.data?.items.length} label={circles.data?.items.length === 1 ? 'Circle' : 'Circles'} onPress={() => navigation.navigate('Circles')} />
        <Count
          value={closeOnes.data?.items.length}
          label="Close Ones"
          onPress={() => navigation.navigate('CloseOnes')}
        />
      </View>

      {/*
        Two rows, not two banners. Plus is a product, not an announcement, and
        verification is a state — a gradient card each made the page shout at
        someone who just wanted to look at their own photos.
      */}
      <Group title="Stand out" style={{ marginTop: space.xl }}>
        {v !== 'verified' ? (
          <ListRow
            title={v === 'pending' ? 'Verification in review' : v === 'rejected' ? 'Verification needs another try' : 'Get verified'}
            subtitle={v === 'pending' ? 'We’ll let you know as soon as it’s done.' : 'Make your Space more trustworthy.'}
            icon="shield-checkmark-outline"
            iconTone={v === 'pending' ? 'neutral' : 'gold'}
            onPress={() => navigation.navigate('Verification')}
          />
        ) : null}
        <ListRow
          title="Crushly Plus"
          subtitle={me.plus.interested ? 'You’re on the early access list.' : 'More Big Crushes, Incognito, and travel mode.'}
          leading={<CrushlyMark size={36} />}
          onPress={() => navigation.navigate('Plus', {})}
          last
        />
      </Group>

      <Group title="Your space">
        <ListRow title="Discover preferences" icon="options-outline" onPress={() => navigation.navigate('Filters')} />
        <ListRow title="Privacy" icon="eye-off-outline" onPress={() => navigation.navigate('Privacy')} />
        <ListRow title="Safety center" icon="shield-outline" iconTone="success" onPress={() => navigation.navigate('Safety')} />
        <ListRow title="Crush Alerts" icon="notifications-outline" onPress={() => navigation.navigate('Notifications')} />
        <ListRow title="Settings" icon="settings-outline" onPress={() => navigation.navigate('Settings')} last />
      </Group>
    </ScrollView>
  );
}
