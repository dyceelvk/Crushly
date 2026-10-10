import React, { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Photo, OnlineDot } from '../../components/Photo';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { CrushButton } from '../../components/CrushButton';
import { Chip, ChipGroup } from '../../components/Chip';
import { Pill, VerifiedBadge } from '../../components/Badges';
import { ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useOpenConversation, useUndoCrush, useUser } from '../../api/hooks';
import type { FullProfile } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useKeepClose, useKeepState, useLetGo } from '../../api/hooks';
import { useCrushFlow } from '../discover/Discover';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { intentionLabel, MOMENT_STYLES } from '../../lib/catalog';
import { timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="label" color="gold" style={{ marginBottom: space.sm }} accessibilityRole="header">
        {title}
      </Txt>
      {children}
    </View>
  );
}

function Fact({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
      <Txt variant="small" color="textSecondary" style={{ width: 96 }}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" style={{ flex: 1 }}>
        {value}
      </Txt>
    </View>
  );
}

export function UserProfileScreen({ route, navigation }: ScreenProps<'UserProfile'>) {
  const { id } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, contentWidth, gutter } = useLayout();
  const toast = useToast();
  const { data: p, isLoading, isError, error, refetch } = useUser(id);
  const { run: crushOn, pendingId } = useCrushFlow();
  const undo = useUndoCrush();
  const open = useOpenConversation();
  const { openActions } = useMemberActions();
  const keep = useKeepState(id);
  const keepClose = useKeepClose();
  const letGo = useLetGo();
  const [index, setIndex] = useState(0);

  const heroW = Math.min(width, contentWidth);
  const heroH = Math.min(heroW * 1.22, 640);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Skeleton style={{ width: '100%', height: heroH, borderRadius: 0 }} />
        <View style={{ padding: gutter, gap: 12 }}>
          <Skeleton style={{ height: 18, width: '60%' }} />
          <Skeleton style={{ height: 14, width: '90%' }} />
          <Skeleton style={{ height: 14, width: '75%' }} />
        </View>
      </View>
    );
  }
  if (isError || !p) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingHorizontal: gutter }}>
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} style={{ marginTop: space.sm }} />
        <ErrorState message={(error as Error)?.message || 'This Space isn’t available.'} onRetry={refetch} />
      </View>
    );
  }

  const member = { id: p.id, name: p.name, age: p.age, connected: p.crush.mutual, context: 'profile', onGone: () => navigation.goBack() };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / heroW);
    if (i !== index) setIndex(i);
  };

  const message = async () => {
    if (!p.canMessage) {
      toast({ kind: 'info', title: 'Not yet', message: p.messageBlockReason || 'Send a Crush first.' });
      return;
    }
    try {
      const conv = await open.mutateAsync(p.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open chat', message: (e as Error).message });
    }
  };

  const onCrush = () => {
    if (p.crush.mutual) return message();
    if (p.crush.sent) {
      undo.mutate(p.id, {
        onSuccess: () => toast({ kind: 'info', title: 'Crush withdrawn', message: `${p.name} won’t see it anymore.` }),
        onError: (e) => toast({ kind: 'error', title: 'Couldn’t withdraw', message: (e as Error).message }),
      });
      return;
    }
    if (!p.acceptsCrushes) {
      toast({ kind: 'info', title: 'Verified members only', message: `${p.name} accepts Crushes from verified members. Verify your Space in a minute.` , onPress: () => navigation.navigate('Verification') });
      return;
    }
    crushOn(p);
  };

  const lifestyle = lifestyleFacts(p);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ width: heroW, height: heroH, alignSelf: 'center' }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} accessibilityLabel={`${p.photos.length} photos`}>
            {(p.photos.length ? p.photos : [{ id: 0, url: '' }]).map((ph, i) => (
              <Photo key={ph.id} uri={ph.url || null} style={{ width: heroW, height: heroH }} alt={`${p.name}, photo ${i + 1} of ${p.photos.length}`} priority={i === 0 ? 'high' : 'low'} />
            ))}
          </ScrollView>
          <LinearGradient colors={['rgba(7,7,8,0.55)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }} pointerEvents="none" />
          <LinearGradient colors={colors.photoScrim} locations={[0.4, 0.75, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' }} pointerEvents="none" />
          <View style={{ position: 'absolute', top: insets.top + space.sm, left: gutter, right: gutter, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <IconButton icon="chevron-back" variant="glass" label="Go back" onPress={() => navigation.goBack()} />
            <View style={{ flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center' }} accessibilityElementsHidden>
              {p.photos.length > 1
                ? p.photos.map((ph, i) => <View key={ph.id} style={{ flex: 1, maxWidth: 40, height: 3, borderRadius: 2, backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.35)' }} />)
                : null}
            </View>
            <IconButton icon="ellipsis-horizontal" variant="glass" label={`More options for ${p.name}`} onPress={() => openActions(member)} />
          </View>
          <View style={{ position: 'absolute', left: gutter, right: gutter, bottom: space.xl }}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: space.sm, flexWrap: 'wrap' }}>
              {p.online ? <Pill tone="glass" label="Online now" icon={<OnlineDot size={8} style={{ borderWidth: 0 }} />} /> : p.activity ? <Pill tone="glass" label={p.activity} /> : null}
              {p.crush.mutual ? <Pill tone="glass" label="Mutual Crush" icon={<Ionicons name="heart" size={11} color={colors.crush} />} /> : p.crush.received ? <Pill tone="glass" label={p.crush.receivedDeep ? 'Big Crush on you' : 'Crushing on you'} icon={<Ionicons name="heart" size={11} color={colors.crush} />} /> : null}
              {keep.data?.keepsYou ? <Pill tone="glass" label="Keeps you close" icon={<Ionicons name="bookmark" size={11} color={colors.gold} />} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Txt variant="hero" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>
                {p.name}
                {p.age ? <Txt variant="hero" color="rgba(255,255,255,0.86)">{`, ${p.age}`}</Txt> : null}
              </Txt>
              {p.verified ? <VerifiedBadge size={24} /> : null}
            </View>
            <Txt variant="body" color="rgba(255,255,255,0.86)" style={{ marginTop: 2 }}>
              {[p.username ? `@${p.username}` : null, p.city, p.distance, p.pronouns].filter(Boolean).join('  ·  ')}
            </Txt>
          </View>
        </View>

        <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter }}>
          <View
            style={{
              marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: keep.data?.keeps ? colors.goldSoft : colors.card,
              borderWidth: 1, borderColor: keep.data?.keeps ? colors.goldLine : colors.border,
              borderRadius: radius.lg, padding: space.md,
            }}
          >
            <View style={{ flex: 1, flexShrink: 1, gap: 2 }}>
              <Txt variant="bodyStrong">
                {keep.data?.keeps ? 'Kept close' : 'Keep Close'}
              </Txt>
              <Txt variant="small" color="textSecondary">
                {keep.data?.keeps
                  ? 'You’ll see what they share. They aren’t told when you let go.'
                  : 'Keep them near without asking anything back. Only you see your list.'}
              </Txt>
              {keep.data && !keep.data.self ? (
                <Txt variant="caption" color="textMuted" style={{ marginTop: 2 }}>
                  {keep.data.keptByCount === 0
                    ? 'Nobody keeps them close yet'
                    : `${keep.data.keptByCount} ${keep.data.keptByCount === 1 ? 'member keeps' : 'members keep'} them close`}
                </Txt>
              ) : null}
            </View>
            <Button
              title={keep.data?.keeps ? 'Let go' : 'Keep Close'}
              size="sm"
              variant={keep.data?.keeps ? 'secondary' : 'primary'}
              icon={keep.data?.keeps ? undefined : 'bookmark-outline'}
              loading={keepClose.isPending || letGo.isPending}
              onPress={() => {
                haptic.tap();
                if (keep.data?.keeps) {
                  letGo.mutate(id, { onError: (e) => toast({ kind: 'error', title: 'Not let go', message: (e as Error).message }) });
                } else {
                  keepClose.mutate(id, { onError: (e) => toast({ kind: 'error', title: 'Not kept close', message: (e as Error).message }) });
                }
              }}
            />
          </View>

          {p.crush.note ? (
            <View style={{ marginTop: space.lg, backgroundColor: colors.goldSoft, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.goldLine }}>
              <Txt variant="label" color="gold">
                Big Crush note
              </Txt>
              <Txt variant="accent" style={{ marginTop: 6 }}>
                “{p.crush.note}”
              </Txt>
            </View>
          ) : null}

          {p.bio ? (
            <Section title={`About ${p.name}`}>
              <Txt variant="body" style={{ fontSize: 16, lineHeight: 25 }}>
                {p.bio}
              </Txt>
            </Section>
          ) : null}

          {p.intentions.length || p.relationshipIntention ? (
            <Section title="Looking for">
              <Txt variant="heading">{p.intentions.map(intentionLabel).join(' • ')}</Txt>
              {p.relationshipIntention ? (
                <Txt variant="body" color="textSecondary" style={{ marginTop: 4 }}>
                  {p.relationshipIntention}
                </Txt>
              ) : null}
            </Section>
          ) : null}

          {p.interests.length ? (
            <Section title="Interests">
              <ChipGroup>
                {p.interests.map((i) => (
                  <Chip key={i} label={i} tone={p.sharedInterests.includes(i) ? 'gold' : 'default'} icon={p.sharedInterests.includes(i) ? 'sparkles' : undefined} />
                ))}
              </ChipGroup>
              {p.sharedInterests.length ? (
                <Txt variant="small" color="textMuted" style={{ marginTop: 8 }}>
                  You both love {p.sharedInterests.slice(0, 3).join(', ')}.
                </Txt>
              ) : null}
            </Section>
          ) : null}

          {lifestyle.length ? (
            <Section title="About me">
              {lifestyle.map((f) => (
                <Fact key={f.label} {...f} />
              ))}
            </Section>
          ) : null}

          {p.moments.length ? (
            <Section title="Moments">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {p.moments.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => navigation.navigate('MomentViewer', { userId: p.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`Moment from ${timeAgo(m.createdAt)} ago${m.body ? `: ${m.body}` : ''}`}
                    style={{ width: 110, height: 150, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card }}
                  >
                    {m.kind === 'photo' ? (
                      <Photo uri={m.mediaUrl} style={{ width: '100%', height: '100%' }} />
                    ) : (
                      <LinearGradient colors={MOMENT_STYLES[m.style]?.colors || MOMENT_STYLES.noir.colors} style={{ flex: 1, padding: 10, justifyContent: 'center' }}>
                        <Txt variant="caption" color={MOMENT_STYLES[m.style]?.ink || '#fff'} numberOfLines={5}>
                          {m.body}
                        </Txt>
                      </LinearGradient>
                    )}
                    <View style={{ position: 'absolute', left: 8, bottom: 6 }}>
                      <Txt variant="caption" color="#fff">
                        {timeAgo(m.createdAt)}
                      </Txt>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </Section>
          ) : null}

          <View style={{ marginTop: space.xxl, flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
            <Pressable onPress={() => openActions(member)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 }}>
              <Ionicons name="flag-outline" size={15} color={colors.textMuted} />
              <Txt variant="smallStrong" color="textMuted">
                Report or block {p.name}
              </Txt>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Persistent action bar */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, space.md), paddingTop: space.sm,
          paddingHorizontal: gutter, backgroundColor: colors.glass, borderTopWidth: 1, borderTopColor: colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', maxWidth: contentWidth - gutter * 2, width: '100%', alignSelf: 'center' }}>
          <View style={{ flex: 1 }}>
            {p.crush.mutual ? (
              <CrushButton onPress={message} label="Whisper" crushed name={p.name} size={54} />
            ) : (
              <CrushButton onPress={onCrush} crushed={p.crush.sent} loading={pendingId === p.id} name={p.name} size={54} label={p.crush.sent ? 'Crushed' : p.crush.received ? 'Crush back' : 'Crush'} />
            )}
          </View>
          {!p.crush.mutual ? (
            <IconButton icon="chatbubble-outline" label={p.canMessage ? `Whisper ${p.name}` : `Messaging ${p.name} needs a Mutual Crush`} size={54} onPress={message} color={p.canMessage ? colors.text : colors.textMuted} />
          ) : null}
          <IconButton icon="share-outline" label={`Share ${p.name}'s Space`} size={54} onPress={() => openActions(member)} />
        </View>
      </View>
    </View>
  );
}

function lifestyleFacts(p: FullProfile) {
  const l = p.lifestyle || {};
  const out: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [];
  if (l.work) out.push({ icon: 'briefcase-outline', label: 'Work', value: l.work });
  if (l.education) out.push({ icon: 'school-outline', label: 'Education', value: l.education });
  if (l.height) out.push({ icon: 'resize-outline', label: 'Height', value: `${l.height} cm` });
  if (p.languages?.length) out.push({ icon: 'language-outline', label: 'Languages', value: p.languages.join(', ') });
  if (l.workout) out.push({ icon: 'barbell-outline', label: 'Workout', value: l.workout });
  if (l.drinking) out.push({ icon: 'wine-outline', label: 'Drinking', value: l.drinking });
  if (l.smoking) out.push({ icon: 'leaf-outline', label: 'Smoking', value: l.smoking });
  if (l.pets) out.push({ icon: 'paw-outline', label: 'Pets', value: l.pets });
  if (l.zodiac) out.push({ icon: 'moon-outline', label: 'Zodiac', value: l.zodiac });
  return out;
}
