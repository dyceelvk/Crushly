import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Segmented } from './Segmented';
import { Txt } from './Txt';
import { useToast } from './Toast';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, space } from '../theme/tokens';
import { useEditPost } from '../api/hooks';
import type { Post } from '../api/types';
import { Platform, TextInput } from 'react-native';

/**
 * Rewriting a post you already published.
 *
 * Until now the only thing you could do to your own post was delete it, so a
 * typo, a wrong audience or a sentence you regretted meant losing the post
 * entirely. This edits the words and who can see it, in place — the media is
 * whatever you uploaded, and stays.
 */
export function EditPostSheet({
  post,
  visible,
  onClose,
}: {
  post: Post | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const edit = useEditPost();
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'connections' | 'private'>('everyone');

  // Seed from the post each time the sheet opens, so a cancelled edit does not
  // come back the next time.
  useEffect(() => {
    if (!visible || !post) return;
    setBody(post.body ?? '');
    setAudience(post.audience === 'circle' ? 'connections' : post.audience);
  }, [visible, post]);

  const max = post?.mediaUrl ? 300 : 2000;
  const trimmed = body.trim();
  // A post with no picture has to keep some words; one with a picture may be
  // left with none.
  const empty = !trimmed && !post?.mediaUrl;
  const dirty = !!post && (trimmed !== (post.body ?? '').trim() || (post.circleId == null && audience !== post.audience));

  const save = async () => {
    if (!post || empty || !dirty) return;
    try {
      await edit.mutateAsync({ postId: post.id, body: trimmed, audience: post.circleId == null ? audience : undefined });
      toast({ kind: 'success', title: 'Post updated' });
      onClose();
    } catch (e) {
      toast({ kind: 'error', title: 'Not saved', message: (e as Error).message });
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Edit this post"
      subtitle="The photo or clip stays; the words and who sees it are yours to change."
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title="Save"
              onPress={save}
              disabled={empty || !dirty}
              loading={edit.isPending}
              accessibilityLabel={!dirty ? 'Save, nothing has changed yet' : 'Save this post'}
            />
          </View>
        </View>
      }
    >
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.lg, gap: space.lg }}>
        <View
          style={{
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            paddingHorizontal: 14,
            paddingVertical: 10,
            minHeight: 120,
          }}
        >
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Say something…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={max}
            accessibilityLabel="Your post's words"
            style={[
              {
                minHeight: 100,
                color: colors.text,
                fontFamily: fonts.regular,
                fontSize: 16,
                lineHeight: 23,
                textAlignVertical: 'top',
              },
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : undefined,
            ]}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {empty ? (
            <Txt variant="caption" color="danger">
              A post with no picture needs some words.
            </Txt>
          ) : (
            <View />
          )}
          <Txt variant="caption" color="textMuted">
            {body.length}/{max}
          </Txt>
        </View>

        {post?.circleId == null ? <View>
          <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm }}>
            Who can see it
          </Txt>
          <Segmented<'everyone' | 'connections' | 'private'>
            value={audience}
            onChange={setAudience}
            options={[
              { value: 'everyone', label: 'Public' },
              { value: 'connections', label: 'Connections' },
              { value: 'private', label: 'Private' },
            ]}
          />
          <Txt variant="caption" color="textMuted" style={{ marginTop: 6 }}>
            Private means only you can see this post.
          </Txt>
        </View> : <Txt variant="caption" color="textMuted">The Circle controls who can see this post.</Txt>}
      </View>
    </BottomSheet>
  );
}
