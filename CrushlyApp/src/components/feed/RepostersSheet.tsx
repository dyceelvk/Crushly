import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { BottomSheet } from '../BottomSheet';
import { Avatar } from '../Photo';
import { Txt } from '../Txt';
import { EmptyState } from '../States';
import { useProfileTap } from '../../lib/useProfileTap';
import { timeAgo } from '../../lib/format';
import { postReposters } from '../../api/service';
import { space } from '../../theme/tokens';
import type { Reposter } from '../../api/types';

/**
 * Who reposted this post — a slide-up list, not a trip to one person's Space.
 *
 * The attribution line used to open the last reposter's profile, which was a
 * dead end when ten people had reposted and a wrong turn when you only wanted
 * to see who. Tapping the line now lifts this sheet from the bottom corner with
 * every name on it; any name opens that person's Space.
 */
export function RepostersSheet({
  postId,
  visible,
  onClose,
}: {
  postId: number;
  visible: boolean;
  onClose: () => void;
}) {
  const openProfile = useProfileTap();
  const [rows, setRows] = useState<Reposter[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setRows(null);
    postReposters(postId)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [visible, postId]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Reposted by">
      {rows === null ? (
        <View style={{ paddingVertical: space.xl, alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState title="No reposts yet" message="When someone reposts this, their name lands here." />
      ) : (
        <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
          {rows.map((r) => (
            <Pressable
              key={r.author.id}
              onPress={() => {
                onClose();
                openProfile(r.author.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${r.author.name}’s Space`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
                paddingHorizontal: space.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Avatar uri={r.author.photos?.[0]?.url ?? null} name={r.author.name} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {r.author.name}
                </Txt>
                {r.thought ? (
                  <Txt variant="caption" color="textSecondary" numberOfLines={2} style={{ fontStyle: 'italic' }}>
                    💬 {r.thought}
                  </Txt>
                ) : null}
                <Txt variant="caption" color="textMuted">
                  {timeAgo(r.at)}
                </Txt>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}
