import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../../components/Txt';
import { Avatar, Photo } from '../../components/Photo';
import { Logo } from '../../components/Logo';
import { ClipThumb } from '../../components/ClipThumb';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { HIT, radius, space } from '../../theme/tokens';
import { useLayout } from '../../components/Layout';
import { timeAgo } from '../../lib/format';
import { hasCategoryLead, leadWithCategories, publicWatchHousePosts, WATCH_CATEGORIES } from '../../lib/watch';
import type { ScreenProps } from '../../navigation/types';

/**
 * The front door for somebody who is not a member yet.
 *
 * The web used to answer an anonymous visitor with a welcome screen and nothing
 * else: a wall of two buttons over a claim about feelings. Whatever the site says
 * about itself, the honest version is the room — so this shows the room first and
 * asks for an account second, which is what every site people actually browse does.
 *
 * Two deliberate decisions:
 *
 *   * The first screen is content, not a pitch. A visitor who never signs up has
 *     still seen what holUpp is.
 *   * Signing up is offered at the moment it would matter — pressing a post, a
 *     like, or the search box's own suggestion — rather than as a barrier before
 *     anything is visible.
 *
 * Everything here reads through the anonymous RPCs (`public_watch_feed`,
 * `public_watch_search`), which serve only posts already public to everyone. A
 * visitor cannot see a private profile, a distance, an online state or a Moment
 * because the server does not send them.
 */

type WatchPost = {
  id: number;
  body: string | null;
  mediaUrl: string | null;
  mediaKind: 'photo' | 'video' | null;
  createdAt: number;
  location?: string | null;
  likeCount?: number;
  commentCount?: number;
  author: { id: number; name: string; username: string | null; verified: boolean; badgeTier: string; photos: { url: string }[] };
};

/** Mirrors the server's cap, so the list asks for a page it will actually get. */
const PAGE = 12;

export function WatchScreen({ navigation }: ScreenProps<'Follow'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();

  const [items, setItems] = useState<WatchPost[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ posts: WatchPost[]; members: WatchPost['author'][] } | null>(null);
  const [searching, setSearching] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (after: number | null) => {
    const { publicWatchFeed } = await import('../../api/service');
    try {
      const page = await publicWatchFeed(PAGE, after);
      if (!alive.current) return;
      const ordered = leadWithCategories(page.items);
      setItems((prev) => (after == null ? ordered : [...prev, ...ordered]));
      setCursor(page.nextCursor ?? null);
      setFailed(null);
    } catch (e) {
      if (alive.current) setFailed((e as Error).message);
    } finally {
      if (alive.current) { setLoading(false); setMore(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load(null);
    return () => { alive.current = false; };
  }, [load]);

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    try {
      const { publicWatchSearch } = await import('../../api/service');
      const found = await publicWatchSearch(q, 24);
      if (alive.current) setResults(found);
    } catch {
      if (alive.current) setResults({ posts: [], members: [] });
    } finally {
      if (alive.current) setSearching(false);
    }
  };

  const signUp = (why: string) => {
    // The ask arrives when it is the next thing the person wanted to do anyway.
    navigation.navigate('SignUp');
    void why;
  };

  const shown = results ? results.posts : items;
  const wide = contentWidth > 720;
  const columns = wide ? 2 : 1;

  const header = useMemo(() => (
    <View style={{ paddingHorizontal: space.lg, paddingTop: insets.top + space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo size={24} />
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Pressable
            onPress={() => navigation.navigate('SignIn')}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            style={({ pressed }) => ({ paddingHorizontal: space.sm, minHeight: HIT, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Txt variant="bodyStrong" color="textSecondary">Sign in</Txt>
          </Pressable>
          <Button title="Join" onPress={() => signUp('join')} style={{ minHeight: 38 }} />
        </View>
      </View>

      {/* Search is a real field on the first screen. A visitor who came for one
          thing — a clip, a match, a cartoon — should be able to ask for it. */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md,
        backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
        borderColor: colors.border, paddingHorizontal: space.md, height: 44,
      }}>
        <Ionicons name="search" size={17} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={(t) => { setQuery(t); if (!t.trim()) setResults(null); }}
          onSubmitEditing={runSearch}
          returnKeyType="search"
          placeholder="Search holUpp — football, cartoons, clips"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search holUpp"
          style={{ flex: 1, color: colors.text, fontSize: 15, height: '100%' }}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => { setQuery(''); setResults(null); }} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
            <Ionicons name="close-circle" size={17} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? <ActivityIndicator style={{ marginTop: space.md }} color={colors.primary} /> : null}

      {results && !searching ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="bodyStrong">{results.posts.length ? `${results.posts.length} ${results.posts.length === 1 ? 'post' : 'posts'}` : 'No posts'}{results.members.length ? ` · ${results.members.length} ${results.members.length === 1 ? 'person' : 'people'}` : ''}</Txt>
          {results.members.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.sm }} contentContainerStyle={{ gap: space.md }}>
              {results.members.map((m) => (
                <Pressable key={m.id} onPress={() => signUp('profile')} style={{ alignItems: 'center', width: 74 }} accessibilityRole="button" accessibilityLabel={`${m.name}, open profile`}>
                  <Avatar uri={m.photos?.[0]?.url ?? null} name={m.name} size={56} ring={m.badgeTier === 'gold' || m.badgeTier === 'diamond' ? 'gold' : undefined} />
                  <Txt variant="caption" numberOfLines={1} style={{ marginTop: 4 }}>{m.name}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {!results ? (
        <View style={{ marginTop: space.lg, marginBottom: space.sm }}>
          <Txt variant="heading">The room, right now</Txt>
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            {items.length === 0 || hasCategoryLead(items)
              ? 'Public posts from holUpp. Everything else needs an account.'
              : `No ${WATCH_CATEGORIES.map((c) => c.label.toLowerCase()).join(', ')} in the room yet — so here is holUpp itself.`}
          </Txt>
        </View>
      ) : null}
    </View>
  ), [colors, insets.top, navigation, query, results, searching, space, contentWidth]);

  const card = (item: WatchPost) => (
    <Pressable
      key={item.id}
      onPress={() => signUp('post')}
      accessibilityRole="button"
      accessibilityLabel={`${item.author.name}: ${item.body ?? 'a post'}. Open in holUpp.`}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        marginBottom: space.md,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {item.mediaUrl ? (
        item.mediaKind === 'video' ? (
          /*
           * An explicit height, not an aspect ratio.
           *
           * `aspectRatio` on a percentage-width box is honoured by the phone and
           * not by the web build, which turned each clip into a full screen of
           * empty card — the first version of this screen was three blank panels
           * with a caption at the bottom. A fixed height is the same everywhere,
           * and the play badge says what the box is even before a poster frame
           * loads.
           */
          <View style={{ height: 230, backgroundColor: colors.elevated }}>
            <ClipThumb uri={item.mediaUrl} style={{ width: '100%', height: 230 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <Ionicons name="play" size={24} color="#fff" />
              </View>
              {/*
                * The tile says what it is even when no frame can be drawn.
                *
                * A poster frame is a nicety: a browser without H.264 (rare on the
                * real web, common in test environments) or a clip whose first frame
                * has not been extracted yet leaves an empty box, and an empty box
                * with a play button is a promise the page cannot keep. The label is
                * true in every case — it is a clip, and it plays in the app.
                */}
              <View style={{ position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                <Ionicons name="videocam-outline" size={12} color="#fff" />
                <Txt variant="caption" style={{ color: '#fff' }}>Clip</Txt>
              </View>
            </View>
          </View>
        ) : (
          <Photo uri={item.mediaUrl} style={{ width: '100%', height: 320 }} fit="cover" />
        )
      ) : null}
      <View style={{ padding: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Avatar uri={item.author.photos?.[0]?.url ?? null} name={item.author.name} size={28} />
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{item.author.name}</Txt>
          {item.author.verified ? <Ionicons name="checkmark-circle" size={14} color={colors.primary} /> : null}
          <Txt variant="caption" color="textMuted" style={{ marginLeft: 'auto' }}>{timeAgo(item.createdAt)}</Txt>
        </View>
        {item.body ? <Txt variant="body" style={{ marginTop: space.xs }} numberOfLines={6}>{item.body}</Txt> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="heart-outline" size={16} color={colors.textMuted} />
            <Txt variant="caption" color="textMuted">{item.likeCount ?? 0}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="chatbubble-outline" size={15} color={colors.textMuted} />
            <Txt variant="caption" color="textMuted">{item.commentCount ?? 0}</Txt>
          </View>
        </View>
      </View>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Logo size={28} />
        <ActivityIndicator style={{ marginTop: space.md }} color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(p) => String(p.id)}
        numColumns={columns}
        key={columns}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <View style={columns > 1 ? { flex: 1 / columns, paddingHorizontal: space.lg / 2 } : undefined}>
            {card(item)}
          </View>
        )}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        columnWrapperStyle={columns > 1 ? { paddingHorizontal: space.lg / 2 } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => { setRefreshing(true); void load(null); }}
          />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => { if (!results && cursor != null && !more) { setMore(true); void load(cursor); } }}
        ListFooterComponent={
          <View style={{ paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm, paddingTop: space.md }}>
            {more ? <ActivityIndicator color={colors.primary} /> : null}
            {failed ? (
              <Txt variant="small" color="textSecondary" align="center">
                {failed}
              </Txt>
            ) : null}
            {!results ? (
              <>
                <Txt variant="small" color="textMuted" align="center">
                  That is what anyone can see. An account shows you the rest — Moments, clips, the people near you.
                </Txt>
                <Button title="Create your Space" onPress={() => signUp('footer')} />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          results ? (
            <View style={{ padding: space.xl, alignItems: 'center' }}>
              <Txt variant="bodyStrong" align="center">Nothing here yet for “{query.trim()}”</Txt>
              <Txt variant="small" color="textSecondary" align="center" style={{ marginTop: space.xs }}>
                holUpp is new, so some rooms are still empty. Try a broader word, or start one yourself.
              </Txt>
              <View style={{ marginTop: space.md }}>
                <Button title="Join holUpp" onPress={() => signUp('empty')} />
              </View>
            </View>
          ) : (
            <View style={{ padding: space.xl, alignItems: 'center' }}>
              <Txt variant="bodyStrong" align="center">The room is quiet</Txt>
              <Txt variant="small" color="textSecondary" align="center" style={{ marginTop: space.xs }}>
                No public posts yet. Be one of the first — an account takes a minute.
              </Txt>
              <View style={{ marginTop: space.md }}>
                <Button title="Create your Space" onPress={() => signUp('first')} />
              </View>
            </View>
          )
        }
      />
    </View>
  );
}
