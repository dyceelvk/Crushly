import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { useVibes, useViewVibe } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { Vibe } from '../../api/types';
import type { ScreenProps } from '../../navigation/types';

function daysLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'gone';
  const d = Math.ceil(ms / 86_400_000);
  return d <= 1 ? 'gone tomorrow' : `${d} days left`;
}

/**
 * The Vibe feed — full screen, one clip per page.
 *
 * How this mirrors the thing it is modelled on, and why each part is here:
 *
 * 1. POSITION, NOT A SWIPE HANDLER.
 *    The list is a paged FlatList: `pagingEnabled` makes the platform snap each
 *    page to the viewport, `decelerationRate="fast"` stops the long coast that
 *    a normal scroll has, and `snapToInterval` equals the page height exactly so
 *    a page can never be left half-scrolled. No threshold maths, no gesture
 *    recognition — a fling of any strength lands on exactly one clip.
 *
 * 2. ONE PLAYER PER PAGE, PAUSED BY DEFAULT.
 *    Every mounted page owns its clip, but only the page the viewer is actually
 *    looking at plays. `paused` on EditedClip's sibling player is what makes
 *    that possible without tearing the component down, so scrolling back up
 *    resumes instantly instead of re-buffering.
 *
 * 3. WHO DECIDES "VISIBLE".
 *    `onViewableItemsChanged` with `itemVisiblePercentThreshold: 60` — a page
 *    has to be more than half on screen to count. On Android the callback is
 *    only called when the visible set changes, so it is stable across a pause;
 *    the refs below keep it from being recreated between renders, which would
 *    make RN throw ("changing onViewableItemsChanged on the fly is not
 *    supported").
 *
 * 4. NOTHING PLAYS BEHIND THE MODAL.
 *    A Modal on iOS does not unmount the screen underneath it, so a feed left
 *    playing would keep its audio running under the next screen. Unmounting
 *    every player is the fix, and it costs one re-buffer.
 *
 * What is deliberately NOT here: `react-native-reanimated`. Snap-scroll and
 * play-on-visible are both native behaviours already; pulling in an animation
 * runtime to move a scroll offset that the platform is already moving would be
 * a dependency for its own sake. The animated parts (double-tap heart, parallax)
 * are a separate change and can be built on RN's Animated when they are wanted.
 */
export function VibeViewerScreen({ route, navigation }: ScreenProps<'VibeViewer'>) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const vibes = useVibes();
  const view = useViewVibe();

  const items = useMemo(() => vibes.data ?? [], [vibes.data]);

  // Open on the clip that was tapped, not on the first one in the feed.
  const [index, setIndex] = useState(() => {
    const at = items.findIndex((v) => v.id === id);
    return at >= 0 ? at : 0;
  });

  // One clip per viewport. The header and the author block float above the
  // list rather than taking height from it, so a page is exactly the screen —
  // if they had their own layout height, snapToInterval would have to add it
  // back and would drift by a pixel or two on every page.
  const pageHeight = height;
  const listRef = useRef<FlatList<Vibe>>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || items.length === 0) return;
    const at = items.findIndex((v) => v.id === id);
    if (at > 0) {
      // The data usually arrives after the first render, so the initial scroll
      // has to wait for it — hence this rather than initialScrollIndex.
      requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: at, animated: false }));
    }
    started.current = true;
  }, [items, id]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setIndex(first.index);
    },
    [],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Count a watch once per clip, and never for your own.
  const counted = useRef(new Set<number>());
  useEffect(() => {
    const current = items[index];
    if (!current || current.mine || counted.current.has(current.id)) return;
    counted.current.add(current.id);
    view.mutate(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items]);

  return (
    <Modal visible animationType="fade" onRequestClose={() => navigation.goBack()}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* One player survives: the visible page. Everything else is quiet. */}
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(v) => String(v.id)}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={pageHeight}
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: pageHeight, offset: pageHeight * i, index: i })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          renderItem={({ item, index: i }) => (
            <VibePage
              vibe={item}
              active={i === index}
              pageHeight={pageHeight}
              maxWidth={contentWidth}
              insets={insets}
            />
          )}
          ListEmptyComponent={
            vibes.isLoading ? (
              <View style={{ height: pageHeight, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color={colors.gold} />
              </View>
            ) : (
              <View style={{ height: pageHeight, alignItems: 'center', justifyContent: 'center' }}>
                <EmptyState
                  icon="play-circle-outline"
                  title="No Vibes yet"
                  message="Vibes last two weeks. Ask someone to share one."
                  action={{ label: 'Close', onPress: () => navigation.goBack() }}
                />
              </View>
            )
          }
        />

        {/* Chrome sits above the list and never scrolls with it. */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.md,
            paddingBottom: space.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
            <View style={{ flex: 1 }} />
            {items.length > 1 ? (
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: 'rgba(0,0,0,0.45)',
                }}
              >
                <Txt variant="caption" style={{ color: '#fff' }}>
                  {index + 1} / {items.length}
                </Txt>
              </View>
            ) : null}
          </View>
        </View>

        {/* The first-run hint: swipe up. Gone as soon as they do. */}
        {items.length > 1 && index === 0 ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', bottom: insets.bottom + 96, left: 0, right: 0, alignItems: 'center' }}
          >
            <Ionicons name="chevron-up" size={22} color="rgba(255,255,255,0.75)" />
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Swipe up for the next
            </Txt>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** One page: the clip, its author, and its words. */
function VibePage({
  vibe,
  active,
  pageHeight,
  maxWidth,
  insets,
}: {
  vibe: Vibe;
  active: boolean;
  pageHeight: number;
  maxWidth: number;
  insets: { top: number; bottom: number };
}) {
  const source = useMemo(() => mediaSource(mediaUrl(vibe.mediaUrl)), [vibe.mediaUrl]);
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);

  return (
    <View style={{ height: pageHeight, width: '100%', backgroundColor: '#000' }}>
      <View style={{ flex: 1, width: '100%', maxWidth, alignSelf: 'center', justifyContent: 'center' }}>
        {failed ? (
          // A codec the device will not take should not be a black page with no
          // explanation — that looks like the app is broken rather than the file.
          <View style={{ alignItems: 'center', gap: 8, padding: space.xl }}>
            <Ionicons name="videocam-off-outline" size={28} color={colors.textMuted} />
            <Txt variant="small" color="textMuted" align="center">
              This clip can’t play on this device.
            </Txt>
          </View>
        ) : (
          <VibeClip source={source} active={active} onError={() => setFailed(true)} />
        )}
      </View>

      {/* Author + words, over the bottom of the clip. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.lg,
          gap: space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Avatar
            uri={vibe.author.photo}
            name={vibe.author.name}
            size={30}
            ring={vibe.author.mutual ? 'crush' : undefined}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt variant="bodyStrong" style={{ color: '#fff' }} numberOfLines={1}>
                {vibe.mine ? 'Your Vibe' : vibe.author.name}
              </Txt>
              {vibe.author.verified ? <VerifiedBadge size={12} /> : null}
            </View>
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>
              {timeAgo(vibe.createdAt)} · {daysLeft(vibe.expiresAt)}
            </Txt>
          </View>
        </View>

        {vibe.body ? (
          <View
            style={{
              borderRadius: radius.lg,
              backgroundColor: 'rgba(255,255,255,0.10)',
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Txt variant="body" style={{ color: '#fff' }}>
              <LinkText text={vibe.body} bare />
            </Txt>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The clip itself.
 *
 * `VibeViewer` used to call `useVideoPlayer(...)` once, at screen level, so the
 * player existed before the data did and only ever pointed at one clip. Here
 * the player belongs to the page, which is what lets each one keep its own
 * position and pause independently.
 */
function VibeClip({
  source,
  active,
  onError,
}: {
  source: ReturnType<typeof mediaSource>;
  active: boolean;
  onError: () => void;
}) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = false;
  });

  // The viewer stopped this one on purpose. Scrolling away and back is a new
  // visit, so the flag is cleared when the page stops being the active one —
  // otherwise a clip paused three pages ago would still refuse to play.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) setHeld(false);
  }, [active]);

  useEffect(() => {
    if (!player) return;
    if (active && !held) player.play();
    else player.pause();
  }, [player, active, held]);

  // Audio must not survive the page or the screen.
  useEffect(() => () => player?.pause(), [player]);

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player?.playing ?? false });
  const button = (
    <View
      pointerEvents="none"
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.42)',
      }}
    >
      <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#fff" style={{ marginLeft: isPlaying ? 0 : 4 }} />
    </View>
  );

  return (
    <View style={{ width: '100%', height: '100%' }}>
      <VideoView
        player={player}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        nativeControls={false}
        accessibilityLabel="Vibe clip"
        onFirstFrameRender={() => undefined}
      />
      {/*
        Always drawn here, unlike the Flow, because a full-screen feed has no
        other way out of a clip. Tapping the picture is the gesture people
        already try; there is no chrome competing for it.
      */}
      <Pressable
        onPress={() => setHeld((h) => !h)}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause clip' : 'Play clip'}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isPlaying ? null : button}
      </Pressable>
    </View>
  );
}
