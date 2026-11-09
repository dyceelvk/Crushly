import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Pressable, TextInput, View, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { CrushButton } from '../../components/CrushButton';
import { ConfirmSheet } from '../../components/BottomSheet';
import { ViewersSheet } from '../../components/ViewersSheet';
import { EmptyState } from '../../components/States';
import { CrushIcon } from '../../components/Logo';
import { useToast } from '../../components/Toast';
import { useLayout } from '../../components/Layout';
import { keys, useMomentReaction, useMoments } from '../../api/hooks';
import { deleteMoment, replyToMoment, viewMoment } from '../../api/service';
import type { Moment, MomentAuthor } from '../../api/types';
import { useCrushFlow } from '../discover/Discover';
import { MomentPreview } from './Moments';
import { palettes, fonts, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { MOMENT_REACTIONS } from '../../lib/catalog';
import { initialMomentIndex } from '../../lib/moments';
import { timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

const DURATION = 6000;
const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
/** How long a finger must stay down before the Moment freezes. */
const HOLD_TO_PAUSE_MS = 300;
type Group = { user: MomentAuthor; moments: Moment[] };

export function MomentViewerScreen({ route, navigation }: ScreenProps<'MomentViewer'>) {
  /* Every picture on this screen opens a Moment when there is one live, and the
     Space otherwise — the same handler every other screen uses. */
  const openProfile = useProfileTap();
  const { userId, mine, momentId } = route.params;
  const searchTargetUsed = useRef(false);
  const c = palettes.dark; // the viewer is always cinematic dark
  const { reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isFetching, isError, refetch } = useMoments();
  const [targetReady, setTargetReady] = useState(momentId == null);
  const reactM = useMomentReaction();
  const { run: crushOn } = useCrushFlow();

  // Freeze the sequence when the viewer opens so it doesn't reshuffle as Moments get marked seen.
  //
  // It is frozen only once it holds something. Opening this screen straight
  // after posting used to catch the feed as it was *before* the new Moment was
  // in it, freeze that empty answer, and then refuse every later one — so a
  // Moment that had just gone live was shown as "This Moment has passed". An
  // empty answer is now a provisional one: the next answer replaces it.
  const [groups, setGroups] = useState<Group[] | null>(null);
  const signature = (list: Group[] | null) => (list ?? []).map((g) => g.moments.map((m) => m.id).join(',')).join('|');
  useEffect(() => {
    if (!data || !targetReady) return;
    let source: Group[] = mine
      ? (data.mine.moments.length ? [data.mine] : [])
      : (() => {
          const i = data.others.findIndex((g) => g.user.id === userId);
          return i >= 0 ? data.others.slice(i) : [];
        })();
    if (momentId != null && !source[0]?.moments.some((m) => m.id === momentId)) source = [];
    if (groups !== null && groups.some((g) => g.moments.length)) return; // frozen, and holding something
    if (groups !== null && signature(source) === signature(groups)) return;
    setGroups(source);
  }, [data, groups, mine, userId, momentId, targetReady]);

  // The last answer may predate whatever was just posted, so the viewer asks
  // again the moment it opens rather than trusting a cached feed.
  useEffect(() => {
    let alive = true;
    void qc.invalidateQueries({ queryKey: keys.moments }).finally(() => { if (alive) setTargetReady(true); });
    return () => { alive = false; };
  }, [qc]);

  const [gi, setGi] = useState(0);
  const [mi, setMi] = useState(() => 0);
  const [reply, setReply] = useState('');
  const [focused, setFocused] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [localReaction, setLocalReaction] = useState<Record<number, string | null>>({});
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The freeze is driven by a ref, not by state: the timer loop reads it on the
  // very next frame, so pausing never waits for a render to catch up.
  const pausedRef = useRef(false);
  const heldRef = useRef(false);
  const zoneRef = useRef<'prev' | 'next'>('next');
  const [zoneWidth, setZoneWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  /**
   * The list can get shorter while this screen is open — a Moment deleted, or a
   * feed that answers again with fewer of them. Reading `groups[gi]` and
   * `moments[mi]` straight off an index that used to be valid then points past
   * the end, `moment` is undefined, and the screen announces that a live Moment
   * has passed. Clamped instead: the reader is looking at a card that exists.
   */
  const group = groups && groups.length ? groups[Math.min(gi, groups.length - 1)] : undefined;
  const targetIndex = !searchTargetUsed.current && gi === 0 && group ? initialMomentIndex(group.moments, momentId) : null;
  const displayIndex = targetIndex ?? mi;
  const moment = group && group.moments.length ? group.moments[Math.min(displayIndex, group.moments.length - 1)] : undefined;
  const paused = focused || reactOpen || confirmDelete || viewersOpen || holding;
  const playbackDurationMs = moment?.kind === 'video'
    ? Math.max(100, Math.min(60_000, moment.durationMs ?? DURATION))
    : DURATION;

  // Start each person's sequence at their first unseen Moment.
  useEffect(() => {
    if (!group) return;
    if (!searchTargetUsed.current && momentId != null && gi === 0) {
      const target = initialMomentIndex(group.moments, momentId);
      if (target !== null) {
        searchTargetUsed.current = true;
        setMi(target);
        return;
      }
    }
    if (mine) return;
    const first = group.moments.findIndex((m) => !m.seen);
    setMi(first >= 0 ? first : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, groups]);

  const close = useCallback(() => {
    qc.invalidateQueries({ queryKey: keys.moments });
    navigation.goBack();
  }, [navigation, qc]);

  const next = useCallback(() => {
    if (!groups || !group) return;
    if (mi < group.moments.length - 1) setMi(mi + 1);
    else if (gi < groups.length - 1) {
      setGi(gi + 1);
      setMi(0);
    } else close();
  }, [groups, group, mi, gi, close]);

  const prev = useCallback(() => {
    if (mi > 0) setMi(mi - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setMi(0);
    } else progress.setValue(0);
  }, [mi, gi, progress]);

  // Hold anywhere to pause the timer — release to keep watching.
  //
  // This used to hang off <Pressable onPressIn/onPressOut>. React Native can
  // cancel that press while the finger is still down (any re-render during the
  // touch, or a competing gesture, fires onPressOut), so "Paused" flashed for a
  // frame and the Moment then played on to the end. The responder system lets
  // us claim the touch, refuse to hand it back mid-hold, and only release when
  // the finger actually lifts.
  const beginHold = useCallback((e: GestureResponderEvent) => {
    const rawX = e.nativeEvent.locationX;
    const x = typeof rawX === 'number' ? rawX : -1; // no coordinate → treat as "next"
    // Left third rewinds, the rest advances — the split the old Pressables used.
    zoneRef.current = x >= 0 && zoneWidth > 0 && x < zoneWidth * 0.3 ? 'prev' : 'next';
    heldRef.current = false;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      heldRef.current = true;
      pausedRef.current = true;
      setHolding(true);
      haptic.tap();
    }, HOLD_TO_PAUSE_MS);
  }, [zoneWidth]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  /** Finger up (navigate = a plain tap) or the system took the touch away. */
  const endHold = useCallback((navigate: boolean) => {
    clearHoldTimer();
    const wasHeld = heldRef.current;
    heldRef.current = false;
    pausedRef.current = false;
    setHolding(false);
    // A hold resumes and never also navigates on the same touch.
    if (navigate && !wasHeld) (zoneRef.current === 'prev' ? prev : next)();
  }, [clearHoldTimer, prev, next]);

  // Clear a pending hold timer if the screen unmounts mid-touch.
  useEffect(() => clearHoldTimer, [clearHoldTimer]);

  // Mark viewed.
  useEffect(() => {
    if (moment && !mine && !moment.seen) viewMoment(moment.id).catch(() => {});
  }, [moment, mine]);

  // Timer — a timestamp-driven rAF loop instead of Animated.timing, so
  // pause/resume is exact on every platform: the loop only runs while
  // unpaused, so the elapsed time (and the progress bar) freezes with it.
  const elapsedMs = useRef(0);
  const lastTick = useRef(0);
  const lastLabelMs = useRef(0);
  const [elapsedLabelMs, setElapsedLabelMs] = useState(0);
  useEffect(() => {
    elapsedMs.current = 0;
    lastLabelMs.current = 0;
    setElapsedLabelMs(0);
    progress.setValue(0);
  }, [moment?.id, progress]);
  // Mirror the React pause state into the ref the loop reads, so pausing from
  // the reply box, the reaction sheet or the delete sheet freezes just as hard.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!moment) return;
    lastTick.current = Date.now();
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      if (!pausedRef.current) {
        elapsedMs.current = Math.min(playbackDurationMs, elapsedMs.current + (now - lastTick.current));
        if (elapsedMs.current - lastLabelMs.current >= 250 || elapsedMs.current >= playbackDurationMs) {
          lastLabelMs.current = elapsedMs.current;
          setElapsedLabelMs(elapsedMs.current);
        }
        const p = elapsedMs.current / playbackDurationMs;
        progress.setValue(p);
        if (p >= 1) {
          next();
          return;
        }
      }
      // Advance the timestamp even while paused: otherwise every paused frame
      // would be credited as elapsed time the moment the finger lifts.
      lastTick.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moment, progress, next, playbackDurationMs]);

  const myReaction = moment ? (moment.id in localReaction ? localReaction[moment.id] : moment.myReaction) : null;

  const react = async (kind: string) => {
    if (!moment) return;
    const value = myReaction === kind ? null : kind;
    setLocalReaction((s) => ({ ...s, [moment.id]: value }));
    setReactOpen(false);
    haptic.soft();
    try {
      await reactM.mutateAsync({ id: moment.id, kind: value });
    } catch (e) {
      setLocalReaction((s) => ({ ...s, [moment.id]: myReaction }));
      toast({ kind: 'error', title: 'Reaction not sent', message: (e as Error).message });
    }
  };

  const sendReply = async () => {
    if (!moment || !group || !reply.trim()) return;
    const body = reply.trim();
    setReply('');
    setFocused(false);
    try {
      const res = await replyToMoment(moment.id, body);
      toast({ kind: 'success', title: `Reply sent to ${group.user.name}`, message: 'Tap to open the conversation.', onPress: () => navigation.replace('Chat', { conversationId: res.conversationId }) });
      qc.invalidateQueries({ queryKey: keys.conversations });
    } catch (e) {
      setReply(body);
      toast({ kind: 'error', title: 'Reply not sent', message: (e as Error).message });
    }
  };

  const remove = async () => {
    if (!moment) return;
    setConfirmDelete(false);
    try {
      await deleteMoment(moment.id);
      const left = group!.moments.filter((m) => m.id !== moment.id);
      if (!left.length) return close();
      setGroups([{ ...group!, moments: left }]);
      setMi(Math.min(mi, left.length - 1));
      toast({ kind: 'success', title: 'Moment deleted' });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t delete', message: (e as Error).message });
    }
  };

  const reactionsLine = useMemo(() => {
    if (!moment?.reactions?.length) return null;
    return moment.reactions
      .slice(0, 3)
      .map((r) => `${r.kind === 'crush' ? '♥' : MOMENT_REACTIONS.find((x) => x.key === r.kind)?.emoji ?? ''} ${r.name}`)
      .join('   ');
  }, [moment]);

  /* Only a settled answer earns the verdict. While the feed is still being
     asked, the screen holds, because a verdict about a Moment that has not
     finished arriving is the one thing it must never give.
     
     And the verdict has to be *true*. "This Moment has passed" is a claim about
     a particular Moment, and this screen was opened by a person, not by an id —
     there is no particular Moment here to make that claim about. Being told your
     just-posted clip "has passed" when in fact nothing was ever saved as a
     Moment is a sentence that sends people looking for a bug in the clock. So:
     your own Space with nothing live offers to share one; somebody else's says
     exactly what is true, which is that nothing of theirs is live right now. */
  if (targetReady && isError && !moment && !isFetching) {
    return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, justifyContent: 'center' }}><EmptyState icon="cloud-offline-outline" title="Couldn’t load Moments" message="Check your connection and try again." action={{ label: 'Try again', onPress: () => { void refetch(); } }} secondary={{ label: 'Close', onPress: close }} /></View>;
  }
  if (groups && !moment && !isFetching) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, justifyContent: 'center' }}>
        {momentId != null ? (
          <EmptyState icon="sparkles-outline" title="This Moment isn’t available" message="It may no longer be shared with you." action={{ label: 'Close', onPress: close }} />
        ) : mine ? (
          <EmptyState
            icon="aperture-outline"
            title="Nothing of yours is live"
            message="A Moment is a photo, a clip or a few words, and it lasts a day. You don’t have one up right now — post one and it appears here straight away."
            action={{ label: 'Share a Moment', onPress: () => navigation.replace('MomentComposer') }}
            secondary={{ label: 'Back to Moments', onPress: close }}
          />
        ) : (
          <EmptyState
            icon="aperture-outline"
            title={`Nothing live from ${group?.user.name ?? 'them'} right now`}
            message="Their Moments from the last 24 hours are gone. What they post next lands here the moment it goes up."
            action={{ label: 'Back to Moments', onPress: close }}
          />
        )}
      </View>
    );
  }
  /* Nothing to draw yet. A black screen is how a Moment that has not arrived
     yet looks — briefly, and only while the feed is being asked. */
  if (!moment || !group) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.textMuted} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <MomentPreview
            key={moment.id}
            moment={moment}
            caption={false}
            style={{ flex: 1, padding: moment.kind === 'text' ? space.xl : 0 }}
            textSize={26}
            autoPlay={moment.kind === 'video' && !paused}
          />
        </View>

        {/* Tap to move, hold to pause. One responder surface that claims the
            touch and keeps it until the finger lifts — a pause can no longer be
            cancelled out from under the member. */}
        <View
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          onLayout={(e) => setZoneWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => beginHold(e)}
          onResponderRelease={() => endHold(true)}
          onResponderTerminate={() => endHold(false)}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Moments player"
          accessibilityHint="Tap the left third for the previous Moment, anywhere else for the next one. Hold to pause, release to resume."
        />

        {/* No on-screen badge while held: the progress bar freezing at the top
            and the haptic on pause are the feedback. */}

        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'transparent']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 116 }}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']}
          locations={[0, 0.55, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 300 }}
          pointerEvents="none"
        />

        {/* Top: progress + author */}
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: space.md }} pointerEvents="box-none">
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden>
            {group.moments.map((m, i) => (
              <View key={m.id} style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                <Animated.View
                  style={{
                    height: '100%', backgroundColor: '#fff',
                    width: i < mi ? '100%' : i > mi ? '0%' : reduceMotion ? '100%' : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  }}
                />
              </View>
            ))}
          </View>
          {moment.kind === 'video' ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 4 }} accessibilityLiveRegion="polite">
              <Txt variant="caption" color="rgba(255,255,255,0.82)" accessibilityLabel={`Clip ${formatDuration(elapsedLabelMs)} of ${formatDuration(playbackDurationMs)}`}>
                {formatDuration(elapsedLabelMs)} / {formatDuration(playbackDurationMs)}
              </Txt>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }} pointerEvents="box-none">
            <Pressable
              onPress={() => openProfile(group.user.id)}
              accessibilityRole="button"
              accessibilityLabel={mine ? 'Your Moment' : `${group.user.name}, view Space`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
            >
              <Avatar uri={group.user.photo} name={group.user.name} size={36} />
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Txt variant="bodyStrong" color="#fff">
                    {mine ? 'Your Moment' : group.user.name}
                  </Txt>
                  {group.user.verified && !mine ? <VerifiedBadge size={14} /> : null}
                </View>
                <Txt variant="caption" color="rgba(255,255,255,0.75)">
                  {timeAgo(moment.createdAt)} ago{moment.audience === 'connections' ? ' · Connections only' : ''}
                </Txt>
              </View>
            </Pressable>
            {mine ? <IconButton icon="trash-outline" variant="glass" label="Delete this Moment" onPress={() => setConfirmDelete(true)} /> : null}
            <IconButton icon="close" variant="glass" label="Close Moments" onPress={close} />
          </View>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        {(moment.kind === 'photo' || moment.kind === 'video') && moment.body ? (
          <View
            style={{
              backgroundColor: 'rgba(0,0,0,0.42)',
              borderRadius: 14,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              marginHorizontal: space.md,
              marginBottom: space.sm,
            }}
            pointerEvents="none"
          >
            <Txt
              variant="body"
              color="#fff"
              numberOfLines={4}
              style={{
                fontSize: 17,
                lineHeight: 23,
                textShadowColor: 'rgba(0,0,0,0.7)',
                textShadowRadius: 8,
              }}
            >
              {moment.body}
            </Txt>
          </View>
        ) : null}

        {/* Bottom */}
        <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md) }}>
          {mine ? (
            <View style={{ gap: 4, paddingVertical: space.xs }}>
              <Pressable onPress={() => setViewersOpen(true)} accessibilityRole="button" accessibilityLabel={`Seen by ${moment.viewCount ?? 0}. See viewers`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 }}>
                <Ionicons name="eye-outline" size={18} color="#fff" />
                <Txt variant="bodyStrong" color="#fff">
                  Seen by {moment.viewCount ?? 0}
                </Txt>
              </Pressable>
              <Txt variant="small" color="rgba(255,255,255,0.75)">
                {reactionsLine ?? 'No reactions yet. Replies arrive in your Whispers.'}
              </Txt>
            </View>
          ) : (
            <>
              {reactOpen ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: space.sm }}>
                  {[{ key: 'crush', emoji: '', label: 'Crush' }, ...MOMENT_REACTIONS].map((r) => (
                    <Pressable
                      key={r.key}
                      onPress={() => react(r.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`${myReaction === r.key ? 'Remove' : 'React with'} ${r.label}`}
                      style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: myReaction === r.key ? c.crushSoft : 'rgba(255,255,255,0.12)' }}
                    >
                      {r.key === 'crush' ? <CrushIcon size={24} color={c.crush} filled /> : <Txt style={{ fontSize: 26, lineHeight: 32 }}>{r.emoji}</Txt>}
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' }}>
                  <TextInput
                    value={reply}
                    onChangeText={setReply}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onSubmitEditing={sendReply}
                    placeholder={`Reply to ${group.user.name}…`}
                    placeholderTextColor="rgba(255,255,255,0.65)"
                    returnKeyType="send"
                    maxLength={1000}
                    accessibilityLabel={`Reply to ${group.user.name}`}
                    style={[{ width: '100%', minWidth: 0, color: '#fff', fontFamily: fonts.regular, fontSize: 15, paddingHorizontal: 18, height: 48 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
                  />
                </View>
                {reply.trim() ? (
                  <IconButton icon="arrow-up" variant="crush" label="Send reply" onPress={sendReply} color={c.crush} size={48} />
                ) : (
                  <>
                    <IconButton
                      icon={myReaction ? 'happy' : 'happy-outline'}
                      variant="glass"
                      size={48}
                      label={reactOpen ? 'Close reactions' : 'React'}
                      color={myReaction ? c.gold : '#fff'}
                      onPress={() => setReactOpen((v) => !v)}
                    />
                    {!group.user.mutual ? (
                      <CrushButton shape="round" size={48} name={group.user.name} onPress={() => crushOn({ id: group.user.id, name: group.user.name, photos: group.user.photo ? [{ id: 0, url: group.user.photo }] : [] })} />
                    ) : null}
                  </>
                )}
              </View>
            </>
          )}
        </View>
      </View>

      {mine ? <ViewersSheet kind="moment" id={moment.id} visible={viewersOpen} onClose={() => setViewersOpen(false)} /> : null}
      <ConfirmSheet
        visible={confirmDelete}
        title="Delete this Moment?"
        message="It disappears for everyone right away."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </KeyboardAvoidingView>
  );
}
