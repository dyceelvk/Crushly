import React, { useCallback, useRef, useState } from 'react';
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
import { HIT, elevation, fonts, radius, rhythm, space, stroke } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { formatCount, spokenCount } from '../../lib/counts';
import { activeIdAt, visibleIndices, type CardBox } from '../../lib/viewability';
import { feedRange, feedWindow } from '../../lib/feedWindow';
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

  // Which card is in front of the reader. Only that one is allowed to play;
  // everything else is a still frame. The arithmetic lives in lib/viewability.
  const boxes = useRef<Map<number, CardBox>>(new Map());
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [activeId, setActiveId] = useState<number | null>(null);

  const measureCard = useCallback((id: number, y: number, height: number) => {
    boxes.current.set(id, { id, y, height });
  }, []);

  const recompute = useCallback((nextY: number, nextH: number) => {
    const flat = [...boxes.current.values()].sort((a, b) => a.y - b.y);
    setActiveId(activeIdAt(flat, nextY, nextH));
  }, []);

  // Which cards stay alive.
  //
  // Not "the card the reader is on, plus one" — that window is centred on a
  // single row, and on a tall screen three or four rows are on it at once, so the
  // ones above the focus line got unmounted and replaced by a spacer of their own
  // height. That is a blank hole in the middle of the feed, which is exactly what
  // the first render of this screen showed. The window now covers every row that
  // is actually on screen, plus one either side for runway.
  const measuredBoxes = flow.posts
    .map((p) => boxes.current.get(p.id))
    .filter((b): b is CardBox => !!b && b.height > 0);
  const onScreen = visibleIndices(measuredBoxes, scrollY, viewportH || 0);
  const alive = onScreen.length
    ? feedRange(flow.posts.length, onScreen[0], onScreen[onScreen.length - 1])
    : feedWindow(flow.posts.length, 0);

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
        scrollEventThrottle={16}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          setViewportH(h);
          recompute(scrollY, h);
        }}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          setScrollY(y);
          recompute(y, viewportH);
        }}
      >
        {/* Masthead. The subtitle used to wrap under the two circular buttons,
            which left it ragging across three lines around a pair of discs;
            it is one short line now, and the buttons sit beside the title
            rather than beside the paragraph. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <Txt variant="title" accessibilityRole="header" style={{ flexShrink: 1 }}>
            Flows
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <IconButton icon="search-outline" label="Search" variant="gold" size={38} iconSize={18} onPress={() => navigation.navigate('Search')} />
            <IconButton icon="chatbubble-ellipses-outline" label="Your Circles" variant="gold" size={38} iconSize={18} onPress={() => navigation.navigate('Circles')} />
          </View>
        </View>
        <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
          What people are sharing. Posts stay until they’re removed.
        </Txt>

        {/* Home opens on the rooms you belong to, not on a list of strangers. */}
        <View style={{ marginTop: space.lg }}>
          <CircleStrip />
        </View>

        <Pressable
          onPress={() => setComposer(true)}
          accessibilityRole="button"
          accessibilityLabel="Share a post"
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: rhythm.section,
            backgroundColor: colors.card, borderRadius: radius.md, borderWidth: stroke.hairline, borderColor: colors.border,
            paddingHorizontal: space.sm, paddingVertical: space.sm,
            ...elevation.soft,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Avatar uri={me?.profile.photos[0]?.url ?? null} name={me?.profile.name || 'You'} size={36} />
          <Txt variant="body" color="textMuted" style={{ flex: 1 }}>
            Share something…
          </Txt>
          <View
            style={{
              width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.primarySoft,
            }}
          >
            <Ionicons name="create-outline" size={17} color={colors.primary} />
          </View>
        </Pressable>

        {/* Discover is not a tab: it is one door, here, that opens into a
            single screen holding People, Moments and Vibes as sections. */}
        {/* Discover is a door, so it is built like one: a title with its own
            line underneath, not a title and a description fighting for the same
            row. The old version ran a bright cyan border all the way round it,
            which made a secondary route the loudest outline on the screen —
            louder than the post the member came to read. */}
        <Pressable
          onPress={() => navigation.navigate('Discover')}
          accessibilityRole="button"
          accessibilityLabel="Discover. Vibes, Moments and public posts"
          style={({ pressed }) => ({
            marginTop: space.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: colors.card,
            borderRadius: radius.md,
            borderWidth: stroke.hairline,
            borderColor: colors.border,
            paddingHorizontal: space.sm,
            paddingVertical: space.sm,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.primarySoft,
            }}
          >
            <Ionicons name="compass-outline" size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">Discover</Txt>
            <Txt variant="small" color="textSecondary" numberOfLines={1}>
              Vibes, Moments and public posts
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <View style={{ marginTop: rhythm.section, gap: space.sm }}>
          {flow.isLoading ? (
            <Skeleton style={{ height: 120 }} />
          ) : flow.isError ? (
            <ErrorState message={flow.error instanceof Error ? flow.error.message : 'Your Flows didn’t load.'} onRetry={flow.refresh} />
          ) : flow.posts.length ? (
            <>
              {flow.posts.map((p, index) => {
                // Keep a short window around the card you are reading and let
                // the rest go cold. A row that is out of the window keeps the
                // height it measured, so the scroll position does not move —
                // it just stops paying for a card nobody is looking at.
                //
                // A row that has never been measured is always mounted: it has
                // to render once to report its height, and its height is what
                // the window needs before it can be trusted.
                const measured = boxes.current.get(p.id)?.height;
                const mounted =
                  measured === undefined ||
                  (index >= alive.start && index <= alive.end);

                return (
                  <View
                    key={p.id}
                    // A mounted row sizes itself. A cold row is a spacer of
                    // exactly the height it had, so nothing shifts.
                    style={mounted ? undefined : { height: measured, overflow: 'hidden' }}
                    onLayout={(e) =>
                      measureCard(
                        p.id,
                        e.nativeEvent.layout.y,
                        e.nativeEvent.layout.height,
                      )
                    }
                  >
                    {mounted ? (
                      <PostCard post={p} active={activeId === null || activeId === p.id} />
                    ) : null}
                  </View>
                );
              })}
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
export function PostCard({ post: p, active = true }: { post: Post; active?: boolean }) {
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

  // The file's real shape, once it reports one. Starts at 4:5 — the commonest
  // portrait photo — so the space is held open and the feed does not jump when
  // the image lands.
  const [mediaRatio, setMediaRatio] = useState<number | null>(null);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: stroke.hairline,
        borderColor: colors.border,
        overflow: 'hidden',
        ...elevation.soft,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm }}>
        <Pressable
          onPress={() => (p.mine ? navigation.navigate('Main', { screen: 'Profile' }) : navigation.navigate('UserProfile', { id: p.author.id }))}
          accessibilityRole="button"
          accessibilityLabel={`Open ${authorName}’s Space`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
        >
          <Avatar uri={p.author.photos[0]?.url ?? null} name={p.author.name} size={38} ring={p.author.verified ? 'gold' : undefined} />
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {authorName}
              </Txt>
              {p.author.verified ? <VerifiedBadge size={14} /> : null}
            </View>
            <Txt variant="caption" color="textMuted" numberOfLines={1}>
              {[p.author.username ? `@${p.author.username}` : null, timeAgo(p.createdAt)].filter(Boolean).join(' · ')}
            </Txt>
          </View>
        </Pressable>
        <Pill label={p.audience === 'everyone' ? 'Everyone' : 'Connections'} tone={p.audience === 'everyone' ? 'open' : 'quiet'} />
        {p.mine ? (
          <IconButton
            icon="trash-outline"
            label="Delete post"
            variant="plain"
            size={36}
            onPress={() => remove.mutate(p.id, { onError: (e) => toast({ kind: 'error', title: 'Not deleted', message: (e as Error).message }) })}
            color={colors.textMuted}
          />
        ) : (
          <IconButton
            icon="ellipsis-horizontal"
            label={`More options for ${authorName}`}
            variant="plain"
            size={36}
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
          <Txt variant="body" style={{ paddingHorizontal: space.sm, paddingTop: space.sm, fontSize: 16, lineHeight: 23 }} selectable>
            <LinkText text={p.body} bare />
          </Txt>
        ) : null}

        {p.mediaUrl ? (
          <View style={{ marginTop: space.sm }}>
            {p.mediaKind === 'video' ? (
              <EditedClip uri={p.mediaUrl} live={p.edit} autoPlay={active} loop={active} style={{ width: '100%', aspectRatio: mediaRatio ?? 0.8, maxHeight: 520 }} />
            ) : (
              /* `contain` inside an unsized box is what made every photo in the
                 feed invisible: the image had a width, no height, and nothing
                 to size it against. It now reserves 4:5, adopts the file's real
                 shape when it reports one, and crops only if it has to. */
              <Photo
                uri={p.mediaUrl}
                fit="cover"
                contentPosition="center"
                aspectRatio={mediaRatio ?? 0.8}
                maxHeight={520}
                onAspect={setMediaRatio}
                style={{ width: '100%' }}
                alt={`Post by ${authorName}`}
              />
            )}
          </View>
        ) : null}
      </Pressable>

      {/* One rail, three verbs, evenly spaced, with the share at the far end
          where the thumb is not. Heights match the comment sheet's handle so
          the card does not change height when the sheet opens. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingVertical: 2 }}>
        <PostAction
          icon="chatbubble-outline"
          count={p.commentCount}
          label="Comments"
          noun="comments"
          onPress={() => setCommentsOpen(true)}
        />
        <PostAction
          icon={p.liked ? 'heart' : 'heart-outline'}
          count={p.likeCount}
          label={p.liked ? 'Take back your like' : 'Like'}
          noun="likes"
          active={p.liked}
          onPress={() => like.mutate({ postId: p.id, liked: !p.liked })}
        />
        <View style={{ flex: 1 }} />
        <PostAction icon="share-social-outline" label="Share this post" onPress={share} />
      </View>

      {!p.mine && p.author.crush?.mutual ? (
        <Pressable
          onPress={whisper}
          accessibilityRole="button"
          accessibilityLabel={`Whisper ${authorName}`}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: space.xs,
            marginHorizontal: space.sm, marginBottom: space.sm,
            paddingHorizontal: space.sm, paddingVertical: 10,
            borderRadius: radius.sm, backgroundColor: colors.primarySoft,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="chatbubble-ellipses" size={15} color={colors.primary} />
          <Txt variant="smallStrong" color="primary">
            Whisper
          </Txt>
          <Txt variant="small" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            · only the two of you
          </Txt>
        </Pressable>
      ) : null}

      <PostComments postId={p.id} visible={commentsOpen} onClose={() => setCommentsOpen(false)} />
    </View>
  );
}

/** One of the three things you can do with a post, shown under it. */
function PostAction({
  icon, count, label, noun, active, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
  label: string;
  /** What the count counts, so a screen reader hears "42 comments", not "42". */
  noun?: string;
  active?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const spoken = count !== undefined && noun ? spokenCount(count, noun.replace(/s$/, ''), noun) : '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken ? `${label}, ${spoken}` : label}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6,
        minHeight: HIT, paddingHorizontal: space.sm, borderRadius: radius.sm,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color={active ? colors.crush : colors.textSecondary} />
      {count === undefined || count === 0 ? null : (
        <Txt variant="numeric" color={active ? 'crush' : 'textSecondary'}>
          {formatCount(count)}
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

/**
 * Who can see this. Two states that used to look identical — a grey pill in both
 * cases — so the one decision that matters on a post was invisible at a glance.
 * "Everyone" is open and says so in the accent colour; "Connections" stays quiet,
 * because it is the default and should not shout.
 */
function Pill({ label, tone = 'quiet' }: { label: string; tone?: 'quiet' | 'open' }) {
  const { colors } = useTheme();
  const open = tone === 'open';
  return (
    <View
      style={{
        borderRadius: radius.pill,
        paddingHorizontal: space.xs,
        paddingVertical: 3,
        backgroundColor: open ? colors.primarySoft : colors.elevated,
        borderWidth: stroke.hairline,
        borderColor: open ? colors.primaryLine : colors.border,
      }}
    >
      <Txt variant="caption" color={open ? 'primary' : 'textSecondary'}>
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
