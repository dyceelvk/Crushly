import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../Txt';
import { Button } from '../Button';
import { Avatar } from '../Photo';
import { CircleCover } from '../CircleCover';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { activityLine, joinAction, type JoinActionKind } from '../../lib/circleAccess';
import type { DiscoverCircle } from '../../api/types';

/**
 * A room you are not in, as it appears in the feed.
 *
 * The card is a room and not an advertisement, so it is built out of the same
 * facts a room has: its face, its name, what it is for, who runs it, how many
 * people are in it and what happened in it this week. The one action is the one
 * door — Join, Request to join, or nothing at all — and what that says comes from
 * `joinAction`, which is also what the preview page uses.
 *
 * Tapping anywhere but the button opens the room's preview, because a card that
 * only offers a yes-or-no is a card that hides what it is asking you about.
 */
export function DiscoverCard({
  circle,
  onOpen,
  onJoin,
  busy,
}: {
  circle: DiscoverCircle;
  onOpen: () => void;
  onJoin: (kind: JoinActionKind) => void;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const action = joinAction({ state: circle.state, joinPolicy: circle.joinPolicy, full: circle.memberCount >= circle.capacity });

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Preview ${circle.name}`}
        style={({ pressed }) => ({ padding: space.md, gap: space.sm, opacity: pressed ? 0.9 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <CircleCover circle={{ name: circle.name, coverUrl: circle.coverUrl, theme: circle.theme }} size={46} radius={14} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {circle.name}
              </Txt>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: radius.pill,
                  backgroundColor: colors.primarySoft,
                }}
              >
                <Ionicons
                  name={circle.joinPolicy === 'open' ? 'lock-open-outline' : circle.joinPolicy === 'invite' ? 'mail-outline' : 'hand-left-outline'}
                  size={10}
                  color={colors.primary}
                />
                <Txt variant="caption" color="primary">
                  {circle.joinPolicy === 'open' ? 'Open' : circle.joinPolicy === 'invite' ? 'Invite only' : 'Ask to join'}
                </Txt>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Avatar uri={circle.ownerPhoto} name={circle.ownerName} size={14} />
              <Txt variant="caption" color="textMuted" numberOfLines={1}>
                {circle.ownerName}
                {circle.ownerUsername ? ` · @${circle.ownerUsername}` : ''}
              </Txt>
            </View>
          </View>
        </View>

        {circle.about ? (
          <Txt variant="small" color="textSecondary" numberOfLines={2}>
            {circle.about}
          </Txt>
        ) : null}

        <Txt variant="caption" color="textMuted" numberOfLines={1}>
          {activityLine({
            memberCount: circle.memberCount,
            postsThisWeek: circle.postsThisWeek,
            messagesThisWeek: circle.messagesThisWeek,
            friendsInside: circle.friendsInside,
          })}
        </Txt>
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingBottom: space.md,
        }}
      >
        <Button
          title={action.label}
          variant={action.kind === 'join' || action.kind === 'accept' ? 'primary' : 'secondary'}
          size="sm"
          full={false}
          loading={busy}
          disabled={!action.pressable}
          icon={action.kind === 'join' ? 'enter-outline' : action.kind === 'request' ? 'hand-left-outline' : action.kind === 'accept' ? 'checkmark' : action.kind === 'pending' ? 'time-outline' : undefined}
          onPress={() => onJoin(action.kind)}
          style={{ flex: 1 }}
        />
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Look inside ${circle.name}`}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, height: 34 }}
        >
          <Txt variant="caption" color="textSecondary">
            Look inside
          </Txt>
          <Ionicons name="chevron-forward" size={13} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}
