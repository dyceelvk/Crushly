import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Post } from '../../api/types';
import { Txt } from '../Txt';
import { Input } from '../Input';
import { Button } from '../Button';
import { BottomSheet } from '../BottomSheet';
import { Float } from '../Float';
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
 * The thought lives here: it drifts slowly under "'name' reposted" — a float,
 * not a bounce — and tapping the line (label or thought) lifts the list of
 * everyone who reposted, where each thought sits under its own reposter's
 * name. The thought is a repost thought: not a caption, not a comment.
 *
 * Reposting is the moment to say why: right after your repost lands, the
 * "*what's your thought..." sheet opens once. There is no lingering 💬 on the
 * label — the label stays a label.
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
  const prevReposted = useRef(post.reposted);

  /* Your repost just landed — ask once, softly: "*what's your thought..." */
  useEffect(() => {
    if (post.reposted && !prevReposted.current) {
      setDraft('');
      setThoughtOpen(true);
    }
    prevReposted.current = post.reposted;
  }, [post.reposted]);

  /* A thought set elsewhere (the sheet, another device) rides along. */
  useEffect(() => {
    if (post.repostThought !== undefined) setThought(post.repostThought ?? '');
  }, [post.repostThought]);

  if (!reposter) return null;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setRepostThought(post.id, draft.trim());
      setThought(draft.trim());
      setThoughtOpen(false);
      toast({ kind: 'success', title: 'Thought saved', message: 'It floats under your repost now.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t save that', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={{ paddingHorizontal: space.sm, paddingTop: 7, alignSelf: 'flex-start', maxWidth: '92%' }}>
        <Pressable
          onPress={() => setListOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${reposter.name} reposted. See everyone who reposted this`}
          hitSlop={6}
          style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 22 }}>
            <Ionicons name="repeat-outline" size={13} color={dark ? 'rgba(255,255,255,0.78)' : colors.textMuted} />
            <Txt variant="caption" color={dark ? 'rgba(255,255,255,0.82)' : 'textMuted'} numberOfLines={1}>
              {repostAttribution(reposter.name)}
            </Txt>
          </View>
        </Pressable>

        {/* The thought: slowly floating under the label — tapped, it opens the
            list of everyone who reposted, where the thought sits under the
            reposter's name. */}
        {thought ? (
          <Pressable onPress={() => setListOpen(true)} accessibilityRole="button" accessibilityLabel="Repost thought. See who reposted this" hitSlop={6}>
            <Float distance={3} duration={3600} delay={400}>
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
                  {thought}
                </Txt>
              </View>
            </Float>
          </Pressable>
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
