import React, { memo, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Txt } from './Txt';
import { Photo, Avatar } from './Photo';
import { VerifiedBadge } from './Badges';
import { CrushIcon } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import type { Message, ReplyQuote } from '../api/types';
import { mediaUrl } from '../api/client';
import { mediaSource } from '../lib/mediaHost';
import { MOMENT_STYLES, STICKERS } from '../lib/catalog';
import { clockTime, durationLabel } from '../lib/format';

export const REACTIONS: { key: string; label: string; emoji?: string }[] = [
  { key: 'crush', label: 'Crush' },
  { key: 'laugh', label: 'Laugh', emoji: '😂' },
  { key: 'fire', label: 'Fire', emoji: '🔥' },
  { key: 'wow', label: 'Wow', emoji: '😮' },
];

type Props = {
  message: Message;
  /** First bubble of a run from the same sender (gets the tail + spacing). */
  firstInGroup: boolean;
  showSeen: boolean;
  peerName: string;
  onLongPress: (m: Message) => void;
  onDoubleTap: (m: Message) => void;
  onOpenPhoto: (uri: string) => void;
  /** Opens the full-screen player for a clip someone whispered. */
  onOpenVideo?: (uri: string) => void;
  onOpenProfile: (id: number) => void;
  onRetry: (m: Message) => void;
  /** Tapping the quoted original — jumps back to it in the conversation. */
  onOpenReply?: (id: number) => void;
};

export const MessageBubble = memo(function MessageBubble({ message: m, firstInGroup, showSeen, peerName, onLongPress, onDoubleTap, onOpenPhoto, onOpenVideo, onOpenProfile, onRetry, onOpenReply }: Props) {
  const { colors } = useTheme();
  const lastTap = useRef(0);
  const bare = m.kind === 'sticker' || m.kind === 'photo' || m.kind === 'profile';
  const bg = m.mine ? colors.crushDeep : colors.card;
  const ink = m.mine ? '#FFFFFF' : colors.text;

  const onPress = () => {
    if (m.failed) return onRetry(m);
    const now = Date.now();
    if (now - lastTap.current < 280 && m.id > 0) {
      lastTap.current = 0;
      onDoubleTap(m);
    } else {
      lastTap.current = now;
      if (m.kind === 'photo' && m.mediaUrl) setTimeout(() => lastTap.current && onOpenPhoto(m.mediaUrl!), 290);
      if (m.kind === 'profile' && m.meta.profileId) onOpenProfile(m.meta.profileId);
    }
  };

  const reactionSummary = summarize(m.reactions);
  const a11y = `${m.mine ? 'You' : peerName}: ${describe(m)}. ${clockTime(m.createdAt)}${m.pending ? ', sending' : ''}${m.failed ? ', not sent, tap to retry' : ''}${reactionSummary.length ? `, reactions: ${reactionSummary.map((r) => r.key).join(', ')}` : ''}`;

  return (
    <View style={{ alignItems: m.mine ? 'flex-end' : 'flex-start', marginTop: firstInGroup ? 10 : 3 }}>
      <Pressable
        onPress={onPress}
        onLongPress={() => m.id > 0 && onLongPress(m)}
        delayLongPress={320}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={m.id > 0 ? 'Double tap and hold for reactions' : undefined}
        style={{ maxWidth: '80%', opacity: m.pending ? 0.7 : 1 }}
      >
        {m.meta?.replyTo ? <ReplyQuote quote={m.meta.replyTo as ReplyQuote} onPress={onOpenReply} /> : null}
        {m.kind === 'moment_reply' ? <MomentQuote m={m} /> : null}
        {bare ? (
          <BareContent m={m} peerName={peerName} onOpenVideo={onOpenVideo} />
        ) : (
          <View
            style={{
              backgroundColor: bg, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
              borderBottomRightRadius: m.mine && firstInGroup ? 6 : 20, borderBottomLeftRadius: !m.mine && firstInGroup ? 6 : 20,
              borderWidth: m.mine ? 0 : 1, borderColor: colors.border,
            }}
          >
            {m.kind === 'voice' ? <VoiceNote m={m} ink={ink} /> : <Txt variant="body" color={ink} style={{ fontSize: 16, lineHeight: 22 }} selectable>{m.body}</Txt>}
          </View>
        )}
        {reactionSummary.length ? (
          <View style={{ flexDirection: 'row', gap: 4, marginTop: -6, alignSelf: m.mine ? 'flex-start' : 'flex-end', marginHorizontal: 8 }}>
            {reactionSummary.map((r) => (
              <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.elevated, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.border }}>
                {r.key === 'crush' ? <CrushIcon size={12} color={colors.crush} filled /> : <Txt variant="caption">{REACTIONS.find((x) => x.key === r.key)?.emoji}</Txt>}
                {r.count > 1 ? <Txt variant="caption" color="textSecondary">{r.count}</Txt> : null}
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
      {m.failed ? (
        <Pressable onPress={() => onRetry(m)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Txt variant="caption" color="danger">
            Not sent · Tap to retry
          </Txt>
        </Pressable>
      ) : m.pending ? (
        <ActivityIndicator size="small" color={colors.textMuted} style={{ marginTop: 4, transform: [{ scale: 0.7 }] }} />
      ) : showSeen ? (
        <Txt variant="caption" color="textMuted" style={{ marginTop: 4 }}>
          Seen
        </Txt>
      ) : null}
    </View>
  );
});

function BareContent({
  m,
  peerName,
  onOpenVideo,
}: {
  m: Message;
  peerName: string;
  onOpenVideo?: (uri: string) => void;
}) {
  const { colors } = useTheme();
  if (m.kind === 'sticker') {
    const s = STICKERS.find((x) => x.key === m.meta.sticker);
    return (
      <View style={{ padding: 4 }}>
        <Txt style={{ fontSize: 64, lineHeight: 76 }} accessibilityElementsHidden>
          {s?.emoji ?? '✨'}
        </Txt>
      </View>
    );
  }
  if (m.kind === 'photo') {
    return (
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card }}>
        <Photo uri={m.mediaUrl} style={{ width: 220, height: 280 }} contentPosition="center" />
        {m.body ? (
          <View style={{ padding: 10, backgroundColor: m.mine ? colors.crushDeep : colors.card }}>
            <Txt variant="body" color={m.mine ? '#FFFFFF' : 'text'}>{m.body}</Txt>
          </View>
        ) : null}
      </View>
    );
  }
  if (m.kind === 'video') {
    return <VideoNoteBubble m={m} peerName={peerName} onOpen={() => m.mediaUrl && onOpenVideo?.(mediaUrl(m.mediaUrl) ?? m.mediaUrl!)} />;
  }
  // shared profile
  return (
    <View style={{ width: 220, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldLine }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <Avatar uri={m.meta.photo} name={m.meta.name} size={48} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {m.meta.name}
              {m.meta.age ? `, ${m.meta.age}` : ''}
            </Txt>
            {m.meta.verified ? <VerifiedBadge size={14} /> : null}
          </View>
          <Txt variant="caption" color="textMuted">
            Shared Space
          </Txt>
        </View>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10, alignItems: 'center' }}>
        <Txt variant="smallStrong" color="gold">
          View Space
        </Txt>
      </View>
    </View>
  );
}

/**
 * The message being answered, quoted above the reply. The text and the name
 * come from the database, not from the sender's phone, so nobody can be made
 * to appear to have said something they didn't.
 */
function ReplyQuote({ quote, onPress }: { quote: ReplyQuote; onPress?: (id: number) => void }) {
  const { colors } = useTheme();
  const label = quote.mine ? 'You' : quote.name || 'Member';
  return (
    <Pressable
      onPress={() => quote.id && onPress?.(quote.id)}
      disabled={!onPress || !quote.id}
      accessibilityRole="button"
      accessibilityLabel={`Replying to ${label}: ${quote.preview || ''}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, maxWidth: '100%',
        alignSelf: 'flex-start', backgroundColor: colors.elevated, borderRadius: 10,
        borderLeftWidth: 3, borderLeftColor: colors.gold, paddingHorizontal: 8, paddingVertical: 5,
      }}
    >
      <Ionicons name="arrow-undo-outline" size={12} color={colors.gold} />
      <View style={{ flexShrink: 1 }}>
        <Txt variant="caption" color="gold" numberOfLines={1}>
          {label}
        </Txt>
        <Txt variant="caption" color="textSecondary" numberOfLines={1}>
          {quote.preview || 'Whisper'}
        </Txt>
      </View>
    </Pressable>
  );
}

function MomentQuote({ m }: { m: Message }) {
  const { colors } = useTheme();
  const style = MOMENT_STYLES[(m.meta.momentStyle as keyof typeof MOMENT_STYLES) || 'noir'] || MOMENT_STYLES.noir;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, alignSelf: m.mine ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.goldLine }} />
      <View style={{ width: 40, height: 54, borderRadius: 8, overflow: 'hidden' }}>
        {m.meta.momentKind === 'photo' && m.meta.momentMedia ? (
          <Photo uri={m.meta.momentMedia} style={{ width: 40, height: 54 }} />
        ) : (
          <LinearGradient colors={style.colors} style={{ flex: 1 }} />
        )}
      </View>
      <View style={{ maxWidth: 180 }}>
        <Txt variant="caption" color="textMuted">
          {m.mine ? 'You replied to their Moment' : 'Replied to your Moment'}
        </Txt>
        {m.meta.momentBody ? (
          <Txt variant="caption" color="textSecondary" numberOfLines={1}>
            {m.meta.momentBody}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A clip somebody whispered.
 *
 * It used to be a 220x280 player with native controls, sitting in the thread
 * like a photo. That is the wrong shape for a message: it is a whole video
 * player in the middle of a conversation, and it started itself.
 *
 * A whisper is a small window instead — a wide, short rectangle with a still
 * frame, the sender's name, and what it is. Nothing plays until it is opened,
 * which is what you want in a list of messages: one tap opens the clip full
 * screen, and the conversation never makes a sound on its own.
 */
function VideoNoteBubble({
  m,
  peerName,
  onOpen,
}: {
  m: Message;
  peerName: string;
  onOpen: () => void;
}) {
  const { colors } = useTheme();
  const seconds = Math.round(Number(m.meta.duration) || 0);
  const sender = m.mine ? 'You' : peerName || 'Someone';

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${sender} sent you a video, ${durationLabel(seconds)}. Open it.`}
      style={{
        width: 236,
        borderRadius: radius.lg,
        overflow: 'hidden',
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.goldLine,
      }}
    >
      {/* The window: a wide rectangle, not a portrait player. The play mark and
          the length are all it needs to say; the picture comes when it opens. */}
      <View style={{ height: 118, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.45)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.28)',
          }}
        >
          <Ionicons name="play" size={22} color="#fff" style={{ marginLeft: 3 }} />
        </View>
        <View
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 6,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        >
          <Ionicons name="videocam" size={10} color="#fff" />
          <Txt variant="caption" color="#FFFFFF">
            {durationLabel(seconds)}
          </Txt>
        </View>
        {m.pending ? (
          <ActivityIndicator size="small" color={colors.gold} style={{ position: 'absolute', top: 8, right: 8 }} />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Txt variant="smallStrong" numberOfLines={2} style={{ flex: 1 }}>
          {`${sender} sent you a video`}
        </Txt>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

function CallRequest({ m, ink }: { m: Message; ink: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 150 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: ink === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)' }}>
        <Ionicons name="call" size={18} color={ink} />
      </View>
      <View>
        <Txt variant="bodyStrong" color={ink}>
          Voice call
        </Txt>
        <Txt variant="caption" color={ink} style={{ opacity: 0.75 }}>
          {m.mine ? 'You requested a call' : 'Wants to call you'}
        </Txt>
      </View>
    </View>
  );
}

function VoiceNote({ m, ink }: { m: Message; ink: string }) {
  const { colors } = useTheme();
  const player = useAudioPlayer(mediaSource(mediaUrl(m.mediaUrl) ?? null));
  const status = useAudioPlayerStatus(player);
  const total = Number(m.meta.duration) || Math.round(status.duration || 0);
  const progress = total ? Math.min(1, (status.currentTime || 0) / total) : 0;

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => {});
    }
  }, [status.didJustFinish, player]);

  const toggle = () => {
    if (status.playing) player.pause();
    else player.play();
  };
  // Static faux waveform, deterministic per message so it doesn't jump around.
  const bars = Array.from({ length: 22 }, (_, i) => 6 + (((m.id * 7 + i * 13) % 17) / 17) * 16);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 190 }}>
      <Pressable
        onPress={toggle}
        disabled={m.pending}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : `Play voice note, ${durationLabel(total)}`}
        hitSlop={8}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: m.mine ? 'rgba(255,255,255,0.18)' : colors.goldSoft, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={status.playing ? 'pause' : 'play'} size={16} color={m.mine ? '#fff' : colors.gold} style={{ marginLeft: status.playing ? 0 : 2 }} />
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 }} accessibilityElementsHidden>
        {bars.map((h, i) => (
          <View key={i} style={{ flex: 1, height: h, borderRadius: 2, backgroundColor: ink, opacity: i / bars.length <= progress ? 0.95 : 0.35 }} />
        ))}
      </View>
      <Txt variant="caption" color={ink} style={{ opacity: 0.8, minWidth: 30 }}>
        {durationLabel(status.playing ? status.currentTime : total)}
      </Txt>
    </View>
  );
}

function summarize(reactions: Message['reactions']) {
  const map = new Map<string, number>();
  for (const r of reactions || []) map.set(r.kind, (map.get(r.kind) || 0) + 1);
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

function describe(m: Message): string {
  switch (m.kind) {
    case 'photo':
      return `Photo${m.body ? `, ${m.body}` : ''}`;
    case 'voice':
      return `Voice note, ${durationLabel(Number(m.meta.duration) || 0)}`;
    case 'video':
      return `Video note, ${durationLabel(Number(m.meta.duration) || 0)}`;
    case 'call':
      return 'Voice call request';
    case 'sticker':
      return `${STICKERS.find((s) => s.key === m.meta.sticker)?.label ?? ''} sticker`;
    case 'profile':
      return `Shared ${m.meta.name}'s Space`;
    case 'moment_reply':
      return `Reply to Moment: ${m.body}`;
    default:
      return m.body;
  }
}
