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
import { Tabs } from '../../components/Tabs';
import { BlurView } from 'expo-blur';
import { useCircleRequestState, useMemberCircles, useRequestJoinCircle } from '../../api/hooks';
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
import { shownPosts } from '../../lib/features';
import type { Post } from '../../api/types';
import { radius, space } from '../../theme/tokens';
import { intentionLabel, MOMENT_STYLES } from '../../lib/catalog';
import { timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScreenProps, RootStackParamList } from '../../navigation/types';
import { useMe, useMoments, useMyCircles } from '../../api/hooks';
import type { Me } from '../../api/types';

/**
 * A visitor's Space, and the owner's, from one component.
 *
 * The owner's tab is the same page with the same layout; `mine` is the only
 * thing that differs.
 */
export function UserProfileScreen({ route, navigation }: ScreenProps<'UserProfile'>) {
  return <SpaceScreen memberId={route.params.id} onBack={() => navigation.goBack()} />;
}


/**
 * Your own profile, in the shape a Space is drawn from.
 *
 * `Me` carries your settings and your completion; `FullProfile` carries what a
 * page needs. Rather than teach every part of the layout two shapes, the owner's
 * half is folded into the visitor's — which is what makes it the same page
 * instead of two that happen to look alike.
 *
 * The things that only mean something between two people (a Crush, whether you
 * may message yourself, a distance to yourself) are stated as absent, not faked.
 */
function asFullProfile(me: Me, moments: MomentSummary[]): FullProfile {
  const pr = me.profile;
  return {
    id: me.id,
    name: pr.name,
    username: pr.username || null,
    age: pr.age,
    pronouns: pr.pronouns || null,
    city: pr.city || null,
    verified: me.verification.status === 'verified',
    badgeTier: me.verification.status === 'verified' ? 'verified' : 'none',
    keepsYou: false,
    distance: null,
    online: null,
    activity: null,
    bio: pr.bio,
    intentions: pr.intentions,
    relationshipIntention: pr.relationshipIntention || null,
    interests: pr.interests,
    sharedInterests: [],
    photos: pr.photos,
    crush: { sent: false, sentDeep: false, received: false, receivedDeep: false, note: null, mutual: false },
    canMessage: false,
    acceptsCrushes: true,
    languages: pr.languages,
    lifestyle: pr.lifestyle,
    messageBlockReason: null,
    moments,
  };
}

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

/**
 * The Space.
 *
 * One page and one layout, for two readers: the owner looking at themselves,
 * and somebody looking at them. The brief asked for the *same component*, and
 * this is that: every difference between the two is a boolean, and the
 * owner-only controls — Edit, the gear, the setup rows, Picked — are simply not
 * rendered for a visitor. Nothing about the shape of the page changes, which is
 * the point: you should be able to see your Space the way everybody else does,
 * with your controls sitting on top of it rather than in a second design.
 *
 * It also means an edit shows up immediately: both readers draw from the same
 * queries, and `useMe` is the one the editor invalidates on save.
 */
export function SpaceScreen({
  memberId,
  mine = false,
  onBack,
}: {
  memberId?: number;
  mine?: boolean;
  onBack?: () => void;
}) {
  const id = memberId ?? 0;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, contentWidth, gutter } = useLayout();
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // One query per reader, never both. `enabled` rather than a conditional hook,
  // so the ordering of hooks is the same on both paths.
  const meQ = useMe(mine);
  const otherQ = useUser(id, !mine);
  const query = mine ? meQ : otherQ;

  const moments = useMoments();
  const { run: crushOn, pendingId } = useCrushFlow();
  const undo = useUndoCrush();
  const open = useOpenConversation();
  const { openActions } = useMemberActions();
  const keep = useKeepState(id, !mine);
  const keepClose = useKeepClose();
  const letGo = useLetGo();
  const [index, setIndex] = useState(0);
  /**
   * Whether the page has scrolled past the cover.
   *
   * The header sits over the photograph while the photograph is there, and
   * becomes a bar of the page's own colour once it is not — which is the only
   * way a control can be over a picture and over white text at the same time
   * without drawing a box around itself in the case where it does not need one.
   */
  const [scrolled, setScrolled] = useState(false);

  /**
   * A Space is what they have made and where they belong: their Flows, their
   * Moments, and the Circles they share with you.
   */
  const [tab, setTab] = useState<'flow' | 'moments' | 'circles'>('flow');

  // Their Circles, or yours. Same page, same component.
  const mineCircles = useMyCircles(mine);
  const theirCircles = useMemberCircles(mine ? null : id || null);
  // The same RPC in both modes: `space_posts` already answers for your own id,
  // so an owner's Flows and a visitor's are the same list from the same call.
  const spaceId = mine ? (meQ.data?.id ?? 0) : id;
  const posts = useSpacePosts(spaceId, spaceId > 0);

  const p: FullProfile | null = mine
    ? meQ.data
      ? asFullProfile(meQ.data, moments.data?.mine.moments ?? [])
      : null
    : otherQ.data ?? null;

  const heroW = Math.min(width, contentWidth);
  // A cover, not a portrait: wide enough to read as the backdrop of the Space,
  // short enough that the face, the name and the tabs are all on the first
  // screen without scrolling.
  const heroH = Math.min(heroW * 0.98, 460);
  const goBack = onBack ?? (navigation.canGoBack() ? () => navigation.goBack() : undefined);

  if (query.isLoading && !p) {
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
  if (query.isError || !p) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingHorizontal: gutter }}>
        {goBack ? <IconButton icon="chevron-back" label="Go back" onPress={goBack} style={{ marginTop: space.sm }} /> : null}
        <ErrorState error={query.error} message="This Space isn’t available." onRetry={query.refetch} />
      </View>
    );
  }

  const member = { id: p.id, name: p.name, age: p.age, connected: p.crush.mutual, context: 'profile', onGone: () => (goBack ? goBack() : undefined) };


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
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          const next = y > heroH - (insets.top + 64);
          if (next !== scrolled) setScrolled(next);
        }}
        scrollEventThrottle={16}
      >
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
          {/* The dots stay with the photograph, because they count photographs.
              Everything else that used to share this row is a control, and a
              control belongs in the header above, where it does not scroll
              away. */}
          <View style={{ position: 'absolute', top: insets.top + space.sm + 8, left: gutter, right: gutter, flexDirection: 'row', gap: 4, justifyContent: 'center' }} accessibilityElementsHidden>
            {p.photos.length > 1
              ? p.photos.map((ph, i) => <View key={ph.id} style={{ flex: 1, maxWidth: 40, height: 3, borderRadius: 2, backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.35)' }} />)
              : null}
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
                {/* Keep Close and Crush are things one member does to another.
                    On your own Space they are replaced by the only two things
                    you can do to yourself: write it, and edit it. */}
                {mine ? (
                  <Pressable
                    onPress={() => navigation.navigate('EditProfile')}
                    accessibilityRole="button"
                    accessibilityLabel="Edit your Space"
                    hitSlop={8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 5,
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                      backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.goldLine,
                    }}
                  >
                    <Ionicons name="create-outline" size={12} color={colors.gold} />
                    <Txt variant="caption" color="gold">
                      Edit Space
                    </Txt>
                  </Pressable>
                ) : null}
                {mine ? null : (
                <>
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
                </>
                )}
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
          {(mine && meQ.data?.status === 'paused') || p.online || p.activity || p.crush.mutual || p.crush.received || keep.data?.keepsYou ? (
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
              {mine && meQ.data?.status === 'paused' ? <Pill tone="neutral" label="Hidden from Discover" /> : null}
            </View>
          ) : null}
        </View>

        <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter }}>
          {!mine && p.crush.note ? (
            <View style={{ marginTop: space.lg, backgroundColor: colors.goldSoft, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.goldLine }}>
              <Txt variant="label" color="gold">
                Big Crush note
              </Txt>
              <Txt variant="accent" style={{ marginTop: 6 }}>
                “{p.crush.note}”
              </Txt>
            </View>
          ) : null}

          {/* The tabs come straight after the name, on everybody's Space.
              This is the whole complaint that started the correction: on your own
              page the row sat under About, Looking for and Interests, so the
              first thing below your face was prose and the tabs were somewhere
              past it. Same order as the visitor view now — cover, face, name,
              tabs — and the hand can turn the page either way. */}
          <View style={{ marginTop: space.md }}>
            {/* The words, then the page under them. These are one control, not
                two: `Tabs` is where the labels are and what you press, and
                `SwipeTabs` is the same choice made with the hand. Neither works
                without the other — a swipe with no visible tabs is a page with
                no name, and tabs that do not swipe are a menu pretending to be a
                page. */}
            <Tabs
              tabs={[
                { id: 'flow' as const, label: 'Posts' },
                { id: 'moments' as const, label: 'Moments' },
                { id: 'circles' as const, label: 'Circles' },
              ]}
              active={tab}
              onChange={setTab}
              accessibilityLabel={`${p.name}’s Space`}
            />
            <View style={{ height: 1, backgroundColor: colors.border, marginTop: space.xs }} />
            <View style={{ marginTop: space.md }}>
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
                onOpen={() => navigation.navigate('MomentViewer', { userId: p.id, mine })}
              />
            ) : null}
            {tab === 'circles' ? (
              <SpaceCircles
                items={(mine ? mineCircles.data?.items : theirCircles.data?.items) ?? []}
                loading={mine ? mineCircles.isLoading : theirCircles.isLoading}
                onOpen={(circleId) => navigation.navigate('Circle', { circleId })}
              />
            ) : null}
            </SwipeTabs>
            </View>
          </View>

          <View style={{ marginTop: space.xxl, gap: space.md }}>
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

          {lifestyle.length ? (
            <Section title="About me">
              {lifestyle.map((f) => (
                <Fact key={f.label} {...f} />
              ))}
            </Section>
          ) : null}



          {mine ? null : (
            <View style={{ marginTop: space.xxl, flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
              <Pressable onPress={() => openActions(member)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 }}>
                <Ionicons name="flag-outline" size={15} color={colors.textMuted} />
                <Txt variant="smallStrong" color="textMuted">
                  Report or block {p.name}
                </Txt>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ------------------------------------------------------- the header
          Settings, Picked and Edit, held at the top of the page.

          They used to be a row at the bottom of the feed ("Your Circles", "Your
          Moments", "Picked", "Settings"), which meant the further you posted,
          the further your own account's controls moved. Circles and Moments are
          the tabs above and always were — the same two destinations drawn twice
          — so those rows are gone. Settings and Picked live here now, over the
          cover while the cover is what is behind them, and on the page's own
          colour once it has scrolled away.

          Pinned rather than inside the ScrollView: a control that scrolls is a
          control you have to find. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 60,
            backgroundColor: scrolled ? colors.bg : 'transparent',
            borderBottomWidth: scrolled ? 1 : 0,
            borderBottomColor: colors.border,
          }}
        />
        {!scrolled ? (
          <LinearGradient
            colors={['rgba(7,7,8,0.55)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 96 }}
            pointerEvents="none"
          />
        ) : null}
        <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* The same corner, whoever is reading. A visitor gets the way back;
              the owner gets the gear. Neither ever sees both. */}
          {mine ? (
            <IconButton icon="settings-outline" variant={scrolled ? 'surface' : 'glass'} label="Settings" onPress={() => navigation.navigate('Settings')} />
          ) : goBack ? (
            <IconButton icon="chevron-back" variant={scrolled ? 'surface' : 'glass'} label="Go back" onPress={goBack} />
          ) : null}
          <View style={{ flex: 1 }} />
          {mine ? (
            <IconButton icon="bookmark-outline" variant={scrolled ? 'surface' : 'glass'} label="Picked" onPress={() => navigation.navigate('SavedPosts')} />
          ) : null}
          {mine ? (
            <IconButton icon="create-outline" variant={scrolled ? 'surface' : 'glass'} label="Edit Space" onPress={() => navigation.navigate('EditProfile')} />
          ) : (
            <IconButton icon="ellipsis-horizontal" variant={scrolled ? 'surface' : 'glass'} label={`More options for ${p.name}`} onPress={() => openActions(member)} />
          )}
        </View>
      </View>

      {/* Persistent action bar — for people you are not. */}
      {mine ? null : (
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
      )}
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
  // Nothing on a Space this build does not show. A clip in the list would be a
  // card that plays nothing, so it is not in the list.
  const shown = shownPosts(items);
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
  if (!shown.length) {
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
      {shown.map((post) => (
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
      {items.map((c) => (
        <SpaceCircleRow key={c.id} circle={c} onOpen={onOpen} />
      ))}
    </View>
  );
}

/**
 * One room on somebody's Space.
 *
 * If its owners made it public and you are not in it, this is where you ask.
 * The button is a request, never a join: whether it is allowed is decided in the
 * database, and an approved row in `circle_join_requests` is the only thing that
 * creates the membership.
 */
function SpaceCircleRow({
  circle: c,
  onOpen,
}: {
  circle: { id: number; name: string; about: string; theme?: string | null; visibility?: string; memberCount: number; joined?: boolean };
  onOpen: (id: number) => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const theme = resolveTheme(c.theme);
  const canAsk = !c.joined && c.visibility === 'public';
  const state = useCircleRequestState(c.id, canAsk);
  const ask = useRequestJoinCircle();
  const asked = state.data?.requested ?? false;

  return (
    <View
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
      <Pressable
        onPress={() => onOpen(c.id)}
        accessibilityRole="button"
        accessibilityLabel={`${c.name}, ${c.memberCount} members`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 }}
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
      </Pressable>
      {canAsk ? (
        <Button
          title={asked ? 'Asked' : 'Ask to join'}
          variant={asked ? 'ghost' : 'outline'}
          size="sm"
          full={false}
          disabled={asked}
          loading={ask.isPending}
          onPress={() =>
            ask.mutate(c.id, {
              onSuccess: () => toast({ kind: 'info', title: 'Asked', message: `The owner of ${c.name} decides who joins.` }),
              onError: (e) => toast({ kind: 'error', title: 'Couldn’t ask', message: (e as Error).message }),
            })
          }
        />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      )}
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
