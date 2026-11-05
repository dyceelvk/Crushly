import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { Avatar } from './Photo';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { mentionSuggest, tagSuggest } from '../api/service';
import type { ActiveToken } from '../lib/mentions';

type MentionHit = { id: number; name: string; username: string; photo: string | null; connected: boolean };
type TagHit = { tag: string; uses: number };

/**
 * The list that opens when you type @ or #.
 *
 * One row per answer, sitting directly above the toolbar: a face and a handle for
 * a person, the hash and how many Flows carry it for a tag. Tapping fills the
 * word in and closes the list; typing more narrows it.
 *
 * The request waits ~200 ms after the last keystroke. Without that pause, typing
 * "ngozi" is five round trips and four of them are wrong by the time they land.
 */
export function Suggestions({
  token,
  onPick,
  quiet = false,
}: {
  token: ActiveToken;
  onPick: (choice: string) => void;
  /**
   * Say nothing when there is nothing to suggest. On the search screen the rows
   * underneath are already the answer, so a "nobody called that" line above them
   * contradicts what the member can see.
   */
  quiet?: boolean;
}) {
  const { colors } = useTheme();
  const [people, setPeople] = useState<MentionHit[] | null>(null);
  const [tags, setTags] = useState<TagHit[] | null>(null);
  const kind = token?.kind;
  const query = token?.query ?? '';

  useEffect(() => {
    if (!kind) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        if (kind === 'mention') {
          const hits = await mentionSuggest(query);
          if (live) setPeople(hits as MentionHit[]);
        } else {
          const hits = await tagSuggest(query);
          if (live) setTags(hits as TagHit[]);
        }
      } catch {
        // A suggestion list that cannot load is not a failure worth a banner:
        // the words still post. The list simply does not appear.
        if (live) (kind === 'mention' ? setPeople([]) : setTags([]));
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, query]);

  if (!kind) return null;

  const rows =
    kind === 'mention'
      ? (people ?? []).map((p) => ({
          key: `u${p.id}`,
          value: p.username,
          label: p.name,
          detail: `@${p.username}${p.connected ? ' · Connected' : ''}`,
          photo: p.photo,
        }))
      : (tags ?? []).map((t) => ({
          key: `t${t.tag}`,
          value: t.tag,
          label: `#${t.tag}`,
          detail: `${t.uses} ${t.uses === 1 ? 'post' : 'posts'}`,
          photo: null as string | null,
        }));

  const loading = kind === 'mention' ? people === null : tags === null;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
      accessibilityLabel={kind === 'mention' ? 'People you can tag' : 'Tags you can use'}
    >
      {loading ? (
        <Txt variant="small" color="textMuted" style={{ padding: space.sm }}>
          {kind === 'mention' ? 'Looking for people…' : 'Looking for tags…'}
        </Txt>
      ) : rows.length === 0 ? (
        quiet ? null : (
        <Txt variant="small" color="textMuted" style={{ padding: space.sm }}>
          {kind === 'mention'
            ? query
              ? `Nobody called “${query}”.`
              : 'Tag somebody once you’ve connected.'
            : query
              ? `No Crushes with #${query} yet. Crush it and you start it.`
              : 'No tags yet. Yours would be the first.'}
        </Txt>
        )
      ) : (
        <ScrollView style={{ maxHeight: 184 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {rows.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => onPick(r.value)}
              accessibilityRole="button"
              accessibilityLabel={`${r.label}, ${r.detail}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.sm,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              {kind === 'mention' ? (
                <Avatar uri={r.photo} name={r.label} size={28} />
              ) : (
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="pricetag-outline" size={14} color={colors.gold} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="smallStrong" numberOfLines={1}>
                  {r.label}
                </Txt>
                <Txt variant="caption" color="textMuted" numberOfLines={1}>
                  {r.detail}
                </Txt>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
