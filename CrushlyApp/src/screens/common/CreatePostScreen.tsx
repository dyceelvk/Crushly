import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { useCreatePost } from '../../api/hooks';
import { createPost } from '../../api/service';
import { keys } from '../../api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { VideoEditorModal } from '../../components/VideoEditor';
import type { LiveEdit, VideoEdit } from '../../lib/videoEdit';
import { emptyEdit, splitForUpload } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import { setTrimResult, takeTrimResult, TrimResult } from './VideoTrimScreen';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

type MediaItem = {
  id: string;
  uri: string;
  mimeType: string;
  type: 'photo' | 'video';
  durationMs?: number;
  edit?: VideoEdit | null;
};

type PostType = 'Normal' | 'Story' | 'Moment' | 'Reel';

/**
 * Create Post — unified composer for text, photo, and video posts.
 *
 * Layout follows the design: view at top, editors above tabs, tabs below
 * editors, add-text bar at the bottom. Video goes trim-first (dedicated trim
 * screen right after picking), then the full editor for captions/filters/etc.
 */
export function CreatePostScreen({ navigation }: ScreenProps<'CreatePost'>) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const create = useCreatePost();

  const isTablet = width >= 700;
  const twoCol = width >= 600;

  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'connections'>('everyone');
  const [postType, setPostType] = useState<PostType>('Normal');
  const [scheduleOn, setScheduleOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingMedia, setPendingMedia] = useState<MediaItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);

  const MAX_MEDIA = 10;
  const MAX_BODY = 500;
  const MAX_VIDEO_SECONDS = 60;

  const primaryMedia = media[0];
  const videoMedia = media.find((m) => m.type === 'video');

  // When returning from the dedicated trim screen, apply the chosen trim.
  useFocusEffect(
    useCallback(() => {
      const result = takeTrimResult();
      if (result && pendingMedia) {
        // The trim was cut from the real clip, so the edit must carry its true
        // duration — otherwise clampEdit collapses the trim window to nothing
        // and the full, untrimmed clip is posted. (VibeComposer and
        // MomentComposer do the same thing with pendingClip.durationMs.)
        const sourceDuration = (pendingMedia.durationMs ?? 0) / 1000;
        setMedia((prev) => [
          ...prev,
          {
            ...pendingMedia,
            edit: { ...emptyEdit(sourceDuration), trimStart: result.trimStart, trimEnd: result.trimEnd },
          },
        ]);
        setPendingMedia(null);
      } else if (!result && pendingMedia) {
        setPendingMedia(null);
      }
    }, [pendingMedia])
  );

  const maxBody = postType === 'Moment' ? 280 : MAX_BODY;
  const ready = body.trim().length > 0 || media.length > 0;

  const pickMedia = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: MAX_MEDIA - media.length,
      });
      if (result.canceled || !result.assets?.length) return;

      for (const asset of result.assets) {
        const isVideo = asset.mimeType?.startsWith('video/') ?? false;
        const sizeBytes = asset.fileSize ?? 0;
        const durationMs = asset.duration ?? 0;

        if (isVideo && durationMs > MAX_VIDEO_SECONDS * 1000) {
          toast({ kind: 'error', title: 'That clip is too long', message: 'Posts can carry up to one minute of video.' });
          continue;
        }

        const item: MediaItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          mimeType: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
          type: isVideo ? 'video' : 'photo',
          durationMs,
        };

        // On web, expo-image-picker's blob: URIs can be revoked when the picker
        // closes or when navigating to/from the trim screen. Pin the file by
        // reading it into our own blob URL so it survives until upload.
        if (isVideo && Platform.OS === 'web') {
          try {
            const res = await fetch(asset.uri, { cache: 'no-store' });
            if (res.ok) {
              const blob = await res.blob();
              item.uri = URL.createObjectURL(blob);
            }
          } catch {
            // keep the original URI
          }
        }

        if (isVideo) {
          // Videos go trim-first before anything else.
          setPendingMedia(item);
          navigation.navigate('VideoTrim', {
            sourceUri: asset.uri,
            sourceDuration: durationMs / 1000,
            category: 'post',
          });
          return; // one video at a time through the trim screen
        }

        setMedia((prev) => [...prev, item]);
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t add media', message: (e as Error).message });
    }
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => prev.filter((m) => m.id !== id));
  };

  const openEditor = () => {
    if (!primaryMedia) return;
    setEditingMediaId(primaryMedia.id);
    setEditorOpen(true);
  };

  const post = async () => {
    setBusy(true);
    try {
      const first = primaryMedia;
      let videoUri: string | undefined = undefined;
      let videoMime: string | undefined = undefined;
      let edit: LiveEdit | null = null;

      if (first?.type === 'video') {
        const prepared = await preparedClip(first.edit ?? emptyEdit(0), first.uri, 'post');
        videoUri = prepared.uri ?? first.uri;
        videoMime = first.mimeType;
        edit = prepared.live;
      } else if (first?.type === 'photo') {
        edit = first.edit ? splitForUpload(first.edit, 'post').live : null;
      }

      await createPost({
        body: body.trim(),
        audience,
        photoUri: first?.type === 'photo' ? first.uri : undefined,
        photoMime: first?.type === 'photo' ? first.mimeType : undefined,
        videoUri,
        videoMime,
        edit,
      });

      qc.invalidateQueries({ queryKey: keys.flow });
      qc.invalidateQueries({ queryKey: keys.me });
      toast({ kind: 'success', title: 'Post shared' });
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Post not shared', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const canPost = !busy && ready;

  const headerHeight = 60;
  const rightPanelWidth = 340;

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
        <Txt variant="title" style={{ flex: 1 }} accessibilityRole="header">
          Create Post
        </Txt>
        <Button title="Draft" size="sm" variant="ghost" onPress={() => {}} accessibilityLabel="Save as draft" />
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
        {twoCol ? (
          <View style={{ flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' }}>
            {/* Left column — composer */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <ComposerLeft
                body={body}
                setBody={setBody}
                audience={audience}
                setAudience={setAudience}
                postType={postType}
                setPostType={setPostType}
                scheduleOn={scheduleOn}
                setScheduleOn={setScheduleOn}
                maxBody={maxBody}
                media={media}
                removeMedia={removeMedia}
                pickMedia={pickMedia}
                primaryMedia={primaryMedia}
                openEditor={openEditor}
                editing={editingMediaId === primaryMedia?.id}
              />
            </View>

            {/* Right column — preview + settings */}
            <View style={{ width: rightPanelWidth, minWidth: 0 }}>
              <ComposerRight
                primaryMedia={primaryMedia}
                media={media}
                postType={postType}
                audience={audience}
                body={body}
                maxBody={maxBody}
              />
            </View>
          </View>
        ) : (
          <View style={{ gap: space.lg, minWidth: 0 }}>
            <ComposerLeft
              body={body}
              setBody={setBody}
              audience={audience}
              setAudience={setAudience}
              postType={postType}
              setPostType={setPostType}
              scheduleOn={scheduleOn}
              setScheduleOn={setScheduleOn}
              maxBody={maxBody}
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
              editing={editingMediaId === primaryMedia?.id}
            />
            <ComposerRight
              primaryMedia={primaryMedia}
              media={media}
              postType={postType}
              audience={audience}
              body={body}
              maxBody={maxBody}
            />
          </View>
        )}

        {busy ? (
          <View style={{ alignItems: 'center', paddingVertical: space.lg }}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Txt variant="small" color="textSecondary" style={{ marginTop: 10 }}>
              Sharing your post…
            </Txt>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: gutter }}>
            <Button title="Reset" size="sm" variant="ghost" onPress={() => {}} accessibilityLabel="Reset post" />
            <Button
              title="Post"
              icon="paper-plane"
              variant="primary"
              disabled={!canPost}
              loading={busy}
              onPress={post}
              accessibilityLabel="Publish your post"
            />
          </View>
        )}
      </ScrollView>

      <VideoEditorModal
        visible={editorOpen}
        sourceUri={primaryMedia?.uri ?? null}
        sourceDuration={primaryMedia?.durationMs ? primaryMedia.durationMs / 1000 : 0}
        category="post"
        onCancel={() => setEditorOpen(false)}
        onDone={(r) => {
          setMedia((prev) =>
            prev.map((m) => (m.id === editingMediaId ? { ...m, edit: r.edit } : m))
          );
          setEditorOpen(false);
          setEditingMediaId(null);
        }}
      />
    </View>
  );
}

/** Left column: text input, media grid, post settings. */
function ComposerLeft({
  body,
  setBody,
  audience,
  setAudience,
  postType,
  setPostType,
  scheduleOn,
  setScheduleOn,
  maxBody,
  media,
  removeMedia,
  pickMedia,
  primaryMedia,
  openEditor,
  editing,
}: {
  body: string;
  setBody: (v: string) => void;
  audience: 'everyone' | 'connections';
  setAudience: (v: 'everyone' | 'connections') => void;
  postType: 'Normal' | 'Story' | 'Moment' | 'Reel';
  setPostType: (v: 'Normal' | 'Story' | 'Moment' | 'Reel') => void;
  scheduleOn: boolean;
  setScheduleOn: (v: boolean) => void;
  maxBody: number;
  media: MediaItem[];
  removeMedia: (id: string) => void;
  pickMedia: () => void;
  primaryMedia: MediaItem | undefined;
  openEditor: () => void;
  editing: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      <View style={{ gap: space.sm }}>
        <Txt variant="label" color="textSecondary">
          What’s on your mind?
        </Txt>
        <Input
          multiline
          value={body}
          onChangeText={setBody}
          placeholder="Good energy, better days. Same me, just more focused."
          maxLength={500}
          showCount
          style={{ minHeight: 150 }}
        />
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
          <Pressable onPress={() => {}} accessibilityLabel="Text formatting" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="text-outline" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => {}} accessibilityLabel="Add link" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="link-outline" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => {}} accessibilityLabel="Add emoji" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="happy-outline" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => {}} accessibilityLabel="Add hashtag" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="add-outline" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Add Media */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="label" color="textSecondary">Add Media</Txt>
          <Txt variant="caption" color="textMuted">
            Photos, videos or multiple files
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {media.map((m) => (
            <View key={m.id} style={{ position: 'relative', width: 88, height: 88, borderRadius: 16, overflow: 'hidden' }}>
              {m.type === 'video' ? (
                <View style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
                  <Ionicons name="videocam-outline" size={24} color="#666" style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -12 }, { translateY: -12 }] }} />
                </View>
              ) : (
                <View style={{ width: '100%', height: '100%', backgroundColor: colors.card }} />
              )}
              <Pressable onPress={() => removeMedia(m.id)} accessibilityLabel="Remove media" hitSlop={8} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close-outline" size={16} color="#fff" />
              </Pressable>
              {m.type === 'video' && (
                <Pressable onPress={openEditor} accessibilityLabel="Edit video" hitSlop={8} style={{ position: 'absolute', bottom: 4, left: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="color-wand-outline" size={14} color="#fff" />
                </Pressable>
              )}
            </View>
          ))}
          {media.length < 10 && (
            <Pressable onPress={pickMedia} accessibilityLabel="Add media" hitSlop={12} style={{ width: 88, height: 88, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={24} color={colors.gold} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Location */}
      <SettingsRow label="Location" hint="Add a location (optional)" icon="location-outline" />

      {/* Audience */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="label" color="textSecondary">Audience</Txt>
          <Txt variant="caption" color="textMuted">{audience === 'everyone' ? 'Everyone / Public' : 'Connections'}</Txt>
        </View>
        <Segmented<'everyone' | 'connections'>
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'connections', label: 'Connections' },
          ]}
          value={audience}
          onChange={setAudience}
        />
      </View>

      {/* Tag people */}
      <SettingsRow label="Tag people" hint="Mention friends or creators" icon="person-outline" />

      {/* Post type */}
      <View style={{ gap: space.sm }}>
        <Txt variant="label" color="textSecondary">Post type</Txt>
        <Segmented<'Normal' | 'Story' | 'Moment' | 'Reel'>
          options={[
            { value: 'Normal', label: 'Normal' },
            { value: 'Story', label: 'Story' },
            { value: 'Moment', label: 'Moment' },
            { value: 'Reel', label: 'Reel' },
          ]}
          value={postType}
          onChange={setPostType}
        />
      </View>

      {/* Advanced options */}
      <SettingsRow label="Advanced options" hint="Allow comments, remix, etc." icon="settings-outline" />

      {/* Schedule post */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Txt variant="label" color="textSecondary">Schedule post</Txt>
          <Txt variant="caption" color="textMuted">Post later (optional)</Txt>
        </View>
        <Pressable onPress={() => setScheduleOn(!scheduleOn)} accessibilityRole="switch" accessibilityState={{ checked: scheduleOn }} hitSlop={12} style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: scheduleOn ? colors.primary : colors.elevated, alignItems: scheduleOn ? 'flex-end' : 'flex-start', justifyContent: 'center', paddingHorizontal: 4 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', marginHorizontal: 3 }} />
        </Pressable>
      </View>

      <Button title="Reset" size="sm" variant="ghost" onPress={() => {}} accessibilityLabel="Reset post" />
    </View>
  );
}

/** Right column: media preview, settings panel, post preview. */
function ComposerRight({
  primaryMedia,
  media,
  postType,
  audience,
  body,
  maxBody,
}: {
  primaryMedia: MediaItem | undefined;
  media: MediaItem[];
  postType: 'Normal' | 'Story' | 'Moment' | 'Reel';
  audience: 'everyone' | 'connections';
  body: string;
  maxBody: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Media preview */}
      {primaryMedia ? (
        <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', aspectRatio: primaryMedia.type === 'video' ? 9 / 16 : 1 }}>
          {primaryMedia.type === 'video' ? (
            <View style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
              <Ionicons name="videocam-outline" size={32} color="#666" style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -16 }, { translateY: -16 }] }} />
              <Pressable onPress={() => {}} accessibilityLabel="Edit media" hitSlop={12} style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="color-wand-outline" size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={() => {}} accessibilityLabel="Close preview" hitSlop={12} style={{ position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close-outline" size={16} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View style={{ width: '100%', height: '100%', backgroundColor: colors.card }} />
          )}
        </View>
      ) : null}

      {/* Media Settings */}
      <Card title="Media Settings">
        <SettingsRow label="Crop" hint="Change the frame" icon="crop-outline" />
        <SettingsRow label="Filter" hint="Apply a look" icon="color-wand-outline" />
        <SettingsRow label="Adjust" hint="Light and colour" icon="sunny-outline" />
        <SettingsRow label="Draw" hint="Draw on the media" icon="create-outline" />
        <SettingsRow label="Text" hint="Add captions" icon="text-outline" />
        <SettingsRow label="Stickers" hint="Add stickers" icon="happy-outline" />
      </Card>

      {/* Post Preview */}
      <Card title="Post Preview">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card }} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong" style={{ color: '#fff' }} numberOfLines={1}>
              Crushly
            </Txt>
            <Txt variant="caption" color="textMuted" style={{ marginTop: 1 }}>
              Just now
            </Txt>
          </View>
        </View>
        <View style={{ marginTop: 10, gap: 6 }}>
          {body ? (
            <Txt variant="body" style={{ color: '#fff' }} numberOfLines={3}>
              {body}
            </Txt>
          ) : null}
          {media.length > 0 && (
            <View style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', aspectRatio: 1 }}>
              <View style={{ width: '100%', height: '100%', backgroundColor: colors.card }} />
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
          <Pressable accessibilityLabel="Like" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="heart-outline" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <Pressable accessibilityLabel="Comment" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="chatbubble-outline" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <Pressable accessibilityLabel="Share" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="share-social-outline" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityLabel="More" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="ellipsis-vertical-outline" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

/** Reusable setting row with chevron. */
function SettingsRow({ label, hint, icon }: { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={12}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name={icon} size={20} color={colors.textMuted} />
        <View style={{ gap: 2 }}>
          <Txt variant="bodyStrong" style={{ color: '#fff' }} numberOfLines={1}>
            {label}
          </Txt>
          <Txt variant="caption" color="textMuted">
            {hint}
          </Txt>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.5)" />
    </Pressable>
  );
}

/** Card section wrapper. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: space.sm }}>
      <View style={{ padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Txt variant="label" color="textSecondary">
          {title}
        </Txt>
      </View>
      <View style={{ padding: space.md }}>{children}</View>
    </View>
  );
}
