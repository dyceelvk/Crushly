import React, { memo, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Txt } from './Txt';
import { Photo, Avatar } from './Photo';
import { VerifiedBadge } from './Badges';
import { CrushIcon } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { EditedClip } from './EditedClip';
import type { Message, ReplyQuote } from '../api/types';
import { mediaUrl } from '../api/client';
import { mediaSource } from '../lib/mediaHost';
import { MOMENT_STYLES, STICKERS } from '../lib/catalog';
import { clockTime, durationLabel } from '../lib/format';
import { messageStatus } from '../lib/messageStatus';

export const REACTIONS: { key: string; label: string; emoji?: string }[] = [
  { key: 'crush', label: 'Crush' },
  { key: 'laugh', label: 'Laugh', emoji: '😂' },
  { key: 'fire', label: 'Fire', emoji: '🔥' },
  { key: 'wow', label: 'Wow', emoji: '😮' },
];

type Props = {
  message: Message;
  /** First bubble of a run from the same sender (spacing, flat top corner). */
  firstInGroup: boolean;
  /** Last bubble of the run — the one that carries the tail and the time. */
  lastInGroup: boolean;
  /** Prints the clock time under this bubble. */
  showTime: boolean;
  peerName: string;
  onLongPress: (m: Message) => void;
  onDoubleTap: (m: Message) => void;
  onOpenPhoto: (uri: string) => void;
  onOpenProfile: (id: number) => void;
  /** A shared post opens the post itself. */
  onOpenPost?: (id: number) => void;
  onRetry: (m: Message) => void;
  /** Tapping the quoted original — jumps back to it in the conversation. */
  onOpenReply?: (id: number) => void;
};

/**
 * What happened to a message I sent, in one glyph.
 *
 *   sent       ✓    the server has it
 *   delivered  ✓✓   their device has it
 *   read       ✓✓   in gold — they opened the thread
 *
 * "Sending" is a spinner and "failed" is an error line, because those two are
 * states to act on rather than facts to note.
 */
const StatusTick = memo(function StatusTick({ status }: { status: 'sent' | 'delivered' | 'read' }) {
  const { colors } = useTheme();
  if (status === 'sent') return <Ionicons name="checkmark" size={13} color={colors.textSecondary} accessibilityLabel="Sent" />;
  const read = status === 'read';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={read ? 'Read' : 'Delivered'}>
      <Ionicons name="checkmark" size={13} color={read ? colors.gold : colors.textSecondary} />
      <Ionicons name="checkmark" size={13} color={read ? colors.gold : colors.textSecondary} style={{ marginLeft: -6 }} />
    </View>
  );
});

export const MessageBubble = memo(function MessageBubble({ message: m, firstInGroup, lastInGroup, showTime, peerName, onLongPress, onDoubleTap, onOpenPhoto, onOpenProfile, onOpenPost, onRetry, onOpenReply }: Props) {
  const { colors } = useTheme();
  const lastTap = useRef(0);
  const bare = m.kind === 'sticker' || m.kind === 'photo' || m.kind === 'profile' || m.kind === 'post';
  /* Only my own messages carry a status; theirs are not mine to report. */
  const status = messageStatus(m);
  const statusWord = status === 'sending' ? ', sending' : status === 'sent' ? ', sent' : status === 'delivered' ? ', delivered' : status === 'read' ? ', read' : '';
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
      if (m.kind === 'post' && m.meta.postId) onOpenPost?.(Number(m.meta.postId));
    }
  };

  const reactionSummary = summarize(m.reactions);
  const a11y = `${m.mine ? 'You' : peerName}: ${describe(m)}. ${clockTime(m.createdAt)}${statusWord}${m.failed ? ', not sent, tap to retry' : ''}${reactionSummary.length ? `, reactions: ${reactionSummary.map((r) => r.key).join(', ')}` : ''}`;

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
          <BareContent m={m} />
        ) : (
          <View
            style={{
              backgroundColor: bg, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
              // A run from one sender reads as one block: the corners between
              // its bubbles go flat, and only the last bubble carries the tail.
              // (Squaring the *first* bubble, the way this used to, put the tail
              // above the messages that followed it.)
              borderTopRightRadius: m.mine && !firstInGroup ? 6 : 20,
              borderBottomRightRadius: m.mine && lastInGroup ? 6 : 20,
              borderTopLeftRadius: !m.mine && !firstInGroup ? 6 : 20,
              borderBottomLeftRadius: !m.mine && lastInGroup ? 6 : 20,
              borderWidth: m.mine ? 0 : 1, borderColor: colors.border,
            }}
          >
            {m.kind === 'voice' ? <VoiceNote m={m} ink={ink} /> : <Txt variant="body" color={ink} selectable>{m.body}</Txt>}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginHorizontal: 4 }}>
          <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.7 }] }} />
          <Txt variant="caption" color="textMuted">Sending…</Txt>
        </View>
      ) : showTime || status ? (
        // The time was only ever in the accessibility label, so a sighted member
        // had no idea when anything was said unless the day rolled over.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginHorizontal: 4 }}>
          {status === 'sent' || status === 'delivered' || status === 'read' ? <StatusTick status={status} /> : null}
          {showTime ? (
            <Txt variant="caption" color="textMuted">{clockTime(m.createdAt)}</Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function BareContent({ m }: { m: Message }) {
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
    return <VideoNoteBubble m={m} />;
  }
  if (m.kind === 'post') {
    return <SharedPostBubble m={m} />;
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
 * A post that was sent into a whisper.
 *
 * Small and square, on the side of whoever sent it — the shape a shared thing
 * should be in a conversation: enough to see what it is, small enough that the
 * words around it still have room. The card is only a door: tapping it opens the
 * post, where reacting and commenting live.
 */
function SharedPostBubble({ m }: { m: Message }) {
  const { colors } = useTheme();
  const name = typeof m.meta.name === 'string' ? m.meta.name : null;
  const body = String(m.meta.body ?? '');
  const media = typeof m.meta.mediaUrl === 'string' ? m.meta.mediaUrl : null;
  const video = m.meta.mediaKind === 'video';
  const mine = m.mine;

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        padding: 8,
        width: 246,
        borderRadius: radius.lg,
        backgroundColor: mine ? colors.crushDeep : colors.card,
        borderWidth: 1,
        borderColor: mine ? colors.crush : colors.border,
      }}
    >
      {/* The picture, square: a clip gets its cover-less self with a play mark. */}
      <View style={{ width: 72, height: 72, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000' }}>
        {media && !video ? (
          <Photo uri={media} fit="cover" style={{ width: 72, height: 72 }} alt="" />
        ) : media && video ? (
          <EditedClip uri={mediaSource(mediaUrl(media) ?? null)} live={null} style={{ width: 72, height: 72 }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated }}>
            <Ionicons name="document-text-outline" size={22} color={colors.textMuted} />
          </View>
        )}
        {video ? (
          <View style={{ position: 'absolute', right: 4, bottom: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={9} color="#fff" />
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Txt variant="caption" color={mine ? '#FFFFFF' : 'gold'} numberOfLines={1} style={{ opacity: mine ? 0.8 : 1 }}>
            {name ? (mine ? `You shared ${name}’s post` : `${name}’s post`) : 'Shared a post'}
          </Txt>
          <Txt variant="small" color={mine ? '#FFFFFF' : 'text'} numberOfLines={3}>
            {body || (media ? (video ? 'A clip' : 'A photo') : 'Open to see if this post is available to you.')}
          </Txt>
        </View>
        <Txt variant="caption" color={mine ? '#FFFFFF' : 'gold'} style={{ opacity: mine ? 0.8 : 1 }}>
          Open post
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
 * A video note is a circle, and it stays a circle.
 *
 * A note is ten seconds and a glance — the shape says that before the timer
 * does, and it keeps the bubble the same size whatever the camera was holding
 * when it was recorded. The picture is cropped to fill the circle (`cover`)
 * rather than letterboxed: inside a round frame a letterbox is a bar of black
 * pretending to be part of the message.
 */
const NOTE_BUBBLE = 208;

function VideoNoteBubble({ m }: { m: Message }) {
  const { colors } = useTheme();
  const player = useVideoPlayer(m.mediaUrl ? mediaSource(mediaUrl(m.mediaUrl)) : null, (p) => {
    p.loop = false;
  });
  const duration = Number(m.meta.duration) || 0;
  return (
    <View
      style={{
        width: NOTE_BUBBLE,
        height: NOTE_BUBBLE,
        borderRadius: NOTE_BUBBLE / 2,
        overflow: 'hidden',
        backgroundColor: '#000',
        borderWidth: 1.5,
        borderColor: colors.goldLine,
      }}
    >
      <VideoView
        player={player}
        style={{ width: NOTE_BUBBLE, height: NOTE_BUBBLE }}
        contentFit="cover"
        nativeControls
        accessibilityLabel={`Video note, ${durationLabel(duration)}`}
      />
      {/* The length is part of what a circle cannot show on its own. */}
      <View
        style={{
          position: 'absolute',
          bottom: 12,
          alignSelf: 'center',
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 2,
        }}
        pointerEvents="none"
      >
        <Txt variant="caption" color="#fff">
          {durationLabel(duration)}
        </Txt>
      </View>
      {m.pending ? <ActivityIndicator size="small" color={colors.gold} style={{ position: 'absolute', top: 14, right: 14 }} /> : null}
    </View>
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
    case 'post':
      return `Shared ${m.meta.name}’s post`;
    case 'moment_reply':
      return `Reply to Moment: ${m.body}`;
    default:
      return m.body;
  }
}
