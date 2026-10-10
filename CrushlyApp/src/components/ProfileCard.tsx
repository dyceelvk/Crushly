import React, { memo } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Profile } from '../api/types';
import { Photo, OnlineDot } from './Photo';
import { Txt } from './Txt';
import { VerifiedBadge, Pill } from './Badges';
import { Chip, ChipGroup } from './Chip';
import { CrushButton } from './CrushButton';
import { IconButton } from './IconButton';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { intentionLabel } from '../lib/catalog';

export function NameLine({ profile, size = 'lg', light }: { profile: Pick<Profile, 'name' | 'age' | 'verified'>; size?: 'lg' | 'md' | 'sm'; light?: boolean }) {
  const variant = size === 'lg' ? 'display' : size === 'md' ? 'heading' : 'bodyStrong';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
      <Txt variant={variant} color={light ? '#FFFFFF' : 'text'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {profile.name}
        {profile.age ? <Txt variant={variant} color={light ? 'rgba(255,255,255,0.86)' : 'textSecondary'} style={{ fontFamily: size === 'lg' ? undefined : undefined }}>{`, ${profile.age}`}</Txt> : null}
      </Txt>
      {profile.verified ? <VerifiedBadge size={size === 'lg' ? 22 : size === 'md' ? 18 : 15} /> : null}
    </View>
  );
}

function metaLine(p: Profile) {
  return [p.distance, p.city].filter(Boolean).join('  ·  ');
}

type FeatureProps = {
  profile: Profile;
  onOpen: () => void;
  onCrush: () => void;
  onPass: () => void;
  onDeepCrush: () => void;
  onMore: () => void;
  crushing?: boolean;
  deepLeft?: number;
};

/**
 * Discover's spotlight card: a large editorial photo with a calm information
 * panel and the three decisions — Pass, Crush, Deep Crush.
 */
export const FeatureCard = memo(function FeatureCard({ profile, onOpen, onCrush, onPass, onDeepCrush, onMore, crushing, deepLeft }: FeatureProps) {
  const { colors } = useTheme();
  const { height, width } = useWindowDimensions();
  const photoHeight = Math.min(Math.max(height * 0.52, 340), 560, width * 1.25);
  const p = profile;

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${p.name}'s Space`} accessibilityHint="Shows photos, interests and more">
        <View style={{ height: photoHeight }}>
          <Photo uri={p.photos[0]?.url} style={{ width: '100%', height: '100%' }} alt={`Photo of ${p.name}`} priority="high" />
          <LinearGradient colors={colors.photoScrim} locations={[0.45, 0.72, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' }} />
          <View style={{ position: 'absolute', top: space.md, left: space.md, right: space.md, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {p.online ? <Pill tone="glass" label="Online now" icon={<OnlineDot size={8} style={{ borderWidth: 0 }} />} /> : p.activity ? <Pill tone="glass" label={p.activity} /> : null}
            {p.crush.received ? <Pill tone="glass" label={p.crush.receivedDeep ? 'Big Crush on you' : 'Crushing on you'} icon={<Ionicons name="heart" size={11} color={colors.crush} />} /> : null}
            <View style={{ flex: 1 }} />
            <IconButton icon="ellipsis-horizontal" variant="glass" size={40} label={`More options for ${p.name}`} onPress={onMore} />
          </View>
          {p.photos.length > 1 ? (
            <View style={{ position: 'absolute', top: 64, left: space.md, flexDirection: 'row', gap: 4 }} accessibilityElementsHidden>
              {p.photos.slice(0, 6).map((ph, i) => (
                <View key={ph.id} style={{ width: i === 0 ? 18 : 6, height: 4, borderRadius: 2, backgroundColor: i === 0 ? '#fff' : 'rgba(255,255,255,0.45)' }} />
              ))}
            </View>
          ) : null}
          <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg }}>
            <NameLine profile={p} light />
            {metaLine(p) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.8)" />
                <Txt variant="small" color="rgba(255,255,255,0.86)" numberOfLines={1}>
                  {metaLine(p)}
                </Txt>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>

      <View style={{ padding: space.lg, gap: space.sm }}>
        {p.intentions.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt variant="label" color="gold">
              Looking for
            </Txt>
            <Txt variant="smallStrong" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
              {p.intentions.slice(0, 3).map(intentionLabel).join(' • ')}
            </Txt>
          </View>
        ) : null}
        {p.bio ? (
          <Txt variant="body" color="textSecondary" numberOfLines={2}>
            {p.bio}
          </Txt>
        ) : null}
        {p.interests.length ? (
          <ChipGroup style={{ marginTop: 2 }}>
            {[...p.sharedInterests, ...p.interests.filter((i) => !p.sharedInterests.includes(i))].slice(0, 5).map((i) => (
              <Chip key={i} label={i} size="sm" tone={p.sharedInterests.includes(i) ? 'gold' : 'default'} icon={p.sharedInterests.includes(i) ? 'sparkles' : undefined} />
            ))}
          </ChipGroup>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
          <IconButton icon="close" label={`Pass on ${p.name}`} size={56} iconSize={26} onPress={onPass} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <CrushButton onPress={onCrush} loading={crushing} name={p.name} size={56} />
          </View>
          <IconButton
            icon="sparkles"
            label={`Send ${p.name} a Big Crush${deepLeft != null ? `. ${deepLeft} left today` : ''}`}
            size={56}
            iconSize={22}
            variant="gold"
            onPress={onDeepCrush}
          />
        </View>
      </View>
    </View>
  );
});

type TileProps = {
  profile: Profile;
  width: number;
  onOpen: () => void;
  onCrush?: () => void;
  footer?: React.ReactNode;
  caption?: string;
};

/** Compact portrait tile for grids (More discoveries, Crushes). */
export const ProfileTile = memo(function ProfileTile({ profile: p, width, onOpen, onCrush, footer, caption }: TileProps) {
  const { colors } = useTheme();
  const h = width * 1.3;
  return (
    <View style={{ width }}>
      <PressableScale onPress={onOpen} accessibilityLabel={`${p.name}${p.age ? `, ${p.age}` : ''}${p.verified ? ', verified' : ''}${p.distance ? `, ${p.distance}` : ''}`} accessibilityHint="Opens Space" pressedScale={0.98}>
        <View style={{ height: h, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
          <Photo uri={p.photos[0]?.url} style={{ width: '100%', height: '100%' }} />
          <LinearGradient colors={colors.photoScrim} locations={[0.4, 0.7, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' }} />
          {p.online ? <OnlineDot size={11} style={{ position: 'absolute', top: 12, left: 12, borderColor: 'rgba(0,0,0,0.4)' }} /> : null}
          {p.crush.receivedDeep ? (
            <View style={{ position: 'absolute', top: 10, right: 10 }}>
              <Pill tone="glass" label="Big" icon={<Ionicons name="sparkles" size={10} color={colors.goldBright} />} />
            </View>
          ) : null}
          <View style={{ position: 'absolute', left: 12, right: onCrush ? 56 : 12, bottom: 12 }}>
            <NameLine profile={p} size="sm" light />
            <Txt variant="caption" color="rgba(255,255,255,0.78)" numberOfLines={1} style={{ marginTop: 2 }}>
              {caption ?? (p.distance || p.city || p.activity || ' ')}
            </Txt>
          </View>
        </View>
      </PressableScale>
      {onCrush ? (
        <View style={{ position: 'absolute', right: 10, top: h - 50 }}>
          <CrushButton shape="round" size={40} onPress={onCrush} crushed={p.crush.sent} name={p.name} />
        </View>
      ) : null}
      {footer}
    </View>
  );
});
