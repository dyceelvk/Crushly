import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Segmented } from '../../components/Segmented';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useCreateVibe } from '../../api/hooks';
import { VideoEditorModal } from '../../components/VideoEditor';
import type { VideoEdit } from '../../lib/videoEdit';
import { emptyEdit } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import { takeTrimResult } from '../common/VideoTrimScreen';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

type Clip = { uri: string; mimeType: string; durationMs: number; sizeBytes: number };

const MAX_SECONDS = 120;
const MAX_BYTES = 25 * 1024 * 1024;

function durationLabel(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Sharing a Vibe.
 *
 * A Vibe is a short clip with a fortnight to live — long enough to say
 * something that is not a mood, short enough that it never becomes a standing
 * record of your face and voice. The composer says that out loud before you
 * post, because the one thing a member must never be able to claim later is
 * that he did not know.
 *
 * The audience defaults to Connections, the same safe default a Moment or a
 * post uses: sharing with everybody is a choice you make, not one we made for
 * you.
 */
export function VibeComposerScreen({ navigation }: ScreenProps<'VibeComposer'>) {
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();
  const create = useCreateVibe();

  const [clip, setClip] = useState<Clip | null>(null);
  const [pendingClip, setPendingClip] = useState<Clip | null>(null);
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'connections' | 'everyone'>('connections');
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [clipEdit, setClipEdit] = useState<VideoEdit | null>(null);

  const player = useVideoPlayer(clip?.uri ?? null, (p) => {
    p.loop = true;
  });

  // When returning from the dedicated trim screen, apply the chosen trim to the
  // clip and its edit. If the user cancelled, clear the pending clip so they can
  // pick again.
  useFocusEffect(
    useCallback(() => {
      const result = takeTrimResult();
      if (result && pendingClip) {
        setClip(pendingClip);
        setPendingClip(null);
        setClipEdit({
          ...emptyEdit(pendingClip.durationMs ? pendingClip.durationMs / 1000 : 0),
          trimStart: result.trimStart,
          trimEnd: result.trimEnd,
        });
      } else if (!result && pendingClip) {
        setPendingClip(null);
      }
    }, [pendingClip])
  );

  const pick = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: MAX_SECONDS,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const sizeBytes = asset.fileSize ?? 0;

      if (asset.duration && asset.duration > MAX_SECONDS * 1000) {
        toast({ kind: 'error', title: 'That clip is too long', message: 'Vibes are short — up to two minutes.' });
        return;
      }
      if (sizeBytes && sizeBytes > MAX_BYTES) {
        toast({ kind: 'error', title: 'That file is too large', message: 'Vibes can be up to 25 MB.' });
        return;
      }

      setPendingClip({
        uri: asset.uri,
        mimeType: asset.mimeType || 'video/mp4',
        durationMs: asset.duration ?? 0,
        sizeBytes,
      });
      navigation.navigate('VideoTrim', {
        sourceUri: asset.uri,
        sourceDuration: (asset.duration ?? 0) / 1000,
        category: 'vibe',
      });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open your clips', message: (e as Error).message });
    }
  };

  const share = async () => {
    if (!clip) return;
    setBusy(true);
    try {
      const prepared = await preparedClip(clipEdit, clip.uri, 'vibe');
      await create.mutateAsync({
        body,
        audience,
        videoUri: prepared.uri ?? clip.uri,
        videoMime: clip.mimeType,
        durationMs: clip.durationMs || null,
        edit: prepared.live,
      });
      toast({ kind: 'success', title: 'Vibe shared', message: 'It stays for two weeks, then it’s gone.' });
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Vibe not shared', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.sm,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
      >
        <IconButton icon="close" label="Cancel" onPress={() => navigation.goBack()} />
        <Txt variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          New Vibe
        </Txt>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.lg,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!clip ? (
          <Pressable
            onPress={pick}
            accessibilityRole="button"
            accessibilityLabel="Choose a video clip"
            style={{
              height: 260,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              borderStyle: 'dashed',
              backgroundColor: colors.card,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <Ionicons name="videocam-outline" size={34} color={colors.gold} />
            <Txt variant="bodyStrong">Choose a clip</Txt>
            <Txt variant="small" color="textSecondary">
              Up to two minutes
            </Txt>
          </Pressable>
        ) : (
          <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
            <VideoView
              player={player}
              style={{ width: '100%', height: 300 }}
              contentFit="contain"
              nativeControls
              accessibilityLabel="Your Vibe"
            />
          </View>
        )}

        {clip ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt variant="caption" color="textSecondary">
              {clip.durationMs ? durationLabel(clip.durationMs) : 'Clip'} · {Math.max(1, Math.round(clip.sizeBytes / 1024 / 1024))} MB
            </Txt>
            {clipEdit ? (
              <Txt variant="caption" color="gold">
                · Edited
              </Txt>
            ) : null}
            <Txt variant="smallStrong" color="gold" onPress={pick} accessibilityRole="button" style={{ marginLeft: 'auto' }}>
              Choose a different clip
            </Txt>
          </View>
        ) : null}

        {clip ? (
          <Button
            title={clipEdit ? 'Edit your clip again' : 'Edit your clip'}
            icon="color-wand-outline"
            variant="secondary"
            onPress={() => setEditorOpen(true)}
            accessibilityLabel="Open the video editor"
          />
        ) : null}

        <Input
          label="Caption"
          value={body}
          onChangeText={setBody}
          placeholder="Say something…"
          multiline
          maxLength={200}
          showCount
          hint="Optional."
        />

        <View>
          <Txt variant="label" color="textSecondary" style={{ marginBottom: 8 }}>
            Who sees it
          </Txt>
          <Segmented<'connections' | 'everyone'>
            options={[
              { value: 'connections', label: 'Connections' },
              { value: 'everyone', label: 'Everyone' },
            ]}
            value={audience}
            onChange={setAudience}
          />
          <Txt variant="small" color="textSecondary" style={{ marginTop: 8 }}>
            {audience === 'everyone'
              ? 'Anybody on Crushly can watch this for two weeks.'
              : 'Only the people you’ve Clicked with can watch this.'}
          </Txt>
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.goldSoft,
          }}
        >
          <Ionicons name="time-outline" size={18} color={colors.gold} />
          <Txt variant="small" style={{ flex: 1 }}>
            Your Vibe lasts two weeks, then it’s deleted — the clip and the row. Somebody who saves a link to it
            won’t be able to open it after that.
          </Txt>
        </View>

        {busy ? (
          <View style={{ alignItems: 'center', paddingVertical: space.lg }}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Txt variant="small" color="textSecondary" style={{ marginTop: 10 }}>
              Uploading your Vibe…
            </Txt>
          </View>
        ) : (
          <Button
            title="Share Vibe"
            icon="sparkles"
            variant="primary"
            disabled={!clip}
            onPress={share}
            accessibilityLabel="Share your Vibe"
          />
        )}
      </ScrollView>

      <VideoEditorModal
        visible={editorOpen}
        sourceUri={clip?.uri ?? null}
        sourceDuration={clip?.durationMs ? clip.durationMs / 1000 : 0}
        category="vibe"
        onCancel={() => setEditorOpen(false)}
        onDone={(r) => {
          setClipEdit(r.edit);
          setEditorOpen(false);
        }}
      />
    </View>
  );
}
