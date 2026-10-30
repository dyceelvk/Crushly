import { pickerDurationMs, pickerImageMime } from '../../lib/upload';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { EditedClip } from '../../components/EditedClip';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Segmented } from '../../components/Segmented';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { createPost } from '../../api/service';
import { keys } from '../../api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { VideoEditorModal } from '../../components/VideoEditor';
import type { LiveEdit, VideoEdit } from '../../lib/videoEdit';
import { emptyEdit, splitForUpload } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import { takeTrimResult } from './VideoTrimScreen';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

type MediaItem = {
  id: string;
  uri: string;
  mimeType: string;
  type: 'photo' | 'video';
  durationMs?: number;
  edit?: VideoEdit | null;
};

/** One ceiling, stated once — the database truncates at the same 500. */
const MAX_BODY = 500;

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

  const twoCol = width >= 600;

  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'connections'>('everyone');
  const [busy, setBusy] = useState(false);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingMedia, setPendingMedia] = useState<MediaItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [editorTool, setEditorTool] = useState<'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null>(null);
  const [fontIndex, setFontIndex] = useState(0);
  const [locating, setLocating] = useState(false);

  const FONT_OPTIONS = [
    fonts.regular,
    fonts.medium,
    fonts.semibold,
    fonts.bold,
    fonts.display,
    fonts.displayItalic,
  ] as const;

  const MAX_MEDIA = 10;
  const MAX_VIDEO_SECONDS = 60;


  const primaryMedia = media[0];

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

  const ready = body.trim().length > 0 || media.length > 0;

  /**
   * Ask the device for the current place and append it to the post.
   *
   * The composer has no location column to write to, so the place becomes part
   * of the post's words — which is also what everybody already reads. The
   * permission prompt appears on tap, never at launch: a location request
   * before someone has done anything is the kind of thing that gets an app
   * deleted.
   */
  const addLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast({
          kind: 'error',
          title: 'Location is off',
          message: 'Allow location for Crushly in Settings to add a place.',
        });
        return;
      }
      const at = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync({
        latitude: at.coords.latitude,
        longitude: at.coords.longitude,
      });
      const label = [place?.city, place?.region].filter(Boolean).join(', ') || place?.country || null;
      if (!label) {
        toast({ kind: 'error', title: 'No place found', message: 'Try again in a moment.' });
        return;
      }
      setBody((prev) => {
        const line = `📍 ${label}`;
        return prev.includes(line) ? prev : prev.trim() ? `${prev.trim()}\n\n${line}` : line;
      });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not get your place', message: (e as Error).message });
    } finally {
      setLocating(false);
    }
  };

  const pickMedia = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        quality: 0.8,
        // `posts` stores a single media_url, so this offers a single file.
        // It used to allow ten and quietly post the first — see the note in
        // post() for what that cost.
        allowsMultipleSelection: false,
        selectionLimit: 1,
      });
      if (result.canceled || !result.assets?.length) return;

      for (const asset of result.assets) {
        const isVideo = asset.type === 'video' || (asset.mimeType?.startsWith('video/') ?? false);
        const sizeBytes = asset.fileSize ?? 0;
        const durationMs = pickerDurationMs(asset.duration, Platform.OS === 'web');

        if (isVideo && durationMs > MAX_VIDEO_SECONDS * 1000) {
          toast({ kind: 'error', title: 'That clip is too long', message: 'Posts can carry up to one minute of video.' });
          continue;
        }

        const item: MediaItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          mimeType: isVideo ? (asset.mimeType || 'video/mp4') : pickerImageMime(asset.mimeType, asset.fileName || asset.uri),
          type: isVideo ? 'video' : 'photo',
          durationMs,
        };

        // HEIC/HEIF and other unsupported stills are converted, not relabelled.
        if (!isVideo && !['image/jpeg', 'image/png', 'image/webp'].includes(item.mimeType.toLowerCase())) {
          try {
            const converted = await manipulateAsync(item.uri, [], { format: SaveFormat.JPEG, compress: 0.9 });
            item.uri = converted.uri;
            item.mimeType = 'image/jpeg';
          } catch {
            throw new Error('This image could not be converted. Please choose a JPEG or PNG.');
          }
        }

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
            sourceUri: item.uri,
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

  const openEditor = (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => {
    if (!primaryMedia) return;
    setEditingMediaId(primaryMedia.id);
    setEditorTool(tool ?? null);
    setEditorOpen(true);
  };

  const post = async () => {
    setBusy(true);
    try {
      const first = primaryMedia;
      let photoUri: string | undefined;
      let photoMime: string | undefined;
      let videoUri: string | undefined;
      let videoMime: string | undefined;
      let videoDurationMs: number | undefined;
      let edit: LiveEdit | null = null;

      if (first?.type === 'video') {
        const prepared = await preparedClip(first.edit ?? emptyEdit(0), first.uri, 'post');
        videoUri = prepared.uri ?? first.uri;
        videoMime = first.mimeType;
        // Needed so a `.mov` can be remuxed into MP4 before upload.
        videoDurationMs = first.durationMs;
        edit = prepared.live;
      } else if (first?.type === 'photo') {
        photoUri = first.uri;
        photoMime = first.mimeType;
        edit = first.edit ? splitForUpload(first.edit, 'post').live : null;
      }

      // One attachment per post, deliberately.
      //
      // The first version of this fix uploaded the extras as follow-up posts in
      // the same thread. That does not work: `posts` has no reply_to column and
      // create_post() takes no such parameter, so the call would have failed at
      // runtime on the second file. Typecheck cannot see it because rpc() is
      // handed a string. Real multi-image needs a post_media table; until that
      // migration exists, the picker offers one file rather than accepting ten
      // and dropping nine without a word.
      const created = await createPost({
        body: body.trim(),
        audience,
        photoUri,
        photoMime,
        videoUri,
        videoMime,
        videoDurationMs,
        edit,
      });

      qc.invalidateQueries({ queryKey: keys.flow });
      qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.post(created.id) });
      toast({ kind: 'success', title: 'Post shared' });
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Post not shared', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const canPost = !busy && ready;

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
        <Button
          title="Cancel"
          size="sm"
          variant="ghost"
          onPress={() => navigation.goBack()}
          accessibilityLabel="Discard this post"
        />
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
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
              editing={editingMediaId === primaryMedia?.id}
              fontIndex={fontIndex}
              setFontIndex={setFontIndex}
              fontOptions={FONT_OPTIONS}
              addLocation={addLocation}
              locating={locating}
            />
            </View>

            {/* Right column — preview + settings */}
            <View style={{ width: rightPanelWidth, minWidth: 0 }}>
              <ComposerRight
                primaryMedia={primaryMedia}
                media={media}
                audience={audience}
                body={body}
                openEditor={openEditor}
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
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
              editing={editingMediaId === primaryMedia?.id}
              fontIndex={fontIndex}
              setFontIndex={setFontIndex}
              fontOptions={FONT_OPTIONS}
              addLocation={addLocation}
              locating={locating}
            />
            <ComposerRight
              primaryMedia={primaryMedia}
              media={media}
              audience={audience}
              body={body}
              openEditor={openEditor}
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
        initialTool={editorTool}
        onCancel={() => setEditorOpen(false)}
        onDone={(r) => {
          setMedia((prev) =>
            prev.map((m) => (m.id === editingMediaId ? { ...m, edit: r.edit } : m))
          );
          setEditorOpen(false);
          setEditingMediaId(null);
          setEditorTool(null);
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
  media,
  removeMedia,
  pickMedia,
  primaryMedia,
  openEditor,
  editing,
  fontIndex,
  setFontIndex,
  fontOptions,
  addLocation,
  locating,
}: {
  body: string;
  setBody: (v: string) => void;
  audience: 'everyone' | 'connections';
  setAudience: (v: 'everyone' | 'connections') => void;
  media: MediaItem[];
  removeMedia: (id: string) => void;
  pickMedia: () => void;
  primaryMedia: MediaItem | undefined;
  openEditor: (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => void;
  editing: boolean;
  fontIndex: number;
  setFontIndex: (v: number) => void;
  fontOptions: readonly string[];
  addLocation: () => void;
  locating: boolean;
}) {
  const { colors } = useTheme();

  const insertText = (text: string) => {
    setBody(body.trim().endsWith(text.trim()) ? body : body + ' ' + text);
  };

  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Main view — media grid above */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Add Media
          </Txt>
          <Txt variant="caption" color="textMuted">
            One photo or one video per post
          </Txt>
        </View>
        {media.map((m) => (
          <View key={m.id} style={{ position: 'relative', width: 88, height: 88, borderRadius: 16, overflow: 'hidden' }}>
            {m.type === 'video' ? (
              <View style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
                <Ionicons name="videocam-outline" size={24} color="#666" style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -12 }, { translateY: -12 }] }} />
              </View>
            ) : (
              <Image source={{ uri: m.uri }} contentFit="contain" style={{ width: '100%', height: '100%' }} accessibilityLabel="Selected photo preview" />
            )}
            <Pressable onPress={() => removeMedia(m.id)} accessibilityLabel="Remove media" hitSlop={8} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close-outline" size={16} color="#fff" />
            </Pressable>
            {m.type === 'video' && (
              <Pressable onPress={() => openEditor()} accessibilityLabel="Edit video" hitSlop={8} style={{ position: 'absolute', bottom: 4, left: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
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

      {/* Text bar — below main view */}
      <View style={{ gap: space.sm }}>
        <Txt variant="label" color="textSecondary">
          What's on your mind?
        </Txt>
        <Input
          multiline
          value={body}
          onChangeText={setBody}
          placeholder="Good energy, better days. Same me, just more focused."
          maxLength={MAX_BODY}
          showCount
          style={{ minHeight: 150, fontFamily: fontOptions[fontIndex] }}
        />
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, flexWrap: 'wrap' }}>
          {/* Media Settings — line up under the text bar */}
          <Pressable onPress={() => openEditor('crop')} accessibilityLabel="Crop" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="crop-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('filters')} accessibilityLabel="Filter" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="color-wand-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('adjust')} accessibilityLabel="Adjust" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="sunny-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('stickers')} accessibilityLabel="Draw" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="create-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('captions')} accessibilityLabel="Text" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="text-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('stickers')} accessibilityLabel="Stickers" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="happy-outline" size={18} color={colors.textMuted} />
          </Pressable>

          {/* Font cycle */}
          <Pressable onPress={() => setFontIndex((fontIndex + 1) % fontOptions.length)} accessibilityLabel="Change font" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.text }}>Aa</Txt>
          </Pressable>

          {/* Tag people */}
          <Pressable onPress={() => insertText('@')} accessibilityLabel="Tag someone" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.text }}>@</Txt>
          </Pressable>

          {/* Hashtag */}
          <Pressable onPress={() => insertText('#')} accessibilityLabel="Add hashtag" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.textMuted }}>#</Txt>
          </Pressable>

          {/* Public / private toggle */}
          <Pressable onPress={() => setAudience(audience === 'everyone' ? 'connections' : 'everyone')} accessibilityLabel="Public or private" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name={audience === 'everyone' ? 'globe' : 'lock-closed'} size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Location — the one settings row wired to something real: it asks the
          device for a place and appends it to the post, which is what the
          database stores. Permission is requested on tap, never at launch. */}
      <SettingsRow
        label="Location"
        hint={locating ? 'Finding you…' : 'Add a place to this post'}
        icon="location-outline"
        onPress={addLocation}
        disabled={locating}
      />

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

      {/*
        What used to sit here — Post type (Flows/Stories/Moments/Vibes),
        "Tag people", "Advanced options", a Schedule toggle and a Reset button —
        is gone on purpose. Every one of them was UI with no path to the
        database: the segmented control never reached createPost, the toggles
        held local state nothing read, and three SettingsRows had no onPress.
        A control that looks live and does nothing is worse than absent: it
        reads as a bug in the app, not a missing feature.
        These come back when they are wired, not before.
      */}
    </View>
  );
}

/** Right column: media preview, settings panel, post preview. */
function ComposerRight({
  primaryMedia,
  media,
  audience,
  body,
  openEditor,
}: {
  primaryMedia: MediaItem | undefined;
  media: MediaItem[];
  audience: 'everyone' | 'connections';
  body: string;
  openEditor: (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Media preview */}
      {primaryMedia ? (
        <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', aspectRatio: primaryMedia.type === 'video' ? 9 / 16 : 1 }}>
          {primaryMedia.type === 'video' ? (
            <View style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
              <EditedClip uri={primaryMedia.uri} live={null} style={{ width: '100%', height: '100%' }} contentFit="contain" muted loop autoPlay />
              <Pressable onPress={() => openEditor('filters')} accessibilityLabel="Edit media" hitSlop={12} style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="color-wand-outline" size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={() => openEditor()} accessibilityLabel="Close preview" hitSlop={12} style={{ position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close-outline" size={16} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Image source={{ uri: primaryMedia.uri }} contentFit="contain" style={{ width: '100%', height: '100%' }} accessibilityLabel="Selected photo preview" />
          )}
        </View>
      ) : null}

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
              {primaryMedia?.type === 'photo' ? <Image source={{ uri: primaryMedia.uri }} contentFit="contain" style={{ width: '100%', height: '100%' }} accessibilityLabel="Post photo preview" /> : <Txt color="textSecondary" style={{ padding: space.md }}>Video attached — preview above</Txt>}
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
function SettingsRow({ label, hint, icon, onPress, disabled }: { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; disabled?: boolean; }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
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
