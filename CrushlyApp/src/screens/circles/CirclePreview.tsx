import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { useProfileTap } from '../../lib/useProfileTap';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Avatar } from '../../components/Photo';
import { CircleCover } from '../../components/CircleCover';
import { ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useCirclePreview, useJoinCircle, useRespondCircleInvitation, useCircleInvitations } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { joinAction, policyLabel } from '../../lib/circleAccess';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList } from '../../navigation/types';

/**
 * A Circle, seen from outside.
 *
 * This is the page a person reaches from a discovery card, and it has one job:
 * let them decide. So it shows the room's identity and its week — its name, what
 * it is for, its face, who runs it, who is in it, and how much happened — and it
 * shows the truth about their standing, including when the truth is "you cannot
 * ask".
 *
 * What it does not show is the room. There is no post body here, no message, no
 * member-only anything, and that is not a gap to be filled later: a Circle is
 * readable by its members, and a preview that leaked a taste to sell the room
 * would be selling somebody else's conversation.
 */
export function CirclePreviewScreen() {
  /* Every picture on this screen opens a Moment when there is one live, and the
     Space otherwise — the same handler every other screen uses. */
  const openProfile = useProfileTap();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CirclePreview'>>();
  const { circleId } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();

  const preview = useCirclePreview(circleId);
  const join = useJoinCircle();
  const invitations = useCircleInvitations();
  const respond = useRespondCircleInvitation();

  const data = preview.data;
  const circle = data?.circle;
  const action = circle
    ? joinAction({ state: data.state, joinPolicy: circle.joinPolicy ?? 'request', full: data.full })
    : null;
  const invitation = (invitations.data ?? []).find((i) => i.circleId === circleId);

  const onJoin = () => {
    if (!circle) return;
    if (action?.kind === 'accept' && invitation) {
      respond.mutate(
        { invitationId: invitation.id, accept: true, circleId },
        {
          onSuccess: () => {
            toast({ kind: 'success', title: `You’re in ${circle.name}`, message: 'The room is open to you now.' });
            navigation.replace('Circle', { circleId });
          },
          onError: (e) => toast({ kind: 'error', title: 'Couldn’t accept', message: (e as Error).message }),
        },
      );
      return;
    }
    join.mutate(circleId, {
      onSuccess: (res) => {
        if (res.state === 'member') {
          toast({ kind: 'success', title: `You’re in ${circle.name}`, message: 'The room is open to you now.' });
        } else {
          toast({ kind: 'info', title: 'Asked to join', message: `${circle.name} will appear in your Circles once the owner says yes.` });
        }
      },
      onError: (e) => toast({ kind: 'error', title: 'Couldn’t join', message: (e as Error).message }),
    });
  };

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
        refreshControl={<RefreshControl refreshing={preview.isRefetching} onRefresh={preview.refetch} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
          <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            Circle
          </Txt>
        </View>

        {preview.isLoading ? (
          <LoadingBlock label="Opening the room" />
        ) : preview.isError ? (
          <ErrorState error={preview.error} message="This Circle didn’t open." onRetry={preview.refetch} />
        ) : !data || !circle ? null : (
          <View style={{ gap: space.lg, marginTop: space.sm }}>
            {/* Identity: the face of the room, its name, and what it is for. */}
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <CircleCover circle={{ name: circle.name, coverUrl: circle.coverUrl, theme: circle.theme }} size={96} radius={28} />
              <Txt variant="display" accessibilityRole="header" style={{ textAlign: 'center' }}>
                {circle.name}
              </Txt>
              {circle.about ? (
                <Txt variant="body" color="textSecondary" style={{ textAlign: 'center' }}>
                  {circle.about}
                </Txt>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
                    backgroundColor: colors.primarySoft,
                  }}
                >
                  <Ionicons name="people-outline" size={11} color={colors.primary} />
                  <Txt variant="caption" color="primary">
                    {circle.memberCount}/{data.circle.capacity}
                  </Txt>
                </View>
                <View
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
                    backgroundColor: colors.elevated,
                  }}
                >
                  <Ionicons name="key-outline" size={11} color={colors.textSecondary} />
                  <Txt variant="caption" color="textSecondary">
                    {policyLabel(circle.joinPolicy ?? 'request')}
                  </Txt>
                </View>
              </View>
            </View>

            {/* Who runs it. A room is a person's room, and the person is a door. */}
            <Pressable
              onPress={() => openProfile(data.owner.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${data.owner.name}’s Space`}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: space.sm,
                backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                borderRadius: radius.lg, padding: space.md,
              }}
            >
              <Avatar uri={data.owner.photos?.[0]?.url ?? null} name={data.owner.name} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {data.owner.name}
                </Txt>
                <Txt variant="caption" color="textMuted" numberOfLines={1}>
                  Started this Circle{data.owner.username ? ` · @${data.owner.username}` : ''}
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>

            {/* The week, in counts. Counts are not contents, which is the line. */}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Stat label="Posts" value={String(data.activity.posts)} sub={`${data.activity.postsThisWeek} this week`} />
              <Stat label="Activity" value={String(data.activity.messagesThisWeek)} sub="messages, 7 days" />
              <Stat label="Crushes" value={String(data.activity.reactionsThisWeek)} sub="reactions, 7 days" />
            </View>

            {/* The people inside, as faces. Nothing about them but the face. */}
            {data.members.length ? (
              <View style={{ gap: space.xs }}>
                <Txt variant="label" color="textSecondary">
                  Who is in
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  {data.members.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => openProfile(m.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${m.name}’s Space`}
                      style={{ alignItems: 'center', width: 62 }}
                    >
                      <Avatar uri={m.photos?.[0]?.url ?? null} name={m.name} size={44} />
                      <Txt variant="caption" color="textMuted" numberOfLines={1} style={{ marginTop: 4, textAlign: 'center' }}>
                        {m.name.split(' ')[0]}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* What a stranger cannot see, said plainly rather than left empty. */}
            <View
              style={{
                flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
                backgroundColor: colors.elevated, borderRadius: radius.lg, padding: space.md,
              }}
            >
              <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} style={{ marginTop: 1 }} />
              <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
                What is posted in {circle.name} and what is said in it belong to the people inside. You will see it when
                you are one of them.
              </Txt>
            </View>

            {data.activity.lastActivityAt ? (
              <Txt variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
                Last activity {timeAgo(data.activity.lastActivityAt)}
              </Txt>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* The one door, pinned where a thumb is. */}
      {circle && action ? (
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space.sm,
            paddingBottom: insets.bottom + space.sm,
            backgroundColor: colors.bg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            gap: 6,
          }}
        >
          <Button
            title={
              action.kind === 'member'
                ? 'Open the Circle'
                : action.label
            }
            variant={action.pressable || action.kind === 'member' ? 'primary' : 'secondary'}
            size="md"
            loading={join.isPending || respond.isPending}
            disabled={!action.pressable && action.kind !== 'member'}
            onPress={() => {
              if (action.kind === 'member') {
                navigation.replace('Circle', { circleId });
                return;
              }
              if (action.pressable) onJoin();
            }}
          />
          {action.hint ? (
            <Txt variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
              {action.hint}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One counted fact about a room. */
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: space.sm,
        gap: 2,
      }}
    >
      <Txt variant="caption" color="textMuted">
        {label}
      </Txt>
      <Txt variant="title">{value}</Txt>
      <Txt variant="caption" color="textMuted" numberOfLines={1}>
        {sub}
      </Txt>
    </View>
  );
}
