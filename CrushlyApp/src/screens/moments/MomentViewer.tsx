import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, TextInput, View, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { CrushButton } from '../../components/CrushButton';
import { ConfirmSheet } from '../../components/BottomSheet';
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
import { timeAgo } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

const DURATION = 6000;
/** How long a finger must stay down before the Moment freezes. */
const HOLD_TO_PAUSE_MS = 300;
type Group = { user: MomentAuthor; moments: Moment[] };

export function MomentViewerScreen({ route, navigation }: ScreenProps<'MomentViewer'>) {
  const { userId, mine } = route.params;
  const c = palettes.dark; // the viewer is always cinematic dark
  const { reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useMoments();
  const reactM = useMomentReaction();
  const { run: crushOn } = useCrushFlow();

  // Freeze the sequence when the viewer opens so it doesn't reshuffle as Moments get marked seen.
  const [groups, setGroups] = useState<Group[] | null>(null);
  useEffect(() => {
    if (groups || !data) return;
    if (mine) setGroups(data.mine.moments.length ? [data.mine] : []);
    else {
      const i = data.others.findIndex((g) => g.user.id === userId);
      setGroups(i >= 0 ? data.others.slice(i) : []);
    }
  }, [data, groups, mine, userId]);

  const [gi, setGi] = useState(0);
  const [mi, setMi] = useState(() => 0);
  const [reply, setReply] = useState('');
  const [focused, setFocused] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const group = groups?.[gi];
  const moment = group?.moments[mi];
  const paused = focused || reactOpen || confirmDelete || holding;

  // Start each person's sequence at their first unseen Moment.
  useEffect(() => {
    if (!group || mine) return;
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
  useEffect(() => {
    elapsedMs.current = 0;
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
        elapsedMs.current = Math.min(DURATION, elapsedMs.current + (now - lastTick.current));
        const p = elapsedMs.current / DURATION;
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
  }, [moment, progress, next]);

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

  if (groups && !moment) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, justifyContent: 'center' }}>
        <EmptyState icon="aperture-outline" title="This Moment has passed" message="Moments disappear after 24 hours." action={{ label: 'Back to Moments', onPress: close }} />
      </View>
    );
  }
  if (!moment || !group) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
        <MomentPreview key={moment.id} moment={moment} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: space.xl }} textSize={26} />

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

        {/* Top: progress + author */}
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: space.md, backgroundColor: 'rgba(0,0,0,0.25)' }} pointerEvents="box-none">
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }} pointerEvents="box-none">
            <Pressable
              onPress={() => !mine && navigation.navigate('UserProfile', { id: group.user.id })}
              accessibilityRole="button"
              accessibilityLabel={mine ? 'Your Moment' : `${group.user.name}, view profile`}
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

        {moment.kind === 'photo' && moment.body ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }} pointerEvents="none">
            <Txt variant="body" color="#fff" style={{ fontSize: 17, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 }}>
              {moment.body}
            </Txt>
          </View>
        ) : null}

        {/* Bottom */}
        <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md), backgroundColor: 'rgba(0,0,0,0.35)' }}>
          {mine ? (
            <View style={{ gap: 4, paddingVertical: space.xs }} accessible accessibilityLabel={`Seen by ${moment.viewCount ?? 0}. ${reactionsLine ?? 'No reactions yet'}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="eye-outline" size={18} color="#fff" />
                <Txt variant="bodyStrong" color="#fff">
                  Seen by {moment.viewCount ?? 0}
                </Txt>
              </View>
              <Txt variant="small" color="rgba(255,255,255,0.75)">
                {reactionsLine ?? 'No reactions yet. Replies arrive in your Messages.'}
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
                <View style={{ flex: 1, minWidth: 0, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', justifyContent: 'center' }}>
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
