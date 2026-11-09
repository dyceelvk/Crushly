import React, { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spaceRelationshipStats, spaceRelationshipPeople, setAddUpListVisibility, type AddUpListVisibility } from '../../api/service';
import { formatCount } from '../../lib/counts';
import { ActivityIndicator, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { CrushIcon } from '../../components/Logo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { copySpaceLink, shareSpaceLink } from '../../lib/spaceShareActions';
import { Photo, Avatar, OnlineDot } from '../../components/Photo';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Chip, ChipGroup } from '../../components/Chip';
import { ActionSheet, BottomSheet } from '../../components/BottomSheet';
import { SwipeTabs } from '../../components/SwipeTabs';
import { Tabs } from '../../components/Tabs';
import { useMemberCircles } from '../../api/hooks';
import { resolveTheme } from '../../lib/circleThemes';
import { ThemeTile } from '../../components/ThemePicker';
import { Pill, VerifiedBadge } from '../../components/Badges';
import { LoadingBlock, ErrorState, Skeleton, EmptyState } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useAcceptAddUp, useDeclineAddUp, useOpenConversation, useSpacePosts, useUndoCrush, useUser } from '../../api/hooks';
import type { FullProfile, MomentSummary } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useKeepClose, useKeepState, useLetGo } from '../../api/hooks';
import { useCrushFlow } from '../discover/Discover';
import { celebrated } from '../crushes/MutualCrush';
import { MOMENT_RING_SEEN } from '../../lib/momentRings';
import { joinAction, policyLabel } from '../../lib/circleAccess';
import { useTheme } from '../../theme/ThemeProvider';
import { MomentPreview } from '../moments/Moments';
import { PostCard } from '../../components/feed/PostCard';
import { ClipThumb } from '../../components/ClipThumb';
import { mediaSource } from '../../lib/mediaHost';
import { mediaUrl } from '../../api/client';
import { shownPosts } from '../../lib/features';
import type { Post } from '../../api/types';
import { radius, space } from '../../theme/tokens';
import { intentionLabel, MOMENT_STYLES } from '../../lib/catalog';
import { timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScreenProps, RootStackParamList } from '../../navigation/types';
import { useMe, useMoments, useMyCircles, useSpaceBanner } from '../../api/hooks';
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
    crush: {
      sent: false, sentStatus: null, sentDeep: false,
      received: false, receivedStatus: null, receivedDeep: false,
      note: null, respondedAt: null, mutual: false,
    },
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

/**
 * Whose Moments have been opened from their picture this session.
 *
 * The picture is two things at once — the photograph, and a door to the Moments
 * behind it — and a plain tap cannot mean both forever. The first tap opens the
 * Moments, because that is what a ring around a face promises. Once you have
 * been in and come back out, the promise is kept, so the next tap asks which one
 * you meant instead of guessing. Kept at module level so walking to another
 * Space and back does not forget.
 */
const momentsOpened = new Set<number>();

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
  const meQ = useMe();
  const otherQ = useUser(id, !mine);
  const query = mine ? meQ : otherQ;

  const moments = useMoments();
  /* Whether this Space's live Moments have been watched, read from the same
     response every ring on every screen is drawn from — not from a second
     question the backend would have to answer differently. */
  const momentSeen = (() => {
    if (mine) return true;
    const group = moments.data?.others?.find((g) => g.user.id === id);
    return group ? !group.hasUnseen : false;
  })();
  const { run: crushOn, pendingId } = useCrushFlow();
  const undo = useUndoCrush();
  const accept = useAcceptAddUp();
  const decline = useDeclineAddUp();
  const open = useOpenConversation();
  const { openActions } = useMemberActions();
  const keep = useKeepState(id, !mine);
  const keepClose = useKeepClose();
  const letGo = useLetGo();
  const [index, setIndex] = useState(0);
  /** The full-screen picture, and the chooser that decides which door opens. */
  const [photoOpen, setPhotoOpen] = useState(false);
  const [faceMenu, setFaceMenu] = useState(false);
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [relationshipList, setRelationshipList] = useState<'addUps' | 'keptClose' | null>(null);
  const [listOpenSequence, setListOpenSequence] = useState(0);
  const [visibilityMenu, setVisibilityMenu] = useState(false);
  const qc = useQueryClient();
  const [showFullBio, setShowFullBio] = useState(false);
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
   * A Space is four things, in this order, and nothing else:
   *
   *   Crushes — what they have posted. A post *is* a Crush on this product, so
   *              the tab is named for the thing, not for the container.
   *   Moments  — what they have shared today.
   *   Circles  — where they belong.
   *   About    — who they are: the words, what they are looking for, their
   *              interests, and the facts they filled in.
   *
   * About used to be loose prose under the post list, which made the page a
   * scroll with no end and no boundary: you reached the bottom of somebody's
   * posts and then kept walking through their biography. Everything that is
   * *about* the person is a tab now, and the page ends where the tab ends.
   */
  const [tab, setTab] = useState<'crushes' | 'moments' | 'circles' | 'about'>('crushes');

  // Their Circles, or yours. Same page, same component.
  const mineCircles = useMyCircles(mine);
  const theirCircles = useMemberCircles(mine ? null : id || null);
  // The same RPC in both modes: `space_posts` already answers for your own id,
  // so an owner's Flows and a visitor's are the same list from the same call.
  const spaceId = mine ? (meQ.data?.id ?? 0) : id;
  const posts = useSpacePosts(spaceId, spaceId > 0);
  const relationship = useQuery({
    queryKey: ['space-relationship-stats', meQ.data?.id, spaceId],
    queryFn: () => spaceRelationshipStats(spaceId), enabled: !!meQ.data?.id && spaceId > 0,
    staleTime: 0, refetchInterval: 30_000,
  });
  const visibilityMutation = useMutation({ mutationFn: setAddUpListVisibility,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['space-relationship-stats'] }); toast({kind: 'success', title: 'Privacy updated'}); },
    onError: (e) => toast({kind:'error', title:'Couldn’t update privacy', message:(e as Error).message}),
  });

  const p: FullProfile | null = mine
    ? meQ.data
      ? asFullProfile(meQ.data, moments.data?.mine.moments ?? [])
      : null
    : otherQ.data ?? null;
  const bannerQ = useSpaceBanner(meQ.data?.id, p?.id);
  const bannerUrl = bannerQ.data ?? null;
  const bannerPending = !bannerQ.isError && (meQ.isLoading || bannerQ.isLoading);

  const { height: windowH } = useWindowDimensions();
  const heroW = Math.min(width, contentWidth);
  // A cover, not a portrait: wide enough to read as the backdrop of the Space,
  // short enough that the face, the name and the tabs are all on the first
  // screen without scrolling.
  /* The cover is a band across the top, not a page of its own.
     At 0.98 the cover alone was most of the screen, so the name, the Add up and
     the tabs were pushed below the fold and the Space opened on a photograph and
     nothing else. A photograph that fills its own height also leaves the
     letterboxed bands a whole frame is supposed to avoid, which read as the
     picture having been cropped and the rest of the space abandoned. 0.62 is a
     cover: the picture is still the first thing you see, and the person, the
     Add up and the four tabs are on the same screen with it. */
  const hasBanner = !!bannerUrl;
  const heroH = bannerPending || hasBanner ? Math.min(heroW * 0.62, 320) : insets.top + 105;

  /**
   * What tapping somebody's face means.
   *
   * No Moments, nothing to open behind the picture: tapping it shows the
   * picture, full screen, which is the only thing it could sensibly do. With
   * Moments, the first tap in a session opens them — that is the door the ring
   * draws. Every tap after that asks, because by then the person has seen both
   * and only they know which one they came back for.
   */
  const onFacePress = () => {
    const who = p?.id;
    if (!p || who == null) return;
    if (!p.moments.length) {
      setPhotoOpen(true);
      return;
    }
    if (!momentsOpened.has(who)) {
      momentsOpened.add(who);
      navigation.navigate('MomentViewer', { userId: who, mine });
      return;
    }
    setFaceMenu(true);
  };
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
      toast({ kind: 'info', title: 'Not yet', message: p.messageBlockReason || 'Add up with them first.' });
      return;
    }
    try {
      const conv = await open.mutateAsync(p.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open chat', message: (e as Error).message });
    }
  };

  /*
   * One control, four states, and the state decides what it does.
   *
   * Add up → a request goes out. Request sent → the same control withdraws it,
   * because a question you asked is a question you may take back. Accept →
   * their request becomes a connection, which is worth the celebration screen.
   * Connected → the control hands over to Whisper.
   */
  const onCrush = () => {
    if (p.crush.mutual) return message();
    if (p.crush.received) {
      accept.mutate(p.id, {
        onSuccess: (r) => {
          if (r.connected) celebrated.add(p.id);
          navigation.navigate('MutualCrush', { userId: p.id, name: p.name, photo: p.photos[0]?.url });
        },
        onError: (e) => toast({ kind: 'error', title: 'Request not accepted', message: (e as Error).message }),
      });
      return;
    }
    if (p.crush.sent) {
      undo.mutate(p.id, {
        onSuccess: () => toast({ kind: 'info', title: 'Request withdrawn', message: `${p.name} won’t see it anymore.` }),
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

  /* A decline is deliberately quiet: it changes two lists and tells nobody. */
  const onDecline = () => {
    decline.mutate(p.id, {
      onSuccess: () => toast({ kind: 'info', title: 'Request declined', message: `${p.name} won’t be told.` }),
      onError: (e) => toast({ kind: 'error', title: 'Couldn’t decline', message: (e as Error).message }),
    });
  };

  /* What the one control is, right now. Kept in one place so the bar and the
     pill in the hero can never disagree about the same pair. */
  const addUp: { label: string; done: boolean } = p.crush.mutual
    ? { label: 'Connected', done: true }
    : p.crush.received
      ? { label: 'Accept', done: false }
      : p.crush.sent
        ? { label: 'Request sent', done: true }
        : { label: 'Add up', done: false };
  const addUpBusy = pendingId === p.id || accept.isPending || undo.isPending;

  const lifestyle = lifestyleFacts(p);

  const spaceActions = [
    { label: 'Share Space', icon: <Ionicons name="share-outline" size={20} color={colors.textSecondary} />, immediateOnWeb: true, onPress: () => { void shareSpaceLink(p.id).then((result) => { if (result === 'copied') toast({ kind: 'success', title: 'Link copied' }); }).catch(() => toast({ kind: 'error', title: 'Couldn’t share link' })); } },
    { label: 'Copy Space link', icon: <Ionicons name="copy-outline" size={20} color={colors.textSecondary} />, hint: 'Space privacy still applies', immediateOnWeb: true, onPress: () => { void copySpaceLink(p.id).then(() => toast({ kind: 'success', title: 'Link copied' })).catch(() => toast({ kind: 'error', title: 'Couldn’t copy link' })); } },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, space.md) + space.lg }}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          const next = contentOffset.y > heroH - (insets.top + 64);
          if (next !== scrolled) setScrolled(next);
          /* A Space holds more than one page. When the reader gets within a
             screen of the end, the next page is asked for — the list below is
             long enough that nothing else would ever ask. */
          if (tab === 'crushes' && contentOffset.y + layoutMeasurement.height >= contentSize.height - 600) {
            posts.loadOlder();
          }
        }}
        scrollEventThrottle={16}
      >
        <View style={{ width: heroW, height: heroH, alignSelf: 'center', position: 'relative', overflow: 'hidden', backgroundColor: hasBanner ? '#0A0710' : colors.bg }}>
          {bannerPending ? (
            <Skeleton style={{ width: heroW, height: heroH, borderRadius: 0 }} />
          ) : bannerUrl ? (
            <>
              <Image source={mediaSource(mediaUrl(bannerUrl))} style={{ width: heroW, height: heroH }} contentFit="cover" cachePolicy="none" accessibilityLabel={`${p.name}’s Space banner`} />
              <LinearGradient pointerEvents="none" colors={[`${colors.bg}00`, `${colors.bg}18`, `${colors.bg}85`, colors.bg]} locations={[0, 0.32, 0.72, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.min(heroH * 0.48, 150) }} />
            </>
          ) : null}
        </View>

        {/*
          The face, overlapping the cover the way a profile picture is meant to.
          It carries the Moments ring when there is something to watch, so the
          ring is still the way in — it just is not a second avatar floating in
          the middle of a name line.

          Three states, the same three the Moments row uses: a coloured ring for
          something you have not watched, a quiet ring for something you have,
          and no ring at all when there is nothing live. A viewed Moment keeps
          its ring because the door is still there; it just stops shouting.
        */}
        <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter }}>
          {/* The face stands on the edge of the cover by half, alone on its own
              line. The name used to sit beside it, so on a narrow phone a long
              name and two chips had to fit in whatever width the face left —
              the row leaned on the photograph and on the face. Everything under
              the face is a column now: no line is asked to share space it does
              not have. */}
          <View style={{ marginTop: -(FACE / 2 + 4), flexDirection: 'row', alignItems: 'flex-start' }}>
            <Pressable
              onPress={onFacePress}
              accessibilityRole="button"
              accessibilityLabel={p.moments.length ? `Open ${p.name}’s photo or Moments` : `See ${p.name}’s photo`}
            >
              {/* Two rings, both even: a coloured one only when there is a
                  Moment behind the door, a plain one when there is not. The
                  ring used to be laid down under the face with a screen of
                  background colour between them, so a corner of it showed at
                  the edge of the picture like something hiding behind it.
                  On your own Space there is no ring at all: it is a door to
                  your own Moments, which the tab underneath already opens, and
                  on your own picture it reads as a shape stuck behind it. */}
              {!mine && p.moments.length ? (
                <LinearGradient
                  colors={momentSeen ? [MOMENT_RING_SEEN, MOMENT_RING_SEEN] : [colors.gold, colors.crush, colors.goldDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ width: FACE + 9, height: FACE + 9, borderRadius: (FACE + 9) / 2, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View style={{ padding: 2.5, borderRadius: FACE, backgroundColor: colors.bg }}>
                    <Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={FACE} />
                  </View>
                </LinearGradient>
              ) : (
                <View style={{ padding: 2.5, borderRadius: FACE, backgroundColor: colors.bg }}>
                  <Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={FACE} />
                </View>
              )}
            </Pressable>
          </View>

          {/* The name, and the two things you can do about this person —
              one of them a chip, not a card. */}
          <View style={{ marginTop: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {p.name}
                  {p.age ? <Txt variant="title" color="textSecondary">{`, ${p.age}`}</Txt> : null}
                </Txt>
                <VerifiedBadge size={18} tier={p.badgeTier ?? (p.verified ? 'verified' : 'none')} />
              </View>

              </View>
              {/* The action a visitor came for, in the product's own colour and
                  on the right, where a follow lives on every app anybody has
                  used — a rectangle, not a chip hidden under a name. It used to
                  be a small chip in the row below, which read as a label rather
                  than a button. */}
              {mine ? null : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <Pressable
                  onPress={p.crush.mutual ? message : onCrush}
                  accessibilityRole="button"
                  accessibilityLabel={
                    p.crush.mutual ? `Whisper ${p.name}` : p.crush.received ? `Accept ${p.name}’s Add Up request`
                      : p.crush.sent ? 'Withdraw your Add Up request' : `Add up with ${p.name}`
                  }
                  disabled={addUpBusy}
                  hitSlop={6}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 16, paddingVertical: 10,
                    borderRadius: radius.sm,
                    backgroundColor: addUp.done ? colors.elevated : colors.primary,
                    borderWidth: 1,
                    borderColor: addUp.done ? colors.border : colors.primaryDeep,
                    opacity: addUpBusy ? 0.6 : 1,
                  }}
                >
                  {addUpBusy ? (
                    <ActivityIndicator size="small" color={addUp.done ? colors.text : '#FFFFFF'} />
                  ) : addUp.done ? (
                    <Ionicons name="checkmark" size={16} color={colors.text} />
                  ) : (
                    /* The mark, not a plus. A plus is what every app in the
                       store uses for "create", and on somebody's Space the one
                       action is the product's own gesture — so it wears the
                       product's own icon, the same one the whistle in the app
                       wears. */
                    <CrushIcon size={16} color="#FFFFFF" />
                  )}
                  <Txt variant="smallStrong" style={{ color: addUp.done ? colors.text : '#FFFFFF' }}>
                    {p.crush.mutual ? 'Whisper' : addUp.label}
                  </Txt>
                </Pressable>

                {/* One row, two doors, and the second one is the answer to a
                    request when there is a request to answer. This used to be a
                    footer pinned to the bottom of the page with the same Add up
                    in it — the one action drawn twice, a screen apart, and the
                    footer covered the last post as you read to the end. The
                    header is always on screen, so the footer is gone and what
                    was in it lives here. */}
                {p.crush.mutual ? null : p.crush.received ? (
                  <IconButton
                    icon="close-outline"
                    label={`Decline ${p.name}’s Add Up request`}
                    size={40}
                    variant="surface"
                    color={colors.textMuted}
                    onPress={onDecline}
                  />
                ) : (
                  <IconButton
                    icon="chatbubble-outline"
                    label={p.canMessage ? `Whisper ${p.name}` : `Messaging ${p.name} needs them to add back`}
                    size={40}
                    variant="surface"
                    color={p.canMessage ? colors.text : colors.textMuted}
                    onPress={message}
                  />
                )}
                </View>
              )}
            </View>

            {/* The handle, and the facts that read with it, sit under the name —
                the chips come after, so nothing of the identity block ends up
                below something that is only an action. */}
            <Txt variant="small" color="textSecondary" style={{ marginTop: space.xs }}>
              {[p.username ? `@${p.username}` : null, p.city, p.distance, p.pronouns].filter(Boolean).join('  ·  ')}
            </Txt>
            {relationship.data ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm, flexWrap: 'wrap' }}>
              {([['addUps', 'Add Ups', relationship.data.addUps, relationship.data.canViewAddUps], ['keptClose', 'Kept Close', relationship.data.keptClose, relationship.data.canViewKeptClose]] as const).map(([kind, label, count, canView]) => canView ? <Pressable key={kind} onPress={() => { setListOpenSequence(n => n + 1); setRelationshipList(kind); }} accessibilityRole="button" accessibilityLabel={`${count} ${label}. View people`}><Txt variant="small"><Txt variant="smallStrong">{formatCount(count)}</Txt> {label}</Txt></Pressable> : <Txt key={kind} variant="small"><Txt variant="smallStrong">{formatCount(count)}</Txt> {label}</Txt>)}
              {mine ? <Pressable accessibilityRole="button" accessibilityLabel="Add Up list privacy" onPress={() => setVisibilityMenu(true)}><Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} /></Pressable> : null}
            </View> : relationship.isError ? <Pressable accessibilityRole="button" onPress={() => void relationship.refetch()}><Txt variant="small" color="textSecondary">Couldn’t load counts. Tap to retry</Txt></Pressable> : null}
            {p.bio ? <View style={{ marginTop: space.sm }}>
              <Txt variant="body" numberOfLines={showFullBio ? undefined : 3}><LinkText text={p.bio} bare /></Txt>
              {p.bio.length > 80 ? <Pressable onPress={() => setShowFullBio((open) => !open)} accessibilityRole="button" accessibilityLabel={showFullBio ? 'Show less bio' : 'Show full bio'}><Txt variant="small" color="gold">{showFullBio ? 'Show less' : 'Show more'}</Txt></Pressable> : null}
            </View> : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.xs, flexWrap: 'wrap' }}>
                {/* Keep Close and Crush are things one member does to another.
                    On your own Space there was a gold "Edit Space" chip here as
                    well as the pencil in the header — two doors to one room,
                    four pixels apart. The header is pinned and always in reach,
                    so the chip is gone and the pencil is the only way in. */}
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
                </>
                )}
              </View>
          </View>

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
                <Pill tone="crush" label="Both added up" icon={<Ionicons name="heart" size={11} color={colors.crush} />} />
              ) : p.crush.received ? (
                <Pill
                  tone="crush"
                  label={p.crush.receivedDeep ? 'Big Up from them' : 'Added up with you'}
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
                Big Up note
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
                { id: 'crushes' as const, label: 'Crushes' },
                { id: 'moments' as const, label: 'Moments' },
                { id: 'circles' as const, label: 'Circles' },
                { id: 'about' as const, label: 'About' },
              ]}
              active={tab}
              onChange={setTab}
              accessibilityLabel={`${p.name}’s Space`}
            />
            <View style={{ height: 1, backgroundColor: colors.border, marginTop: space.xs }} />
            <View style={{ marginTop: space.md }}>
            <SwipeTabs
              options={['crushes', 'moments', 'circles', 'about'] as const}
              value={tab}
              onChange={setTab}
              width={contentWidth - gutter * 2}
            >
            {tab === 'crushes' ? (
              <SpacePosts
                items={posts.posts}
                loading={posts.isLoading}
                loadingMore={posts.isFetchingNextPage}
                failed={posts.isError}
                name={p.name}
                onRetry={() => void posts.refresh()}
                onOpen={(postId) => navigation.navigate('PostViewer', { postId })}
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
              <View style={{ gap: space.sm }}>
                {/* The room you start, and the rooms you are in, live on one
                    page — and until now that page had no door on the Space it
                    belongs to. Two actions, one page. */}
                {mine ? (
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Button
                        title="Start a Circle"
                        variant="secondary"
                        size="sm"
                        icon="add"
                        onPress={() => navigation.navigate('Circles', { create: true })}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Button
                        title="All your Circles"
                        variant="ghost"
                        size="sm"
                        onPress={() => navigation.navigate('Circles')}
                      />
                    </View>
                  </View>
                ) : null}
                  <SpaceCircles
                  items={(mine ? mineCircles.data?.items : theirCircles.data?.items) ?? []}
                  loading={mine ? mineCircles.isLoading : theirCircles.isLoading}
                  onOpen={(circleId) => navigation.navigate('Circle', { circleId })}
                  onPreview={(circleId) => navigation.navigate('CirclePreview', { circleId })}
                />
              </View>
            ) : null}
            {tab === 'about' ? (
              <SpaceAbout
                profile={p}
                lifestyle={lifestyle}
                mine={mine}
                onReport={mine ? undefined : () => openActions(member)}
              />
            ) : null}
            </SwipeTabs>
            </View>
          </View>

          {/* Nothing below this line. The page is the four tabs and stops: the
              words, the interests and the facts are the About tab now, and the
              visitor's report link moved in there with them. */}
        </View>
      </ScrollView>

      {/* --------------------------------------------- the face, full screen
          The picture on its own, nothing over it: the same photograph the cover
          shows, at the size it was taken, one tap to put away. */}
      <Modal visible={photoOpen} animationType="fade" onRequestClose={() => setPhotoOpen(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: index * width, y: 0 }}
            onScroll={onScroll}
            scrollEventThrottle={32}
          >
            {(p.photos.length ? p.photos : [{ id: 0, url: '' }]).map((ph, i) => (
              <Pressable key={ph.id} onPress={() => setPhotoOpen(false)} accessibilityRole="button" accessibilityLabel="Close the picture" style={{ width, height: windowH, alignItems: 'center', justifyContent: 'center' }}>
                <Photo uri={ph.url || null} fit="contain" style={{ width, height: windowH }} alt={`${p.name}, photo ${i + 1} of ${p.photos.length}`} priority="high" />
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ position: 'absolute', top: insets.top + space.sm, right: gutter }}>
            <IconButton icon="close" label="Close the picture" variant="glass" onPress={() => setPhotoOpen(false)} />
          </View>
          {p.photos.length > 1 ? (
            <View style={{ position: 'absolute', bottom: insets.bottom + space.lg, left: 0, right: 0, flexDirection: 'row', gap: 4, justifyContent: 'center' }}>
              {p.photos.map((ph, i) => (
                <View key={ph.id} style={{ width: 22, height: 3, borderRadius: 2, backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.35)' }} />
              ))}
            </View>
          ) : null}
        </View>
      </Modal>

      {/* ---------------------------------------------- the two doors, chosen
          A face with Moments behind it is two doors. The first tap opens the
          Moments, because that is what the ring promises. From then on the tap
          asks, and this is where it asks. */}
      <BottomSheet visible={faceMenu} onClose={() => setFaceMenu(false)} title={p.name} subtitle="What would you like to see?">
        <Pressable
          onPress={() => { setFaceMenu(false); setPhotoOpen(true); }}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}
        >
          <Ionicons name="image-outline" size={22} color={colors.text} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">View profile picture</Txt>
            <Txt variant="caption" color="textSecondary">{p.photos.length > 1 ? `${p.photos.length} photos` : 'The picture on the cover'}</Txt>
          </View>
        </Pressable>
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Pressable
          onPress={() => { setFaceMenu(false); momentsOpened.add(p.id); navigation.navigate('MomentViewer', { userId: p.id, mine }); }}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}
        >
          <Ionicons name="play-circle-outline" size={22} color={colors.text} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{mine ? 'View your Moments' : `View ${p.name}’s Moments`}</Txt>
            <Txt variant="caption" color="textSecondary">{p.moments.length === 1 ? '1 Moment live' : `${p.moments.length} Moments live`}</Txt>
          </View>
        </Pressable>
        <Button title="Cancel" variant="ghost" onPress={() => setFaceMenu(false)} style={{ marginTop: space.sm }} />
      </BottomSheet>

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
        {!scrolled && hasBanner ? (
          <LinearGradient
            colors={['rgba(7,7,8,0.38)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 96 }}
            pointerEvents="none"
          />
        ) : null}
        <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* The same corner, whoever is reading. A visitor gets the way back;
              the owner gets the gear. Neither ever sees both.

              The icon language, so nobody has to guess twice:
                ⚙️  a gear always opens settings — here, the whole of Settings.
                ✏️  a pencil always edits the thing behind it — here, your Space.
              The gear on Notifications opens notification settings for the same
              reason: a gear means settings, wherever it is drawn. */}
          {mine ? (
            <IconButton icon="settings-outline" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="Settings" onPress={() => navigation.navigate('Settings')} />
          ) : goBack ? (
            <IconButton icon="chevron-back" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="Go back" onPress={goBack} />
          ) : null}
          <View style={{ flex: 1 }} />
          {mine ? (
            <IconButton icon="bookmark-outline" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="Picked" onPress={() => navigation.navigate('SavedPosts')} />
          ) : null}
          {mine ? <IconButton icon="ellipsis-horizontal" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="More Space options" onPress={() => setSpaceMenu(true)} /> : null}
          {mine ? (
            <IconButton icon="create-outline" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="Edit Space" onPress={() => navigation.navigate('EditProfile')} />
          ) : (
            <IconButton icon="ellipsis-horizontal" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label={`More options for ${p.name}`} onPress={() => openActions(member, spaceActions)} />
          )}
        </View>
      </View>
      <ActionSheet visible={spaceMenu} onClose={() => setSpaceMenu(false)} title="Your Space" actions={spaceActions} />
      <ActionSheet visible={visibilityMenu} onClose={() => setVisibilityMenu(false)} title="Who can see your Add Ups?" actions={([
        ['everyone', 'Everyone who can view your Space'], ['close', 'Mutual Close Ones'], ['private', 'Only you'],
      ] as [AddUpListVisibility, string][]).map(([value, label]) => ({ label: `${relationship.data?.addUpVisibility === value ? '✓ ' : ''}${label}`, hint: 'Totals stay visible. Individual Spaces still follow their privacy settings.', onPress: () => visibilityMutation.mutate(value) }))} />
      <SpaceRelationshipList targetId={p.id} viewerId={meQ.data?.id ?? 0} kind={relationshipList} openSequence={listOpenSequence} onClose={() => setRelationshipList(null)} onOpen={(personId) => { setRelationshipList(null); setTimeout(() => navigation.navigate('UserProfile', { id: personId }), Platform.OS === 'web' ? 0 : 250); }} />
    </View>
  );
}

function SpaceRelationshipList({ targetId, viewerId, kind, openSequence, onClose, onOpen }: { targetId: number; viewerId: number; kind: 'addUps' | 'keptClose' | null; openSequence: number; onClose: () => void; onOpen: (id: number) => void }) {
  const { colors } = useTheme();
  const q = useInfiniteQuery({
    queryKey: ['space-relationship-people', viewerId, targetId, kind, openSequence], enabled: !!kind && !!viewerId,
    initialPageParam: 0, queryFn: ({ pageParam }) => spaceRelationshipPeople(targetId, kind!, pageParam),
    getNextPageParam: (last, pages) => last.hasMore ? pages.reduce((n, page) => n + page.items.length, 0) : undefined,
    staleTime: 0, gcTime: 0, refetchInterval: 15_000,
  });
  const people = q.data?.pages.flatMap((page) => page.items) ?? [];
  return <BottomSheet visible={!!kind} onClose={onClose} title={kind === 'keptClose' ? 'Kept Close' : 'Add Ups'}>
    <Txt variant="small" color="textSecondary">People whose Spaces are private or unavailable to you may not appear.</Txt>
    {q.isLoading && kind ? <LoadingBlock label="Loading people" /> : q.isError ? <ErrorState error={q.error} message="Couldn’t load people." onRetry={() => void q.refetch()} /> : people.length === 0 ? <EmptyState title="No people to show" /> : <View style={{ gap: 8, paddingTop: space.sm }}>
      {people.map((person) => <Pressable key={person.id} onPress={() => onOpen(person.id)} accessibilityRole="button" accessibilityLabel={`Open ${person.name}’s Space`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}><Avatar uri={person.photos[0]?.url ?? null} name={person.name} size={42} /><View><Txt variant="bodyStrong">{person.name}</Txt>{person.username ? <Txt variant="small" color="textSecondary">@{person.username}</Txt> : null}</View></Pressable>)}
      {q.hasNextPage ? <Button title="Show more" variant="ghost" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </View>}
  </BottomSheet>;
}

/* ------------------------------------------------------- the three panels */

/** What they have posted. On this product a post is a Crush. */
function SpacePosts({
  items,
  loading,
  loadingMore,
  failed,
  name,
  onRetry,
  onOpen,
}: {
  items: Post[];
  loading: boolean;
  loadingMore?: boolean;
  failed: boolean;
  name: string;
  onRetry: () => void;
  onOpen: (postId: number) => void;
}) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const cols = 3;
  const gap = 6;
  const tile = (contentWidth - gutter * 2 - gap * (cols - 1)) / cols;
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
        title="Couldn’t load their Crushes"
        message="This is usually the connection, not the post."
        action={{ label: 'Try again', onPress: onRetry }}
      />
    );
  }
  if (!shown.length) {
    return (
      <EmptyState
        icon="heart-outline"
        title="Nothing shared yet"
        message={`${name} hasn’t shared anything yet. What they share lands here.`}
      />
    );
  }
  /**
   * A Space is a shelf, not a feed.
   *
   * Scrolling somebody's page used to feel exactly like scrolling Crushes: full
   * cards, one after another, with the same weight as the timeline. It is not
   * the same thing. A Space is where you choose what to watch, so it is a wall
   * of tall tiles — the clip's own first frame, the words over it, and nothing
   * else — and tapping one opens it full screen. That is also what makes a page
   * of twenty posts readable in one look instead of twenty swipes.
   */
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {shown.map((post) => (
          <Pressable
            key={post.id}
            onPress={() => onOpen(post.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}’s post${post.body ? `: ${post.body}` : ''}`}
            style={({ pressed }) => ({ width: tile, opacity: pressed ? 0.85 : 1 })}
          >
            <View
              style={{
                width: tile,
                height: tile * 1.34,
                borderRadius: radius.sm,
                overflow: 'hidden',
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {post.mediaKind === 'video' && post.mediaUrl ? (
                <ClipThumb uri={mediaUrl(post.mediaUrl) ?? ''} style={{ width: '100%', height: '100%' }} />
              ) : post.mediaUrl ? (
                <Photo uri={post.mediaUrl} fit="cover" style={{ width: '100%', height: '100%' }} alt="" />
              ) : (
                <View style={{ flex: 1, padding: 8, justifyContent: 'center' }}>
                  <Txt variant="caption" color="textSecondary" numberOfLines={4}>
                    {post.body}
                  </Txt>
                </View>
              )}

              {post.mediaKind === 'video' && post.mediaUrl ? (
                <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(7,7,8,0.55)', borderRadius: 999, padding: 4 }}>
                  <Ionicons name="play" size={11} color="#FFFFFF" />
                </View>
              ) : null}

              {post.body && post.mediaUrl ? (
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 7, paddingVertical: 6, backgroundColor: 'rgba(7,7,8,0.58)' }}>
                  <Txt variant="caption" color="#FFFFFF" numberOfLines={2}>
                    {post.body}
                  </Txt>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
      {/* The end of a Space is not the end of the posts. This is the quiet
          promise that the next page is on its way. */}
      {loadingMore ? <Skeleton style={{ height: tile * 1.34, borderRadius: radius.sm, marginTop: gap }} /> : null}
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
  onPreview,
}: {
  items: {
    id: number;
    name: string;
    about: string;
    theme?: string | null;
    visibility?: string;
    discoverable?: boolean;
    joinPolicy?: 'request' | 'open' | 'invite';
    memberCount: number;
    joined?: boolean;
    myRole?: string;
  }[];
  loading?: boolean;
  onOpen: (id: number) => void;
  onPreview: (id: number) => void;
}) {
  const { colors } = useTheme();
  if (loading) return <Txt variant="small" color="textMuted" style={{ paddingVertical: space.md }}>Loading Circles…</Txt>;
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
        <SpaceCircleRow key={c.id} circle={c} onOpen={onOpen} onPreview={onPreview} />
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
  onPreview,
}: {
  circle: {
    id: number;
    name: string;
    about: string;
    theme?: string | null;
    visibility?: string;
    discoverable?: boolean;
    joinPolicy?: 'request' | 'open' | 'invite';
    memberCount: number;
    joined?: boolean;
    myRole?: string;
  };
  onOpen: (id: number) => void;
  onPreview: (id: number) => void;
}) {
  const { colors } = useTheme();
  const theme = resolveTheme(c.theme);
  const discoverable = c.discoverable ?? c.visibility === 'public';
  const policy = c.joinPolicy ?? 'request';
  // `member_circles` marks you as a visitor when you are not in the room, and
  // `my_circles` only ever returns your own — so "am I in this" is one question
  // with two sources.
  const isMember = c.joined ?? (c.myRole ? c.myRole !== 'visitor' : false);
  const action = joinAction({ state: isMember ? 'member' : 'none', joinPolicy: policy, full: c.memberCount >= 12 });

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
        onPress={() => (isMember ? onOpen(c.id) : onPreview(c.id))}
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
            {isMember ? (
              <Txt variant="caption" color="gold">
                Yours
              </Txt>
            ) : null}
          </View>
          <Txt variant="caption" color="textMuted" numberOfLines={1}>
            {[
              theme?.label,
              `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`,
              discoverable ? policyLabel(policy) : 'Private',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
        </View>
      </Pressable>
      {/* One door, and it is the room's own page: the button there knows exactly
          where you stand, which a row on somebody's Space cannot. */}
      {isMember ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      ) : discoverable ? (
        <Button
          title={action.kind === 'pending' ? 'Request sent' : action.label}
          variant={action.pressable ? 'outline' : 'ghost'}
          size="sm"
          full={false}
          disabled={!action.pressable}
          onPress={() => onPreview(c.id)}
        />
      ) : (
        <Ionicons name="lock-closed-outline" size={15} color={colors.textMuted} />
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

/**
 * The About tab: who they are, in their own words and in their own facts.
 *
 * This is what used to sit under the post list as loose prose — which made a
 * Space a page that never ended, where you scrolled past somebody's last post
 * and kept walking through their biography. It is a tab now, so the page stops
 * where the content stops, and a visitor who wants the words asks for them.
 *
 * The report/block link belongs to the visitor and lives at the bottom of this
 * tab rather than under everything: it is the last thing on the page, not a
 * fifth thing to scroll past.
 */
function SpaceAbout({
  profile: p,
  lifestyle,
  mine,
  onReport,
}: {
  profile: FullProfile;
  lifestyle: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[];
  mine: boolean;
  onReport?: () => void;
}) {
  const { colors } = useTheme();
  const hasWords = Boolean(p.bio) || p.intentions.length > 0 || Boolean(p.relationshipIntention);
  const empty = !hasWords && p.interests.length === 0 && lifestyle.length === 0;

  if (empty && !onReport) {
    return (
      <EmptyState
        icon="person-outline"
        title="Nothing here yet"
        message={
          mine
            ? 'Add a few words, what you are looking for, and a few interests. This is the page people read before they send you a Crush.'
            : `${p.name} hasn’t filled this in yet.`
        }
      />
    );
  }

  return (
    <View style={{ gap: space.lg }}>
      {p.bio ? <Txt variant="body"><LinkText text={p.bio} bare /></Txt> : null}

      {hasWords && (p.intentions.length || p.relationshipIntention) ? (
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

      {lifestyle.length ? (
        <Section title="About me">
          {lifestyle.map((f) => (
            <Fact key={f.label} {...f} />
          ))}
        </Section>
      ) : null}

      {onReport ? (
        <View style={{ marginTop: space.md, flexDirection: 'row', justifyContent: 'center' }}>
          <Pressable onPress={onReport} accessibilityRole="button" accessibilityLabel={`Report or block ${p.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 }}>
            <Ionicons name="flag-outline" size={15} color={colors.textMuted} />
            <Txt variant="smallStrong" color="textMuted">
              Report or block {p.name}
            </Txt>
          </Pressable>
        </View>
      ) : null}
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
