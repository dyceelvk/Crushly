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
import type { Message } from '../api/types';
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
  onOpenProfile: (id: number) => void;
  onRetry: (m: Message) => void;
};

export const MessageBubble = memo(function MessageBubble({ message: m, firstInGroup, showSeen, peerName, onLongPress, onDoubleTap, onOpenPhoto, onOpenProfile, onRetry }: Props) {
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
        {m.kind === 'moment_reply' ? <MomentQuote m={m} /> : null}
        {bare ? (
          <BareContent m={m} />
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
            Shared profile
          </Txt>
        </View>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10, alignItems: 'center' }}>
        <Txt variant="smallStrong" color="gold">
          View profile
        </Txt>
      </View>
    </View>
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

function VideoNoteBubble({ m }: { m: Message }) {
  const { colors } = useTheme();
  const player = useVideoPlayer(m.mediaUrl ? mediaSource(mediaUrl(m.mediaUrl)) : null, (p) => {
    p.loop = false;
  });
  return (
    <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', width: 220 }}>
      <VideoView
        player={player}
        style={{ width: 220, height: 280 }}
        contentFit="cover"
        nativeControls
        accessibilityLabel={`Video note, ${durationLabel(Number(m.meta.duration) || 0)}`}
      />
      {m.pending ? <ActivityIndicator size="small" color={colors.gold} style={{ position: 'absolute', top: 8, right: 8 }} /> : null}
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
        accessibilityLabel={status.playing ? 'Pause voice message' : `Play voice message, ${durationLabel(total)}`}
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
      return `Voice message, ${durationLabel(Number(m.meta.duration) || 0)}`;
    case 'video':
      return `Video note, ${durationLabel(Number(m.meta.duration) || 0)}`;
    case 'call':
      return 'Voice call request';
    case 'sticker':
      return `${STICKERS.find((s) => s.key === m.meta.sticker)?.label ?? ''} sticker`;
    case 'profile':
      return `Shared ${m.meta.name}'s profile`;
    case 'moment_reply':
      return `Reply to Moment: ${m.body}`;
    default:
      return m.body;
  }
}
