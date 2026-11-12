import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useConversations, useSendMessage, useSharePostToMoment } from '../api/hooks';
import type { ConversationSummary, Post } from '../api/types';
import { timeAgo } from '../lib/format';
import { haptic } from '../lib/haptics';
import { postShareUrl } from '../lib/postShare';
import { canSaveClip } from '../lib/clipSaveRules';
import { postDownloadUrl } from '../lib/mediaHost';
import { saveClipToDevice } from '../lib/downloadClip';
import { publicPostPreview, postDownload } from '../api/service';

/**
 * Send a post into a Whisper.
 *
 * Sharing used to mean one thing: hand the text to the system share sheet and
 * hope the other person was reachable some other way. But the person you want to
 * show a post to is usually someone you are already talking to here — so "Share"
 * now opens the rooms you actually have, and sending puts a card in the thread
 * that both sides can tap to open the post.
 *
 * Shared cards contain a reference only; access is checked when opened.
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
  const toMoment = useSharePostToMoment();
  const [sharedToMoment, setSharedToMoment] = useState(false);
  const [query, setQuery] = useState('');
  const [sentTo, setSentTo] = useState<Record<number, true>>({});
  const [saving, setSaving] = useState(false);
  // The marked copy is looked up when the sheet opens, not carried on every post
  // in every feed: it is needed on one screen, and a storage key has no business
  // travelling to every client.
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  /*
   * Three states, not two.
   *
   * The row used to be hidden until the lookup came back, so on a clip with no
   * marked copy — or on a slow lookup — Save simply was not on the sheet, which
   * reads as a feature that does not exist. The row is always there for a clip
   * now, and says which of the three it is: checking, ready, or not ready yet.
   */
  const [copyState, setCopyState] = useState<'checking' | 'ready' | 'none' | 'error'>('checking');
  const [copyError, setCopyError] = useState<string | null>(null);

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

  const prepareLink = async (): Promise<string | null> => {
    if (!post) return null;
    try {
      if (!await publicPostPreview(post.id)) {
        toast({ kind: 'info', title: 'Not a public post', message: 'Only publicly available posts can be shared outside holUpp.' });
        return null;
      }
      return postShareUrl(post.id);
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t prepare link', message: (e as Error).message });
      return null;
    }
  };
  const outside = async () => {
    const url = await prepareLink();
    if (!url) return;
    try { await Share.share({ message: url }); } catch { /* dismissed */ }
  };
  /**
   * Save the marked copy of a clip to this device.
   *
   * It sits here, with Copy link and Share outside, because all three answer the
   * same question: how does this leave the app. It is offered only when the
   * pipeline has produced a marked copy — see `canSaveClip` — so a tap can never
   * hand out somebody's work with no name on it.
   */
  /*
   * Ask the server, do not infer.
   *
   * This used to open with `if (post.mediaKind !== 'video') -> no copy`, before
   * anything was asked. `mediaKind` is derived from a URL by a regex in a feed
   * function, so any clip whose stored URL looks unusual read as a photo and was
   * reported as having no copy — while the marked copy existed, and the server
   * would have handed it over. The row then said "still being prepared" forever,
   * which is the owner's report exactly.
   *
   * A copy only ever exists for a clip, so the question to ask is the one
   * `post_download` answers, and nothing else. And when that question fails, say
   * so — a swallowed error is indistinguishable from "not ready yet", which is
   * how a broken lookup spent a day looking like a paused job.
   */
  const checkCopy = useCallback(async (alive: () => boolean) => {
    if (!post) { setCopyState('none'); return; }
    setCopyState('checking');
    try {
      const copy = await postDownload(post.id);
      if (!alive()) return;
      const url = copy ? postDownloadUrl(post.id) : null;
      setDownloadUrl(url);
      setCopyState(copy && !url ? 'error' : url ? 'ready' : 'none');
      if (copy && !url) setCopyError('The media host is switched off in this build.');
    } catch (e) {
      if (!alive()) return;
      setDownloadUrl(null);
      setCopyState('error');
      setCopyError((e as Error).message || 'The copy could not be checked.');
    }
  }, [post]);

  useEffect(() => {
    let live = true;
    setDownloadUrl(null);
    setCopyError(null);
    void checkCopy(() => live);
    return () => { live = false; };
  }, [checkCopy]);

  /**
   * Share the post to Moments as a nine-second preview.
   *
   * The card is a doorway, not a copy: the post keeps its own audience, and
   * whoever opens the card lands on the post itself.
   */
  const shareToMoment = async () => {
    if (!post || toMoment.isPending) return;
    haptic.tap();
    try {
      await toMoment.mutateAsync({ postId: post.id });
      setSharedToMoment(true);
      toast({ kind: 'success', title: 'In your Moment', message: 'A nine-second preview, with their name under it.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t share it', message: (e as Error).message });
    }
  };

  const save = async () => {
    if (!post || saving || !downloadUrl) return;
    setSaving(true);
    haptic.tap();
    try {
      const outcome = await saveClipToDevice({ id: post.id, mediaKind: post.mediaKind, downloadUrl });
      if (outcome === 'saved') {
        toast({ kind: 'success', title: 'Saved to your device', message: 'This copy carries the holUpp mark and the creator’s handle.' });
      } else if (outcome === 'downloaded') {
        toast({ kind: 'success', title: 'Clip downloaded', message: 'This copy carries the holUpp mark and the creator’s handle.' });
      } else if (outcome === 'denied') {
        toast({ kind: 'error', title: 'Photos and videos are off', message: 'Allow photo access in your phone settings, then tap Save again.' });
      } else {
        toast({ kind: 'info', title: 'No downloadable copy', message: 'This post has no marked copy to save yet.' });
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t save the clip', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    const url = await prepareLink();
    if (!url) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(url);
      toast({ kind: 'success', title: 'Link copied' });
    } catch (e) { toast({ kind: 'error', title: 'Couldn’t copy link', message: (e as Error).message }); }
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
                ? 'Try another name, or send it outside holUpp below.'
                : 'A Whisper opens when you and somebody both Crush. Until then, send it outside holUpp below.'
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
        {/* The row exists when a copy does, or when the post says it is a clip
            and the copy is not ready yet. A photo gets no row: nothing about a
            photo can ever be saved, and an offer that can only refuse is noise. */}
        {post && (copyState !== 'none' || post.mediaKind === 'video') ? (
          <Pressable
            onPress={copyState === 'error' ? () => { setCopyError(null); void checkCopy(() => true); } : save}
            disabled={saving || (copyState !== 'error' && !canSaveClip({ mediaKind: post.mediaKind, downloadUrl }))}
            accessibilityRole="button"
            accessibilityLabel="Save this clip to your device"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 12,
              opacity: saving || copyState !== 'ready' ? 0.6 : pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={saving ? 'hourglass-outline' : copyState === 'error' ? 'refresh-outline' : 'download-outline'}
              size={20}
              color={copyState === 'ready' ? colors.gold : colors.textSecondary}
            />
            <Txt variant="body">
              {saving ? 'Saving…'
                : copyState === 'checking' ? 'Checking for a copy…'
                : copyState === 'ready' ? 'Save clip to device'
                : copyState === 'error' ? 'Couldn’t check for a copy'
                : 'No saved copy yet'}
            </Txt>
            <Txt variant="caption" color="textMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
              {copyState === 'ready' ? '· with the holUpp mark'
                : copyState === 'error' ? `· tap to retry${copyError ? ` (${copyError})` : ''}`
                : copyState === 'none' ? '· still being prepared'
                : ''}
            </Txt>
          </Pressable>
        ) : null}
        <Pressable
          onPress={shareToMoment}
          disabled={toMoment.isPending}
          accessibilityRole="button"
          accessibilityLabel="Share this post to your Moment"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 12,
            opacity: toMoment.isPending ? 0.6 : pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name={sharedToMoment ? 'checkmark-circle' : 'flash-outline'}
            size={20}
            color={sharedToMoment ? colors.gold : colors.textSecondary}
          />
          <Txt variant="body">{sharedToMoment ? 'Shared to your Moment' : 'Share to your Moment'}</Txt>
          <Txt variant="caption" color="textMuted">· 9 second preview</Txt>
        </Pressable>
        <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel="Copy post link" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
          <Ionicons name="link-outline" size={20} color={colors.textSecondary} />
          <Txt variant="body">Copy link</Txt>
        </Pressable>
        <Pressable
          onPress={outside}
          accessibilityRole="button"
          accessibilityLabel="Share outside holUpp"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 12,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={20} color={colors.textSecondary} />
          <Txt variant="body">Share outside holUpp</Txt>
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
      return 'A video note';
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
