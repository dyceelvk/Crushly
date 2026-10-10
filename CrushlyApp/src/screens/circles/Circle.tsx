import React, { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../../components/Txt';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Segmented } from '../../components/Segmented';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { Input } from '../../components/Input';
import { useToast } from '../../components/Toast';
import {
  useAddCircleMember, useCircle, useCircleFeed, useCircleMessages, useCreateCirclePost, useCrushes,
  useLeaveCircle, useReadCircle, useRemoveCircleMember, useRenameCircle, useSendCircleMessage,
} from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { pickImage } from '../../lib/media';
import type { RootStackParamList, ScreenProps } from '../../navigation/types';
import type { CircleMessage } from '../../api/types';
import { PostCard } from '../flow/Flow';

type Tab = 'posts' | 'chat' | 'people';

/**
 * A Circle — a small room with its own posts and its own conversation.
 *
 * Everything here is decided by one question: are you in the room? If you are,
 * you can read it, write in it and see who else is there. If you are not, none
 * of this exists for you — not the posts, not the chat, not the photos.
 */
export function CircleScreen({ navigation, route }: ScreenProps<'Circle'>) {
  const { circleId } = route.params;
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();
  const space_q = useCircle(circleId);
  const [tab, setTab] = useState<Tab>('chat');
  const [menu, setMenu] = useState(false);
  const read = useReadCircle();
  const thread = useCircleMessages(circleId); // same cache the chat panel reads
  const scroller = useRef<ScrollView>(null);

  // Looking at the room is what marks it read.
  useEffect(() => {
    read.mutate(circleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);

  // A room reads like a conversation: newest at the bottom, and the view
  // follows it.
  const count = thread.data?.items.length ?? 0;
  useEffect(() => {
    if (tab !== 'chat') return;
    const id = setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 120);
    return () => clearTimeout(id);
  }, [tab, count]);

  const circle = space_q.data?.circle;
  const members = space_q.data?.members ?? [];

  if (space_q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <LoadingBlock label="Opening the Circle" />
      </View>
    );
  }

  if (space_q.isError || !circle) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.xl, paddingHorizontal: gutter }}>
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
        <ErrorState
          message={space_q.error instanceof Error ? space_q.error.message : 'This Circle isn’t available.'}
          onRetry={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Flows' }))}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl refreshing={space_q.isRefetching} onRefresh={space_q.refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
          <View style={{ flex: 1, flexShrink: 1 }}>
            <Txt variant="title" accessibilityRole="header" numberOfLines={1}>
              {circle.name}
            </Txt>
            <Txt variant="small" color="textSecondary" numberOfLines={2} style={{ marginTop: 2 }}>
              {circle.about || `${circle.memberCount} of 12 seats taken`}
            </Txt>
          </View>
          <IconButton icon="ellipsis-horizontal" label="Circle options" onPress={() => setMenu(true)} />
        </View>

        <Segmented<Tab>
          options={[
            { value: 'chat', label: 'Chat' },
            { value: 'posts', label: 'Posts' },
            { value: 'people', label: 'People', count: circle.memberCount },
          ]}
          value={tab}
          onChange={setTab}
        />
        <View style={{ height: space.md }} />

        {tab === 'chat' ? <RoomChat circleId={circleId} members={members} /> : null}
        {tab === 'posts' ? <RoomPosts circleId={circleId} /> : null}
        {tab === 'people' ? <RoomPeople circleId={circleId} members={members} isOwner={circle.myRole === 'owner'} /> : null}
      </ScrollView>

      <CircleMenu
        visible={menu}
        onClose={() => setMenu(false)}
        circleId={circleId}
        name={circle.name}
        isOwner={circle.myRole === 'owner'}
        onLeft={() => navigation.goBack()}
      />
    </View>
  );
}

/* ------------------------------------------------------------------- chat */

function RoomChat({ circleId, members }: { circleId: number; members: { member: { id: number; name: string; photos: { url: string }[] }; role: string }[] }) {
  const { colors } = useTheme();
  const toast = useToast();
  const thread = useCircleMessages(circleId);
  const send = useSendCircleMessage();
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const byId = new Map(members.map((m) => [m.member.id, m.member]));
  const items = thread.data?.items ?? [];

  const pick = async () => {
    setPicking(true);
    const img = await pickImage();
    setPicking(false);
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    setPhoto({ uri: img.uri, mimeType: img.mimeType || 'image/jpeg' });
  };

  const submit = async () => {
    const text = body.trim();
    if (!text && !photo) return;
    try {
      await send.mutateAsync({
        circleId,
        body: text,
        kind: photo ? 'photo' : 'text',
        mediaUri: photo?.uri ?? null,
        mediaMime: photo?.mimeType ?? null,
      });
      setBody('');
      setPhoto(null);
    } catch (e) {
      toast({ kind: 'error', title: 'Not sent', message: (e as Error).message });
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      {thread.isLoading ? (
        <LoadingBlock label="Loading the conversation" />
      ) : thread.isError ? (
        <ErrorState message={thread.error instanceof Error ? thread.error.message : 'The conversation didn’t load.'} onRetry={thread.refetch} />
      ) : items.length ? (
        items.map((m) => <Bubble key={m.id} message={m} author={byId.get(m.senderId)} />)
      ) : (
        <EmptyState
          icon="chatbubble-outline"
          title="Nothing said yet"
          message="Only the people in this Circle can read what’s written here. Say hello."
        />
      )}

      <View style={{ marginTop: space.sm, gap: space.sm }}>
        {photo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Photo uri={photo.uri} style={{ width: 64, height: 64, borderRadius: radius.sm }} />
            <Button title="Remove photo" size="sm" variant="secondary" onPress={() => setPhoto(null)} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <IconButton icon="image-outline" label="Add a photo" onPress={pick} disabled={picking} />
          <View style={{ flex: 1 }}>
            <Input
              value={body}
              onChangeText={setBody}
              placeholder="Write something…"
              maxLength={2000}
              multiline
            />
          </View>
          <IconButton icon="send" label="Send message" color={colors.gold} disabled={(!body.trim() && !photo) || send.isPending} onPress={submit} />
        </View>
      </View>
    </View>
  );
}

function Bubble({
  message: m,
  author,
}: {
  message: CircleMessage;
  author?: { id: number; name: string; photos: { url: string }[] };
}) {
  const { colors } = useTheme();
  const mine = m.mine;
  const name = mine ? 'You' : author?.name ?? 'Member';

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '88%' }}>
        {!mine ? <Avatar uri={author?.photos[0]?.url ?? null} name={name} size={30} /> : null}
        <View
          style={{
            backgroundColor: mine ? colors.goldSoft : colors.card,
            borderWidth: 1,
            borderColor: mine ? colors.goldLine : colors.border,
            borderRadius: radius.lg,
            paddingHorizontal: 12,
            paddingVertical: 10,
            maxWidth: '100%',
          }}
        >
          {!mine ? (
            <Txt variant="caption" color="gold" style={{ marginBottom: 2 }}>
              {name}
            </Txt>
          ) : null}
          {m.kind === 'photo' && m.mediaUrl ? (
            <Photo uri={m.mediaUrl} style={{ width: 200, height: 200, borderRadius: radius.sm, marginBottom: m.body ? 8 : 0 }} alt={`Photo from ${name}`} />
          ) : null}
          {m.kind === 'voice' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="mic" size={16} color={mine ? colors.gold : colors.textSecondary} />
              <Txt variant="body" color={mine ? 'text' : 'text'}>
                Voice note
              </Txt>
            </View>
          ) : null}
          {m.body ? (
            <Txt variant="body" selectable>
              {m.body}
            </Txt>
          ) : null}
          <Txt variant="caption" color="textMuted" style={{ marginTop: 4, alignSelf: 'flex-end' }}>
            {timeAgo(m.createdAt)}
          </Txt>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ posts */

function RoomPosts({ circleId }: { circleId: number }) {
  const { colors } = useTheme();
  const toast = useToast();
  const feed = useCircleFeed(circleId);
  const create = useCreateCirclePost();
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; mimeType: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    setPicking(true);
    const img = await pickImage();
    setPicking(false);
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    setPhoto({ uri: img.uri, mimeType: img.mimeType || 'image/jpeg' });
  };

  const submit = async () => {
    try {
      await create.mutateAsync({
        body: body.trim(),
        audience: 'connections', // the circle id is what decides who sees it
        circleId,
        photoUri: photo?.uri ?? null,
        photoMime: photo?.mimeType ?? null,
      });
      setBody('');
      setPhoto(null);
      feed.refresh();
    } catch (e) {
      toast({ kind: 'error', title: 'Post not shared', message: (e as Error).message });
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm }}>
        <Input
          label="Post to this Circle"
          value={body}
          onChangeText={setBody}
          placeholder="Something for this room…"
          multiline
          maxLength={500}
        />
        {photo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Photo uri={photo.uri} style={{ width: 64, height: 64, borderRadius: radius.sm }} />
            <Button title="Remove photo" size="sm" variant="secondary" onPress={() => setPhoto(null)} />
          </View>
        ) : (
          <Button title="Add a photo" size="sm" variant="secondary" icon="image-outline" loading={picking} onPress={pick} />
        )}
        <Button title="Share with the Circle" size="md" variant="primary" onPress={submit} loading={create.isPending} disabled={!body.trim() && !photo} />
        <Txt variant="caption" color="textMuted">
          Posts here stay in this Circle — they don’t appear in your Flows.
        </Txt>
      </View>

      {feed.isLoading ? (
        <LoadingBlock label="Loading posts" />
      ) : feed.isError ? (
        <ErrorState message={feed.error instanceof Error ? feed.error.message : 'These posts didn’t load.'} onRetry={feed.refresh} />
      ) : feed.posts.length ? (
        <>
          {feed.posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
          <Button title="Show older posts" variant="secondary" size="md" onPress={feed.loadOlder} loading={feed.isFetching} />
        </>
      ) : (
        <EmptyState icon="document-text-outline" title="No posts yet" message="Posts written here are for this Circle only." />
      )}
    </View>
  );
}

/* ----------------------------------------------------------------- people */

function RoomPeople({
  circleId,
  members,
  isOwner,
}: {
  circleId: number;
  members: { member: { id: number; name: string; username: string | null; verified: boolean; photos: { url: string }[] }; role: string; joinedAt: number }[];
  isOwner: boolean;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const toast = useToast();
  const remove = useRemoveCircleMember();
  const add = useAddCircleMember();
  const crushes = useCrushes();
  const [adding, setAdding] = useState(false);

  const inRoom = new Set(members.map((m) => m.member.id));
  const candidates = (crushes.data?.mutual ?? []).filter((m) => !inRoom.has(m.id));

  return (
    <View style={{ gap: space.sm }}>
      {members.map((m) => (
        <View
          key={m.member.id}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md,
          }}
        >
          <Pressable
            onPress={() => navigation.navigate('UserProfile', { id: m.member.id })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${m.member.name}’s Space`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
          >
            <Avatar uri={m.member.photos[0]?.url ?? null} name={m.member.name} size={44} ring={m.member.verified ? 'gold' : undefined} />
            <View style={{ flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {m.member.name}
                </Txt>
                {m.member.verified ? <VerifiedBadge size={14} /> : null}
              </View>
              <Txt variant="caption" color={m.role === 'owner' ? 'gold' : 'textMuted'} numberOfLines={1}>
                {m.role === 'owner' ? 'Started this Circle' : m.member.username ? `@${m.member.username}` : 'Member'}
              </Txt>
            </View>
          </Pressable>
          {isOwner && m.role !== 'owner' ? (
            <Button
              title="Remove"
              size="sm"
              variant="secondary"
              loading={remove.isPending}
              onPress={() =>
                remove.mutate(
                  { circleId, memberId: m.member.id },
                  { onError: (e) => toast({ kind: 'error', title: 'Not removed', message: (e as Error).message }) },
                )
              }
            />
          ) : null}
        </View>
      ))}

      <Button title="Bring somebody in" size="md" variant="secondary" icon="person-add-outline" onPress={() => setAdding(true)} />

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="Bring somebody in">
        <View style={{ gap: space.md }}>
          <Txt variant="small" color="textSecondary">
            You can only bring in members you’ve Clicked with. A Circle holds twelve people.
          </Txt>
          {candidates.length ? (
            candidates.map((m) => (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar uri={m.photos[0]?.url ?? null} name={m.name} size={36} />
                <View style={{ flex: 1, flexShrink: 1 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {m.name}
                  </Txt>
                </View>
                <Button
                  title="Add"
                  size="sm"
                  variant="secondary"
                  loading={add.isPending}
                  onPress={() => {
                    add.mutate(
                      { circleId, memberId: m.id },
                      {
                        onSuccess: () => {
                          setAdding(false);
                        },
                        onError: (e) => toast({ kind: 'error', title: 'Not added', message: (e as Error).message }),
                      },
                    );
                  }}
                />
              </View>
            ))
          ) : (
            <Txt variant="small" color="textMuted">
              Everyone you’ve Clicked with is already here — or you haven’t Clicked with anyone yet.
            </Txt>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}

/* ------------------------------------------------------------------- menu */

function CircleMenu({
  visible, onClose, circleId, name, isOwner, onLeft,
}: {
  visible: boolean;
  onClose: () => void;
  circleId: number;
  name: string;
  isOwner: boolean;
  onLeft: () => void;
}) {
  const toast = useToast();
  const leave = useLeaveCircle();
  const rename = useRenameCircle();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);

  const go = (fn: () => Promise<unknown>, done: string) => {
    void fn()
      .then(() => {
        onClose();
        toast({ kind: 'success', title: done });
        if (done.startsWith('You’ve left')) onLeft();
      })
      .catch((e) => toast({ kind: 'error', title: 'That didn’t work', message: (e as Error).message }));
  };

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title={name}>
        <View style={{ gap: space.sm }}>
          {isOwner ? (
            <Button
              title="Rename Circle"
              variant="secondary"
              size="md"
              icon="create-outline"
              onPress={() => {
                setDraft(name);
                setRenaming(true);
              }}
            />
          ) : null}
          <Button
            title={isOwner ? 'Leave and hand over' : 'Leave this Circle'}
            variant="secondary"
            size="md"
            icon="log-out-outline"
            loading={leave.isPending}
            onPress={() => go(async () => { await leave.mutateAsync(circleId); return true; }, 'You’ve left the Circle')}
          />
          <Txt variant="small" color="textMuted">
            {isOwner
              ? 'The Circle stays open — it passes to whoever has been in it longest.'
              : 'You can be brought back in by anyone still in the Circle.'}
          </Txt>
        </View>
      </BottomSheet>

      <BottomSheet visible={renaming} onClose={() => setRenaming(false)} title="Rename Circle">
        <View style={{ gap: space.md }}>
          <Input label="Name" value={draft} onChangeText={setDraft} maxLength={40} />
          <Button
            title="Save name"
            variant="primary"
            size="md"
            loading={rename.isPending}
            onPress={() =>
              rename.mutate(
                { circleId, name: draft },
                {
                  onSuccess: () => {
                    setRenaming(false);
                    onClose();
                  },
                  onError: (e) => toast({ kind: 'error', title: 'Not renamed', message: (e as Error).message }),
                },
              )
            }
          />
        </View>
      </BottomSheet>
    </>
  );
}
