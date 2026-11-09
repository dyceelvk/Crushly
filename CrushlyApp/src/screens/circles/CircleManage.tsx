import { useSwipeTabs } from '../../components/SwipeTabs';
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Avatar } from '../../components/Photo';
import { BottomSheet } from '../../components/BottomSheet';
import { Segmented } from '../../components/Segmented';
import { ErrorState, LoadingBlock, EmptyState } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import {
  useCircleManage,
  useCircleInviteCandidates,
  useDecideCircleRequest,
  useInviteToCircle,
  useRemoveCircleMember,
  useSetCircleAccess,
} from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { policyLabel } from '../../lib/circleAccess';
import { timeAgo } from '../../lib/format';
import type { CircleJoinPolicy } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';

type Tab = 'members' | 'requests' | 'invited' | 'declined';

/**
 * The owner's desk.
 *
 * Four lists and two switches, because those are the two jobs: deciding who is
 * in the room, and deciding what kind of room it is. Everything here is the
 * owner's — the functions behind it refuse anybody else, so this screen is a
 * view of a permission rather than the permission itself.
 *
 * The two switches are deliberately separate, and the screen says so. Whether a
 * room can be *found* and whether a person can *get in* are different questions,
 * and the commonest mistake in a community product is fusing them: a room that
 * is findable but needs approval, and a room that is hidden and stocked by hand,
 * are both legitimate and used to be impossible to tell apart.
 */
export function CircleManageScreen() {
  /* Every picture on this screen opens a Moment when there is one live, and the
     Space otherwise — the same handler every other screen uses. */
  const openProfile = useProfileTap();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CircleManage'>>();
  const { circleId, tab: openOn } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();

  const manage = useCircleManage(circleId);
  const decide = useDecideCircleRequest();
  const remove = useRemoveCircleMember();
  const access = useSetCircleAccess();
  const invite = useInviteToCircle();

  /* A notification about a request opens on Requests: the work, not the roster. */
  const [tab, setTab] = useState<Tab>(openOn ?? 'members');
  const swipe = useSwipeTabs({ options: ['members', 'requests', 'invited', 'declined'] as Tab[], value: tab, onChange: setTab, width: contentWidth });
  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState('');
  /** People invited since this sheet opened, so the row flips at once. */
  const [justInvited, setJustInvited] = useState<Set<number>>(new Set());
  const candidates = useCircleInviteCandidates(inviting ? circleId : null, query);

  const data = manage.data;
  const circle = data?.circle;
  const requests = data?.requests ?? [];
  const invitations = data?.invitations ?? [];
  const declined = data?.declined ?? [];
  const members = data?.members ?? [];

  const discoverable = circle?.discoverable ?? false;
  const policy: CircleJoinPolicy = circle?.joinPolicy ?? 'request';

  /**
   * Turning discovery off takes the door with it.
   *
   * A room nobody can find cannot be asked into — so a private room is set to
   * invitations at the same moment it stops being findable, rather than being
   * left in a state that means nothing.
   */
  const setDiscoverable = (next: boolean) => {
    access.mutate(
      { circleId, discoverable: next, joinPolicy: next ? (policy === 'invite' ? 'request' : policy) : 'invite' },
      {
        onSuccess: () =>
          toast({
            kind: 'info',
            title: next ? 'Anyone can find it' : 'Only people you add',
            message: next ? 'It can be recommended in Connections.' : 'It is off discovery, and takes invitations only.',
          }),
        onError: (e) => toast({ kind: 'error', title: 'Couldn’t change that', message: (e as Error).message }),
      },
    );
  };

  const setPolicy = (next: CircleJoinPolicy) => {
    access.mutate(
      { circleId, discoverable, joinPolicy: next },
      {
        onSuccess: () => toast({ kind: 'info', title: policyLabel(next) }),
        onError: (e) => toast({ kind: 'error', title: 'Couldn’t change that', message: (e as Error).message }),
      },
    );
  };

  return (
    <View {...swipe.panHandlers} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={<RefreshControl refreshing={manage.isRefetching} onRefresh={manage.refetch} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header" numberOfLines={1}>
              {circle?.name ?? 'Manage'}
            </Txt>
            <Txt variant="small" color="textSecondary">
              Who is in, who is asking, and how people get in.
            </Txt>
          </View>
        </View>

        {manage.isLoading ? (
          <LoadingBlock label="Loading the room" />
        ) : manage.isError ? (
          <ErrorState error={manage.error} message="This Circle’s settings didn’t load." onRetry={manage.refetch} />
        ) : !data || !circle ? null : (
          <View style={{ gap: space.lg, marginTop: space.md }}>
            {/* ---------------------------------------------------- settings */}
            <View style={{ gap: space.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md }}>
              <View style={{ gap: 6 }}>
                <Txt variant="label" color="textSecondary">
                  Can people find it?
                </Txt>
                <Segmented<'yes' | 'no'>
                  options={[
                    { value: 'yes', label: 'Anyone can find it' },
                    { value: 'no', label: 'Only people in it' },
                  ]}
                  value={discoverable ? 'yes' : 'no'}
                  onChange={(v) => setDiscoverable(v === 'yes')}
                />
                <Txt variant="caption" color="textMuted">
                  {discoverable
                    ? 'It can be recommended in Connections, and anyone can read its preview — never its posts.'
                    : 'It stays off discovery entirely. Nobody outside can find it, preview it, or ask to join.'}
                </Txt>
              </View>

              <View style={{ gap: 6 }}>
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
                    ? 'A room nobody can find is stocked by hand, so this is invitations only.'
                    : policy === 'request'
                      ? 'People ask, and nothing happens until you say yes. A pending request is not a member.'
                      : policy === 'open'
                        ? 'People who find it walk straight in. You are told each time somebody joins.'
                        : 'People can find it and look, but only you can bring them in.'}
                </Txt>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                <Txt variant="caption" color="textMuted">
                  {members.length}/{circle.capacity} people · {requests.length} asking · {invitations.length} invited
                </Txt>
              </View>
            </View>

            {/* ------------------------------------------------------- lists */}
            <Segmented<Tab>
              options={[
                { value: 'members', label: 'Members', count: members.length },
                { value: 'requests', label: 'Requests', count: requests.length },
                { value: 'invited', label: 'Invited', count: invitations.length },
                { value: 'declined', label: 'Declined', count: declined.length },
              ]}
              value={tab}
              onChange={setTab}
            />

            {tab === 'members' ? (
              <View style={{ gap: space.sm }}>
                {members.map((m) => (
                  <View
                    key={m.member.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: space.sm,
                      backgroundColor: colors.card, borderRadius: radius.lg,
                      borderWidth: 1, borderColor: colors.border, padding: space.sm,
                    }}
                  >
                    <Avatar uri={m.member.photos?.[0]?.url ?? null} name={m.member.name} size={38} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {m.member.name}
                      </Txt>
                      <Txt variant="caption" color="textMuted" numberOfLines={1}>
                        {m.role === 'owner' ? 'Started this Circle' : `Joined ${timeAgo(m.joinedAt)}`}
                      </Txt>
                    </View>
                    {m.role === 'owner' ? null : (
                      <Pressable
                        onPress={() =>
                          remove.mutate(
                            { circleId, memberId: m.member.id },
                            {
                              onSuccess: () => toast({ kind: 'info', title: `${m.member.name} is out` }),
                              onError: (e) => toast({ kind: 'error', title: 'Couldn’t remove them', message: (e as Error).message }),
                            },
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${m.member.name}`}
                        hitSlop={8}
                        style={{ padding: 6 }}
                      >
                        <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                      </Pressable>
                    )}
                  </View>
                ))}
                <Button
                  title="Invite somebody"
                  variant="secondary"
                  size="md"
                  icon="person-add-outline"
                  onPress={() => setInviting(true)}
                />
              </View>
            ) : null}

            {tab === 'requests' ? (
              requests.length ? (
                <View style={{ gap: space.sm }}>
                  {requests.map((r) => (
                    <View
                      key={r.id}
                      style={{
                        gap: space.sm, backgroundColor: colors.card, borderRadius: radius.lg,
                        borderWidth: 1, borderColor: colors.primaryLine, padding: space.md,
                      }}
                    >
                      <Pressable
                        onPress={() => openProfile(r.member.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${r.member.name}’s Space`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                      >
                        <Avatar uri={r.member.photos?.[0]?.url ?? null} name={r.member.name} size={42} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt variant="bodyStrong" numberOfLines={1}>
                            {r.member.name}
                          </Txt>
                          <Txt variant="caption" color="textMuted" numberOfLines={1}>
                            {r.member.username ? `@${r.member.username} · ` : ''}asked {timeAgo(r.requestedAt)}
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
                          loading={decide.isPending && decide.variables?.requestId === r.id && decide.variables?.approve === true}
                          onPress={() =>
                            decide.mutate(
                              { requestId: r.id, approve: true, circleId },
                              {
                                onSuccess: () => toast({ kind: 'success', title: `${r.member.name} is in` }),
                                onError: (e) => toast({ kind: 'error', title: 'Couldn’t accept', message: (e as Error).message }),
                              },
                            )
                          }
                        />
                        <Button
                          title="Decline"
                          variant="ghost"
                          size="sm"
                          full={false}
                          style={{ flex: 1 }}
                          loading={decide.isPending && decide.variables?.requestId === r.id && decide.variables?.approve === false}
                          onPress={() =>
                            decide.mutate(
                              { requestId: r.id, approve: false, circleId },
                              {
                                onSuccess: () => toast({ kind: 'info', title: 'Declined', message: `${r.member.name} stays outside.` }),
                                onError: (e) => toast({ kind: 'error', title: 'Couldn’t decline', message: (e as Error).message }),
                              },
                            )
                          }
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState icon="checkmark-done-outline" title="Nobody is asking" message="Requests to join land here, with the person’s profile and the date they asked." />
              )
            ) : null}

            {tab === 'invited' ? (
              invitations.length ? (
                <View style={{ gap: space.sm }}>
                  {invitations.map((i) => (
                    <View
                      key={i.id}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: space.sm,
                        backgroundColor: colors.card, borderRadius: radius.lg,
                        borderWidth: 1, borderColor: colors.border, padding: space.md,
                      }}
                    >
                      <Avatar uri={i.member.photos?.[0]?.url ?? null} name={i.member.name} size={38} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {i.member.name}
                        </Txt>
                        <Txt variant="caption" color="textMuted">
                          Invited {timeAgo(i.createdAt)} · waiting on them
                        </Txt>
                      </View>
                      <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState icon="mail-outline" title="No open invitations" message="An invitation becomes a membership when they accept it, not when you send it." />
              )
            ) : null}

            {tab === 'declined' ? (
              declined.length ? (
                <View style={{ gap: space.sm }}>
                  {declined.map((d) => (
                    <View
                      key={d.id}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: space.sm,
                        backgroundColor: colors.card, borderRadius: radius.lg,
                        borderWidth: 1, borderColor: colors.border, padding: space.md,
                      }}
                    >
                      <Avatar uri={d.member.photos?.[0]?.url ?? null} name={d.member.name} size={38} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {d.member.name}
                        </Txt>
                        <Txt variant="caption" color="textMuted">
                          Declined {d.decidedAt ? timeAgo(d.decidedAt) : 'earlier'} · asked {timeAgo(d.requestedAt)}
                        </Txt>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState icon="shield-checkmark-outline" title="Nobody declined" message="A record of the people you turned away stays here, so the same ask is never a surprise." />
              )
            ) : null}
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={inviting} onClose={() => setInviting(false)} title="Invite somebody in">
        <View style={{ gap: space.md }}>
          <Input label="Search" value={query} onChangeText={setQuery} placeholder="Name or username" />
          <Txt variant="caption" color="textMuted">
            Your Connections come first. A room holds twelve people, and an invitation becomes a membership when they
            accept it.
          </Txt>
          {(candidates.data ?? []).length ? (
            (candidates.data ?? []).map((c) => (
              <View key={c.member.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Avatar uri={c.member.photos?.[0]?.url ?? null} name={c.member.name} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {c.member.name}
                  </Txt>
                  <Txt variant="caption" color="textMuted" numberOfLines={1}>
                    {c.connected ? 'You’ve clicked with them' : c.member.username ? `@${c.member.username}` : 'On Holup'}
                  </Txt>
                </View>
                <Button
                  /*
                   * Invite is a thing you do once. Until the list comes back
                   * from the server saying so, the row remembers the tap — the
                   * alternative is a button that looks untouched for a second
                   * and invites the same person twice.
                   */
                  title={c.invited || justInvited.has(c.member.id) ? 'Invited' : 'Invite'}
                  variant={c.invited || justInvited.has(c.member.id) ? 'secondary' : 'primary'}
                  size="sm"
                  full={false}
                  disabled={c.invited || justInvited.has(c.member.id)}
                  loading={invite.isPending && invite.variables?.memberId === c.member.id}
                  onPress={() => {
                    const memberId = c.member.id;
                    setJustInvited((prev) => new Set(prev).add(memberId));
                    invite.mutate(
                      { circleId, memberId },
                      {
                        onSuccess: (res) =>
                          toast({
                            kind: 'success',
                            title: res.state === 'member' ? `${c.member.name} is in` : 'Invitation sent',
                            message: res.state === 'member' ? 'They had already asked.' : 'They can accept it from their Circles.',
                          }),
                        // The list is the truth: if the invitation did not land,
                        // the row goes back to Invite instead of lying about it.
                        onError: (e) => {
                          setJustInvited((prev) => {
                            const next = new Set(prev);
                            next.delete(memberId);
                            return next;
                          });
                          toast({ kind: 'error', title: 'Couldn’t invite them', message: (e as Error).message });
                        },
                      },
                    );
                  }}
                />
              </View>
            ))
          ) : (
            <Txt variant="small" color="textMuted">
              Nobody to show. People only appear here if they are on Holup and have discovery turned on.
            </Txt>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}
