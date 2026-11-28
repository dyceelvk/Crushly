import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Post } from '../../api/types';
import { Txt } from '../Txt';
import { Input } from '../Input';
import { Button } from '../Button';
import { BottomSheet } from '../BottomSheet';
import { useToast } from '../Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { repostAttribution } from '../../lib/repost';
import { setRepostThought } from '../../api/service';
import { RepostersSheet } from './RepostersSheet';

/**
 * The distribution label sits above the canonical post header. It names the
 * reposter without changing the post's author, timestamp or ownership.
 *
 * Now with the thought: tapping the line lifts the list of everyone who
 * reposted, and the 💬 is where a reposter says *why* — "*what's your
 * thought...". The thought is not a caption and not a comment: it rides in the
 * repost itself, under the label, as a repost thought, and everyone who can
 * see the repost can see it.
 */
export function RepostAttribution({
  post,
  dark = false,
  onOpen,
}: {
  post: Pick<Post, 'id' | 'repostedBy' | 'repostThought' | 'reposted'>;
  dark?: boolean;
  /** Legacy: ignored. The sheet is the answer now. */
  onOpen?: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [listOpen, setListOpen] = useState(false);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [thought, setThought] = useState(post.repostThought ?? '');
  const [draft, setDraft] = useState(post.repostThought ?? '');
  const [saving, setSaving] = useState(false);
  const reposter = post.repostedBy;
  if (!reposter) return null;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setRepostThought(post.id, draft.trim());
      setThought(draft.trim());
      setThoughtOpen(false);
      toast({ kind: 'success', title: 'Thought saved', message: 'It rides under your repost now.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t save that', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={{ paddingHorizontal: space.sm, paddingTop: 7, alignSelf: 'flex-start', maxWidth: '92%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 22 }}>
          <Ionicons name="repeat-outline" size={13} color={dark ? 'rgba(255,255,255,0.78)' : colors.textMuted} />
          <Pressable
            onPress={() => setListOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${reposter.name} reposted. See everyone who reposted this`}
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
          >
            <Txt variant="caption" color={dark ? 'rgba(255,255,255,0.82)' : 'textMuted'} numberOfLines={1}>
              {repostAttribution(reposter.name)}
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => {
              setDraft(thought);
              setThoughtOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={thought ? 'Read or edit the repost thought' : 'Add your thought to this repost'}
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
          >
            <Ionicons name="chatbubble-outline" size={12} color={dark ? 'rgba(255,255,255,0.85)' : colors.textMuted} />
          </Pressable>
        </View>

        {/* The thought — a repost thought, not a caption. */}
        {thought ? (
          <View
            style={{
              marginTop: 5,
              marginLeft: 16,
              alignSelf: 'flex-start',
              maxWidth: '96%',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 12,
              borderTopLeftRadius: 4,
              backgroundColor: dark ? 'rgba(255,255,255,0.10)' : colors.elevated,
              borderWidth: 1,
              borderColor: dark ? 'rgba(255,255,255,0.16)' : colors.border,
            }}
          >
            <Txt variant="caption" color={dark ? 'rgba(255,255,255,0.92)' : 'textSecondary'} style={{ fontStyle: 'italic' }}>
              💬 {thought}
            </Txt>
          </View>
        ) : null}
      </View>

      <RepostersSheet postId={post.id} visible={listOpen} onClose={() => setListOpen(false)} />

      <BottomSheet visible={thoughtOpen} onClose={() => setThoughtOpen(false)} title="Repost thought">
        <View style={{ paddingBottom: space.md, gap: space.sm }}>
          {post.reposted ? (
            <>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder="*what's your thought..."
                multiline
                maxLength={240}
                showCount
                autoFocus
              />
              <Button
                title={saving ? 'Saving…' : 'Save thought'}
                loading={saving}
                onPress={() => {
                  void save();
                }}
              />
            </>
          ) : (
            <Txt variant="body" color="textSecondary">
              {thought || 'No thought on this repost yet.'}
            </Txt>
          )}
        </View>
      </BottomSheet>
    </>
  );
}
