import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useSearch } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Search — members, and what they have shared.
 *
 * It finds people by name, handle, city and interests, and it finds words
 * inside Flows, Vibes and Moments. It never finds more than that: everything
 * in these results has already been through the same rules as the feed it came
 * from, so the search box is not a way round an audience, a Circle, or a block.
 *
 * A result leads somewhere you could already have gone — a member's Space.
 */
export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  // Typing shouldn't cost a round trip per letter.
  useEffect(() => {
    if (text.trim() === query) return;
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text, query]);

  const results = useSearch(query);
  const data = results.data;

  const total = useMemo(
    () => (data ? data.members.length + data.posts.length + data.vibes.length + data.moments.length : 0),
    [data],
  );
  const asked = query.length >= 2;

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
            onChangeText={setText}
            placeholder="Search people, or words they’ve shared"
            icon="search"
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search"
          />
        </View>
        {text ? <IconButton icon="close" label="Clear search" onPress={() => setText('')} /> : null}
      </View>

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
          <EmptyState
            icon="search-outline"
            title="Search Crushly"
            message="Type a name, a handle, a city or an interest — or a word somebody shared in a Flow, a Vibe or a Moment."
          />
        ) : results.isLoading ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Skeleton style={{ height: 56, borderRadius: radius.md }} />
            <Skeleton style={{ height: 56, borderRadius: radius.md }} />
            <Skeleton style={{ height: 56, borderRadius: radius.md }} />
          </View>
        ) : results.isError ? (
          <ErrorState
            message={results.error instanceof Error ? results.error.message : 'Search didn’t load.'}
            onRetry={results.refetch}
          />
        ) : total === 0 ? (
          <EmptyState
            icon="search-outline"
            title={`Nothing for “${query}”`}
            message="Try a shorter word, or a name."
          />
        ) : (
          <>
            {data && data.members.length ? (
              <Section title="People">
                {data.members.map((p) => (
                  <MemberRow
                    key={`m-${p.id}`}
                    name={p.name}
                    handle={p.username}
                    sub={[p.city, p.age ? `${p.age}` : null].filter(Boolean).join(' · ')}
                    verified={p.verified}
                    photo={p.photos?.[0]?.url ?? null}
                    onPress={() => navigation.navigate('UserProfile', { id: p.id })}
                  />
                ))}
              </Section>
            ) : null}

            {data && data.posts.length ? (
              <Section title="Flows">
                {data.posts.map((post) => (
                  <TextRow
                    key={`p-${post.id}`}
                    kind="Flow"
                    icon="chatbubbles-outline"
                    body={post.body}
                    author={post.author?.name ?? 'Member'}
                    verified={!!post.author?.verified}
                    photo={post.author?.photo ?? null}
                    when={post.createdAt}
                    onPress={() => post.author?.id != null && navigation.navigate('UserProfile', { id: post.author.id })}
                  />
                ))}
              </Section>
            ) : null}

            {data && data.vibes.length ? (
              <Section title="Vibes">
                {data.vibes.map((v) => (
                  <TextRow
                    key={`v-${v.id}`}
                    kind="Vibe"
                    icon="play-circle-outline"
                    body={v.body}
                    author={v.author?.name ?? 'Member'}
                    verified={!!v.author?.verified}
                    photo={v.author?.photo ?? null}
                    when={v.createdAt}
                    onPress={() => v.author?.id != null && navigation.navigate('UserProfile', { id: v.author.id })}
                  />
                ))}
              </Section>
            ) : null}

            {data && data.moments.length ? (
              <Section title="Moments">
                {data.moments.map((m) => (
                  <TextRow
                    key={`mo-${m.id}`}
                    kind="Moment"
                    icon="sparkles-outline"
                    body={m.body}
                    author={m.author?.name ?? 'Member'}
                    verified={!!m.author?.verified}
                    photo={m.author?.photo ?? null}
                    when={m.createdAt}
                    onPress={() => m.author?.id != null && navigation.navigate('UserProfile', { id: m.author.id })}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <Txt variant="label" color="textSecondary" accessibilityRole="header">
        {title.toUpperCase()}
      </Txt>
      <View
        style={{
          marginTop: space.sm,
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
