import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useConversations, useCrushes, useOpenConversation } from '../../api/hooks';
import type { ConversationSummary, Message } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { messagePreview } from '../../lib/messages';
import type { RootStackParamList } from '../../navigation/types';

export function MessagesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { contentWidth, gutter } = useLayout();
  const { data, isLoading, isError, error, refetch, isRefetching } = useConversations();
  const { data: crushes } = useCrushes();
  const open = useOpenConversation();

  // Mutual Crushes you haven't started talking to yet.
  const fresh = useMemo(() => {
    const talking = new Set((data ?? []).filter((c) => c.lastMessage).map((c) => c.peer.id));
    return (crushes?.mutual ?? []).filter((p) => !talking.has(p.id));
  }, [data, crushes]);
  const convs = useMemo(() => (data ?? []).filter((c) => c.lastMessage), [data]);

  // Search box: matches names, previews and message text.
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filteredConvs = useMemo(() => {
    if (!q) return convs;
    return convs.filter((c) => {
      const preview = messagePreview(c.lastMessage, c.peer.name).toLowerCase();
      return (
        c.peer.name.toLowerCase().includes(q) ||
        preview.includes(q) ||
        (c.lastMessage?.body ?? '').toLowerCase().includes(q)
      );
    });
  }, [convs, q]);
  const filteredFresh = useMemo(
    () => (q ? fresh.filter((p) => p.name.toLowerCase().includes(q)) : fresh),
    [fresh, q],
  );

  const startChat = async (userId: number) => {
    try {
      const conv = await open.mutateAsync(userId);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open chat', message: (e as Error).message });
    }
  };

  const header = (
    <View style={{ paddingTop: space.sm }}>
      <Txt variant="display" accessibilityRole="header">
        Messages
      </Txt>
      <Txt variant="body" color="textSecondary" style={{ marginTop: 2 }}>
        Whispers with your Connections.
      </Txt>

      <Input
        icon="search"
        placeholder="Find Whispers..."
        accessibilityLabel="Find Whispers"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        containerStyle={{ marginTop: space.md }}
        returnKeyType="search"
      />

      {filteredFresh.length ? (
        <View style={{ marginTop: space.xl }}>
          <Txt variant="label" color="gold" style={{ marginBottom: space.sm }}>
            New Mutual Crushes
          </Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: space.md }}>
            {filteredFresh.map((p) => (
              <Pressable key={p.id} onPress={() => startChat(p.id)} accessibilityRole="button" accessibilityLabel={`Say hello to ${p.name}`} style={{ alignItems: 'center', width: 76 }}>
                <Avatar uri={p.photos[0]?.url} name={p.name} size={68} ring="crush" online={!!p.online} />
                <Txt variant="smallStrong" numberOfLines={1} style={{ marginTop: 6 }}>
                  {p.name}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {filteredConvs.length ? (
        <Txt variant="label" color="textSecondary" style={{ marginTop: space.xl, marginBottom: space.xs }}>
          Whispers
        </Txt>
      ) : null}
      {isLoading
        ? Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 12 }}>
              <Skeleton style={{ width: 56, height: 56, borderRadius: 28 }} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton style={{ height: 14, width: '40%' }} />
                <Skeleton style={{ height: 12, width: '75%' }} />
              </View>
            </View>
          ))
        : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={filteredConvs}
        keyExtractor={(c) => String(c.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: gutter, paddingBottom: space.xxxl, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
        renderItem={({ item }) => <ConversationRow conv={item} onPress={() => navigation.navigate('Chat', { conversationId: item.id })} />}
        ListEmptyComponent={
          isLoading ? null : isError ? (
            <ErrorState message={(error as Error)?.message} onRetry={refetch} />
          ) : q && !filteredFresh.length ? (
            <EmptyState
              icon="search-outline"
              title={`No matches for “${query.trim()}”.`}
              message="Try another name or a word from a conversation."
              action={{ label: 'Clear search', onPress: () => setQuery('') }}
            />
          ) : filteredFresh.length ? (
            <View style={{ marginTop: space.xl, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Txt variant="subheading">Make the first move</Txt>
              <Txt variant="small" color="textSecondary" style={{ marginTop: 4 }}>
                Tap a Click above to say hello. A question about their Space beats “hey” every time.
              </Txt>
            </View>
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title="No Whispers yet."
              message="Someone interesting is waiting to hear from you."
              action={{ label: 'Start discovering', onPress: () => navigation.navigate('Main', { screen: 'Discover' }) }}
            />
          )
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const ConversationRow = React.memo(function ConversationRow({ conv, onPress }: { conv: ConversationSummary; onPress: () => void }) {
  const { colors } = useTheme();
  const unread = conv.unread > 0;
  const preview = messagePreview(conv.lastMessage, conv.peer.name);
  const when = conv.lastMessage ? timeAgo(conv.lastMessage.createdAt) : '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${conv.peer.name}${unread ? `, ${conv.unread} unread` : ''}. ${preview}. ${when}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}
    >
      <Avatar uri={conv.peer.photo} name={conv.peer.name} size={56} online={!!conv.peer.online} />
      <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12, marginBottom: -12, paddingTop: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant={unread ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flexShrink: 1, fontSize: 16 }}>
            {conv.peer.name}
          </Txt>
          {conv.peer.verified ? <VerifiedBadge size={14} /> : null}
          <View style={{ flex: 1 }} />
          <Txt variant="caption" color={unread ? 'gold' : 'textMuted'}>
            {when}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
          {conv.lastMessage?.mine ? (
            <Ionicons name={conv.lastMessage.readAt ? 'checkmark-done' : 'checkmark'} size={14} color={conv.lastMessage.readAt ? colors.gold : colors.textMuted} />
          ) : null}
          <Txt variant="small" color={unread ? 'text' : 'textSecondary'} numberOfLines={1} style={{ flex: 1 }}>
            {preview}
          </Txt>
          {unread ? (
            <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.crush, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <Txt variant="caption" color="onCrush" style={{ fontWeight: '700' }}>
                {conv.unread > 99 ? '99+' : conv.unread}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});
