import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { CircleStrip } from '../../components/CircleStrip';
import { LinkText } from '../../components/LinkText';
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
import {
  useCommentOnPost, useCreatePost, useDeletePost, useDeletePostComment, useFlow, useMe, useMyCircles,
  useOpenConversation, usePostComments, useReactToPost,
} from '../../api/hooks';
import type { Post, PostComment } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { pickImage } from '../../lib/media';
import * as ImagePicker from 'expo-image-picker';
import { VideoEditorModal } from '../../components/VideoEditor';
import { EditedClip } from '../../components/EditedClip';
import { splitForUpload, emptyEdit, type VideoEdit } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Flows — what people are sharing.
 *
 * Home and Flows are the same screen, because they are the same idea: the place
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
              Flows
            </Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              What people are sharing. Posts stay until they’re removed.
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="search-outline" label="Search" onPress={() => navigation.navigate('Search')} />
            <IconButton icon="chatbubble-ellipses-outline" label="Your Circles" onPress={() => navigation.navigate('Circles')} />
          </View>
        </View>

        {/* Home opens on the rooms you belong to, not on a list of strangers. */}
        <View style={{ marginTop: space.lg }}>
          <CircleStrip />
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

        {/* Discover is not a tab: it is one door, here, that opens into a
            single screen holding People, Moments and Vibes as sections. */}
        <Pressable
          onPress={() => navigation.navigate('Discover')}
          accessibilityRole="button"
          accessibilityLabel="Discover. Vibes, Moments and public posts"
          style={{
            marginTop: space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: colors.goldSoft,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.gold,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Ionicons name="compass-outline" size={18} color={colors.gold} />
          <Txt variant="bodyStrong" style={{ flex: 1 }}>
            Discover
          </Txt>
          <Txt variant="small" color="textSecondary" style={{ flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
            Vibes, Moments and public posts
          </Txt>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <View style={{ marginTop: space.xl, gap: space.md }}>
          {flow.isLoading ? (
            <Skeleton style={{ height: 120 }} />
          ) : flow.isError ? (
            <ErrorState message={flow.error instanceof Error ? flow.error.message : 'Your Flows didn’t load.'} onRetry={flow.refresh} />
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
              title="Your Flows are quiet"
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

/** One post. Also used inside a Circle, where the audience is the room. */
export function PostCard({ post: p }: { post: Post }) {
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

  const [commentsOpen, setCommentsOpen] = useState(false);
  const like = useReactToPost();

  const share = async () => {
    try {
      await Share.share({ message: p.body ? `${p.body}\n\n— ${authorName} on Crushly` : `${authorName} on Crushly` });
    } catch {
      // Backing out of a share sheet is not a failure worth reporting.
    }
  };

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

      {/* Post body + media: tap to open the full post view */}
      <Pressable
        onPress={() => navigation.navigate('PostViewer', { postId: p.id })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${authorName}’s post`}
        style={{ marginTop: space.sm }}
      >
        {p.body ? (
          <Txt variant="body" style={{ paddingHorizontal: space.md, paddingTop: space.sm, fontSize: 16, lineHeight: 23 }} selectable>
            <LinkText text={p.body} bare />
          </Txt>
        ) : null}

        {p.mediaUrl ? (
          <View style={{ marginTop: space.sm }}>
            {p.mediaKind === 'video' ? (
              <EditedClip uri={p.mediaUrl} live={p.edit} autoPlay loop style={{ width: '100%', maxHeight: 400 }} />
            ) : (
              <Photo uri={p.mediaUrl} fit="contain" contentPosition="center" style={{ width: '100%', maxHeight: 500 }} alt={`Post by ${authorName}`} />
            )}
          </View>
        ) : null}
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <PostAction
          icon="chatbubble-outline"
          count={p.commentCount}
          label="Comments"
          onPress={() => setCommentsOpen(true)}
        />
        <PostAction
          icon={p.liked ? 'heart' : 'heart-outline'}
          count={p.likeCount}
          label={p.liked ? 'Take back your like' : 'Like'}
          active={p.liked}
          onPress={() => like.mutate({ postId: p.id, liked: !p.liked })}
        />
        <PostAction icon="share-social-outline" label="Share this post" onPress={share} />
      </View>

      {!p.mine && p.author.crush?.mutual ? (
        <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}>
          <Button title="Whisper" size="sm" variant="secondary" icon="chatbubble-outline" onPress={whisper} />
        </View>
      ) : (
        <View style={{ height: space.sm }} />
      )}

      <PostComments postId={p.id} visible={commentsOpen} onClose={() => setCommentsOpen(false)} />
    </View>
  );
}

/** One of the three things you can do with a post, shown under it. */
function PostAction({
  icon, count, label, active, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={active ? colors.gold : colors.textMuted} />
      {count === undefined || count === 0 ? null : (
        <Txt variant="caption" color={active ? 'gold' : 'textSecondary'}>
          {String(count)}
        </Txt>
      )}
    </Pressable>
  );
}

/** The comments under one post, read and written in place. */
function PostComments({ postId, visible, onClose }: { postId: number; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const query = usePostComments(visible ? postId : null);
  const send = useCommentOnPost(postId);
  const remove = useDeletePostComment(postId);
  const [draft, setDraft] = useState('');

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await send.mutateAsync(body);
    } catch (e) {
      setDraft(body);
      toast({ kind: 'error', title: 'Comment not added', message: (e as Error).message });
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Comments">
      <View style={{ maxHeight: 380 }}>
        {query.isLoading ? <Skeleton style={{ height: 60 }} /> : null}
        {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : null}
        {query.data?.items?.length === 0 ? (
          <Txt variant="body" color="textMuted" style={{ paddingVertical: space.lg, textAlign: 'center' }}>
            No comments yet. Be the first.
          </Txt>
        ) : null}
        {(query.data?.items ?? []).map((c) => (
          <CommentRow key={c.id} comment={c} onDelete={() => remove.mutate(c.id)} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: space.sm, borderTopWidth: 1, borderColor: colors.border }}>
        <View style={{ flex: 1 }}>
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a comment"
            maxLength={1000}
            multiline
            containerStyle={{ minWidth: 0 }}
          />
        </View>
        <Button title="Send" size="sm" onPress={submit} loading={send.isPending} disabled={!draft.trim()} />
      </View>
    </BottomSheet>
  );
}

function CommentRow({ comment: c, onDelete }: { comment: PostComment; onDelete: () => void }) {
  const navigation = useNavigation<Nav>();
  return (
    <Pressable
      onPress={() => (c.mine ? navigation.navigate('Main', { screen: 'Profile' }) : navigation.navigate('UserProfile', { id: c.author.id }))}
      accessibilityRole="button"
      style={{ flexDirection: 'row', gap: 10, paddingVertical: space.sm }}
    >
      <Avatar uri={c.author.photos[0]?.url ?? null} name={c.author.name} size={32} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="caption" color="textMuted">
          {c.mine ? 'You' : c.author.name} · {timeAgo(c.createdAt)}
        </Txt>
        <Txt variant="body" selectable>
          {c.body}
        </Txt>
      </View>
      {c.mine ? <IconButton icon="trash-outline" label="Delete comment" onPress={onDelete} color="textMuted" /> : null}
    </Pressable>
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
  const { data: circles } = useMyCircles();
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'connections' | 'everyone' | 'circle'>('connections');
  const [circleId, setCircleId] = useState<number | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string; edit?: VideoEdit | null } | null>(null);
  const [clip, setClip] = useState<{ uri: string; mimeType: string; durationMs: number } | null>(null);
  const [clipEdit, setClipEdit] = useState<VideoEdit | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [fontIndex, setFontIndex] = useState(0);

  const insertText = (text: string) => {
    setBody((prev) => (prev.trim().endsWith(text.trim()) ? prev : prev + ' ' + text));
  };

  const FONT_OPTIONS = [
    fonts.regular,
    fonts.medium,
    fonts.semibold,
    fonts.bold,
    fonts.display,
    fonts.displayItalic,
  ] as const;

  const [picking, setPicking] = useState(false);

  // What the player draws over the clip: only the words and stickers. The cut
  // itself is written into the file when the post is shared.
  const liveEdit = clipEdit ? splitForUpload(clipEdit, 'post').live : null;

  const pick = async () => {
    setPicking(true);
    const img = await pickImage();
    setPicking(false);
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    setPhoto({ uri: img.uri, mimeType: img.mimeType || 'image/jpeg' });
  };

  const pickClip = async () => {
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: 60,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setPhoto(null);
      setClipEdit(null);
      setClip({ uri: asset.uri, mimeType: asset.mimeType || 'video/mp4', durationMs: asset.duration ?? 0 });
    } catch (e) {
      toast({ kind: 'error', title: 'Clip not added', message: (e as Error).message });
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    try {
      const prepared = clip ? await preparedClip(clipEdit, clip.uri, 'post') : null;
      const photoEdit = photo?.edit ? splitForUpload(photo.edit, 'post').live : null;
      await create.mutateAsync({
        body: body.trim(),
        audience: audience === 'circle' ? 'connections' : audience,
        circleId: audience === 'circle' ? circleId : null,
        photoUri: photo?.uri ?? null,
        photoMime: photo?.mimeType ?? null,
        videoUri: prepared ? prepared.uri : null,
        videoMime: clip?.mimeType ?? null,
        edit: prepared ? prepared.live : photoEdit ?? null,
      });
      setBody('');
      setPhoto(null);
      setClip(null);
      setClipEdit(null);
      setAudience('connections');
      setCircleId(null);
      onClose();
      onPosted();
    } catch (e) {
      toast({ kind: 'error', title: 'Post not shared', message: (e as Error).message });
    }
  };

  return (
    <>
      <VideoEditorModal
        visible={editorOpen}
        sourceUri={photo?.uri ?? clip?.uri ?? null}
        sourceDuration={clip?.durationMs ? clip.durationMs / 1000 : 0}
        category="post"
        onCancel={() => setEditorOpen(false)}
        onDone={(r) => {
          if (photo) {
            setPhoto({ ...photo, edit: r.edit });
          } else {
            setClipEdit(r.edit ?? emptyEdit(clip?.durationMs ? clip.durationMs / 1000 : 0));
          }
          setEditorOpen(false);
        }}
      />

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
          style={{ fontFamily: FONT_OPTIONS[fontIndex] }}
        />

        {/* Media Settings chips + actions under text bar */}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {photo || clip ? (
            <>
              <Pressable onPress={() => setEditorOpen(true)} accessibilityLabel="Edit media" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
                <Ionicons name="color-wand-outline" size={18} color={colors.textMuted} />
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={() => setFontIndex((i) => (i + 1) % FONT_OPTIONS.length)} accessibilityLabel="Change font" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.text }}>Aa</Txt>
          </Pressable>
          <Pressable onPress={() => insertText('@')} accessibilityLabel="Tag someone" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.text }}>@</Txt>
          </Pressable>
          <Pressable onPress={() => insertText('#')} accessibilityLabel="Add hashtag" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.text }}>#</Txt>
          </Pressable>
          <Pressable onPress={() => setAudience(audience === 'everyone' ? 'connections' : 'everyone')} accessibilityLabel="Public or private" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name={audience === 'everyone' ? 'globe' : 'lock-closed'} size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {photo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Photo uri={photo.uri} style={{ width: 64, height: 64, borderRadius: radius.sm }} />
            <Button title="Remove photo" size="sm" variant="secondary" onPress={() => setPhoto(null)} />
          </View>
        ) : null}

        {clip ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <EditedClip uri={clip.uri} live={liveEdit} style={{ width: 64, height: 64, borderRadius: radius.sm }} />
            <Button title={clipEdit ? 'Edit again' : 'Edit clip'} size="sm" variant="secondary" onPress={() => setEditorOpen(true)} />
            <Button title="Remove" size="sm" variant="ghost" onPress={() => { setClip(null); setClipEdit(null); }} />
          </View>
        ) : null}

        {!photo && !clip ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Add a photo" size="md" variant="secondary" icon="image-outline" loading={picking} onPress={pick} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Add a clip" size="md" variant="secondary" icon="videocam-outline" loading={picking} onPress={pickClip} />
            </View>
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Who can see this
          </Txt>
          <ChipGroup>
            <Chip label="Connections" selected={audience === 'connections'} onPress={() => setAudience('connections')} />
            <Chip label="Everyone" selected={audience === 'everyone'} onPress={() => setAudience('everyone')} />
            {circles?.items.length ? (
              <Chip label="A Circle" selected={audience === 'circle'} onPress={() => setAudience('circle')} />
            ) : null}
          </ChipGroup>
          {audience === 'circle' ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              <Txt variant="small" color="textSecondary">
                Which Circle?
              </Txt>
              <ChipGroup>
                {(circles?.items ?? []).map((c) => (
                  <Chip key={c.id} label={c.name} size="sm" selected={circleId === c.id} onPress={() => setCircleId(c.id)} />
                ))}
              </ChipGroup>
            </View>
          ) : null}
          <Txt variant="small" color="textMuted">
            {audience === 'circle'
              ? 'Only the people in that Circle — up to twelve of them. It stays out of your Flows.'
              : audience === 'everyone'
                ? 'Any signed-in member can read this — including people you haven’t met. Nobody outside Crushly can.'
                : 'Only the people you’ve Clicked with, and anyone you Click with later.'}
          </Txt>
        </View>

        <Button
          title="Share post"
          variant="primary"
          size="md"
          onPress={submit}
          loading={create.isPending}
          disabled={(!body.trim() && !photo) || (audience === 'circle' && !circleId)}
        />
      </View>
      </BottomSheet>
    </>
  );
}
