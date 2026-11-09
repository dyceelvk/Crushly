import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Avatar, Photo } from '../../components/Photo';
import { ClipThumb } from '../../components/ClipThumb';
import { mediaUrl } from '../../api/client';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { BottomSheet, ActionSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { useSwipeTabs } from '../../components/SwipeTabs';
import { Chip, ChipGroup } from '../../components/Chip';
import { useToast } from '../../components/Toast';
import { useLayout } from '../../components/Layout';
import { useSearch, useHolupTrends } from '../../api/hooks';
import type { SearchCategory, SearchFilters } from '../../api/types';
import { Suggestions } from '../../components/Suggestions';
import { useMentionInput } from '../../components/useMentionInput';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { RECENT_KEY, parseRecents, pushRecent, removeRecent, serializeRecents } from '../../lib/recentSearches';
import { storage } from '../../lib/storage';
import { SUPPORT_EMAIL } from '../../lib/company';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Period = 'any' | 'day' | 'week' | 'month';
type FilterDraft = { period: Period; sort: SearchFilters['sort']; author: string; content: SearchFilters['content'] };
const initial: FilterDraft = { period: 'any', sort: 'relevance', author: '', content: 'all' };
const tabs: { id: SearchCategory; label: string }[] = [
  { id: 'top', label: 'Top' }, { id: 'clips', label: 'Clips' }, { id: 'photos', label: 'Photos' },
  { id: 'people', label: 'People' }, { id: 'sounds', label: 'Sounds' }, { id: 'places', label: 'Places' },
  { id: 'hashtags', label: 'Hashtags' }, { id: 'moments', label: 'Moments' },
];

/** Search only returns things the current member may actually see. */
export function SearchScreen({ route }: { route?: { params?: { q?: string } } }) {
  const navigation = useNavigation<Nav>();
  const openProfile = useProfileTap();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const seed = route?.params?.q ?? '';
  const [text, setText] = useState(seed);
  const [query, setQuery] = useState(seed.trim());
  const [tab, setTab] = useState<SearchCategory>('top');
  const swipe = useSwipeTabs({ options: tabs.map((item) => item.id), value: tab, onChange: setTab, width: contentWidth });
  const [selectedPlace, setSelectedPlace] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>(initial);
  const [applied, setApplied] = useState<FilterDraft>(initial);
  const [since, setSince] = useState(0);

  useEffect(() => {
    if (text.trim() === query) return;
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text, query]);
  useEffect(() => {
    let alive = true;
    storage.get(RECENT_KEY).then((raw) => { if (alive) setRecents(parseRecents(raw)); });
    return () => { alive = false; };
  }, []);
  const remember = useCallback((word: string) => setRecents((current) => {
    const next = pushRecent(current, word);
    if (next !== current) storage.set(RECENT_KEY, serializeRecents(next));
    return next;
  }), []);
  const forget = useCallback((word: string) => setRecents((current) => {
    const next = removeRecent(current, word); storage.set(RECENT_KEY, serializeRecents(next)); return next;
  }), []);
  const searchInput = useMentionInput(text, setText);
  const words = query.replace(/^[@#]/, '').trim();
  const asked = words.length >= 2;
  const filtersActive = applied.sort !== 'relevance' || applied.period !== 'any' || !!applied.author || applied.content !== 'all';
  const trends = useHolupTrends(!asked);
  const results = useSearch(words, tab, { place: tab === 'people' ? selectedPlace : '', hashtag: query.startsWith('#'), since, sort: applied.sort, author: applied.author, content: tab === 'top' ? applied.content : 'all' });
  const data = results.data;
  const total = (data?.members.length ?? 0) + (data?.posts.length ?? 0) + (data?.moments.length ?? 0) + (data?.sounds.length ?? 0) + (data?.places.length ?? 0) + (data?.hashtags.length ?? 0);
  const go = (fn: () => void) => () => { remember(words); fn(); };
  const openFilters = () => { setDraft(applied); setFilterOpen(true); };
  const photo = (a: { photo?: string | null; photos?: { url: string }[] } | null | undefined) => a?.photo ?? a?.photos?.[0]?.url ?? null;
  const people = (limit?: number) => (data?.members ?? []).slice(0, limit).map((p) => (
    <MemberRow key={`member-${p.id}`} name={p.name} handle={p.username} sub={[p.city, p.age ? `${p.age}` : null].filter(Boolean).join(' · ')} verified={p.verified} photo={p.photos?.[0]?.url ?? null} onPress={go(() => openProfile(p.id))} />
  ));
  const posts = (limit?: number) => (data?.posts ?? []).slice(0, limit).map((p) => (
    <TextRow key={`post-${p.id}`} kind={p.mediaKind === 'video' ? 'Clip' : p.mediaKind === 'photo' ? 'Photo' : 'Post'} icon={p.mediaKind === 'video' ? 'play-circle-outline' : p.mediaKind === 'photo' ? 'image-outline' : 'chatbubbles-outline'} body={p.body} author={p.author?.name ?? 'Member'} verified={!!p.author?.verified} photo={photo(p.author)} when={p.createdAt} onPress={go(() => navigation.navigate('PostViewer', { postId: p.id }))} />
  ));
  const moments = (limit?: number) => (data?.moments ?? []).slice(0, limit).map((m) => (
    <TextRow key={`moment-${m.id}`} kind="Moment" icon="sparkles-outline" body={m.body} author={m.author?.name ?? 'Member'} verified={!!m.author?.verified} photo={photo(m.author)} when={m.createdAt} onPress={go(() => navigation.navigate('MomentViewer', { userId: m.author.id, mine: m.mine, momentId: m.id }))} />
  ));
  const sounds = (limit?: number) => (data?.sounds ?? []).slice(0, limit).map((s) => <Row key={`sound-${s.id}`} label={`Open sound ${s.title}`} onPress={go(() => navigation.navigate('Sound', { soundId: s.id }))}><Ionicons name="musical-notes" size={22} color={colors.primary} /><Txt variant="bodyStrong" style={{ flex: 1 }}>{s.title}</Txt><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row>);
  const places = (limit?: number) => (data?.places ?? []).slice(0, limit).map((p) => <Row key={`place-${p.name}`} label={`People in ${p.name}`} onPress={go(() => { setText(p.name); setQuery(p.name); setSelectedPlace(p.name); setTab('people'); })}><Ionicons name="location-outline" size={22} color={colors.primary} /><Txt variant="bodyStrong" style={{ flex: 1 }}>{p.name}</Txt><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row>);
  const hashtags = (limit?: number) => (data?.hashtags ?? []).slice(0, limit).map((t) => <Row key={`tag-${t.tag}`} label={`Search hashtag ${t.tag}`} onPress={go(() => { setText(`#${t.tag}`); setQuery(`#${t.tag}`); setSelectedPlace(''); setTab('top'); })}><Ionicons name="pricetag-outline" size={22} color={colors.primary} /><Txt variant="bodyStrong" style={{ flex: 1 }}>#{t.tag}</Txt><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row>);
  const block = (title: string, count: number, content: React.ReactNode, target: SearchCategory) => count ? <Section title={title} more={count > 3 ? count : 0} onMore={() => setTab(target)}>{content}</Section> : null;

  return <View {...swipe.panHandlers} style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.sm, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
      <IconButton icon="arrow-back" label="Back" onPress={() => navigation.goBack()} />
      <View style={{ flex: 1 }}><Input value={text} onChangeText={(value) => { setSelectedPlace(''); searchInput.onChangeText(value); }} onSelectionChange={searchInput.onSelectionChange} onSubmitEditing={() => { if (asked) remember(words); }} placeholder="Search Holup" icon="search" autoFocus returnKeyType="search" autoCorrect={false} maxLength={120} accessibilityLabel="Search" /></View>
      {text ? <IconButton icon="close" label="Clear search" onPress={() => { setText(''); setQuery(''); setSelectedPlace(''); setTab('top'); }} /> : null}
      <IconButton icon="ellipsis-horizontal" label="Search options" onPress={() => setMenu(true)} />
    </View>
    {searchInput.token ? <View style={{ paddingHorizontal: gutter, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}><Suggestions token={searchInput.token} onPick={searchInput.pick} quiet /></View> : null}
    {asked ? <View accessibilityLabel="Result types" style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter, flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {tabs.map((t) => <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} onPress={() => setTab(t.id)} style={{ minHeight: 40, paddingHorizontal: 9, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: tab === t.id ? colors.primary : 'transparent' }}><Txt variant="smallStrong" color={tab === t.id ? 'text' : 'textMuted'}>{t.label}</Txt></Pressable>)}
    </View> : null}
    {asked && filtersActive ? <View style={{ width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: gutter, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Pressable onPress={openFilters} accessibilityRole="button" accessibilityLabel="Edit active filters"><Txt variant="smallStrong" color="gold">Filters active · Edit</Txt></Pressable>
      <Pressable onPress={() => { setApplied(initial); setSince(0); }} accessibilityRole="button" accessibilityLabel="Clear filters"><Txt variant="small" color="textSecondary">Clear</Txt></Pressable>
    </View> : null}
    <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.xxxl, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      {!asked ? <>
        {recents.length ? <View style={{ marginTop: space.md }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt variant="label" color="textSecondary">RECENT</Txt><Pressable onPress={() => { setRecents([]); storage.remove(RECENT_KEY); }} accessibilityRole="button" accessibilityLabel="Clear recent searches"><Txt variant="caption" color="textMuted">Clear</Txt></Pressable></View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.sm }}>{recents.map((word) => <View key={word} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 8, height: 36, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}><Pressable onPress={() => { setText(word); setQuery(word); setSelectedPlace(''); remember(word); }} accessibilityRole="button" accessibilityLabel={`Search again for ${word}`}><Txt variant="small" numberOfLines={1} style={{ maxWidth: 160 }}>{word}</Txt></Pressable><Pressable onPress={() => forget(word)} accessibilityRole="button" accessibilityLabel={`Remove ${word} from recent searches`} style={{ paddingLeft: 10, paddingVertical: 8 }}><Ionicons name="close" size={15} color={colors.textMuted} /></Pressable></View>)}</View></View> : null}
        {trends.data?.length ? <View style={{ marginTop: space.lg }}>
          <Txt variant="label" color="textSecondary">TRENDING ON POSTS</Txt>
          <Txt variant="caption" color="textMuted" style={{ marginTop: 4, marginBottom: 8 }}>From posts and comments you can see · past 7 days</Txt>
          {trends.data.map((trend) => <Row key={trend.term} label={`Search ${trend.term}`} onPress={() => { setText(trend.term); setQuery(trend.term); setTab('top'); setSelectedPlace(''); }}>
            <Ionicons name="trending-up-outline" size={20} color={colors.primary} />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>{trend.term}</Txt>
            <Txt variant="caption" color="textMuted">{trend.postCount} posts</Txt>
          </Row>)}
        </View> : trends.isError ? <Txt color="textSecondary" style={{ marginTop: space.md }}>Trends couldn’t load. You can still search.</Txt> : null}
        {!trends.data?.length ? <EmptyState icon="search-outline" title="Search Holup" message="Find people, posts, Moments, sounds, places and hashtags." /> : null}
      </> : results.isLoading ? <View style={{ gap: space.sm, marginTop: space.md }}><Skeleton style={{ height: 56, borderRadius: radius.md }} /><Skeleton style={{ height: 56, borderRadius: radius.md }} /><Skeleton style={{ height: 56, borderRadius: radius.md }} /></View>
      : results.isError ? <ErrorState error={results.error} message="Search didn’t load." onRetry={results.refetch} />
      : total === 0 ? <EmptyState icon="search-outline" title={`Nothing for “${words}”`} message="Try another word or change your filters." />
      : <View style={{ paddingTop: space.md }}>
        {tab === 'top' ? <>
          {block('People', data?.members.length ?? 0, people(3), 'people')}
          {data?.posts.length ? <Section title="Posts">{posts()}</Section> : null}
          {block('Moments', data?.moments.length ?? 0, moments(3), 'moments')}
          {block('Sounds', data?.sounds.length ?? 0, sounds(3), 'sounds')}
          {block('Places', data?.places.length ?? 0, places(3), 'places')}
          {block('Hashtags', data?.hashtags.length ?? 0, hashtags(3), 'hashtags')}
        </> : null}
        {tab === 'people' ? <Section title={selectedPlace ? `People in ${selectedPlace}` : 'People'}>{people()}</Section> : null}
        {tab === 'clips' || tab === 'photos' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(data?.posts ?? []).map((p, i) => <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Open ${tab === 'clips' ? 'clip' : 'photo'} by ${p.author?.name ?? 'member'}`} onPress={go(() => navigation.navigate('PostViewer', { postId: p.id }))} style={{ width: '31.8%', aspectRatio: 0.76, backgroundColor: colors.card, borderRadius: radius.sm, overflow: 'hidden' }}>
            {p.mediaUrl && tab === 'photos' ? <Photo uri={p.mediaUrl} style={{ width: '100%', height: '100%' }} fit="cover" /> : p.mediaUrl && i < 6 ? <ClipThumb uri={mediaUrl(p.mediaUrl) ?? ''} style={{ width: '100%', height: '100%' }} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play-circle-outline" size={36} color={colors.textSecondary} /></View>}
            {tab === 'clips' ? <Ionicons name="play-circle" size={20} color="#fff" style={{ position: 'absolute', right: 8, top: 8 }} /> : null}
          </Pressable>)}
        </View> : null}
        {tab === 'moments' ? <Section title="Moments">{moments()}</Section> : null}
        {tab === 'sounds' ? <Section title="Sounds">{sounds()}</Section> : null}
        {tab === 'places' ? <Section title="Places">{places()}</Section> : null}
        {tab === 'hashtags' ? <Section title="Hashtags">{hashtags()}</Section> : null}
        {(tab !== 'top' && total >= 40) || (tab === 'top' && data && [data.members, data.posts, data.moments, data.sounds, data.places, data.hashtags].some((items) => items.length >= 40)) ? <Txt variant="small" color="textSecondary">Showing up to 40 per section. Refine your search to find more.</Txt> : null}
      </View>}
    </ScrollView>
    <ActionSheet visible={menu} onClose={() => setMenu(false)} title="Search options" actions={[
      { label: 'Filters', icon: <Ionicons name="options-outline" size={21} color={colors.text} />, onPress: openFilters },
      { label: 'Share feedback', icon: <Ionicons name="chatbubble-outline" size={21} color={colors.text} />, onPress: () => { Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Holup search feedback')}`).catch(() => toast({ kind: 'error', title: 'Couldn’t open email', message: `Email us at ${SUPPORT_EMAIL}.` })); } },
    ]} />
    <BottomSheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Search filters" subtitle="Date and author apply to posts, Moments, sounds and hashtags. Content type applies to Top. Places stay alphabetical." footer={<Button title="Apply filters" onPress={() => { const days = { any: 0, day: 1, week: 7, month: 30 }[draft.period]; setSince(days ? Date.now() - days * 86400000 : 0); setApplied({ ...draft, author: draft.author.trim() }); setFilterOpen(false); }} />}>
      <Txt variant="smallStrong" style={{ marginBottom: 8 }}>Sort by</Txt><ChipGroup>{([['relevance','Relevance'],['newest','Newest']] as const).map(([id,label]) => <Chip key={id} label={label} selected={draft.sort === id} onPress={() => setDraft({ ...draft, sort: id })} />)}</ChipGroup>
      <Txt variant="smallStrong" style={{ marginTop: 18, marginBottom: 8 }}>Date shared</Txt><ChipGroup>{([['any','Any time'],['day','Past day'],['week','Past week'],['month','Past 30 days']] as const).map(([id,label]) => <Chip key={id} label={label} selected={draft.period === id} onPress={() => setDraft({ ...draft, period: id })} />)}</ChipGroup>
      <Txt variant="smallStrong" style={{ marginTop: 18, marginBottom: 8 }}>Content type in Top</Txt><ChipGroup>{([['all','All'],['clip','Clips'],['photo','Photos'],['text','Text']] as const).map(([id,label]) => <Chip key={id} label={label} selected={draft.content === id} onPress={() => setDraft({ ...draft, content: id })} />)}</ChipGroup>
      <View style={{ marginTop: 18 }}><Input label="Author name or username" value={draft.author} onChangeText={(author) => setDraft({ ...draft, author })} maxLength={60} placeholder="Anyone" autoCapitalize="none" /></View>
      <Button title="Reset filters" variant="ghost" size="sm" onPress={() => setDraft(initial)} />
    </BottomSheet>
  </View>;
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
            accessibilityLabel={`See more ${title.toLowerCase()}`}
            onPress={onMore}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Txt variant="caption" color="textSecondary">
              See more
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
