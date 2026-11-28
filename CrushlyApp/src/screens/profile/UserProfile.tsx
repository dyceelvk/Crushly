import React, { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spaceRelationshipStats, spaceRelationshipPeople, setAddUpListVisibility, setFollowSettings, publicFlow, type AddUpListVisibility } from '../../api/service';
import { formatCount } from '../../lib/counts';
import { SpaceNavigation } from '../../navigation/SpaceNavigation';
import { ActivityIndicator, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Wordmark } from '../../components/Logo';
import { FollowButton } from '../../components/FollowButton';
import { HomieButton } from '../../components/HomieButton';
import { IdentitySection } from '../../components/IdentityCard';
import { homieStats, homieRequests, recordSpaceView, respondHomie } from '../../api/service';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { copySpaceLink, shareSpaceLink } from '../../lib/spaceShareActions';
import { copyProfileLink, shareProfileLink } from '../../lib/profileShareActions';
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
import { useOpenConversation, useSpacePosts, useUser } from '../../api/hooks';
import type { FullProfile, MomentSummary } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScreenProps, RootStackParamList } from '../../navigation/types';
import { keys, useMe, useMoments, useMyCircles, useSpaceBanner } from '../../api/hooks';
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

/** Diameter of the round face beside the name, as the mock-up draws it. */
const FACE = 104;

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
  const open = useOpenConversation();
  const { openActions } = useMemberActions();
  const [index, setIndex] = useState(0);
  /** The full-screen picture, and the chooser that decides which door opens. */
  const [photoOpen, setPhotoOpen] = useState(false);
  const [faceMenu, setFaceMenu] = useState(false);
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [relationshipList, setRelationshipList] = useState<'addUps' | 'addedUp' | 'keptClose' | null>(null);
  const [listOpenSequence, setListOpenSequence] = useState(0);
  const [visibilityMenu, setVisibilityMenu] = useState(false);
  const [shareSheet, setShareSheet] = useState(false);
  const [outgoingMenu, setOutgoingMenu] = useState(false);
  const [homieRequestsOpen, setHomieRequestsOpen] = useState(false);
  const qc = useQueryClient();
  const [showFullBio, setShowFullBio] = useState(false);

  /**
   * Opening somebody's Space is the one thing the feed's ring could never learn
   * any other way: there was no record of it anywhere. It is written once per
   * visit, silently, and only ever read back by this member's own ring — the
   * person whose Space it is has no way to see it.
   *
   * Refreshing the ring afterwards is what makes the row feel alive: open a
   * stranger's Space, come back, and if they have a Moment live their face is
   * there, because you have now come across them.
   */
  useEffect(() => {
    if (mine || !id) return;
    let live = true;
    void recordSpaceView(id)
      .then((ok) => {
        if (live && ok) void qc.invalidateQueries({ queryKey: keys.momentCircles });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [mine, id, qc]);

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
  const homies = useQuery({
    queryKey: ['holup-homie-stats', meQ.data?.id, spaceId], queryFn: () => homieStats(spaceId),
    enabled: !!meQ.data?.id && spaceId > 0, staleTime: 0, refetchInterval: 30_000,
  });
  /* How many people opened this Space. Only ever asked for your own: the
     database would refuse the question about somebody else, so the app does not
     ask it. The number is a door to the full list, not a statistic to admire. */
  const visibilityMutation = useMutation({ mutationFn: setAddUpListVisibility,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['space-relationship-stats'] }); toast({kind: 'success', title: 'Privacy updated'}); },
    onError: (e) => toast({kind:'error', title:'Couldn’t update privacy', message:(e as Error).message}),
  });

  const followSettingsMutation = useMutation({ mutationFn: ({approval, visibility}: {approval: boolean | null; visibility: AddUpListVisibility | null}) => setFollowSettings(approval, visibility),
    onSuccess: () => { void qc.invalidateQueries({queryKey: ['space-relationship-stats']}); toast({kind:'success', title:'Privacy updated'}); },
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
  // Banner and plain cover share the same horizontal band: the avatar never moves.
  const heroH = insets.top + 105;

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

  const lifestyle = lifestyleFacts(p);

  /* Two links, because they answer two different questions.
     `holupp.net/u/<handle>` is the public one: it opens a real page with the
     member's name, bio and seal, and it is the link to post in a group chat.
     The token link is the narrower one — it works even when the Space is not
     open to everyone, and revoking it kills every copy in circulation. */
  const sharePublic = () => { void shareProfileLink(p.username || '').then((result) => { if (result === 'copied') toast({ kind: 'success', title: 'Link copied' }); }).catch(() => toast({ kind: 'error', title: 'Couldn’t share link', message: 'This Space needs a handle first.' })); };
  const copyPublic = () => { void copyProfileLink(p.username || '').then(() => toast({ kind: 'success', title: 'Link copied' })).catch(() => toast({ kind: 'error', title: 'Couldn’t copy link', message: 'This Space needs a handle first.' })); };

  const spaceActions = [
    { label: 'Share Space', icon: <Ionicons name="share-outline" size={20} color={colors.textSecondary} />, immediateOnWeb: true, onPress: sharePublic },
    { label: 'Copy Space link', icon: <Ionicons name="copy-outline" size={20} color={colors.textSecondary} />, hint: p.username ? `holupp.net/u/${p.username}` : 'Space privacy still applies', immediateOnWeb: true, onPress: copyPublic },
    ...(p.username ? [{
      label: 'Send a private link',
      icon: <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />,
      hint: 'Works even if this Space is not open to everyone',
      immediateOnWeb: true,
      onPress: () => { void copySpaceLink(p.id).then(() => toast({ kind: 'success', title: 'Private link copied' })).catch(() => toast({ kind: 'error', title: 'Couldn’t copy link' })); },
    }] : []),
    ...(p.username ? [{
      label: 'Share private link',
      icon: <Ionicons name="paper-plane-outline" size={20} color={colors.textSecondary} />,
      immediateOnWeb: true,
      onPress: () => { void shareSpaceLink(p.id).then((result) => { if (result === 'copied') toast({ kind: 'success', title: 'Private link copied' }); }).catch(() => toast({ kind: 'error', title: 'Couldn’t share link' })); },
    }] : []),
  ];
  const ownerMenuActions = [
    { label: 'Edit Profile', icon: <Ionicons name="create-outline" size={20} color={colors.textSecondary} />, onPress: () => navigation.navigate('EditProfile') },
    { label: 'Settings', icon: <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />, onPress: () => navigation.navigate('Settings') },
    { label: 'Picked', icon: <Ionicons name="bookmark-outline" size={20} color={colors.textSecondary} />, onPress: () => navigation.navigate('SavedPosts') },
    { label: 'Homie requests', icon: <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />, onPress: () => setHomieRequestsOpen(true) },
    { label: 'Who can see your Add Ups', icon: <Ionicons name="eye-outline" size={20} color={colors.textSecondary} />, onPress: () => setVisibilityMenu(true) },
    { label: 'Who can see people you added up', icon: <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />, onPress: () => setOutgoingMenu(true) },
    ...spaceActions,
  ];
  const visitorMenuActions = [
    { label: `Whisper ${p.name}`, icon: <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />, onPress: message },
    ...spaceActions,
  ];


  return (
    <View style={{ flex: 1 }}>
      {/* ── The wash ─────────────────────────────────────────────────────────
          A quiet plum dawn over the top of the Space, as the profile mock-up
          draws it: a dark plum glow behind the name and the face, settling into
          the page's own near-black well before the tabs. It sits behind
          everything and takes no touches.

          In light mode the same stops sit over cream at the brand's softer
          opacities. Both are the palette's colours — nothing here is a new
          colour invented for this screen. */}
      <LinearGradient
        pointerEvents="none"
        colors={
          colors.scheme === 'dark'
            ? ['rgba(122,64,140,0.32)', 'rgba(140,80,170,0.16)', 'rgba(237,89,175,0.07)', 'rgba(11,7,12,0)']
            : ['rgba(255,170,150,0.62)', 'rgba(255,159,197,0.48)', 'rgba(214,168,240,0.34)', 'rgba(255,248,248,0)']
        }
        locations={[0, 0.3, 0.6, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(heroH + 380, 560) }}
      />
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
        {/* A cover, only for the Spaces that have one. The mock-up draws no
            cover at all — the wash is the backdrop — so a Space without a
            banner starts straight on the name, with no empty band and no hard
            line across the gradient. */}
        {hasBanner || bannerPending ? (
        <View style={{ width: heroW, height: heroH, alignSelf: 'center', position: 'relative', overflow: 'hidden', backgroundColor: '#0A0710' }}>
          {bannerPending ? (
            <Skeleton style={{ width: heroW, height: heroH, borderRadius: 0 }} />
          ) : bannerUrl ? (
            <>
              <Image source={mediaSource(mediaUrl(bannerUrl))} style={{ width: heroW, height: heroH }} contentFit="cover" cachePolicy="none" accessibilityLabel={`${p.name}’s Space banner`} />
              <LinearGradient pointerEvents="none" colors={[`${colors.bg}00`, `${colors.bg}18`, `${colors.bg}85`, colors.bg]} locations={[0, 0.32, 0.72, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.min(heroH * 0.48, 150) }} />
            </>
          ) : null}
        </View>
        ) : null}

        <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter, paddingTop: hasBanner || bannerPending ? space.sm : insets.top + 64 }}>
          {/* ── The identity block ───────────────────────────────────────────
              The mock-up's arrangement: the words own the left of the row —
              name, handle, pronouns, bio — and the face sits on the right,
              large and round. The name is the biggest thing on the page; the
              face is the picture of it.

              The face is still two doors at once — the photograph, and the
              Moments behind it — so the ring keeps its meaning: coloured when
              there is something unwatched, quiet once watched, absent when
              there is nothing to open. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginTop: space.xs }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1, fontSize: 24 }}>
                  {p.name}
                </Txt>
                <VerifiedBadge size={18} tier={p.badgeTier ?? (p.verified ? 'verified' : 'none')} />
              </View>
              {p.username ? (
                <Txt variant="small" color="textSecondary" numberOfLines={1} style={{ marginTop: 2 }}>
                  @{p.username}
                </Txt>
              ) : null}
              {p.pronouns ? (
                <Txt variant="small" color="textMuted" numberOfLines={1} style={{ marginTop: 1 }}>
                  {p.pronouns}
                </Txt>
              ) : null}
              {p.bio ? (
                <View style={{ marginTop: space.sm }}>
                  <Txt variant="body" numberOfLines={showFullBio ? undefined : 3}><LinkText text={p.bio} bare /></Txt>
                  {p.bio.length > 80 ? (
                    <Pressable onPress={() => setShowFullBio((open) => !open)} accessibilityRole="button" accessibilityLabel={showFullBio ? 'Show less bio' : 'Show full bio'}>
                      <Txt variant="small" color="gold">{showFullBio ? 'Show less' : 'Show more'}</Txt>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={onFacePress}
              accessibilityRole="button"
              accessibilityLabel={p.moments.length ? `Open ${p.name}’s photo or Moments` : `See ${p.name}’s photo`}
              style={{ marginTop: space.xs }}
            >
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
                /* The two-and-a-half point gap between the ring and the picture
                   is the page's own colour, so it has to be a colour: left
                   transparent it shows whatever is behind it, which on the wash
                   is a second, muddier ring. */
                <View style={{ padding: 2.5, borderRadius: FACE, backgroundColor: colors.bg }}>
                  <Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={FACE} />
                </View>
              )}
            </Pressable>
          </View>

          {/* ── The numbers ─────────────────────────────────────────────────
              Three, as the mock-up draws them: Add Ups, Added Up and Likes,
              each its own door (the Likes number explains itself in About),
              spread across the row with hairlines between. The Homies count
              lives beside the Homie pill below, and who opened the Space lives
              behind the eye at the top — so the row stays three clean columns.

              All Round Likes: posts + Moments + comments. On a backend older
              than the one that counts all three the field is absent and this
              falls back to post likes, so the row is never empty and never
              claims a number it cannot back. */}
          {relationship.data ? (
            <View style={{ flexDirection: 'row', alignItems: 'stretch', marginTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Pressable
                style={{ flex: 1, minWidth: 0, alignItems: 'center' }}
                onPress={() => { setListOpenSequence(n => n + 1); setRelationshipList('addUps'); }}
                accessibilityRole="button"
                accessibilityLabel={`${relationship.data.addUps} Add Ups. View people`}
              >
                <Txt variant="bodyStrong" style={{ fontSize: 19 }}>{formatCount(relationship.data.addUps)}</Txt>
                <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ fontSize: 11, marginTop: 2 }}>Add Ups</Txt>
              </Pressable>
              <View style={{ width: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              {typeof relationship.data.addedUp === 'number' ? (
                <Pressable
                  style={{ flex: 1, minWidth: 0, alignItems: 'center' }}
                  onPress={() => { setListOpenSequence(n => n + 1); setRelationshipList('addedUp'); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${relationship.data.addedUp} Added Up. View people`}
                >
                  <Txt variant="bodyStrong" style={{ fontSize: 19 }}>{formatCount(relationship.data.addedUp)}</Txt>
                  <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ fontSize: 11, marginTop: 2 }}>Added Up</Txt>
                </Pressable>
              ) : null}
              <View style={{ width: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              {typeof (relationship.data.allRoundLikes ?? relationship.data.postLikes) === 'number' ? (
                <View
                  style={{ flex: 1, minWidth: 0, alignItems: 'center' }}
                  accessibilityLabel={
                    typeof relationship.data.allRoundLikes === 'number'
                      ? `${relationship.data.allRoundLikes} likes received across posts, Moments and comments`
                      : `${relationship.data.postLikes} post likes`
                  }
                >
                  <Txt variant="bodyStrong" style={{ fontSize: 19 }}>{formatCount((relationship.data.allRoundLikes ?? relationship.data.postLikes)!)}</Txt>
                  <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ fontSize: 11, marginTop: 2 }}>Likes</Txt>
                </View>
              ) : null}
            </View>
          ) : relationship.isError ? (
            <Pressable accessibilityRole="button" onPress={() => void relationship.refetch()} style={{ marginTop: space.lg }}>
              <Txt variant="small" color="textSecondary">Tap to retry</Txt>
            </Pressable>
          ) : null}

          {/* ── One action row ───────────────────────────────────────────────
              The mock-up's row: the main act as a wide rounded button, and one
              square beside it for sharing. Edit Profile on your own Space; Add
              Up on somebody else's; Whisper when there is nothing left to add.
              Everything else — settings, privacy, requests — lives in the menu
              at the top right. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md }}>
            {mine ? (
              <Pressable
                onPress={() => navigation.navigate('EditProfile')}
                accessibilityRole="button"
                accessibilityLabel="Edit your profile"
                style={{ flex: 1, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 16, paddingVertical: 15, alignItems: 'center' }}
              >
                <Txt variant="bodyStrong" style={{ fontSize: 15.5 }}>Edit Profile</Txt>
              </Pressable>
            ) : p.crush.mutual ? (
              <Pressable
                onPress={message}
                accessibilityRole="button"
                accessibilityLabel={`Whisper ${p.name}`}
                style={{ flex: 1, borderRadius: 16, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={[colors.primary, colors.crushDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 16 }}
                >
                  <Ionicons name="chatbubble-outline" size={17} color="#fff" />
                  <Txt variant="bodyStrong" style={{ color: '#fff', fontSize: 15.5 }}>Whisper</Txt>
                </LinearGradient>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }}>
                <FollowButton id={p.id} name={p.name} variant="hero" />
              </View>
            )}
            <IconButton
              icon="share-outline"
              size={52}
              iconSize={22}
              variant="surface"
              label="Share this Space"
              onPress={() => setShareSheet(true)}
              style={{ borderRadius: 16 }}
            />
          </View>

          {/* ── The Homie row ───────────────────────────────────────────────
              The mock-up's chip and its count: the pill is the Homie control —
              the relationship, and the only one that asks permission — and the
              count beside it is the door to the list of them. Keep Close is a
              thing one member does to another, so the live control belongs to
              the visitor; on your own Space the chip is the door. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.md }}>
            {mine ? (
              <Pressable
                onPress={() => { setListOpenSequence(n => n + 1); setRelationshipList('keptClose'); }}
                accessibilityRole="button"
                accessibilityLabel="Your Homies. View people"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card }}
              >
                <Ionicons name="people" size={15} color={colors.text} />
                <Txt variant="smallStrong">Homie</Txt>
              </Pressable>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card }}>
                <HomieButton id={p.id} name={p.name} />
              </View>
            )}
            {homies.data ? (
              <Pressable
                onPress={() => { setListOpenSequence(n => n + 1); setRelationshipList('keptClose'); }}
                accessibilityRole="button"
                accessibilityLabel={`${homies.data.count} Homies. View people`}
              >
                <Txt variant="smallStrong" color="textSecondary">
                  {formatCount(homies.data.count)} {homies.data.count === 1 ? 'Homie' : 'Homies'}
                </Txt>
              </Pressable>
            ) : null}
          </View>

          {/* The state pills: presence and relationship facts, kept quiet under
              the Homie row where they never crowd the numbers. */}
          {(mine && meQ.data?.status === 'paused') || p.online || p.activity || p.crush.mutual || p.crush.received ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: space.sm, justifyContent: 'center' }}>
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
              {mine && meQ.data?.status === 'paused' ? <Pill tone="neutral" label="Hidden from Discover" /> : null}
            </View>
          ) : null}
        </View>

        {/* HolUpp Identity sits between the name block and the Big Up note, in
            the page's own flow: a label and one line, no card, no colour of its
            own. It renders nothing at all when there is nothing to say — a
            visitor sees no gap and no placeholder.

            `mine` is the only switch that matters here. Your own Space always
            shows your identity, including while it is still developing and
            including after you hide it from other people: hiding is a statement
            to strangers, not a way to hide from yourself. */}
        <IdentitySection memberId={p.id} mine={mine} />

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
              variant="accent"
            />
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
                /*
                 * The same door rule as everywhere else: words go to the page
                 * built for words, anything with a picture goes to the pager.
                 * Every tile used to open the pager, so a written post on your
                 * own Space dropped you into the Flow with nothing to show.
                 */
                onOpen={(post) =>
                  navigation.navigate(post.mediaUrl ? 'PostViewer' : 'TextPost', { postId: post.id })
                }
              />
            ) : null}
            {tab === 'moments' ? (
              <SpaceMoments
                moments={p.moments}
                name={p.name}
                onOpen={(momentId) => navigation.navigate('MomentViewer', { userId: p.id, mine, momentId })}
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
                /* The header has room for four numbers and no room to say what
                   the fourth one means. The About tab is where the page is
                   allowed to explain itself, so the sentence lives there. */
                likesLine={
                  typeof relationship.data?.allRoundLikes === 'number'
                    ? `${formatCount(relationship.data.allRoundLikes)} likes on everything ${mine ? 'you have' : `${p.name} has`} posted — posts, Moments and comments.`
                    : undefined
                }
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
      {!mine ? <SpaceNavigation /> : null}

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

      {/* ── The top bar ──────────────────────────────────────────────────
          The mock-up's bar: the way back on the left, the holUpp wordmark
          held in the middle, and on the right the eye and the menu. The eye
          is owner-only and opens the list of who has opened the Space — the
          one door the mock-up moves the Views number into. The menu holds
          everything the action row no longer carries: settings, privacy,
          requests, sharing. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 56,
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
        <View style={{ paddingTop: insets.top + space.xs, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {goBack ? (
            <IconButton icon="chevron-back" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="Go back" onPress={goBack} />
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Wordmark size={20} />
          </View>
          {mine ? (
            <IconButton icon="eye-outline" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="See who opened your Space" onPress={() => navigation.navigate('SpaceViewers')} />
          ) : null}
          {mine ? (
            <IconButton icon="ellipsis-vertical" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label="More Space options" onPress={() => setSpaceMenu(true)} />
          ) : (
            <IconButton icon="ellipsis-vertical" variant={scrolled || !hasBanner ? 'surface' : 'glass'} label={`More options for ${p.name}`} onPress={() => openActions(member, visitorMenuActions)} />
          )}
        </View>
      </View>
      <ActionSheet visible={spaceMenu} onClose={() => setSpaceMenu(false)} title="Your Space" actions={ownerMenuActions} />
      <ActionSheet visible={shareSheet} onClose={() => setShareSheet(false)} title="Share this Space" actions={spaceActions} />
      <ActionSheet visible={visibilityMenu} onClose={() => setVisibilityMenu(false)} title="Who can see your Add Ups?" actions={([
        ['everyone', 'Everyone who can view your Space'], ['close', 'Homies'], ['private', 'Only you'],
      ] as [AddUpListVisibility, string][]).map(([value, label]) => ({ label: `${relationship.data?.addUpVisibility === value ? '✓ ' : ''}${label}`, hint: 'Totals stay visible. Individual Spaces still follow their privacy settings.', onPress: () => visibilityMutation.mutate(value) }))} />
      <ActionSheet visible={outgoingMenu} onClose={() => setOutgoingMenu(false)} title="Who can see people you added up?" actions={([['everyone','Everyone who can view your Space'],['close','Homies'],['private','Only you']] as [AddUpListVisibility,string][]).map(([value,label]) => ({ label: `${relationship.data?.outgoingVisibility === value ? '✓ ' : ''}${label}`, onPress: () => followSettingsMutation.mutate({approval: null, visibility:value}) }))} />
      {mine ? <HomieRequests visible={homieRequestsOpen} onClose={() => setHomieRequestsOpen(false)} viewerId={meQ.data?.id ?? 0} /> : null}
      <SpaceRelationshipList targetId={p.id} name={p.name} viewerId={meQ.data?.id ?? 0} kind={relationshipList} canView={relationshipList === 'addUps' ? !!relationship.data?.canViewAddUps : relationshipList === 'addedUp' ? !!relationship.data?.canViewAddedUp : !!homies.data?.canView} openSequence={listOpenSequence} onClose={() => setRelationshipList(null)} onOpen={(personId) => { setRelationshipList(null); setTimeout(() => navigation.navigate('UserProfile', { id: personId }), Platform.OS === 'web' ? 0 : 250); }} onOpenPost={(postId) => { setRelationshipList(null); setTimeout(() => navigation.navigate('PostViewer', { postId }), Platform.OS === 'web' ? 0 : 250); }} />
    </View>
  );
}

function SpaceRelationshipList({ targetId, name, viewerId, kind, canView, openSequence, onClose, onOpen, onOpenPost }: { targetId: number; name: string; viewerId: number; kind: 'addUps' | 'addedUp' | 'keptClose' | null; canView: boolean; openSequence: number; onClose: () => void; onOpen: (id: number) => void; onOpenPost: (id: number) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const q = useInfiniteQuery({
    queryKey: ['space-relationship-people', viewerId, targetId, kind, openSequence], enabled: !!kind && !!viewerId && canView,
    initialPageParam: 0, queryFn: ({ pageParam }) => spaceRelationshipPeople(targetId, kind!, pageParam),
    getNextPageParam: (last, pages) => last.hasMore ? pages.reduce((n, page) => n + page.items.length, 0) : undefined,
    staleTime: 0, gcTime: 0, refetchInterval: 15_000,
  });
  const suggestions = useQuery({ queryKey: ['space-relationship-discover', viewerId], queryFn: publicFlow, enabled: !!kind && !!viewerId, staleTime: 30_000 });
  const people = q.data?.pages.flatMap((page) => page.items) ?? [];
  const publicPosts = shownPosts(suggestions.data ?? []);
  const authors = Array.from(new Map(publicPosts.filter(post => post.author.id !== viewerId).map(post => [post.author.id, post.author])).values()).slice(0, 6);
  const videos = publicPosts.filter(post => post.mediaKind === 'video' && post.mediaUrl).slice(0, 6);
  return <Modal visible={!!kind} animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderColor: colors.border }}>
        <IconButton icon="chevron-back" label="Back to Space" onPress={onClose} /><Txt variant="subheading">{kind === 'keptClose' ? 'Homies' : kind === 'addedUp' ? 'Added Up' : 'Add Ups'}</Txt>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.md, paddingBottom: Math.max(insets.bottom, space.xl), gap: space.sm }}>
        {!canView ? <Txt color="textSecondary">{name} {kind === 'addedUp' ? 'turned off access to view the people they added up' : `has limited who can view ${kind === 'keptClose' ? 'their Homies' : 'their Add Ups'}`}.</Txt> : <>
          <Txt variant="small" color="textSecondary">People whose Spaces are private or unavailable to you may not appear.</Txt>
          {q.isLoading && kind ? <LoadingBlock label="Loading people" /> : q.isError ? <ErrorState error={q.error} message="Couldn’t load people." onRetry={() => void q.refetch()} /> : people.length === 0 ? <EmptyState title="No people to show" /> : <View style={{ gap: 8, paddingTop: space.sm }}>
            {people.map((person) => <Pressable key={person.id} onPress={() => onOpen(person.id)} accessibilityRole="button" accessibilityLabel={`Open ${person.name}’s Space`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}><Avatar uri={person.photos[0]?.url ?? null} name={person.name} size={42} /><View><Txt variant="bodyStrong">{person.name}</Txt>{person.username ? <Txt variant="small" color="textSecondary">@{person.username}</Txt> : null}</View></Pressable>)}
            {q.hasNextPage ? <Button title="Show more" variant="ghost" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
          </View>}
        </>}
        <Txt variant="subheading" style={{marginTop: space.xl}}>Discover</Txt>
        {suggestions.isError ? <Button title="Retry Discover" variant="ghost" onPress={() => void suggestions.refetch()} /> : suggestions.isLoading ? <LoadingBlock label="Loading Discover" /> : authors.length || videos.length ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
          {Array.from({length: Math.max(authors.length, videos.length)}, (_,i) => [
            authors[i] ? (() => { const person=authors[i]; return <View key={`person-${person.id}`} style={{width: '47%', minHeight: 100, backgroundColor: colors.card, padding: space.md, borderRadius: 14, gap: 8}}><Pressable onPress={() => onOpen(person.id)} accessibilityRole="button" accessibilityLabel={`Discover ${person.name}’s Space`}><Avatar uri={person.photos?.[0]?.url ?? null} name={person.name} size={42} /><Txt variant="bodyStrong" numberOfLines={1}>{person.name}</Txt><Txt variant="small" color="textSecondary">View Space</Txt></Pressable><FollowButton id={person.id} name={person.name} compact /></View>; })() : null,
            videos[i] ? (() => { const post=videos[i]; return <Pressable key={`video-${post.id}`} onPress={() => onOpenPost(post.id)} accessibilityRole="button" accessibilityLabel={`Watch ${post.author.name}’s Flow`} style={{width: '47%', backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden'}}><ClipThumb uri={mediaUrl(post.mediaUrl) ?? ""} style={{width: '100%', height: 130}} /><View style={{padding: space.sm}}><Txt variant="bodyStrong" numberOfLines={1}>{post.author.name}</Txt><Txt variant="small" color="textSecondary">Watch Flow</Txt></View></Pressable>; })() : null,
          ])}

        </View> : <Txt color="textSecondary">Nothing to discover right now.</Txt>}
      </ScrollView>
    </View>
  </Modal>;
}

function HomieRequests({visible,onClose,viewerId}: {visible:boolean;onClose:()=>void;viewerId:number}) {
  const {colors}=useTheme(); const insets=useSafeAreaInsets(); const qc=useQueryClient(); const toast=useToast();
  const q=useInfiniteQuery({queryKey:['holup-homie-requests',viewerId],initialPageParam:0,queryFn:({pageParam})=>homieRequests(pageParam),enabled:visible && !!viewerId,getNextPageParam:(last,pages)=>last.hasMore ? pages.reduce((n,p)=>n+p.items.length,0):undefined,staleTime:0});
  const response=useMutation({mutationFn:({id,accept}:{id:number;accept:boolean})=>respondHomie(id,accept),onSuccess:()=>{for(const key of ['holup-homie-requests','holup-homie-status','holup-homie-stats','space-relationship-people']) void qc.invalidateQueries({queryKey:[key]});},onError:e=>toast({kind:'error',title:'Couldn’t answer request',message:(e as Error).message})});
  const items=q.data?.pages.flatMap(p=>p.items) ?? [];
  return <Modal visible={visible} animationType="fade" onRequestClose={onClose}><View style={{flex:1,backgroundColor:colors.bg,paddingTop:insets.top}}><View style={{flexDirection:'row',alignItems:'center',gap:12,padding:space.md}}><IconButton icon="chevron-back" label="Back to Space" onPress={onClose}/><Txt variant="subheading">Homie requests</Txt></View><ScrollView contentContainerStyle={{padding:space.md,gap:space.md}}>
    {q.isLoading ? <LoadingBlock label="Loading requests"/> : q.isError ? <ErrorState error={q.error} message="Couldn’t load requests." onRetry={()=>void q.refetch()}/> : !items.length ? <Txt color="textSecondary">No requests right now.</Txt> : items.map(p=><View key={p.id} style={{flexDirection:'row',alignItems:'center',gap:8}}><Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={40}/><Txt variant="bodyStrong" style={{flex:1}}>{p.name}</Txt><Button title="Accept" size="sm" disabled={response.isPending} onPress={()=>response.mutate({id:p.id,accept:true})}/><Button title="Decline" variant="ghost" size="sm" disabled={response.isPending} onPress={()=>response.mutate({id:p.id,accept:false})}/></View>)}
    {q.hasNextPage ? <Button title="Show more" loading={q.isFetchingNextPage} onPress={()=>void q.fetchNextPage()}/> : null}</ScrollView></View></Modal>;
}

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
  onOpen: (post: Post) => void;
}) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const cols = 3;
  const gap = 8;
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
        icon="crush"
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
            onPress={() => onOpen(post)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}’s ${post.repostedBy ? 'reposted ' : ''}post${post.body ? `: ${post.body}` : ''}`}
            style={({ pressed }) => ({ width: tile, opacity: pressed ? 0.85 : 1 })}
          >
            <View
              style={{
                width: tile,
                height: tile * 1.2,
                borderRadius: 14,
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

              {post.repostedBy ? (
                <View
                  accessibilityLabel="Reposted"
                  style={{ position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(7,7,8,0.62)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }}
                >
                  <Ionicons name="repeat" size={11} color="#FFFFFF" />
                  <Txt variant="caption" color="#FFFFFF">Reposted</Txt>
                </View>
              ) : null}

              {/* The tile's little ledger, as the mock-up draws it: how many
                  looked and how many loved, over a whisper of scrim. The words
                  of a post live in the post itself — the wall shows the work
                  and the numbers under it. */}
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 46 }} />
                {typeof post.viewCount === 'number' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons name="eye-outline" size={12} color="#FFFFFF" />
                    <Txt variant="caption" color="#FFFFFF" style={{ fontSize: 10.5 }}>{formatCount(post.viewCount)}</Txt>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Ionicons name="heart-outline" size={12} color="#FFFFFF" />
                  <Txt variant="caption" color="#FFFFFF" style={{ fontSize: 10.5 }}>{formatCount(post.likeCount)}</Txt>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
      {/* The end of a Space is not the end of the posts. This is the quiet
          promise that the next page is on its way. */}
      {loadingMore ? <Skeleton style={{ height: tile * 1.2, borderRadius: 14, marginTop: gap }} /> : null}
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
function SpaceMoments({ moments, name, onOpen }: { moments: MomentSummary[]; name: string; onOpen: (momentId: number) => void }) {
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
          /* The pebble tapped is the Moment that opens. */
          onPress={() => onOpen(m.id)}
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
                /* The pebble is the tap; a shared post inside it is a Moment
                   here, not a way out to somebody else's post. */
                tappable={false}
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
  likesLine,
  onReport,
}: {
  profile: FullProfile;
  lifestyle: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[];
  mine: boolean;
  /** One sentence saying what the header's Likes number counts. */
  likesLine?: string;
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

      {likesLine ? (
        <Txt variant="small" color="textMuted">{likesLine}</Txt>
      ) : null}

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
  /* The mock-up's header keeps only the name, the handle, the pronouns and the
     bio — so the facts the header used to carry live here, where the rest of
     the facts are. */
  if (p.age) out.push({ icon: 'calendar-outline', label: 'Age', value: String(p.age) });
  if (p.city) out.push({ icon: 'location-outline', label: 'Location', value: p.city });
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
