import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { Avatar } from './Photo';
import { BottomSheet } from './BottomSheet';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { LoadingBlock, EmptyState } from './States';
import { useToast } from './Toast';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { useConversations, useSendMessage } from '../api/hooks';
import type { ConversationSummary, Post } from '../api/types';
import { timeAgo } from '../lib/format';
import { haptic } from '../lib/haptics';

/**
 * Send a post into a Whisper.
 *
 * Sharing used to mean one thing: hand the text to the system share sheet and
 * hope the other person was reachable some other way. But the person you want to
 * show a post to is usually someone you are already talking to here — so "Share"
 * now opens the rooms you actually have, and sending puts a card in the thread
 * that both sides can tap to open the post.
 *
 * The card is a snapshot taken by the server (`send_message`, `p_kind = 'post'`),
 * so a recipient sees the author's real name and media, and a private post
 * cannot be passed around by knowing its id.
 */
export function ShareToWhisper({
  visible,
  post,
  onClose,
}: {
  visible: boolean;
  post: Post | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const list = useConversations();
  const send = useSendMessage();
  const [query, setQuery] = useState('');
  const [sentTo, setSentTo] = useState<Record<number, true>>({});

  const people: ConversationSummary[] = useMemo(() => {
    const items: ConversationSummary[] = list.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => (c.peer?.name ?? '').toLowerCase().includes(q));
  }, [list.data, query]);

  const whisper = async (c: ConversationSummary) => {
    if (!post) return;
    haptic.tap();
    try {
      await send.mutateAsync({ conversationId: c.id, draft: { kind: 'post', postId: post.id } });
      setSentTo((s) => ({ ...s, [c.id]: true }));
      toast({ kind: 'success', title: `Sent to ${c.peer.name}`, message: 'It’s in your Whisper.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Not sent', message: (e as Error).message });
    }
  };

  const outside = async () => {
    if (!post) return;
    try {
      await Share.share({
        message: post.body ? `${post.body}\n\n— on Hollop` : 'A post on Hollop',
      });
    } catch {
      // Backing out of the system sheet is not a failure worth reporting.
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Send this post">
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search your Whisper"
          icon="search"
          autoCorrect={false}
          accessibilityLabel="Search your Whisper"
        />
      </View>

      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: 6 }} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <LoadingBlock label="Loading your Whisper" />
        ) : !people.length ? (
          <EmptyState
            icon="chatbubble-outline"
            title={query ? 'Nobody by that name' : 'No Whispers yet'}
            message={
              query
                ? 'Try another name, or send it outside Hollop below.'
                : 'A Whisper opens when you and somebody both Crush. Until then, send it outside Hollop below.'
            }
          />
        ) : (
          people.map((c) => {
            const sent = !!sentTo[c.id];
            const last = c.lastMessage;
            return (
              <Pressable
                key={c.id}
                onPress={() => (sent ? undefined : whisper(c))}
                disabled={sent || send.isPending}
                accessibilityRole="button"
                accessibilityLabel={sent ? `Sent to ${c.peer.name}` : `Send this post to ${c.peer.name}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 10,
                  borderRadius: radius.md,
                  backgroundColor: pressed ? colors.elevated : 'transparent',
                  opacity: sent ? 0.6 : 1,
                })}
              >
                <Avatar uri={c.peer.photo ?? null} name={c.peer.name} size={44} online={c.peer.online} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {c.peer.name}
                  </Txt>
                  <Txt variant="caption" color="textMuted" numberOfLines={1}>
                    {last ? `${lastPreview(last.kind, last.body)} · ${timeAgo(last.createdAt)}` : 'Say hello'}
                  </Txt>
                </View>
                {sent ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.gold} />
                ) : (
                  <IconButton icon="arrow-forward" label={`Send to ${c.peer.name}`} onPress={() => whisper(c)} />
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={{ padding: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pressable
          onPress={outside}
          accessibilityRole="button"
          accessibilityLabel="Share outside Hollop"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 12,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={20} color={colors.textSecondary} />
          <Txt variant="body">Share outside Hollop</Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

/** One line about what the last message in a thread was. */
function lastPreview(kind: string, body: string): string {
  switch (kind) {
    case 'photo':
      return 'Photo';
    case 'voice':
      return 'Voice note';
    case 'video':
      return 'Video note';
    case 'sticker':
      return 'Sticker';
    case 'profile':
      return 'Shared a Space';
    case 'post':
      return 'Shared a post';
    case 'call':
      return 'Voice call';
    default:
      return body || 'Whisper';
  }
}
