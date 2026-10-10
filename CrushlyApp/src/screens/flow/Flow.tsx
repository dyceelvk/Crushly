import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { Chip, ChipGroup } from '../../components/Chip';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { Input } from '../../components/Input';
import { useToast } from '../../components/Toast';
import { useCreatePost, useDeletePost, useFlow, useMe, useOpenConversation } from '../../api/hooks';
import type { Post } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { pickImage } from '../../lib/media';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Flow — what people are sharing.
 *
 * Home and Flow are the same screen, because they are the same idea: the place
 * you land, where posts live until their author removes them. Moments are the
 * opposite — twenty-four hours, then gone.
 *
 * Nothing here is visible to someone who is not signed in. A post is for your
 * Connections unless its author deliberately chooses Everyone, and that choice
 * is made fresh for every post.
 */
export function FlowScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();
  const { data: me } = useMe();
  const flow = useFlow();
  const [composer, setComposer] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl refreshing={flow.isRefetching} onRefresh={flow.refresh} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header">
              Flow
            </Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              What people are sharing. Posts stay until they’re removed.
            </Txt>
          </View>
        </View>

        <Pressable
          onPress={() => setComposer(true)}
          accessibilityRole="button"
          accessibilityLabel="Share a post"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.lg,
            backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
            paddingHorizontal: 14, paddingVertical: 12,
          }}
        >
          <Avatar uri={me?.profile.photos[0]?.url ?? null} name={me?.profile.name || 'You'} size={36} />
          <Txt variant="body" color="textMuted" style={{ flex: 1 }}>
            Share something…
          </Txt>
          <Ionicons name="create-outline" size={18} color={colors.gold} />
        </Pressable>

        <View style={{ marginTop: space.xl, gap: space.md }}>
          {flow.isLoading ? (
            <Skeleton style={{ height: 120 }} />
          ) : flow.isError ? (
            <ErrorState message={flow.error instanceof Error ? flow.error.message : 'Your Flow didn’t load.'} onRetry={flow.refresh} />
          ) : flow.posts.length ? (
            <>
              {flow.posts.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
              <Button title="Show older posts" variant="secondary" size="md" onPress={flow.loadOlder} loading={flow.isFetching} />
            </>
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title="Your Flow is quiet"
              message="Posts from people you’re connected with show up here. Share something and it will."
              action={{ label: 'Share a post', onPress: () => setComposer(true) }}
            />
          )}
        </View>
      </ScrollView>

      <Composer visible={composer} onClose={() => setComposer(false)} onPosted={flow.refresh} />
    </View>
  );
}

function PostCard({ post: p }: { post: Post }) {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const toast = useToast();
  const { data: me } = useMe();
  const remove = useDeletePost();
  const open = useOpenConversation();
  const { openActions } = useMemberActions();

  const whisper = async () => {
    try {
      const conv = await open.mutateAsync(p.author.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open your Whisper', message: (e as Error).message });
    }
  };

  const authorName = p.mine ? 'You' : p.author.name;

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.md, paddingTop: space.md }}>
        <Pressable
          onPress={() => (p.mine ? navigation.navigate('Main', { screen: 'Profile' }) : navigation.navigate('UserProfile', { id: p.author.id }))}
          accessibilityRole="button"
          accessibilityLabel={`Open ${authorName}’s Space`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
        >
          <Avatar uri={p.author.photos[0]?.url ?? null} name={p.author.name} size={38} ring={p.author.verified ? 'gold' : undefined} />
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {authorName}
              </Txt>
              {p.author.verified ? <VerifiedBadge size={14} /> : null}
            </View>
            <Txt variant="caption" color="textMuted" numberOfLines={1}>
              {[p.author.username ? `@${p.author.username}` : null, timeAgo(p.createdAt)].filter(Boolean).join('  ·  ')}
            </Txt>
          </View>
        </Pressable>
        <Pill label={p.audience === 'everyone' ? 'Everyone' : 'Connections'} />
        {p.mine ? (
          <IconButton
            icon="trash-outline"
            label="Delete post"
            onPress={() => remove.mutate(p.id, { onError: (e) => toast({ kind: 'error', title: 'Not deleted', message: (e as Error).message }) })}
            color={colors.textMuted}
          />
        ) : (
          <IconButton
            icon="ellipsis-horizontal"
            label={`More options for ${authorName}`}
            onPress={() =>
              openActions({
                id: p.author.id,
                name: p.author.name,
                connected: !!p.author.crush?.mutual,
                context: `post:${p.id}`,
              })
            }
            color={colors.textMuted}
          />
        )}
      </View>

      {p.body ? (
        <Txt variant="body" style={{ paddingHorizontal: space.md, paddingTop: space.sm, fontSize: 16, lineHeight: 23 }} selectable>
          {p.body}
        </Txt>
      ) : null}

      {p.mediaUrl ? (
        <View style={{ marginTop: space.sm }}>
          <Photo uri={p.mediaUrl} style={{ width: '100%', aspectRatio: 4 / 3 }} alt={`Post by ${authorName}`} />
        </View>
      ) : null}

      {!p.mine && p.author.crush?.mutual ? (
        <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}>
          <Button title="Whisper" size="sm" variant="secondary" icon="chatbubble-outline" onPress={whisper} />
        </View>
      ) : (
        <View style={{ height: space.sm }} />
      )}
    </View>
  );
}

function Pill({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border }}>
      <Txt variant="caption" color="textSecondary">
        {label}
      </Txt>
    </View>
  );
}

/** Share a post: words, a photo, and a deliberate choice about who sees it. */
function Composer({ visible, onClose, onPosted }: { visible: boolean; onClose: () => void; onPosted: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const create = useCreatePost();
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'connections' | 'everyone'>('connections');
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    setPicking(true);
    const img = await pickImage();
    setPicking(false);
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    setPhoto({ uri: img.uri, mimeType: img.mimeType || 'image/jpeg' });
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ body: body.trim(), audience, photoUri: photo?.uri ?? null, photoMime: photo?.mimeType ?? null });
      setBody('');
      setPhoto(null);
      setAudience('connections');
      onClose();
      onPosted();
    } catch (e) {
      toast({ kind: 'error', title: 'Post not shared', message: (e as Error).message });
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share a post">
      <View style={{ gap: space.md }}>
        <Input
          label="What’s on your mind?"
          value={body}
          onChangeText={setBody}
          placeholder="Something worth reading…"
          multiline
          maxLength={500}
          showCount
          hint="Posts stay until you remove them."
        />

        {photo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Photo uri={photo.uri} style={{ width: 64, height: 64, borderRadius: radius.sm }} />
            <Button title="Remove photo" size="sm" variant="secondary" onPress={() => setPhoto(null)} />
          </View>
        ) : (
          <Button title="Add a photo" size="md" variant="secondary" icon="image-outline" loading={picking} onPress={pick} />
        )}

        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Who can see this
          </Txt>
          <ChipGroup>
            <Chip label="Connections" selected={audience === 'connections'} onPress={() => setAudience('connections')} />
            <Chip label="Everyone" selected={audience === 'everyone'} onPress={() => setAudience('everyone')} />
          </ChipGroup>
          <Txt variant="small" color="textMuted">
            {audience === 'everyone'
              ? 'Any signed-in member can read this — including people you haven’t met. Nobody outside Crushly can.'
              : 'Only the people you’ve Clicked with, and anyone you Click with later.'}
          </Txt>
        </View>

        <Button title="Share post" variant="primary" size="md" onPress={submit} loading={create.isPending} disabled={!body.trim() && !photo} />
      </View>
    </BottomSheet>
  );
}
