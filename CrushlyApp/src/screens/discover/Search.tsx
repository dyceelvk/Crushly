import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Rise } from '../../components/Rise';
import { Tabs, TabItem } from '../../components/Tabs';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useSearch } from '../../api/hooks';
import { shownPosts } from '../../lib/features';
import { Suggestions } from '../../components/Suggestions';
import { useMentionInput } from '../../components/useMentionInput';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import {
  RECENT_KEY,
  parseRecents,
  pushRecent,
  removeRecent,
  serializeRecents,
} from '../../lib/recentSearches';
import { stagger } from '../../lib/motion';
import { storage } from '../../lib/storage';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Tab = 'top' | 'people' | 'flows' | 'moments';

/** How many results of each kind "Top" shows before it offers the full list. */
const PREVIEW = 3;

/**
 * Search — members, and what they have shared.
 *
 * It finds people by name, handle, city and interests, and it finds words
 * inside Flows and Moments. It never finds more than that: everything
 * in these results has already been through the same rules as the feed it came
 * from, so the search box is not a way round an audience, a Circle, or a block.
 *
 * The shape of the screen is copied from the search everyone already knows,
 * because the shape is the part that costs nothing to get right:
 *
 *   The words you typed become the heading, at heading size. Searching is a
 *   place you go, and a place has a name.
 *
 *   A tab per kind of result, with Top first — Top is a little of everything,
 *   which is what you want before you know what you are looking for. Each tab
 *   carries its own count, so you can see that there were four people and one
 *   Flow before you spend a tap finding out.
 *
 *   Nothing to search yet shows what you searched for last, not an advert for
 *   the search box.
 */
export function SearchScreen({ route }: { route?: { params?: { q?: string } } }) {
  /* Every picture on this screen opens a Moment when there is one live, and the
     Space otherwise — the same handler every other screen uses. */
  const openProfile = useProfileTap();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();

  // A hashtag pressed in a post arrives here as the words to search for, so the
  // tag behaves like the search it is rather than a second kind of search.
  const seed = route?.params?.q ?? '';
  const [text, setText] = useState(seed);
  const [query, setQuery] = useState(seed.trim());
  const [tab, setTab] = useState<Tab>('top');
  const [recents, setRecents] = useState<string[]>([]);

  // Typing shouldn't cost a round trip per letter.
  useEffect(() => {
    if (text.trim() === query) return;
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text, query]);

  useEffect(() => {
    let alive = true;
    storage.get(RECENT_KEY).then((raw) => {
      if (alive) setRecents(parseRecents(raw));
    });
    return () => {
      alive = false;
    };
  }, []);

  const remember = useCallback((word: string) => {
    setRecents((current) => {
      const next = pushRecent(current, word);
      if (next !== current) storage.set(RECENT_KEY, serializeRecents(next));
      return next;
    });
  }, []);

  const forget = useCallback((word: string) => {
    setRecents((current) => {
      const next = removeRecent(current, word);
      storage.set(RECENT_KEY, serializeRecents(next));
      return next;
    });
  }, []);

  // `@` and `#` mean the same thing here as they do in a post: this is a
  // person, or this is a tag. The sigil is ours, not the catalogue's, so it is
  // dropped before the words go looking.
  const searchInput = useMentionInput(text, setText);
  const words = query.replace(/^[@#]/, '').trim();
  const results = useSearch(words);
  const data = results.data;
  // A result that cannot be opened is not a result. Clips are filtered here as
  // they are in every other list, so the counts and the rows agree.
  const posts = shownPosts(data?.posts ?? []);

  const counts = useMemo(
    () => ({
      people: data?.members.length ?? 0,
      flows: posts.length,
      moments: data?.moments.length ?? 0,
    }),
    [data, posts],
  );
  const total = counts.people + counts.flows + counts.moments;
  const asked = words.length >= 2;

  // Switching tabs is a change of content, not a new screen: the tab row stays
  // put and only the list below it is replaced. It is remounted by key so the
  // rows arrive again, which is the whole feedback the tap needs.
  const tabs: TabItem<Tab>[] = [
    { id: 'top', label: 'Top', count: total },
    { id: 'people', label: 'People', count: counts.people },
    { id: 'flows', label: 'Posts', count: counts.flows },
    { id: 'moments', label: 'Moments', count: counts.moments },
  ];

  const go = (fn: () => void, rememberWord = true) => () => {
    if (rememberWord) remember(words);
    fn();
  };

  const peopleList = (limit?: number) =>
    (data?.members ?? []).slice(0, limit ?? undefined).map((p, i) => (
      <Rise key={`m-${p.id}`} delay={stagger(i)}>
        <MemberRow
          name={p.name}
          handle={p.username}
          sub={[p.city, p.age ? `${p.age}` : null].filter(Boolean).join(' · ')}
          verified={p.verified}
          photo={p.photos?.[0]?.url ?? null}
          onPress={go(() => openProfile(p.id))}
        />
      </Rise>
    ));

  const flowList = (limit?: number) =>
    posts.slice(0, limit ?? undefined).map((post, i) => (
      <Rise key={`p-${post.id}`} delay={stagger(i)}>
        <TextRow
          kind="Post"
          icon="chatbubbles-outline"
          body={post.body}
          author={post.author?.name ?? 'Member'}
          verified={!!post.author?.verified}
          photo={post.author?.photo ?? null}
          when={post.createdAt}
          /* A result you searched for should open what matched, not the person
             who wrote it. Every row here used to go to the author's Space, so a
             post you found by its words was unreachable from the one screen
             that found it. */
          onPress={go(() => navigation.navigate('PostViewer', { postId: post.id }))}
        />
      </Rise>
    ));

  const momentList = (limit?: number) =>
    (data?.moments ?? []).slice(0, limit ?? undefined).map((m, i) => (
      <Rise key={`mo-${m.id}`} delay={stagger(i)}>
        <TextRow
          kind="Moment"
          icon="sparkles-outline"
          body={m.body}
          author={m.author?.name ?? 'Member'}
          verified={!!m.author?.verified}
          photo={m.author?.photo ?? null}
          when={m.createdAt}
          onPress={go(() => navigation.navigate('Moments'))}
        />
      </Rise>
    ));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.sm,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
      >
        <IconButton icon="arrow-back" label="Back" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Input
            value={text}
            onChangeText={searchInput.onChangeText}
            onSelectionChange={searchInput.onSelectionChange}
            onSubmitEditing={() => {
              if (asked) remember(words);
            }}
            placeholder="Search people, or words they’ve shared"
            icon="search"
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search"
          />
        </View>
        {text ? (
          <IconButton
            icon="close"
            label="Clear search"
            onPress={() => {
              setText('');
              setQuery('');
              setTab('top');
            }}
          />
        ) : null}
      </View>

      {/* Typing `@` or `#` turns the box into the same two lists it opens
          everywhere else — and picking one leaves the finished word in the
          search box, so the results are for that person or that tag. */}
      {searchInput.token ? (
        <View style={{ paddingHorizontal: gutter, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
          <Suggestions token={searchInput.token} onPick={searchInput.pick} quiet />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!asked ? (
          <>
            {/* What you looked for before. Eight words, on this device, gone
                with one tap — the cheapest improvement to a search box there
                is, and the only one that needs no server. */}
            {recents.length ? (
              <View style={{ marginTop: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Txt variant="label" color="textSecondary">
                    RECENT
                  </Txt>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent searches"
                    onPress={() => {
                      setRecents([]);
                      storage.remove(RECENT_KEY);
                    }}
                    hitSlop={8}
                  >
                    <Txt variant="caption" color="textMuted">
                      Clear
                    </Txt>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.sm }}>
                  {recents.map((word) => (
                    <Pressable
                      key={word}
                      accessibilityRole="button"
                      accessibilityLabel={`Search again for ${word}`}
                      onPress={() => {
                        setText(word);
                        setQuery(word);
                        remember(word);
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingLeft: 12,
                        paddingRight: 8,
                        height: 34,
                        borderRadius: radius.pill,
                        backgroundColor: colors.card,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                      <Txt variant="small" numberOfLines={1} style={{ maxWidth: 180 }}>
                        {word}
                      </Txt>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${word} from recent searches`}
                        hitSlop={8}
                        onPress={() => forget(word)}
                      >
                        <Ionicons name="close" size={13} color={colors.textMuted} />
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            <EmptyState
              icon="search-outline"
              title="Search Hollop"
              message="Type a name, a handle, a city or an interest — or a word somebody shared in a post or a Moment. Start with @ for a person, # for a tag."
            />
          </>
        ) : results.isLoading ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Skeleton style={{ height: 56, borderRadius: radius.md }} />
            <Skeleton style={{ height: 56, borderRadius: radius.md }} />
            <Skeleton style={{ height: 56, borderRadius: radius.md }} />
          </View>
        ) : results.isError ? (
          <ErrorState error={results.error} message="Search didn’t load." onRetry={results.refetch} />
        ) : total === 0 ? (
          <EmptyState icon="search-outline" title={`Nothing for “${words}”`} message="Try a shorter word, or a name." />
        ) : (
          <>
            {/* The words you typed, as a place, with its name on it. */}
            <Txt variant="title" style={{ marginTop: space.sm }} numberOfLines={2} accessibilityRole="header">
              {words}
            </Txt>
            <Txt variant="caption" color="textSecondary" style={{ marginBottom: space.sm }}>
              {total === 1 ? '1 result' : `${total} results`}
            </Txt>

            <Tabs tabs={tabs} active={tab} onChange={setTab} accessibilityLabel="Result types" />

            <View style={{ height: 1, backgroundColor: colors.border, marginTop: space.xs, marginBottom: space.md }} />

            <View key={tab}>
              {tab === 'top' ? (
                <>
                  {counts.people ? (
                    <Section title="People" more={counts.people > PREVIEW ? counts.people : 0} onMore={() => setTab('people')}>
                      {peopleList(PREVIEW)}
                    </Section>
                  ) : null}
                  {counts.flows ? (
                    <Section title="Crushes" more={counts.flows > PREVIEW ? counts.flows : 0} onMore={() => setTab('flows')}>
                      {flowList(PREVIEW)}
                    </Section>
                  ) : null}
                  {counts.moments ? (
                    <Section
                      title="Moments"
                      more={counts.moments > PREVIEW ? counts.moments : 0}
                      onMore={() => setTab('moments')}
                    >
                      {momentList(PREVIEW)}
                    </Section>
                  ) : null}
                </>
              ) : null}
              {tab === 'people' ? <Section title="People">{peopleList()}</Section> : null}
              {tab === 'flows' ? <Section title="Crushes">{flowList()}</Section> : null}
              {tab === 'moments' ? <Section title="Moments">{momentList()}</Section> : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  children,
  more = 0,
  onMore,
}: {
  title: string;
  children: React.ReactNode;
  /** Total available, when this section is only a preview of them. */
  more?: number;
  onMore?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
        <Txt variant="label" color="textSecondary" accessibilityRole="header">
          {title.toUpperCase()}
        </Txt>
        {/* A preview says so. The alternative — a list that just ends — reads
            as "that was all there was". */}
        {more > 0 && onMore ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`See all ${more} ${title.toLowerCase()}`}
            onPress={onMore}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Txt variant="caption" color="textSecondary">
              {`See all ${more}`}
            </Txt>
            <Ionicons name="chevron-forward" size={13} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: space.md,
        paddingVertical: 12,
        backgroundColor: pressed ? colors.elevated : 'transparent',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      })}
    >
      {children}
    </Pressable>
  );
}

function MemberRow({
  name,
  handle,
  sub,
  verified,
  photo,
  onPress,
}: {
  name: string;
  handle?: string | null;
  sub?: string;
  verified: boolean;
  photo: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Row onPress={onPress} label={`${name}${handle ? `, @${handle}` : ''}`}>
      <Avatar uri={photo} name={name} size={40} ring={verified ? 'gold' : undefined} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Txt>
          {verified ? <VerifiedBadge size={13} /> : null}
        </View>
        <Txt variant="caption" color="textSecondary" numberOfLines={1}>
          {[handle ? `@${handle}` : null, sub || null].filter(Boolean).join('  ·  ')}
        </Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Row>
  );
}

function TextRow({
  kind,
  icon,
  body,
  author,
  verified,
  photo,
  when,
  onPress,
}: {
  kind: string;
  icon: keyof typeof Ionicons.glyphMap;
  body: string;
  author: string;
  verified: boolean;
  photo: string | null;
  when: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Row onPress={onPress} label={`${kind} by ${author}`}>
      <Avatar uri={photo} name={author} size={36} />
      <Ionicons name={icon} size={16} color={colors.gold} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="small" color="textSecondary" numberOfLines={1}>
          {author}
          {verified ? ' · verified' : ''} · {timeAgo(when)}
        </Txt>
        <Txt variant="body" numberOfLines={2} style={{ marginTop: 1 }}>
          {body || `(a ${kind.toLowerCase()} with no words)`}
        </Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Row>
  );
}
