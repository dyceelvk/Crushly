import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Txt } from '../../components/Txt';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { ActionSheet, BottomSheet } from '../../components/BottomSheet';
import { ErrorState, LoadingBlock } from '../../components/States';
import { CrushIcon } from '../../components/Logo';
import { MessageBubble, REACTIONS } from '../../components/MessageBubble';
import { useToast } from '../../components/Toast';
import { useLayout } from '../../components/Layout';
import { useChat, useConversation, useCrushes, useMe } from '../../api/hooks';
import type { Message } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import { STICKERS } from '../../lib/catalog';
import { dayLabel, durationLabel } from '../../lib/format';
import { pickImage } from '../../lib/media';
import { useLiveCamera } from '../../components/CameraCapture';
import { useVideoNote } from '../../components/VideoNote';
import { CallSheet } from '../../components/CallSheet';
import { CallManager, type CallState } from '../../lib/call';
import { supabase, toApiError } from '../../api/client';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

const ICEBREAKERS = [
  'What’s the best thing that happened to you this week?',
  'Your photos have me curious — where was that taken?',
  'Perfect Saturday: early run or late brunch?',
];

type Row = { type: 'msg'; m: Message; first: boolean; seen: boolean } | { type: 'day'; key: string; label: string };

export function ChatScreen({ route, navigation }: ScreenProps<'Chat'>) {
  const { conversationId } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { contentWidth, width } = useLayout();
  const { data: conv, error: convError, refetch: refetchConv } = useConversation(conversationId);
  const { data: me } = useMe();
  const { data: crushes } = useCrushes();
  const chat = useChat(conversationId);
  const { openActions } = useMemberActions();
  const [text, setText] = useState('');
  const [tray, setTray] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [actionFor, setActionFor] = useState<Message | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 250);

  /* ------------------------------------------------------------ video notes */
  const videoNote = useVideoNote();
  const sendVideoNote = async () => {
    if (callRef.current?.state && callRef.current.state !== 'idle') return;
    setTray(false);
    try {
      const note = await videoNote.record();
      if (!note) return;
      send({ kind: 'video', uri: note.uri, duration: note.duration, mimeType: note.mimeType });
    } catch (e) {
      toast({ kind: 'error', title: 'Video note not recorded', message: (e as Error).message });
    }
  };

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
    if (!canSend || recording || callState !== 'idle') return;
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
    if (!conv?.canSend || conv.closed || callState !== 'idle') return;
    const incoming = chat.messages.find(
      (m) => m.kind === 'call' && !m.mine && m.meta?.channel && !seenCalls.current.has(m.id) && Date.now() - m.createdAt < 45_000,
    );
    if (incoming?.meta?.channel) {
      seenCalls.current.add(incoming.id);
      setCallChannel(String(incoming.meta.channel));
      void getCall().incoming(String(incoming.meta.channel));
    }
  }, [chat.messages, callState, getCall, conv?.canSend, conv?.closed]);

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

  // Re-check permissions periodically (e.g. the other person blocks or unmatches).
  useEffect(() => {
    const t = setInterval(() => refetchConv(), 20_000);
    return () => clearInterval(t);
  }, [refetchConv]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const msgs = chat.messages;
    const lastMineRead = [...msgs].reverse().find((m) => m.mine && m.readAt && m.id > 0);
    let prevDay = '';
    msgs.forEach((m, i) => {
      const day = new Date(m.createdAt).toDateString();
      if (day !== prevDay) {
        out.push({ type: 'day', key: `day-${day}`, label: dayLabel(m.createdAt) });
        prevDay = day;
      }
      const prev = msgs[i - 1];
      const first = !prev || prev.mine !== m.mine || m.createdAt - prev.createdAt > 5 * 60_000 || new Date(prev.createdAt).toDateString() !== day;
      out.push({ type: 'msg', m, first, seen: lastMineRead?.id === m.id && msgs[msgs.length - 1]?.mine === true });
    });
    return out.reverse(); // inverted list
  }, [chat.messages]);

  const send = useCallback(
    async (draft: Parameters<typeof chat.send>[0]) => {
      const res = await chat.send(draft);
      if (!res.ok) toast({ kind: 'error', title: 'Message not sent', message: res.error });
    },
    [chat, toast],
  );

  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
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
      if (!perm.granted) return toast({ kind: 'error', title: 'Microphone is off', message: 'Allow microphone access to send voice messages.' });
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      haptic.soft();
      setRecording(true);
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
    if (!keep) return;
    if (duration < 1 || !recorder.uri) return toast({ kind: 'info', title: 'Too short', message: 'Hold on a little longer to record a voice message.' });
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

  const openProfile = useCallback((id: number) => navigation.navigate('UserProfile', { id }), [navigation]);

  if (convError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingHorizontal: space.md }}>
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
        <ErrorState message={(convError as Error).message} onRetry={refetchConv} />
      </View>
    );
  }

  const shareCandidates = [
    ...(me ? [{ id: me.id, name: 'Your profile', photo: me.profile.photos[0]?.url ?? null }] : []),
    ...(crushes?.mutual ?? []).filter((p) => p.id !== peer?.id).map((p) => ({ id: p.id, name: p.name, photo: p.photos[0]?.url ?? null })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, paddingVertical: 8, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
          <IconButton icon="chevron-back" variant="plain" label="Back to messages" onPress={() => navigation.goBack()} />
          <Pressable
            onPress={() => peer && openProfile(peer.id)}
            accessibilityRole="button"
            accessibilityLabel={peer ? `View ${peer.name}'s profile` : 'Loading'}
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
              <Txt variant="caption" color={peer?.online ? 'success' : 'textMuted'}>
                {peer?.online ? 'Online now' : 'Mutual Crush'}
              </Txt>
            </View>
          </Pressable>
          <IconButton
            icon="call-outline"
            variant="gold"
            label="Start voice call"
            onPress={startCall}
            disabled={!canSend || recording || callState !== 'idle'}
          />
          <IconButton
            icon="ellipsis-horizontal"
            variant="plain"
            label="Conversation options"
            onPress={() => peer && openActions({ id: peer.id, name: peer.name, connected: true, context: `chat:${conversationId}`, onGone: () => navigation.goBack() })}
          />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {chat.loading ? (
          <LoadingBlock label="Loading conversation" />
        ) : chat.error ? (
          <ErrorState message={chat.error} onRetry={chat.reload} />
        ) : (
          <FlatList
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
                <MessageBubble
                  message={item.m}
                  firstInGroup={item.first}
                  showSeen={item.seen}
                  peerName={peer?.name ?? ''}
                  onLongPress={setActionFor}
                  onDoubleTap={react}
                  onOpenPhoto={setViewer}
                  onOpenProfile={openProfile}
                  onRetry={retry}
                />
              )
            }
          />
        )}

        {/* Composer */}
        {conv && !canSend ? (
          <View style={{ padding: space.md, paddingBottom: Math.max(insets.bottom, space.md), borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
              {conv.closed ? 'This connection has ended. You can’t send new messages.' : conv.blockReason || 'You can’t message in this conversation right now.'}
            </Txt>
          </View>
        ) : (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 8) }}>
            {tray ? (
              <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
                  <TrayButton icon="image-outline" label="Photo" onPress={() => sendPhoto(false)} />
                  <TrayButton icon="camera-outline" label="Camera" onPress={() => sendPhoto(true)} />
                  <TrayButton icon="videocam-outline" label="Video note" onPress={sendVideoNote} />
                  <TrayButton icon="call-outline" label="Call" onPress={startCall} />
                  <TrayButton icon="person-circle-outline" label="Share profile" onPress={() => { setTray(false); setShareOpen(true); }} />
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
                  <View style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 }} accessibilityLiveRegion="polite">
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.crush }} />
                    <Txt variant="bodyStrong">{durationLabel(Math.round((recState.durationMillis || 0) / 1000))}</Txt>
                    <Txt variant="small" color="textMuted">
                      Recording…
                    </Txt>
                  </View>
                  <IconButton icon="arrow-up" variant="crush" label="Send voice message" onPress={() => stopRecording(true)} color={colors.crush} />
                </>
              ) : (
                <>
                  <View style={{ flex: 1, minWidth: 0, minHeight: 44, maxHeight: 130, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'flex-end' }}>
                    <Pressable
                      onPress={() => setTray((t) => !t)}
                      accessibilityRole="button"
                      accessibilityLabel={tray ? 'Close attachments' : 'Add photo, sticker or profile'}
                      hitSlop={4}
                      style={{ width: 40, height: 42, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
                    >
                      <Ionicons name={tray ? 'close' : 'add-circle-outline'} size={24} color={tray ? colors.text : colors.gold} />
                    </Pressable>
                    <TextInput
                      ref={inputRef}
                      value={text}
                      onChangeText={setText}
                      placeholder="Say something worth replying to..."
                      placeholderTextColor={colors.textMuted}
                      multiline
                      maxLength={2000}
                      accessibilityLabel="Message"
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
                    <IconButton icon="arrow-up" variant="crush" label="Send message" onPress={sendText} color={colors.crush} />
                  ) : (
                    <IconButton icon="mic-outline" label="Record a voice message" onPress={startRecording} />
                  )}
                </>
              )}
            </View>
          </View>
        )}
        {cam.node}
        {videoNote.node}
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

      {/* Long-press actions */}
      <BottomSheet visible={!!actionFor} onClose={() => setActionFor(null)} title="React">
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.sm }}>
          {REACTIONS.map((r) => {
            const mine = actionFor?.reactions.some((x) => x.kind === r.key && x.userId === me?.id);
            return (
              <Pressable
                key={r.key}
                onPress={() => { const m = actionFor; setActionFor(null); if (m) react(m, r.key); }}
                accessibilityRole="button"
                accessibilityLabel={`${mine ? 'Remove' : 'React with'} ${r.label}`}
                accessibilityState={{ selected: !!mine }}
                style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? colors.crushSoft : colors.card, borderWidth: 1, borderColor: mine ? colors.crush : colors.border }}
              >
                {r.key === 'crush' ? <CrushIcon size={26} color={colors.crush} filled /> : <Txt style={{ fontSize: 28, lineHeight: 34 }}>{r.emoji}</Txt>}
              </Pressable>
            );
          })}
        </View>
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
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}
          >
            <Ionicons name="copy-outline" size={20} color={colors.textSecondary} />
            <Txt variant="bodyStrong">Copy text</Txt>
          </Pressable>
        ) : null}
        {actionFor && !actionFor.mine ? (
          <Pressable
            onPress={() => { setActionFor(null); if (peer) openActions({ id: peer.id, name: peer.name, connected: true, context: `message:${actionFor.id}`, onGone: () => navigation.goBack() }); }}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}
          >
            <Ionicons name="flag-outline" size={20} color={colors.danger} />
            <Txt variant="bodyStrong" color="danger">
              Report this message
            </Txt>
          </Pressable>
        ) : null}
      </BottomSheet>

      {/* Share a profile */}
      <ActionSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share a profile"
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
