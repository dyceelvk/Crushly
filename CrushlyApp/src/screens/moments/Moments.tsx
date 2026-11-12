import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { IconButton } from '../../components/IconButton';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { Photo, Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useMoments } from '../../api/hooks';
import type { Moment, MomentGroup } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { MOMENT_STYLES } from '../../lib/catalog';
import { momentRingState } from '../../lib/momentRings';
import { EditedClip } from '../../components/EditedClip';
import { ClipThumb } from '../../components/ClipThumb';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList } from '../../navigation/types';

/** Preview of a Moment: the photo, or the styled text on its gradient. */
export function MomentPreview({
  moment, style, textSize = 15, lines = 6, autoPlay = false, keepPlayerMounted = false, caption = true, showText = true, tappable = true, showAuthor = false, onReveal,
}: {
  moment?: Moment;
  style?: object;
  textSize?: number;
  lines?: number;
  autoPlay?: boolean;
  keepPlayerMounted?: boolean;
  caption?: boolean;
  showText?: boolean;
  tappable?: boolean;
  /**
   * Whether the card may name the person who made a shared post, and let you
   * open their Space from here.
   *
   * Off everywhere outside the Moment itself. A shared post in a grid is a
   * Moment like any other: you should meet it, not be handed its author before
   * you have even opened it. The handle is inside, where there is room to show
   * who made the thing you are looking at.
   */
  showAuthor?: boolean;
  onReveal?: (open: boolean) => void;
}) {
  if (!moment) return <View style={[{ backgroundColor: '#17171A' }, style]} />;
  /*
   * A Moment that is a shared post: the preview card.
   *
   * Nine seconds of the post, at 9:16, with the author's handle underneath — and
   * the card is the thing you tap to open the post. A written post has no clip,
   * so its card is the words in the post's own type on the Moment's own colour,
   * which is what a preview of words looks like.
   */
  if (moment.kind === 'post') {
    return (
      <MomentPostCard
        moment={moment}
        style={style}
        textSize={textSize}
        lines={lines}
        tappable={tappable}
        showAuthor={showAuthor}
        onReveal={onReveal}
      />
    );
  }
  if (moment.kind === 'video') {
    /*
     * A tile does not play, but it is not a placeholder either.
     *
     * This used to draw a camera outline on a dark gradient whenever the Moment
     * was a clip — so a row of Moments on Discover was a row of camera icons,
     * and the only way to find out what somebody had actually posted was to open
     * every card. The card is meant to be a preview of the thing, so it now
     * paints the clip's own first frame (`ClipThumb`, the same still the grids
     * use) and keeps the words underneath it. Nothing plays: a player per tile
     * is a decoder per tile, and a tile is a picture of a clip.
     */
    if (!autoPlay && !keepPlayerMounted) {
      return (
        <View style={[{ overflow: 'hidden', backgroundColor: '#101014' }, style]}>
          {moment.mediaUrl ? (
            <ClipThumb uri={mediaUrl(moment.mediaUrl) ?? ''} style={StyleSheet.absoluteFill} />
          ) : null}
          {caption && moment.body ? (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <Txt variant="accent" color="#fff" numberOfLines={lines} style={{ fontSize: textSize, lineHeight: textSize * 1.35 }}>
                <LinkText text={moment.body} bare />
              </Txt>
            </View>
          ) : null}
        </View>
      );
    }
    return (
      <View style={[{ overflow: 'hidden', backgroundColor: '#000' }, style]}>
        <EditedClip
          uri={mediaSource(mediaUrl(moment.mediaUrl))}
          live={moment.edit}
          style={{ width: '100%', height: '100%' }}
          autoPlay={autoPlay}
          loop
        />
        {caption && moment.body ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <Txt variant="body" numberOfLines={lines} style={{ fontSize: textSize, color: '#FFF', lineHeight: textSize * 1.35 }}>
              <LinkText text={moment.body} bare />
            </Txt>
          </View>
        ) : null}
      </View>
    );
  }
  if (moment.kind === 'photo') {
    return (
      <View style={[{ overflow: 'hidden' }, style]}>
        <Photo uri={moment.mediaUrl} style={{ width: '100%', height: '100%' }} />
        {caption && moment.body ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <Txt variant="body" numberOfLines={lines} style={{ fontSize: textSize, color: '#FFF', lineHeight: textSize * 1.35 }}>
              <LinkText text={moment.body} bare />
            </Txt>
          </View>
        ) : null}
      </View>
    );
  }
  const s = MOMENT_STYLES[moment.style] || MOMENT_STYLES.noir;
  return (
    <LinearGradient colors={s.colors} style={[{ padding: 14, justifyContent: 'center' }, style]}>
      {showText ? <Txt variant="accent" color={s.ink} numberOfLines={lines} style={{ fontSize: textSize, lineHeight: textSize * 1.35 }}><LinkText text={moment.body} bare /></Txt> : null}
    </LinearGradient>
  );
}


/**
 * The preview card for a Moment that is a shared post.
 *
 * Portrait, not 9:16. A 9:16 card is the shape of the screen it is drawn on, so
 * on the Moment screen it was the whole screen and the name, the time, the
 * reactions and the reply box had nowhere to sit. A portrait card — four by
 * five, inside a box smaller than the screen — leaves that information where it
 * belongs: around the preview, not under it.
 *
 * A tap on the card does **not** open the post. Opening somebody's post is a
 * bigger step than tapping a preview, so the first tap only offers it: a
 * coloured line of text floats over the clip, "View this post", and that line is
 * the button. No screen changes, nothing slides in — the words appear on the
 * picture and go again if you do not take them. A tap on the handle still opens
 * the person who made the post, which is not the person who shared it.
 *
 * The clip is muted here. A preview that starts making noise while somebody is
 * scrolling a row of them is the opposite of a preview.
 */
function MomentPostCard({
  moment,
  style,
  textSize = 15,
  lines = 6,
  tappable = true,
  showAuthor = false,
  onReveal,
}: {
  moment: Moment;
  style?: object;
  textSize?: number;
  lines?: number;
  /** Off in a tile: the tile has its own tap (open the Moment). */
  tappable?: boolean;
  /** Off outside the Moment: the card is the thing, not a way to somebody else. */
  showAuthor?: boolean;
  /** Told when the "View this post" line appears, so a timeline can hold still. */
  onReveal?: (open: boolean) => void;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const post = moment.post;
  const [offered, setOffered] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const offer = useCallback((next: boolean) => {
    if (hide.current) clearTimeout(hide.current);
    setOffered(next);
    onReveal?.(next);
    // Long enough to read and reach for, short enough that it is not left on the
    // picture like a caption.
    if (next) {
      hide.current = setTimeout(() => {
        setOffered(false);
        onReveal?.(false);
      }, 5000);
    }
  }, [onReveal]);

  useEffect(() => () => { if (hide.current) clearTimeout(hide.current); }, []);

  if (!post) {
    // The post is no longer visible to this viewer. The Moment is still theirs,
    // so it is drawn as an empty card rather than vanishing from the row.
    return (
      <View style={[{ backgroundColor: '#141418', alignItems: 'center', justifyContent: 'center', padding: 10 }, style]}>
        <Txt variant="caption" color="#8A8A93" style={{ textAlign: 'center' }}>This post is no longer available.</Txt>
      </View>
    );
  }
  const s = MOMENT_STYLES[moment.style] || MOMENT_STYLES.noir;
  const open = () => navigation.navigate(post.mediaUrl ? 'PostViewer' : 'TextPost', { postId: post.id });
  const Card: typeof Pressable = tappable ? Pressable : View as unknown as typeof Pressable;

  return (
    /*
     * The card has to claim its box, not shrink to its contents.
     *
     * A caller that positions this with `alignItems: 'center'` — the Discover
     * row does — gives a child with no width of its own `width: auto`, so the
     * card collapsed to zero and the tile was an empty gold ring with a black
     * hole in it. That was the blank Moment on Discover, on a post that had a
     * perfectly good clip behind it. A card fills the box it was handed.
     */
    <View style={[{ width: '100%', height: '100%', alignItems: 'stretch' }, style]}>
      {/*
        The box is whatever this card was given; the shape is the caller's
        decision (a portrait box on the Moment screen, the tile's own ratio in a
        row). Nothing here forces 9:16 any more.
      */}
      <View style={{ flex: 1, overflow: 'hidden', borderRadius: 16, backgroundColor: '#000' }}>
        <Card
          {...(tappable
            ? {
                onPress: () => offer(!offered),
                accessibilityRole: 'button' as const,
                accessibilityLabel: `Preview of ${post.authorName}’s post`,
                accessibilityHint: 'Shows a link to view the post',
              }
            : {})}
          style={{ flex: 1 }}
        >
          {post.mediaKind === 'video' && post.mediaUrl ? (
            /*
             * In a row or a grid this is a **picture** of the clip; inside the
             * Moment it plays.
             *
             * A tile used to mount a playing player. One of them, on a slow
             * connection or a device whose decoder is busy, painted nothing at
             * all: the card was a black rectangle with a gold ring round it — a
             * preview of nothing, which is what the owner saw on Discover. A
             * paused first frame is what every other grid in the app shows
             * (`ClipThumb`), and it is always there.
             */
            tappable ? (
              <EditedClip
                uri={mediaSource(mediaUrl(post.mediaUrl))}
                live={null}
                style={{ width: '100%', height: '100%' }}
                autoPlay
                loop
                muted
                /* Nine seconds, then it starts again: a preview, not a showing. */
                maxMs={post.previewMs}
              />
            ) : (
              <ClipThumb uri={mediaUrl(post.mediaUrl) ?? ''} style={{ width: '100%', height: '100%' }} />
            )
          ) : post.mediaUrl ? (
            <Photo uri={post.mediaUrl} style={{ width: '100%', height: '100%' }} />
          ) : (
            <LinearGradient colors={s.colors} style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
              <Txt variant="accent" color={s.ink} numberOfLines={lines} style={{ fontSize: textSize, lineHeight: textSize * 1.35 }}>
                <LinkText text={post.body} bare />
              </Txt>
            </LinearGradient>
          )}
        </Card>

        {/*
          The offer, floating on the picture. It is the only way into the post
          from here, so it sits above the card's own tap rather than inside it.
        */}
        {offered ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' }}>
            <Pressable
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={`View ${post.authorName}’s post`}
              hitSlop={10}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
                backgroundColor: 'rgba(12,12,14,0.72)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
                opacity: pressed ? 0.7 : 1,
                ...(Platform.OS === 'web' ? { boxShadow: '0 6px 18px rgba(0,0,0,0.45)' } : { elevation: 6 }),
              })}
            >
              <Txt variant="bodyStrong" style={{ color: colors.gold }}>View this post</Txt>
              <Ionicons name="arrow-forward" size={14} color={colors.gold} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* The handle, under the card — the person who made the post, not the
          person who shared it — and only once the Moment is open. In a grid this
          line was a name, a profile link and a "view this post" card rolled into
          one, all before anybody had entered the Moment: that is what the owner
          was seeing in the Moments tab. */}
      {showAuthor ? (
      <Pressable
        onPress={() => navigation.navigate('UserProfile', { id: post.authorId })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.authorName}’s Space`}
        hitSlop={6}
        style={({ pressed }) => ({ paddingTop: 6, paddingHorizontal: 2, opacity: pressed ? 0.6 : 1 })}
      >
        <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ fontWeight: '700' }}>
          {post.username ? `@${post.username}` : post.authorName}
        </Txt>
      </Pressable>
      ) : null}
    </View>
  );
}

export function MomentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter, columns } = useLayout();
  const { data, isLoading, isError, error, refetch, isRefetching } = useMoments();

  const cols = columns + 1; // denser than profiles: 3 on phones, 4 on tablets
  const gap = 12;
  const tileW = (contentWidth - gutter * 2 - gap * (cols - 1)) / cols;
  const mine = data?.mine.moments ?? [];
  const connections = (data?.others ?? []).filter((g) => g.user.mutual);
  const nearby = (data?.others ?? []).filter((g) => !g.user.mutual);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.xxxl, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Txt variant="display" accessibilityRole="header">
            Moments
          </Txt>
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            Little glimpses of life. Gone in 24 hours.
          </Txt>
        </View>
      </View>

      {/* Your Moment */}
      <Pressable
        onPress={() =>
          mine.length
            // Opens the newest, which is the one this card draws.
            ? navigation.navigate('MomentViewer', { userId: data!.mine.user.id, mine: true, momentId: mine[mine.length - 1].id })
            : navigation.navigate('MomentComposer')
        }
        accessibilityRole="button"
        accessibilityLabel={mine.length ? `Your Moment, ${mine.length} active. View` : 'Share your Moment'}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, padding: space.md, borderRadius: radius.xl,
          backgroundColor: colors.card, borderWidth: 1, borderColor: mine.length ? colors.goldLine : colors.border, opacity: pressed ? 0.85 : 1,
        })}
      >
        <View style={{ width: 64, height: 84, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
          {mine.length ? <MomentPreview moment={mine[mine.length - 1]} style={{ width: 64, height: 84 }} textSize={9} tappable={false} /> : <Avatar uri={data?.mine.user.photo} name={data?.mine.user.name} size={52} />}
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="subheading">Your Moment</Txt>
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            {mine.length
              ? `${mine.length} active · ${mine.reduce((n, m) => n + (m.viewCount || 0), 0)} views`
              : 'Share what you’re up to. It disappears in 24 hours.'}
          </Txt>
        </View>
        <Pressable
          onPress={() => navigation.navigate('MomentComposer')}
          accessibilityRole="button"
          accessibilityLabel="New Moment"
          hitSlop={8}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="add" size={24} color={colors.onGold} />
        </Pressable>
      </Pressable>

      {isLoading ? (
        <View style={{ flexDirection: 'row', gap, marginTop: space.xl }}>
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} style={{ width: tileW, height: tileW * 1.35, borderRadius: 26 }} />
          ))}
        </View>
      ) : isError ? (
        <ErrorState error={error} message="Moments didn’t load." onRetry={refetch} />
      ) : !connections.length && !nearby.length ? (
        <EmptyState
          icon="aperture-outline"
          title="It’s quiet right now"
          message="No Moments nearby at the moment. Be the first — a Moment is a great way to get noticed."
          action={{ label: 'Share a Moment', onPress: () => navigation.navigate('MomentComposer') }}
        />
      ) : (
        <>
          {connections.length ? <Grid title="From your Connections" groups={connections} tileW={tileW} gap={gap} /> : null}
          {nearby.length ? <Grid title="Around you" groups={nearby} tileW={tileW} gap={gap} /> : null}
        </>
      )}
    </ScrollView>
  );
}

function Grid({ title, groups, tileW, gap }: { title: string; groups: MomentGroup[]; tileW: number; gap: number }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm }} accessibilityRole="header">
        {title}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {groups.map((g) => (
          <MomentTile key={g.user.id} group={g} width={tileW} />
        ))}
      </View>
    </View>
  );
}

/** Soft "pebble" tiles — rounded portrait shapes with a gold edge when there's something new. */
function MomentTile({ group, width }: { group: MomentGroup; width: number }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const latest = group.moments[group.moments.length - 1];
  const h = width * 1.35;
  return (
    <Pressable
      /*
       * The Moment under the finger, not the person's whole day.
       *
       * This used to pass the person and nothing else, so the viewer opened at
       * their first Moment — the oldest one they had up — however recent the
       * tile you tapped was. The tile draws the newest, so the newest is what a
       * tap opens; the older ones are a swipe back, the way a story reads.
       */
      onPress={() => navigation.navigate('MomentViewer', { userId: group.user.id, momentId: latest.id })}
      accessibilityRole="button"
      accessibilityLabel={`${group.user.name}'s Moment${group.moments.length > 1 ? `s, ${group.moments.length}` : ''}, ${timeAgo(latest.createdAt)} ago${group.hasUnseen ? ', new' : ''}`}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width, height: h, borderRadius: width * 0.3, padding: 2.5, borderWidth: 1.5, borderColor: group.hasUnseen ? colors.gold : colors.borderStrong }}>
        <View style={{ flex: 1, borderRadius: width * 0.3 - 3, overflow: 'hidden', backgroundColor: colors.card }}>
          <MomentPreview
            moment={latest}
            tappable={false}
            caption={latest.kind !== 'photo'}
            style={{ width: '100%', height: '100%' }}
            textSize={Math.max(10, width / 10)}
            lines={3}
          />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.65)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' }} />
          {latest.kind === 'video' ? (
            <View style={{ position: 'absolute', bottom: 10, right: 10, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <Ionicons name="play" size={13} color="#fff" />
            </View>
          ) : null}
          {group.moments.length > 1 ? (
            <View style={{ position: 'absolute', top: 10, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Txt variant="caption" color="#fff">
                {group.moments.length}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 6 }}>
        <Avatar
          uri={group.user.photo}
          name={group.user.name}
          size={18}
          ring={group.user.mutual ? 'crush' : null}
          momentRing={momentRingState(group.user.id, true, !group.hasUnseen)}
        />
        <Txt variant="smallStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {group.user.name}
        </Txt>
        <VerifiedBadge size={12} tier={group.user.badgeTier ?? (group.user.verified ? 'verified' : 'none')} />
      </View>
      <Txt variant="caption" color="textMuted" align="center">
        {group.hasUnseen ? timeAgo(latest.createdAt) : `Viewed · ${timeAgo(latest.createdAt)}`}
      </Txt>
    </Pressable>
  );
}
