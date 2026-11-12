import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Txt } from '../../components/Txt';
import { Avatar, Photo } from '../../components/Photo';
import { useProfileTap } from '../../lib/useProfileTap';
import { presenceDot, presenceLabel, presenceState } from '../../lib/presence';
import { TypingDots } from '../../components/TypingDots';
import { RecordingWave } from '../../components/RecordingWave';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { ActionSheet } from '../../components/BottomSheet';
import { ErrorState, LoadingBlock } from '../../components/States';
import { CrushIcon } from '../../components/Logo';
import { MessageBubble } from '../../components/MessageBubble';
import { ReactionPopup } from '../../components/feed/Reactions';
import { SwipeToReply } from '../../components/SwipeRow';
import { useToast } from '../../components/Toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayout } from '../../components/Layout';
import { useChat, useConversation, useConversations, useCrushes, useMe, useAppSettings } from '../../api/hooks';
import type { Message, ReactionKind, ReplyQuote } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import { STICKERS } from '../../lib/catalog';
import { dayLabel, durationLabel } from '../../lib/format';
import { pickImage } from '../../lib/media';
import { useLiveCamera } from '../../components/CameraCapture';
import { CallSheet } from '../../components/CallSheet';
import { useAndroidKeyboardOverlap } from '../../lib/useAndroidKeyboardOverlap';
import { CallManager, type CallState } from '../../lib/call';
import { supabase, toApiError } from '../../api/client';
import { acceptWhisper, declineWhisper, whisperMomentTarget } from '../../api/service';
import { whisperView } from '../../lib/whisperRequest';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

const ICEBREAKERS = [
  'What’s the best thing that happened to you this week?',
  'Your photos have me curious — where was that taken?',
  'Perfect Saturday: early run or late brunch?',
];

type Row =
  | { type: 'msg'; m: Message; first: boolean; last: boolean }
  | { type: 'day'; key: string; label: string };


/**
 * The line under their name.
 *
 * Four presence states, and the two ephemeral ones come first because they are
 * about *now* rather than about *last time*:
 *
 *   typing     they are writing to you this second
 *   recording  they are holding the mic
 *   here       their socket is on this conversation
 *   online/away/offline  what the database is allowed to say
 *
 * The presence that comes from the channel is live; the fallback comes from the
 * thread's own data, so a socket that has not connected yet still shows
 * something true. Nothing here is animated when nothing is happening.
 */
function HeaderState({
  peerName,
  here,
  typing,
  recording,
  presence,
  fallbackOnline,
  live,
}: {
  peerName: string;
  here: boolean;
  typing: boolean;
  recording: boolean;
  presence: { online: boolean | null; activity: string | null } | null;
  fallbackOnline: boolean;
  live: 'connecting' | 'live' | 'offline';
}) {
  const { colors } = useTheme();
  if (typing) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TypingDots color={colors.textSecondary} />
        <Txt variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
          typing
        </Txt>
      </View>
    );
  }
  if (recording) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLiveRegion="polite">
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.crush }} />
        <Txt variant="caption" color="textSecondary">
          Recording a voice note
        </Txt>
      </View>
    );
  }
  const state = presence
    ? presenceState({ live: here, online: presence.online, activity: presence.activity })
    : presenceState({ live: here, online: fallbackOnline, activity: null });
  const label = presenceLabel(state, presence?.activity ?? null);
  const dot = presenceDot(state);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {dot !== 'none' ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot === 'live' ? colors.success : colors.gold }} />
      ) : null}
      <Txt variant="caption" color={state === 'here' || state === 'online' ? 'success' : 'textMuted'}>
        {label}
        {live === 'connecting' ? ' · connecting' : ''}
      </Txt>
    </View>
  );
}

export function ChatScreen({ route, navigation }: ScreenProps<'Chat'>) {
  const keyboard = useAndroidKeyboardOverlap();
  const { conversationId } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { contentWidth, width } = useLayout();
  const { data: conv, error: convError, refetch: refetchConv } = useConversation(conversationId);
  const { data: me } = useMe();
  const { data: appSettings } = useAppSettings();
  const callsEnabled = appSettings?.callsEnabled === true;
  const { data: crushes } = useCrushes();
  const chat = useChat(conversationId);
  const { openActions } = useMemberActions();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const [tray, setTray] = useState(false);
  /** The message waiting on a yes/no before it leaves the server for good. */
  const [deleteFor, setDeleteFor] = useState<Message | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [actionFor, setActionFor] = useState<Message | null>(null);
  /**
   * Where the long press landed, in screen coordinates.
   *
   * Whispers react where the thumb is, the way every other surface in the app
   * does, and a pop-up needs to know where that was.
   */
  const [pressAt, setPressAt] = useState<{ x: number; y: number } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Metering is what makes the waveform real rather than decorative.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder, 250);

  /* ------------------------------------------------------------ video notes */
  /*
   * There are none, on purpose.
   *
   * A Whisper carries pictures and voice notes. Video in a chat is the most
   * expensive thing a member can send — minutes long, tens of megabytes, and it
   * sits in storage forever — and it was also the thing that broke newest: a clip
   * posted from the app played back silent. Until the clip path is trustworthy
   * end to end, the composer does not offer it at all, and the server refuses it
   * too, so an old install cannot send one either.
   */

  /* ------------------------------------------------------------------- calls */
  const [callState, setCallState] = useState<CallState>('idle');
  const [callMuted, setCallMuted] = useState(false);
  const [callChannel, setCallChannel] = useState('');
  const callRef = useRef<CallManager | null>(null);
  const seenCalls = useRef<Set<number>>(new Set());
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const getCall = useCallback(() => {
    if (!callRef.current) {
      callRef.current = new CallManager({
        onState: (s) => { setCallState(s); if (s === 'idle') setCallMuted(false); },
        onRemote: (stream) => {
          const el = remoteAudioRef.current;
          if (el) el.srcObject = stream;
        },
        onError: (message) => toast({ kind: 'error', title: 'Call problem', message }),
        onEnd: (reason) => {
          if (reason && reason !== 'Ended') toast({ kind: 'info', title: 'Call ended', message: reason });
        },
      });
    }
    return callRef.current;
  }, [toast]);

  const startCall = async () => {
    setTray(false);
    if (!callsEnabled || !canSend || recording || callState !== 'idle') return;
    let channel: string;
    try {
      const { data, error } = await supabase.rpc('register_call_room', { p_conversation_id: conversationId });
      if (error) throw toApiError(error);
      if (typeof data !== 'string') throw new Error('Couldn’t create the call.');
      channel = data;
    } catch (error) { toast({ kind: 'error', title: 'Couldn’t start call', message: (error as Error).message }); return; }
    setCallChannel(channel);
    const manager = getCall();
    await manager.call(channel);
    if (manager.state !== 'outgoing') return;
    const invitation = await chat.send({ kind: 'call', channel });
    if (!invitation.ok) {
      void manager.hangup().catch(() => {});
      toast({ kind: 'error', title: 'Couldn’t invite them to the call', message: invitation.error });
    }
  };

  // Incoming call requests arrive as 'call' messages; prompt once per request.
  useEffect(() => {
    if (!callsEnabled || !conv?.canSend || conv.closed || callState !== 'idle') return;
    const incoming = chat.messages.find(
      (m) => m.kind === 'call' && !m.mine && m.meta?.channel && !seenCalls.current.has(m.id) && Date.now() - m.createdAt < 45_000,
    );
    if (incoming?.meta?.channel) {
      seenCalls.current.add(incoming.id);
      setCallChannel(String(incoming.meta.channel));
      void getCall().incoming(String(incoming.meta.channel));
    }
  }, [chat.messages, callState, getCall, conv?.canSend, conv?.closed, callsEnabled]);

  useEffect(() => {
    if (!callsEnabled) void callRef.current?.hangup().catch(() => {});
  }, [callsEnabled]);

  useEffect(() => () => {
    void callRef.current?.hangup().catch(() => {});
    callRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (conv && (!conv.canSend || conv.closed)) void callRef.current?.hangup().catch(() => {});
  }, [conv?.canSend, conv?.closed]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void callRef.current?.hangup().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  const peer = conv?.peer;
  const canSend = conv ? conv.canSend && !conv.closed : false;

  /**
   * A Whisper begins as a request. The banner above the composer says which side
   * of it we are on — the asker counting down two messages, or the recipient
   * being asked to accept or decline without leaving the thread.
   */
  const whisper = whisperView(conv?.whisper, peer?.name ?? '');
  const canCompose = canSend && whisper.canCompose;
  const qc = useQueryClient();
  const answer = useMutation({
    mutationFn: (decision: 'accept' | 'decline') =>
      decision === 'accept' ? acceptWhisper(conversationId) : declineWhisper(conversationId),
    onSuccess: (_ok, decision) => {
      void refetchConv();
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      toast({
        kind: 'success',
        title: decision === 'accept' ? `You and ${peer?.name ?? 'they'} can Whisper now` : 'Request declined',
        message: decision === 'accept' ? undefined : 'They won’t be told. The thread stays closed.',
      });
    },
    onError: (e) => toast({ kind: 'error', title: 'Couldn’t answer', message: (e as Error).message }),
  });

  // Re-check permissions periodically (e.g. the other person blocks or unmatches).
  useEffect(() => {
    const t = setInterval(() => refetchConv(), 20_000);
    return () => clearInterval(t);
  }, [refetchConv]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const msgs = chat.messages;
    let prevDay = '';
    msgs.forEach((m, i) => {
      const day = new Date(m.createdAt).toDateString();
      if (day !== prevDay) {
        out.push({ type: 'day', key: `day-${day}`, label: dayLabel(m.createdAt) });
        prevDay = day;
      }
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      // A run breaks on a change of sender, a five-minute pause, or midnight.
      const breaks = (a?: Message, b?: Message) =>
        !a || !b || a.mine !== b.mine || b.createdAt - a.createdAt > 5 * 60_000 ||
        new Date(a.createdAt).toDateString() !== new Date(b.createdAt).toDateString();
      const first = breaks(prev, m);
      const last = breaks(m, next);
      out.push({ type: 'msg', m, first, last });
    });
    return out.reverse(); // inverted list
  }, [chat.messages]);

  /* ---------------------------------------------------------------- replies */

  /** What a message looks like when quoted above an answer. */
  const quoteOf = (m: Message): ReplyQuote => ({
    id: m.id,
    mine: m.mine,
    name: m.mine ? 'You' : peer?.name ?? null,
    preview:
      m.kind === 'text' ? m.body
        : m.kind === 'photo' ? (m.body || 'Photo')
        : m.kind === 'voice' ? 'Voice note'
        : m.kind === 'video' ? 'A video note'
        : m.kind === 'sticker' ? 'Sticker'
        : m.kind === 'profile' ? 'Shared a Space'
        : m.kind === 'call' ? 'Voice call'
        : m.body || 'Whisper',
  });

  const send = useCallback(
    async (draft: Parameters<typeof chat.send>[0]) => {
      const withReply = replyTo ? { ...draft, replyTo: replyTo.id, replyQuote: quoteOf(replyTo) } : draft;
      const res = await chat.send(withReply);
      if (!res.ok) toast({ kind: 'error', title: 'Whisper not sent', message: res.error });
      else setReplyTo(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, toast, replyTo, peer?.name],
  );

  /** Tapping a quote goes back to the original and briefly lights it up. */
  const jumpTo = (id: number) => {
    const index = rows.findIndex((r) => r.type !== 'day' && r.m.id === id);
    if (index < 0) {
      toast({ kind: 'info', title: 'Not in this conversation anymore' });
      return;
    }
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setFlashId(id);
    setTimeout(() => setFlashId((current) => (current === id ? null : current)), 1400);
  };

  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    chat.typing(false);
    haptic.tap();
    send({ kind: 'text', body });
  };

  const cam = useLiveCamera();

  const sendPhoto = async (camera: boolean) => {
    setTray(false);
    const img = await (camera ? cam.capture() : pickImage());
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    send({ kind: 'photo', uri: img.uri, mimeType: img.mimeType });
  };

  const startRecording = async () => {
    if (callRef.current?.state && callRef.current.state !== 'idle') return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return toast({ kind: 'error', title: 'Microphone is off', message: 'Allow microphone access to send voice notes.' });
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      haptic.soft();
      setRecording(true);
      chat.recording(true);
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t start recording', message: (e as Error).message });
    }
  };

  const stopRecording = async (keep: boolean) => {
    const duration = Math.round((recState.durationMillis || 0) / 1000);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      /* already stopped */
    }
    setRecording(false);
    chat.recording(false);
    if (!keep) return;
    if (duration < 1 || !recorder.uri) return toast({ kind: 'info', title: 'Too short', message: 'Hold on a little longer to record a voice note.' });
    send({ kind: 'voice', uri: recorder.uri, duration, mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a' });
  };

  const retry = useCallback(
    (m: Message) => {
      const draft = m.meta?.draft;
      if (!draft || !m.localId) return;
      chat.send(draft, m.localId);
    },
    [chat],
  );

  const react = useCallback(
    async (m: Message, kind = 'crush') => {
      haptic.crush();
      try {
        await chat.react(m.id, kind);
      } catch (e) {
        toast({ kind: 'error', title: 'Reaction failed', message: (e as Error).message });
      }
    },
    [chat, toast],
  );

  const openProfile = useProfileTap();
  // A post shared into the thread is a door back to the post.
  const openPost = useCallback((id: number) => navigation.navigate('PostViewer', { postId: id }), [navigation]);
  const openingMoment = useRef(false);
  const openMoment = useCallback(async (messageId: number) => {
    if (openingMoment.current) return;
    openingMoment.current = true;
    try {
      const target = await whisperMomentTarget(messageId);
      if (!navigation.isFocused()) return;
      if (!target) {
        toast({ kind: 'info', title: 'This Moment isn’t available', message: 'It may have expired or may no longer be shared with you.' });
        return;
      }
      navigation.navigate('MomentViewer', { userId: target.userId, mine: target.mine, momentId: target.momentId });
    } catch (e) {
      if (navigation.isFocused()) toast({ kind: 'error', title: 'Couldn’t load Moment', message: (e as Error).message });
    } finally { openingMoment.current = false; }
  }, [navigation, toast]);

  if (convError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingHorizontal: space.md }}>
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
        <ErrorState
          title="We lost the thread"
          error={convError}
          message="This conversation didn’t open. Trying again usually sorts it."
          onRetry={refetchConv}
        />
      </View>
    );
  }

  const shareCandidates = [
    ...(me ? [{ id: me.id, name: 'Your Space', photo: me.profile.photos[0]?.url ?? null }] : []),
    ...(crushes?.mutual ?? []).filter((p) => p.id !== peer?.id).map((p) => ({ id: p.id, name: p.name, photo: p.photos[0]?.url ?? null })),
  ];

  return (
    <View ref={keyboard.root} onLayout={keyboard.measure} style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, paddingVertical: 8, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
          <IconButton icon="chevron-back" variant="plain" label="Back to Whispers" onPress={() => navigation.goBack()} />
          <Pressable
            onPress={() => peer && openProfile(peer.id)}
            accessibilityRole="button"
            accessibilityLabel={peer ? `View ${peer.name}'s Space` : 'Loading'}
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <Avatar uri={peer?.photo} name={peer?.name} size={40} online={!!peer?.online} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Txt variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {peer?.name ?? ' '}
                </Txt>
                {peer?.verified ? <VerifiedBadge size={15} /> : null}
              </View>
              <HeaderState
                peerName={peer?.name ?? ''}
                here={chat.peerHere}
                typing={chat.peerTyping}
                recording={chat.peerRecording}
                presence={chat.presence ? { online: chat.presence.online, activity: chat.presence.activity } : null}
                fallbackOnline={!!peer?.online}
                live={chat.live}
              />
            </View>
          </Pressable>
          {callsEnabled ? <IconButton icon="call-outline" variant="gold" label="Start voice call" onPress={startCall} disabled={!canSend || recording || callState !== 'idle'} /> : null}
          <IconButton
            icon="ellipsis-horizontal"
            variant="plain"
            label="Whisper options"
            onPress={() => peer && openActions({ id: peer.id, name: peer.name, connected: true, context: `chat:${conversationId}`, onGone: () => navigation.goBack() })}
          />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1, paddingBottom: keyboard.overlap }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {chat.loading ? (
          <LoadingBlock label="Loading conversation" />
        ) : chat.error ? (
          <ErrorState
            title="We lost the thread"
            error={chat.error}
            message="These Whispers didn’t load. Your conversation is still here."
            onRetry={chat.reload}
          />
        ) : (
          <FlatList
            ref={listRef}
            inverted={rows.length > 0}
            data={rows}
            keyExtractor={(r) => (r.type === 'day' ? r.key : r.m.localId || String(r.m.id))}
            contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.md, flexGrow: 1, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={chat.loadOlder}
            onEndReachedThreshold={0.3}
            ListFooterComponent={chat.loadingMore ? <ActivityIndicator color={colors.gold} style={{ margin: space.md }} /> : null}
            ListEmptyComponent={
              peer ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl }}>
                  <Avatar uri={peer.photo} name={peer.name} size={96} ring="crush" />
                  <Txt variant="heading" align="center" style={{ marginTop: space.md }}>
                    You and {peer.name} have a Mutual Crush
                  </Txt>
                  <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: 6, maxWidth: 320 }}>
                    Start with something real. Tap an idea to make it yours.
                  </Txt>
                  {canSend ? (
                    <View style={{ gap: 8, marginTop: space.lg, width: '100%', maxWidth: 360 }}>
                      {ICEBREAKERS.map((q) => (
                        <Pressable
                          key={q}
                          onPress={() => {
                            setText(q);
                            inputRef.current?.focus();
                          }}
                          accessibilityRole="button"
                          style={{ padding: 14, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Txt variant="small">{q}</Txt>
                        </Pressable>
                      ))}
                      <Pressable onPress={() => send({ kind: 'sticker', sticker: 'wave' })} accessibilityRole="button" style={{ alignSelf: 'center', padding: 10 }}>
                        <Txt variant="smallStrong" color="gold">
                          👋 Send a wave
                        </Txt>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null
            }
            renderItem={({ item }) =>
              item.type === 'day' ? (
                <View style={{ alignItems: 'center', marginVertical: space.md }}>
                  <Txt variant="caption" color="textMuted">
                    {item.label}
                  </Txt>
                </View>
              ) : (
                <SwipeToReply
                  mine={item.m.mine}
                  onReply={() => {
                    if (item.m.id > 0) setReplyTo(item.m);
                    inputRef.current?.focus();
                  }}
                >
                  <View
                    style={
                      flashId && flashId === item.m.id
                        ? { margin: -4, padding: 4, borderRadius: 22, backgroundColor: colors.goldSoft }
                        : undefined
                    }
                  >
                    <MessageBubble
                      message={item.m}
                      firstInGroup={item.first}
                      lastInGroup={item.last}
                      showTime={item.last}
                      peerName={peer?.name ?? ''}
                      onLongPress={(m, at) => {
                        setPressAt(at ?? null);
                        setActionFor(m);
                      }}
                      onDoubleTap={react}
                      onOpenPhoto={setViewer}
                      onOpenProfile={openProfile}
                      onOpenPost={openPost}
                      onOpenMoment={openMoment}
                      onRetry={retry}
                      onOpenReply={jumpTo}
                    />
                  </View>
                </SwipeToReply>
              )
            }
          />
        )}

        {/* The request, answered where it was read. */}
        {conv && whisper.kind !== 'none' ? (
          <View
            style={{
              marginHorizontal: space.md,
              marginBottom: space.sm,
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: whisper.kind === 'decision' ? colors.gold : colors.border,
              gap: 6,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons
                name={whisper.kind === 'decision' ? 'chatbubble-ellipses-outline' : whisper.kind === 'waiting' ? 'hourglass-outline' : 'lock-closed-outline'}
                size={16}
                color={whisper.kind === 'decision' ? colors.gold : colors.textSecondary}
              />
              <Txt variant="bodyStrong" style={{ flex: 1 }}>{whisper.title}</Txt>
            </View>
            <Txt variant="small" color="textSecondary">{whisper.body}</Txt>
            {whisper.showDecision ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Accept ${peer?.name ?? 'their'} Whisper request`}
                  disabled={answer.isPending}
                  onPress={() => answer.mutate('accept')}
                  style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.gold, opacity: answer.isPending ? 0.6 : 1 }}
                >
                  <Txt variant="smallStrong" style={{ color: colors.onGold }}>{answer.isPending ? 'Accepting…' : 'Accept'}</Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Decline ${peer?.name ?? 'their'} Whisper request`}
                  disabled={answer.isPending}
                  onPress={() => answer.mutate('decline')}
                  style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, opacity: answer.isPending ? 0.6 : 1 }}
                >
                  <Txt variant="smallStrong" color="textSecondary">Decline</Txt>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Composer */}
        {conv && !canCompose ? (
          <View style={{ padding: space.md, paddingBottom: Math.max(insets.bottom, space.md), borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
              {conv.closed ? 'This connection has ended. You can’t send new Whispers.' : conv.blockReason || 'You can’t send a Whisper here right now.'}
            </Txt>
          </View>
        ) : (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 8) }}>
            {replyTo ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.md, paddingTop: 8 }}>
                <Ionicons name="arrow-undo-outline" size={16} color={colors.gold} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="caption" color="gold" numberOfLines={1}>
                    {`Replying to ${replyTo.mine ? 'yourself' : peer?.name ?? 'them'}`}
                  </Txt>
                  <Txt variant="caption" color="textSecondary" numberOfLines={1}>
                    {quoteOf(replyTo).preview}
                  </Txt>
                </View>
                <Pressable onPress={() => setReplyTo(null)} accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}
            {tray ? (
              <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
                  <TrayButton icon="image-outline" label="Photo" onPress={() => sendPhoto(false)} />
                  <TrayButton icon="camera-outline" label="Camera" onPress={() => sendPhoto(true)} />
                  {callsEnabled ? <TrayButton icon="call-outline" label="Call" onPress={startCall} /> : null}
                  <TrayButton icon="person-circle-outline" label="Share Space" onPress={() => { setTray(false); setShareOpen(true); }} />
                </View>
                <Txt variant="label" color="textMuted" style={{ marginBottom: 6 }}>
                  Stickers
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.xs }}>
                  {STICKERS.map((s) => (
                    <Pressable
                      key={s.key}
                      onPress={() => { setTray(false); send({ kind: 'sticker', sticker: s.key }); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${s.label} sticker`}
                      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.elevated : colors.card })}
                    >
                      <Txt style={{ fontSize: 28, lineHeight: 34 }}>{s.emoji}</Txt>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: space.sm, paddingTop: 8, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
              {recording ? (
                <>
                  <IconButton icon="trash-outline" label="Discard recording" onPress={() => stopRecording(false)} color={colors.danger} />
                  <View style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 }} accessibilityLiveRegion="polite">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.crush }} />
                    <Txt variant="bodyStrong">{durationLabel(Math.round((recState.durationMillis || 0) / 1000))}</Txt>
                    {/* Every bar is a sample of the microphone, not a decoration:
                        with no metering available the bars simply sit low. */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <RecordingWave level={recState.metering ?? null} color={colors.crush} />
                    </View>
                  </View>
                  <IconButton icon="arrow-up" variant="crush" label="Send voice note" onPress={() => stopRecording(true)} color={colors.crush} />
                </>
              ) : (
                <>
                  <View style={{ flex: 1, minWidth: 0, minHeight: 44, maxHeight: 130, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'flex-end' }}>
                    <Pressable
                      onPress={() => setTray((t) => !t)}
                      accessibilityRole="button"
                      accessibilityLabel={tray ? 'Close attachments' : 'Add photo, sticker or Space'}
                      hitSlop={4}
                      style={{ width: 40, height: 42, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
                    >
                      <Ionicons name={tray ? 'close' : 'add-circle-outline'} size={24} color={tray ? colors.text : colors.gold} />
                    </Pressable>
                    <TextInput
                      ref={inputRef}
                      value={text}
                      onChangeText={(v) => {
                        setText(v);
                        // Typing is a rhythm, not a keystroke stream: the
                        // channel throttles this and it expires by itself.
                        chat.typing(v.trim().length > 0);
                      }}
                      placeholder="Say something worth replying to..."
                      placeholderTextColor={colors.textMuted}
                      multiline
                      maxLength={2000}
                      accessibilityLabel="Whisper"
                      onFocus={() => setTray(false)}
                      onKeyPress={(e) => {
                        const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                        if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                          (e as unknown as { preventDefault: () => void }).preventDefault();
                          sendText();
                        }
                      }}
                      style={[
                        { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.regular, fontSize: width >= 380 ? 16 : 15, paddingLeft: 2, paddingRight: 14, paddingTop: 11, paddingBottom: 11, maxHeight: 128 },
                        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
                      ]}
                    />
                  </View>
                  {text.trim() ? (
                    <IconButton icon="arrow-up" variant="crush" label="Send Whisper" onPress={sendText} color={colors.crush} />
                  ) : (
                    <>
                      {/* A tap takes a photo. It used to be two tools in one —
                          a hold recorded a video note — and the video half is
                          gone: a Whisper carries pictures and voice notes. */}
                      <IconButton
                        icon="camera-outline"
                        label="Camera — take a photo"
                        onPress={() => void sendPhoto(true)}
                        disabled={recording || callState !== 'idle'}
                      />
                      <IconButton icon="mic-outline" label="Record a voice note" onPress={startRecording} />
                    </>
                  )}
                </>
              )}
            </View>
          </View>
        )}
        {cam.node}
        {Platform.OS === 'web'
          ? (() => {
              const { unstable_createElement } = require('react-native-web') as typeof import('react-native-web');
              return unstable_createElement('audio', {
                ref: remoteAudioRef,
                autoPlay: true,
                playsInline: true,
                style: { display: 'none' },
              });
            })()
          : null}
        <CallSheet
          visible={callState !== 'idle'}
          state={callState}
          peerName={peer?.name ?? 'Your match'}
          peerPhoto={peer?.photo}
          muted={callMuted}
          onAccept={() => getCall().accept(callChannel)}
          onDecline={() => { void getCall().decline().catch(() => {}); }}
          onHangup={() => { void getCall().hangup().catch(() => {}); }}
          onToggleMute={() => setCallMuted(getCall().toggleMute())}
        />
      </KeyboardAvoidingView>

      {/*
        The faces, beside the Whisper.

        This was the top of a `BottomSheet` titled "React" — five 60 px circles
        on a panel that slid up from the bottom of the screen, which is a menu,
        not a reaction. It is the same pop-up now as the feed and the text post:
        seven faces, at the bubble, with nothing painted behind them. Copy and
        Flag stay where they were, one tap further on.
      */}
      <ReactionPopup
        visible={!!actionFor}
        at={pressAt}
        current={(actionFor?.reactions ?? []).find((x) => x.userId === me?.id)?.kind as ReactionKind | undefined}
        onPick={(kind) => {
          const m = actionFor;
          setActionFor(null);
          if (m) react(m, kind);
        }}
        onDismiss={() => setActionFor(null)}
      >
        {/* The rest of the long-press actions, under the faces on the same
            floating card — one gesture, one menu, and no sheet sliding up the
            screen over the conversation. */}
        {actionFor?.kind === 'text' ? (
          <Pressable
            onPress={async () => {
              const body = actionFor.body;
              setActionFor(null);
              try {
                const Clipboard = await import('expo-clipboard');
                await Clipboard.setStringAsync(body);
                toast({ kind: 'success', title: 'Copied' });
              } catch {
                /* clipboard unavailable */
              }
            }}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}
          >
            <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            <Txt variant="bodyStrong">Copy text</Txt>
          </Pressable>
        ) : null}
        {/*
          Delete was in the design and never got built, so a long-press offered
          reactions, copy and a flag — everything except the thing people were
          looking for. It is here now, and it is real: the row leaves Postgres,
          the photo leaves the bucket, and the other phone is told.
        */}
        {actionFor?.mine && actionFor.id > 0 ? (
          <Pressable
            onPress={() => {
              const m = actionFor;
              setActionFor(null);
              setDeleteFor(m);
            }}
            accessibilityRole="button"
            accessibilityLabel="Delete this Whisper"
            accessibilityHint="Removes it from the server for both of you"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Txt variant="bodyStrong" color="danger">Delete</Txt>
          </Pressable>
        ) : null}
        {actionFor && !actionFor.mine ? (
          <Pressable
            onPress={() => {
              const m = actionFor;
              setActionFor(null);
              if (peer) openActions({ id: peer.id, name: peer.name, connected: true, context: `message:${m.id}`, onGone: () => navigation.goBack() });
            }}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}
          >
            <Ionicons name="flag-outline" size={18} color={colors.danger} />
            <Txt variant="bodyStrong" color="danger">Flag this Whisper</Txt>
          </Pressable>
        ) : null}
      </ReactionPopup>

      {/* One question, one answer, and then it is gone. */}
      <ActionSheet
        visible={!!deleteFor}
        onClose={() => setDeleteFor(null)}
        title="Delete this Whisper?"
        actions={[
          {
            label: 'Delete from the server',
            hint: deleteFor?.kind === 'photo' ? 'Gone for both of you. Today\u2019s photo stays used.' : 'Gone for both of you.',
            icon: <Ionicons name="trash-outline" size={22} color={colors.danger} />,
            destructive: true,
            immediateOnWeb: true,
            onPress: async () => {
              const m = deleteFor;
              setDeleteFor(null);
              if (!m) return;
              const r = await chat.remove(m.id);
              if (r.ok) toast({ kind: 'success', title: 'Deleted', message: 'Removed from the server.' });
              else toast({ kind: 'error', title: 'Not deleted', message: 'It is still there. Try again.' });
            },
          },
        ]}
      />

      {/* Share a profile */}
      <ActionSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share a Space"
        actions={shareCandidates.map((c) => ({
          label: c.name,
          icon: <Avatar uri={c.photo} name={c.name} size={32} />,
          onPress: () => { setShareOpen(false); send({ kind: 'profile', profileId: c.id }); },
        }))}
      />

      {/* Photo viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', justifyContent: 'center' }}>
          <Photo uri={viewer} style={{ width: '100%', height: '80%' }} contentPosition="center" fit="contain" alt="Photo" />
          <IconButton icon="close" variant="glass" label="Close photo" onPress={() => setViewer(null)} style={{ position: 'absolute', top: insets.top + 12, right: 16 }} />
        </View>
      </Modal>
    </View>
  );
}

function TrayButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 88, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: pressed ? colors.elevated : colors.card, borderWidth: 1, borderColor: colors.border })}
    >
      <Ionicons name={icon} size={22} color={colors.gold} />
      <Txt variant="caption" color="textSecondary">
        {label}
      </Txt>
    </Pressable>
  );
}
