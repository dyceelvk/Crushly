import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../Txt';
import { LinkText } from '../LinkText';
import { KeepsYouChip } from '../KeepsYouChip';
import { Avatar, Photo } from '../Photo';
import { VerifiedBadge } from '../Badges';
import { IconButton } from '../IconButton';
import { ShareToWhisper } from '../ShareToWhisper';
import { EditedClip } from '../EditedClip';
import { useToast } from '../Toast';
import { CommentsSheet } from './CommentsSheet';
import { useDeletePost, useMe, useOpenConversation, useReactToPost, useSavePost } from '../../api/hooks';
import type { Post } from '../../api/types';
import { useMemberActions } from '../../state/memberActions';
import { useTheme } from '../../theme/ThemeProvider';
import { HIT, elevation, radius, space, stroke } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { formatCount, spokenCount } from '../../lib/counts';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * One post, as a card in a list.
 *
 * Flow is a full screen per post; every other place posts appear — a Space, a
 * Circle, Discover, what you kept — lists them as cards. This is that card, and
 * it exists once so those four lists cannot drift apart: the same author row,
 * the same audience pill, the same three things you can do with it.
 */

export function PostCard({
  post: p,
  active = true,
  secondPerson = true,
  expanded = false,
  onOpen,
}: {
  post: Post;
  active?: boolean;
  /** True on your own feed, where "You" is right. False in a list of everyone's. */
  secondPerson?: boolean;
  /** Opened in place, rather than pushed into a screen of its own. */
  expanded?: boolean;
  /**
   * Where tapping the post goes. The feed pushes a viewer; a Circle opens the
   * post where it already sits, because the room you are standing in is the
   * context — leaving it to read one line of it was the wrong trade.
   */
  onOpen?: () => void;
}) {
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

  // On your own feed a post is "You"; in a list of other people's posts the same
  // word is a lie about who wrote it, so the caller says which it is.
  const authorName = p.mine && secondPerson ? 'You' : p.author.name;

  const [commentsOpen, setCommentsOpen] = useState(false);
  const like = useReactToPost();
  const pick = useSavePost();

  // A post leaves the feed two ways now: into a Whisper, or out of the app.
  const [shareOpen, setShareOpen] = useState(false);

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
              <VerifiedBadge size={14} tier={p.author.badgeTier ?? (p.author.verified ? 'verified' : 'none')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt variant="caption" color="textMuted" numberOfLines={1}>
                {[p.author.username ? `@${p.author.username}` : null, timeAgo(p.createdAt)].filter(Boolean).join(' · ')}
              </Txt>
              {p.author.keepsYou ? <KeepsYouChip /> : null}
            </View>
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
        onPress={onOpen ?? (() => navigation.navigate('PostViewer', { postId: p.id }))}
        accessibilityRole="button"
        accessibilityLabel={`Open ${authorName}’s post`}
        style={{ marginTop: space.sm }}
      >
        {p.body ? (
          <Txt variant="body" style={{ paddingHorizontal: space.sm, paddingTop: space.sm }} selectable>
            <LinkText text={p.body} bare />
          </Txt>
        ) : null}

        {p.mediaUrl ? (
          <View style={{ marginTop: space.sm }}>
            {p.mediaKind === 'video' ? (
              /* The frame used to be `mediaRatio ?? 0.8` — a photo's default,
                 reused for video. Every clip was therefore drawn in a 4:5 box:
                 landscape ones letterboxed into a band, portrait ones cropped.
                 `EditedClip` measures the source now and shapes its own box;
                 `maxHeight` still stops a tall clip owning the screen. */
              <EditedClip
                uri={p.mediaUrl}
                live={p.edit}
                autoPlay={active}
                holdToPause
                loop={active}
                // In the corner, not over the picture: this clip sits inside the
                // card's own "open the post" pressable, and a full-surface
                // control here swallowed every tap meant for the post view.
                controls="corner"
                fallbackRatio={0.8}
                maxHeight={520}
                accessibilityLabel={`Video by ${authorName}`}
              />
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
          onPress={() => (onOpen ? onOpen() : setCommentsOpen(true))}
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
        {/* Pick keeps the post in public: it lands in the picker's collection and
            on their Space, where anyone who can see the Space can read it. It is
            not a follow, a connection or a favourite — it is a post kept. */}
        <PostAction
          icon={p.saved ? 'download' : 'download-outline'}
          label={p.saved ? 'Remove this Pick' : 'Pick this post'}
          active={p.saved}
          activeColor={colors.gold}
          onPress={() => pick.mutate({ postId: p.id, saved: !p.saved })}
        />
        <PostAction icon="share-social-outline" label="Share this post" onPress={() => setShareOpen(true)} />
      </View>

      <ShareToWhisper visible={shareOpen} post={p} onClose={() => setShareOpen(false)} />

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

      {/* One comment sheet for the whole app. A Circle used to open the post in
          place with its own comment body underneath, which meant the same
          conversation looked different depending on which list you found it in. */}
      <CommentsSheet
        post={p}
        visible={commentsOpen || expanded}
        onClose={() => {
          setCommentsOpen(false);
          if (expanded) onOpen?.();
        }}
        onOpenAuthor={(id) => {
          setCommentsOpen(false);
          navigation.navigate('UserProfile', { id });
        }}
      />
    </View>
  );
}

/** One of the three things you can do with a post, shown under it. */
function PostAction({
  icon, count, label, noun, active, activeColor, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
  label: string;
  /** What the count counts, so a screen reader hears "42 comments", not "42". */
  noun?: string;
  active?: boolean;
  /** A Crush and a Pick are different states; they must not share a colour. */
  activeColor?: string;
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
      <Ionicons name={icon} size={19} color={active ? (activeColor ?? colors.crush) : colors.textSecondary} />
      {count === undefined || count === 0 ? null : (
        <Txt variant="numeric" color={active ? 'crush' : 'textSecondary'}>
          {formatCount(count)}
        </Txt>
      )}
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
