import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Chip, ChipGroup } from '../../components/Chip';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { Input } from '../../components/Input';
import { ThemePicker } from '../../components/ThemePicker';
import { CircleCover } from '../../components/CircleCover';
import { Segmented } from '../../components/Segmented';
import { setCircleAccess, setCircleLook } from '../../api/service';
import { useToast } from '../../components/Toast';
import {
  useCreateCircle,
  useCrushes,
  useDecideCircleRequest,
  useMyCircles,
  useCircleRequests,
  useCircleInvitations,
  useRespondCircleInvitation,
} from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { Avatar } from '../../components/Photo';
import type { CircleJoinPolicy } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Your Circles — the small rooms you belong to.
 *
 * A Circle is up to twelve people with their own posts and their own
 * conversation. It is not a public group and it is not searchable: you are in
 * one because you started it, or because somebody you have Clicked with
 * brought you in.
 */
export function CirclesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const circles = useMyCircles();
  const requests = useCircleRequests();
  const decide = useDecideCircleRequest();
  const invitations = useCircleInvitations();
  const respond = useRespondCircleInvitation();
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const items = circles.data?.items ?? [];
  const asking = requests.data ?? [];
  const invited = invitations.data ?? [];

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
          <RefreshControl refreshing={circles.isRefetching} onRefresh={circles.refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header">
              Circles
            </Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              Small rooms of up to twelve people, with their own posts and chat.
            </Txt>
          </View>
        </View>

        {/* Somebody asked you in. This is the only place an invitation lives,
            because a room you have been invited to is not yet a room of yours. */}
        {invited.length ? (
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Txt variant="title" accessibilityRole="header">
              {invited.length === 1 ? '1 invitation' : `${invited.length} invitations`}
            </Txt>
            {invited.map((i) => (
              <View
                key={i.id}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.primaryLine,
                  padding: space.md,
                  gap: space.sm,
                }}
              >
                <Pressable
                  onPress={() => navigation.navigate('CirclePreview', { circleId: i.circleId })}
                  accessibilityRole="button"
                  accessibilityLabel={`Look at ${i.circleName}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <CircleCover circle={{ name: i.circleName, coverUrl: i.coverUrl, theme: i.theme }} size={42} radius={13} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {i.circleName}
                    </Txt>
                    <Txt variant="caption" color="textMuted" numberOfLines={1}>
                      {i.invitedBy.name} asked you in · {i.memberCount}/12
                    </Txt>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button
                    title="Accept"
                    variant="primary"
                    size="sm"
                    full={false}
                    style={{ flex: 1 }}
                    loading={respond.isPending && respond.variables?.invitationId === i.id && respond.variables?.accept === true}
                    onPress={() =>
                      respond.mutate(
                        { invitationId: i.id, accept: true, circleId: i.circleId },
                        {
                          onSuccess: () => {
                            toast({ kind: 'success', title: `You’re in ${i.circleName}` });
                            navigation.navigate('Circle', { circleId: i.circleId });
                          },
                          onError: (e) => toast({ kind: 'error', title: 'Couldn’t accept', message: (e as Error).message }),
                        },
                      )
                    }
                  />
                  <Button
                    title="Not now"
                    variant="ghost"
                    size="sm"
                    full={false}
                    style={{ flex: 1 }}
                    loading={respond.isPending && respond.variables?.invitationId === i.id && respond.variables?.accept === false}
                    onPress={() =>
                      respond.mutate(
                        { invitationId: i.id, accept: false, circleId: i.circleId },
                        { onError: (e) => toast({ kind: 'error', title: 'Couldn’t answer', message: (e as Error).message }) },
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Only when there is a list to sit above. With no Circles, the empty
            state below already offers this exact button — the same action twice
            on one screen reads as two different actions until you press them. */}
        {items.length ? (
          <Button
            title="Start a Circle"
            variant="primary"
            size="md"
            icon="add"
            style={{ marginTop: space.lg }}
            onPress={() => setCreating(true)}
          />
        ) : null}

        {/* Who is asking. Only owners ever have anything here, so the section
            does not exist for anybody else — no empty heading, no explanation of
            a feature you cannot use. */}
        {asking.length ? (
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Txt variant="title" accessibilityRole="header">
              {asking.length === 1 ? '1 request to join' : `${asking.length} requests to join`}
            </Txt>
            {asking.map((r) => (
              <View
                key={r.id}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.goldLine,
                  padding: space.md,
                  gap: space.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar uri={r.member.photos?.[0]?.url ?? null} name={r.member.name} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {r.member.name}
                    </Txt>
                    <Txt variant="caption" color="textMuted" numberOfLines={1}>
                      wants to join {r.circleName} · {timeAgo(r.createdAt)}
                    </Txt>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button
                    title="Let them in"
                    variant="primary"
                    size="sm"
                    icon="checkmark"
                    loading={decide.isPending && decide.variables?.requestId === r.id && decide.variables?.approve === true}
                    onPress={() =>
                      decide.mutate(
                        { requestId: r.id, approve: true },
                        {
                          onSuccess: () => toast({ kind: 'info', title: `${r.member.name} is in`, message: `They can read ${r.circleName} now.` }),
                          onError: (e) => toast({ kind: 'error', title: 'Couldn’t let them in', message: (e as Error).message }),
                        },
                      )
                    }
                    full={false}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Not this time"
                    variant="ghost"
                    size="sm"
                    loading={decide.isPending && decide.variables?.requestId === r.id && decide.variables?.approve === false}
                    onPress={() =>
                      decide.mutate(
                        { requestId: r.id, approve: false },
                        { onError: (e) => toast({ kind: 'error', title: 'Couldn’t answer that', message: (e as Error).message }) },
                      )
                    }
                    full={false}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          {circles.isLoading ? (
            <LoadingBlock label="Loading your Circles" />
          ) : circles.isError ? (
            <ErrorState error={circles.error} message="Your Circles didn’t load." onRetry={circles.refetch} />
          ) : items.length ? (
            items.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => navigation.navigate('Circle', { circleId: c.id })}
                accessibilityRole="button"
                accessibilityLabel={`Open ${c.name}${c.unreadCount ? `, ${c.unreadCount} new` : ''}`}
                style={{
                  backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.unreadCount ? colors.goldLine : colors.border,
                  padding: space.md,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {/* The theme's cover, not a grey bubble: this list is a row
                      of rooms and they should be recognisable before they are
                      read. */}
                  <CircleCover circle={c} size={44} radius={14} />
                  <View style={{ flex: 1, flexShrink: 1 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {c.name}
                    </Txt>
                    <Txt variant="caption" color="textMuted" numberOfLines={1} style={{ marginTop: 2 }}>
                      {c.about || `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
                    </Txt>
                  </View>
                  {c.unreadCount ? (
                    <View style={{ backgroundColor: colors.gold, borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Txt variant="caption" color="#0A0A0C">
                        {c.unreadCount > 99 ? '99+' : c.unreadCount}
                      </Txt>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.sm }}>
                  <Txt variant="caption" color="textMuted">
                    {c.memberCount}/12
                  </Txt>
                  {c.myRole === 'owner' ? (
                    <Txt variant="caption" color="gold">
                      · You started this
                    </Txt>
                  ) : null}
                  {/* The desk is people-shaped, not settings-shaped: a gear here
                      would mean the app's Settings, which is the one thing a gear
                      is allowed to mean. */}
                  {c.myRole === 'owner' ? (
                    <Pressable
                      onPress={() => navigation.navigate('CircleManage', { circleId: c.id })}
                      accessibilityRole="button"
                      accessibilityLabel={`Manage ${c.name}`}
                      hitSlop={10}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' }}
                    >
                      {c.pendingRequests ? (
                        <View
                          style={{
                            minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
                            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary,
                          }}
                        >
                          <Txt variant="caption" color={colors.onPrimary}>
                            {c.pendingRequests}
                          </Txt>
                        </View>
                      ) : null}
                      <Ionicons name="people-outline" size={15} color={colors.primary} />
                      <Txt variant="caption" color="primary">
                        Manage
                      </Txt>
                    </Pressable>
                  ) : null}
                  {c.lastMessageAt ? (
                    <Txt variant="caption" color="textMuted">
                      · {timeAgo(c.lastMessageAt)}
                    </Txt>
                  ) : null}
                </View>
              </Pressable>
            ))
          ) : (
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="No Circles yet"
              message="A Circle is a small room — up to twelve people you’ve Clicked with — with its own posts and its own chat. Start one, or wait for an invitation."
              action={{ label: 'Start a Circle', onPress: () => setCreating(true) }}
            />
          )}
        </View>
      </ScrollView>

      <CreateCircleSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

/** Starting a room: a name, a line about it, and who to bring in. */
function CreateCircleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const toast = useToast();
  const create = useCreateCircle();
  const crushes = useCrushes();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  // What kind of room it is.
  const [theme, setTheme] = useState<string | null>(null);
  // Two questions, two answers. Whether it can be found, and how people get in.
  const [discoverable, setDiscoverable] = useState(false);
  const [policy, setPolicy] = useState<CircleJoinPolicy>('invite');

  // You can only bring in people you have Clicked with — that is the rule the
  // database enforces, so the picker only offers those.
  const mutual = crushes.data?.mutual ?? [];

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 11 ? prev : [...prev, id]));

  const submit = async () => {
    try {
      const space = await create.mutateAsync({ name, about, memberIds: picked });
      // The look and the two access settings are set straight after, on the
      // Circle that now exists: the create call is the one old builds still
      // make, so it is not the place to add three more parameters.
      if (theme) {
        try {
          await setCircleLook(space.circle.id, { theme, visibility: discoverable ? 'public' : 'connections' });
        } catch {
          // A room without a label is still a room. The owner can set it again
          // from the Circle screen; failing the whole creation over it would be
          // the wrong trade.
        }
      }
      try {
        await setCircleAccess(space.circle.id, { discoverable, joinPolicy: policy });
      } catch {
        // Same trade: a room that exists but has to be re-configured beats no
        // room at all, and the desk says plainly what each setting is.
      }
      setName('');
      setAbout('');
      setPicked([]);
      setTheme(null);
      setDiscoverable(false);
      setPolicy('invite');
      onClose();
      navigation.navigate('Circle', { circleId: space.circle.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Circle not created', message: (e as Error).message });
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Start a Circle">
      <View style={{ gap: space.md }}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Sunday Roast"
          maxLength={40}
          hint="Two to forty characters."
        />
        <Input
          label="What’s it for?"
          value={about}
          onChangeText={setAbout}
          placeholder="The usual suspects, every Sunday."
          maxLength={160}
        />

        <ThemePicker value={theme} onChange={setTheme} />

        {/* Two settings, asked separately, because a room that can be found and
            a room anybody may enter are not the same room. */}
        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Can people find it?
          </Txt>
          <Segmented<'no' | 'yes'>
            options={[
              { value: 'no', label: 'Only people in it' },
              { value: 'yes', label: 'Anyone can find it' },
            ]}
            value={discoverable ? 'yes' : 'no'}
            onChange={(v) => {
              const next = v === 'yes';
              setDiscoverable(next);
              // Nobody can ask to join a room they cannot find, so turning
              // discovery off takes the door with it rather than leaving a
              // setting that means nothing.
              if (!next) setPolicy('invite');
              else if (policy === 'invite') setPolicy('request');
            }}
          />
          <Txt variant="caption" color="textMuted">
            {discoverable
              ? 'It can be recommended in Connections and previewed by anyone. What is posted in it stays for members.'
              : 'It stays off discovery entirely. Nobody outside can find it, preview it, or ask to join.'}
          </Txt>
        </View>

        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            How do people get in?
          </Txt>
          <Segmented<CircleJoinPolicy>
            options={[
              { value: 'request', label: 'Ask me' },
              { value: 'open', label: 'Anyone joins' },
              { value: 'invite', label: 'I invite' },
            ]}
            value={policy}
            onChange={setPolicy}
          />
          <Txt variant="caption" color="textMuted">
            {!discoverable
              ? 'A room nobody can find is stocked by hand, so this is invitations only. Bring people in below, or from the Circle later.'
              : policy === 'request'
                ? 'People ask, and nothing happens until you say yes.'
                : policy === 'open'
                  ? 'People who find it walk straight in. You are told each time somebody joins.'
                  : 'People can find it and look, but only you can bring them in.'}
          </Txt>
        </View>

        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Bring people in ({picked.length}/11)
          </Txt>
          {mutual.length ? (
            <ChipGroup>
              {mutual.map((m) => (
                <Chip
                  key={m.id}
                  label={m.name}
                  selected={picked.includes(m.id)}
                  onPress={() => toggle(m.id)}
                  icon={picked.includes(m.id) ? 'checkmark-circle' : 'person-outline'}
                  size="sm"
                />
              ))}
            </ChipGroup>
          ) : (
            <Txt variant="small" color="textMuted">
              You can only bring in members you’ve Clicked with — you don’t have any yet. You can add people later.
            </Txt>
          )}
        </View>

        <Button title="Create Circle" variant="primary" size="md" onPress={submit} loading={create.isPending} disabled={name.trim().length < 2} />
      </View>
    </BottomSheet>
  );
}
