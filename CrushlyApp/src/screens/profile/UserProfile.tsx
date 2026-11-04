import React, { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Photo, Avatar, OnlineDot } from '../../components/Photo';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { CrushButton } from '../../components/CrushButton';
import { Chip, ChipGroup } from '../../components/Chip';
import { SwipeTabs } from '../../components/SwipeTabs';
import { BlurView } from 'expo-blur';
import { useMemberCircles } from '../../api/hooks';
import { resolveTheme } from '../../lib/circleThemes';
import { ThemeTile } from '../../components/ThemePicker';
import { Pill, VerifiedBadge } from '../../components/Badges';
import { LoadingBlock, ErrorState, Skeleton, EmptyState } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useOpenConversation, useSpacePosts, useUndoCrush, useUser } from '../../api/hooks';
import type { FullProfile, MomentSummary } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useKeepClose, useKeepState, useLetGo } from '../../api/hooks';
import { useCrushFlow } from '../discover/Discover';
import { useTheme } from '../../theme/ThemeProvider';
import { MomentPreview } from '../moments/Moments';
import { PostCard } from '../../components/feed/PostCard';
import type { Post } from '../../api/types';
import { radius, space } from '../../theme/tokens';
import { intentionLabel, MOMENT_STYLES } from '../../lib/catalog';
import { timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

/** Diameter of the round face that sits on the cover. */
const FACE = 84;

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
  /**
   * A Space is what they have made and where they belong: their Flows, their
   * Moments, and the Circles they share with you. It used to be one long page of
   * facts about a person with nothing they had actually made on it.
   */
  // Flow, Moments, Circles — everything somebody has made or joined, in the
  // vocabulary the product uses everywhere else. It used to say "Posts", which
  // is a hashtag's word for a Flow.
  const [tab, setTab] = useState<'flow' | 'moments' | 'circles'>('flow');
  // The Circles this member made public, and the ones you share with them.
  const circles = useMemberCircles(p?.id ?? null);
  const posts = useSpacePosts(id);

  const heroW = Math.min(width, contentWidth);
  // A cover, not a portrait: wide enough to read as the backdrop of the Space,
  // short enough that the face, the name and the tabs are all on the first
  // screen without scrolling.
  const heroH = Math.min(heroW * 0.98, 460);

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
        <ErrorState error={error} message="This Space isn’t available." onRetry={refetch} />
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
        <View style={{ width: heroW, height: heroH, alignSelf: 'center', position: 'relative' }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} accessibilityLabel={`${p.photos.length} photos`}>
            {(p.photos.length ? p.photos : [{ id: 0, url: '' }]).map((ph, i) => (
              <Photo key={ph.id} uri={ph.url || null} style={{ width: heroW, height: heroH }} alt={`${p.name}, photo ${i + 1} of ${p.photos.length}`} priority={i === 0 ? 'high' : 'low'} />
            ))}
          </ScrollView>
          <LinearGradient colors={['rgba(7,7,8,0.55)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }} pointerEvents="none" />
          {/* The bottom of the cover blurs and fades into the page — the picture
              ends, the person's name begins, and no hard edge is asked to do
              that job on its own. */}
          <BlurView
            intensity={26}
            tint="dark"
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%' }}
          />
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
          {/* Only the state pills live on the cover now. The name, the face and
              the actions sit under it, on the page background, which is what
              stops the identity block from eating the screen the tabs need. */}
          <View style={{ position: 'absolute', left: gutter, right: gutter, bottom: space.md }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {p.online ? <Pill tone="glass" label="Online now" icon={<OnlineDot size={8} style={{ borderWidth: 0 }} />} /> : p.activity ? <Pill tone="glass" label={p.activity} /> : null}
              {p.crush.mutual ? <Pill tone="glass" label="Mutual Crush" icon={<Ionicons name="heart" size={11} color={colors.crush} />} /> : p.crush.received ? <Pill tone="glass" label={p.crush.receivedDeep ? 'Big Crush on you' : 'Crushing on you'} icon={<Ionicons name="heart" size={11} color={colors.crush} />} /> : null}
              {keep.data?.keepsYou ? <Pill tone="glass" label="Keeps you close" icon={<Ionicons name="bookmark" size={11} color={colors.gold} />} /> : null}
            </View>
          </View>
        </View>

        {/*
          The face, overlapping the cover the way a profile picture is meant to.
          It carries the Moments ring when there is something to watch, so the
          ring is still the way in — it just is not a second avatar floating in
          the middle of a name line.
        */}
        <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter }}>
          <View style={{ marginTop: -46, flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
            <Pressable
              onPress={p.moments.length ? () => navigation.navigate('MomentViewer', { userId: p.id }) : undefined}
              accessibilityRole="button"
              accessibilityLabel={p.moments.length ? `View ${p.name}’s Moments` : `${p.name}’s photo`}
            >
              <LinearGradient
                colors={p.moments.length ? [colors.gold, colors.crush, colors.goldDeep] : ['transparent', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: FACE + 8, height: FACE + 8, borderRadius: (FACE + 8) / 2, alignItems: 'center', justifyContent: 'center' }}
              >
                <View style={{ width: FACE + 2, height: FACE + 2, borderRadius: (FACE + 2) / 2, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={FACE - 4} />
                </View>
              </LinearGradient>
            </Pressable>

            {/* The name, and the two things you can do about this person —
                one of them a chip, not a card. */}
            <View style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {p.name}
                  {p.age ? <Txt variant="title" color="textSecondary">{`, ${p.age}`}</Txt> : null}
                </Txt>
                <VerifiedBadge size={18} tier={p.badgeTier ?? (p.verified ? 'verified' : 'none')} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <Pressable
                  onPress={() => {
                    haptic.tap();
                    if (keep.data?.keeps) letGo.mutate(id, { onError: (e) => toast({ kind: 'error', title: 'Not let go', message: (e as Error).message }) });
                    else keepClose.mutate(id, { onError: (e) => toast({ kind: 'error', title: 'Not kept close', message: (e as Error).message }) });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={keep.data?.keeps ? `Stop keeping ${p.name} close` : `Keep ${p.name} close`}
                  hitSlop={8}
                  disabled={keepClose.isPending || letGo.isPending}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                    backgroundColor: keep.data?.keeps ? colors.goldSoft : colors.card,
                    borderWidth: 1, borderColor: keep.data?.keeps ? colors.goldLine : colors.border,
                  }}
                >
                  <Ionicons name={keep.data?.keeps ? 'bookmark' : 'bookmark-outline'} size={12} color={keep.data?.keeps ? colors.gold : colors.textSecondary} />
                  <Txt variant="caption" color={keep.data?.keeps ? 'gold' : 'textSecondary'}>
                    {keep.data?.keeps ? 'Kept close' : 'Keep Close'}
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={onCrush}
                  accessibilityRole="button"
                  accessibilityLabel={p.crush.mutual ? `Whisper ${p.name}` : p.crush.sent ? 'Withdraw your Crush' : `Crush on ${p.name}`}
                  hitSlop={8}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                    backgroundColor: p.crush.sent ? colors.crushSoft : colors.card,
                    borderWidth: 1, borderColor: p.crush.sent ? colors.crushLine : colors.border,
                  }}
                >
                  <Ionicons name={p.crush.mutual ? 'chatbubble-ellipses' : p.crush.sent ? 'heart' : 'heart-outline'} size={12} color={colors.crush} />
                  <Txt variant="caption" color={p.crush.sent ? 'crush' : 'textSecondary'}>
                    {p.crush.mutual ? 'Whisper' : p.crush.sent ? 'Crushed' : 'Crush'}
                  </Txt>
                </Pressable>
              </View>
            </View>
          </View>
          <Txt variant="small" color="textSecondary" style={{ marginTop: space.sm }}>
            {[p.username ? `@${p.username}` : null, p.city, p.distance, p.pronouns].filter(Boolean).join('  ·  ')}
          </Txt>

          {/* The state pills used to sit on the bottom of the cover, which put
              them directly behind the face — a rounded rectangle poking out at
              the corners of a circle, unreadable and untappable. They are on
              the page now, where they can be read and pressed. */}
          {p.online || p.activity || p.crush.mutual || p.crush.received || keep.data?.keepsYou ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: space.sm }}>
              {p.online ? (
                <Pill tone="neutral" label="Online now" icon={<OnlineDot size={8} style={{ borderWidth: 0 }} />} />
              ) : p.activity ? (
                <Pill tone="neutral" label={p.activity} />
              ) : null}
              {p.crush.mutual ? (
                <Pill tone="crush" label="Mutual Crush" icon={<Ionicons name="heart" size={11} color={colors.crush} />} />
              ) : p.crush.received ? (
                <Pill
                  tone="crush"
                  label={p.crush.receivedDeep ? 'Big Crush on you' : 'Crushing on you'}
                  icon={<Ionicons name="heart" size={11} color={colors.crush} />}
                />
              ) : null}
              {keep.data?.keepsYou ? (
                <Pill tone="gold" label="Keeps you close" icon={<Ionicons name="bookmark" size={11} color={colors.gold} />} />
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter }}>
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

          {/*
            Three tabs, and the ring above them is the shortcut everyone
            already knows: face ring → Moments. The identity facts (about,
            looking for, interests) sit under the content, because what someone
            has made is the reason to be on this page.
          */}
          {/* Who they are, before what they made: the cover, then the words
              about them, then their work. The facts used to sit under three
              tabs' worth of content, which meant a visitor read everything
              somebody posted before learning one thing about them. */}
          <View style={{ marginTop: space.lg, gap: space.md }}>
                      {p.bio ? (
            <Section title={`About ${p.name}`}>
              <Txt variant="body">
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
                  <Chip key={i} label={i} tone={p.sharedInterests.includes(i) ? 'primary' : 'default'} icon={p.sharedInterests.includes(i) ? 'sparkles' : undefined} />
                ))}
              </ChipGroup>
              {p.sharedInterests.length ? (
                <Txt variant="small" color="textMuted" style={{ marginTop: 8 }}>
                  You both love {p.sharedInterests.slice(0, 3).join(', ')}.
                </Txt>
              ) : null}
            </Section>
          ) : null}
          </View>

          {/* One tab row, not two. A Segmented sat above this SwipeTabs with the
              same labels and the same state — the same control drawn twice, one
              of them not swipable — which is how the row above the posts read as
              a rendering bug. The SwipeTabs is the row. */}
          <View style={{ marginTop: space.lg }}>
            <SwipeTabs
              options={['flow', 'moments', 'circles'] as const}
              value={tab}
              onChange={setTab}
              width={contentWidth - gutter * 2}
            >
            {tab === 'flow' ? (
              <SpacePosts
                items={posts.data?.items ?? []}
                loading={posts.isLoading}
                failed={posts.isError}
                name={p.name}
                onRetry={() => void posts.refetch()}
              />
            ) : null}
            {tab === 'moments' ? (
              <SpaceMoments
                moments={p.moments}
                name={p.name}
                onOpen={() => navigation.navigate('MomentViewer', { userId: p.id })}
              />
            ) : null}
            {tab === 'circles' ? (
              <SpaceCircles items={circles.data?.items ?? []} loading={circles.isLoading} onOpen={(id) => navigation.navigate('Circle', { circleId: id })} />
            ) : null}
            </SwipeTabs>
          </View>

          {lifestyle.length ? (
            <Section title="About me">
              {lifestyle.map((f) => (
                <Fact key={f.label} {...f} />
              ))}
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

/* ------------------------------------------------------- the three panels */

/** What they've posted, in the same card the Flow uses. */
function SpacePosts({
  items,
  loading,
  failed,
  name,
  onRetry,
}: {
  items: Post[];
  loading: boolean;
  failed: boolean;
  name: string;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  if (loading) {
    return (
      <View style={{ gap: space.md }}>
        <Skeleton style={{ height: 260, borderRadius: radius.lg }} />
        <Skeleton style={{ height: 180, borderRadius: radius.lg }} />
      </View>
    );
  }
  if (failed) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn’t load their posts"
        message="This is usually the connection, not the post."
        action={{ label: 'Try again', onPress: onRetry }}
      />
    );
  }
  if (!items.length) {
    return (
      <EmptyState
        icon="document-text-outline"
        title="Nothing posted yet"
        message={`${name} hasn’t shared anything on the Flow.`}
      />
    );
  }
  return (
    <View style={{ gap: space.md }}>
      {items.map((post) => (
        <View key={post.id} style={{ borderTopWidth: 0, borderColor: colors.border }}>
          {/* `secondPerson={false}`: this is a list of somebody else's posts, so
              "You" would be a lie about who wrote them. */}
          <PostCard post={post} secondPerson={false} active={false} />
        </View>
      ))}
    </View>
  );
}

/**
 * Their Circles.
 *
 * Only what they made findable, plus anything you already share with them — the
 * server decides, and this draws what it is given. A Circle is a room; being
 * able to see that a room exists is not the same as being able to read it, so
 * each card says how many are inside instead of what they have been saying.
 */
function SpaceCircles({
  items,
  loading,
  onOpen,
}: {
  items: { id: number; name: string; about: string; theme?: string | null; visibility?: string; memberCount: number; joined?: boolean }[];
  loading?: boolean;
  onOpen: (id: number) => void;
}) {
  const { colors } = useTheme();
  if (loading) return <LoadingBlock label="Loading their Circles" />;
  if (!items.length) {
    return (
      <Txt variant="small" color="textMuted" style={{ paddingVertical: space.md }}>
        No Circles to show. A Circle appears here when its owner makes it public.
      </Txt>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {items.map((c) => {
        const theme = resolveTheme(c.theme);
        return (
          <Pressable
            key={c.id}
            onPress={() => onOpen(c.id)}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}, ${c.memberCount} members`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              padding: space.sm,
              borderRadius: radius.lg,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {theme ? (
              <ThemeTile theme={theme} size={64} />
            ) : (
              <View style={{ width: 64, height: 40, borderRadius: radius.md, backgroundColor: colors.elevated }} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {c.name}
                </Txt>
                {c.joined ? (
                  <Txt variant="caption" color="gold">
                    Yours
                  </Txt>
                ) : null}
              </View>
              <Txt variant="caption" color="textMuted" numberOfLines={1}>
                {[theme?.label, `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`, c.visibility === 'public' ? 'Public' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Their Moments, in the same pebble grid the Moments tab uses. */
function SpaceMoments({ moments, name, onOpen }: { moments: MomentSummary[]; name: string; onOpen: () => void }) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const cols = 3;
  const gap = 10;
  const w = (contentWidth - gutter * 2 - gap * (cols - 1)) / cols;
  if (!moments.length) {
    return <EmptyState icon="aperture-outline" title="No Moments right now" message={`${name} hasn’t shared a glimpse today. They disappear after 24 hours.`} />;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {moments.map((m) => (
        <Pressable
          key={m.id}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Play ${name}’s Moment${m.body ? `: ${m.body}` : ''}`}
          style={({ pressed }) => ({ width: w, opacity: pressed ? 0.85 : 1 })}
        >
          <View style={{ width: w, height: w * 1.35, borderRadius: w * 0.3, overflow: 'hidden', borderWidth: 1.5, borderColor: colors.goldLine, padding: 2 }}>
            <View style={{ flex: 1, borderRadius: w * 0.3 - 3, overflow: 'hidden', backgroundColor: colors.card }}>
              <MomentPreview
                moment={m as unknown as Parameters<typeof MomentPreview>[0]['moment']}
                style={{ width: '100%', height: '100%' }}
                caption={m.kind !== 'photo'}
                textSize={Math.max(9, w / 11)}
                lines={3}
              />
            </View>
          </View>
        </Pressable>
      ))}
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
